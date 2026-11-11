import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { DRIP_USDC, faucetLegacyRoutes, faucetRoutes } from "../src/routes/faucet.js";

async function buildApp(
    t: { after: (fn: () => Promise<unknown>) => void },
    mint: (accountId: string, amount: string) => Promise<string>,
    now?: () => number
): Promise<FastifyInstance> {
    const app = Fastify();
    t.after(() => app.close());
    await app.register(faucetRoutes, { prefix: "/api", mint, now, claims: new Map() });
    await app.register(faucetLegacyRoutes, { prefix: "/faucet", mint, now, claims: new Map() });
    return app;
}

test("reports the claim amount the frontend renders", async (t) => {
    const app = await buildApp(t, async () => "near_tx_hash");

    for (const url of ["/api/info", "/api/faucet/info", "/faucet/api/info"]) {
        const response = await app.inject({ url });
        assert.equal(response.statusCode, 200);
        assert.equal(response.json().success, true);
        assert.equal(response.json().dripUsdc, "1000");
        assert.equal(response.json().cooldownSeconds, 3600);
    }
});

test("mints 1000 mUSDC to the claimed account through every supported route", async (t) => {
    const calls: Array<{ accountId: string; amount: string }> = [];
    const app = await buildApp(t, async (accountId, amount) => {
        calls.push({ accountId, amount });
        return "near_tx_hash";
    });

    const routes = [
        { url: "/api/faucet/claim", body: { account_id: "borrower.testnet" } },
        { url: "/api/claim-usdc", body: { accountId: "audit.testnet" } },
        { url: "/faucet/api/claim-usdc", body: { accountId: "vault.testnet" } },
    ];

    for (const { url, body } of routes) {
        const response = await app.inject({ method: "POST", url, payload: body });
        assert.equal(response.statusCode, 200);
        const payload = response.json();
        assert.equal(payload.success, true);
        assert.equal(payload.txHash, "near_tx_hash");
        assert.equal(payload.message, "Successfully sent 1000 mUSDC!");
        assert.match(payload.explorer, /\/txns\/near_tx_hash$/);
    }

    assert.deepEqual(calls, [
        { accountId: "borrower.testnet", amount: DRIP_USDC },
        { accountId: "audit.testnet", amount: DRIP_USDC },
        { accountId: "vault.testnet", amount: DRIP_USDC },
    ]);
});

test("rejects an invalid account ID before signing", async (t) => {
    let minted = 0;
    const app = await buildApp(t, async () => {
        minted += 1;
        return "near_tx_hash";
    });

    const response = await app.inject({
        method: "POST",
        url: "/api/faucet/claim",
        payload: { account_id: "Not An Account!" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().success, false);
    assert.equal(minted, 0);
});

test("enforces a one hour cooldown per account", async (t) => {
    let now = 1_000_000;
    const app = await buildApp(t, async () => "near_tx_hash", () => now);

    const first = await app.inject({
        method: "POST", url: "/api/claim-usdc", payload: { accountId: "alice.testnet" },
    });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({
        method: "POST", url: "/api/claim-usdc", payload: { accountId: "alice.testnet" },
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().retryAfterSeconds, 3600);

    now += 3600 * 1000;
    const third = await app.inject({
        method: "POST", url: "/api/claim-usdc", payload: { accountId: "alice.testnet" },
    });
    assert.equal(third.statusCode, 200);
});

test("fails loudly and releases the cooldown when the mint does not land", async (t) => {
    let attempt = 0;
    const app = await buildApp(t, async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("Transaction failed. account does not exist");
        return "near_tx_hash";
    });

    const failed = await app.inject({
        method: "POST", url: "/api/faucet/claim", payload: { account_id: "bob.testnet" },
    });
    assert.equal(failed.statusCode, 502);
    assert.match(failed.json().error, /Transaction failed/);

    const retried = await app.inject({
        method: "POST", url: "/api/faucet/claim", payload: { account_id: "bob.testnet" },
    });
    assert.equal(retried.statusCode, 200);
    assert.equal(retried.json().txHash, "near_tx_hash");
});
