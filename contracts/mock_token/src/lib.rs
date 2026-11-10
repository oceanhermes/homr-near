use homr_common::emit_event;
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas,
    PanicOnDefault, Promise, PromiseOrValue, PromiseResult,
};

const GAS_FOR_FT_TRANSFER_CALL: Gas = Gas::from_tgas(35);
const GAS_FOR_RESOLVE_TRANSFER: Gas = Gas::from_tgas(10);

#[ext_contract(ext_ft_receiver)]
pub trait FungibleTokenReceiver {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128>;
}

#[ext_contract(ext_self)]
pub trait FungibleTokenResolver {
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128;
}

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Balances,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFungibleToken {
    pub owner_id: AccountId,
    pub total_supply: u128,
    pub balances: LookupMap<AccountId, u128>,
}

#[near]
impl MockFungibleToken {
    #[init]
    pub fn new(owner_id: Option<AccountId>) -> Self {
        let owner = owner_id.unwrap_or_else(env::predecessor_account_id);
        Self {
            owner_id: owner,
            total_supply: 0,
            balances: LookupMap::new(StorageKey::Balances),
        }
    }

    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        let cur = self.balances.get(&account_id).copied().unwrap_or(0);
        let new_bal = cur.checked_add(amount.0).expect("mint overflow");
        self.balances.insert(account_id.clone(), new_bal);
        self.total_supply = self
            .total_supply
            .checked_add(amount.0)
            .expect("supply overflow");

        emit_event(
            "nep141",
            "1.0.0",
            "ft_mint",
            serde_json::json!([{
                "owner_id": account_id,
                "amount": amount,
            }]),
        );
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
    }

    /// NEP-141 `ft_transfer_call`.
    ///
    /// The attached deposit is forwarded to the receiver's `ft_on_transfer` so
    /// receivers that require a storage deposit can be funded in the same call
    /// (`housing_vault::ft_on_transfer` needs at least 1 NEAR to register the
    /// deposit, otherwise it refunds). Callers must attach the receiver's storage
    /// deposit; the token contract keeps nothing.
    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let storage_deposit = env::attached_deposit();
        require!(
            storage_deposit.as_yoctonear() > 0,
            "attach the receiver storage deposit (>= 1 NEAR for the housing vault)"
        );

        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);

        ext_ft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_FT_TRANSFER_CALL)
            .with_attached_deposit(storage_deposit)
            .ft_on_transfer(sender.clone(), amount, msg)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE_TRANSFER)
                    .ft_resolve_transfer(sender, receiver_id, amount),
            )
            .into()
    }

    #[private]
    pub fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "private callback"
        );

        let unused_amount = match env::promise_result(0) {
            PromiseResult::Successful(value) => {
                if let Ok(unused) = near_sdk::serde_json::from_slice::<U128>(&value) {
                    std::cmp::min(amount.0, unused.0)
                } else {
                    amount.0
                }
            }
            PromiseResult::Failed => amount.0,
        };

        if unused_amount > 0 {
            let receiver_balance = self.balances.get(&receiver_id).copied().unwrap_or(0);
            if receiver_balance > 0 {
                let refund_amount = std::cmp::min(receiver_balance, unused_amount);
                self.balances.insert(receiver_id.clone(), receiver_balance - refund_amount);
                let sender_balance = self.balances.get(&sender_id).copied().unwrap_or(0);
                self.balances.insert(sender_id.clone(), sender_balance + refund_amount);

                emit_event(
                    "nep141",
                    "1.0.0",
                    "ft_transfer",
                    serde_json::json!([{
                        "old_owner_id": receiver_id,
                        "new_owner_id": sender_id,
                        "amount": U128(refund_amount),
                        "memo": "refund",
                    }]),
                );
            }
        }

        U128(unused_amount)
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    fn internal_transfer(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        amount: u128,
        memo: Option<String>,
    ) {
        require!(sender != receiver, "cannot transfer to self");
        require!(amount > 0, "amount must be > 0");

        let sender_bal = self.balances.get(sender).copied().unwrap_or(0);
        require!(sender_bal >= amount, "insufficient balance");
        self.balances.insert(sender.clone(), sender_bal - amount);

        let recv_bal = self.balances.get(receiver).copied().unwrap_or(0);
        self.balances.insert(receiver.clone(), recv_bal + amount);

        emit_event(
            "nep141",
            "1.0.0",
            "ft_transfer",
            serde_json::json!([{
                "old_owner_id": sender,
                "new_owner_id": receiver,
                "amount": U128(amount),
                "memo": memo,
            }]),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;
    use near_sdk::NearToken;

    fn token() -> MockFungibleToken {
        let owner: AccountId = "owner.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(owner)
            .build());
        MockFungibleToken::new(None)
    }

    #[test]
    fn ft_transfer_call_forwards_the_attached_storage_deposit() {
        let mut t = token();
        let holder: AccountId = "investor.testnet".parse().unwrap();
        let vault: AccountId = "vault.testnet".parse().unwrap();
        t.mint(holder.clone(), U128(100_000));

        // The vault-side storage deposit rides along with the transfer.
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(holder.clone())
            .attached_deposit(NearToken::from_near(1))
            .build());
        let result = t.ft_transfer_call(vault.clone(), U128(100_000), None, "".into());

        assert!(matches!(result, PromiseOrValue::Promise(_)));
        assert_eq!(t.ft_balance_of(holder), U128(0));
        assert_eq!(t.ft_balance_of(vault), U128(100_000));
    }

    #[test]
    #[should_panic(expected = "attach the receiver storage deposit")]
    fn ft_transfer_call_requires_an_attached_deposit() {
        let mut t = token();
        let holder: AccountId = "investor.testnet".parse().unwrap();
        let vault: AccountId = "vault.testnet".parse().unwrap();
        t.mint(holder.clone(), U128(100_000));

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(holder)
            .attached_deposit(NearToken::from_yoctonear(0))
            .build());
        t.ft_transfer_call(vault, U128(100_000), None, "".into());
    }

    #[test]
    fn ft_transfer_still_requires_one_yocto() {
        let mut t = token();
        let holder: AccountId = "investor.testnet".parse().unwrap();
        let other: AccountId = "bob.testnet".parse().unwrap();
        t.mint(holder.clone(), U128(10));

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(holder.clone())
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        t.ft_transfer(other.clone(), U128(10), None);

        assert_eq!(t.ft_balance_of(holder), U128(0));
        assert_eq!(t.ft_balance_of(other), U128(10));
    }
}
