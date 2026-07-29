import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const ACTIVE_SOURCE_MANIFEST_PATH = "apps/shopify-theme/ACTIVE-SOURCE-MANIFEST.v1.json";
export const ACTIVE_SOURCE_MANIFEST_SCHEMA_PATH = "apps/shopify-theme/ACTIVE-SOURCE-MANIFEST.v1.schema.json";
export const HISTORICAL_MIGRATION_MANIFEST_PATH = "apps/shopify-theme/MIGRATION-MANIFEST.json";
export const ACTIVE_SOURCE_MANIFEST_SCHEMA_SHA256 = "87572a846494ddb3caca4c02d4e27a64fd0701f8c3f3b7254d4fef7e355eeb87";

export const RUNTIME_ROOTS = Object.freeze([
  "assets",
  "blocks",
  "config",
  "layout",
  "locales",
  "sections",
  "snippets",
  "templates",
]);

export const GENERIC_TOOLING_PATHS = Object.freeze([
  "apps/shopify-theme/scripts/lib/shopify-filter-metafield-csv.mjs",
  "apps/shopify-theme/scripts/lib/shopify-product-copy-csv.mjs",
  "apps/shopify-theme/scripts/shopify-filter-metafield-csv.test.mjs",
  "apps/shopify-theme/scripts/shopify-product-copy-csv.test.mjs",
]);

export const PUBLIC_LAUNCH_CONTRACT_PATHS = Object.freeze([
  "apps/shopify-theme/content/launch-pages.v1.json",
  "apps/shopify-theme/content/launch-pages.v1.schema.json",
  "apps/shopify-theme/content/mandatory-name-exceptions.v1.json",
  "apps/shopify-theme/content/mandatory-name-exceptions.v1.schema.json",
  "apps/shopify-theme/content/product-facts.v3.json",
  "apps/shopify-theme/content/product-facts.v3.schema.json",
  "apps/shopify-theme/content/provider-surfaces.v1.json",
  "apps/shopify-theme/content/provider-surfaces.v1.schema.json",
  "apps/shopify-theme/content/storefront-search-expectations.v1.json",
  "apps/shopify-theme/content/storefront-search-expectations.v1.schema.json",
]);

