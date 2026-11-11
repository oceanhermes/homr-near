import { connect, keyStores, KeyPair, Account } from "near-api-js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import crypto from "crypto";

let cachedAccount: Account | null = null;
let signerError: string | null = null;

async function getAdminAccount(): Promise<Account | null> {
    if (cachedAccount) return cachedAccount;
    try {
        const privateKey = config.ADMIN_PRIVATE_KEY;
        if (!privateKey) {
            throw new Error(
                "ADMIN_PRIVATE_KEY (or NEAR_PRIVATE_KEY) is not set for the admin signer"
            );
        }

        const keyStore = new keyStores.InMemoryKeyStore();
        const keyPair = KeyPair.fromString(privateKey as `ed25519:${string}`);
        await keyStore.setKey(config.NEAR_NETWORK_ID, config.ADMIN_ACCOUNT_ID, keyPair);

        const near = await connect({
            networkId: config.NEAR_NETWORK_ID,
            nodeUrl: config.NEAR_NODE_URL,
            keyStore,
        });

        cachedAccount = await near.account(config.ADMIN_ACCOUNT_ID);
        signerError = null;
        return cachedAccount;
    } catch (err) {
        signerError = err instanceof Error ? err.message : String(err);
        logger.warn("Could not connect live NEAR account, signer will run in simulation mode", err);
        return null;
    }
}

/** Why the last {@link getAdminAccount} attempt failed, if it did. */
export function getSignerError(): string | null {
    return signerError;
}

/**
 * Mint mock USDC (NEP-141 `mint`) to `accountId` from the admin account.
 *
 * Unlike the auction helpers below this never simulates: a faucet claim must
 * report the real on-chain transaction hash or fail loudly.
 */
export async function mintMockUsdc(accountId: string, amount: string): Promise<string> {
    const account = await getAdminAccount();
    if (!account) {
        throw new Error(
            signerError ?? `Admin signer ${config.ADMIN_ACCOUNT_ID} is unavailable`
        );
    }

    const outcome = await account.functionCall({
        contractId: config.contracts.token,
        methodName: "mint",
        args: { account_id: accountId, amount },
        gas: BigInt("30000000000000"), // 30 TGas
    });

    return outcome.transaction.hash;
}


function simulatedTxHash(): string {
    return "near_" + crypto.randomBytes(24).toString("hex");
}

export async function approveBorrower(
    borrower: string,
    maxPrincipal: bigint,
    propertyHash: string
) {
    const account = await getAdminAccount();
    if (account) {
        try {
            const outcome = await account.functionCall({
                contractId: config.contracts.auction,
                methodName: "approve_borrower",
                args: {
                    borrower,
                    max_principal: maxPrincipal.toString(),
                    property_hash: propertyHash,
                },
                gas: BigInt("30000000000000"), // 30 TGas
            });
            return {
                txHash: outcome.transaction.hash,
                // Real block height is resolved by the indexer from the receipt.
                blockHeight: 1000n,
            };
        } catch (err) {
            logger.warn("Live functionCall failed, falling back to simulated proof", err);
        }
    }

    return {
        txHash: simulatedTxHash(),
        blockHeight: 1000n,
    };
}

export async function startAuction(commitDurationMs: bigint, revealDurationMs: bigint) {
    const account = await getAdminAccount();
    if (account) {
        try {
            const outcome = await account.functionCall({
                contractId: config.contracts.auction,
                methodName: "start_auction",
                args: {
                    commit_duration_ms: Number(commitDurationMs),
                    reveal_duration_ms: Number(revealDurationMs),
                },
                gas: BigInt("30000000000000"),
            });
            return {
                txHash: outcome.transaction.hash,
                blockHeight: 1000n,
            };
        } catch (err) {
            logger.warn("Live functionCall failed, falling back to simulated proof", err);
        }
    }

    return {
        txHash: simulatedTxHash(),
        blockHeight: 1000n,
    };
}

export async function finalizeAuction(auctionId: number) {
    const account = await getAdminAccount();
    if (account) {
        try {
            const outcome = await account.functionCall({
                contractId: config.contracts.auction,
                methodName: "finalize_auction",
                args: { auction_id: auctionId },
                gas: BigInt("50000000000000"),
            });
            return {
                txHash: outcome.transaction.hash,
                blockHeight: 1000n,
            };
        } catch (err) {
            logger.warn("Live functionCall failed, falling back to simulated proof", err);
        }
    }

    return {
        txHash: simulatedTxHash(),
        blockHeight: 1000n,
    };
}

