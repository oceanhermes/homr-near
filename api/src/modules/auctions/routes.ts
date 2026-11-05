import type { FastifyInstance } from "fastify";
import { startAuction, listAuctions, finalizeAuction } from "./service.js";

export async function auctionRoutes(app: FastifyInstance) {
    // Public: list auctions
    app.get("/auctions", async () => {
        const auctions = await listAuctions();
        return { auctions };
    });
}