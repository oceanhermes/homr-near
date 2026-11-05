import hardhat from "hardhat";
const { ethers } = hardhat;

async function main() {
  const [signer] = await ethers.getSigners();
  const address = await signer.getAddress();
  const deployer = "0xEDCBD7A4A4935eC62730b18f6E2616d615cA3d6c";
  console.log("Signer address:", address);
  console.log("Expected deployer:", deployer);
  console.log("Match:", address.toLowerCase() === deployer.toLowerCase());

  const auction = await ethers.getContractAt(
    "CreditAuction",
    "0x99123ADC1dc2594b94ca02A65F553E5c1d0fC4c5"
  );
  const state = await auction.state();
  const stateNames = ["Created", "CommitPhase", "RevealPhase", "Finalized"];
  console.log("\nAuction state:", stateNames[Number(state)] || state);

  const hasAuctionMgr = await auction.hasRole(
    await auction.AUCTION_MANAGER_ROLE(),
    address
  );
  console.log("Has AUCTION_MANAGER_ROLE:", hasAuctionMgr);

  const hasCreditMgr = await auction.hasRole(
    await auction.CREDIT_MANAGER_ROLE(),
    address
  );
  console.log("Has CREDIT_MANAGER_ROLE:", hasCreditMgr);

  const hasAdmin = await auction.hasRole(
    await auction.DEFAULT_ADMIN_ROLE(),
    address
  );
  console.log("Has DEFAULT_ADMIN_ROLE:", hasAdmin);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
