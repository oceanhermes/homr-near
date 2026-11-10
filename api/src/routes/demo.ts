import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { processEvent } from "../chain/nearIndexer.js";
import crypto from "crypto";

export async function demoRoutes(app: FastifyInstance) {
    app.post("/demo/step", async (req, reply) => {
        const body = req.body as {
            step: "deposit" | "approve" | "commit" | "reveal" | "finalize" | "issue" | "repay";
            params?: Record<string, unknown>;
        };

        if (!body?.step) {
            return reply.code(400).send({ error: "step required" });
        }

        const txHash = "near_" + crypto.randomBytes(24).toString("hex");
        const explorerUrl = `${config.NEAR_EXPLORER_URL}/txns/${txHash}`;
        const blockHeight = BigInt(Math.floor(Date.now() / 1000));

        let eventData: Record<string, unknown> = {};

        switch (body.step) {
            case "deposit":
                eventData = {
                    standard: "homr_vault",
                    version: "1.0.0",
                    event: "vault_deposit",
                    data: {
                        investor: "investor.homr.testnet",
                        assets: "100000000000",
                        shares: "100000000000",
                        nav: "1000000",
                    },
                };
                break;
            case "approve":
                eventData = {
                    standard: "homr_auction",
                    version: "1.0.0",
                    event: "borrower_approved",
                    data: {
                        borrower: "borrower.homr.testnet",
                        max_principal: "50000000000",
                        property_hash: "prop_jakarta_selatan_88",
                    },
                };
                break;
            case "commit":
                eventData = {
                    standard: "homr_auction",
                    version: "1.0.0",
                    event: "bid_committed",
                    data: {
                        auction_id: 1,
                        borrower: "borrower.homr.testnet",
                        commitment: "0x" + crypto.randomBytes(32).toString("hex"),
                    },
                };
                break;
            case "reveal":
                eventData = {
                    standard: "homr_auction",
                    version: "1.0.0",
                    event: "bid_revealed",
                    data: {
                        auction_id: 1,
                        borrower: "borrower.homr.testnet",
                        amount: "50000000000",
                        rate_bps: 750,
                        term_days: 365,
                    },
                };
                break;
            case "finalize":
                eventData = {
                    standard: "homr_auction",
                    version: "1.0.0",
                    event: "auction_finalized",
                    data: {
                        auction_id: 1,
                        winner: "borrower.homr.testnet",
                        amount: "50000000000",
                        rate_bps: 750,
                    },
                };
                break;
            case "issue":
                eventData = {
                    standard: "homr_loan",
                    version: "1.0.0",
                    event: "loan_issued",
                    data: {
                        loan_id: 1,
                        borrower: "borrower.homr.testnet",
                        principal: "50000000000",
                        rate_bps: 750,
                        term_days: 365,
                        property_hash: "prop_jakarta_selatan_88",
                    },
                };
                break;
            case "repay":
                eventData = {
                    standard: "homr_loan",
                    version: "1.0.0",
                    event: "loan_repaid",
                    data: {
                        loan_id: 1,
                        borrower: "borrower.homr.testnet",
                        amount: "53750000000",
                        principal_paid: "50000000000",
                        interest_paid: "3750000000",
                        remaining_after: "0",
                        partial: false,
                    },
                };
                break;
        }

        // Write event to indexer DB so demo immediately reflects in live view.
        // B6/C3: demo events are tagged SIMULATION so the ledger can flag them;
        // receiptId is a random synthetic id (never collides with real receipts).
        await processEvent(
            eventData as unknown as { standard: string; version: string; event: string; data: Record<string, unknown> },
            {
                txHash,
                receiptId: "demo_" + crypto.randomBytes(16).toString("hex"),
                logIndex: 0,
                blockHeight,
                predecessorId: "demo.homr.testnet",
                txSource: "SIMULATION",
            }
        );

        return {
            status: "success",
            step: body.step,
            tx_hash: txHash,
            block_height: blockHeight.toString(),
            explorer_url: explorerUrl,
            event: eventData,
        };
    });
}

