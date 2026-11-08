import Fastify from "fastify";
import helmet from "@fastify/helmet";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { healthRoutes } from "./routes/health.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";
import { demoRoutes } from "./routes/demo.js";
import { applicationRoutes } from "./modules/applications/routes.js";
import { auctionRoutes } from "./modules/auctions/routes.js";
import { startIndexer } from "./chain/nearIndexer.js";
import { registerCors } from "./lib/cors.js";

// === BigInt JSON patch ===
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
    return this.toString();
};

const app = Fastify({ logger: false, trustProxy: true });

await app.register(helmet);

await registerCors(app, config.CORS_ORIGIN);

await app.register(healthRoutes);
await app.register(publicRoutes, { prefix: "/api" });
await app.register(applicationRoutes, { prefix: "/api" });
await app.register(auctionRoutes, { prefix: "/api" });
await app.register(adminRoutes, { prefix: "/api/admin" });
await app.register(demoRoutes, { prefix: "/api" });

startIndexer().catch((err) => logger.error("NEAR Indexer crashed", err));

try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    logger.info(`HOMR NEAR API listening on :${config.PORT}`);
} catch (err) {
    logger.error("Failed to start server", err);
    process.exit(1);
}
