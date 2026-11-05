import { config } from "../config.js";
import { publicClient, walletClient, abis } from "./contracts.js";

// ============================================================
// Helper: parse error revert dari viem
// ============================================================

/**
 * viem melempar error dengan pesan panjang: "The contract function ... reverted 
 * with the following reason: Auction in progress ...".
 * Helper ini ekstrak alasan revert + kode error custom kita.
 */
function classifyContractError(err: unknown, fallbackCode: string): Error {
    const message = (err as Error)?.message ?? String(err);

    // Cek alasan revert spesifik dari kontrak
    if (/Auction in progress/i.test(message)) {
        return new Error("AUCTION_IN_PROGRESS");
    }
    if (/Too early/i.test(message)) {
        return new Error("AUCTION_TOO_EARLY");
    }
    if (/Already finalized/i.test(message)) {
        return new Error("AUCTION_ALREADY_FINALIZED");
    }
    if (/Borrower not approved/i.test(message)) {
        return new Error("BORROWER_NOT_APPROVED");
    }
    if (/Amount exceeds approval/i.test(message)) {
        return new Error("AMOUNT_EXCEEDS_APPROVAL");
    }
    if (/Insufficient vault capital/i.test(message)) {
        return new Error("INSUFFICIENT_VAULT_CAPITAL");
    }
    if (/AccessControl|missing role/i.test(message)) {
        return new Error("ACCESS_CONTROL_DENIED");
    }

    // Default fallback
    return new Error(`${fallbackCode}:${message.slice(0, 200)}`);
}

// ============================================================
// Pre-flight role check
// ============================================================

async function getRoleHash(roleName: "CREDIT_MANAGER_ROLE" | "AUCTION_MANAGER_ROLE" | "LOAN_MANAGER_ROLE"): Promise<`0x${string}`> {
    const roleHash = await publicClient.readContract({
        address: config.addresses.auction,
        abi: abis.auction,
        functionName: roleName,
    });
    return roleHash as `0x${string}`;
}

async function ensureRole(roleName: "CREDIT_MANAGER_ROLE" | "AUCTION_MANAGER_ROLE" | "LOAN_MANAGER_ROLE"): Promise<void> {
    const admin = walletClient.account!.address;
    const roleHash = await getRoleHash(roleName);

    const hasRole = await publicClient.readContract({
        address: config.addresses.auction,
        abi: abis.auction,
        functionName: "hasRole",
        args: [roleHash, admin],
    }) as boolean;

    if (!hasRole) {
        throw new Error(`MISSING_ROLE:${roleName}`);
    }
}

// ============================================================
// Admin actions
// ============================================================

export async function approveBorrower(
    borrower: `0x${string}`,
    maxPrincipal: bigint,
    propertyHash: string
) {
    await ensureRole("CREDIT_MANAGER_ROLE");

    let hash: `0x${string}`;
    try {
        hash = await walletClient.writeContract({
            address: config.addresses.auction,
            abi: abis.auction,
            functionName: "approveBorrower",
            args: [borrower, maxPrincipal, propertyHash],
            chain: null,
            account: walletClient.account!,
        });
    } catch (err) {
        throw classifyContractError(err, "APPROVAL_REVERTED");
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("APPROVAL_REVERTED");

    return { txHash: hash, blockNumber: receipt.blockNumber };
}

export async function startAuction(commitDuration: bigint, revealDuration: bigint) {
    await ensureRole("AUCTION_MANAGER_ROLE");

    let hash: `0x${string}`;
    try {
        hash = await walletClient.writeContract({
            address: config.addresses.auction,
            abi: abis.auction,
            functionName: "startAuction",
            args: [commitDuration, revealDuration],
            chain: null,
            account: walletClient.account!,
        });
    } catch (err) {
        throw classifyContractError(err, "AUCTION_START_REVERTED");
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("AUCTION_START_REVERTED");

    return { txHash: hash, blockNumber: receipt.blockNumber };
}

export async function finalizeAuction() {
    await ensureRole("AUCTION_MANAGER_ROLE");

    let hash: `0x${string}`;
    try {
        hash = await walletClient.writeContract({
            address: config.addresses.auction,
            abi: abis.auction,
            functionName: "finalizeAuction",
            chain: null,
            account: walletClient.account!,
        });
    } catch (err) {
        throw classifyContractError(err, "AUCTION_FINALIZE_REVERTED");
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("AUCTION_FINALIZE_REVERTED");

    return { txHash: hash, blockNumber: receipt.blockNumber };
}