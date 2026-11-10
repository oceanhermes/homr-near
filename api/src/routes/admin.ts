import type { FastifyInstance } from "fastify";
import { adminAuth } from "../middleware/nearAuth.js";
import { reviewApplication } from "../modules/applications/service.js";
import { startAuction, finalizeAuction } from "../modules/auctions/service.js";
import { config } from "../config.js";

function mapAdminError(msg: string): { code: number; body: Record<string, unknown> } | null {
    if (msg === "APPLICATION_NOT_FOUND") {
        return { code: 404, body: { error: msg } };
    }
    if (msg === "APPLICATION_ALREADY_REVIEWED") {
        return {
            code: 409,
            body: {
                error: msg,
                message: "Application ini sudah di-review sebelumnya. Tidak bisa di-review dua kali.",
            },
        };
    }
    if (msg === "MAX_PRINCIPAL_REQUIRED") {
        return {
            code: 400,
            body: {
                error: msg,
                message: "Field maxPrincipal wajib diisi untuk keputusan APPROVED.",
            },
        };
    }
    if (msg === "AUCTION_NOT_FOUND") {
        return { code: 404, body: { error: msg } };
    }
    if (msg === "AUCTION_ALREADY_FINALIZED") {
        return {
            code: 409,
            body: {
                error: msg,
                message: "Auction ini sudah difinalisasi sebelumnya.",
            },
        };
    }

    return null;
}

export async function adminRoutes(app: FastifyInstance) {
    app.addHook("onRequest", adminAuth);

    app.get("/status", async () => {
        return {
            adminAccounts: config.adminAccountIds,
            networkId: config.NEAR_NETWORK_ID,
            nodeUrl: config.NEAR_NODE_URL,
            contracts: {
                vault: config.contracts.vault,
                auction: config.contracts.auction,
                loanManager: config.contracts.loanManager,
                audit: config.contracts.audit,
                token: config.contracts.token,
            },
        };
    });

    app.post("/applications/:id/review", async (req, reply) => {
        const { id } = req.params as { id: string };
        const body = req.body as {
            decision: "APPROVED" | "REJECTED";
            maxPrincipal?: string;
            reviewedBy?: string;
            reviewNote?: string;
        };

        if (!body?.decision || !["APPROVED", "REJECTED"].includes(body.decision)) {
            return reply.code(400).send({
                error: "INVALID_DECISION",
                message: "decision must be APPROVED or REJECTED",
            });
        }

        try {
            const result = await reviewApplication(id, {
                decision: body.decision,
                maxPrincipal: body.maxPrincipal,
                reviewedBy: body.reviewedBy ?? "credit_manager",
                reviewNote: body.reviewNote,
            });
            return result;
        } catch (err) {
            const msg = (err as Error).message;
            const mapped = mapAdminError(msg);
            if (mapped) {
                return reply.code(mapped.code).send(mapped.body);
            }
            app.log.error(err);
            return reply.code(500).send({ error: "review_failed", message: msg });
        }
    });

    app.post("/auctions", async (req, reply) => {
        const body = req.body as { commitDuration?: number; revealDuration?: number };

        if (!body?.commitDuration || !body?.revealDuration) {
            return reply.code(400).send({
                error: "MISSING_DURATIONS",
                message: "commitDuration and revealDuration required (seconds)",
            });
        }

        try {
            const auction = await startAuction({
                commitDuration: body.commitDuration,
                revealDuration: body.revealDuration,
            });
            return reply.code(201).send(auction);
        } catch (err) {
            const msg = (err as Error).message;
            const mapped = mapAdminError(msg);
            if (mapped) {
                return reply.code(mapped.code).send(mapped.body);
            }
            app.log.error(err);
            return reply.code(500).send({ error: "start_auction_failed", message: msg });
        }
    });

    app.post("/auctions/:id/finalize", async (req, reply) => {
        const { id } = req.params as { id: string };

        try {
            const auction = await finalizeAuction(id);
            return auction;
        } catch (err) {
            const msg = (err as Error).message;
            const mapped = mapAdminError(msg);
            if (mapped) {
                return reply.code(mapped.code).send(mapped.body);
            }
            app.log.error(err);
            return reply.code(500).send({ error: "finalize_failed", message: msg });
        }
    });
}
