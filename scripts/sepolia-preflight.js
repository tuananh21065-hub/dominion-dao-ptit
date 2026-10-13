const fs = require("fs");
const { ethers } = require("ethers");
const dotenv = require("dotenv");

dotenv.config({ path: ".env" });

const rpcConfigured = Boolean(process.env.SEPOLIA_RPC_URL);
const keyConfigured = Boolean(process.env.PRIVATE_KEY);
const etherscanConfigured = Boolean(process.env.ETHERSCAN_API_KEY);

console.log(JSON.stringify({
  targetChainId: 11155111,
  rpcConfigured,
  deployerKeyConfigured: keyConfigured,
  etherscanApiKeyConfigured: etherscanConfigured,
  rootEnvFilePresent: fs.existsSync(".env"),
}, null, 2));

if (!rpcConfigured || !keyConfigured) {
  console.error("Missing SEPOLIA_RPC_URL or PRIVATE_KEY in local .env. Values are intentionally not printed.");
  process.exitCode = 2;
} else {
  (async () => {
    const provider = new ethers.providers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== 11155111) {
      throw new Error(`Refusing to continue: RPC chain ID is ${network.chainId}, expected Sepolia 11155111.`);
    }

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const feeData = await provider.getFeeData();
    const artifact = require("../artifacts/contracts/DominionDAO.sol/DominionDAO.json");
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const unsigned = factory.getDeployTransaction();
    const gas = await provider.estimateGas({ from: wallet.address, data: unsigned.data });
    const feeWei = feeData.maxFeePerGas || feeData.gasPrice;
    const balance = await wallet.getBalance();
    const estimatedMaxCost = feeWei ? gas.mul(feeWei) : null;

    console.log(JSON.stringify({
      networkName: network.name,
      chainId: Number(network.chainId),
      deployerAddress: wallet.address,
      balanceWei: balance.toString(),
      gasEstimate: gas.toString(),
      maxFeePerGasWei: feeWei ? feeWei.toString() : null,
      estimatedMaxCostWei: estimatedMaxCost ? estimatedMaxCost.toString() : null,
      estimatedMaxCostEth: estimatedMaxCost ? ethers.utils.formatEther(estimatedMaxCost) : null,
    }, null, 2));
  })().catch((error) => {
    console.error(`Sepolia read-only preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
