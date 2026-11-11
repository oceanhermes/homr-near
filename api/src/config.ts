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
    ADMIN_ACCOUNT_IDS: z.string().default(""), // comma-separated allowlist; falls back to ADMIN_ACCOUNT_ID
    ADMIN_PRIVATE_KEY: z.string().optional(),
    // Deployment envs use NEAR_PRIVATE_KEY for the admin signer; accept it as a fallback.
    NEAR_PRIVATE_KEY: z.string().optional(),
    ADMIN_API_KEY: z.string().min(8).default("homr_admin_secret_key_2026"),
    // NEP-413 `recipient` for admin signature challenges
    NEP413_RECIPIENT: z.string().default("homr-api"),

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
    // The admin signer never falls back to a placeholder key: a missing key must
    // surface as a signing error instead of a simulated transaction. Empty
    // values count as missing so `ADMIN_PRIVATE_KEY=` cannot shadow a real key.
    ADMIN_PRIVATE_KEY: (parsed.data.ADMIN_PRIVATE_KEY ?? "").trim() || (parsed.data.NEAR_PRIVATE_KEY ?? "").trim(),
    contracts: {
        vault: parsed.data.VAULT_CONTRACT,
        auction: parsed.data.AUCTION_CONTRACT,
        loanManager: parsed.data.LOAN_MANAGER_CONTRACT,
        audit: parsed.data.AUDIT_CONTRACT,
        token: parsed.data.TOKEN_CONTRACT,
    },
    // B9: admin allowlist — ADMIN_ACCOUNT_IDS csv wins, else the single ADMIN_ACCOUNT_ID
    adminAccountIds: parsed.data.ADMIN_ACCOUNT_IDS
        ? parsed.data.ADMIN_ACCOUNT_IDS
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
        : [parsed.data.ADMIN_ACCOUNT_ID],
    nep413Recipient: parsed.data.NEP413_RECIPIENT,
};
