import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = resolve(root, "docs/operations/legal-privacy-readiness.v1.json");
const catalogPath = resolve(root, "docs/integrations/integration-exposure-catalog.v1.json");
const failures = [];

const inventory = readJson(inventoryPath, "legal and privacy readiness inventory");
const catalog = readJson(catalogPath, "integration exposure catalog");
const rawInventory = readFileSync(inventoryPath, "utf8");

const expectedTopLevelKeys = [
  "schemaVersion",
  "scope",
  "factBoundary",
  "statusDefinitions",
  "operatorFacts",
  "jurisdictions",
  "processingActivities",
  "subprocessors",
  "retentionRules",
  "rightsWorkflows",
  "publicClaims",
  "approvalGates",
  "sourceRefs",
];
assertExactKeys(inventory, expectedTopLevelKeys, "inventory");

if (inventory?.schemaVersion !== 1) fail("inventory schemaVersion must be 1");
if (inventory?.factBoundary?.secretValuesAllowed !== false) {
  fail("inventory must forbid secret values");
}

const allowedStatuses = [
  "SOURCE_OBSERVED",
  "RUNTIME_READBACK_REQUIRED",
  "BLOCKED_APPROVAL",
  "BLOCKED_EXTERNAL",
  "DEFERRED_BY_EXPLICIT_POLICY",
  "NOT_APPLICABLE_REVIEWED",
];
assertExactKeys(inventory?.statusDefinitions, allowedStatuses, "statusDefinitions");
for (const status of allowedStatuses) {
  assertText(inventory?.statusDefinitions?.[status], `statusDefinitions.${status}`);
}
if (rawInventory.includes('"READY"')) fail("READY is forbidden until counsel and owner evidence exists");

assertExactKeys(inventory?.scope, ["repository", "asOf", "purpose", "surfaces", "restrictedEvidence"], "scope");
if (inventory?.scope?.repository !== "Mochirii-Wushu/Mochirii-Website") {
  fail("scope.repository must identify the canonical Website repository");
}
if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(inventory?.scope?.asOf || ""))) {
  fail("scope.asOf must use YYYY-MM-DD");
}
assertText(inventory?.scope?.purpose, "scope purpose");
assertNonEmptyStrings(inventory?.scope?.restrictedEvidence, "scope restrictedEvidence");

assertExactKeys(
  inventory?.factBoundary,
  ["repositoryFacts", "runtimeFacts", "legalApproval", "secretValuesAllowed", "restrictedEvidence"],
  "factBoundary",
);
for (const field of ["repositoryFacts", "runtimeFacts", "legalApproval", "restrictedEvidence"]) {
  assertText(inventory?.factBoundary?.[field], `factBoundary.${field}`);
}

const surfaces = indexById(inventory?.scope?.surfaces, "surface");
for (const surface of surfaces.values()) {
  assertExactKeys(surface, ["id", "description", "state"], `surface ${surface.id}`);
  assertId(surface.id, `surface ${surface.id}`);
  assertText(surface.description, `surface ${surface.id} description`);
  if (!["active-source", "activation-gated", "deferred"].includes(surface.state)) {
    fail(`surface ${surface.id} has invalid state ${surface.state}`);
  }
}

const sourceRefs = indexById(inventory?.sourceRefs, "source reference");
for (const sourceRef of sourceRefs.values()) {
  assertExactKeys(sourceRef, ["id", "path", "kind", "description"], `source reference ${sourceRef.id}`);
  assertId(sourceRef.id, `source reference ${sourceRef.id}`);
  assertText(sourceRef.kind, `source reference ${sourceRef.id} kind`);
  assertText(sourceRef.description, `source reference ${sourceRef.id} description`);
  assertRepositoryPath(sourceRef.path, `source reference ${sourceRef.id}`);
}

const integrationIds = new Set((catalog?.integrations || []).map((entry) => entry?.id));
const dataClassIds = new Set(Object.keys(catalog?.dataClassDefinitions || {}));
const destinationIds = new Set((catalog?.destinations || []).map((entry) => entry?.id));

