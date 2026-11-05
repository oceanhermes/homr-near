import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COOLDOWN_MS, createClaimLimiter } from '../claim-limiter.js';

async function fixture(t, options = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'homr-faucet-'));
    assert.ok(directory.startsWith(join(tmpdir(), 'homr-faucet-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const stateFile = join(directory, 'claims.json');
    const limiter = await createClaimLimiter({ stateFile, ...options });
    return { limiter, stateFile, directory };
}

test('simultaneous duplicate claims broadcast only once', async (t) => {
    const { limiter } = await fixture(t);
    let broadcasts = 0;
    const send = async () => ++broadcasts;
    const results = await Promise.allSettled([
        limiter.run('wallet_bnb', async () => {}, send),
        limiter.run('wallet_bnb', async () => {}, send),
    ]);
    assert.equal(broadcasts, 1);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].reason.status, 429);
});

test('serializes different token claims through the shared wallet', async (t) => {
    const { limiter } = await fixture(t);
    let finishFirst;
    const order = [];
    const first = limiter.run('wallet_bnb', async () => {}, async () => {
        order.push('bnb');
        await new Promise((resolve) => { finishFirst = resolve; });
        order.push('bnb-confirmed');
    });
    const second = limiter.run('wallet_usdc', async () => {}, async () => order.push('usdc'));
    while (!finishFirst) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ['bnb']);
    finishFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['bnb', 'bnb-confirmed', 'usdc']);
});

test('preserves cooldown on restart and allows claims after one hour', async (t) => {
    let time = 1000;
    const { limiter, stateFile } = await fixture(t, { now: () => time });
    await limiter.run('wallet_bnb', async () => {}, async () => 'tx');
    const restarted = await createClaimLimiter({ stateFile, now: () => time });
    await assert.rejects(restarted.run('wallet_bnb', async () => {}, async () => 'duplicate'), { status: 429 });
    time += COOLDOWN_MS;
    assert.equal(await restarted.run('wallet_bnb', async () => {}, async () => 'next'), 'next');
});

test('retains the reservation when transaction confirmation fails', async (t) => {
    const { limiter, stateFile } = await fixture(t);
    await assert.rejects(limiter.run('wallet_usdc', async () => {}, async () => {
        throw new Error('Confirmation timed out');
    }), /timed out/);
    const restarted = await createClaimLimiter({ stateFile });
    await assert.rejects(restarted.run('wallet_usdc', async () => {}, async () => 'duplicate'), { status: 429 });
});

test('failed network or balance checks do not consume a claim', async (t) => {
    const { limiter } = await fixture(t);
    let broadcasts = 0;
    await assert.rejects(limiter.run('wallet_bnb', async () => { throw new Error('Wrong chain'); }, async () => broadcasts++), /Wrong chain/);
    assert.equal(broadcasts, 0);
    await limiter.run('wallet_bnb', async () => {}, async () => broadcasts++);
    assert.equal(broadcasts, 1);
});

test('enforces a persistent global limit across addresses and tokens', async (t) => {
    const { limiter, stateFile } = await fixture(t, { maxClaimsPerHour: 2 });
    await limiter.run('wallet-a_bnb', async () => {}, async () => {});
    await limiter.run('wallet-b_usdc', async () => {}, async () => {});
    const restarted = await createClaimLimiter({ stateFile, maxClaimsPerHour: 2 });
    await assert.rejects(restarted.run('wallet-c_bnb', async () => {}, async () => {}), /hourly faucet limit/);
});

test('stores the reservation before sending and rejects corrupted state', async (t) => {
    const { limiter, stateFile } = await fixture(t);
    await limiter.run('wallet_bnb', async () => {}, async () => {
        const saved = JSON.parse(await readFile(stateFile, 'utf8'));
        assert.equal(saved.claims[0].key, 'wallet_bnb');
    });
    await writeFile(stateFile, 'invalid json');
    await assert.rejects(createClaimLimiter({ stateFile }));
});

test('does not send when state cannot be persisted', async (t) => {
    const { limiter, directory } = await fixture(t);
    await rm(join(directory, 'claims.json'), { force: true });
    await rm(directory, { recursive: true });
    let sent = false;
    await assert.rejects(limiter.run('wallet_bnb', async () => {}, async () => { sent = true; }));
    assert.equal(sent, false);
});
