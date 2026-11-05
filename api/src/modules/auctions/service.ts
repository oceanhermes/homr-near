import { prisma } from "../../db/client.js";
import {
    startAuction as startAuctionOnchain,
    finalizeAuction as finalizeAuctionOnchain,
} from "../../chain/signer.js";
import { publicClient, abis } from "../../chain/contracts.js";
import { config } from "../../config.js";

// ============================================================
// Helper: konversi unknown → bigint dengan aman
// ============================================================

function toBigInt(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    if (typeof value === "string") return BigInt(value);
    return 0n;
}

// ============================================================
// Helper: baca deadline dari kontrak (bukan new Date())
// ============================================================

async function readOnchainDeadlines(): Promise<{
    commitDeadline: Date;
    revealDeadline: Date;
}> {
    const [commitDeadlineRaw, revealDeadlineRaw] = await Promise.all([
        publicClient.readContract({
            address: config.addresses.auction,
            abi: abis.auction,
            functionName: "commitDeadline",
        }),
        publicClient.readContract({
            address: config.addresses.auction,
            abi: abis.auction,
            functionName: "revealDeadline",
        }),
    ]);

    const commitDeadline = new Date(Number(toBigInt(commitDeadlineRaw)) * 1000);
    const revealDeadline = new Date(Number(toBigInt(revealDeadlineRaw)) * 1000);

    return { commitDeadline, revealDeadline };
}

// ============================================================
// Types
// ============================================================

export interface StartAuctionInput {
    commitDuration: number;   // detik
    revealDuration: number;   // detik
}

// ============================================================
// Start auction — baca deadline dari kontrak setelah tx sukses
// ============================================================

export async function startAuction(input: StartAuctionInput) {
    const tx = await startAuctionOnchain(
        BigInt(input.commitDuration),
        BigInt(input.revealDuration)
    );

    // Setelah tx sukses, baca deadline DARI KONTRAK
    // (kontrak pakai block.timestamp, bukan waktu server)
    const { commitDeadline, revealDeadline } = await readOnchainDeadlines();

    const latest = await prisma.auction.findFirst({
        orderBy: { onchainAuctionId: "desc" },
    });
    const nextId = latest ? latest.onchainAuctionId + 1n : 0n;

    return prisma.auction.create({
        data: {
            onchainAuctionId: nextId,
            commitDeadline,
            revealDeadline,
            status: "OPEN",
            createTxHash: tx.txHash,
        },
    });
}

// ============================================================
// List auctions
// ============================================================

export async function listAuctions() {
    return prisma.auction.findMany({
        orderBy: { createdAt: "desc" },
        include: { bids: true },
    });
}

// ============================================================
// Finalize — cek state onchain dulu, baru kirim tx
// ============================================================

export async function finalizeAuction(auctionId: string) {
    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) throw new Error("AUCTION_NOT_FOUND");

    const [stateRaw, revealDeadlineRaw, blockNumber] = await Promise.all([
        publicClient.readContract({
            address: config.addresses.auction,
            abi: abis.auction,
            functionName: "state",
        }),
        publicClient.readContract({
            address: config.addresses.auction,
            abi: abis.auction,
            functionName: "revealDeadline",
        }),
        publicClient.getBlockNumber(),
    ]);

    const state = Number(toBigInt(stateRaw));
    const revealDeadline = Number(toBigInt(revealDeadlineRaw));

    const block = await publicClient.getBlock({ blockNumber });
    const nowOnchain = Number(block.timestamp);

    // State: 0=Created, 1=CommitPhase, 2=RevealPhase, 3=Finalized
    if (state === 3) throw new Error("AUCTION_ALREADY_FINALIZED");
    if (state === 0) throw new Error("AUCTION_TOO_EARLY");
    if (nowOnchain <= revealDeadline && state !== 2) {
        throw new Error("AUCTION_TOO_EARLY");
    }

    const tx = await finalizeAuctionOnchain();

    return prisma.auction.update({
        where: { id: auctionId },
        data: {
            status: "FINALIZED",
            finalizeTxHash: tx.txHash,
        },
    });
}