import { config } from "../config.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { parseNep297Log } from "./nep297.js";
import type { Nep297Event } from "./nep297.js";

// NEP-297 parsing lives in ./nep297.ts (dependency-free, unit-tested); re-exported
// here so existing callers can keep importing it from the indexer.
export { parseNep297Log };
export type { Nep297Event };

// ---------------------------------------------------------------------------
// Event persistence (idempotent)
// ---------------------------------------------------------------------------

export type TxSource = "ONCHAIN" | "SIMULATION";

export interface EventContext {
    txHash: string;
    receiptId: string;
    logIndex: number;
    blockHeight: bigint;
    predecessorId: string;
    txSource: TxSource;
}

export async function processEvent(event: Nep297Event, ctx: EventContext): Promise<void> {
    await prisma.chainEvent.upsert({
        where: {
            receiptId_logIndex: { receiptId: ctx.receiptId, logIndex: ctx.logIndex },
        },
        create: {
            receiptId: ctx.receiptId,
            logIndex: ctx.logIndex,
            txHash: ctx.txHash,
            blockHeight: ctx.blockHeight,
            predecessorId: ctx.predecessorId,
            eventName: event.event,
            standard: event.standard,
            payload: event.data as object,
            txSource: ctx.txSource,
        },
        update: {}, // duplicate (reorg replay) → do nothing
    });

    const data = Array.isArray(event.data) ? event.data[0] : event.data;
    if (!data) return;

    if (event.event === "loan_issued") {
        const loanId = BigInt(String(data.loan_id || 0));
        await prisma.loan.upsert({
            where: { onchainLoanId: loanId },
            create: {
                onchainLoanId: loanId,
                borrower: String(data.borrower),
                principal: BigInt(String(data.principal || 0)),
                remainingPrincipal: BigInt(String(data.principal || 0)),
                rate: Number(data.rate_bps || 0),
                term: Number(data.term_days || 0),
                maturity: new Date(Date.now() + Number(data.term_days || 30) * 86400 * 1000),
                propertyHash: String(data.property_hash || ""),
                status: "ACTIVE",
                createTxHash: ctx.txHash,
            },
            update: {}, // duplicate → do nothing
        });
    } else if (event.event === "loan_repaid") {
        const loanId = BigInt(String(data.loan_id || 0));
        const amount = BigInt(String(data.amount || 0));
        const remaining = BigInt(String(data.remaining_after || 0));

        const existingLoan = await prisma.loan.findUnique({
            where: { onchainLoanId: loanId },
        });

        if (existingLoan) {
            await prisma.loan.update({
                where: { onchainLoanId: loanId },
                data: {
                    remainingPrincipal: remaining,
                    status: remaining === 0n ? "REPAID" : "ACTIVE",
                },
            });

            await prisma.repayment.upsert({
                where: { receiptId: ctx.receiptId },
                create: {
                    loanId: existingLoan.id,
                    amount,
                    txHash: ctx.txHash,
                    receiptId: ctx.receiptId,
                    blockHeight: ctx.blockHeight,
                    paidAt: new Date(),
                },
                update: {}, // duplicate → do nothing
            });
        }
    }
}

// ---------------------------------------------------------------------------
// NEAR RPC plumbing
// ---------------------------------------------------------------------------

async function rpcCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(config.NEAR_NODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "homr-indexer", method, params }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        throw new Error(`NEAR RPC HTTP ${res.status} ${res.statusText} (${method})`);
    }
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) {
        throw new Error(`NEAR RPC error (${method}): ${body.error.message || "unknown"}`);
    }
    if (body.result === undefined) {
        throw new Error(`NEAR RPC returned no result (${method})`);
    }
    return body.result;
}

interface RpcBlockHeader { height: number; hash: string; }
interface RpcBlock { header: RpcBlockHeader; chunks: { chunk_hash: string; shard_id: number }[]; }
interface RpcChunk { transactions: { hash: string; signer_id: string; receiver_id: string }[]; }
interface RpcTxOutcome {
    transaction: { hash: string; signer_id: string; receiver_id: string };
    receipts: { receipt_id: string; predecessor_id: string; receiver_id: string }[];
    receipts_outcome: { id: string; block_hash: string; outcome: { logs: string[] } }[];
}

