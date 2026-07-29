import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { readJsonFile } from "./lib/json.mjs";
import { fromRoot } from "./lib/repo-paths.mjs";

const REGISTRY_PATH =
  process.env.MOCHIRII_CROSS_REPOSITORY_REGISTRY_TEST_FIXTURE ||
  "docs/integrations/cross-repository-contract-registry.v1.json";
const SCHEMA_PATH = "docs/integrations/cross-repository-contract-registry.v1.schema.json";
const WEBSITE_REPOSITORY = "Mochirii-Wushu/Mochirii-Website";
const SOCIAL_REPOSITORY = "Mochirii-Wushu/Mochirii-Social";
const REAPER_REPOSITORY = "Mochirii-Wushu/Reaper-Discord-Bot";
const MOCHI_PETS_REPOSITORY = "Mochirii-Wushu/Mochirii-Pets";

const REPOSITORIES = new Set([
  WEBSITE_REPOSITORY,
  SOCIAL_REPOSITORY,
  "Mochirii-Wushu/Mochirii-Social-Mobile",
  "Mochirii-Wushu/Mochirii-Forums",
  REAPER_REPOSITORY,
  MOCHI_PETS_REPOSITORY,
]);

const CONTRACTS = new Map([
  ["website-session-guild-entitlement", "Website session and guild entitlement"],
  ["social-oauth-handoff-account-mapping", "Social OAuth handoff and account mapping"],
  ["social-api-media-behavior", "Social API/media behavior"],
  ["gallery-ingest-moderation", "Gallery ingest and moderation"],
  ["discord-command-manifest", "Discord command manifest"],
  ["member-synchronization", "Member synchronization"],
  ["guild-event-schedule", "Guild event schedule"],
  ["spinner-draw-publication", "Spinner draw and publication"],
  ["spotlight-vote-workflows", "Spotlight and vote workflows"],
  ["mochi-pets-launch-ticket", "Mochi Pets launch ticket"],
  ["unity-artifact-manifest", "Unity artifact manifest"],
  ["forum-central-identity", "Forum central identity"],
]);

const CONTRACT_PRODUCERS = new Map([
  ["website-session-guild-entitlement", WEBSITE_REPOSITORY],
  ["social-oauth-handoff-account-mapping", WEBSITE_REPOSITORY],
  ["social-api-media-behavior", WEBSITE_REPOSITORY],
  ["gallery-ingest-moderation", WEBSITE_REPOSITORY],
  ["discord-command-manifest", WEBSITE_REPOSITORY],
  ["member-synchronization", WEBSITE_REPOSITORY],
  ["guild-event-schedule", WEBSITE_REPOSITORY],
  ["spinner-draw-publication", WEBSITE_REPOSITORY],
  ["spotlight-vote-workflows", WEBSITE_REPOSITORY],
  ["mochi-pets-launch-ticket", WEBSITE_REPOSITORY],
  ["unity-artifact-manifest", MOCHI_PETS_REPOSITORY],
  ["forum-central-identity", WEBSITE_REPOSITORY],
]);

const REGISTRY_CONTRACT_STATUS = "unversioned";
const OWNERSHIP_KEYS = new Set([
  "sharedSupabaseSourceRepository",
  "sharedSupabaseDeploymentRepository",
  "reaperSharedSupabaseRole",
  "copiedFunctionSourceAllowed",
  "socialCurrentSourceRepository",
  "socialTargetRepository",
  "socialTargetStatus",
]);
const REAPER_CONSUMER_CONTRACTS = new Set([
  "gallery-ingest-moderation",
  "discord-command-manifest",
  "member-synchronization",
  "guild-event-schedule",
  "spinner-draw-publication",
  "spotlight-vote-workflows",
]);
const ARTIFACT_KINDS = new Set(["documentation", "schema", "interface", "manifest", "fixture"]);
const CONCRETE_ARTIFACT_KINDS = new Set(["schema", "interface", "manifest"]);
const TEST_COVERAGE = new Set(["producer", "consumer", "cross_repository"]);
const GAPS = new Set([
  "contract_version",
  "versioned_artifact",
  "concrete_artifact",
  "producer_compatibility_test",
  "consumer_compatibility_test",
  "cross_repository_fixture",
  "rollback_window",
]);

