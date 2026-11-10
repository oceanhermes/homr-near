import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";

import { parseNep297Log } from "../src/chain/nep297.js";
import { buildNep413Payload, verifyNep413Signature } from "../src/lib/nep413.js";

// ---------------------------------------------------------------------------
// NEP-297 parsing (B8/C1)
// ---------------------------------------------------------------------------

test("parses a well-formed NEP-297 EVENT_JSON log", () => {
    const event = parseNep297Log(
        'EVENT_JSON:{"standard":"homr","version":"1.0.0","event":"loan_issued","data":{"loan_id":1,"principal":"1000"}}'
    );
    assert.deepEqual(event, {
        standard: "homr",
        version: "1.0.0",
        event: "loan_issued",
        data: { loan_id: 1, principal: "1000" },
    });
});

test("accepts an array-shaped data payload", () => {
    const event = parseNep297Log(
        'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_mint","data":[{"owner_id":"a","amount":"1"}]}'
    );
    assert.ok(event);
    assert.equal(event?.event, "ft_mint");
    assert.ok(Array.isArray(event?.data));
});

test("ignores logs without the EVENT_JSON: prefix", () => {
    assert.equal(parseNep297Log('{"standard":"homr","event":"loan_issued","data":{}}'), null);
    assert.equal(parseNep297Log("LOG: something happened"), null);
    assert.equal(parseNep297Log(""), null);
});

test("rejects malformed JSON instead of throwing", () => {
    assert.equal(parseNep297Log("EVENT_JSON:{not json"), null);
    assert.equal(parseNep297Log("EVENT_JSON:"), null);
});

test("rejects data that is not a JSON object", () => {
    // `data` as a bare string / number / null is not valid NEP-297
    assert.equal(parseNep297Log('EVENT_JSON:{"standard":"homr","event":"x","data":"oops"}'), null);
    assert.equal(parseNep297Log('EVENT_JSON:{"standard":"homr","event":"x","data":7}'), null);
    assert.equal(parseNep297Log('EVENT_JSON:{"standard":"homr","event":"x","data":null}'), null);
    assert.equal(parseNep297Log('EVENT_JSON:{"standard":"homr","event":"x"}'), null);
});

test("rejects events missing standard or event name", () => {
    assert.equal(parseNep297Log('EVENT_JSON:{"event":"x","data":{}}'), null);
    assert.equal(parseNep297Log('EVENT_JSON:{"standard":"homr","data":{}}'), null);
});

// ---------------------------------------------------------------------------
// NEP-413 admin signatures (B9)
// ---------------------------------------------------------------------------

/** Sign a NEP-413 payload exactly like a NEAR wallet does. */
function signNep413(
    keyPair: nacl.SignKeyPair,
    args: { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string }
): string {
    const payload = buildNep413Payload({
        message: args.message,
        nonce: Buffer.from(args.nonce),
        recipient: args.recipient,
        callbackUrl: args.callbackUrl,
    });
    const hash = crypto.createHash("sha256").update(payload).digest();
    const sig = nacl.sign.detached(hash, keyPair.secretKey);
    return "ed25519:" + bs58.encode(sig);
}

test("NEP-413 payload is domain-separated with the 2^31+413 tag", () => {
    const payload = buildNep413Payload({
        message: "homr admin",
        nonce: Buffer.alloc(32, 1),
        recipient: "homr-api",
    });
    assert.equal(payload.readUInt32LE(0), 2147484061);
    // 4 (tag) + 4 (len) + len(msg) + 32 (nonce) + 4 (len) + len(recipient) + 1 (Option::None)
    assert.equal(payload.length, 4 + 4 + 10 + 32 + 4 + 8 + 1);
    assert.equal(payload[payload.length - 1], 0);
});

test("verifies a genuine NEP-413 signature", () => {
    const keyPair = nacl.sign.keyPair();
    const nonce = crypto.randomBytes(32);
    const message = "homr-admin:login:1700000000";
    const signature = signNep413(keyPair, { message, nonce, recipient: "homr-api" });

    assert.equal(
        verifyNep413Signature({
            message,
            nonce,
            recipient: "homr-api",
            publicKey: "ed25519:" + bs58.encode(keyPair.publicKey),
            signature,
        }),
        true
    );
});

test("rejects a tampered message, wrong recipient, or wrong key", () => {
    const keyPair = nacl.sign.keyPair();
    const otherKey = nacl.sign.keyPair();
    const nonce = crypto.randomBytes(32);
    const message = "homr-admin:login:1700000000";
    const signature = signNep413(keyPair, { message, nonce, recipient: "homr-api" });
    const publicKey = "ed25519:" + bs58.encode(keyPair.publicKey);

    // tampered message
    assert.equal(
        verifyNep413Signature({ message: message + "x", nonce, recipient: "homr-api", publicKey, signature }),
        false
    );
    // wrong recipient (replay to another service)
    assert.equal(
        verifyNep413Signature({ message, nonce, recipient: "evil-api", publicKey, signature }),
        false
    );
    // signature from a different key
    assert.equal(
        verifyNep413Signature({
            message,
            nonce,
            recipient: "homr-api",
            publicKey: "ed25519:" + bs58.encode(otherKey.publicKey),
            signature,
        }),
        false
    );
    // malformed signature does not throw
    assert.equal(
        verifyNep413Signature({ message, nonce, recipient: "homr-api", publicKey, signature: "not-a-sig" }),
        false
    );
});