async function getFinalBlockHeight(): Promise<bigint> {
    const block = await rpcCall<RpcBlock>("block", { finality: "final" });
    return BigInt(block.header.height);
}

async function processBlock(blockHeight: bigint): Promise<number> {
    const block = await rpcCall<RpcBlock>("block", { block_id: Number(blockHeight) });
    let eventsSeen = 0;

    for (const chunkMeta of block.chunks) {
        const chunk = await rpcCall<RpcChunk>("chunk", { chunk_id: chunkMeta.chunk_hash });

        for (const tx of chunk.transactions) {
            let outcome: RpcTxOutcome;
            try {
                // Gunakan EXPERIMENTAL_tx_status yang lebih stabil untuk live blocks
                outcome = await rpcCall<RpcTxOutcome>("EXPERIMENTAL_tx_status", {
                    tx_hash: tx.hash,
                    sender_account_id: tx.signer_id,
                });
            } catch (err) {
                // Jika 1 transaksi gagal dibaca, lewati saja jangan sampai menghentikan seluruh block
                logger.warn(`NEAR Indexer: skipped tx ${tx.hash}`, { error: String(err) });
                continue;
            }

            const predecessorById = new Map(
                outcome.receipts.map((r) => [r.receipt_id, r.predecessor_id])
            );

            for (const receiptOutcome of outcome.receipts_outcome) {
                const receiptId = receiptOutcome.id;
                const predecessorId = predecessorById.get(receiptId) ?? tx.signer_id;

                for (let logIndex = 0; logIndex < receiptOutcome.outcome.logs.length; logIndex++) {
                    const event = parseNep297Log(receiptOutcome.outcome.logs[logIndex]);
                    if (!event) continue;

                    await processEvent(event, {
                        txHash: tx.hash,
                        receiptId,
                        logIndex,
                        blockHeight,
                        predecessorId,
                        txSource: "ONCHAIN",
                    });
                    eventsSeen++;
                }
            }
        }
    }

    return eventsSeen;
}

// ---------------------------------------------------------------------------
// Cursor + polling loop
// ---------------------------------------------------------------------------

async function getCursor(): Promise<bigint | null> {
    const cursor = await prisma.indexerCursor.findUnique({ where: { id: "singleton" } });
    return cursor ? cursor.lastBlockHeight : null;
}

async function setCursor(blockHeight: bigint): Promise<void> {
    await prisma.indexerCursor.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", lastBlockHeight: blockHeight },
        update: { lastBlockHeight: blockHeight },
    });
}

// Helper untuk memberi jeda waktu (delay)
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export async function startIndexer(): Promise<void> {
    logger.info(`NEAR Indexer starting (node=${config.NEAR_NODE_URL}, finality lag=${config.FINALITY_LAG} blocks)`);

    const MAX_BLOCKS_PER_TICK = 2;
    let ticking = false;

    const tick = async () => {
        if (ticking) return;
        ticking = true;
        try {
            const finalTip = await getFinalBlockHeight();
            const maxHeight = finalTip - BigInt(config.FINALITY_LAG);

            let cursor = await getCursor();
            if (cursor === null) {
                cursor = maxHeight;
                await setCursor(maxHeight);
                logger.info(`NEAR Indexer: no cursor, starting at final height ${maxHeight}`);
            }

            let height = cursor + 1n;
            let processed = 0;
            while (height <= maxHeight && processed < MAX_BLOCKS_PER_TICK) {
                try {
                    const events = await processBlock(height);
                    if (events > 0) {
                        logger.info(`NEAR Indexer: block ${height} → ${events} NEP-297 event(s)`);
                    }
                    await setCursor(height);
                } catch (err) {
                    logger.error(`NEAR Indexer: failed to process block ${height}`, {
                        error: err instanceof Error ? err.message : String(err)
                    });
                    break;
                }
                height += 1n;
                processed++;

                // Jeda 1 detik agar tidak terkena HTTP 429 (Rate Limit)
                await delay(1000);
            }
        } catch (err) {
            logger.error("NEAR Indexer tick failed", {
                error: err instanceof Error ? err.message : String(err)
            });
        } finally {
            ticking = false;
        }
    };

    await tick();
    setInterval(tick, config.INDEXER_POLL_INTERVAL_MS);
}