const failures = [];

function fail(message) {
  failures.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  if (!isRecord(value)) {
    fail(`${label} must be an object.`);
    return false;
  }

  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}. Found: ${actual.join(", ")}.`);
    return false;
  }
  return true;
}

function assertUniqueStrings(values, allowed, label, { required = true } = {}) {
  if (!Array.isArray(values) || (required && values.length === 0)) {
    fail(`${label} must be ${required ? "a non-empty" : "an"} array.`);
    return;
  }

  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      fail(`${label} entries must be non-empty strings.`);
      continue;
    }
    if (seen.has(value)) fail(`${label} contains duplicate ${JSON.stringify(value)}.`);
    seen.add(value);
    if (allowed && !allowed.has(value)) fail(`${label} contains unsupported ${JSON.stringify(value)}.`);
  }
}

function assertExactStringSet(values, expected, label) {
  if (!Array.isArray(values)) {
    fail(`${label} must be an array.`);
    return;
  }
  const actual = new Set(values);
  if (
    values.some((value) => typeof value !== "string") ||
    actual.size !== values.length ||
    actual.size !== expected.size ||
    [...expected].some((value) => !actual.has(value))
  ) {
    fail(`${label} must contain the exact expected string set.`);
  }
}

function assertSafeRepoPath(repoPath, label) {
  if (
    typeof repoPath !== "string" ||
    repoPath.length === 0 ||
    repoPath.includes("\\") ||
    path.posix.isAbsolute(repoPath) ||
    repoPath.split("/").includes("..")
  ) {
    fail(`${label} must be a safe repository-relative POSIX path.`);
    return false;
  }
  return true;
}

function assertReferencePath(reference, label) {
  if (!assertSafeRepoPath(reference.path, `${label}.path`)) return;
  if (reference.repository !== WEBSITE_REPOSITORY) return;
  const absolutePath = fromRoot(reference.path);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    fail(`${label}.path does not resolve to an existing Website file: ${reference.path}.`);
  }
}

function assertNoSensitiveFields(value, label = "registry") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveFields(entry, `${label}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (/(secret|password|credential|privatekey|clientsecret|token|value)/.test(normalized)) {
      fail(`${label} contains forbidden secret/value field ${JSON.stringify(key)}.`);
    }
    assertNoSensitiveFields(child, `${label}.${key}`);
  }
}

function hasCoverage(tests, coverage) {
  return tests.some((test) => test.coverage === coverage || test.coverage === "cross_repository");
}

function requireGap(contract, gap, reason) {
  if (!contract.gaps.includes(gap)) {
    fail(`${contract.id} must record gap ${JSON.stringify(gap)} because ${reason}.`);
  }
}

function rejectStaleGap(contract, gap, reason) {
  if (contract.gaps.includes(gap)) {
    fail(`${contract.id} records stale gap ${JSON.stringify(gap)} even though ${reason}.`);
  }
}

const registry = readJsonFile(REGISTRY_PATH);
const schema = readJsonFile(SCHEMA_PATH);

assertExactStringSet(
  [...CONTRACT_PRODUCERS.keys()],
  new Set(CONTRACTS.keys()),
  "checker contract producer ownership map",
);

assertExactKeys(
  registry,
  ["$schema", "schemaVersion", "updatedDate", "registryStatus", "ownership", "repositories", "contracts"],
  "registry",
);
if (registry.$schema !== "./cross-repository-contract-registry.v1.schema.json") {
  fail("registry.$schema must reference the checked-in v1 schema.");
}
if (registry.schemaVersion !== 1) fail("registry.schemaVersion must equal 1.");
if (!/^\d{4}-\d{2}-\d{2}$/.test(registry.updatedDate)) {
  fail("registry.updatedDate must use YYYY-MM-DD.");
}
if (registry.registryStatus !== "target_only_unversioned") {
  fail("registry.registryStatus must remain target_only_unversioned until a separately reviewed release proves otherwise.");
}

