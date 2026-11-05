# HOMR testnet faucet

The frontend page is available at `/faucet` on the Vite dev server, for example `http://localhost:5173/faucet`. It calls this service at `http://localhost:3001` by default. Set `VITE_FAUCET_API_BASE` in the frontend environment when the service uses another URL.

To run the service locally:

1. Copy `.env.example` to `.env` in this directory.
2. Set `FAUCET_PRIVATE_KEY` to a dedicated testnet wallet key. Keep it on the server, never in a `VITE_` variable. Fund this wallet with testnet BNB for BNB claims and mint transaction gas.
3. Run `npm install` and `npm start` in this directory.
4. Open `/faucet` on the frontend dev server. The page checks `/api/info` before enabling claims.

The service sends testnet BNB or mints test-only mUSDC to the entered address. Each address can claim each token once per hour while the process stays running. The token's `decimals()` value is read from the deployed contract, so the configured mUSDC amount is converted correctly. For a hosted frontend, set `FAUCET_ALLOWED_ORIGINS` to its exact origin.
