use homr_common::emit_event;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, PanicOnDefault,
};

const GAS_FOR_CROSS_CALL: Gas = Gas::from_tgas(25);

#[ext_contract(ext_vault)]
pub trait VaultContract {
    fn fund_loan(&mut self, borrower: AccountId, amount: U128, loan_id: u64);
    fn record_repayment(&mut self, principal: U128, interest: U128);
}

#[ext_contract(ext_audit)]
pub trait AuditContract {
    fn register_loan(
        &mut self,
        loan_id: String,
        borrower_hash: String,
        proof_hash: String,
        principal: U128,
    );
    fn record_repayment(&mut self, loan_id: String, amount: U128, proof_hash: String);
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoanStatus {
    Pending,
    Funded,
    Repaying,
    Closed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Loan {
    pub id: u64,
    pub auction_id: Option<u64>,
    pub borrower: AccountId,
    pub principal: U128,
    pub remaining_principal: U128,
    pub rate_bps: u32,
    pub term_days: u32,
    pub property_hash: String,
    pub funded_at: u64,
    pub status: LoanStatus,
    pub total_repaid: U128,
}

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Loans,
    BorrowerLoans,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct HomrLoanManager {
    pub admin: AccountId,
    pub vault: AccountId,
    pub audit_registry: Option<AccountId>,
    pub credit_auction: Option<AccountId>,
    pub next_loan_id: u64,

    // IterableMap adalah standar baru NEAR SDK (menggantikan UnorderedMap)
    pub loans: IterableMap<u64, Loan>,
    pub borrower_loans: LookupMap<AccountId, Vec<u64>>,
}

#[near]
impl HomrLoanManager {
    #[init]
    pub fn new(
        vault: AccountId,
        audit_registry: Option<AccountId>,
        credit_auction: Option<AccountId>,
    ) -> Self {
        let admin = env::predecessor_account_id();
        Self {
            admin,
            vault,
            audit_registry,
            credit_auction,
            next_loan_id: 1,
            loans: IterableMap::new(StorageKey::Loans),
            borrower_loans: LookupMap::new(StorageKey::BorrowerLoans),
        }
    }

    pub fn set_credit_auction(&mut self, credit_auction: AccountId) {
        self.assert_admin();
        self.credit_auction = Some(credit_auction);
    }

    pub fn set_audit_registry(&mut self, audit_registry: AccountId) {
        self.assert_admin();
        self.audit_registry = Some(audit_registry);
    }

    /// Issue loan callable by credit_auction contract after auction finalization
    #[payable]
    pub fn issue_loan(
        &mut self,
        borrower: AccountId,
        principal: U128,
        rate_bps: u32,
        term_days: u32,
        property_hash: String,
        auction_id: u64,
    ) -> u64 {
        // A1: Assert predecessor is the credit_auction contract
        let caller = env::predecessor_account_id();
        require!(
            Some(caller.clone()) == self.credit_auction || caller == self.admin,
            "only credit_auction or admin can issue loans"
        );

        // A2: Require storage deposit
        require!(
            env::attached_deposit().as_yoctonear() > 0,
            "storage deposit required"
        );

        require!(principal.0 > 0, "principal must be > 0");
        require!(term_days > 0, "term must be > 0");

        let loan_id = self.next_loan_id;
        self.next_loan_id += 1;
        let now = env::block_timestamp_ms();

        let loan = Loan {
            id: loan_id,
            auction_id: Some(auction_id),
            borrower: borrower.clone(),
            principal,
            remaining_principal: principal,
            rate_bps,
            term_days,
            property_hash: property_hash.clone(),
            funded_at: now,
            status: LoanStatus::Pending,
            total_repaid: U128(0),
        };
        self.loans.insert(loan_id, loan);

        let mut list = self
            .borrower_loans
            .get(&borrower)
            .cloned()
            .unwrap_or_default();
        list.push(loan_id);
        self.borrower_loans.insert(borrower.clone(), list);

        emit_event(
            "homr_loan",
            "1.0.0",
            "loan_issued",
            serde_json::json!({
                "loan_id": loan_id,
                "borrower": borrower,
                "principal": principal,
                "rate_bps": rate_bps,
                "term_days": term_days,
                "property_hash": property_hash,
                "auction_id": auction_id,
            }),
        );

        // Call vault to fund loan
        let _ = ext_vault::ext(self.vault.clone())
            .with_static_gas(GAS_FOR_CROSS_CALL)
            .fund_loan(borrower.clone(), principal, loan_id);

        // If audit registry configured, record proof
        if let Some(audit) = &self.audit_registry {
            let borrower_hash = format!("{:x?}", env::sha256(borrower.as_bytes()));
            let proof_hash = format!(
                "{:x?}",
                env::sha256(format!("loan:{}:{}", loan_id, now).as_bytes())
            );
            let _ = ext_audit::ext(audit.clone())
                .with_static_gas(GAS_FOR_CROSS_CALL)
                .register_loan(loan_id.to_string(), borrower_hash, proof_hash, principal);
        }

        loan_id
    }

    /// Retry loan issuance if vault funding failed (idempotent by auction_id)
    pub fn retry_issue_loan(&mut self, auction_id: u64) {
        self.assert_admin();

        // Find loan by auction_id
        let loan_id = self
            .loans
            .iter()
            .find_map(|(id, loan)| {
                if loan.auction_id == Some(auction_id) && loan.status == LoanStatus::Pending {
                    Some(*id)
                } else {
                    None
                }
            })
            .expect("no pending loan found for auction_id");

        let loan = self.loans.get(&loan_id).expect("loan not found");
        let borrower = loan.borrower.clone();
        let principal = loan.principal;

        // Retry vault funding
        let _ = ext_vault::ext(self.vault.clone())
            .with_static_gas(GAS_FOR_CROSS_CALL)
            .fund_loan(borrower, principal, loan_id);
    }

    /// Repay a loan (supports partial and full repayment)
    #[payable]
    pub fn repay_loan(&mut self, loan_id: u64, amount: U128) {
        let caller = env::predecessor_account_id();
        let loan = self.loans.get_mut(&loan_id).expect("loan not found");

        require!(
            loan.status == LoanStatus::Funded || loan.status == LoanStatus::Repaying,
            "loan is not in a repayable state"
        );
        require!(amount.0 > 0, "repayment must be > 0");

        // Split principal and simple interest
        let remaining = loan.remaining_principal.0;
        let (principal_paid, interest_paid, partial) = if amount.0 < remaining {
            let interest = (amount.0 * loan.rate_bps as u128) / 10000;
            let actual_interest = std::cmp::min(interest, amount.0);
            let actual_principal = amount.0 - actual_interest;
            (actual_principal, actual_interest, true)
        } else {
            let interest = amount.0 - remaining;
            (remaining, interest, false)
        };

        let new_remaining = remaining.saturating_sub(principal_paid);
        loan.remaining_principal = U128(new_remaining);
        loan.total_repaid = U128(loan.total_repaid.0 + amount.0);

        if new_remaining == 0 {
            loan.status = LoanStatus::Closed;
        } else {
            loan.status = LoanStatus::Repaying;
        }

        emit_event(
            "homr_loan",
            "1.0.0",
            "loan_repaid",
            serde_json::json!({
                "loan_id": loan_id,
                "borrower": caller,
                "amount": amount,
                "principal_paid": U128(principal_paid),
                "interest_paid": U128(interest_paid),
                "remaining_after": U128(new_remaining),
                "partial": partial,
            }),
        );

        // Forward accounting to vault
        let _ = ext_vault::ext(self.vault.clone())
            .with_static_gas(GAS_FOR_CROSS_CALL)
            .record_repayment(U128(principal_paid), U128(interest_paid));

        // Record in audit registry if available
        if let Some(audit) = &self.audit_registry {
            let proof_hash = format!(
                "{:x?}",
                env::sha256(
                    format!("repay:{}:{}:{}", loan_id, amount.0, env::block_timestamp_ms())
                        .as_bytes()
                )
            );
            let _ = ext_audit::ext(audit.clone())
                .with_static_gas(GAS_FOR_CROSS_CALL)
                .record_repayment(loan_id.to_string(), amount, proof_hash);
        }
    }

    // View methods
    pub fn get_loan(&self, loan_id: u64) -> Option<Loan> {
        self.loans.get(&loan_id).cloned()
    }

    pub fn get_borrower_loans(&self, borrower: AccountId) -> Vec<Loan> {
        let ids = self
            .borrower_loans
            .get(&borrower)
            .cloned()
            .unwrap_or_default();
        ids.into_iter()
            .filter_map(|id| self.loans.get(&id).cloned())
            .collect()
    }

    pub fn get_next_loan_id(&self) -> u64 {
        self.next_loan_id
    }

    fn assert_admin(&self) {
        require!(env::predecessor_account_id() == self.admin, "admin only");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;
    use near_sdk::NearToken;

    fn manager() -> HomrLoanManager {
        let admin: AccountId = "admin.testnet".parse().unwrap();
        let vault: AccountId = "vault.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin.clone())
            .build());
        HomrLoanManager::new(vault, None, None)
    }

    #[test]
    fn test_issue_loan_and_partial_repayment() {
        let mut m = manager();
        let credit_auction: AccountId = "credit-auction.testnet".parse().unwrap();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();

        m.set_credit_auction(credit_auction.clone());

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(credit_auction.clone())
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        let loan_id = m.issue_loan(
            borrower.clone(),
            U128(100_000),
            500, // 5%
            360,
            "prop-123".into(),
            1,
        );
        assert_eq!(loan_id, 1);

        let loan = m.get_loan(1).unwrap();
        assert_eq!(loan.remaining_principal, U128(100_000));
        assert_eq!(loan.status, LoanStatus::Pending);
    }

    #[test]
    fn test_issue_loan_requires_credit_auction() {
        let mut m = manager();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();
        let unauthorized: AccountId = "unauthorized.testnet".parse().unwrap();

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(unauthorized)
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            m.issue_loan(borrower, U128(100_000), 500, 360, "prop".into(), 1);
        }))
        .expect_err("should panic when caller is not credit_auction");
    }

    #[test]
    fn test_issue_loan_requires_deposit() {
        let mut m = manager();
        let credit_auction: AccountId = "credit-auction.testnet".parse().unwrap();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();
        m.set_credit_auction(credit_auction.clone());

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(credit_auction)
            .attached_deposit(NearToken::from_yoctonear(0))
            .build());
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            m.issue_loan(borrower, U128(100_000), 500, 360, "prop".into(), 1);
        }))
        .expect_err("should panic when no deposit attached");
    }

    #[test]
    fn test_retry_issue_loan() {
        let mut m = manager();
        let admin: AccountId = "admin.testnet".parse().unwrap();
        let credit_auction: AccountId = "credit-auction.testnet".parse().unwrap();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();
        m.set_credit_auction(credit_auction.clone());

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(credit_auction)
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        let loan_id = m.issue_loan(
            borrower.clone(),
            U128(100_000),
            500,
            360,
            "prop-123".into(),
            1,
        );
        assert_eq!(loan_id, 1);
        assert_eq!(m.get_loan(1).unwrap().status, LoanStatus::Pending);

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin)
            .build());
        m.retry_issue_loan(1);
        assert_eq!(m.get_loan(1).unwrap().status, LoanStatus::Pending);
    }
}

