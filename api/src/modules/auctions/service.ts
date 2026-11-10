import { prisma } from "../../db/client.js";
import {
    startAuction as startAuctionOnchain,
    finalizeAuction as finalizeAuctionOnchain,
} from "../../chain/nearSigner.js";

export interface StartAuctionInput {
    commitDuration: number;   // detik
    revealDuration: number;   // detik
}

export async function startAuction(input: StartAuctionInput) {
    const commitDurationMs = BigInt(input.commitDuration * 1000);
    const revealDurationMs = BigInt(input.revealDuration * 1000);

    const tx = await startAuctionOnchain(commitDurationMs, revealDurationMs);

    const now = Date.now();
    const commitDeadline = new Date(now + input.commitDuration * 1000);
    const revealDeadline = new Date(now + (input.commitDuration + input.revealDuration) * 1000);

    const latest = await prisma.auction.findFirst({
        orderBy: { onchainAuctionId: "desc" },
    });
    const nextId = latest ? latest.onchainAuctionId + 1n : 1n;

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

export async function listAuctions() {
    return prisma.auction.findMany({
        orderBy: { createdAt: "desc" },
        include: { bids: true },
    });
}

export async function finalizeAuction(auctionId: string) {
    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) throw new Error("AUCTION_NOT_FOUND");

    if (auction.status === "FINALIZED") {
        throw new Error("AUCTION_ALREADY_FINALIZED");
    }

    const tx = await finalizeAuctionOnchain(Number(auction.onchainAuctionId));

    return prisma.auction.update({
        where: { id: auctionId },
        data: {
            status: "FINALIZED",
            finalizeTxHash: tx.txHash,
        },
    });
}