const operatorFacts = indexById(inventory?.operatorFacts, "operator fact");
for (const row of operatorFacts.values()) {
  assertExactKeys(
    row,
    ["id", "fact", "value", "status", "owner", "question", "evidenceNeeded", "sourceRefs"],
    `operator fact ${row.id}`,
  );
  assertText(row.fact, `operator fact ${row.id} fact`);
  validateDecisionState(row, `operator fact ${row.id}`);
  assertSourceRefIds(row.sourceRefs, sourceRefs, `operator fact ${row.id}`);
  if (row.status !== "SOURCE_OBSERVED" && row.value !== null) {
    fail(`operator fact ${row.id} must keep an unapproved value null`);
  }
}

const jurisdictions = indexById(inventory?.jurisdictions, "jurisdiction");
for (const row of jurisdictions.values()) {
  assertExactKeys(
    row,
    ["id", "surface", "audience", "jurisdiction", "minimumAge", "languages", "status", "owner", "question", "evidenceNeeded", "sourceRefs"],
    `jurisdiction ${row.id}`,
  );
  assertReference(row.surface, surfaces, `jurisdiction ${row.id} surface`);
  assertText(row.audience, `jurisdiction ${row.id} audience`);
  assertNullableText(row.jurisdiction, `jurisdiction ${row.id} jurisdiction`);
  assertNullableText(row.minimumAge, `jurisdiction ${row.id} minimumAge`);
  assertNonEmptyStrings(row.languages, `jurisdiction ${row.id} languages`);
  validateDecisionState(row, `jurisdiction ${row.id}`);
  assertSourceRefIds(row.sourceRefs, sourceRefs, `jurisdiction ${row.id}`);
}

const processingActivities = indexById(inventory?.processingActivities, "processing activity");
for (const row of processingActivities.values()) {
  assertExactKeys(
    row,
    [
      "id",
      "surface",
      "integrationIds",
      "catalogDataClasses",
      "catalogGaps",
      "dataSubjects",
      "dataCategories",
      "sources",
      "purposes",
      "legalBasis",
      "destinationIds",
      "additionalRecipients",
      "controllerProcessorRole",
      "storage",
      "retentionRuleIds",
      "deletionPath",
      "backupTreatment",
      "crossBorderTransfer",
      "noticeRefs",
      "status",
      "owner",
      "question",
      "evidenceNeeded",
      "sourceRefs",
    ],
    `processing activity ${row.id}`,
  );
  assertReference(row.surface, surfaces, `processing activity ${row.id} surface`);
  assertReferences(row.integrationIds, integrationIds, `processing activity ${row.id} integration`);
  assertReferences(row.catalogDataClasses, dataClassIds, `processing activity ${row.id} data class`);
  assertStringArray(row.catalogGaps, `processing activity ${row.id} catalogGaps`);
  if (!(row.catalogDataClasses?.length || row.catalogGaps?.length)) {
    fail(`processing activity ${row.id} must map a catalog data class or declare a catalogGap`);
  }
  for (const field of ["dataSubjects", "dataCategories", "sources", "purposes"]) {
    assertNonEmptyStrings(row[field], `processing activity ${row.id} ${field}`);
  }
  assertNullableText(row.legalBasis, `processing activity ${row.id} legalBasis`);
  assertReferences(row.destinationIds, destinationIds, `processing activity ${row.id} destination`);
  assertStringArray(row.additionalRecipients, `processing activity ${row.id} additionalRecipients`);
  for (const field of [
    "controllerProcessorRole",
    "storage",
    "deletionPath",
    "backupTreatment",
    "crossBorderTransfer",
  ]) {
    assertNullableText(row[field], `processing activity ${row.id} ${field}`);
  }
  assertStringArray(row.noticeRefs, `processing activity ${row.id} noticeRefs`);
  validateDecisionState(row, `processing activity ${row.id}`);
  assertSourceRefIds(row.sourceRefs, sourceRefs, `processing activity ${row.id}`);
}

