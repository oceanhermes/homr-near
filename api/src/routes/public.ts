import type { FastifyInstance } from "fastify";
import { getVaultState } from "../chain/nearRpc.js";
import { config } from "../config.js";
import { prisma } from "../db/client.js";

export async function publicRoutes(app: FastifyInstance) {
    app.get("/vault", async () => {
        const state = await getVaultState();
        return {
            ...state,
            networkId: config.NEAR_NETWORK_ID,
            vaultContract: config.contracts.vault,
            explorerUrl: `${config.NEAR_EXPLORER_URL}/address/${config.contracts.vault}`,
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
                message: "limit must be a number >= 1",
            });
        }
        const take = Math.min(Math.floor(n), 200);
        const events = await prisma.chainEvent.findMany({
            orderBy: { blockHeight: "desc" },
            take,
        });
        return { events };
    });
}
