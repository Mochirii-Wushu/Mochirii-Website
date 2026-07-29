import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_SOURCE_MANIFEST_PATH,
  refreshActiveSourceManifest,
} from "./lib/active-source-manifest.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");
const manifestPath = path.join(repoRoot, ...ACTIVE_SOURCE_MANIFEST_PATH.split("/"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const refreshed = refreshActiveSourceManifest(manifest, appRoot, repoRoot);

writeFileSync(manifestPath, `${JSON.stringify(refreshed, null, 2)}\n`, "utf8");
console.log(
  `Updated active-source manifest for ${refreshed.files.length} runtime files, ` +
  `${refreshed.genericTooling.files.length} generic tooling files, and ` +
  `${refreshed.publicLaunchContracts.files.length} public launch-contract files.`,
);