const retentionRules = indexById(inventory?.retentionRules, "retention rule");
for (const row of retentionRules.values()) {
  assertExactKeys(
    row,
    [
      "id",
      "category",
      "processingActivityIds",
      "liveRetentionPeriod",
      "backupRetentionPeriod",
      "deletionTrigger",
      "deletionPropagation",
      "legalHoldTreatment",
      "status",
      "owner",
      "question",
      "evidenceNeeded",
      "sourceRefs",
    ],
    `retention rule ${row.id}`,
  );
  assertText(row.category, `retention rule ${row.id} category`);
  assertReferences(row.processingActivityIds, processingActivities, `retention rule ${row.id} processing activity`);
  for (const field of [
    "liveRetentionPeriod",
    "backupRetentionPeriod",
    "deletionTrigger",
    "deletionPropagation",
    "legalHoldTreatment",
  ]) {
    assertNullableText(row[field], `retention rule ${row.id} ${field}`);
  }
  validateDecisionState(row, `retention rule ${row.id}`);
  assertSourceRefIds(row.sourceRefs, sourceRefs, `retention rule ${row.id}`);
}
for (const row of processingActivities.values()) {
  assertReferences(row.retentionRuleIds, retentionRules, `processing activity ${row.id} retention rule`);
}

const subprocessors = indexById(inventory?.subprocessors, "subprocessor");
for (const row of subprocessors.values()) {
  assertExactKeys(
    row,
    [
      "id",
      "provider",
      "destinationIds",
      "catalogGaps",
      "integrationIds",
      "state",
      "role",
      "processingActivityIds",
      "contractDpa",
      "subprocessorList",
      "regions",
      "transferMechanism",
      "governmentAccessReview",
      "deletionReturnTerms",
      "securityEvidence",
      "status",
      "owner",
      "question",
      "evidenceNeeded",
      "sourceRefs",
    ],
    `subprocessor ${row.id}`,
  );
  assertText(row.provider, `subprocessor ${row.id} provider`);
  assertReferences(row.destinationIds, destinationIds, `subprocessor ${row.id} destination`);
  assertStringArray(row.catalogGaps, `subprocessor ${row.id} catalogGaps`);
  if (!(row.destinationIds?.length || row.catalogGaps?.length)) {
    fail(`subprocessor ${row.id} must map a destination or declare a catalogGap`);
  }
  assertReferences(row.integrationIds, integrationIds, `subprocessor ${row.id} integration`);
  if (!["active-source", "activation-gated", "deferred"].includes(row.state)) {
    fail(`subprocessor ${row.id} has invalid state ${row.state}`);
  }
  assertText(row.role, `subprocessor ${row.id} role`);
  assertReferences(row.processingActivityIds, processingActivities, `subprocessor ${row.id} processing activity`);
  for (const field of [
    "contractDpa",
    "subprocessorList",
    "regions",
    "transferMechanism",
    "governmentAccessReview",
    "deletionReturnTerms",
    "securityEvidence",
  ]) {
    assertNullableText(row[field], `subprocessor ${row.id} ${field}`);
  }
  validateDecisionState(row, `subprocessor ${row.id}`);
  assertSourceRefIds(row.sourceRefs, sourceRefs, `subprocessor ${row.id}`);
}

const rightsWorkflows = indexById(inventory?.rightsWorkflows, "rights workflow");
for (const row of rightsWorkflows.values()) {
  assertExactKeys(
    row,
    [
      "id",
      "right",
      "surfaces",
      "intake",
      "identityVerification",
      "responseDeadline",
      "appeal",
      "authorizedAgent",
      "providerPropagation",
      "evidenceTest",
      "status",
      "owner",
      "question",
      "evidenceNeeded",
      "sourceRefs",
    ],
    `rights workflow ${row.id}`,
  );
  assertText(row.right, `rights workflow ${row.id} right`);
  assertReferences(row.surfaces, surfaces, `rights workflow ${row.id} surface`);
  for (const field of [
    "intake",
    "identityVerification",
    "responseDeadline",
    "appeal",
    "authorizedAgent",
    "providerPropagation",
    "evidenceTest",
  ]) {
    assertNullableText(row[field], `rights workflow ${row.id} ${field}`);
  }
  validateDecisionState(row, `rights workflow ${row.id}`);
  assertSourceRefIds(row.sourceRefs, sourceRefs, `rights workflow ${row.id}`);
}

