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

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);

        ext_ft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_FT_TRANSFER_CALL)
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

