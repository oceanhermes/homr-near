# HOMR Native NEAR Registry

This contract is the hackathon-native NEAR integration. It does not pretend that the existing Solidity vault is a NEAR contract. The existing EVM flow remains the baseline; this registry anchors auction, loan, and repayment proof hashes on NEAR Testnet.

## Network

- Network ID: `testnet`
- RPC: `https://archival-rpc.testnet.near.org`
- Account format: `your-account.testnet`
- There is no EVM chain ID for native NEAR.

## Build and deploy

```powershell
cargo install cargo-near
cargo near build
near contract deploy <registry-account>.testnet use-file target/near/homr_near_registry.wasm without-init-call network-config testnet sign-with-keychain send
near contract call-function as-transaction <registry-account>.testnet new json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-with-keychain send network-config testnet
```

After deployment, put the account ID in `VITE_NEAR_CONTRACT_ID` and `NEAR_CONTRACT_ID`. The contract stores proof metadata only; it does not custody stablecoins or claim that simulated borrower data is real underwriting.

The operator registers each auction and loan once with `register_auction` and `register_loan`, then records principal repayments with `record_repayment`. View methods `get_auction`, `get_loan`, and `get_repayments` expose the original proof hash and each repayment hash. IDs must match the IDs entered in the demo proof lookup. Registration is an explicit operator transaction; EVM events are not automatically mirrored to NEAR. Record the deployed account and transaction IDs in `DEPLOY_NOTES.md` before describing any proof as live.

## Prepare proof arguments

From `backend/`, run `npm run proof:prepare -- 0x<evm-transaction-hash>`. The command reads `deployments.json`, checks the RPC chain ID and successful transaction receipt, and prints JSON actions for the NEAR operator to review. It never signs or submits a transaction. For a finalized auction receipt it prepares `register_auction` and any `register_loan` calls; for a repayment receipt it prepares `record_repayment`. The `args` object can be passed as JSON arguments to the corresponding NEAR contract method after review.

Capital and repayment amounts use decimal strings in NEAR JSON arguments and view results so 128-bit values remain exact. Use the generated `loan_id` or `auction_id` to inspect the entry on the walletless demo page after the NEAR transaction succeeds.

The proof hash is the EVM transaction hash. IDs include the EVM chain ID and contract address so repeated local loan numbers do not collide. `borrower_hash` is a deterministic hash of a public EVM address, not a privacy guarantee or KYC proof. Repayment records anchor principal only; the output's `evidence.evm_amount` preserves the full EVM event amount for review when it includes extra tokens.
