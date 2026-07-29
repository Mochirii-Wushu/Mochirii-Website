import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = resolve(root, "docs/integrations/integration-exposure-catalog.v1.json");
const configPath = resolve(root, "supabase/config.toml");
const hostedRuntimePath = resolve(root, "docs/integrations/hosted-runtime.json");
const packagePath = resolve(root, "package.json");
const failures = [];

const catalog = readJson(catalogPath, "integration exposure catalog");
const hostedRuntime = readJson(hostedRuntimePath, "hosted runtime catalog");
const packageJson = readJson(packagePath, "root package");
const configFunctions = parseFunctionConfig(readFileSync(configPath, "utf8"));

const expectedTopLevelKeys = [
  "schemaVersion",
  "scope",
  "factBoundary",
  "jwtSummary",
  "dataClassDefinitions",
  "destinations",
  "authProfiles",
  "disableControls",
  "runbookProfiles",
  "verificationProfiles",
  "integrations",
  "edgeFunctions",
];
assertExactKeys(catalog, expectedTopLevelKeys, "catalog");

if (catalog?.schemaVersion !== 1) fail("catalog schemaVersion must be 1");
if (catalog?.factBoundary?.secretValuesAllowed !== false) {
  fail("catalog must forbid secret values");
}
if (!String(catalog?.factBoundary?.runtimeFacts || "").includes("require a fresh authorized runtime readback")) {
  fail("catalog must distinguish runtime readbacks from repository facts");
}

const forbiddenSecretPatterns = [
  /\bsb_secret_[A-Za-z0-9_-]{12,}\b/u,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/u,
  /https:\/\/[^\s/:]+:[^\s/@]+@/u,
  /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/u,
];
const rawCatalog = readFileSync(catalogPath, "utf8");
for (const pattern of forbiddenSecretPatterns) {
  if (pattern.test(rawCatalog)) fail(`catalog contains a forbidden secret-like value matching ${pattern}`);
}
if (/"(?:secretValue|accessToken|refreshToken|clientSecret|password)"\s*:/iu.test(rawCatalog)) {
  fail("catalog contains a forbidden secret-value field");
}

const dataClassIds = new Set(Object.keys(catalog?.dataClassDefinitions || {}));
for (const [id, definition] of Object.entries(catalog?.dataClassDefinitions || {})) {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(id)) {
    fail(`data class ${id} must be a lowercase snake-case ID`);
  }
  assertExactKeys(definition, ["classification", "description"], `data class ${id}`);
  if (!["public", "operational", "internal", "confidential"].includes(definition?.classification)) {
    fail(`data class ${id} has an invalid classification`);
  }
  assertText(definition?.description, `data class ${id} description`);
}

const destinations = indexById(catalog?.destinations, "destination");
for (const destination of destinations.values()) {
  assertExactKeys(destination, ["id", "kind", "sourceRefs"], `destination ${destination.id}`);
  assertId(destination.id, `destination ${destination.id}`);
  assertText(destination.kind, `destination ${destination.id} kind`);
  assertSourceRefs(destination.sourceRefs, `destination ${destination.id}`);
}

const authProfiles = indexById(catalog?.authProfiles, "auth profile");
for (const profile of authProfiles.values()) {
  assertExactKeys(profile, ["id", "gatewayVerifyJwt", "boundary", "sourceRefs"], `auth profile ${profile.id}`);
  if (typeof profile.gatewayVerifyJwt !== "boolean") fail(`auth profile ${profile.id} gatewayVerifyJwt must be boolean`);
  assertText(profile.boundary, `auth profile ${profile.id} boundary`);
  assertSourceRefs(profile.sourceRefs, `auth profile ${profile.id}`);
}

const disableControls = indexById(catalog?.disableControls, "disable control");
for (const control of disableControls.values()) {
  assertExactKeys(control, ["id", "control", "sourceRefs"], `disable control ${control.id}`);
  assertText(control.control, `disable control ${control.id}`);
  assertSourceRefs(control.sourceRefs, `disable control ${control.id}`);
}

