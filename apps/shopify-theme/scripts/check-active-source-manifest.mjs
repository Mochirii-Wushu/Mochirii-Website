import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_SOURCE_MANIFEST_PATH,
  ACTIVE_SOURCE_MANIFEST_SCHEMA_PATH,
  validateActiveSourceManifest,
} from "./lib/active-source-manifest.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(repoRoot, ...relativePath.split("/")), "utf8"));
const failures = [];
let manifest;
let schema;

try {
  manifest = readJson(ACTIVE_SOURCE_MANIFEST_PATH);
  schema = readJson(ACTIVE_SOURCE_MANIFEST_SCHEMA_PATH);
} catch {
  failures.push("active-source manifest or schema is missing or invalid JSON");
}
if (manifest && schema) failures.push(...validateActiveSourceManifest(manifest, schema, appRoot, repoRoot));

if (failures.length > 0) {
  console.error("Active-source manifest check failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Active-source manifest OK (${manifest.files.length} runtime files, ` +
  `${manifest.genericTooling.files.length} generic tooling files, and ` +
  `${manifest.publicLaunchContracts.files.length} public launch-contract files).`,
);