if (assertExactKeys(registry.ownership, OWNERSHIP_KEYS, "registry.ownership")) {
  if (
    registry.ownership.sharedSupabaseSourceRepository !== WEBSITE_REPOSITORY ||
    registry.ownership.sharedSupabaseDeploymentRepository !== WEBSITE_REPOSITORY
  ) {
    fail("Website must remain the sole shared-Supabase source and deployment repository.");
  }
  if (
    registry.ownership.reaperSharedSupabaseRole !== "contract_consumer_only" ||
    registry.ownership.copiedFunctionSourceAllowed !== false
  ) {
    fail("Reaper must remain a contract-only consumer without copied function source.");
  }
  if (
    registry.ownership.socialCurrentSourceRepository !== WEBSITE_REPOSITORY ||
    registry.ownership.socialTargetRepository !== SOCIAL_REPOSITORY ||
    registry.ownership.socialTargetStatus !== "future_staged_not_cut_over"
  ) {
    fail("Social ownership must remain Website-current and future-staged without a cutover claim.");
  }
}

assertExactStringSet(registry.repositories, REPOSITORIES, "registry.repositories");

if (!Array.isArray(registry.contracts) || registry.contracts.length !== CONTRACTS.size) {
  fail(`registry.contracts must contain exactly ${CONTRACTS.size} entries.`);
}

