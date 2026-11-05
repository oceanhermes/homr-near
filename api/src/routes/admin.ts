import type { FastifyInstance } from "fastify";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { reviewApplication } from "../modules/applications/service.js";
import { startAuction, finalizeAuction } from "../modules/auctions/service.js";
import { publicClient, walletClient } from "../chain/contracts.js";
import { config } from "../config.js";

/**
 * Helper: mapping error code dari service/signer ke HTTP response.
 * Return null kalau tidak dikenali — biar caller pakai fallback 500.
 */
function mapAdminError(msg: string): { code: number; body: Record<string, unknown> } | null {
    // === Role / access control ===
    if (msg.startsWith("MISSING_ROLE:")) {
        const role = msg.split(":")[1];
        return {
            code: 403,
            body: {
                error: "MISSING_ROLE",
                message: `Wallet admin tidak punya ${role}. Hubungi operator untuk grant role.`,
                requiredRole: role,
            },
        };
    }
    if (msg === "ACCESS_CONTROL_DENIED") {
        return {
            code: 403,
            body: {
                error: "ACCESS_CONTROL_DENIED",
                message: "Wallet admin tidak punya role yang dibutuhkan.",
            },
        };
    }

    // === Application review ===
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
    if (msg === "BORROWER_NOT_APPROVED") {
        return {
            code: 409,
            body: {
                error: msg,
                message: "Borrower ini belum di-approve di kontrak.",
            },
        };
    }
    if (msg === "AMOUNT_EXCEEDS_APPROVAL") {
        return {
            code: 409,
            body: {
                error: msg,
                message: "Jumlah bid melebihi approval maksimum untuk borrower ini.",
            },
        };
    }
    if (msg === "AMOUNT_EXCEEDS_TOKEN_PRECISION") {
        return {
            code: 400,
            body: {
                error: msg,
                message: "Jumlah tidak cocok dengan presisi token. Gunakan angka bulat.",
            },
        };
    }

    // === Auction lifecycle ===
    if (msg === "AUCTION_NOT_FOUND") {
        return { code: 404, body: { error: msg } };
    }
    if (msg === "AUCTION_IN_PROGRESS") {
        return {
            code: 409,
            body: {
                error: msg,
                message: "Tidak bisa start auction baru — masih ada auction yang aktif. Finalize dulu yang sedang berjalan.",
            },
        };
    }
    if (msg === "AUCTION_TOO_EARLY") {
        return {
            code: 409,
            body: {
                error: msg,
                message: "Reveal phase belum berakhir. Tunggu sampai deadline lewat sebelum finalize.",
            },
        };
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

    // === Vault / capital ===
    if (msg === "INSUFFICIENT_VAULT_CAPITAL") {
        return {
            code: 409,
            body: {
                error: msg,
                message: "Vault tidak punya cukup modal untuk mengalokasikan loan ini.",
            },
        };
    }

    // === Fallback: revert dengan pesan detail dari kontrak ===
    // Format: "PREFIX:detail..." dari classifyContractError di signer.ts
    if (msg.includes(":")) {
        const [prefix, ...rest] = msg.split(":");
        if (
            prefix === "APPROVAL_REVERTED" ||
            prefix === "AUCTION_START_REVERTED" ||
            prefix === "AUCTION_FINALIZE_REVERTED"
        ) {
            return {
                code: 409,
                body: {
                    error: prefix,
                    message: rest.join(":").slice(0, 300), // limit panjang
                },
            };
        }
    }

    // Tidak dikenali
    return null;
}

export async function adminRoutes(app: FastifyInstance) {
    // Semua route admin butuh API key
    app.addHook("onRequest", apiKeyAuth);

    // ============================================================
    // GET /status — cek admin address, balance, alamat kontrak
    // ============================================================
    app.get("/status", async () => {
        const admin = walletClient.account!.address;
        const balance = await publicClient.getBalance({ address: admin });
        return {
            adminAddress: admin,
            balanceWei: balance.toString(),
            balanceNative: (Number(balance) / 1e18).toFixed(6),
            chainId: config.CHAIN_ID,
            contracts: {
                vault: config.addresses.vault,
                auction: config.addresses.auction,
                loanManager: config.addresses.loanManager,
            },
        };
    });

    // ============================================================
    // POST /applications/:id/review — APPROVE / REJECT
    // ============================================================
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

    // ============================================================
    // POST /auctions — start auction baru
    // ============================================================
    app.post("/auctions", async (req, reply) => {
        const body = req.body as { commitDuration?: number; revealDuration?: number };

        if (!body?.commitDuration || !body?.revealDuration) {
            return reply.code(400).send({
                error: "MISSING_DURATIONS",
                message: "commitDuration and revealDuration required (seconds)",
            });
        }

        if (!Number.isInteger(body.commitDuration) || !Number.isInteger(body.revealDuration)) {
            return reply.code(400).send({
                error: "INVALID_DURATIONS",
                message: "commitDuration dan revealDuration harus bilangan bulat",
            });
        }

        if (body.commitDuration < 0 || body.revealDuration < 0) {
            return reply.code(400).send({
                error: "INVALID_DURATIONS",
                message: "commitDuration and revealDuration must be positive",
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

    // ============================================================
    // POST /auctions/:id/finalize — finalize auction
    // ============================================================
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
