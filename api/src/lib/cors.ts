import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

const webOrigins = ["https://homr.web.id", "https://www.homr.web.id"];

export function allowedOrigins(configured: string) {
    return [...new Set([...webOrigins, ...configured.split(",")]
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean))];
}

export async function registerCors(app: FastifyInstance, configured: string) {
    await app.register(cors, {
        origin: allowedOrigins(configured),
        credentials: true,
    });
}
