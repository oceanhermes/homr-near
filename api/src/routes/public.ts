import type { FastifyInstance } from "fastify";
import { getVaultState } from "../chain/contracts.js";
import { config } from "../config.js";
import { prisma } from "../db/client.js";

export async function publicRoutes(app: FastifyInstance) {
    app.get("/vault", async () => {
        const state = await getVaultState();
        return {
            ...state,
            chainId: config.CHAIN_ID,
            vaultAddress: config.addresses.vault,
            explorerUrl: `${config.EXPLORER_URL}/address/${config.addresses.vault}`,
        };
    });

    app.get("/loans", async () => {
        const loans = await prisma.loan.findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        return { loans };
    });

    app.get("/loans/:id", async (req, reply) => {
        const { id } = req.params as { id: string };
        const loan = await prisma.loan.findUnique({
            where: { id },
            include: { repayments: true },
        });
        if (!loan) return reply.code(404).send({ error: "not_found" });
        return loan;
    });

    app.get("/events", async (req, reply) => {
        const { limit = "50" } = req.query as { limit?: string };
        const n = Number(limit);
        if (Number.isNaN(n) || n < 1) {
            return reply.code(400).send({
                error: "invalid_limit",
                message: "limit harus angka >= 1",
            });
        }
        const take = Math.min(Math.floor(n), 200);
        const events = await prisma.chainEvent.findMany({
            orderBy: { blockNumber: "desc" },
            take,
        });
        return { events };
    });
}