# HOMR

HOMR is an Indonesia-focused housing-credit prototype. Investors deposit test stablecoins into a vault, approved borrowers compete for limited capital through a commit-reveal auction, and the resulting loan and repayment events remain observable onchain.

## What changed for NEAR HACKATHON

HOMR started as an EVM prototype deployed on BNB Chain Testnet. The hackathon integration adds a native NEAR registry contract for auction, loan, and repayment proof hashes. Deployment to NEAR Testnet is pending a team-controlled account. The existing Solidity vault is not a NEAR contract.

Native NEAR uses `testnet`/`mainnet` network IDs and NEAR account IDs. It does not use an EVM chain ID. The Solidity flow remains the disclosed baseline; the native NEAR registry is the new hackathon deliverable.

## Judge path

1. Open the hosted frontend or run it locally.
2. Select `View the walletless demo` to see the complete deposit, approval, commit, reveal, allocation, and repayment narrative without a wallet.
3. Once deployed, inspect the native NEAR registry account and its view methods on NEAR Testnet. The walletless demo includes a proof lookup that reports when deployment is pending.
4. Use the walletless demo for the full product narrative.
5. If the EVM baseline is enabled, use its existing faucet and dashboard separately.
6. After deployment, review the NEAR account and transaction IDs recorded in `DEPLOY_NOTES.md`.

The walletless page is explicitly labelled `SIMULATED DEMO`. It does not imply that funds moved or that a real borrower was underwritten.

## Local setup

### Frontend

```sh
cd frontend
npm install
copy .env.example .env
npm run dev
```

The native NEAR registry uses:

```env
VITE_NEAR_NETWORK_ID=testnet
VITE_NEAR_RPC_URL=https://archival-rpc.testnet.near.org
VITE_NEAR_CONTRACT_ID=registry-account.testnet
```

The existing EVM baseline keeps its own `VITE_*_ADDRESS` values and is not the native NEAR contract.

### Native NEAR contract

```sh
cd near
cargo check --target wasm32-unknown-unknown
```

See [`near/README.md`](near/README.md) for the `cargo near build` and NEAR CLI deployment flow. Deployment requires a funded NEAR Testnet account and is intentionally not performed automatically.

After an EVM auction or repayment transaction, `cd backend` and run `npm run proof:prepare -- <transaction-hash>` to produce reviewable NEAR registry call arguments from its confirmed receipt. The command is read only and does not submit the NEAR call.

### Smart contracts

```sh
cd backend
npm install
npm test
npm run compile
```

The Solidity baseline can still be deployed only after the team has funded and approved the intended EVM testnet wallet:

```sh
npm run deploy:bnb
```

The deployment script writes `DEPLOY_NOTES.md` and `deployments.json`. Do not commit private keys or `.env` files.

### API

```sh
cd api
npm install
copy .env.example .env
npm run build
npm run dev
```

The API requires a database URL, the baseline EVM contract addresses, an admin key, and `DEPLOY_BLOCK`. Native NEAR configuration belongs in `NEAR_NETWORK_ID`, `NEAR_RPC_URL`, and `NEAR_CONTRACT_ID`; it is not represented by `CHAIN_ID`.

## Contract roles

- `HousingCreditVault.LOAN_MANAGER_ROLE`: `LoanManager`
- `LoanManager.AUCTION_MANAGER_ROLE`: `CreditAuction`
- `CreditAuction.CREDIT_MANAGER_ROLE`: approved credit manager wallet
- `CreditAuction.AUCTION_MANAGER_ROLE`: auction operator wallet

The contracts are hackathon MVP contracts and have not been audited. The admin role is intentionally visible in the demo and must be replaced with multisig and timelock controls before production use.

## Phase status

### Phase 1: Hackathon MVP

Implemented locally: vault deposit and shares, borrower approval, commit-reveal auction, deterministic allocation, loan creation, repayment, a native NEAR proof registry with immutable loan and repayment evidence, transaction transparency, and a walletless demo fallback. NEAR Testnet deployment and proof transactions remain pending.

### Phase 2: Controlled pilot

Not activated by the demo. The planned work is KYB/KYC, licensed servicing, document hashes, valuation providers, multisig operations, risk policy configuration, reserve accounting, reporting, and legal review.

### Phase 3: Production network

Not represented as a live claim. The roadmap is multiple strategies, institutional onboarding, audited contracts, permissioned access, secondary liquidity, and multiple originators.

## Disclosure

Mock USDC has no monetary value. Property, borrower, underwriting, and repayment details in the demo are simulated. The prototype demonstrates accounting and allocation mechanics, not repayment capacity or enforceable collateral.

## License

MIT
