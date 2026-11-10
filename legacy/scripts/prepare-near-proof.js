import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider } from 'ethers';
import { prepareNearProofs } from './near-proof-plan.js';

const txHash = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) {
  throw new Error('Usage: npm run proof:prepare -- <EVM transaction hash>');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments.json'), 'utf8'));
const rpcUrl = process.env.BSC_TESTNET_RPC || process.env.RPC_URL || deployment.rpcUrl;
const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
if (network.chainId !== BigInt(deployment.chainId)) {
  throw new Error(`RPC chain ${network.chainId} does not match deployment chain ${deployment.chainId}`);
}

const receipt = await provider.getTransactionReceipt(txHash);
if (!receipt) throw new Error(`Transaction receipt not found: ${txHash}`);
const loanManager = new Contract(
  deployment.contracts.LoanManager,
  ['function loans(uint256) view returns (address borrower, uint256 principal, uint256 rate, uint256 term, string propertyHash, bool isActive)'],
  provider,
);
const plan = await prepareNearProofs(receipt, {
  chainId: Number(network.chainId),
  auctionAddress: deployment.contracts.CreditAuction,
  loanManagerAddress: deployment.contracts.LoanManager,
  getLoanPrincipal: async (loanId) => (await loanManager.loans(loanId)).principal,
});
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