const runbookProfiles = indexById(catalog?.runbookProfiles, "runbook profile");
for (const profile of runbookProfiles.values()) {
  assertExactKeys(profile, ["id", "paths"], `runbook profile ${profile.id}`);
  assertSourceRefs(profile.paths, `runbook profile ${profile.id}`);
}

const verificationProfiles = indexById(catalog?.verificationProfiles, "verification profile");
const rootScripts = packageJson?.scripts || {};
for (const profile of verificationProfiles.values()) {
  assertExactKeys(profile, ["id", "commands"], `verification profile ${profile.id}`);
  assertNonEmptyStrings(profile.commands, `verification profile ${profile.id} commands`);
  for (const command of profile.commands || []) {
    if (!Object.hasOwn(rootScripts, command)) fail(`verification profile ${profile.id} references missing package script ${command}`);
  }
}

const integrationOwners = new Set([
  "backend-engineering",
  "commerce-operations",
  "community-operations",
  "content-operations",
  "game-engineering",
  "identity-operations",
  "release-engineering",
  "social-operations",
  "website-engineering",
]);
const functionOwners = new Set([
  ...integrationOwners,
  "gallery-operations",
  "guild-moderators",
  "profile-operations",
  "raffle-operations",
]);

const integrations = indexById(catalog?.integrations, "integration");
for (const integration of integrations.values()) validateIntegration(integration);

const hostedCoverage = new Map([
  ["website", "website"],
  ["storefront", "storefront"],
  ["backend", "backend"],
  ["social", "social"],
  ["discord-interactions", "discord-community"],
  ["release-automation", "release-automation"],
]);
const hostedIds = new Set((hostedRuntime?.runtimes || []).map((runtime) => runtime?.id));
for (const [hostedId, integrationId] of hostedCoverage) {
  if (!hostedIds.has(hostedId)) fail(`hosted runtime ${hostedId} is missing`);
  if (!integrations.has(integrationId)) fail(`hosted runtime ${hostedId} is not covered by catalog integration ${integrationId}`);
}
for (const hostedId of hostedIds) {
  if (!hostedCoverage.has(hostedId)) fail(`hosted runtime ${hostedId} has no integration catalog mapping`);
}

const functions = indexById(catalog?.edgeFunctions, "Edge Function");
const configuredNames = [...configFunctions.keys()];
const catalogNames = [...functions.keys()];
if (!sameStrings(configuredNames, catalogNames)) {
  fail("Edge Function IDs must match every function declared in supabase/config.toml exactly");
}
if (functions.size !== 33) fail(`Edge Function catalog must contain exactly 33 entries, found ${functions.size}`);

let verifyJwtTrue = 0;
let verifyJwtFalse = 0;
for (const entry of functions.values()) {
  validateFunction(entry, configFunctions.get(entry.id));
  if (entry.verifyJwt) verifyJwtTrue += 1;
  else verifyJwtFalse += 1;
}

const galleryIngestAuth = authProfiles.get("discord-gallery-ingest-hmac");
const galleryIngestFunction = functions.get("submit-discord-gallery-image");
if (authProfiles.has("reaper-ingest-secret")) {
  fail("retired static-secret Gallery ingest auth profile must not remain in the catalog");
}
if (galleryIngestFunction?.auth !== "discord-gallery-ingest-hmac") {
  fail("submit-discord-gallery-image must reference the body-bound HMAC auth profile");
}
for (const detail of ["HMAC-SHA256", "method", "exact function path", "one-use nonce"]) {
  if (!String(galleryIngestAuth?.boundary || "").includes(detail)) {
    fail(`Gallery ingest HMAC boundary must document ${detail}`);
  }
}
for (const sourceRef of [
  "supabase/functions/_shared/discord-gallery-ingest-auth.ts",
  "supabase/migrations/20260729130654_add_discord_gallery_ingest_hmac_replay_guard.sql",
]) {
  if (!galleryIngestAuth?.sourceRefs?.includes(sourceRef)) {
    fail(`Gallery ingest HMAC profile must reference ${sourceRef}`);
  }
}

