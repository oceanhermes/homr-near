import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

export async function healthRoutes(app: FastifyInstance) {
    app.get("/health", async () => ({
        ok: true,
        service: "homr-api",
        env: config.NODE_ENV,
        chainId: config.NEAR_NETWORK_ID,
        ts: new Date().toISOString(),
    }));
}