const publicClaims = indexById(inventory?.publicClaims, "public claim");
for (const row of publicClaims.values()) {
  assertExactKeys(
    row,
    [
      "id",
      "claim",
      "sourceRefs",
      "processingActivityIds",
      "disposition",
      "conflict",
      "candidateRedline",
      "status",
      "owner",
      "question",
      "evidenceNeeded",
    ],
    `public claim ${row.id}`,
  );
  assertText(row.claim, `public claim ${row.id} claim`);
  assertSourceRefIds(row.sourceRefs, sourceRefs, `public claim ${row.id}`);
  assertReferences(row.processingActivityIds, processingActivities, `public claim ${row.id} processing activity`);
  assertText(row.disposition, `public claim ${row.id} disposition`);
  assertText(row.conflict, `public claim ${row.id} conflict`);
  if (row.candidateRedline !== null) {
    fail(`public claim ${row.id} candidateRedline must remain null in this source-only packet`);
  }
  validateDecisionState(row, `public claim ${row.id}`);
}

const requiredClaimIds = [
  "social-absolute-private-no-sharing",
  "social-no-sale-limited-provider",
  "social-terms-divergence",
  "social-guidelines-jurisdiction-public-timeline",
  "social-legal-notice-source-gap",
  "social-unfinished-data-policy",
  "social-empty-platform-terms",
  "social-permanent-account-deletion",
  "website-privacy-scope-global-footer",
  "website-private-url-wording",
  "meta-deletion-label-breadth",
  "social-parental-controls-age",
];
for (const id of requiredClaimIds) {
  if (!publicClaims.has(id)) fail(`known public-claim conflict ${id} must remain registered until resolved`);
}

const approvalGates = indexById(inventory?.approvalGates, "approval gate");
for (const row of approvalGates.values()) {
  assertExactKeys(
    row,
    ["id", "category", "requirements", "status", "owner", "question", "evidenceNeeded", "sourceRefs"],
    `approval gate ${row.id}`,
  );
  assertText(row.category, `approval gate ${row.id} category`);
  assertNonEmptyStrings(row.requirements, `approval gate ${row.id} requirements`);
  validateDecisionState(row, `approval gate ${row.id}`);
  assertSourceRefIds(row.sourceRefs, sourceRefs, `approval gate ${row.id}`);
}

for (const surface of surfaces.values()) {
  if (![...jurisdictions.values()].some((row) => row.surface === surface.id)) {
    fail(`surface ${surface.id} lacks a jurisdiction disposition`);
  }
  const activities = [...processingActivities.values()].filter((row) => row.surface === surface.id);
  if (!activities.length) fail(`surface ${surface.id} lacks a processing activity`);
  if (![...rightsWorkflows.values()].some((row) => row.surfaces.includes(surface.id))) {
    fail(`surface ${surface.id} lacks a rights-workflow disposition`);
  }
  if (!activities.some((activity) =>
    [...subprocessors.values()].some((processor) => processor.processingActivityIds.includes(activity.id))
  )) {
    fail(`surface ${surface.id} lacks a subprocessor or provider disposition`);
  }
}

