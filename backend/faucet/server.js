import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ClaimError, COOLDOWN_MS, createClaimLimiter } from './claim-limiter.js';

dotenv.config();

const app = express();

// Local Vite ports may change; deployed origins must be listed explicitly.
const allowedOrigins = ['https://homr.web.id', 'https://www.homr.web.id',
    ...(process.env.FAUCET_ALLOWED_ORIGINS || '').split(',')]
    .map((origin) => origin.trim().replace(/\/+$/, '')).filter(Boolean);
const isLocalOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (!isLocalOrigin(origin) && !allowedOrigins.includes(origin)) {
            return callback(new Error('This origin is not allowed by the CORS policy.'), false);
        }
        return callback(null, true);
    },
    credentials: true
}));
app.use(express.json({ limit: '2kb' }));

// 2. Setup Provider & Wallet (the configured EVM testnet)
const FAUCET_CHAIN_ID = BigInt(process.env.FAUCET_CHAIN_ID || '97');
const NETWORK_NAME = process.env.FAUCET_NETWORK_NAME || 'BNB Smart Chain Testnet';
const NATIVE_SYMBOL = process.env.FAUCET_NATIVE_SYMBOL || 'tBNB';
const EXPLORER_URL = (process.env.FAUCET_EXPLORER_URL || 'https://testnet.bscscan.com').replace(/\/+$/, '');
const provider = new ethers.JsonRpcProvider(process.env.FAUCET_RPC_URL || process.env.BSC_RPC_URL);
const wallet = new ethers.Wallet(process.env.FAUCET_PRIVATE_KEY, provider);

// MockUSDC reads and mint operation.
const MOCK_USDC_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function mint(address to, uint256 amount) external"
];
const usdcContract = new ethers.Contract(process.env.MOCK_USDC_ADDRESS, MOCK_USDC_ABI, wallet);

// Konfigurasi Jumlah Drip
const DRIP_NATIVE_AMOUNT = process.env.DRIP_NATIVE_AMOUNT || process.env.DRIP_AMOUNT_BNB || '0.1';
const DRIP_USDC_AMOUNT = process.env.DRIP_AMOUNT_USDC || '1000';
const DRIP_NATIVE = ethers.parseEther(DRIP_NATIVE_AMOUNT);
let decimalsRequest;
function getTokenDecimals() {
    if (!decimalsRequest) {
        decimalsRequest = usdcContract.decimals().then(Number).catch((error) => {
            decimalsRequest = undefined;
            throw error;
        });
    }
    return decimalsRequest;
}

async function ensureTestnet() {
    const network = await provider.getNetwork();
    if (network.chainId !== FAUCET_CHAIN_ID) throw new Error(`Faucet RPC must use ${NETWORK_NAME} (${FAUCET_CHAIN_ID}).`);
}

const claimLimiter = await createClaimLimiter({
    stateFile: process.env.FAUCET_STATE_FILE || fileURLToPath(new URL('./data/claims.json', import.meta.url)),
    maxClaimsPerHour: Number(process.env.FAUCET_MAX_CLAIMS_PER_HOUR || 60),
});

// Helper: Validasi Alamat
function isValidAddress(address) {
    try { return ethers.getAddress(address) !== ethers.ZeroAddress; } catch { return false; }
}

