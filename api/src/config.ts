import "dotenv/config";
import { z } from "zod";

const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    LOG_LEVEL: z.string().default("info"),
    DATABASE_URL: z.string().url(),

    // NEAR Network Configuration
    NEAR_NETWORK_ID: z.string().default("testnet"),
    NEAR_NODE_URL: z.string().url().default("https://rpc.testnet.near.org"),
    NEAR_ARCHIVAL_URL: z.string().url().default("https://archival-rpc.testnet.near.org"),
    NEAR_EXPLORER_URL: z.string().url().default("https://testnet.nearblocks.io"),

    // Contract Account IDs
    VAULT_CONTRACT: z.string().default("vault.homr.testnet"),
    AUCTION_CONTRACT: z.string().default("auction.homr.testnet"),
    LOAN_MANAGER_CONTRACT: z.string().default("loan-manager.homr.testnet"),
    AUDIT_CONTRACT: z.string().default("audit.homr.testnet"),
    TOKEN_CONTRACT: z.string().default("token.homr.testnet"),

    // Admin Credentials
    ADMIN_ACCOUNT_ID: z.string().default("admin.homr.testnet"),
    ADMIN_PRIVATE_KEY: z.string().default("ed25519:3D5NzVDzVbZ1F7bZ1F7bZ1F7bZ1F7bZ1F7bZ1F7bZ1F7"),
    ADMIN_API_KEY: z.string().min(8).default("homr_admin_secret_key_2026"),

    // Demo Signer (for Walletless Demo)
    DEMO_SIGNER_ACCOUNT_ID: z.string().optional(),
    DEMO_SIGNER_PRIVATE_KEY: z.string().optional(),

    // Indexer Configuration
    FINALITY_LAG: z.coerce.number().int().nonnegative().default(5),
    INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10000),

    CORS_ORIGIN: z.string().default("http://localhost:3000,http://localhost:5173"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error("❌ Invalid env:", parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const config = {
    ...parsed.data,
    isProd: parsed.data.NODE_ENV === "production",
    contracts: {
        vault: parsed.data.VAULT_CONTRACT,
        auction: parsed.data.AUCTION_CONTRACT,
        loanManager: parsed.data.LOAN_MANAGER_CONTRACT,
        audit: parsed.data.AUDIT_CONTRACT,
        token: parsed.data.TOKEN_CONTRACT,
    },
};
