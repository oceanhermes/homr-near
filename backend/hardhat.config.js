import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";

// === Validasi env di awal — error jelas sebelum compile/deploy ===
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const BNB_TESTNET_RPC = process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const AURORA_TESTNET_RPC = process.env.AURORA_TESTNET_RPC || "https://testnet.aurora.dev";

// Kalau PRIVATE_KEY ada tapi formatnya salah, hentikan sekarang
if (PRIVATE_KEY) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(PRIVATE_KEY)) {
    throw new Error(
      "PRIVATE_KEY format invalid. Expected 0x + 64 hex chars. Got length " +
      PRIVATE_KEY.length
    );
  }
} else {
  console.warn(
    "[hardhat.config] PRIVATE_KEY not set — 'tbnb' network will fail to deploy. Set it in backend/.env"
  );
}

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    // Local testing
    hardhat: {
      chainId: 31337,
    },

    // Local node (npx hardhat node)
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // BNB Chain Testnet
    tbnb: {
      url: BNB_TESTNET_RPC,
      chainId: 97,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },

    auroraTestnet: {
      url: AURORA_TESTNET_RPC,
      chainId: 1313161555,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },

  // Path eksplisit — konsisten dengan struktur folder
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

 
    etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "bscTestnet",
        chainId: 97,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://testnet.bscscan.com"
        }
      }
    ]
  },
};
