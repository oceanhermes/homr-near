import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";
import { verifyNep413Signature } from "../lib/nep413.js";

/**
 * B9: Admin authentication.
 *
 * Two accepted mechanisms:
 *  1. (Dev only) static `x-api-key` matching ADMIN_API_KEY — disabled in production.
 *  2. NEP-413 `signMessage` signature over a challenge, verified against an
 *     allowlist of admin account IDs (config.adminAccountIds).
 *
 * Payload/signature details live in ../lib/nep413.ts.
 */

export async function adminAuth(req: FastifyRequest, reply: FastifyReply) {
    // 1. Dev bypass: static API key (non-production only).
    const apiKey = req.headers["x-api-key"];
    if (apiKey && apiKey === config.ADMIN_API_KEY && !config.isProd) {
        return;
    }

    // 2. NEP-413 signature against the admin allowlist.
    const signature = req.headers["x-near-signature"] as string | undefined;
    const publicKey = req.headers["x-near-public-key"] as string | undefined;
    const accountId = req.headers["x-near-account-id"] as string | undefined;
    const nonce = req.headers["x-near-nonce"] as string | undefined;
    const message = req.headers["x-near-message"] as string | undefined;
    const callbackUrl = req.headers["x-near-callback-url"] as string | undefined;

    if (!signature || !publicKey || !accountId || !nonce || !message) {
        return reply.code(401).send({
            error: "UNAUTHORIZED",
            message:
                "Missing x-api-key (dev) or NEP-413 auth headers (x-near-account-id, x-near-public-key, x-near-signature, x-near-nonce, x-near-message)",
        });
    }

    if (!config.adminAccountIds.includes(accountId)) {
        return reply.code(403).send({
            error: "FORBIDDEN",
            message: `Account ${accountId} is not in the admin allowlist`,
        });
    }

    const nonceBytes = Buffer.from(nonce, "base64");
    if (nonceBytes.length !== 32) {
        return reply.code(401).send({
            error: "INVALID_NONCE",
            message: "x-near-nonce must be base64 for exactly 32 bytes",
        });
    }

    const valid = verifyNep413Signature({
        message,
        nonce: nonceBytes,
        recipient: config.nep413Recipient,
        callbackUrl: callbackUrl || undefined,
        publicKey,
        signature,
    });
    if (!valid) {
        return reply.code(401).send({ error: "INVALID_NEP413_SIGNATURE" });
    }
}
