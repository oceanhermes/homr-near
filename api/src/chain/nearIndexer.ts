import { config } from "../config.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";

interface Nep297Event {
    standard: string;
    version: string;
    event: string;
    data: Record<string, unknown> | Array<Record<string, unknown>>;
}

export function parseNep297Log(log: string): Nep297Event | null {
    if (!log.startsWith("EVENT_JSON:")) return null;
    try {
        const jsonStr = log.slice("EVENT_JSON:".length);
        const parsed = JSON.parse(jsonStr) as Nep297Event;
        if (parsed.standard && parsed.event) {
            return parsed;
        }
    } catch {
        // Not valid JSON
    }
    return null;
}

export async function processEvent(
    event: Nep297Event,
    txHash: string,
    blockHeight: bigint,
    predecessorId?: string
) {
    // 1. Record event in ChainEvent
    await prisma.chainEvent.create({
        data: {
            txHash,
            blockHeight,
            predecessorId,
            eventName: event.event,
            standard: event.standard,
            payload: event.data as object,
        },
    });

    // 2. Business entity sync
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
                createTxHash: txHash,
            },
            update: {
                status: "ACTIVE",
            },
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

            await prisma.repayment.create({
                data: {
                    loanId: existingLoan.id,
                    amount,
                    txHash,
                    blockHeight,
                    paidAt: new Date(),
                },
            });
        }
    }
}

async function getCursor(): Promise<bigint> {
    const cursor = await prisma.indexerCursor.findUnique({ where: { id: "singleton" } });
    return cursor ? cursor.lastBlockHeight : 1000n;
}

async function setCursor(blockHeight: bigint) {
    await prisma.indexerCursor.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", lastBlockHeight: blockHeight },
        update: { lastBlockHeight: blockHeight },
    });
}

export async function startIndexer() {
    logger.info("NEAR Indexer starting with finality lag: " + config.FINALITY_LAG);

    const tick = async () => {
        try {
            // In standalone mode or testnet connection, check tip
            const cursor = await getCursor();
            // Advance cursor
            await setCursor(cursor + 1n);
        } catch (err) {
            logger.error("NEAR Indexer tick failed", err);
        }
    };

    await tick();
    setInterval(tick, config.INDEXER_POLL_INTERVAL_MS);
}

