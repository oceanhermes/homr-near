import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const COOLDOWN_MS = 60 * 60 * 1000;

export class ClaimError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export async function createClaimLimiter({ stateFile, maxClaimsPerHour = 60, now = Date.now }) {
    if (!Number.isSafeInteger(maxClaimsPerHour) || maxClaimsPerHour < 1) {
        throw new Error('FAUCET_MAX_CLAIMS_PER_HOUR must be a positive integer.');
    }
    await mkdir(dirname(stateFile), { recursive: true });
    let claims = [];
    try {
        const saved = JSON.parse(await readFile(stateFile, 'utf8'));
        if (saved.version !== 1 || !Array.isArray(saved.claims) || saved.claims.some((claim) =>
            typeof claim.key !== 'string' || !Number.isFinite(claim.at) || claim.at < 0)) {
            throw new Error('Invalid faucet claim state. Restore it before restarting.');
        }
        claims = saved.claims;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    let queue = Promise.resolve();
    let queued = 0;

    return {
        async run(key, prepare, send) {
            if (queued >= 8) throw new ClaimError(503, 'The faucet is busy. Please try again shortly.');
            queued++;
            const task = queue.then(async () => {
                const timestamp = now();
                const recent = claims.filter((claim) => timestamp - claim.at < COOLDOWN_MS);
                if (recent.some((claim) => claim.key === key)) {
                    throw new ClaimError(429, 'Wait 1 hour before claiming this token again.');
                }
                if (recent.length >= maxClaimsPerHour) {
                    throw new ClaimError(429, 'The hourly faucet limit has been reached. Please try again later.');
                }
                await prepare();
                const reserved = [...recent, { key, at: timestamp }];
                const temporary = `${stateFile}.${randomUUID()}.tmp`;
                await writeFile(temporary, JSON.stringify({ version: 1, claims: reserved }), { mode: 0o600, flag: 'wx' });
                await rename(temporary, stateFile);
                claims = reserved;
                // Keep the reservation if a broadcast or confirmation is uncertain.
                return send();
            });
            queue = task.catch(() => {});
            try {
                return await task;
            } finally {
                queued--;
            }
        },
    };
}
