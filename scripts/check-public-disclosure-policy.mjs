import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const policyPath = resolve("scripts/public-disclosure-policy.json");
const repositoryRoot = realpathSync(resolve("."));
const trackedPaths = new Set(
  execFileSync("git", ["ls-files", "-z"], { cwd: repositoryRoot, encoding: "utf8" })
    .split("\0")
    .filter(Boolean),
);
const packageScripts = new Map([
  ["root", packageJson("package.json").scripts || {}],
  ["web", packageJson("apps/web/package.json").scripts || {}],
]);
const failures = [];
const requiredClassifications = [
  "REQUIRED_PROTOCOL",
  "REQUIRED_ACCESSIBILITY",
  "REQUIRED_LEGAL_OR_LICENSE",
  "APPROVED_DISCOVERABILITY",
  "APPROVED_OPERATIONAL",
  "REMOVE",
];
const requiredDisclosureIds = [
  "canonical-discovery-metadata",
  "next-build-identity",
  "supabase-public-endpoint",
  "provider-network-origins",
  "official-profile-identities",
  "authentication-provider-presentation",
  "discord-schedule-identifiers",
  "event-social-contract-identifiers",
  "vercel-observability",
  "social-upstream-attribution",
  "accessible-names-and-alt-text",
];
const requiredExceptionIds = [
  "approved-authentication-providers",
  "approved-official-guild-profiles",
  "required-social-license-notice",
  "approved-game-and-community-identifiers",
];

if (!existsSync(policyPath)) fail("scripts/public-disclosure-policy.json is missing");
let policy = {};
try {
  policy = JSON.parse(readFileSync(policyPath, "utf8"));
} catch (error) {
  fail(`policy is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

assert(policy.schemaVersion === 2, "schemaVersion must equal 2");
for (const invalidSourcePath of [".", "../package.json", resolve(repositoryRoot, "package.json")]) {
  assert(!inspectSourcePath(invalidSourcePath).ok, `source-path containment canary accepted ${invalidSourcePath}`);
}
assert(inspectSourcePath("package.json").ok, "source-path containment canary rejected a tracked repository file");
assert(
  JSON.stringify(policy.classifications) === JSON.stringify(requiredClassifications),
  "classification inventory must match the reviewed ordered contract",
);

validateRows("disclosures", policy.disclosures, requiredDisclosureIds, (entry) => {
  assert(requiredClassifications.includes(entry.classification), `${entry.id}: invalid classification`);
  for (const field of ["field", "owner", "purpose", "exposure", "retention"]) {
    assert(typeof entry[field] === "string" && entry[field].trim().length >= 12, `${entry.id}: ${field} must be explanatory`);
  }
  validateStringArray(entry, "surfaces");
  validateSourcePaths(entry);
  validateVerification(entry);
});

validateRows("externalNameExceptions", policy.externalNameExceptions, requiredExceptionIds, (entry) => {
  validateStringArray(entry, "names");
  validateStringArray(entry, "surfaces");
  validateSourcePaths(entry);
  assert(typeof entry.approval === "string" && entry.approval.trim().length >= 20, `${entry.id}: approval basis must be recorded`);
});

const serialized = JSON.stringify(policy);
for (const forbidden of [
  "http://",
  "localhost",
  "127.0.0.1",
  "service_role",
  "access_token",
  "client_secret",
  "private_key",
]) {
  assert(!serialized.toLowerCase().includes(forbidden), `policy must not contain forbidden private/local marker ${forbidden}`);
}

if (failures.length) {
  console.error("Public disclosure policy validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Public disclosure policy validation OK.");
console.log(`- Classified disclosures: ${policy.disclosures.length}.`);
console.log(`- Explicit external-name exception groups: ${policy.externalNameExceptions.length}.`);

function validateRows(label, rows, requiredIds, validate) {
  assert(Array.isArray(rows), `${label} must be an array`);
  if (!Array.isArray(rows)) return;
  const ids = rows.map((entry) => entry?.id);
  assert(new Set(ids).size === ids.length, `${label} IDs must be unique`);
  assert(JSON.stringify(ids) === JSON.stringify(requiredIds), `${label} IDs must match the reviewed ordered contract`);
  rows.forEach((entry) => {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry?.id || ""), `${label}: invalid ID ${entry?.id || "missing"}`);
    validate(entry || {});
  });
}

function validateStringArray(entry, field) {
  const values = entry[field];
  assert(Array.isArray(values) && values.length > 0, `${entry.id}: ${field} must be a non-empty array`);
  if (!Array.isArray(values)) return;
  assert(values.every((value) => typeof value === "string" && value.trim().length > 0), `${entry.id}: ${field} contains an invalid value`);
  assert(new Set(values).size === values.length, `${entry.id}: ${field} contains a duplicate value`);
}

function validateSourcePaths(entry) {
  validateStringArray(entry, "sourcePaths");
  for (const sourcePath of entry.sourcePaths || []) {
    const inspection = inspectSourcePath(sourcePath);
    assert(inspection.ok, `${entry.id}: ${inspection.reason}: ${sourcePath}`);
  }
}

function inspectSourcePath(sourcePath) {
  if (typeof sourcePath !== "string" || sourcePath === "." ||
      sourcePath.includes("\\") || isAbsolute(sourcePath)) {
    return { ok: false, reason: "source path must be a specific repository-relative file" };
  }
  const absolute = resolve(repositoryRoot, sourcePath);
  if (!existsSync(absolute)) return { ok: false, reason: "source path does not exist" };
  const real = realpathSync(absolute);
  const fromRoot = relative(repositoryRoot, real);
  const escapes = fromRoot === "" || fromRoot === ".." ||
    fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(fromRoot);
  if (escapes) return { ok: false, reason: "source path escapes the repository" };
  if (!statSync(real).isFile()) return { ok: false, reason: "source path must identify one file" };
  if (!trackedPaths.has(sourcePath)) {
    return { ok: false, reason: "source path must be tracked at its exact repository path" };
  }
  return { ok: true, reason: "" };
}

function validateVerification(entry) {
  const rows = entry.verification;
  assert(Array.isArray(rows) && rows.length > 0, `${entry.id}: verification must be a non-empty array`);
  if (!Array.isArray(rows)) return;
  const identities = [];
  for (const row of rows) {
    const exactShape = row && typeof row === "object" && !Array.isArray(row) &&
      JSON.stringify(Object.keys(row).sort()) === JSON.stringify(["script", "workspace"]);
    assert(exactShape, `${entry.id}: each verification row must contain only workspace and script`);
    if (!exactShape) continue;
    assert(packageScripts.has(row.workspace), `${entry.id}: unknown verification workspace ${row.workspace}`);
    const scripts = packageScripts.get(row.workspace) || {};
    assert(typeof row.script === "string" && Object.hasOwn(scripts, row.script), `${entry.id}: unknown ${row.workspace} package script ${row.script}`);
    identities.push(`${row.workspace}:${row.script}`);
  }
  assert(new Set(identities).size === identities.length, `${entry.id}: verification contains a duplicate script reference`);
}

function packageJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  failures.push(message);
}
