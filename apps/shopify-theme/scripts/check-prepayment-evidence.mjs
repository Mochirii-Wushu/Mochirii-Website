import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  summarizePrepaymentGateIssues,
  validatePrepaymentEvidenceBundle,
} from "./lib/prepayment-evidence-gate.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const HELP = `Usage:
  npm run gate:prepayment-complete -- --bundle <ignored-prepayment-bundle.json>

The bundle must be a regular ignored, untracked JSON file under .artifacts/operations.
This command reads local evidence only. It does not access or mutate Shopify.\n`;

function output(gate, category, count = 1) {
  const stream = category === "pass" ? process.stdout : process.stderr;
  stream.write(`gate=${gate} category=${category} count=${count}\n`);
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  if (argv.length !== 2 || argv[0] !== "--bundle" || typeof argv[1] !== "string" || argv[1].length === 0) {
    return null;
  }
  return { bundlePath: path.resolve(argv[1]) };
}

const args = parseArguments(process.argv.slice(2));
if (args?.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (!args) {
  output("prepayment", "arguments", 1);
  process.exit(2);
}

let bundle;
try {
  bundle = JSON.parse(readFileSync(args.bundlePath, "utf8"));
} catch {
  output("prepayment", "bundle-parse", 1);
  process.exit(1);
}

let result;
try {
  result = validatePrepaymentEvidenceBundle(bundle, {
    repositoryRoot,
    bundlePath: args.bundlePath,
  });
} catch {
  output("prepayment", "validation-error", 1);
  process.exit(2);
}

if (!result.ok) {
  for (const issue of summarizePrepaymentGateIssues(result.issues)) {
    output(issue.gate, issue.category, issue.count);
  }
  process.exit(1);
}

const publicContractChecks = [
  ["product-facts", path.join(appRoot, "scripts", "check-product-facts.mjs"), "--require-complete"],
  ["launch-content", path.join(appRoot, "scripts", "check-launch-content-contracts.mjs"), "--require-launch-ready"],
  ["provider-surfaces", path.join(appRoot, "scripts", "check-provider-surfaces.mjs"), null],
];
for (const [gate, script, argument] of publicContractChecks) {
  const check = spawnSync(process.execPath, argument === null ? [script] : [script, argument], {
    cwd: appRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (check.status !== 0) {
    output(gate, "public-contract-incomplete", 1);
    process.exit(1);
  }
}

output("prepayment", "pass", 1);
