import "dotenv/config";
import { z } from "zod";

const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    LOG_LEVEL: z.string().default("info"),
    DATABASE_URL: z.string().url(),

    CHAIN_ID: z.coerce.number().int().positive(),
    NETWORK_NAME: z.string().default("BNB Smart Chain Testnet"),
    NATIVE_CURRENCY_NAME: z.string().default("tBNB"),
    NATIVE_CURRENCY_SYMBOL: z.string().default("tBNB"),
    EXPLORER_NAME: z.string().default("Block Explorer"),
    RPC_URL: z.string().url(),
    EXPLORER_URL: z.string().url(),

    VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    AUCTION_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    LOAN_MANAGER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    MOCK_USDC_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    DEPLOY_BLOCK: z.coerce.bigint(),

    ADMIN_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    ADMIN_API_KEY: z.string().min(8),

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
    addresses: {
        vault: parsed.data.VAULT_ADDRESS as `0x${string}`,
        auction: parsed.data.AUCTION_ADDRESS as `0x${string}`,
        loanManager: parsed.data.LOAN_MANAGER_ADDRESS as `0x${string}`,
        mockUsdc: parsed.data.MOCK_USDC_ADDRESS as `0x${string}`,
    },
};