if (verifyJwtTrue !== 20 || verifyJwtFalse !== 13) {
  fail(`Edge Function JWT split must remain 20 true / 13 false, found ${verifyJwtTrue}/${verifyJwtFalse}`);
}
assertExactKeys(catalog?.jwtSummary, ["total", "verifyJwtTrue", "verifyJwtFalse", "trueRationale", "falseRationale"], "JWT summary");
if (catalog?.jwtSummary?.total !== functions.size) fail("JWT summary total does not match function inventory");
if (catalog?.jwtSummary?.verifyJwtTrue !== verifyJwtTrue) fail("JWT summary true count does not match function inventory");
if (catalog?.jwtSummary?.verifyJwtFalse !== verifyJwtFalse) fail("JWT summary false count does not match function inventory");
assertText(catalog?.jwtSummary?.trueRationale, "JWT true rationale");
assertText(catalog?.jwtSummary?.falseRationale, "JWT false rationale");

if (failures.length) {
  console.error("Integration exposure catalog check failed.");
  [...new Set(failures)].sort().forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Integration exposure catalog OK.");
console.log(`- Integrations: ${integrations.size}`);
console.log(`- Edge Functions: ${functions.size}`);
console.log(`- verify_jwt: ${verifyJwtTrue} true / ${verifyJwtFalse} false`);
console.log("- Runtime/provider facts: runtime_readback_required");

function validateIntegration(integration) {
  const label = `integration ${integration.id}`;
  assertExactKeys(integration, [
    "id",
    "declaredState",
    "destinations",
    "dataClasses",
    "auth",
    "owner",
    "disableControl",
    "runbook",
    "verification",
    "sourceRefs",
    "runtimeReadback",
  ], label);
  if (!["source_declared_active", "source_declared_activation_gated"].includes(integration.declaredState)) {
    fail(`${label} has an invalid declaredState`);
  }
  assertReferences(integration.destinations, destinations, `${label} destination`);
  assertReferences(integration.dataClasses, dataClassIds, `${label} data class`);
  assertText(integration.auth, `${label} auth`);
  if (!integrationOwners.has(integration.owner)) fail(`${label} has unknown owner ${integration.owner}`);
  assertReference(integration.disableControl, disableControls, `${label} disable control`);
  assertReference(integration.runbook, runbookProfiles, `${label} runbook`);
  assertReference(integration.verification, verificationProfiles, `${label} verification`);
  assertSourceRefs(integration.sourceRefs, label);
  assertExactKeys(integration.runtimeReadback, ["required", "status", "facts"], `${label} runtimeReadback`);
  if (integration.runtimeReadback?.required !== true || integration.runtimeReadback?.status !== "runtime_readback_required") {
    fail(`${label} must require provider runtime readback`);
  }
  assertNonEmptyStrings(integration.runtimeReadback?.facts, `${label} runtime facts`);
}

function validateFunction(entry, configured) {
  const label = `Edge Function ${entry.id}`;
  assertExactKeys(entry, [
    "id",
    "enabled",
    "verifyJwt",
    "destinations",
    "dataClasses",
    "auth",
    "owner",
    "disableControl",
    "runbook",
    "verification",
    "sourceRefs",
    "runtimeReadback",
  ], label);
  if (!configured) return;
  if (entry.enabled !== configured.enabled) fail(`${label} enabled does not match supabase/config.toml`);
  if (entry.verifyJwt !== configured.verifyJwt) fail(`${label} verifyJwt does not match supabase/config.toml`);
  if (entry.runtimeReadback !== "runtime_readback_required") fail(`${label} must not assert provider runtime state`);
  assertReferences(entry.destinations, destinations, `${label} destination`);
  assertReferences(entry.dataClasses, dataClassIds, `${label} data class`);
  const auth = authProfiles.get(entry.auth);
  if (!auth) fail(`${label} references unknown auth profile ${entry.auth}`);
  else if (auth.gatewayVerifyJwt !== entry.verifyJwt) fail(`${label} auth profile gateway JWT setting does not match config`);
  if (!functionOwners.has(entry.owner)) fail(`${label} has unknown owner ${entry.owner}`);
  assertReference(entry.disableControl, disableControls, `${label} disable control`);
  assertReference(entry.runbook, runbookProfiles, `${label} runbook`);
  assertReference(entry.verification, verificationProfiles, `${label} verification`);
  assertSourceRefs(entry.sourceRefs, label);
  if (!entry.sourceRefs?.includes(configured.entrypoint)) {
    fail(`${label} sourceRefs must include configured entrypoint ${configured.entrypoint}`);
  }
  assertPath(configured.entrypoint, `${label} configured entrypoint`);
  assertPath(configured.importMap, `${label} configured import map`);
}

function parseFunctionConfig(content) {
  const functions = new Map();
  let current = null;
  for (const line of content.split(/\r?\n/u)) {
    const section = /^\[functions\.([^\]]+)\]$/u.exec(line.trim());
    if (section) {
      current = { id: section[1], enabled: null, verifyJwt: null, entrypoint: "", importMap: "" };
      if (functions.has(current.id)) fail(`supabase/config.toml repeats function ${current.id}`);
      functions.set(current.id, current);
      continue;
    }
    if (!current) continue;
    const setting = /^(enabled|verify_jwt|entrypoint|import_map)\s*=\s*(.+)$/u.exec(line.trim());
    if (!setting) continue;
    const [, key, raw] = setting;
    if (key === "enabled") current.enabled = raw === "true";
    else if (key === "verify_jwt") current.verifyJwt = raw === "true";
    else {
      const value = /^"([^"]+)"$/u.exec(raw)?.[1] || "";
      const normalized = value.replace(/^\.\/functions\//u, "supabase/functions/");
      if (key === "entrypoint") current.entrypoint = normalized;
      else current.importMap = normalized;
    }
  }
  for (const entry of functions.values()) {
    if (typeof entry.enabled !== "boolean") fail(`supabase/config.toml function ${entry.id} is missing enabled`);
    if (typeof entry.verifyJwt !== "boolean") fail(`supabase/config.toml function ${entry.id} is missing verify_jwt`);
    if (!entry.entrypoint) fail(`supabase/config.toml function ${entry.id} is missing entrypoint`);
    if (!entry.importMap) fail(`supabase/config.toml function ${entry.id} is missing import_map`);
  }
  return functions;
}

