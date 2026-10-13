const fs = require("fs");
const path = require("path");

const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "DominionDAO.sol", "DominionDAO.json");
const outputPath = path.join(__dirname, "..", "frontend", "src", "abi", "DominionDAO.json");

if (!fs.existsSync(artifactPath)) {
  throw new Error("Contract artifact not found. Run npm run compile first.");
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
fs.writeFileSync(outputPath, `${JSON.stringify({ abi: artifact.abi }, null, 2)}\n`);
console.log(`Synchronized DominionDAO ABI to ${outputPath}`);
