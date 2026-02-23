// protocol/scripts/generate-abis.ts
// Run with: node --loader ts-node/esm scripts/generate-abis.ts
// Or add to package.json: "generate-abis": "tsx scripts/generate-abis.ts"

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_OUT = path.resolve(__dirname, "../../core/out");
const OUT_FILE = path.resolve(__dirname, "../src/abis.ts");

const CONTRACTS = [
  "PostRegistry",
  "StakeEngine",
  "LinkGraph",
  "ProtocolViews",
  "VSPToken",
];

function loadAbi(name: string): unknown[] {
  const file = path.join(CORE_OUT, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Artifact not found: ${file}\nRun: cd core && forge build`);
  }
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  return json.abi;
}

const lines: string[] = [
  "// GENERATED FILE — do not edit manually.",
  "// Regenerate with: npm run generate-abis",
  "// Source: core/out/ (Foundry build artifacts)",
  "",
];

for (const name of CONTRACTS) {
  const abi = loadAbi(name);
  lines.push(
    `export const ${name}ABI = ${JSON.stringify(abi, null, 2)} as const;`,
  );
  lines.push("");
  console.log(`✓ ${name}`);
}

fs.writeFileSync(OUT_FILE, lines.join("\n"));
console.log(`\nWrote ${OUT_FILE}`);
