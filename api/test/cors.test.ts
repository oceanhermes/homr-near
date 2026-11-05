import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { allowedOrigins, registerCors } from "../src/lib/cors.js";

test("keeps both public HOMR domains when the environment only lists the apex domain", () => {
    assert.deepEqual(allowedOrigins("https://homr.web.id/, http://localhost:5173, "), [
        "https://homr.web.id", "https://www.homr.web.id", "http://localhost:5173",
    ]);
});

for (const origin of ["https://homr.web.id", "https://www.homr.web.id", "http://localhost:5173"]) {
    test(`application reads and submission preflights allow ${origin}`, async (t) => {
        const app = Fastify();
        t.after(() => app.close());
        await registerCors(app, "https://homr.web.id,http://localhost:5173");
        app.get("/api/applications", async () => ({ applications: [] }));

        const read = await app.inject({ url: "/api/applications", headers: { origin } });
        assert.equal(read.statusCode, 200);
        assert.equal(read.headers["access-control-allow-origin"], origin);
        assert.deepEqual(read.json(), { applications: [] });

        const preflight = await app.inject({
            method: "OPTIONS", url: "/api/applications",
            headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
        });
        assert.equal(preflight.statusCode, 204);
        assert.equal(preflight.headers["access-control-allow-origin"], origin);
        assert.match(String(preflight.headers["access-control-allow-methods"]), /POST/);
        assert.match(String(preflight.headers["access-control-allow-headers"]), /content-type/);
    });
}

test("does not allow an unrelated site to read credentialed API responses", async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    await registerCors(app, "");
    app.get("/api/applications", async () => ({ applications: [] }));
    const response = await app.inject({ url: "/api/applications", headers: { origin: "https://unrelated.example" } });
    assert.equal(response.headers["access-control-allow-origin"], undefined);
});
