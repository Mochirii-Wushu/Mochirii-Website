import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(appRoot, "MIGRATION-MANIFEST.json");
const approvedCopyPath = path.join(appRoot, "content/approved-customer-copy.json");
const SEALED_MANIFEST_SHA256 = "30e690423668ae0b2bc36bd3beac75e2044a267a41d5bbdd0ca1ac9b38b83a53";
const EXPECTED_APPROVED_COPY_PATH = "apps/shopify-theme/content/approved-customer-copy.json";
const failures = [];
let manifest;

const bytes = readFileSync(manifestPath);
const digest = (value) => createHash("sha256").update(value).digest("hex");
if (digest(bytes) !== SEALED_MANIFEST_SHA256) {
  failures.push("MIGRATION-MANIFEST.json must remain byte-for-byte identical to the sealed 2026-07-19 evidence");
}
try {
  manifest = JSON.parse(bytes.toString("utf8"));
} catch {
  failures.push("MIGRATION-MANIFEST.json must remain valid JSON");
}

if (manifest) {
  if (manifest.schemaVersion !== 7 ||
      manifest.migrationId !== "mochirii-shopify-live-runtime-launch-completeness-v3-2026-07-19" ||
      manifest.snapshotDate !== "2026-07-19" || manifest.signature?.status !== "unsigned") {
    failures.push("sealed migration-history identity is invalid");
  }
  const approvedFiles = manifest.approvedPublicCopy?.files ?? [];
  if (approvedFiles.length !== 1 || approvedFiles[0]?.path !== EXPECTED_APPROVED_COPY_PATH ||
      !/^[0-9a-f]{64}$/u.test(approvedFiles[0]?.sha256 ?? "")) {
    failures.push("sealed approved-public-copy evidence is invalid");
  } else if (digest(readFileSync(approvedCopyPath)) !== approvedFiles[0].sha256) {
    failures.push("approved-customer-copy.json no longer matches the sealed migration evidence");
  }
}

if (failures.length > 0) {
  console.error("Sealed migration-history manifest check failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Sealed migration-history manifest OK (SHA-256 ${SEALED_MANIFEST_SHA256}; ` +
  "current mutable source is validated by ACTIVE-SOURCE-MANIFEST.v1.json).",
);
