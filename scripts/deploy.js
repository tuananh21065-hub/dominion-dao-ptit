const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  if (![31337, 11155111].includes(Number(network.chainId))) {
    throw new Error(`Refusing to deploy on unsupported chain ID ${network.chainId}.`);
  }
  if (hre.network.name === "sepolia" && Number(network.chainId) !== 11155111) {
    throw new Error(`Refusing to deploy: the sepolia network resolved to chain ID ${network.chainId}.`);
  }

  const factory = await hre.ethers.getContractFactory("DominionDAO");
  const dao = await factory.deploy();
  const receipt = await dao.deployTransaction.wait();
  const bytecode = await hre.ethers.provider.getCode(dao.address);
  const effectiveGasPrice = receipt.effectiveGasPrice || receipt.gasPrice;
  const fee = receipt.gasUsed.mul(effectiveGasPrice);

  const deployment = {
    contract: "DominionDAO",
    address: dao.address,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: effectiveGasPrice.toString(),
    feeWei: fee.toString(),
    feeEth: hre.ethers.utils.formatEther(fee),
    bytecodeLength: (bytecode.length - 2) / 2,
    deployedAt: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`DominionDAO deployed to ${dao.address}`);
  console.log(`Network: ${hre.network.name} (${network.chainId})`);
  console.log(`Transaction hash: ${receipt.transactionHash}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  console.log(`Effective gas price: ${effectiveGasPrice.toString()} wei`);
  console.log(`Deployment fee: ${hre.ethers.utils.formatEther(fee)} ETH`);
  console.log(`Runtime bytecode: ${deployment.bytecodeLength} bytes`);
  console.log(`Deployment metadata: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
