use homr_common::{emit_event, hash_commitment};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, PanicOnDefault,
};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuctionPhase {
    Created,
    CommitPhase,
    RevealPhase,
    Finalized,
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
    pub phase: AuctionPhase,
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

    pub fn start_auction(&mut self, commit_duration_ms: u64, reveal_duration_ms: u64) -> u64 {
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
            phase: AuctionPhase::CommitPhase,
            best_bid: None,
            created_at: now,
        };
        self.auctions.insert(auction_id, auction);

        emit_event(
            "homr_auction",
            "1.0.0",
            "auction_started",
            serde_json::json!({
                "auction_id": auction_id,
                "commit_deadline": commit_deadline,
                "reveal_deadline": reveal_deadline,
            }),
        );

        auction_id
    }

    #[payable]
    pub fn commit_bid(&mut self, auction_id: u64, commitment: String) {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp_ms();

        let auction = self
            .auctions
            .get_mut(&auction_id)
            .expect("auction not found");
        require!(
            auction.phase == AuctionPhase::CommitPhase,
            "not in commit phase"
        );
        require!(now <= auction.commit_deadline, "commit deadline passed");

        let approval = self.approvals.get(&caller).expect("borrower not approved");
        require!(approval.is_approved, "borrower is not approved");

        let key = (auction_id, caller.clone());
        require!(
            !self.commitments.contains_key(&key),
            "bid already committed for this auction"
        );
        require!(!commitment.is_empty(), "commitment required");

        self.commitments.insert(key, commitment.clone());

        emit_event(
            "homr_auction",
            "1.0.0",
            "bid_committed",
            serde_json::json!({
                "auction_id": auction_id,
                "borrower": caller,
                "commitment": commitment,
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
    ) {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp_ms();

        let auction = self
            .auctions
            .get_mut(&auction_id)
            .expect("auction not found");

        if auction.phase == AuctionPhase::CommitPhase && now > auction.commit_deadline {
            auction.phase = AuctionPhase::RevealPhase;
        }

        require!(
            auction.phase == AuctionPhase::RevealPhase || now > auction.commit_deadline,
            "reveal phase not started"
        );
        require!(now <= auction.reveal_deadline, "reveal deadline passed");

        let key = (auction_id, caller.clone());
        let expected_hash = self.commitments.get(&key).expect("no commitment found");
        require!(
            !self.revealed_bids.contains_key(&key),
            "bid already revealed"
        );

        let calculated_hash =
            hash_commitment(amount.0, rate_bps, term_days, &salt, &caller);
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
        self.revealed_bids.insert(key, bid.clone());

        let mut borrowers = self
            .revealed_borrowers_per_auction
            .get(&auction_id)
            .cloned()
            .unwrap_or_default();
        borrowers.push(caller.clone());
        self.revealed_borrowers_per_auction
            .insert(auction_id, borrowers);

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
    }

    pub fn finalize_auction(&mut self, auction_id: u64) -> Option<RevealedBid> {
        self.assert_auction_manager();
        let now = env::block_timestamp_ms();

        let auction = self
            .auctions
            .get_mut(&auction_id)
            .expect("auction not found");
        require!(
            auction.phase != AuctionPhase::Created,
            "auction not started"
        );
        require!(
            auction.phase != AuctionPhase::Finalized,
            "auction already finalized"
        );
        require!(now > auction.reveal_deadline, "reveal phase not ended");

        auction.phase = AuctionPhase::Finalized;

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

        best
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
    fn test_happy_path_auction() {
        let mut c = contract();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();

        // 1. Approve borrower
        c.approve_borrower(borrower.clone(), U128(100_000), "prop-hash-1".into());
        assert!(c.get_borrower_approval(borrower.clone()).unwrap().is_approved);

        // 2. Start auction (commit: 10s, reveal: 10s)
        let auction_id = c.start_auction(10_000, 10_000);
        assert_eq!(auction_id, 1);

        // 3. Commit bid (with 1 yocto)
        let salt = "my_secret_salt";
        let amount = 50_000u128;
        let rate_bps = 750u32; // 7.5%
        let term_days = 365u32;
        let hash = hash_commitment(amount, rate_bps, term_days, salt, &borrower);

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .attached_deposit(NearToken::from_yoctonear(1))
            .block_timestamp(1_000_000)
            .build());
        c.commit_bid(auction_id, hash.clone());
        assert_eq!(c.get_commitment(auction_id, borrower.clone()).unwrap(), hash);

        // 4. Reveal bid (time advances into reveal phase)
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .block_timestamp(11_000_000) // after 10s
            .build());
        c.reveal_bid(auction_id, U128(amount), rate_bps, term_days, salt.into());
        let bid = c.get_revealed_bid(auction_id, borrower.clone()).unwrap();
        assert_eq!(bid.amount, U128(amount));
        assert_eq!(bid.rate_bps, rate_bps);

        // 5. Finalize auction (time advances past reveal deadline)
        let admin: AccountId = "admin.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin)
            .block_timestamp(21_000_000) // after 20s
            .build());
        let winner = c.finalize_auction(auction_id).unwrap();
        assert_eq!(winner.borrower, borrower);
        assert_eq!(winner.rate_bps, rate_bps);

        let final_auction = c.get_auction(auction_id).unwrap();
        assert_eq!(final_auction.phase, AuctionPhase::Finalized);
    }

    #[test]
    #[should_panic(expected = "bid already committed")]
    fn test_double_commit_rejected() {
        let mut c = contract();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();
        c.approve_borrower(borrower.clone(), U128(100_000), "prop".into());
        let auction_id = c.start_auction(10_000, 10_000);

        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .attached_deposit(NearToken::from_yoctonear(1))
            .block_timestamp(1_000)
            .build());
        c.commit_bid(auction_id, "hash1".into());
        c.commit_bid(auction_id, "hash2".into());
    }

    #[test]
    #[should_panic(expected = "reveal phase not started")]
    fn test_reveal_before_commit_deadline_rejected() {
        let mut c = contract();
        let borrower: AccountId = "borrower.testnet".parse().unwrap();
        c.approve_borrower(borrower.clone(), U128(100_000), "prop".into());
        let auction_id = c.start_auction(10_000, 10_000);

        let hash = hash_commitment(100, 500, 30, "s", &borrower);
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(borrower.clone())
            .attached_deposit(NearToken::from_yoctonear(1))
            .block_timestamp(1_000)
            .build());
        c.commit_bid(auction_id, hash);

        // Still at timestamp 1_000 (commit phase is 10_000)
        c.reveal_bid(auction_id, U128(100), 500, 30, "s".into());
    }

    #[test]
    fn test_finalize_with_no_reveals() {
        let mut c = contract();
        let auction_id = c.start_auction(10_000, 10_000);

        let admin: AccountId = "admin.testnet".parse().unwrap();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(admin)
            .block_timestamp(25_000_000)
            .build());
        let result = c.finalize_auction(auction_id);
        assert!(result.is_none());
        assert_eq!(c.get_auction(auction_id).unwrap().phase, AuctionPhase::Finalized);
    }
}