// ==========================================
// ENDPOINT 1: Info Saldo Faucet
// ==========================================
app.get(['/api/info', '/faucet/api/info'], async (req, res) => {
    try {
        await ensureTestnet();
        const nativeBalance = await provider.getBalance(wallet.address);
        if (nativeBalance === 0n) {
            return res.status(503).json({ success: false, wallet: wallet.address, error: `The faucet is waiting for testnet ${NATIVE_SYMBOL} funding. Please try again later.` });
        }
        const usdcBalance = await usdcContract.balanceOf(wallet.address);
        const tokenDecimals = await getTokenDecimals();
        
        res.json({
            success: true,
            wallet: wallet.address,
            bnbBalance: ethers.formatEther(nativeBalance),
            usdcBalance: ethers.formatUnits(usdcBalance, tokenDecimals),
            dripBnb: DRIP_NATIVE_AMOUNT,
            dripNative: DRIP_NATIVE_AMOUNT,
            dripUsdc: DRIP_USDC_AMOUNT,
            cooldownSeconds: COOLDOWN_MS / 1000,
            network: `${NETWORK_NAME} (Chain ID: ${FAUCET_CHAIN_ID})`
        });
    } catch (error) {
        console.error("Info Error:", error);
        res.status(500).json({ success: false, error: "Could not retrieve faucet data" });
    }
});

// ==========================================
// ENDPOINT 2: Klaim BNB (Native Token)
// ==========================================
app.post(['/api/claim-bnb', '/faucet/api/claim-bnb'], async (req, res) => {
    try {
        const { address } = req.body || {};
        if (!address || !isValidAddress(address)) return res.status(400).json({ success: false, error: "Invalid address" });
        
        const targetAddr = ethers.getAddress(address);
        const historyKey = targetAddr.toLowerCase() + '_bnb';
        
        const tx = await claimLimiter.run(historyKey, async () => {
            await ensureTestnet();
            const balance = await provider.getBalance(wallet.address);
            if (balance <= DRIP_NATIVE) throw new ClaimError(503, `The faucet has insufficient ${NATIVE_SYMBOL} for this claim.`);
        }, async () => {
            const sent = await wallet.sendTransaction({ to: targetAddr, value: DRIP_NATIVE });
            await sent.wait(1, 60000);
            return sent;
        });

        res.json({
            success: true,
            message: `Successfully sent ${ethers.formatEther(DRIP_NATIVE)} ${NATIVE_SYMBOL}!`,
            txHash: tx.hash,
            explorer: `${EXPLORER_URL}/tx/${tx.hash}`
        });
    } catch (error) {
        console.error("BNB Error:", error);
        res.status(error instanceof ClaimError ? error.status : 500).json({ success: false, error: error instanceof ClaimError ? error.message : 'Could not confirm the BNB claim. Check your wallet before retrying after the cooldown.' });
    }
});

// ==========================================
// ENDPOINT 3: Klaim MockUSDC (ERC20 Token)
// ==========================================
app.post(['/api/claim-usdc', '/faucet/api/claim-usdc'], async (req, res) => {
    try {
        const { address } = req.body || {};
        if (!address || !isValidAddress(address)) return res.status(400).json({ success: false, error: "Invalid address" });
        
        const targetAddr = ethers.getAddress(address);
        const historyKey = targetAddr.toLowerCase() + '_usdc';
        
        let dripUsdc;
        const tx = await claimLimiter.run(historyKey, async () => {
            await ensureTestnet();
            dripUsdc = ethers.parseUnits(DRIP_USDC_AMOUNT, await getTokenDecimals());
        }, async () => {
            const sent = await usdcContract.mint(targetAddr, dripUsdc);
            await sent.wait(1, 60000);
            return sent;
        });

        res.json({
            success: true,
            message: `Successfully sent ${DRIP_USDC_AMOUNT} MockUSDC!`,
            txHash: tx.hash,
            explorer: `${EXPLORER_URL}/tx/${tx.hash}`
        });
    } catch (error) {
        console.error("USDC Error:", error);
        res.status(error instanceof ClaimError ? error.status : 500).json({ success: false, error: error instanceof ClaimError ? error.message : 'Could not confirm the mUSDC claim. Check your wallet before retrying after the cooldown.' });
    }
});

// Jalankan Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
    console.log(`\n HOMR Faucet berjalan di http://localhost:${PORT}`);
    console.log(` Wallet: ${wallet.address}`);
    console.log(` Network: ${NETWORK_NAME}\n`);
});
