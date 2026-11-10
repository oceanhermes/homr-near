use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId};
use serde::{Deserialize, Serialize};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuctionProof {
    pub auction_id: String,
    pub source_chain: String,
    pub proof_hash: String,
    pub total_capital: U128,
    pub recorded_by: AccountId,
    pub recorded_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
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
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepaymentProof {
    pub amount: U128,
    pub proof_hash: String,
    pub recorded_by: AccountId,
    pub recorded_at: u64,
}

/// NEP-297 compliant event emission
pub fn emit_event(standard: &str, version: &str, event: &str, data: serde_json::Value) {
    let payload = serde_json::json!({
        "standard": standard,
        "version": version,
        "event": event,
        "data": data,
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

/// Helper to compute commitment hash for credit auction
/// sha256(amount || rate_bps || term_days || salt || account_id)
pub fn hash_commitment(
    amount: u128,
    rate_bps: u32,
    term_days: u32,
    salt: &str,
    account_id: &AccountId,
) -> String {
    let mut preimage = Vec::new();
    preimage.extend_from_slice(&amount.to_be_bytes());
    preimage.extend_from_slice(&rate_bps.to_be_bytes());
    preimage.extend_from_slice(&term_days.to_be_bytes());
    preimage.extend_from_slice(salt.as_bytes());
    preimage.extend_from_slice(account_id.as_bytes());
    let hash = env::sha256(&preimage);
    hex::encode(hash)
}

