import { config } from "../config.js";
import { publicClient } from "./contracts.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";

const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 20n;   // block per tick — kecil supaya tidak kena limit RPC

// ============================================================
// Cursor helpers
// ============================================================

async function getCursor(): Promise<bigint> {
    const cursor = await prisma.indexerCursor.findUnique({ where: { id: "singleton" } });
    if (cursor) return cursor.lastBlock;
    return config.DEPLOY_BLOCK;
}

async function setCursor(block: bigint) {
    await prisma.indexerCursor.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", lastBlock: block },
        update: { lastBlock: block },
    });
}

// ============================================================
// Process range — query SATU address per request
// ============================================================

async function processBlockRange(
    fromBlock: bigint,
    toBlock: bigint
): Promise<{ skipped: boolean; newCursor: bigint }> {
    const addresses = [
        config.addresses.vault,
        config.addresses.loanManager,
        config.addresses.auction,
    ];

    try {
        // Query satu kontrak per request — hindari limit multi-address RPC
        for (const address of addresses) {
            const logs = await publicClient.getLogs({
                address,
                fromBlock,
                toBlock,
            });

            for (const log of logs) {
                const existing = await prisma.chainEvent.findUnique({
                    where: {
                        txHash_logIndex: {
                            txHash: log.transactionHash!,
                            logIndex: log.logIndex!,
                        },
                    },
                });
                if (existing) continue;

                await prisma.chainEvent.create({
                    data: {
                        txHash: log.transactionHash!,
                        blockNumber: log.blockNumber!,
                        logIndex: log.logIndex!,
                        eventName: log.topics[0] ?? "unknown",
                        payload: {
                            address: log.address,
                            topics: log.topics,
                            data: log.data,
                        },
                    },
                });
            }
        }

        return { skipped: false, newCursor: toBlock };
    } catch (err) {
        const errorCode = (err as { code?: number }).code;

        // -32701: history pruned (PublicNode-style)
        // -32005: request exceeds limit (BNB data-seed RPC)
        // -32602: too many results
        if (errorCode === -32701) {
            logger.warn("RPC pruned history - skipping forward");
            const currentBlock = await publicClient.getBlockNumber();
            return { skipped: true, newCursor: currentBlock };
        }

        if (errorCode === -32005 || errorCode === -32602) {
            // RPC limit — retry dari blok yang sama, jangan skip
            logger.warn(
                `RPC limit at blocks ${fromBlock}..${toBlock} (code ${errorCode}) - retry with backoff`
            );
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return { skipped: true, newCursor: fromBlock - 1n }; // retry dari block yang sama
        }

        throw err;
    }
}

// ============================================================
// Main indexer loop
// ============================================================

export async function startIndexer() {
    logger.info("Indexer starting...");

    // Delay awal supaya Neon (scale-to-zero) sempat bangun
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const tick = async () => {
        try {
            const currentBlock = await publicClient.getBlockNumber();
            const fromBlock = (await getCursor()) + 1n;
            if (fromBlock > currentBlock) return;

            // Batch kecil
            const toBlock =
                fromBlock + BATCH_SIZE > currentBlock
                    ? currentBlock
                    : fromBlock + BATCH_SIZE;

            const result = await processBlockRange(fromBlock, toBlock);
            await setCursor(result.newCursor);

            if (!result.skipped) {
                logger.info(`Indexed blocks ${fromBlock}..${toBlock}`);
            }
        } catch (err) {
            const msg = (err as Error).message || "unknown";
            logger.error(`Indexer tick failed: ${msg.slice(0, 120)}`);
        }
    };

    await tick();
    setInterval(tick, POLL_INTERVAL_MS);
}