const forbiddenPlaceholderPattern = /\b(?:TBD|UNKNOWN|TO BE DETERMINED)\b/iu;
if (forbiddenPlaceholderPattern.test(rawInventory)) {
  fail("inventory contains a fabricated placeholder; use null plus explicit blocker ownership");
}
const forbiddenSecretPatterns = [
  /\bsb_secret_[A-Za-z0-9_-]{12,}\b/u,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/u,
  /https:\/\/[^\s/:]+:[^\s/@]+@/u,
  /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  /(?:[?&](?:token|sig|signature|key)=)[^&\s"]+/iu,
];
for (const pattern of forbiddenSecretPatterns) {
  if (pattern.test(rawInventory)) fail(`inventory contains a forbidden private or secret-like value matching ${pattern}`);
}
if (/"(?:secretValue|accessToken|refreshToken|clientSecret|password|privateAccountId)"\s*:/iu.test(rawInventory)) {
  fail("inventory contains a forbidden secret or private-identifier field");
}

if (failures.length) {
  console.error("Legal and privacy readiness check failed.");
  [...new Set(failures)].sort().forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

const counts = new Map(allowedStatuses.map((status) => [status, 0]));
for (const collection of [
  operatorFacts,
  jurisdictions,
  processingActivities,
  subprocessors,
  retentionRules,
  rightsWorkflows,
  publicClaims,
  approvalGates,
]) {
  for (const row of collection.values()) counts.set(row.status, counts.get(row.status) + 1);
}

console.log("Legal and privacy readiness inventory OK.");
console.log(`- Surfaces: ${surfaces.size}`);
console.log(`- Processing activities: ${processingActivities.size}`);
console.log(`- Public-claim conflicts: ${publicClaims.size}`);
for (const status of allowedStatuses) {
  console.log(`- ${status}: ${counts.get(status)}`);
}
console.log("- Legal advice or approval inferred: no");
console.log("- Runtime/provider state inferred: no");

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
    return {};
  }
}

function indexById(rows, label) {
  const result = new Map();
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(`${label} inventory must be a non-empty array`);
    return result;
  }
  for (const row of rows) {
    const id = row?.id;
    assertId(id, `${label} id`);
    if (result.has(id)) fail(`${label} id ${id} is duplicated`);
    result.set(id, row);
  }
  return result;
}

function validateDecisionState(row, label) {
  if (!allowedStatuses.includes(row?.status)) {
    fail(`${label} has invalid status ${row?.status}`);
    return;
  }
  assertStringArray(row?.evidenceNeeded, `${label} evidenceNeeded`);
  if (row.status === "SOURCE_OBSERVED") {
    if (row.owner !== null || row.question !== null || row.evidenceNeeded.length !== 0) {
      fail(`${label} SOURCE_OBSERVED state must use null owner/question and empty evidenceNeeded`);
    }
    return;
  }
  assertText(row.owner, `${label} owner`);
  assertText(row.question, `${label} question`);
  assertNonEmptyStrings(row.evidenceNeeded, `${label} evidenceNeeded`);
}

function assertSourceRefIds(values, referenceMap, label) {
  assertReferences(values, referenceMap, `${label} source reference`);
}

function assertReferences(values, referenceCollection, label) {
  if (!Array.isArray(values)) {
    fail(`${label}s must be an array`);
    return;
  }
  for (const value of values) {
    assertReference(value, referenceCollection, label);
  }
}

function assertReference(value, referenceCollection, label) {
  if (typeof value !== "string" || !referenceCollection.has(value)) {
    fail(`${label} references missing ID ${String(value)}`);
  }
}

function assertRepositoryPath(value, label) {
  assertText(value, `${label} path`);
  if (typeof value !== "string") return;
  if (isAbsolute(value) || value.split(/[\\/]/u).includes("..")) {
    fail(`${label} path must remain repository-relative`);
    return;
  }
  const absolute = resolve(root, value);
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    fail(`${label} path escapes the repository`);
  } else if (!existsSync(absolute)) {
    fail(`${label} path does not exist: ${value}`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
    return;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} keys must be exactly ${expected.join(", ")}; found ${actual.join(", ")}`);
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    fail(`${label} must be a lowercase kebab-case ID`);
  }
}

function assertText(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(`${label} must be non-empty trimmed text`);
  }
}

function assertNullableText(value, label) {
  if (value !== null) assertText(value, label);
}

function assertStringArray(values, label) {
  if (!Array.isArray(values)) {
    fail(`${label} must be an array`);
    return;
  }
  for (const value of values) assertText(value, `${label} item`);
}

function assertNonEmptyStrings(values, label) {
  assertStringArray(values, label);
  if (!Array.isArray(values) || values.length === 0) fail(`${label} must be non-empty`);
}

function fail(message) {
  failures.push(message);
}