function indexById(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} collection must be an array`);
    return new Map();
  }
  const result = new Map();
  for (const entry of value) {
    assertId(entry?.id, `${label} id`);
    if (result.has(entry?.id)) fail(`${label} ID ${entry?.id} is duplicated`);
    else result.set(entry?.id, entry);
  }
  return result;
}

function assertReferences(values, known, label) {
  assertNonEmptyStrings(values, `${label}s`);
  for (const value of values || []) assertReference(value, known, label);
}

function assertReference(value, known, label) {
  if (!known.has(value)) fail(`${label} references unknown ID ${value}`);
}

function assertSourceRefs(values, label) {
  assertNonEmptyStrings(values, `${label} sourceRefs`);
  for (const value of values || []) assertPath(value, `${label} sourceRef`);
}

function assertPath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) {
    fail(`${label} must be a repository-relative POSIX path`);
    return;
  }
  const absolute = resolve(root, value);
  const repoRelative = relative(root, absolute);
  if (repoRelative === ".." || repoRelative.startsWith(`..${sep}`) || isAbsolute(repoRelative)) {
    fail(`${label} escapes the repository`);
  } else if (!existsSync(absolute)) {
    fail(`${label} does not exist: ${value}`);
  }
}

function assertNonEmptyStrings(values, label) {
  if (!Array.isArray(values) || !values.length || values.some((value) => typeof value !== "string" || !value.trim())) {
    fail(`${label} must be a non-empty string array`);
    return;
  }
  if (new Set(values).size !== values.length) fail(`${label} must not contain duplicates`);
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
    return;
  }
  if (!sameStrings(Object.keys(value), expected)) fail(`${label} fields do not match the schema`);
}

function assertId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) fail(`${label} must be a lowercase kebab-case ID`);
}

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be non-empty text`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relative(root, path)} is not valid JSON for ${label}: ${error.message}`);
    return null;
  }
}

function sameStrings(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
  return [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function fail(message) {
  failures.push(message);
}
