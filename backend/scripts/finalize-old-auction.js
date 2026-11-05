import hardhat from "hardhat";
const { ethers } = hardhat;

async function main() {
  const auction = await ethers.getContractAt(
    "CreditAuction",
    "0x99123ADC1dc2594b94ca02A65F553E5c1d0fC4c5"
  );

  // Check current deadlines
  const commitDeadline = await auction.commitDeadline();
  const revealDeadline = await auction.revealDeadline();
  const block = await ethers.provider.getBlock("latest");

  console.log("Current block timestamp:", block.timestamp);
  console.log("Commit deadline:", commitDeadline.toString());
  console.log("Reveal deadline:", revealDeadline.toString());
  console.log("Past reveal deadline:", block.timestamp > revealDeadline);

  console.log("\nFinalizing auction...");
  const tx = await auction.finalizeAuction();
  console.log("TX hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");

  const newState = await auction.state();
  const stateNames = ["Created", "CommitPhase", "RevealPhase", "Finalized"];
  console.log("New auction state:", stateNames[Number(newState)]);
  console.log("\nDone. You can now start a new auction cycle.");
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
