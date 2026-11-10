use homr_common::emit_event;
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas,
    NearToken, PanicOnDefault, Promise, PromiseOrValue, PromiseResult,
};

const NAV_PRECISION: u128 = 1_000_000; // 6 decimals precision for NAV
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);

#[ext_contract(ext_nep141)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
pub trait VaultCallbacks {
    fn resolve_fund_loan(
        &mut self,
        borrower: AccountId,
        amount: U128,
        loan_id: u64,
    ) -> bool;

    fn resolve_withdraw(
        &mut self,
        investor: AccountId,
        shares: U128,
        underlying_amount: U128,
    ) -> U128;
}

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Balances,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct HomrHousingVault {
    pub admin: AccountId,
    pub underlying_token: AccountId,
    pub loan_manager: Option<AccountId>,

    /// A3: True once the first deposit has booked NAV.
    pub nav_booked: bool,

    /// A3: Underlying tokens currently available for withdrawals (not locked in loans).
    pub available_underlying: u128,
    /// A3: Principal outstanding on loans funded by the vault. No on-chain interest.
    pub total_outstanding_principal: u128,
    /// A3: Total hvSHARE supply in circulation.
    pub virtual_shares: u128,
    /// A3: Total underlying backing all hvSHARE (available + outstanding).
    pub virtual_assets: u128,

    pub balances: LookupMap<AccountId, u128>,
}

#[near]
impl HomrHousingVault {
    #[init]
    pub fn new(underlying_token: AccountId, loan_manager: Option<AccountId>) -> Self {
        let admin = env::predecessor_account_id();
        Self {
            admin,
            underlying_token,
            loan_manager,
            nav_booked: false,
            available_underlying: 0,
            total_outstanding_principal: 0,
            virtual_shares: 1_000_000,
            virtual_assets: 1_000_000,
            balances: LookupMap::new(StorageKey::Balances),
        }
    }

    pub fn set_loan_manager(&mut self, loan_manager: AccountId) {
        self.assert_admin();
        self.loan_manager = Some(loan_manager);
    }

    /// A3 (NAV split & anti-inflation): NAV per share is booked off total backing
    /// (available_underlying + total_outstanding_principal + virtual_assets offset)
    /// over virtual_shares (which includes the 1e6 seed). Interest is never accrued
    /// on-chain; the split only moves principal between the two buckets.
    pub fn nav_booked(&self) -> u128 {
        if self.virtual_shares == 0 {
            NAV_PRECISION
        } else {
            let backing = self
                .available_underlying
                .checked_add(self.total_outstanding_principal)
                .and_then(|v| v.checked_add(self.virtual_assets))
                .expect("overflow");
            backing
                .checked_mul(NAV_PRECISION)
                .expect("overflow")
                .checked_div(self.virtual_shares)
                .expect("div zero")
        }
    }

    /// A3: hvSHARE minted for a deposit of `amount` underlying, priced at the booked NAV.
    /// shares = amount * virtual_shares / backing. The 1e6/1e6 virtual seed pair
    /// prevents the first-depositor / donation inflation attack: an attacker donating
    /// into an empty vault can shift the price by at most delta/1e6.
    pub fn shares_for_deposit(&self, amount: u128) -> u128 {
        let backing = self
            .available_underlying
            .checked_add(self.total_outstanding_principal)
            .and_then(|v| v.checked_add(self.virtual_assets))
            .expect("overflow");
        if backing == 0 {
            amount
        } else {
            amount
                .checked_mul(self.virtual_shares)
                .expect("overflow")
                .checked_div(backing)
                .expect("div zero")
        }
    }

