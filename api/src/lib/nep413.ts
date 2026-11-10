/**
 * NEP-413 (`signMessage`) payload construction and signature verification.
 *
 * Payload layout (per https://github.com/near/NEPs/blob/master/neps/nep-0413.md):
 *   u32le(2^31 + 413) || borsh(message) || nonce[32] || borsh(recipient) || Option(callbackUrl)
 * then sha256 → Ed25519 detached signature.
 *
 * Note: NEP-413 does NOT use an EIP-191-style "\x19Near Signed Message:\n"
 * prefix; domain separation comes from the 4-byte tag 2^31+413, which also
 * makes the signed bytes impossible to mistake for a valid NEAR transaction.
 *
 * Kept free of DB/config imports so it can be unit-tested in isolation.
 */
import nacl from "tweetnacl";
import bs58 from "bs58";
import crypto from "crypto";

const NEP413_TAG = 2147484061; // 2^31 + 413

function u32le(value: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value, 0);
    return buf;
}

/** Borsh string encoding: u32 length (LE) + utf-8 bytes. */
function borshString(value: string): Buffer {
    const bytes = Buffer.from(value, "utf-8");
    return Buffer.concat([u32le(bytes.length), bytes]);
}

export interface Nep413PayloadArgs {
    message: string;
    /** Exactly 32 raw bytes (the wallet receives these, not the base64 text). */
    nonce: Buffer;
    recipient: string;
    callbackUrl?: string;
}

export function buildNep413Payload(args: Nep413PayloadArgs): Buffer {
    const callback =
        args.callbackUrl === undefined
            ? Buffer.from([0]) // borsh Option::None
            : Buffer.concat([Buffer.from([1]), borshString(args.callbackUrl)]);
    return Buffer.concat([
        u32le(NEP413_TAG),
        borshString(args.message),
        args.nonce,
        borshString(args.recipient),
        callback,
    ]);
}

/** Accept `ed25519:<base58>` (API style) or raw base64 (wallet style, 64 bytes). */
function decodeSignature(signature: string): Buffer {
    if (signature.startsWith("ed25519:")) {
        return Buffer.from(bs58.decode(signature.slice("ed25519:".length)));
    }
    const base64 = Buffer.from(signature, "base64");
    if (base64.length === 64) return base64;
    return Buffer.from(bs58.decode(signature));
}

export function verifyNep413Signature(
    args: Nep413PayloadArgs & {
        publicKey: string; // "ed25519:<base58>"
        signature: string;
    }
): boolean {
    try {
        const pubKeyBytes = Buffer.from(bs58.decode(args.publicKey.replace(/^ed25519:/, "")));
        if (pubKeyBytes.length !== 32) return false;
        const sigBytes = decodeSignature(args.signature);
        if (sigBytes.length !== 64) return false;
        if (args.nonce.length !== 32) return false;

        const payload = buildNep413Payload(args);
        const hash = crypto.createHash("sha256").update(payload).digest();
        return nacl.sign.detached.verify(hash, sigBytes, pubKeyBytes);
    } catch {
        return false;
    }
}
