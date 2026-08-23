import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { validateAppRouteMatrix } from "./app-router-inventory.mjs";

export const ROUTE_STATE_CLASSES = Object.freeze([
  "loading",
  "empty",
  "validation",
  "conflict",
  "offline",
  "timeout",
  "error",
  "not-found",
  "unavailable",
]);

export const ASSESSMENT_FIELDS = Object.freeze([
  "protectedCopy",
  "desktopMobileBehavior",
  "accessibility",
  "consoleNetwork",
  "metadataSecurityHeaders",
  "cachePrivacy",
  "performance",
  "previewVisualEvidence",
  "automatedTests",
  "manualTests",
]);

export const APP_ROUTE_EVIDENCE_LIMITS = Object.freeze({
  evidenceBytes: 262_144,
  matrixBytes: 131_072,
  publicUrlBytes: 16_384,
  sourceBytes: 131_072,
  catalogEntries: 17,
  profiles: 24,
  routes: 512,
  arrayItems: 32,
  stringCharacters: 512,
  failures: 32,
  diagnosticCharacters: 192,
});

export const EVIDENCE_SOURCE_CONTRACT = Object.freeze([
  Object.freeze({
    id: "accessibility-route-matrix",
    path: "scripts/check-accessibility-route-matrix.mjs",
    scope: "source-only accessibility route definitions; no browser or assistive-technology claim",
  }),
  Object.freeze({
    id: "app-route-evidence-checker",
    path: "scripts/check-app-route-evidence.mjs",
    scope: "actual CLI execution and categorical exit contract",
  }),
  Object.freeze({
    id: "app-route-evidence-tests",
    path: "scripts/lib/app-route-evidence.test.mjs",
    scope: "actual CLI and hostile route-evidence controls",
  }),
  Object.freeze({
    id: "app-route-evidence-validator",
    path: "scripts/lib/app-route-evidence.mjs",
    scope: "bounded source-only route-evidence validation contract",
  }),
  Object.freeze({
    id: "app-route-inventory",
    path: "scripts/check-app-route-inventory.mjs",
    scope: "App Router filesystem, route matrix, and redirect source contract",
  }),
  Object.freeze({
    id: "app-route-inventory-library",
    path: "scripts/lib/app-router-inventory.mjs",
    scope: "direct App Router inventory parser dependency used by route-evidence validation",
  }),
  Object.freeze({
    id: "app-route-inventory-tests",
    path: "scripts/lib/app-router-inventory.test.mjs",
    scope: "hostile source-only App Router inventory controls",
  }),
  Object.freeze({
    id: "content-guardrails",
    path: "scripts/check-content-guardrails.mjs",
    scope: "source-only public content and protected-copy guardrails",
  }),
  Object.freeze({
    id: "metadata-smoke",
    path: "scripts/check-observability-metadata-smoke.mjs",
    scope: "offline metadata contract; live mode is not claimed by this ledger",
  }),
  Object.freeze({
    id: "next-route-delivery",
    path: "scripts/check-next-route-delivery.mjs",
    scope: "source and build-contract route delivery checks; no live delivery claim",
  }),
  Object.freeze({
    id: "package-route-evidence-wiring",
    path: "package.json",
    scope: "exact npm commands for route-evidence checking and hostile tests",
  }),
  Object.freeze({
    id: "protected-content",
    path: "scripts/check-protected-content.mjs",
    scope: "exact protected-copy source contract",
  }),
  Object.freeze({
    id: "public-url-config",
    path: "apps/web/config/public-urls.json",
    scope: "canonical Website origin source used by route URL evidence",
  }),
  Object.freeze({
    id: "repository-check-runner",
    path: "scripts/check-all.mjs",
    scope: "full-repository execution wiring for route-evidence checks",
  }),
  Object.freeze({
    id: "runtime-performance",
    path: "scripts/check-web-runtime-performance.mjs",
    scope: "source performance budgets; no route-specific field measurement claim",
  }),
  Object.freeze({
    id: "security-hardening",
    path: "scripts/check-security-hardening.mjs",
    scope: "source-only security and privacy hardening contract",
  }),
  Object.freeze({
    id: "site-navigation",
    path: "scripts/check-site-navigation.mjs",
    scope: "source-only shared navigation contract; no browser journey claim",
  }),
]);