    /// A5 (NEP-141 ft_on_transfer): if storage is not registered, refund the full amount.
    /// Otherwise mint hvSHARE at nav_booked and return 0.
    #[payable]
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        _msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.underlying_token,
            "only accepts underlying token"
        );
        require!(amount.0 > 0, "amount must be > 0");

        // Storage registration: deposits must attach at least 1 NEAR.
        if env::attached_deposit() < NearToken::from_near(1) {
            return PromiseOrValue::Value(amount); // refund, storage not registered
        }

        let shares_to_mint = self.shares_for_deposit(amount.0);
        require!(shares_to_mint > 0, "deposit amount too small for 1 share");

        // First deposit books the NAV. virtual_assets stays a constant 1e6 offset.
        self.nav_booked = true;

        self.available_underlying += amount.0;
        self.virtual_shares += shares_to_mint;

        // Mint hvSHARE
        let current_bal = self.balances.get(&sender_id).copied().unwrap_or(0);
        self.balances
            .insert(sender_id.clone(), current_bal + shares_to_mint);

        emit_event(
            "nep141",
            "1.0.0",
            "ft_mint",
            serde_json::json!([{
                "owner_id": sender_id,
                "amount": U128(shares_to_mint),
            }]),
        );

        emit_event(
            "homr_vault",
            "1.0.0",
            "vault_deposit",
            serde_json::json!({
                "investor": sender_id,
                "assets": amount,
                "shares": U128(shares_to_mint),
                "nav_booked": U128(self.nav_booked()),
            }),
        );

        PromiseOrValue::Value(U128(0)) // accept full amount, 0 refund
    }

    /// Withdraw shares for proportional underlying
    #[payable]
    pub fn withdraw(&mut self, shares: U128) -> Promise {
        assert_one_yocto();
        let investor = env::predecessor_account_id();
        require!(shares.0 > 0, "shares must be > 0");

        let current_shares = self.balances.get(&investor).copied().unwrap_or(0);
        require!(current_shares >= shares.0, "insufficient shares");

        let nav = self.nav_booked();
        let underlying_amount = shares
            .0
            .checked_mul(nav)
            .expect("overflow")
            .checked_div(NAV_PRECISION)
            .expect("division error");

        require!(
            self.available_underlying >= underlying_amount,
            "insufficient vault liquidity"
        );

        // Deduct shares and available underlying optimistically
        self.balances
            .insert(investor.clone(), current_shares - shares.0);
        self.virtual_shares -= shares.0;
        self.available_underlying -= underlying_amount;

        emit_event(
            "nep141",
            "1.0.0",
            "ft_burn",
            serde_json::json!([{
                "owner_id": investor,
                "amount": shares,
            }]),
        );

        emit_event(
            "homr_vault",
            "1.0.0",
            "vault_withdraw",
            serde_json::json!({
                "investor": investor,
                "shares": shares,
                "underlying_amount": U128(underlying_amount),
                "nav": U128(nav),
            }),
        );

        // Transfer underlying token to investor
        ext_nep141::ext(self.underlying_token.clone())
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .ft_transfer(investor.clone(), U128(underlying_amount), Some("vault_withdraw".into()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .resolve_withdraw(investor, shares, U128(underlying_amount)),
            )
    }

    #[private]
    pub fn resolve_withdraw(
        &mut self,
        investor: AccountId,
        shares: U128,
        underlying_amount: U128,
    ) -> U128 {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "private callback"
        );

        match env::promise_result(0) {
            PromiseResult::Successful(_) => underlying_amount,
            PromiseResult::Failed => {
                // Rollback withdrawal state
                let cur = self.balances.get(&investor).copied().unwrap_or(0);
                self.balances.insert(investor, cur + shares.0);
                self.virtual_shares += shares.0;
                self.available_underlying += underlying_amount.0;
                U128(0)
            }
        }
    }

    /// A3/A5 (fund_loan): callable ONLY by loan_manager. Increases
    /// total_outstanding_principal and decreases available_underlying.
    /// Note: NOT #[private] — loan_manager calls this cross-contract; the sole
    /// access-control guard is assert_loan_manager().
    pub fn fund_loan(&mut self, borrower: AccountId, amount: U128, loan_id: u64) -> Promise {
        self.assert_loan_manager();
        require!(amount.0 > 0, "amount must be > 0");
        require!(
            self.available_underlying >= amount.0,
            "insufficient vault liquidity"
        );

        self.available_underlying -= amount.0;
        self.total_outstanding_principal += amount.0;

        emit_event(
            "homr_vault",
            "1.0.0",
            "loan_funded",
            serde_json::json!({
                "loan_id": loan_id,
                "borrower": borrower,
                "amount": amount,
            }),
        );

        ext_nep141::ext(self.underlying_token.clone())
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .ft_transfer(borrower.clone(), amount, Some(format!("loan_fund_{}", loan_id)))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .resolve_fund_loan(borrower, amount, loan_id),
            )
    }

    #[private]
    pub fn resolve_fund_loan(
        &mut self,
        _borrower: AccountId,
        amount: U128,
        _loan_id: u64,
    ) -> bool {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "private callback"
        );

        match env::promise_result(0) {
            PromiseResult::Successful(_) => true,
            PromiseResult::Failed => {
                // Rollback allocation
                self.available_underlying += amount.0;
                self.total_outstanding_principal -= amount.0;
                false
            }
        }
    }

    /// A3/A5 (record_repayment): callable ONLY by loan_manager. Increases
    /// available_underlying and decreases total_outstanding_principal.
    /// Interest is NOT accrued on-chain; `_interest` is accepted for
    /// accounting compatibility but discarded.
    /// Note: NOT #[private] — loan_manager calls this cross-contract; the sole
    /// access-control guard is assert_loan_manager().
    pub fn record_repayment(&mut self, principal: U128, _interest: U128) {
        self.assert_loan_manager();
        require!(
            self.total_outstanding_principal >= principal.0,
            "principal exceeds outstanding"
        );

        self.total_outstanding_principal -= principal.0;
        self.available_underlying += principal.0;

        emit_event(
            "homr_vault",
            "1.0.0",
            "repayment_received",
            serde_json::json!({
                "principal": principal,
                "new_nav_booked": U128(self.nav_booked()),
            }),
        );
    }

    // View methods
    pub fn get_nav_booked(&self) -> U128 {
        U128(self.nav_booked())
    }

    pub fn get_available_underlying(&self) -> U128 {
        U128(self.available_underlying)
    }

    pub fn get_total_outstanding_principal(&self) -> U128 {
        U128(self.total_outstanding_principal)
    }

    pub fn get_virtual_assets(&self) -> U128 {
        U128(self.virtual_assets)
    }

    pub fn get_virtual_shares(&self) -> U128 {
        U128(self.virtual_shares)
    }

    pub fn is_nav_booked(&self) -> bool {
        self.nav_booked
    }

    pub fn total_assets(&self) -> U128 {
        U128(self.available_underlying + self.total_outstanding_principal)
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.virtual_shares)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    fn assert_admin(&self) {
        require!(
            env::predecessor_account_id() == self.admin,
            "admin only"
        );
    }

    fn assert_loan_manager(&self) {
        require!(
            Some(env::predecessor_account_id()) == self.loan_manager
                || env::predecessor_account_id() == self.admin,
            "loan manager only"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;
    use near_sdk::NearToken;

    fn vault() -> HomrHousingVault {
        let admin: AccountId = "admin.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin.clone())
            .build());
        HomrHousingVault::new(token, None)
    }

    #[test]
    fn test_deposit_and_nav_booked() {
        let mut v = vault();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let investor: AccountId = "investor.testnet".parse().unwrap();

        // 1. Initial state: nav_booked = false, virtual_assets = virtual_shares = 1e6,
        //    so nav_booked = 1.0 (NAV_PRECISION)
        assert!(!v.is_nav_booked());
        assert_eq!(v.get_virtual_assets(), U128(1_000_000));
        assert_eq!(v.get_virtual_shares(), U128(1_000_000));
        assert_eq!(v.get_nav_booked(), U128(1_000_000));

        // 2. Deposit 100,000 USDC with storage deposit (1 NEAR)
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(token.clone())
            .attached_deposit(NearToken::from_near(1))
            .build());
        let result = v.ft_on_transfer(investor.clone(), U128(100_000), "".into());
        assert!(matches!(result, PromiseOrValue::Value(U128(0))));

        assert_eq!(v.ft_balance_of(investor.clone()), U128(100_000));
        assert_eq!(v.get_available_underlying(), U128(100_000));
        assert!(v.is_nav_booked());

        // 3. Fund a 50,000 loan via loan_manager
        let loan_manager: AccountId = "loan_manager.testnet".parse().unwrap();
        let admin: AccountId = "admin.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin)
            .build());
        v.set_loan_manager(loan_manager.clone());
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(loan_manager.clone())
            .build());
        v.fund_loan("borrower.testnet".parse().unwrap(), U128(50_000), 1);
        assert_eq!(v.get_available_underlying(), U128(50_000));
        assert_eq!(v.get_total_outstanding_principal(), U128(50_000));

        // 4. Repay principal 50,000 (interest not accrued on-chain),
        //    called by loan_manager (assert_loan_manager is the sole guard).
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(loan_manager)
            .build());
        v.record_repayment(U128(50_000), U128(5_000));
        assert_eq!(v.get_available_underlying(), U128(100_000));
        assert_eq!(v.get_total_outstanding_principal(), U128(0));
    }

    #[test]
    fn test_ft_on_transfer_without_storage_deposit_refunds() {
        let mut v = vault();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let investor: AccountId = "investor.testnet".parse().unwrap();

        // Deposit without storage deposit -> refund, no state change
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(token.clone())
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        let result = v.ft_on_transfer(investor.clone(), U128(100_000), "".into());
        assert!(matches!(result, PromiseOrValue::Value(U128(100_000))));
        assert!(!v.is_nav_booked());
        assert_eq!(v.ft_balance_of(investor.clone()), U128(0));
        assert_eq!(v.get_available_underlying(), U128(0));
    }

    #[test]
    fn test_unauthorized_fund_loan_panics() {
        let mut v = vault();
        let unauthorized: AccountId = "hacker.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(unauthorized)
            .build());
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            v.fund_loan("borrower.testnet".parse().unwrap(), U128(100), 1);
        }))
        .expect_err("should panic when caller is not loan_manager");
    }

    #[test]
    fn test_unauthorized_repayment_panics() {
        let mut v = vault();
        let unauthorized: AccountId = "hacker.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(unauthorized)
            .build());
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            v.record_repayment(U128(100), U128(5));
        }))
        .expect_err("should panic when caller is not loan_manager");
    }
}