const TOP_LEVEL_KEYS = Object.freeze([
  "$schema",
  "schemaVersion",
  "manifestId",
  "recordedDate",
  "scope",
  "historicalMigrationEvidence",
  "authority",
  "includedRoots",
  "genericTooling",
  "publicLaunchContracts",
  "files",
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameOrdered(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    sameOrdered(sorted(Object.keys(value)), sorted(expected));
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function entryFor(repoRoot, absolute) {
  return {
    path: path.relative(repoRoot, absolute).split(path.sep).join("/"),
    sha256: sha256Bytes(readFileSync(absolute)),
  };
}

export function activeSourceEntries(appRoot, repoRoot) {
  const files = RUNTIME_ROOTS
    .flatMap((root) => walk(path.join(appRoot, root)))
    .map((absolute) => entryFor(repoRoot, absolute))
    .sort((left, right) => left.path.localeCompare(right.path));
  const genericTooling = GENERIC_TOOLING_PATHS
    .map((relativePath) => entryFor(repoRoot, path.join(repoRoot, ...relativePath.split("/"))))
    .sort((left, right) => left.path.localeCompare(right.path));
  const publicLaunchContracts = PUBLIC_LAUNCH_CONTRACT_PATHS
    .map((relativePath) => entryFor(repoRoot, path.join(repoRoot, ...relativePath.split("/"))))
    .sort((left, right) => left.path.localeCompare(right.path));
  return { files, genericTooling, publicLaunchContracts };
}

export function refreshActiveSourceManifest(manifest, appRoot, repoRoot) {
  const entries = activeSourceEntries(appRoot, repoRoot);
  return {
    ...manifest,
    genericTooling: { files: entries.genericTooling },
    publicLaunchContracts: { files: entries.publicLaunchContracts },
    files: entries.files,
  };
}

function validateEntries(actual, expected, repoRoot, label, failures) {
  if (!Array.isArray(actual)) {
    failures.push(`${label} must be an array`);
    return;
  }
  const expectedPaths = expected.map((entry) => entry.path);
  const actualPaths = actual.map((entry) => entry?.path);
  if (!sameOrdered(actualPaths, sorted(actualPaths.filter((entry) => typeof entry === "string")))) {
    failures.push(`${label} entries must be sorted by path`);
  }
  if (!sameOrdered(actualPaths, expectedPaths)) {
    failures.push(`${label} file set must match the current source inventory`);
  }
  if (new Set(actualPaths).size !== actualPaths.length) failures.push(`${label} contains duplicate paths`);
  for (const entry of actual) {
    if (!exactKeys(entry, ["path", "sha256"]) || typeof entry.path !== "string" ||
        entry.path.includes("\\") || path.posix.isAbsolute(entry.path) ||
        path.posix.normalize(entry.path) !== entry.path ||
        entry.path.split("/").includes("..") || !entry.path.startsWith("apps/shopify-theme/") ||
        !/^[0-9a-f]{64}$/u.test(entry.sha256 ?? "")) {
      failures.push(`${label} contains an invalid entry`);
      continue;
    }
    try {
      const digest = sha256Bytes(readFileSync(path.join(repoRoot, ...entry.path.split("/"))));
      if (digest !== entry.sha256) failures.push(`${entry.path}: active-source SHA-256 mismatch`);
    } catch {
      failures.push(`${entry.path}: active-source file is missing or unreadable`);
    }
  }
}

export function validateActiveSourceManifest(manifest, schema, appRoot, repoRoot) {
  const failures = [];
  if (!exactKeys(manifest, TOP_LEVEL_KEYS)) failures.push("active-source manifest must use the exact v1 top-level keys");
  if (manifest?.$schema !== "./ACTIVE-SOURCE-MANIFEST.v1.schema.json" || manifest?.schemaVersion !== 1 ||
      manifest?.manifestId !== "mochirii-shopify-active-source-v1" ||
      manifest?.scope !== "current-mutable-theme-runtime-tooling-and-public-launch-contracts" ||
      manifest?.historicalMigrationEvidence !== HISTORICAL_MIGRATION_MANIFEST_PATH ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(manifest?.recordedDate ?? "")) {
    failures.push("active-source manifest identity and scope must match the v1 contract");
  }
  if (!exactKeys(manifest?.authority, [
    "providerMutationAuthorized",
    "paymentSetupAuthorized",
    "publicationAuthorized",
    "commerceAuthorized",
  ]) || Object.values(manifest.authority ?? {}).some((value) => value !== false)) {
    failures.push("active-source manifest must grant no provider, payment, publication, or commerce authority");
  }
  if (!sameOrdered(manifest?.includedRoots, RUNTIME_ROOTS)) {
    failures.push("active-source manifest includedRoots must match the complete runtime boundary");
  }
  if (!exactKeys(manifest?.genericTooling, ["files"]) ||
      !exactKeys(manifest?.publicLaunchContracts, ["files"])) {
    failures.push("active-source manifest file groups must use the exact v1 keys");
  }

  if (schema?.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
      schema?.$id !== "https://mochirii.com/contracts/active-source-manifest.v1.schema.json" ||
      schema?.type !== "object" || schema?.additionalProperties !== false ||
      !sameOrdered(sorted(schema?.required ?? []), sorted(TOP_LEVEL_KEYS)) ||
      schema?.properties?.manifestId?.const !== "mochirii-shopify-active-source-v1" ||
      sha256Bytes(Buffer.from(canonicalJson(schema), "utf8")) !== ACTIVE_SOURCE_MANIFEST_SCHEMA_SHA256) {
    failures.push("active-source manifest schema identity or root contract is invalid");
  }
  try {
    const ignored = new Set(readFileSync(path.join(appRoot, ".shopifyignore"), "utf8").split(/\r?\n/u));
    for (const filename of ["ACTIVE-SOURCE-MANIFEST.v1.json", "ACTIVE-SOURCE-MANIFEST.v1.schema.json"]) {
      if (!ignored.has(filename)) failures.push(`${filename} must remain excluded from the deployable theme package`);
    }
  } catch {
    failures.push("the deployable theme package boundary could not be read");
  }

  let expected;
  try {
    expected = activeSourceEntries(appRoot, repoRoot);
  } catch {
    failures.push("current active-source inventory could not be read");
    return failures;
  }
  validateEntries(manifest?.files, expected.files, repoRoot, "runtime files", failures);
  validateEntries(manifest?.genericTooling?.files, expected.genericTooling, repoRoot, "generic tooling", failures);
  validateEntries(
    manifest?.publicLaunchContracts?.files,
    expected.publicLaunchContracts,
    repoRoot,
    "public launch contracts",
    failures,
  );
  return failures;
}
