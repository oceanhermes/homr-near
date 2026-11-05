import hardhat from "hardhat";
const { ethers } = hardhat;

async function main() {
  const auction = await ethers.getContractAt(
    "CreditAuction",
    "0x99123ADC1dc2594b94ca02A65F553E5c1d0fC4c5"
  );

  const commitDuration = 3600; // 1 jam
  const revealDuration = 3600; // 1 jam

  console.log("Starting new auction...");
  const tx = await auction.startAuction(commitDuration, revealDuration);
  console.log("TX hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");

  const newState = await auction.state();
  const stateNames = ["Created", "CommitPhase", "RevealPhase", "Finalized"];
  console.log("New auction state:", stateNames[Number(newState)]);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
