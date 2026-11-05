import hardhat from "hardhat";
const { ethers, network } = hardhat;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  console.log("=========================================");
  console.log("HOMR Deployment");
  console.log("=========================================");
  console.log("Network       :", network.name);
  console.log("Chain ID      :", network.config.chainId);
  console.log("Deployer      :", deployerAddress);
  console.log(
    "Balance       :",
    ethers.formatEther(await ethers.provider.getBalance(deployerAddress)),
    network.name === "auroraTestnet" ? "ETH" : "native token"
  );
  console.log("=========================================");

  // === 1. MockUSDC ===
  console.log("\n[1/4] Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const mockUSDCAddress = await mockUSDC.getAddress();
  console.log("      MockUSDC          :", mockUSDCAddress);

  // === 2. HousingCreditVault ===
  console.log("\n[2/4] Deploying HousingCreditVault...");
  const Vault = await ethers.getContractFactory("HousingCreditVault");
  const vault = await Vault.deploy(mockUSDCAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("      HousingCreditVault:", vaultAddress);

  // === 3. LoanManager ===
  console.log("\n[3/4] Deploying LoanManager...");
  const LoanManager = await ethers.getContractFactory("LoanManager");
  const loanManager = await LoanManager.deploy(vaultAddress, mockUSDCAddress);
  await loanManager.waitForDeployment();
  const loanManagerAddress = await loanManager.getAddress();
  console.log("      LoanManager       :", loanManagerAddress);

  // === 4. CreditAuction (constructor: loanManager, vault) ===
  console.log("\n[4/4] Deploying CreditAuction...");
  const CreditAuction = await ethers.getContractFactory("CreditAuction");
  const auction = await CreditAuction.deploy(loanManagerAddress, vaultAddress);
  await auction.waitForDeployment();
  const auctionAddress = await auction.getAddress();
  console.log("      CreditAuction     :", auctionAddress);

  // === 5. Setup Roles ===
  console.log("\n=========================================");
  console.log("Setting up roles...");
  console.log("=========================================");

  console.log("[roles] Vault: LOAN_MANAGER_ROLE -> LoanManager");
  const vaultLoanMgrTx = await vault.grantRole(
    await vault.LOAN_MANAGER_ROLE(),
    loanManagerAddress
  );
  await vaultLoanMgrTx.wait();

  console.log("[roles] LoanManager: AUCTION_MANAGER_ROLE -> CreditAuction");
  const lmAuctionMgrTx = await loanManager.grantRole(
    await loanManager.AUCTION_MANAGER_ROLE(),
    auctionAddress
  );
  await lmAuctionMgrTx.wait();

  console.log("[roles] CreditAuction: CREDIT_MANAGER_ROLE -> Deployer");
  const auctionCreditMgrTx = await auction.grantRole(
    await auction.CREDIT_MANAGER_ROLE(),
    deployerAddress
  );
  await auctionCreditMgrTx.wait();

  console.log("[roles] CreditAuction: AUCTION_MANAGER_ROLE -> Deployer");
  const auctionAuctionMgrTx = await auction.grantRole(
    await auction.AUCTION_MANAGER_ROLE(),
    deployerAddress
  );
  await auctionAuctionMgrTx.wait();

  console.log("All roles granted.");

  // === 6. Ambil deploy block (untuk indexer) ===
  const deployBlock = await ethers.provider.getBlockNumber();
  console.log("\nDeploy block:", deployBlock);

  // === 7. Tulis DEPLOY_NOTES.md (human-readable) ===
  const chainId = network.config.chainId ?? 0;
  const rpcUrl = network.config.url ?? "(local)";
  const explorerUrl = chainId === 97
    ? "https://testnet.bscscan.com"
    : chainId === 1313161555
      ? "https://testnet.aurorascan.dev"
      : "";

  const deployNotes = `# HOMR Deployment Notes

## Network
- Name: ${network.name}
- Chain ID: ${chainId}
- RPC URL: ${rpcUrl}
- Explorer: ${explorerUrl || "(local)"}
- Deploy Block: ${deployBlock}

## Deployer
- Address: ${deployerAddress}

## Contracts
- MockUSDC:           ${mockUSDCAddress}
- HousingCreditVault: ${vaultAddress}
- LoanManager:        ${loanManagerAddress}
- CreditAuction:      ${auctionAddress}

## Roles Setup
- Vault.LOAN_MANAGER_ROLE         -> LoanManager (${loanManagerAddress})
- LoanManager.AUCTION_MANAGER_ROLE -> CreditAuction (${auctionAddress})
- CreditAuction.CREDIT_MANAGER_ROLE -> Deployer (${deployerAddress})
- CreditAuction.AUCTION_MANAGER_ROLE -> Deployer (${deployerAddress})

## Backend .env (copy-paste)
\`\`\`
CHAIN_ID=${chainId}
NETWORK_NAME=${chainId === 1313161555 ? "Aurora Testnet" : chainId === 97 ? "BNB Smart Chain Testnet" : "Local development"}
NATIVE_CURRENCY_NAME=${chainId === 1313161555 ? "Ether" : "BNB"}
NATIVE_CURRENCY_SYMBOL=${chainId === 1313161555 ? "ETH" : "tBNB"}
EXPLORER_NAME=${chainId === 1313161555 ? "AuroraScan" : "BscScan"}
RPC_URL=${rpcUrl}
EXPLORER_URL=${explorerUrl}
VAULT_ADDRESS=${vaultAddress}
AUCTION_ADDRESS=${auctionAddress}
LOAN_MANAGER_ADDRESS=${loanManagerAddress}
MOCK_USDC_ADDRESS=${mockUSDCAddress}
DEPLOY_BLOCK=${deployBlock}
\`\`\`
`;

  const notesPath = path.join(__dirname, "../../DEPLOY_NOTES.md");
  fs.writeFileSync(notesPath, deployNotes.trim());
  console.log("\n✅ Saved DEPLOY_NOTES.md at:", notesPath);

  // === 8. Tulis deployments.json (machine-readable) ===
  const deployments = {
    network: network.name,
    chainId,
    rpcUrl,
    deployBlock,
    deployer: deployerAddress,
    contracts: {
      MockUSDC: mockUSDCAddress,
      HousingCreditVault: vaultAddress,
      LoanManager: loanManagerAddress,
      CreditAuction: auctionAddress,
    },
    deployedAt: new Date().toISOString(),
  };

  const deployJsonPath = path.join(__dirname, "../../deployments.json");
  fs.writeFileSync(deployJsonPath, JSON.stringify(deployments, null, 2));
  console.log("✅ Saved deployments.json at:", deployJsonPath);

  console.log("\n=========================================");
  console.log("Deployment complete!");
  console.log("=========================================");
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:");
  console.error(error);
  process.exitCode = 1;
});
