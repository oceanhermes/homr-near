import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

export async function apiKeyAuth(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers["x-api-key"];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided || provided !== config.ADMIN_API_KEY) {
        return reply.code(401).send({ error: "unauthorized", message: "Invalid or missing x-api-key" });
    }
}