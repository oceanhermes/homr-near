import type { FastifyRequest, FastifyReply } from "fastify";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { config } from "../config.js";
import crypto from "crypto";

export async function adminAuth(req: FastifyRequest, reply: FastifyReply) {
    const apiKey = req.headers["x-api-key"];
    if (apiKey === config.ADMIN_API_KEY) {
        return; // Dev bypass with API key
    }

    // NEP-413 verification
    const signature = req.headers["x-near-signature"] as string;
    const publicKeyStr = req.headers["x-near-public-key"] as string;
    const accountId = req.headers["x-near-account-id"] as string;
    const nonce = req.headers["x-near-nonce"] as string;
    const message = req.headers["x-near-message"] as string;

    if (!signature || !publicKeyStr || !accountId || !nonce || !message) {
        return reply.code(401).send({
            error: "UNAUTHORIZED",
            message: "Missing x-api-key or valid NEP-413 authentication headers",
        });
    }

    if (accountId !== config.ADMIN_ACCOUNT_ID) {
        return reply.code(403).send({
            error: "FORBIDDEN",
            message: `Account ${accountId} is not an authorized admin`,
        });
    }

    try {
        const rawPublicKey = publicKeyStr.replace(/^ed25519:/, "");
        const pubKeyBytes = bs58.decode(rawPublicKey);
        const sigBytes = bs58.decode(signature);

        // NEP-413 payload hashing
        // prefix: 0x80000000 | 413 = 2147484061
        const prefix = Buffer.alloc(4);
        prefix.writeUInt32LE(2147484061, 0);

        const msgBuffer = Buffer.from(message, "utf-8");
        const recipientBuffer = Buffer.from(config.ADMIN_ACCOUNT_ID, "utf-8");
        const nonceBuffer = Buffer.from(nonce, "base64");

        const payload = Buffer.concat([prefix, msgBuffer, recipientBuffer, nonceBuffer]);
        const hash = crypto.createHash("sha256").update(payload).digest();

        const valid = nacl.sign.detached.verify(hash, sigBytes, pubKeyBytes);
        if (!valid) {
            return reply.code(401).send({ error: "INVALID_NEP413_SIGNATURE" });
        }
    } catch {
        return reply.code(401).send({ error: "NEP413_VERIFICATION_FAILED" });
    }
}

