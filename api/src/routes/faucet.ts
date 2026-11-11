import { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { mintMockUsdc } from '../chain/nearSigner.js';

export default async function faucetRoutes(app: FastifyInstance) {

    // 1. RUTE GET /info (Untuk status "Faucet ready")
    app.get('/info', async (request, reply) => {
        return reply.send({
            success: true,
            dripUsdc: "1000",
            cooldownSeconds: 3600,
            tokenContract: config.contracts.token
        });
    });

    // 2. RUTE POST /claim-usdc (INI YANG DIMINTA FRONTEND)
    app.post('/claim-usdc', async (request, reply) => {
        const { accountId } = request.body as { accountId: string };

        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID is required' });
        }

        try {
            // Panggil fungsi mintMockUsdc (signed by Admin)
            const txHash = await mintMockUsdc(accountId, "1000000000");

            return reply.send({
                success: true,
                message: 'Claimed 1000 mUSDC successfully',
                txHash: txHash
            });
        } catch (error: any) {
            app.log.error('Faucet claim failed:', error);
            return reply.status(500).send({ error: error.message || 'Faucet temporarily unavailable' });
        }
    });

    // 3. RUTE GET /claim-usdc (Untuk berjaga-jaga jika frontend mengecek saldo lewat sini)
    app.get('/claim-usdc', async (request, reply) => {
        // Frontend mungkin memanggil ini untuk mengecek status. Kita beri respons sukses.
        return reply.send({ success: true, amount: "0" });
    });

    // (Opsional) Tetap pertahankan /claim jika ada kode lain yang memakainya
    app.post('/claim', async (request, reply) => {
        const { accountId } = request.body as { accountId: string };
        if (!accountId) return reply.status(400).send({ error: 'Account ID is required' });
        try {
            const txHash = await mintMockUsdc(accountId, "1000000000");
            return reply.send({ success: true, txHash });
        } catch (error: any) {
            return reply.status(500).send({ error: error.message });
        }
    });
}