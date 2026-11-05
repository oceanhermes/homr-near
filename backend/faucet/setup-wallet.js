import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Wallet } from 'ethers';
import dotenv from 'dotenv';

const target = resolve(process.argv[2] || '.env');
let existing;
try {
    existing = dotenv.parse(await readFile(target, 'utf8'));
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}

if (existing) {
    console.log(`Existing faucet wallet: ${new Wallet(existing.FAUCET_PRIVATE_KEY).address}`);
} else {
    const wallet = Wallet.createRandom();
    await writeFile(target, [
        'BSC_RPC_URL=https://bsc-testnet-rpc.publicnode.com',
        `FAUCET_PRIVATE_KEY=${wallet.privateKey}`,
        'MOCK_USDC_ADDRESS=0x68F7aAbB357cEF15F8245468f4b66619Bbba051a',
        'DRIP_AMOUNT_BNB=0.1',
        'DRIP_AMOUNT_USDC=1000',
        'FAUCET_ALLOWED_ORIGINS=https://homr.web.id,https://www.homr.web.id',
        'FAUCET_MAX_CLAIMS_PER_HOUR=60',
        '',
    ].join('\n'), { mode: 0o600, flag: 'wx' });
    console.log(`Created dedicated faucet wallet: ${wallet.address}`);
}
