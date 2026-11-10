use homr_common::{emit_event, AuctionProof, LoanProof, RepaymentProof};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault};

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Auctions,
    Loans,
    Repayments,
    TrustedCallers,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct HomrAuditRegistry {
    pub operator: AccountId,
    pub auctions: LookupMap<String, AuctionProof>,
    pub loans: LookupMap<String, LoanProof>,
    pub repayments: LookupMap<String, Vec<RepaymentProof>>,
    pub trusted_callers: LookupMap<AccountId, bool>,
}

#[near]
impl HomrAuditRegistry {
    #[init]
    pub fn new(operator: Option<AccountId>) -> Self {
        let op = operator.unwrap_or_else(env::predecessor_account_id);
        let mut trusted = LookupMap::new(StorageKey::TrustedCallers);
        trusted.insert(op.clone(), true);

        Self {
            operator: op,
            auctions: LookupMap::new(StorageKey::Auctions),
            loans: LookupMap::new(StorageKey::Loans),
            repayments: LookupMap::new(StorageKey::Repayments),
            trusted_callers: trusted,
        }
    }

    pub fn add_trusted_caller(&mut self, account_id: AccountId) {
        self.assert_operator();
        self.trusted_callers.insert(account_id.clone(), true);
        emit_event(
            "homr_audit",
            "1.0.0",
            "trusted_caller_added",
            serde_json::json!({ "account_id": account_id }),
        );
    }

    pub fn remove_trusted_caller(&mut self, account_id: AccountId) {
        self.assert_operator();
        self.trusted_callers.remove(&account_id);
        emit_event(
            "homr_audit",
            "1.0.0",
            "trusted_caller_removed",
            serde_json::json!({ "account_id": account_id }),
        );
    }

    pub fn is_trusted_caller(&self, account_id: AccountId) -> bool {
        account_id == self.operator
            || self.trusted_callers.get(&account_id).copied().unwrap_or(false)
    }

    pub fn register_auction(
        &mut self,
        auction_id: String,
        source_chain: String,
        proof_hash: String,
        total_capital: U128,
    ) {
        self.assert_authorized();
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

        emit_event(
            "homr_audit",
            "1.0.0",
            "auction_registered",
            serde_json::json!({ "id": auction_id }),
        );
    }

    pub fn register_loan(
        &mut self,
        loan_id: String,
        borrower_hash: String,
        proof_hash: String,
        principal: U128,
    ) {
        self.assert_authorized();
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

        emit_event(
            "homr_audit",
            "1.0.0",
            "loan_registered",
            serde_json::json!({ "id": loan_id }),
        );
    }

    pub fn record_repayment(&mut self, loan_id: String, amount: U128, proof_hash: String) {
        self.assert_authorized();
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

        let mut reps = self.repayments.get(&loan_id).cloned().unwrap_or_default();
        reps.push(RepaymentProof {
            amount,
            proof_hash,
            recorded_by: env::predecessor_account_id(),
            recorded_at: env::block_timestamp_ms(),
        });
        self.repayments.insert(loan_id.clone(), reps);

        emit_event(
            "homr_audit",
            "1.0.0",
            "repayment_recorded",
            serde_json::json!({ "id": loan_id }),
        );
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

    fn assert_authorized(&self) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.operator
                || self.trusted_callers.get(&caller).copied().unwrap_or(false),
            "unauthorized: caller is not operator or trusted contract"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn registry() -> HomrAuditRegistry {
        let operator = "operator.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(operator)
            .build());
        HomrAuditRegistry::new(None)
    }

    #[test]
    fn test_loan_and_repayment_records() {
        let mut contract = registry();
        contract.register_loan(
            "loan-1".into(),
            "borrower-hash".into(),
            "orig-hash".into(),
            U128(100),
        );
        contract.record_repayment("loan-1".into(), U128(40), "rep-1".into());
        contract.record_repayment("loan-1".into(), U128(60), "rep-2".into());

        let loan = contract.get_loan("loan-1".into()).unwrap();
        let repayments = contract.get_repayments("loan-1".into());
        assert_eq!(loan.proof_hash, "orig-hash");
        assert_eq!(loan.repaid, U128(100));
        assert_eq!(repayments.len(), 2);
    }

    #[test]
    fn test_trusted_caller_permission() {
        let mut contract = registry();
        let trusted_caller: AccountId = "auction.testnet".parse().unwrap();
        contract.add_trusted_caller(trusted_caller.clone());

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(trusted_caller)
            .build());
        contract.register_auction(
            "auction-1".into(),
            "near:testnet".into(),
            "proof-1".into(),
            U128(500),
        );
        assert!(contract.get_auction("auction-1".into()).is_some());
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_unauthorized_caller_rejected() {
        let mut contract = registry();
        let untrusted: AccountId = "malicious.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(untrusted)
            .build());
        contract.register_loan("loan-x".into(), "b".into(), "p".into(), U128(100));
    }
}