const seenContractIds = new Set();
for (const [index, contract] of (registry.contracts ?? []).entries()) {
  const label = `registry.contracts[${index}]`;
  if (
    !assertExactKeys(
      contract,
      [
        "id",
        "name",
        "status",
        "version",
        "producerRepositories",
        "consumerRepositories",
        "compatibilityRequirements",
        "artifacts",
        "tests",
        "rollbackWindowDays",
        "gaps",
      ],
      label,
    )
  ) {
    continue;
  }

  if (!CONTRACTS.has(contract.id)) fail(`${label}.id is not one of the 12 required contract IDs.`);
  if (seenContractIds.has(contract.id)) fail(`Duplicate contract ID ${JSON.stringify(contract.id)}.`);
  seenContractIds.add(contract.id);
  if (CONTRACTS.get(contract.id) !== contract.name) {
    fail(`${contract.id} must retain map name ${JSON.stringify(CONTRACTS.get(contract.id))}.`);
  }
  if (contract.status !== REGISTRY_CONTRACT_STATUS) {
    fail(`${contract.id}.status must remain ${REGISTRY_CONTRACT_STATUS} in the evidence-only v1 registry.`);
  }
  if (contract.version !== null) fail(`${contract.id}.version must remain null in the evidence-only v1 registry.`);

  assertUniqueStrings(contract.producerRepositories, REPOSITORIES, `${contract.id}.producerRepositories`);
  assertUniqueStrings(contract.consumerRepositories, REPOSITORIES, `${contract.id}.consumerRepositories`);
  assertUniqueStrings(contract.compatibilityRequirements, null, `${contract.id}.compatibilityRequirements`);
  assertUniqueStrings(contract.gaps, GAPS, `${contract.id}.gaps`, { required: false });

  if (contract.producerRepositories.includes(REAPER_REPOSITORY)) {
    fail(`${contract.id} must not assign Reaper shared-contract producer ownership.`);
  }
  const expectedProducer = CONTRACT_PRODUCERS.get(contract.id);
  if (expectedProducer) {
    assertExactStringSet(
      contract.producerRepositories,
      new Set([expectedProducer]),
      `${contract.id}.producerRepositories`,
    );
  }
  if (REAPER_CONSUMER_CONTRACTS.has(contract.id)) {
    if (!contract.consumerRepositories.includes(REAPER_REPOSITORY)) {
      fail(`${contract.id} must record Reaper as a Website-contract consumer.`);
    }
  }

  if (!Array.isArray(contract.artifacts)) {
    fail(`${contract.id}.artifacts must be an array.`);
    contract.artifacts = [];
  }
  if (!Array.isArray(contract.tests)) {
    fail(`${contract.id}.tests must be an array.`);
    contract.tests = [];
  }

  const referenceKeys = new Set();
  for (const [artifactIndex, artifact] of contract.artifacts.entries()) {
    const artifactLabel = `${contract.id}.artifacts[${artifactIndex}]`;
    if (!assertExactKeys(artifact, ["repository", "path", "kind"], artifactLabel)) continue;
    if (!REPOSITORIES.has(artifact.repository)) fail(`${artifactLabel}.repository is unsupported.`);
    if (!ARTIFACT_KINDS.has(artifact.kind)) fail(`${artifactLabel}.kind is unsupported.`);
    assertReferencePath(artifact, artifactLabel);
    const key = `${artifact.repository}:${artifact.path}`;
    if (referenceKeys.has(key)) fail(`${contract.id} repeats artifact reference ${key}.`);
    referenceKeys.add(key);
  }

  referenceKeys.clear();
  for (const [testIndex, test] of contract.tests.entries()) {
    const testLabel = `${contract.id}.tests[${testIndex}]`;
    if (!assertExactKeys(test, ["repository", "path", "coverage"], testLabel)) continue;
    if (!REPOSITORIES.has(test.repository)) fail(`${testLabel}.repository is unsupported.`);
    if (!TEST_COVERAGE.has(test.coverage)) fail(`${testLabel}.coverage is unsupported.`);
    assertReferencePath(test, testLabel);
    const key = `${test.repository}:${test.path}`;
    if (referenceKeys.has(key)) fail(`${contract.id} repeats test reference ${key}.`);
    referenceKeys.add(key);
  }

  const hasConcreteArtifact = contract.artifacts.some((artifact) => CONCRETE_ARTIFACT_KINDS.has(artifact.kind));
  const hasCrossRepositoryFixture = contract.artifacts.some((artifact) => artifact.kind === "fixture");
  const hasProducerTest = hasCoverage(contract.tests, "producer");
  const hasConsumerTest = hasCoverage(contract.tests, "consumer");
  requireGap(contract, "contract_version", "the v1 registry records only unversioned target contracts");
  requireGap(contract, "versioned_artifact", "no deployed contract version is recorded");

  if (hasConcreteArtifact) rejectStaleGap(contract, "concrete_artifact", "a concrete artifact is referenced");
  else requireGap(contract, "concrete_artifact", "no schema, interface, or manifest is referenced");

  requireGap(
    contract,
    "producer_compatibility_test",
    hasProducerTest
      ? "producer coverage is only partial evidence for an unversioned target contract"
      : "no producer compatibility test is referenced",
  );

  requireGap(
    contract,
    "consumer_compatibility_test",
    hasConsumerTest
      ? "consumer coverage is only partial evidence for an unversioned target contract"
      : "no consumer compatibility test is referenced",
  );

  if (hasCrossRepositoryFixture) rejectStaleGap(contract, "cross_repository_fixture", "a fixture is referenced");
  else requireGap(contract, "cross_repository_fixture", "no cross-repository fixture is referenced");

  if (contract.rollbackWindowDays === null) {
    requireGap(contract, "rollback_window", "rollbackWindowDays is null");
  } else if (!Number.isInteger(contract.rollbackWindowDays) || contract.rollbackWindowDays < 1) {
    fail(`${contract.id}.rollbackWindowDays must be null or a positive integer.`);
  } else {
    rejectStaleGap(contract, "rollback_window", "a rollback window is recorded");
  }

  if (contract.gaps.length === 0) fail(`${contract.id} must record explicit gaps in the evidence-only v1 registry.`);
}

for (const contractId of CONTRACTS.keys()) {
  if (!seenContractIds.has(contractId)) fail(`Missing required contract ID ${contractId}.`);
}

