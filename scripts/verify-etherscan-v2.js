const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CHAIN_ID = "11155111";
const API_URL = `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}`;
const deploymentPath = path.join(__dirname, "..", "deployments", "sepolia.json");

function readBuildInfo() {
  const buildInfoDir = path.join(__dirname, "..", "artifacts", "build-info");
  const files = fs.readdirSync(buildInfoDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ file, mtime: fs.statSync(path.join(buildInfoDir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const entry of files) {
    const buildInfo = JSON.parse(fs.readFileSync(path.join(buildInfoDir, entry.file), "utf8"));
    if (buildInfo.input?.sources?.["contracts/DominionDAO.sol"]) return buildInfo;
  }
  throw new Error("No Hardhat build-info containing contracts/DominionDAO.sol was found.");
}

async function request(params) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return response.json();
}

async function main() {
  if (!process.env.ETHERSCAN_API_KEY) {
    throw new Error("ETHERSCAN_API_KEY is missing from .env.");
  }
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("deployments/sepolia.json is missing.");
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const buildInfo = readBuildInfo();
  const sourceCode = JSON.stringify(buildInfo.input);

  const submission = await request({
    apikey: process.env.ETHERSCAN_API_KEY,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: deployment.address,
    sourceCode,
    codeformat: "solidity-standard-json-input",
    contractname: "contracts/DominionDAO.sol:DominionDAO",
    compilerversion: "v0.8.19+commit.7dd6d404",
    optimizationUsed: "1",
    runs: "200",
    licenseType: "3",
  });

  console.log(JSON.stringify({
    stage: "submission",
    status: submission.status,
    message: submission.message,
    result: submission.status === "1" ? "GUID received" : submission.result,
  }, null, 2));

  if (submission.status !== "1") {
    throw new Error(`Etherscan verification submission failed: ${submission.result || submission.message}`);
  }

  const guid = submission.result;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const status = await request({
      apikey: process.env.ETHERSCAN_API_KEY,
      module: "contract",
      action: "checkverifystatus",
      guid,
    });
    console.log(JSON.stringify({
      stage: "status",
      attempt,
      status: status.status,
      message: status.message,
      result: status.result,
    }, null, 2));

    if (status.result === "Pass - Verified") return;
    if (typeof status.result === "string" && status.result.startsWith("Fail -")) {
      throw new Error(`Etherscan verification failed: ${status.result}`);
    }
  }

  throw new Error("Etherscan verification is still pending after the polling window.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
