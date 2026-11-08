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

    pub total_shares: u128,
    pub available_capital: u128,
    pub deployed_capital: u128,

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
            total_shares: 0,
            available_capital: 0,
            deployed_capital: 0,
            balances: LookupMap::new(StorageKey::Balances),
        }
    }

    pub fn set_loan_manager(&mut self, loan_manager: AccountId) {
        self.assert_admin();
        self.loan_manager = Some(loan_manager);
    }

    /// NEP-141 deposit hook: called when someone sends underlying tokens to this vault
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

        let nav = self.internal_get_nav_per_share();
        let shares_to_mint = if self.total_shares == 0 {
            amount.0
        } else {
            amount
                .0
                .checked_mul(NAV_PRECISION)
                .expect("overflow")
                .checked_div(nav)
                .expect("division error")
        };
        require!(shares_to_mint > 0, "deposit amount too small for 1 share");

        // Mint shares
        let current_bal = self.balances.get(&sender_id).copied().unwrap_or(0);
        self.balances
            .insert(sender_id.clone(), current_bal + shares_to_mint);
        self.total_shares += shares_to_mint;
        self.available_capital += amount.0;

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
                "nav": U128(nav),
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

        let nav = self.internal_get_nav_per_share();
        let underlying_amount = shares
            .0
            .checked_mul(nav)
            .expect("overflow")
            .checked_div(NAV_PRECISION)
            .expect("division error");

        require!(
            self.available_capital >= underlying_amount,
            "insufficient vault liquidity"
        );

        // Deduct shares and available capital optimistically
        self.balances
            .insert(investor.clone(), current_shares - shares.0);
        self.total_shares -= shares.0;
        self.available_capital -= underlying_amount;

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
                self.total_shares += shares.0;
                self.available_capital += underlying_amount.0;
                U128(0)
            }
        }
    }

    /// Disburse capital to borrower for an approved loan
    pub fn fund_loan(&mut self, borrower: AccountId, amount: U128, loan_id: u64) -> Promise {
        self.assert_loan_manager();
        require!(amount.0 > 0, "amount must be > 0");
        require!(
            self.available_capital >= amount.0,
            "insufficient vault liquidity"
        );

        self.available_capital -= amount.0;
        self.deployed_capital += amount.0;

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
                self.available_capital += amount.0;
                self.deployed_capital -= amount.0;
                false
            }
        }
    }

    /// Callback or direct settlement when loan repayment arrives
    pub fn record_repayment(&mut self, principal: U128, interest: U128) {
        self.assert_loan_manager();
        require!(
            self.deployed_capital >= principal.0,
            "principal exceeds deployed"
        );

        self.deployed_capital -= principal.0;
        self.available_capital += principal.0 + interest.0;

        emit_event(
            "homr_vault",
            "1.0.0",
            "repayment_received",
            serde_json::json!({
                "principal": principal,
                "interest": interest,
                "new_nav": U128(self.internal_get_nav_per_share()),
            }),
        );
    }

    // View methods
    pub fn get_nav_per_share(&self) -> U128 {
        U128(self.internal_get_nav_per_share())
    }

    pub fn available_capital(&self) -> U128 {
        U128(self.available_capital)
    }

    pub fn total_deployed_capital(&self) -> U128 {
        U128(self.deployed_capital)
    }

    pub fn total_assets(&self) -> U128 {
        U128(self.available_capital + self.deployed_capital)
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_shares)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    fn internal_get_nav_per_share(&self) -> u128 {
        if self.total_shares == 0 {
            NAV_PRECISION
        } else {
            let total_assets = self.available_capital + self.deployed_capital;
            total_assets
                .checked_mul(NAV_PRECISION)
                .expect("overflow")
                .checked_div(self.total_shares)
                .expect("div zero")
        }
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

    fn vault() -> HomrHousingVault {
        let admin: AccountId = "admin.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin.clone())
            .build());
        HomrHousingVault::new(token, None)
    }

    #[test]
    fn test_deposit_and_nav_appreciation() {
        let mut v = vault();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let investor: AccountId = "investor.testnet".parse().unwrap();

        // 1. Initial NAV = 1.0 (1_000_000)
        assert_eq!(v.get_nav_per_share(), U128(1_000_000));

        // 2. Deposit 100,000 USDC
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(token.clone())
            .build());
        v.ft_on_transfer(investor.clone(), U128(100_000), "".into());

        assert_eq!(v.ft_balance_of(investor.clone()), U128(100_000));
        assert_eq!(v.ft_total_supply(), U128(100_000));
        assert_eq!(v.available_capital(), U128(100_000));

        // 3. Fund a 50,000 loan
        let admin: AccountId = "admin.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin)
            .build());
        v.available_capital -= 50_000;
        v.deployed_capital += 50_000;
        assert_eq!(v.available_capital(), U128(50_000));
        assert_eq!(v.total_deployed_capital(), U128(50_000));
        assert_eq!(v.get_nav_per_share(), U128(1_000_000));

        // 4. Repay with 5,000 interest (55,000 total)
        v.record_repayment(U128(50_000), U128(5_000));
        assert_eq!(v.available_capital(), U128(105_000));
        assert_eq!(v.total_deployed_capital(), U128(0));

        // NAV should appreciate to 1.05 (1_050_000)
        assert_eq!(v.get_nav_per_share(), U128(1_050_000));
    }
}

