import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, posix, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = join(
  repositoryRoot,
  "docs",
  "operations",
  "META-GALLERY-PUBLISHING-RELEASE-MANIFEST-2026-07-29.json",
);
const migrationsDirectory = join(repositoryRoot, "supabase", "migrations");
const sha256Pattern = /^[a-f0-9]{64}$/u;

function fail(message) {
  console.error(`Meta Gallery release manifest check failed: ${message}`);
  process.exit(1);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

if (!existsSync(manifestPath)) {
  fail("the immutable release manifest is missing");
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`the release manifest is not valid JSON: ${error.message}`);
}

if (manifest.schemaVersion !== 1) {
  fail("schemaVersion must be 1");
}

if (!Array.isArray(manifest.migrations) || manifest.migrations.length !== 13) {
  fail("the focused release must contain exactly 13 migrations");
}

const migrationNames = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
  .sort();
const baseIndex = migrationNames.indexOf(manifest.baseMigration);
const ceilingIndex = migrationNames.indexOf(manifest.releaseMigrationCeiling);

if (baseIndex < 0 || ceilingIndex < 0 || ceilingIndex <= baseIndex) {
  fail("the declared base or release ceiling migration is missing or unordered");
}

const expectedReleasePaths = migrationNames
  .slice(baseIndex + 1, ceilingIndex + 1)
  .map((name) => `supabase/migrations/${name}`);
const declaredPaths = manifest.migrations.map((entry) => entry.path);

if (JSON.stringify(declaredPaths) !== JSON.stringify(expectedReleasePaths)) {
  fail("the declared migration allowlist does not match the ordered release range");
}

if (basename(manifest.migrations.at(-1)?.path ?? "") !== manifest.generatedMigration) {
  fail("the CLI-generated final migration is not the release ceiling");
}

const seen = new Set();
const canonicalLines = [];

for (const entry of manifest.migrations) {
  if (
    typeof entry?.path !== "string" ||
    !entry.path.startsWith("supabase/migrations/") ||
    entry.path !== posix.normalize(entry.path) ||
    seen.has(entry.path)
  ) {
    fail(`invalid or duplicate migration path: ${String(entry?.path)}`);
  }
  seen.add(entry.path);

  if (typeof entry.sha256 !== "string" || !sha256Pattern.test(entry.sha256)) {
    fail(`invalid SHA-256 for ${entry.path}`);
  }

  const absolutePath = resolve(repositoryRoot, ...entry.path.split("/"));
  const relativePath = relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  if (relativePath !== entry.path || !existsSync(absolutePath)) {
    fail(`migration path escapes the repository or is missing: ${entry.path}`);
  }

  const actualHash = sha256(readFileSync(absolutePath));
  if (actualHash !== entry.sha256) {
    fail(`migration hash mismatch: ${entry.path}`);
  }

  canonicalLines.push(`${entry.path}\t${entry.sha256}`);
}

const manifestHash = sha256(canonicalLines.join("\n"));
if (!sha256Pattern.test(manifest.manifestSha256 ?? "")) {
  fail("manifestSha256 is missing or invalid");
}
if (manifestHash !== manifest.manifestSha256) {
  fail("manifestSha256 does not match the canonical migration allowlist");
}

console.log(
  `Meta Gallery release manifest OK: ${manifest.migrations.length} migrations, SHA-256 ${manifestHash}`,
);
