import type { FastifyInstance } from "fastify";
import {
    createApplication,
    listApplications,
    getApplication,
} from "./service.js";

export async function applicationRoutes(app: FastifyInstance) {
    // Public: borrower submit application
    app.post("/applications", async (req, reply) => {
        const body = req.body as {
            walletAddress?: string;
            accountId?: string;
            displayName: string;
            propertyHash: string;
            requestedAmount: string;
            requestedRate: number;
            requestedTerm: number;
        };

        const identifier = body?.accountId || body?.walletAddress;
        if (!identifier || !body?.propertyHash) {
            return reply.code(400).send({ error: "accountId (or walletAddress) and propertyHash required" });
        }

        try {
            const result = await createApplication({
                ...body,
                accountId: identifier,
            });
            return reply.code(201).send(result);
        } catch (err) {
            app.log.error(err);
            return reply.code(500).send({ error: "create_failed", message: (err as Error).message });
        }
    });

    // Public: list all applications
    app.get("/applications", async () => {
        const apps = await listApplications();
        return { applications: apps };
    });

    // Public: get one application
    app.get("/applications/:id", async (req, reply) => {
        const { id } = req.params as { id: string };
        const application = await getApplication(id);
        if (!application) return reply.code(404).send({ error: "not_found" });
        return application;
    });
}