assertNoSensitiveFields(registry);

if (!isRecord(schema) || schema.$id !== "urn:mochirii:cross-repository-contract-registry:v1") {
  fail("The v1 schema must parse and retain its canonical $id.");
}
if (
  schema.additionalProperties !== false ||
  schema.$defs?.ownership?.additionalProperties !== false ||
  schema.$defs?.contract?.additionalProperties !== false ||
  schema.$defs?.artifact?.additionalProperties !== false ||
  schema.$defs?.test?.additionalProperties !== false
) {
  fail("The v1 schema must reject unknown top-level, ownership, contract, artifact, and test fields.");
}
assertExactStringSet(
  schema.required,
  new Set(["$schema", "schemaVersion", "updatedDate", "registryStatus", "ownership", "repositories", "contracts"]),
  "schema.required",
);
assertExactStringSet(schema.$defs?.repository?.enum, REPOSITORIES, "schema.$defs.repository.enum");
assertExactStringSet(schema.$defs?.ownership?.required, OWNERSHIP_KEYS, "schema.$defs.ownership.required");
if (
  schema.$defs?.ownership?.properties?.sharedSupabaseSourceRepository?.const !== WEBSITE_REPOSITORY ||
  schema.$defs?.ownership?.properties?.sharedSupabaseDeploymentRepository?.const !== WEBSITE_REPOSITORY ||
  schema.$defs?.ownership?.properties?.reaperSharedSupabaseRole?.const !== "contract_consumer_only" ||
  schema.$defs?.ownership?.properties?.copiedFunctionSourceAllowed?.const !== false ||
  schema.$defs?.ownership?.properties?.socialCurrentSourceRepository?.const !== WEBSITE_REPOSITORY ||
  schema.$defs?.ownership?.properties?.socialTargetRepository?.const !== SOCIAL_REPOSITORY ||
  schema.$defs?.ownership?.properties?.socialTargetStatus?.const !== "future_staged_not_cut_over"
) {
  fail("The v1 schema must lock the current Website/Reaper/Social ownership boundary.");
}
assertExactStringSet(schema.$defs?.contractId?.enum, new Set(CONTRACTS.keys()), "schema.$defs.contractId.enum");
assertExactStringSet(schema.$defs?.gap?.enum, GAPS, "schema.$defs.gap.enum");
assertExactStringSet(schema.$defs?.artifact?.properties?.kind?.enum, ARTIFACT_KINDS, "schema artifact kinds");
assertExactStringSet(schema.$defs?.test?.properties?.coverage?.enum, TEST_COVERAGE, "schema test coverage");
if (schema.$defs?.contract?.properties?.status?.const !== REGISTRY_CONTRACT_STATUS) {
  fail(`The v1 schema must lock every contract status to ${REGISTRY_CONTRACT_STATUS}.`);
}
if (schema.$defs?.contract?.properties?.version?.type !== "null") {
  fail("The v1 schema must lock every contract version to null.");
}
assertExactStringSet(
  schema.$defs?.contract?.required,
  new Set([
    "id",
    "name",
    "status",
    "version",
    "producerRepositories",
    "consumerRepositories",
    "compatibilityRequirements",
    "artifacts",
    "tests",
    "rollbackWindowDays",
    "gaps",
  ]),
  "schema.$defs.contract.required",
);
if (
  schema.properties?.repositories?.minItems !== REPOSITORIES.size ||
  schema.properties?.repositories?.maxItems !== REPOSITORIES.size ||
  schema.properties?.contracts?.minItems !== CONTRACTS.size ||
  schema.properties?.contracts?.maxItems !== CONTRACTS.size
) {
  fail("The v1 schema must lock exact repository and contract counts.");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`Cross-repository contract registry validation failed (${failures.length} issue(s)).`);
  process.exit(1);
}

console.log(`Cross-repository contract registry OK (${registry.contracts.length} unversioned governance contracts; Website remains the sole shared-Supabase owner; no provider state asserted).`);