const profile = (id, status, evidence) => Object.freeze({
  id,
  status,
  evidence: Object.freeze(evidence),
});

export const ASSESSMENT_PROFILE_CONTRACT = Object.freeze([
  profile("accessibility-source-pending", "defined_not_run", ["accessibility-route-matrix"]),
  profile("cache-privacy-source-pending", "defined_not_run", ["security-hardening"]),
  profile("delivery-source-pending", "defined_not_run", ["next-route-delivery", "site-navigation"]),
  profile("inventory-automated-source", "verified_source", ["app-route-inventory", "app-route-inventory-library", "app-route-inventory-tests"]),
  profile("manual-not-run", "defined_not_run", []),
  profile("metadata-security-source-pending", "defined_not_run", ["metadata-smoke", "security-hardening"]),
  profile("not-applicable", "not_applicable", []),
  profile("performance-source-pending", "defined_not_run", ["runtime-performance"]),
  profile("protected-copy-source-pending", "defined_not_run", ["content-guardrails", "protected-content"]),
  profile("responsive-source-pending", "defined_not_run", ["accessibility-route-matrix"]),
  profile("runtime-not-run", "defined_not_run", []),
  profile("security-source-pending", "defined_not_run", ["security-hardening"]),
  profile("visual-not-run", "defined_not_run", []),
]);

const pendingStates = Object.freeze(Object.fromEntries(ROUTE_STATE_CLASSES.map((state) => [state, "defined_not_run"])));
const inapplicableStates = Object.freeze(Object.fromEntries(ROUTE_STATE_CLASSES.map((state) => [state, "not_applicable"])));

export const STATE_PROFILE_CONTRACT = Object.freeze([
  Object.freeze({ id: "internal-not-applicable", states: inapplicableStates, evidence: Object.freeze([]) }),
  Object.freeze({ id: "phase4-not-run", states: pendingStates, evidence: Object.freeze([]) }),
]);

