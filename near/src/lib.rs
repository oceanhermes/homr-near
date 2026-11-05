use near_sdk::{env, json_types::U128, near, AccountId, PanicOnDefault};
use std::collections::HashMap;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct AuctionProof {
    pub auction_id: String,
    pub source_chain: String,
    pub proof_hash: String,
    pub total_capital: U128,
    pub recorded_by: AccountId,
    pub recorded_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct LoanProof {
    pub loan_id: String,
    pub borrower_hash: String,
    pub proof_hash: String,
    pub principal: U128,
    pub repaid: U128,
    pub recorded_by: AccountId,
    pub recorded_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct RepaymentProof {
    pub amount: U128,
    pub proof_hash: String,
    pub recorded_by: AccountId,
    pub recorded_at: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct HomrNearRegistry {
    pub operator: AccountId,
    pub auctions: HashMap<String, AuctionProof>,
    pub loans: HashMap<String, LoanProof>,
    pub repayments: HashMap<String, Vec<RepaymentProof>>,
}

#[near]
impl HomrNearRegistry {
    #[init]
    pub fn new(operator: Option<AccountId>) -> Self {
        Self {
            operator: operator.unwrap_or_else(env::predecessor_account_id),
            auctions: HashMap::new(),
            loans: HashMap::new(),
            repayments: HashMap::new(),
        }
    }

    pub fn register_auction(
        &mut self,
        auction_id: String,
        source_chain: String,
        proof_hash: String,
        total_capital: U128,
    ) {
        self.assert_operator();
        assert!(!auction_id.is_empty(), "auction_id is required");
        assert!(!proof_hash.is_empty(), "proof_hash is required");
        assert!(
            !self.auctions.contains_key(&auction_id),
            "auction already registered"
        );

        let proof = AuctionProof {
            auction_id: auction_id.clone(),
            source_chain,
            proof_hash,
            total_capital,
            recorded_by: env::predecessor_account_id(),
            recorded_at: env::block_timestamp_ms(),
        };
        self.auctions.insert(auction_id.clone(), proof);
        self.emit("auction_registered", &auction_id);
    }

    pub fn register_loan(
        &mut self,
        loan_id: String,
        borrower_hash: String,
        proof_hash: String,
        principal: U128,
    ) {
        self.assert_operator();
        assert!(!loan_id.is_empty(), "loan_id is required");
        assert!(!proof_hash.is_empty(), "proof_hash is required");
        assert!(
            !self.loans.contains_key(&loan_id),
            "loan already registered"
        );
        assert!(principal.0 > 0, "principal must be positive");

        let proof = LoanProof {
            loan_id: loan_id.clone(),
            borrower_hash,
            proof_hash,
            principal,
            repaid: U128(0),
            recorded_by: env::predecessor_account_id(),
            recorded_at: env::block_timestamp_ms(),
        };
        self.loans.insert(loan_id.clone(), proof);
        self.emit("loan_registered", &loan_id);
    }

    pub fn record_repayment(&mut self, loan_id: String, amount: U128, proof_hash: String) {
        self.assert_operator();
        let loan = self.loans.get_mut(&loan_id).expect("loan not found");
        assert!(!proof_hash.is_empty(), "proof_hash is required");
        assert!(amount.0 > 0, "amount must be positive");
        let new_repaid = loan
            .repaid
            .0
            .checked_add(amount.0)
            .expect("repayment overflow");
        assert!(
            new_repaid <= loan.principal.0,
            "repayment exceeds principal"
        );
        loan.repaid = U128(new_repaid);
        self.repayments
            .entry(loan_id.clone())
            .or_default()
            .push(RepaymentProof {
                amount,
                proof_hash,
                recorded_by: env::predecessor_account_id(),
                recorded_at: env::block_timestamp_ms(),
            });
        self.emit("repayment_recorded", &loan_id);
    }

    pub fn get_auction(&self, auction_id: String) -> Option<AuctionProof> {
        self.auctions.get(&auction_id).cloned()
    }

    pub fn get_loan(&self, loan_id: String) -> Option<LoanProof> {
        self.loans.get(&loan_id).cloned()
    }

    pub fn get_repayments(&self, loan_id: String) -> Vec<RepaymentProof> {
        self.repayments.get(&loan_id).cloned().unwrap_or_default()
    }

    pub fn get_operator(&self) -> AccountId {
        self.operator.clone()
    }

    fn assert_operator(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.operator,
            "operator only"
        );
    }

    fn emit(&self, event: &str, id: &str) {
        let payload = near_sdk::serde_json::json!({
            "standard": "homr",
            "version": "1.0.0",
            "event": event,
            "data": { "id": id },
        });
        env::log_str(&format!("EVENT_JSON:{payload}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{get_logs, VMContextBuilder},
        testing_env,
    };

    fn registry() -> HomrNearRegistry {
        let operator = "operator.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(operator)
            .build());
        HomrNearRegistry::new(None)
    }

    #[test]
    fn keeps_each_repayment_proof_and_original_loan_hash() {
        let mut contract = registry();
        contract.register_loan(
            "loan-1".into(),
            "borrower-hash".into(),
            "original".into(),
            U128(100),
        );
        contract.record_repayment("loan-1".into(), U128(40), "first".into());
        contract.record_repayment("loan-1".into(), U128(60), "second".into());

        let loan = contract.get_loan("loan-1".into()).unwrap();
        let repayments = contract.get_repayments("loan-1".into());
        assert_eq!(loan.proof_hash, "original");
        assert_eq!(loan.repaid, U128(100));
        assert_eq!(repayments.len(), 2);
        assert_eq!(repayments[0].proof_hash, "first");
        assert_eq!(repayments[1].proof_hash, "second");
    }

    #[test]
    #[should_panic(expected = "loan already registered")]
    fn rejects_duplicate_loan() {
        let mut contract = registry();
        contract.register_loan("loan-1".into(), "borrower".into(), "hash".into(), U128(100));
        contract.register_loan(
            "loan-1".into(),
            "borrower".into(),
            "replacement".into(),
            U128(100),
        );
    }

    #[test]
    #[should_panic(expected = "repayment exceeds principal")]
    fn rejects_excess_repayment() {
        let mut contract = registry();
        contract.register_loan("loan-1".into(), "borrower".into(), "hash".into(), U128(100));
        contract.record_repayment("loan-1".into(), U128(101), "repayment".into());
    }

    #[test]
    fn escapes_event_ids() {
        let mut contract = registry();
        contract.register_auction("auction-\"1".into(), "bnb".into(), "hash".into(), U128(100));
        let event = get_logs()
            .last()
            .unwrap()
            .trim_start_matches("EVENT_JSON:")
            .to_string();
        let value: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(&event).unwrap();
        assert_eq!(value["data"]["id"], "auction-\"1");
    }

    #[test]
    fn serializes_large_amounts_as_decimal_strings() {
        let value = near_sdk::serde_json::to_value(U128(u128::MAX)).unwrap();
        assert_eq!(value, near_sdk::serde_json::json!(u128::MAX.to_string()));
    }
}
