use homr_common::{emit_event, hash_commitment};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas,
    NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

const STORAGE_COMMIT_DEPOSIT: NearToken = NearToken::from_millinear(10); // 0.01 NEAR
const GAS_FOR_ISSUE_LOAN: Gas = Gas::from_tgas(30);

#[ext_contract(ext_loan_manager)]
pub trait LoanManagerContract {
    fn issue_loan(
        &mut self,
        borrower: AccountId,
        principal: U128,
        rate_bps: u32,
        term_days: u32,
        property_hash: String,
        auction_id: u64,
    ) -> u64;
}

#[ext_contract(ext_self)]
pub trait AuctionCallbacks {
    fn resolve_issue_loan(&mut self, auction_id: u64) -> Option<RevealedBid>;
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuctionState {
    Draft,
    Open,
    Commit,
    Reveal,
    Finalized,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BorrowerApproval {
    pub is_approved: bool,
    pub max_principal: U128,
    pub property_hash: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RevealedBid {
    pub borrower: AccountId,
    pub amount: U128,
    pub rate_bps: u32,
    pub term_days: u32,
    pub salt: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Auction {
    pub id: u64,
    pub commit_deadline: u64,
    pub reveal_deadline: u64,
    pub state: AuctionState,
    pub best_bid: Option<RevealedBid>,
    pub created_at: u64,
}

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Auctions,
    Approvals,
    Commitments,
    RevealedBids,
    RevealedBorrowers,
    CommitDeposits,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct HomrCreditAuction {
    pub admin: AccountId,
    pub credit_manager: AccountId,
    pub auction_manager: AccountId,
    pub loan_manager: Option<AccountId>,
    pub next_auction_id: u64,

    pub auctions: LookupMap<u64, Auction>,
    pub approvals: LookupMap<AccountId, BorrowerApproval>,
    pub commitments: LookupMap<(u64, AccountId), String>,
    pub revealed_bids: LookupMap<(u64, AccountId), RevealedBid>,
    pub revealed_borrowers_per_auction: LookupMap<u64, Vec<AccountId>>,
    pub commit_deposits: LookupMap<(u64, AccountId), NearToken>,
}

#[near]
impl HomrCreditAuction {
    #[init]
    pub fn new(
        credit_manager: Option<AccountId>,
        auction_manager: Option<AccountId>,
        loan_manager: Option<AccountId>,
    ) -> Self {
        let caller = env::predecessor_account_id();
        Self {
            admin: caller.clone(),
            credit_manager: credit_manager.unwrap_or_else(|| caller.clone()),
            auction_manager: auction_manager.unwrap_or_else(|| caller.clone()),
            loan_manager,
            next_auction_id: 1,
            auctions: LookupMap::new(StorageKey::Auctions),
            approvals: LookupMap::new(StorageKey::Approvals),
            commitments: LookupMap::new(StorageKey::Commitments),
            revealed_bids: LookupMap::new(StorageKey::RevealedBids),
            revealed_borrowers_per_auction: LookupMap::new(StorageKey::RevealedBorrowers),
            commit_deposits: LookupMap::new(StorageKey::CommitDeposits),
        }
    }

    pub fn set_loan_manager(&mut self, loan_manager: AccountId) {
        self.assert_admin();
        self.loan_manager = Some(loan_manager);
    }

    pub fn approve_borrower(
        &mut self,
        borrower: AccountId,
        max_principal: U128,
        property_hash: String,
    ) {
        self.assert_credit_manager();
        require!(max_principal.0 > 0, "max_principal must be positive");
        require!(!property_hash.is_empty(), "property_hash is required");

        let approval = BorrowerApproval {
            is_approved: true,
            max_principal,
            property_hash: property_hash.clone(),
        };
        self.approvals.insert(borrower.clone(), approval);

        emit_event(
            "homr_auction",
            "1.0.0",
            "borrower_approved",
            serde_json::json!({
                "borrower": borrower,
                "max_principal": max_principal,
                "property_hash": property_hash,
            }),
        );
    }

    pub fn create_auction(&mut self, commit_duration_ms: u64, reveal_duration_ms: u64) -> u64 {
        self.assert_auction_manager();
        require!(commit_duration_ms > 0, "commit duration must be > 0");
        require!(reveal_duration_ms > 0, "reveal duration must be > 0");

        let now = env::block_timestamp_ms();
        let commit_deadline = now + commit_duration_ms;
        let reveal_deadline = commit_deadline + reveal_duration_ms;

        let auction_id = self.next_auction_id;
        self.next_auction_id += 1;

        let auction = Auction {
            id: auction_id,
            commit_deadline,
            reveal_deadline,
            state: AuctionState::Draft,
            best_bid: None,
            created_at: now,
        };
        self.auctions.insert(auction_id, auction);

        emit_event(
            "homr_auction",
            "1.0.0",
            "auction_created",
            serde_json::json!({
                "auction_id": auction_id,
                "commit_deadline": commit_deadline,
                "reveal_deadline": reveal_deadline,
            }),
        );

        auction_id
    }

    /// Transition from Draft -> Open
    pub fn open_auction(&mut self, auction_id: u64) {
        self.assert_auction_manager();
        let auction = self.auctions.get_mut(&auction_id).expect("auction not found");
        require!(auction.state == AuctionState::Draft, "auction not in Draft state");
        auction.state = AuctionState::Open;

        emit_event(
            "homr_auction",
            "1.0.0",
            "auction_opened",
            serde_json::json!({ "auction_id": auction_id }),
        );
    }

    /// Transition from Open -> Commit (starts commit phase)
    pub fn start_commit_phase(&mut self, auction_id: u64) {
        self.assert_auction_manager();
        let auction = self.auctions.get_mut(&auction_id).expect("auction not found");
        require!(auction.state == AuctionState::Open, "auction not in Open state");
        auction.state = AuctionState::Commit;

        emit_event(
            "homr_auction",
            "1.0.0",
            "commit_phase_started",
            serde_json::json!({
                "auction_id": auction_id,
                "commit_deadline": auction.commit_deadline,
            }),
        );
    }

    #[payable]
    pub fn commit_bid(&mut self, auction_id: u64, commitment: String) {
        let deposit = env::attached_deposit();
        require!(deposit >= STORAGE_COMMIT_DEPOSIT, "deposit must be >= 0.01 NEAR");

        let caller = env::predecessor_account_id();
        let now = env::block_timestamp_ms();

        let auction = self.auctions.get_mut(&auction_id).expect("auction not found");
        require!(auction.state == AuctionState::Commit, "not in commit phase");
        require!(now <= auction.commit_deadline, "commit deadline passed");

        let approval = self.approvals.get(&caller).expect("borrower not approved");
        require!(approval.is_approved, "borrower is not approved");

        let key = (auction_id, caller.clone());
        require!(
            !self.commitments.contains_key(&key),
            "bid already committed for this auction"
        );
        require!(!commitment.is_empty(), "commitment required");

        self.commitments.insert(key.clone(), commitment.clone());
        self.commit_deposits.insert(key, deposit);

        emit_event(
            "homr_auction",
            "1.0.0",
            "bid_committed",
            serde_json::json!({
                "auction_id": auction_id,
                "borrower": caller,
                "commitment": commitment,
                "deposit": deposit,
            }),
        );
    }

    pub fn reveal_bid(
        &mut self,
        auction_id: u64,
        amount: U128,
        rate_bps: u32,
        term_days: u32,
        salt: String,
    ) -> Promise {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp_ms();

        let auction = self.auctions.get_mut(&auction_id).expect("auction not found");

        // Auto-transition Commit -> Reveal if deadline passed
        if auction.state == AuctionState::Commit && now > auction.commit_deadline {
            auction.state = AuctionState::Reveal;
        }

        require!(
            auction.state == AuctionState::Reveal || now > auction.commit_deadline,
            "reveal phase not started"
        );
        require!(now <= auction.reveal_deadline, "reveal deadline passed");

        let key = (auction_id, caller.clone());
        let expected_hash = self.commitments.get(&key).expect("no commitment found");
        require!(
            !self.revealed_bids.contains_key(&key),
            "bid already revealed"
        );

        let calculated_hash = hash_commitment(amount.0, rate_bps, term_days, &salt, &caller);
        require!(
            calculated_hash == *expected_hash,
            "reveal hash does not match commitment"
        );

        let approval = self.approvals.get(&caller).expect("approval not found");
        require!(
            amount.0 <= approval.max_principal.0,
            "amount exceeds approved limit"
        );
        require!(amount.0 > 0, "amount must be > 0");
        require!(term_days > 0, "term must be > 0");

        let bid = RevealedBid {
            borrower: caller.clone(),
            amount,
            rate_bps,
            term_days,
            salt,
        };
        self.revealed_bids.insert(key.clone(), bid.clone());

        let mut borrowers = self
            .revealed_borrowers_per_auction
            .get(&auction_id)
            .cloned()
            .unwrap_or_default();
        borrowers.push(caller.clone());
        self.revealed_borrowers_per_auction.insert(auction_id, borrowers);

        // Refund commit deposit O(1) - no loop
        let deposit = self.commit_deposits.remove(&key).unwrap_or(NearToken::from_yoctonear(0));
        let refund_promise = if deposit.as_yoctonear() > 0 {
            Promise::new(caller.clone()).transfer(deposit)
        } else {
            Promise::new(env::current_account_id())
        };

        emit_event(
            "homr_auction",
            "1.0.0",
            "bid_revealed",
            serde_json::json!({
                "auction_id": auction_id,
                "borrower": caller,
                "amount": amount,
                "rate_bps": rate_bps,
                "term_days": term_days,
            }),
        );

        refund_promise
    }

    pub fn finalize_auction(&mut self, auction_id: u64) -> PromiseOrValue<Option<RevealedBid>> {
        self.assert_auction_manager();
        let now = env::block_timestamp_ms();

        let auction = self.auctions.get_mut(&auction_id).expect("auction not found");
        require!(
            auction.state != AuctionState::Draft && auction.state != AuctionState::Open,
            "auction not started"
        );
        require!(
            auction.state != AuctionState::Finalized && auction.state != AuctionState::Cancelled,
            "auction already finalized or cancelled"
        );
        require!(now > auction.reveal_deadline, "reveal phase not ended");

        // Find best bid (highest rate_bps)
        let borrowers = self
            .revealed_borrowers_per_auction
            .get(&auction_id)
            .cloned()
            .unwrap_or_default();

        let mut best: Option<RevealedBid> = None;
        for borrower in borrowers {
            if let Some(bid) = self.revealed_bids.get(&(auction_id, borrower)) {
                if let Some(current_best) = &best {
                    if bid.rate_bps > current_best.rate_bps {
                        best = Some(bid.clone());
                    }
                } else {
                    best = Some(bid.clone());
                }
            }
        }

        auction.state = AuctionState::Finalized;
        auction.best_bid = best.clone();

        emit_event(
            "homr_auction",
            "1.0.0",
            "auction_finalized",
            serde_json::json!({
                "auction_id": auction_id,
                "winner": best.as_ref().map(|b| b.borrower.to_string()),
                "amount": best.as_ref().map(|b| b.amount),
                "rate_bps": best.as_ref().map(|b| b.rate_bps),
            }),
        );

        // A1: Cross-contract call to loan_manager.issue_loan with full bid payload
        if let Some(best_bid) = &best {
            if let Some(loan_manager_id) = &self.loan_manager {
                let property_hash = self
                    .approvals
                    .get(&best_bid.borrower)
                    .map(|a| a.property_hash.clone())
                    .unwrap_or_default();

                return ext_loan_manager::ext(loan_manager_id.clone())
                    .with_static_gas(GAS_FOR_ISSUE_LOAN)
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .issue_loan(
                        best_bid.borrower.clone(),
                        best_bid.amount,
                        best_bid.rate_bps,
                        best_bid.term_days,
                        property_hash,
                        auction_id,
                    )
                    .then(
                        ext_self::ext(env::current_account_id())
                            .with_static_gas(Gas::from_tgas(10))
                            .resolve_issue_loan(auction_id),
                    )
                    .into();
            }
        }

        PromiseOrValue::Value(best)
    }

    #[private]
    pub fn resolve_issue_loan(&mut self, auction_id: u64) -> Option<RevealedBid> {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "private callback"
        );

        let auction = self.auctions.get(&auction_id).expect("auction not found");
        auction.best_bid.clone()
    }

    /// Emergency cancel by admin (Draft/Open/Commit/Reveal -> Cancelled)
    pub fn cancel_auction(&mut self, auction_id: u64) {
        self.assert_admin();
        let auction = self.auctions.get_mut(&auction_id).expect("auction not found");
        require!(
            auction.state != AuctionState::Finalized && auction.state != AuctionState::Cancelled,
            "cannot cancel finalized or cancelled auction"
        );
        auction.state = AuctionState::Cancelled;

        emit_event(
            "homr_auction",
            "1.0.0",
            "auction_cancelled",
            serde_json::json!({ "auction_id": auction_id }),
        );
    }

    // View methods
    pub fn get_auction(&self, auction_id: u64) -> Option<Auction> {
        self.auctions.get(&auction_id).cloned()
    }

    pub fn get_borrower_approval(&self, borrower: AccountId) -> Option<BorrowerApproval> {
        self.approvals.get(&borrower).cloned()
    }

    pub fn get_commitment(&self, auction_id: u64, borrower: AccountId) -> Option<String> {
        self.commitments.get(&(auction_id, borrower)).cloned()
    }

    pub fn get_revealed_bid(&self, auction_id: u64, borrower: AccountId) -> Option<RevealedBid> {
        self.revealed_bids.get(&(auction_id, borrower)).cloned()
    }

    pub fn get_next_auction_id(&self) -> u64 {
        self.next_auction_id
    }

    pub fn get_commit_deposit(&self, auction_id: u64, borrower: AccountId) -> Option<NearToken> {
        self.commit_deposits.get(&(auction_id, borrower)).cloned()
    }

    fn assert_admin(&self) {
        require!(
            env::predecessor_account_id() == self.admin,
            "admin only"
        );
    }

    fn assert_credit_manager(&self) {
        require!(
            env::predecessor_account_id() == self.credit_manager
                || env::predecessor_account_id() == self.admin,
            "credit manager only"
        );
    }

    fn assert_auction_manager(&self) {
        require!(
            env::predecessor_account_id() == self.auction_manager
                || env::predecessor_account_id() == self.admin,
            "auction manager only"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;
    use near_sdk::NearToken;

    fn contract() -> HomrCreditAuction {
        let admin: AccountId = "admin.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin.clone())
            .build());
        HomrCreditAuction::new(None, None, None)
    }

    #[test]
    fn test_state_machine_draft_to_finalized() {
        let mut c = contract();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();

        // Approve borrower
        c.approve_borrower(borrower.clone(), U128(100_000), "prop-hash-1".into());

        // Create auction (Draft)
        let auction_id = c.create_auction(10_000, 10_000);
        assert_eq!(c.get_auction(auction_id).unwrap().state, AuctionState::Draft);

        // Open auction (Draft -> Open)
        c.open_auction(auction_id);
        assert_eq!(c.get_auction(auction_id).unwrap().state, AuctionState::Open);

        // Start commit phase (Open -> Commit)
        c.start_commit_phase(auction_id);
        assert_eq!(c.get_auction(auction_id).unwrap().state, AuctionState::Commit);

        // Commit bid with 0.01 NEAR deposit
        let salt = "my_secret_salt";
        let amount = 50_000u128;
        let rate_bps = 750u32;
        let term_days = 365u32;
        let hash = hash_commitment(amount, rate_bps, term_days, salt, &borrower);

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .attached_deposit(STORAGE_COMMIT_DEPOSIT)
            .block_timestamp(1_000_000_000)
            .build());
        c.commit_bid(auction_id, hash.clone());
        assert_eq!(c.get_commitment(auction_id, borrower.clone()).unwrap(), hash);
        assert_eq!(c.get_commit_deposit(auction_id, borrower.clone()).unwrap(), STORAGE_COMMIT_DEPOSIT);

        // Reveal bid (Commit -> Reveal auto-transition) - deposit refunded
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .block_timestamp(15_000_000_000)
            .build());
        let refund_promise = c.reveal_bid(auction_id, U128(amount), rate_bps, term_days, salt.into());
        // Note: In unit tests, promises don't execute, but we can verify state
        let bid = c.get_revealed_bid(auction_id, borrower.clone()).unwrap();
        assert_eq!(bid.amount, U128(amount));
        assert_eq!(bid.rate_bps, rate_bps);
        // Deposit should be removed after reveal
        assert!(c.get_commit_deposit(auction_id, borrower.clone()).is_none());

        // Finalize auction (Reveal -> Finalized)
        let admin: AccountId = "admin.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin)
            .block_timestamp(30_000_000_000)
            .build());
        let result = c.finalize_auction(auction_id);
        assert!(matches!(result, PromiseOrValue::Value(Some(_))));
        let winner = match result {
    near_sdk::PromiseOrValue::Value(v) => v.unwrap(),
    near_sdk::PromiseOrValue::Promise(_) => panic!("Expected Value, got Promise"),
};
        assert_eq!(winner.borrower, borrower);
        assert_eq!(winner.rate_bps, rate_bps);

        let final_auction = c.get_auction(auction_id).unwrap();
        assert_eq!(final_auction.state, AuctionState::Finalized);
    }

    #[test]
    fn test_commit_bid_requires_deposit() {
        let mut c = contract();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();
        c.approve_borrower(borrower.clone(), U128(100_000), "prop".into());
        let auction_id = c.create_auction(10_000, 10_000);
        c.open_auction(auction_id);
        c.start_commit_phase(auction_id);

        let hash = hash_commitment(100, 500, 30, "s", &borrower);

        // Should panic with insufficient deposit (1 yocto < 0.01 NEAR)
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .attached_deposit(NearToken::from_yoctonear(1))
            .block_timestamp(1_000)
            .build());
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.commit_bid(auction_id, hash.clone());
        })).expect_err("should panic on insufficient deposit");
    }

    #[test]
    fn test_reveal_refunds_deposit() {
        let mut c = contract();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();
        c.approve_borrower(borrower.clone(), U128(100_000), "prop".into());
        let auction_id = c.create_auction(10_000, 10_000);
        c.open_auction(auction_id);
        c.start_commit_phase(auction_id);

        let hash = hash_commitment(100, 500, 30, "s", &borrower);
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .attached_deposit(STORAGE_COMMIT_DEPOSIT)
            .block_timestamp(1_000_000_000)
            .build());
        c.commit_bid(auction_id, hash);

        // Deposit stored
        assert_eq!(c.get_commit_deposit(auction_id, borrower.clone()).unwrap(), STORAGE_COMMIT_DEPOSIT);

        // Reveal - deposit should be refunded (removed from storage)
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .block_timestamp(15_000_000_000)
            .build());
        c.reveal_bid(auction_id, U128(100), 500, 30, "s".into());

        assert!(c.get_commit_deposit(auction_id, borrower.clone()).is_none());
    }

    #[test]
    fn test_cancel_auction() {
        let mut c = contract();
        let auction_id = c.create_auction(10_000, 10_000);
        c.open_auction(auction_id);

        let admin: AccountId = "admin.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin)
            .build());
        c.cancel_auction(auction_id);
        assert_eq!(c.get_auction(auction_id).unwrap().state, AuctionState::Cancelled);
    }

    #[test]
    #[should_panic(expected = "cannot cancel finalized")]
    fn test_cannot_cancel_finalized() {
        let mut c = contract();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();
        c.approve_borrower(borrower.clone(), U128(100_000), "prop".into());
        let auction_id = c.create_auction(10_000, 10_000);
        c.open_auction(auction_id);
        c.start_commit_phase(auction_id);

        let hash = hash_commitment(100, 500, 30, "s", &borrower);
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .attached_deposit(STORAGE_COMMIT_DEPOSIT)
            .block_timestamp(1_000_000_000)
            .build());
        c.commit_bid(auction_id, hash);

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .block_timestamp(15_000_000_000)
            .build());
        c.reveal_bid(auction_id, U128(100), 500, 30, "s".into());

        let admin: AccountId = "admin.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin.clone())
            .block_timestamp(30_000_000_000)
            .build());
        c.finalize_auction(auction_id);

        // Try to cancel finalized - should panic
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin.clone())
            .build());
        c.cancel_auction(auction_id);
    }

    #[test]
    fn test_finalize_with_no_reveals() {
        let mut c = contract();
        let auction_id = c.create_auction(10_000, 10_000);
        c.open_auction(auction_id);
        c.start_commit_phase(auction_id);

        let admin: AccountId = "admin.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin)
            .block_timestamp(30_000_000_000)
            .build());
        let result = c.finalize_auction(auction_id);
        assert!(matches!(result, PromiseOrValue::Value(None)));
        assert_eq!(c.get_auction(auction_id).unwrap().state, AuctionState::Finalized);
    }
}