const ASSESSMENT_STATUSES = Object.freeze([
  "verified_source",
  "defined_not_run",
  "not_applicable",
  "blocked_approval",
  "blocked_external",
]);
const STATE_STATUSES = ASSESSMENT_STATUSES;
const TERMINAL_STATUSES = Object.freeze([
  "passing",
  "in_progress",
  "blocked_approval",
  "blocked_external",
  "excluded_internal",
]);
const ROOT_KEYS = Object.freeze([
  "schemaVersion",
  "publicSafe",
  "inventoryCommit",
  "coverage",
  "routeMatrix",
  "stateClasses",
  "evidenceCatalog",
  "assessmentProfiles",
  "stateProfiles",
  "routes",
]);
const COVERAGE_KEYS = Object.freeze([
  "appRouterRoutes",
  "metadataAndStaticSurfaces",
  "storefrontSurfaces",
  "phase4Exit",
]);
const MATRIX_KEYS = Object.freeze([
  "path",
  "bytes",
  "sha256",
  "sourceCommit",
  "routeCount",
  "redirectCount",
]);
const CATALOG_KEYS = Object.freeze(["id", "path", "bytes", "sha256", "scope", "status"]);
const PROFILE_KEYS = Object.freeze(["id", "status", "evidence"]);
const STATE_PROFILE_KEYS = Object.freeze(["id", "states", "evidence"]);
const ROUTE_KEYS = Object.freeze([
  "path",
  "kind",
  "source",
  "surface",
  "productionSmoke",
  "methods",
  "canonicalUrl",
  "routeTemplateUrl",
  "sourceOwner",
  "audience",
  "authorizationClass",
  "upstreamData",
  "downstreamContracts",
  "assessments",
  "stateProfile",
  "terminalStatus",
  "remaining",
]);
const COVERAGE_CONTRACT = Object.freeze({
  appRouterRoutes: "matrix_complete_source_only",
  metadataAndStaticSurfaces: "pending_separate_inventory",
  storefrontSurfaces: "pending_separate_decision_record",
  phase4Exit: "not_claimed",
});
const SOURCE_OWNER = "Mochirii-Wushu/Mochirii-Website/apps/web";
const PUBLIC_URL_CONFIG_PATH = "apps/web/config/public-urls.json";
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[0-9A-F]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RELATIVE_PATH_PATTERN = /^[A-Za-z0-9._@+\-/[\]]+$/;
const PUBLIC_TEXT_PATTERN = /^[\x20-\x7E]+$/;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const UTF8_BOM = Object.freeze([0xEF, 0xBB, 0xBF]);
const IN_PROGRESS_REMAINING = Object.freeze([
  "automated, preview, and manual route evidence remains incomplete",
  "Phase 4 state coverage remains incomplete",
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function isBoundedPublicText(value, { allowEmpty = false } = {}) {
  return typeof value === "string"
    && value.length <= APP_ROUTE_EVIDENCE_LIMITS.stringCharacters
    && (allowEmpty || value.length > 0)
    && value.trim() === value
    && (value.length === 0 || PUBLIC_TEXT_PATTERN.test(value));
}

function isSafeRelativePath(value) {
  if (!isBoundedPublicText(value) || !RELATIVE_PATH_PATTERN.test(value)) return false;
  if (value.includes("\\") || value.startsWith("/") || path.isAbsolute(value)) return false;
  const segments = value.split("/");
  return segments.length > 0 && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function createFailureCollector() {
  const failures = [];
  let limitReported = false;
  return {
    failures,
    add(message) {
      if (failures.length >= APP_ROUTE_EVIDENCE_LIMITS.failures) {
        if (!limitReported) {
          failures[APP_ROUTE_EVIDENCE_LIMITS.failures - 1] = "failure limit reached; additional categorical diagnostics omitted [FAILURE_LIMIT]";
          limitReported = true;
        }
        return;
      }
      const bounded = String(message);
      failures.push(bounded.length <= APP_ROUTE_EVIDENCE_LIMITS.diagnosticCharacters
        ? bounded
        : "diagnostic rejected because its category exceeded the fixed bound [DIAGNOSTIC_BOUND]");
    },
  };
}

function realpath(value) {
  return typeof realpathSync.native === "function" ? realpathSync.native(value) : realpathSync(value);
}

function containedLexically(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function readContainedRegularFile(repositoryRoot, filePath, byteLimit) {
  const root = path.resolve(repositoryRoot);
  const candidate = path.resolve(filePath);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || !containedLexically(root, candidate)) throw new Error("input boundary");

  let current = root;
  for (const segment of path.relative(root, candidate).split(path.sep)) {
    current = path.join(current, segment);
    const currentStat = lstatSync(current);
    if (currentStat.isSymbolicLink()) throw new Error("symbolic input");
  }

  const source = lstatSync(candidate);
  if (source.isSymbolicLink() || !source.isFile() || source.size < 1 || source.size > byteLimit) throw new Error("input shape");
  const rootReal = realpath(root);
  const candidateReal = realpath(candidate);
  if (!containedLexically(rootReal, candidateReal)) throw new Error("resolved input boundary");

  const descriptor = openSync(candidate, "r");
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > byteLimit) throw new Error("opened input shape");
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (bytes.length !== before.size || after.size !== before.size || bytes.length > byteLimit) throw new Error("input drift");
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function readCanonicalJson(repositoryRoot, filePath, byteLimit) {
  const bytes = readContainedRegularFile(repositoryRoot, filePath, byteLimit);
  const text = decodeFatalUtf8WithoutBom(bytes);
  const value = JSON.parse(text);
  if (`${JSON.stringify(value, null, 2)}\n` !== text) throw new Error("noncanonical JSON");
  return { bytes, value };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function decodeFatalUtf8WithoutBom(bytes) {
  if (bytes.length >= UTF8_BOM.length
    && UTF8_BOM.every((value, index) => bytes[index] === value)) {
    throw new Error("UTF-8 BOM rejected");
  }
  return UTF8_DECODER.decode(bytes);
}

function validateBoundedStringArray(value, collector, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || value.length > APP_ROUTE_EVIDENCE_LIMITS.arrayItems || (!allowEmpty && value.length === 0)) {
    collector.add(`${label} rejected [ARRAY_SHAPE]`);
    return false;
  }
  let valid = true;
  for (const entry of value) {
    if (!isBoundedPublicText(entry)) {
      collector.add(`${label} rejected [ARRAY_TEXT]`);
      valid = false;
      break;
    }
  }
  if (new Set(value).size !== value.length) {
    collector.add(`${label} rejected [ARRAY_DUPLICATE]`);
    valid = false;
  }
  return valid;
}

function validateEvidenceCatalog(catalog, repositoryRoot, collector) {
  if (!Array.isArray(catalog)
    || catalog.length !== EVIDENCE_SOURCE_CONTRACT.length
    || catalog.length > APP_ROUTE_EVIDENCE_LIMITS.catalogEntries) {
    collector.add("evidence catalog rejected [CATALOG_SHAPE]");
    return new Set();
  }

  const ids = new Set();
  for (const [index, item] of catalog.entries()) {
    const expected = EVIDENCE_SOURCE_CONTRACT[index];
    const label = `evidenceCatalog[${index}]`;
    if (!exactKeys(item, CATALOG_KEYS)) {
      collector.add(`${label} rejected [CATALOG_KEYS]`);
      continue;
    }
    if (item.id !== expected.id || item.path !== expected.path || item.scope !== expected.scope || item.status !== "verified_source") {
      collector.add(`${label} rejected [CATALOG_CONTRACT]`);
    }
    if (!IDENTIFIER_PATTERN.test(item.id) || !isSafeRelativePath(item.path) || !isBoundedPublicText(item.scope)) {
      collector.add(`${label} rejected [CATALOG_TEXT]`);
    }
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > APP_ROUTE_EVIDENCE_LIMITS.sourceBytes || !SHA256_PATTERN.test(item.sha256)) {
      collector.add(`${label} rejected [CATALOG_BINDING]`);
    }
    if (ids.has(item.id)) collector.add(`${label} rejected [CATALOG_DUPLICATE]`);
    ids.add(item.id);

    try {
      const source = readContainedRegularFile(repositoryRoot, path.join(repositoryRoot, ...expected.path.split("/")), APP_ROUTE_EVIDENCE_LIMITS.sourceBytes);
      if (item.bytes !== source.length || item.sha256 !== sha256(source)) collector.add(`${label} rejected [SOURCE_DRIFT]`);
    } catch {
      collector.add(`${label} rejected [SOURCE_INPUT]`);
    }
  }
  return ids;
}

function validateAssessmentProfiles(profiles, evidenceIds, collector) {
  if (!Array.isArray(profiles)
    || profiles.length !== ASSESSMENT_PROFILE_CONTRACT.length
    || profiles.length > APP_ROUTE_EVIDENCE_LIMITS.profiles) {
    collector.add("assessment profiles rejected [PROFILE_SHAPE]");
    return new Map();
  }
  const result = new Map();
  for (const [index, current] of profiles.entries()) {
    const expected = ASSESSMENT_PROFILE_CONTRACT[index];
    const label = `assessmentProfiles[${index}]`;
    if (!exactKeys(current, PROFILE_KEYS)) {
      collector.add(`${label} rejected [PROFILE_KEYS]`);
      continue;
    }
    if (current.id !== expected.id || current.status !== expected.status || !sameArray(current.evidence, expected.evidence)) {
      collector.add(`${label} rejected [PROFILE_CONTRACT]`);
    }
    if (!IDENTIFIER_PATTERN.test(current.id) || !ASSESSMENT_STATUSES.includes(current.status)) {
      collector.add(`${label} rejected [PROFILE_TEXT]`);
    }
    validateBoundedStringArray(current.evidence, collector, `${label}.evidence`, { allowEmpty: true });
    if (Array.isArray(current.evidence) && current.evidence.some((id) => !evidenceIds.has(id))) {
      collector.add(`${label} rejected [PROFILE_EVIDENCE]`);
    }
    if (result.has(current.id)) collector.add(`${label} rejected [PROFILE_DUPLICATE]`);
    result.set(current.id, current);
  }
  return result;
}

function validateStateProfiles(profiles, evidenceIds, collector) {
  if (!Array.isArray(profiles)
    || profiles.length !== STATE_PROFILE_CONTRACT.length
    || profiles.length > APP_ROUTE_EVIDENCE_LIMITS.profiles) {
    collector.add("state profiles rejected [STATE_PROFILE_SHAPE]");
    return new Map();
  }
  const result = new Map();
  for (const [index, current] of profiles.entries()) {
    const expected = STATE_PROFILE_CONTRACT[index];
    const label = `stateProfiles[${index}]`;
    if (!exactKeys(current, STATE_PROFILE_KEYS)) {
      collector.add(`${label} rejected [STATE_PROFILE_KEYS]`);
      continue;
    }
    if (current.id !== expected.id || !exactKeys(current.states, ROUTE_STATE_CLASSES) || !sameArray(current.evidence, expected.evidence)) {
      collector.add(`${label} rejected [STATE_PROFILE_CONTRACT]`);
    }
    if (exactKeys(current.states, ROUTE_STATE_CLASSES)) {
      for (const state of ROUTE_STATE_CLASSES) {
        if (current.states[state] !== expected.states[state] || !STATE_STATUSES.includes(current.states[state])) {
          collector.add(`${label} rejected [STATE_STATUS]`);
          break;
        }
      }
    }
    validateBoundedStringArray(current.evidence, collector, `${label}.evidence`, { allowEmpty: true });
    if (Array.isArray(current.evidence) && current.evidence.some((id) => !evidenceIds.has(id))) {
      collector.add(`${label} rejected [STATE_EVIDENCE]`);
    }
    if (result.has(current.id)) collector.add(`${label} rejected [STATE_PROFILE_DUPLICATE]`);
    result.set(current.id, current);
  }
  return result;
}

function audienceFor(surface) {
  return {
    public: "matrix-declared public visitors",
    member: "matrix-declared signed-in members",
    moderator: "matrix-declared authorized moderators",
    private: "matrix-declared authorized raffle operators",
    internal: "matrix-declared build-time test harness",
    "not-found": "matrix-declared unmatched public requests",
  }[surface];
}

function authorizationFor(surface) {
  return {
    public: "matrix_declared_public_access",
    member: "matrix_declared_member_authorization_not_yet_evidenced",
    moderator: "matrix_declared_moderator_authorization_not_yet_evidenced",
    private: "matrix_declared_private_authorization_not_yet_evidenced",
    internal: "matrix_declared_internal_build_only",
    "not-found": "matrix_declared_not_found",
  }[surface];
}

function upstreamFor(route) {
  if (route.surface === "internal") return ["checked-in render-fixture scenario source"];
  if (route.surface === "not-found") return ["unmatched request path", "checked-in not-found source"];
  if (route.kind === "handler") {
    const values = ["HTTP request validation not yet evidenced"];
    if (["member", "moderator", "private"].includes(route.surface)) {
      values.push("route authorization dataflow not yet evidenced");
    }
    values.push("checked-in route source and server dependencies not yet inventoried");
    return values;
  }
  if (["member", "moderator", "private"].includes(route.surface)) {
    return [
      "route authorization dataflow not yet evidenced",
      "checked-in route source and server dependencies not yet inventoried",
    ];
  }
  return ["checked-in route source and public data dependencies not yet inventoried"];
}

function downstreamFor(route) {
  if (route.surface === "internal") return ["build-only render-fixture response"];
  if (route.surface === "not-found") return ["Next.js not-found document response"];
  if (route.kind === "handler") return ["Next.js route-handler HTTP response"];
  return ["Next.js document response and shared navigation shell"];
}

function assessmentsFor(route) {
  if (route.surface === "internal") {
    return Object.fromEntries(ASSESSMENT_FIELDS.map((field) => [field, field === "automatedTests" ? "inventory-automated-source" : "not-applicable"]));
  }
  if (route.kind === "handler") {
    return {
      protectedCopy: "not-applicable",
      desktopMobileBehavior: "not-applicable",
      accessibility: "not-applicable",
      consoleNetwork: "runtime-not-run",
      metadataSecurityHeaders: "security-source-pending",
      cachePrivacy: "cache-privacy-source-pending",
      performance: "runtime-not-run",
      previewVisualEvidence: "not-applicable",
      automatedTests: "inventory-automated-source",
      manualTests: "manual-not-run",
    };
  }
  return {
    protectedCopy: "protected-copy-source-pending",
    desktopMobileBehavior: "responsive-source-pending",
    accessibility: "accessibility-source-pending",
    consoleNetwork: "delivery-source-pending",
    metadataSecurityHeaders: "metadata-security-source-pending",
    cachePrivacy: "cache-privacy-source-pending",
    performance: "performance-source-pending",
    previewVisualEvidence: "visual-not-run",
    automatedTests: "inventory-automated-source",
    manualTests: "manual-not-run",
  };
}

function canonicalUrlFor(route, siteOrigin) {
  if (route.kind !== "page" || route.path.includes("[") || route.surface === "internal" || route.surface === "not-found") return null;
  return `${siteOrigin}${route.path === "/" ? "/" : route.path}`;
}

function routeTemplateUrl(pathname, siteOrigin) {
  return `${siteOrigin}${pathname === "/" ? "/" : pathname}`;
}

function readSiteOrigin(repositoryRoot, collector) {
  try {
    const bytes = readContainedRegularFile(
      repositoryRoot,
      path.join(repositoryRoot, ...PUBLIC_URL_CONFIG_PATH.split("/")),
      APP_ROUTE_EVIDENCE_LIMITS.publicUrlBytes,
    );
    const value = JSON.parse(decodeFatalUtf8WithoutBom(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "siteOrigin")) {
      throw new Error("public URL shape");
    }
    const siteOrigin = value.siteOrigin;
    if (!isBoundedPublicText(siteOrigin) || siteOrigin.length > 256) throw new Error("public URL text");
    const parsed = new URL(siteOrigin);
    if (parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.port !== ""
      || parsed.pathname !== "/"
      || parsed.search !== ""
      || parsed.hash !== ""
      || parsed.origin !== siteOrigin) {
      throw new Error("public URL origin");
    }
    return siteOrigin;
  } catch {
    collector.add("public URL config rejected [PUBLIC_URL_INPUT]");
    return null;
  }
}

function validateRoutes(routes, matrixRoutes, assessmentProfiles, stateProfiles, siteOrigin, collector) {
  if (!Array.isArray(routes)
    || routes.length !== matrixRoutes.length
    || routes.length > APP_ROUTE_EVIDENCE_LIMITS.routes) {
    collector.add("route evidence rows rejected [ROUTE_SHAPE]");
    return;
  }
  const usedAssessmentProfiles = new Set();
  const usedStateProfiles = new Set();
  const recordedPaths = new Set();

  for (const [index, route] of routes.entries()) {
    const matrixRoute = matrixRoutes[index];
    const label = `routes[${index}]`;
    if (!exactKeys(route, ROUTE_KEYS)) {
      collector.add(`${label} rejected [ROUTE_KEYS]`);
      continue;
    }
    if (route.path !== matrixRoute.path
      || route.kind !== matrixRoute.kind
      || route.source !== matrixRoute.source
      || route.surface !== matrixRoute.surface
      || route.productionSmoke !== matrixRoute.productionSmoke
      || !sameArray(route.methods, matrixRoute.methods || [])) {
      collector.add(`${label} rejected [ROUTE_IDENTITY]`);
    }
    if (recordedPaths.has(route.path)) collector.add(`${label} rejected [ROUTE_DUPLICATE]`);
    recordedPaths.add(route.path);
    if (route.canonicalUrl !== canonicalUrlFor(matrixRoute, siteOrigin)
      || route.routeTemplateUrl !== routeTemplateUrl(matrixRoute.path, siteOrigin)
      || route.sourceOwner !== SOURCE_OWNER) {
      collector.add(`${label} rejected [ROUTE_OWNER_URL]`);
    }
    if (route.audience !== audienceFor(matrixRoute.surface)
      || route.authorizationClass !== authorizationFor(matrixRoute.surface)) {
      collector.add(`${label} rejected [ROUTE_AUTHORIZATION]`);
    }
    const expectedUpstream = upstreamFor(matrixRoute);
    const expectedDownstream = downstreamFor(matrixRoute);
    validateBoundedStringArray(route.upstreamData, collector, `${label}.upstreamData`);
    validateBoundedStringArray(route.downstreamContracts, collector, `${label}.downstreamContracts`);
    if (!sameArray(route.upstreamData, expectedUpstream) || !sameArray(route.downstreamContracts, expectedDownstream)) {
      collector.add(`${label} rejected [ROUTE_CONTRACTS]`);
    }

    const expectedAssessments = assessmentsFor(matrixRoute);
    if (!exactKeys(route.assessments, ASSESSMENT_FIELDS)) {
      collector.add(`${label} rejected [ROUTE_ASSESSMENTS]`);
    } else {
      for (const field of ASSESSMENT_FIELDS) {
        const profileId = route.assessments[field];
        if (profileId !== expectedAssessments[field] || !assessmentProfiles.has(profileId)) {
          collector.add(`${label}.${field} rejected [ASSESSMENT_BINDING]`);
        }
        usedAssessmentProfiles.add(profileId);
      }
    }

    const expectedStateProfile = matrixRoute.surface === "internal" ? "internal-not-applicable" : "phase4-not-run";
    if (route.stateProfile !== expectedStateProfile || !stateProfiles.has(route.stateProfile)) {
      collector.add(`${label} rejected [STATE_BINDING]`);
    }
    usedStateProfiles.add(route.stateProfile);

    const expectedTerminal = matrixRoute.surface === "internal" ? "excluded_internal" : "in_progress";
    const expectedRemaining = matrixRoute.surface === "internal" ? [] : IN_PROGRESS_REMAINING;
    if (!TERMINAL_STATUSES.includes(route.terminalStatus)
      || route.terminalStatus !== expectedTerminal
      || !sameArray(route.remaining, expectedRemaining)) {
      collector.add(`${label} rejected [TERMINAL_STATUS]`);
    }
    validateBoundedStringArray(route.remaining, collector, `${label}.remaining`, { allowEmpty: matrixRoute.surface === "internal" });
  }

  if (recordedPaths.size !== matrixRoutes.length) collector.add("route evidence coverage rejected [ROUTE_COVERAGE]");
  for (const profileId of assessmentProfiles.keys()) {
    if (!usedAssessmentProfiles.has(profileId)) collector.add("assessment profile usage rejected [UNUSED_PROFILE]");
  }
  for (const profileId of stateProfiles.keys()) {
    if (!usedStateProfiles.has(profileId)) collector.add("state profile usage rejected [UNUSED_STATE_PROFILE]");
  }
}

export function validateAppRouteEvidence({
  evidencePath,
  routeMatrixPath,
  appDirectory,
  repositoryRoot,
  expectedInventoryCommit,
}) {
  const collector = createFailureCollector();
  const { failures } = collector;
  if (!COMMIT_PATTERN.test(expectedInventoryCommit)) {
    collector.add("inventory commit input rejected [INVENTORY_COMMIT_INPUT]");
    return { failures, evidence: null, routeMatrix: null };
  }

  let evidenceInput;
  try {
    evidenceInput = readCanonicalJson(repositoryRoot, evidencePath, APP_ROUTE_EVIDENCE_LIMITS.evidenceBytes);
  } catch {
    collector.add("route evidence input rejected [EVIDENCE_INPUT]");
    return { failures, evidence: null, routeMatrix: null };
  }

  let matrixInput;
  try {
    matrixInput = readCanonicalJson(repositoryRoot, routeMatrixPath, APP_ROUTE_EVIDENCE_LIMITS.matrixBytes);
  } catch {
    collector.add("route matrix input rejected [MATRIX_INPUT]");
    return { failures, evidence: evidenceInput.value, routeMatrix: null };
  }

  let matrixValidation;
  let matrixContractValid = true;
  try {
    matrixValidation = validateAppRouteMatrix({ appDirectory, matrixPath: routeMatrixPath });
  } catch {
    matrixContractValid = false;
  }
  if (!matrixValidation
    || matrixValidation.failures.length > 0
    || JSON.stringify(matrixValidation.matrix) !== JSON.stringify(matrixInput.value)) {
    matrixContractValid = false;
  }
  if (!matrixContractValid) {
    collector.add("route matrix contract rejected [MATRIX_CONTRACT]");
    return { failures, evidence: evidenceInput.value, routeMatrix: matrixInput.value };
  }

  const evidence = evidenceInput.value;
  const routeMatrix = matrixInput.value;
  if (!exactKeys(evidence, ROOT_KEYS)) {
    collector.add("route evidence root rejected [ROOT_KEYS]");
    return { failures, evidence, routeMatrix };
  }
  if (evidence.schemaVersion !== 1 || evidence.publicSafe !== true || evidence.inventoryCommit !== expectedInventoryCommit) {
    collector.add("route evidence identity rejected [ROOT_IDENTITY]");
  }
  if (!exactKeys(evidence.coverage, COVERAGE_KEYS)
    || Object.entries(COVERAGE_CONTRACT).some(([key, value]) => evidence.coverage[key] !== value)) {
    collector.add("route evidence coverage boundary rejected [COVERAGE_BOUNDARY]");
  }
  if (!sameArray(evidence.stateClasses, ROUTE_STATE_CLASSES)) {
    collector.add("route state classes rejected [STATE_CLASSES]");
  }

  const expectedMatrixPath = path.relative(path.resolve(repositoryRoot), path.resolve(routeMatrixPath)).split(path.sep).join("/");
  if (!exactKeys(evidence.routeMatrix, MATRIX_KEYS)
    || evidence.routeMatrix.path !== expectedMatrixPath
    || evidence.routeMatrix.bytes !== matrixInput.bytes.length
    || evidence.routeMatrix.sha256 !== sha256(matrixInput.bytes)
    || evidence.routeMatrix.sourceCommit !== expectedInventoryCommit
    || evidence.routeMatrix.routeCount !== routeMatrix?.routes?.length
    || evidence.routeMatrix.redirectCount !== routeMatrix?.redirects?.length) {
    collector.add("route matrix binding rejected [MATRIX_BINDING]");
  }

  if (!Array.isArray(routeMatrix.routes) || !Array.isArray(routeMatrix.redirects)) {
    collector.add("route matrix shape rejected [MATRIX_SHAPE]");
    return { failures, evidence, routeMatrix };
  }

  const evidenceIds = validateEvidenceCatalog(evidence.evidenceCatalog, repositoryRoot, collector);
  const siteOrigin = readSiteOrigin(repositoryRoot, collector);
  if (siteOrigin === null) return { failures, evidence, routeMatrix };
  const assessmentProfiles = validateAssessmentProfiles(evidence.assessmentProfiles, evidenceIds, collector);
  const stateProfiles = validateStateProfiles(evidence.stateProfiles, evidenceIds, collector);
  validateRoutes(evidence.routes, routeMatrix.routes, assessmentProfiles, stateProfiles, siteOrigin, collector);

  return { failures, evidence, routeMatrix };
}
