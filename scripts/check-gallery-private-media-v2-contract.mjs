import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  collectGalleryPrivateMediaV2RuntimeSources,
  summarizeGalleryPrivateMediaV2Failures,
  validateGalleryPrivateMediaV2Contract,
} from "./lib/gallery-private-media-v2-contract-validator.mjs";

const root = process.cwd();
const contractPath = "docs/integrations/gallery-private-media.v2.contract.json";
const designPath = "docs/integrations/gallery-private-media.v2.md";
const operationsPath = "docs/operations/GALLERY-PRIVATE-MEDIA-V2-ACTIVATION.md";
const failures = [];

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function requireExactLine(label, text, line) {
  const count = text.split(/\r?\n/u).filter((candidate) => candidate === line).length;
  if (count !== 1) failures.push(`[DOC_DRIFT] ${label}: expected exactly one line: ${line}`);
}

let contract;
try {
  contract = JSON.parse(read(contractPath));
} catch (error) {
  failures.push(`[CONTRACT_PARSE] ${contractPath}: ${error instanceof Error ? error.message : "invalid JSON"}`);
}

if (contract) {
  const runtimeInventory = collectGalleryPrivateMediaV2RuntimeSources(root);
  failures.push(...summarizeGalleryPrivateMediaV2Failures(
    validateGalleryPrivateMediaV2Contract(contract, { runtimeSources: runtimeInventory.sources }),
  ));
}

const design = read(designPath);
const operations = read(operationsPath);
for (const line of [
  "- Lifecycle: `DORMANT_SOURCE_ONLY`",
  "- Activation: `false`",
  "- Runtime routes registered: `false`",
  "- Runtime mutation included: `false`",
  "- Provider mutation authorized: `false`",
  "- Public mutation included: `false`",
  "- v1 compatibility: `PRESERVE_UNCHANGED`",
  "- Attribution: `UNRESOLVED` and activation-blocking",
  "- Retention: `UNRESOLVED` and activation-blocking",
  "- Account deletion: `UNRESOLVED` and activation-blocking",
  "- Viewer derivative bounds: `UNRESOLVED` and activation-blocking",
  "- Current packet cost mutation: `false`",
  "- Future activation cost classification: `COST_UNKNOWN`",
  "- Current quota and billing preflight: required and activation-blocking",
]) requireExactLine(designPath, design, line);

for (const line of [
  "- Activation state: `false`",
  "- Provider mutation authorized: `false`",
  "- Runtime/API implementation included: `false`",
  "- Migration included: `false`",
  "- Public copy change included: `false`",
  "- Current packet runtime cost mutation: `false`",
  "- Future activation cost classification: `COST_UNKNOWN`",
]) requireExactLine(operationsPath, operations, line);

for (const [label, text] of [[designPath, design], [operationsPath, operations]]) {
  for (const pattern of [
    /Attribution:\s*`(?:APPROVED|RESOLVED|COMPLETE)`/iu,
    /Retention:\s*`(?:APPROVED|RESOLVED|COMPLETE)`/iu,
    /Account deletion:\s*`(?:APPROVED|RESOLVED|COMPLETE)`/iu,
    /Viewer derivative bounds:\s*`(?:APPROVED|RESOLVED|COMPLETE)`/iu,
    /cost classification:\s*`COST_NEUTRAL`/iu,
    /Activation(?: state)?:\s*`true`/iu,
  ]) {
    if (pattern.test(text)) failures.push(`[DOC_OVERCLAIM] ${label}: unsupported claim matched ${pattern}.`);
  }
}

if (failures.length) {
  console.error("Gallery private-media v2 contract validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Gallery private-media v2 contract validation OK (dormant; no runtime routes).");
