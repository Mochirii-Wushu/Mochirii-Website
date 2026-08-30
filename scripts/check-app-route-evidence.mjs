import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { TextDecoder, types } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const INVENTORY_COMMIT = "92fc424c6434e7baa4fe0387bfccf8d8a6631c4e";
const CHECKER_FAILURE = "app route evidence checker failed closed [CHECKER_FAILURE]";
const EXPECTED_ROUTE_COUNT = 38;
const EXPECTED_INTERNAL_ROUTE = "/raffle-render-fixtures-internal/[scenario]";
const EXPECTED_ROUTE_IDENTITY_SHA256 = "FB955893603287931B3021E2A1E7557F55772FED73ACC06D04E785D69968649F";
const RESULT_KEYS = Object.freeze(["failures", "evidence", "routeMatrix"]);
const EVIDENCE_KEYS = Object.freeze([
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
const ROUTE_MATRIX_KEYS = Object.freeze(["schemaVersion", "publicSafe", "routes", "redirects"]);
const EVIDENCE_ROUTE_KEYS = Object.freeze([
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
const MATRIX_PAGE_ROUTE_KEYS = Object.freeze(["path", "kind", "source", "surface", "productionSmoke"]);
const MATRIX_HANDLER_ROUTE_KEYS = Object.freeze([...MATRIX_PAGE_ROUTE_KEYS, "methods"]);
const INVALID_VALUE = Symbol("invalid-value");
const CHECKER_PATH = fileURLToPath(import.meta.url);
const CHECKER_DIRECTORY = path.dirname(CHECKER_PATH);
const VALIDATOR_PATH = path.join(CHECKER_DIRECTORY, "lib", "app-route-evidence.mjs");
const LOCAL_SOURCE_CONTRACT = Object.freeze([
  Object.freeze({
    path: VALIDATOR_PATH,
    bytes: 30_750,
    sha256: "2EEF9A3503734D8B3A345FAC9BE5E58B6680F32AC26341CF24155E261E4F5424",
  }),
  Object.freeze({
    path: path.join(CHECKER_DIRECTORY, "lib", "app-router-inventory.mjs"),
    bytes: 59_423,
    sha256: "5051994396F6B0EAC3033F13CF2DC41BD2DCD8FF3102CF11DC49F8B53F780D84",
  }),
]);
const VALIDATOR_RESULT_LIMIT = 524_288;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const FAILURE_CODES = new Set([
  "ARRAY_DUPLICATE",
  "ARRAY_SHAPE",
  "ARRAY_TEXT",
  "ASSESSMENT_BINDING",
  "CATALOG_BINDING",
  "CATALOG_CONTRACT",
  "CATALOG_DUPLICATE",
  "CATALOG_KEYS",
  "CATALOG_SHAPE",
  "CATALOG_TEXT",
  "COVERAGE_BOUNDARY",
  "DIAGNOSTIC_BOUND",
  "EVIDENCE_INPUT",
  "FAILURE_LIMIT",
  "INVENTORY_COMMIT_INPUT",
  "MATRIX_BINDING",
  "MATRIX_CONTRACT",
  "MATRIX_INPUT",
  "MATRIX_SHAPE",
  "PROFILE_CONTRACT",
  "PROFILE_DUPLICATE",
  "PROFILE_EVIDENCE",
  "PROFILE_KEYS",
  "PROFILE_SHAPE",
  "PROFILE_TEXT",
  "PUBLIC_URL_INPUT",
  "ROOT_IDENTITY",
  "ROOT_KEYS",
  "ROUTE_ASSESSMENTS",
  "ROUTE_AUTHORIZATION",
  "ROUTE_CONTRACTS",
  "ROUTE_COVERAGE",
  "ROUTE_DUPLICATE",
  "ROUTE_IDENTITY",
  "ROUTE_KEYS",
  "ROUTE_OWNER_URL",
  "ROUTE_SHAPE",
  "SOURCE_DRIFT",
  "SOURCE_INPUT",
  "STATE_BINDING",
  "STATE_CLASSES",
  "STATE_EVIDENCE",
  "STATE_PROFILE_CONTRACT",
  "STATE_PROFILE_DUPLICATE",
  "STATE_PROFILE_KEYS",
  "STATE_PROFILE_SHAPE",
  "STATE_STATUS",
  "TERMINAL_STATUS",
  "UNUSED_PROFILE",
  "UNUSED_STATE_PROFILE",
]);

function ownDataValue(record, key) {
  if (!record
    || typeof record !== "object"
    || types.isProxy(record)
    || Object.getPrototypeOf(record) !== Object.prototype) {
    return INVALID_VALUE;
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : INVALID_VALUE;
}

function hasExactOrdinaryDataKeys(record, expectedKeys) {
  if (!record
    || typeof record !== "object"
    || types.isProxy(record)
    || Object.getPrototypeOf(record) !== Object.prototype) {
    return false;
  }
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.length !== expectedKeys.length) return false;
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (ownKeys[index] !== expectedKeys[index]) return false;
    const descriptor = Object.getOwnPropertyDescriptor(record, expectedKeys[index]);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return false;
  }
  return true;
}

function ordinaryArrayValues(value, { exact, minimum = 0, maximum = exact } = {}) {
  if (types.isProxy(value)
    || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || Object.hasOwn(value, Symbol.iterator)) {
    return null;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value
    : INVALID_VALUE;
  if (!Number.isSafeInteger(length)
    || (exact !== undefined && length !== exact)
    || length < minimum
    || length > maximum) {
    return null;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1 || ownKeys[length] !== "length") return null;
  const values = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return null;
    values.push(descriptor.value);
  }
  return values;
}

function routeMethods(record, kind, { allowMissing = false } = {}) {
  const value = ownDataValue(record, "methods");
  if (value === INVALID_VALUE) return allowMissing && kind !== "handler" ? [] : null;
  const methods = ordinaryArrayValues(value, { minimum: 0, maximum: 7 });
  if (methods === null || methods.some((method) => typeof method !== "string" || method.length < 1 || method.length > 16)) return null;
  return methods;
}

function sameValues(left, right) {
  if (left === null || right === null || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function categoricalFailureCodes(result) {
  const failures = ordinaryArrayValues(ownDataValue(result, "failures"), { minimum: 1, maximum: 32 });
  if (failures === null) return null;
  const codes = [];
  for (let index = 0; index < failures.length; index += 1) {
    const failure = failures[index];
    if (typeof failure !== "string" || failure.length < 1 || failure.length > 192) return null;
    const match = failure.match(/\[([A-Z][A-Z0-9_]*)\]$/);
    if (!match || !FAILURE_CODES.has(match[1])) return null;
    codes.push(match[1]);
  }
  return codes;
}

export function summarizeAppRouteEvidenceResult(result) {
  if (!hasExactOrdinaryDataKeys(result, RESULT_KEYS)) return null;
  const failures = ordinaryArrayValues(ownDataValue(result, "failures"), { exact: 0 });
  const evidence = ownDataValue(result, "evidence");
  const routeMatrix = ownDataValue(result, "routeMatrix");
  const coverage = ownDataValue(evidence, "coverage");
  const routes = ordinaryArrayValues(ownDataValue(evidence, "routes"), { exact: EXPECTED_ROUTE_COUNT });
  const matrixRoutes = ordinaryArrayValues(ownDataValue(routeMatrix, "routes"), { exact: EXPECTED_ROUTE_COUNT });
  if (!hasExactOrdinaryDataKeys(evidence, EVIDENCE_KEYS)
    || !hasExactOrdinaryDataKeys(coverage, COVERAGE_KEYS)
    || !hasExactOrdinaryDataKeys(routeMatrix, ROUTE_MATRIX_KEYS)
    || failures === null
    || routes === null
    || matrixRoutes === null
    || ownDataValue(coverage, "phase4Exit") !== "not_claimed") {
    return null;
  }

  let excludedInternal = 0;
  let inProgress = 0;
  const identityProjection = [];
  const paths = new Set();
  for (let index = 0; index < EXPECTED_ROUTE_COUNT; index += 1) {
    const route = routes[index];
    const matrixRoute = matrixRoutes[index];
    const kind = ownDataValue(matrixRoute, "kind");
    const expectedMatrixRouteKeys = kind === "handler" ? MATRIX_HANDLER_ROUTE_KEYS : MATRIX_PAGE_ROUTE_KEYS;
    if (!hasExactOrdinaryDataKeys(route, EVIDENCE_ROUTE_KEYS)
      || !hasExactOrdinaryDataKeys(matrixRoute, expectedMatrixRouteKeys)) {
      return null;
    }
    const routePath = ownDataValue(route, "path");
    const matrixPath = ownDataValue(matrixRoute, "path");
    const source = ownDataValue(matrixRoute, "source");
    const surface = ownDataValue(matrixRoute, "surface");
    const productionSmoke = ownDataValue(matrixRoute, "productionSmoke");
    const terminalStatus = ownDataValue(route, "terminalStatus");
    const methods = routeMethods(route, kind);
    const matrixMethods = routeMethods(matrixRoute, kind, { allowMissing: true });
    if (typeof routePath !== "string"
      || routePath.length < 1
      || routePath.length > 512
      || routePath !== matrixPath
      || paths.has(routePath)
      || typeof kind !== "string"
      || typeof source !== "string"
      || typeof surface !== "string"
      || typeof productionSmoke !== "boolean"
      || ownDataValue(route, "kind") !== kind
      || ownDataValue(route, "source") !== source
      || ownDataValue(route, "surface") !== surface
      || ownDataValue(route, "productionSmoke") !== productionSmoke
      || !sameValues(methods, matrixMethods)) {
      return null;
    }
    paths.add(routePath);
    identityProjection.push([routePath, kind, source, surface, productionSmoke, matrixMethods]);
    if (surface === "internal") {
      if (routePath !== EXPECTED_INTERNAL_ROUTE || terminalStatus !== "excluded_internal") return null;
      excludedInternal += 1;
    } else {
      if (terminalStatus !== "in_progress") return null;
      inProgress += 1;
    }
  }
  if (excludedInternal !== 1
    || inProgress !== 37
    || createHash("sha256").update(JSON.stringify(identityProjection)).digest("hex").toUpperCase() !== EXPECTED_ROUTE_IDENTITY_SHA256) {
    return null;
  }
  return {
    routeCount: EXPECTED_ROUTE_COUNT,
    statusText: "excluded_internal=1, in_progress=37",
  };
}

function writeFixedCheckerFailure(writeError) {
  writeError("App route evidence validation failed (1 categorical issue).");
  writeError(`- ${CHECKER_FAILURE}`);
  return 1;
}

function verifyLocalSource({ path: sourcePath, bytes: expectedBytes, sha256: expectedSha256 }) {
  const stats = lstatSync(sourcePath);
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync(sourcePath) !== path.resolve(sourcePath)) return false;
  const bytes = readFileSync(sourcePath);
  return bytes.length === expectedBytes
    && createHash("sha256").update(bytes).digest("hex").toUpperCase() === expectedSha256;
}

function runCanonicalValidator(repositoryRoot) {
  for (let index = 0; index < LOCAL_SOURCE_CONTRACT.length; index += 1) {
    if (!verifyLocalSource(LOCAL_SOURCE_CONTRACT[index])) throw new Error("local source drift");
  }
  if (typeof repositoryRoot !== "string"
    || repositoryRoot.length < 1
    || repositoryRoot.length > 1_024
    || !path.isAbsolute(repositoryRoot)) {
    throw new Error("repository root rejected");
  }
  const source = `
import path from "node:path";
const repositoryRoot = ${JSON.stringify(path.resolve(repositoryRoot))};
try {
  const module = await import(${JSON.stringify(pathToFileURL(VALIDATOR_PATH).href)});
  if (typeof module.validateAppRouteEvidence !== "function") process.exit(1);
  const result = module.validateAppRouteEvidence({
    repositoryRoot,
    appDirectory: path.join(repositoryRoot, "apps", "web", "app"),
    evidencePath: path.join(repositoryRoot, "apps", "web", "config", "app-route-evidence.v1.json"),
    routeMatrixPath: path.join(repositoryRoot, "apps", "web", "config", "app-route-matrix.v1.json"),
    expectedInventoryCommit: ${JSON.stringify(INVENTORY_COMMIT)},
  });
  process.stdout.write(JSON.stringify({ marker: "app-route-evidence-validator-result", result }));
} catch {
  process.exit(1);
}
`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: repositoryRoot,
    encoding: null,
    env: {},
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: VALIDATOR_RESULT_LIMIT,
  });
  const stdout = Buffer.from(child.stdout || []);
  const stderr = Buffer.from(child.stderr || []);
  if (child.error
    || child.status !== 0
    || child.signal !== null
    || stderr.length !== 0
    || stdout.length < 1
    || stdout.length > VALIDATOR_RESULT_LIMIT
    || (stdout.length >= 3 && stdout[0] === 0xEF && stdout[1] === 0xBB && stdout[2] === 0xBF)) {
    throw new Error("validator child rejected");
  }
  const decoded = UTF8_DECODER.decode(stdout);
  const envelope = JSON.parse(decoded);
  if (!envelope
    || typeof envelope !== "object"
    || types.isProxy(envelope)
    || Object.getPrototypeOf(envelope) !== Object.prototype
    || Reflect.ownKeys(envelope).length !== 2
    || ownDataValue(envelope, "marker") !== "app-route-evidence-validator-result"
    || decoded !== JSON.stringify(envelope)) {
    throw new Error("validator envelope rejected");
  }
  return ownDataValue(envelope, "result");
}

export function runAppRouteEvidenceCheck({
  repositoryRoot = process.cwd(),
  validate,
  writeError = (message) => console.error(message),
  writeOutput = (message) => console.log(message),
} = {}) {
  if (validate !== undefined) {
    try {
      return writeFixedCheckerFailure(writeError);
    } catch {
      return 1;
    }
  }

  let result;
  try {
    result = runCanonicalValidator(repositoryRoot);
  } catch {
    try {
      return writeFixedCheckerFailure(writeError);
    } catch {
      return 1;
    }
  }

  try {
    if (!hasExactOrdinaryDataKeys(result, RESULT_KEYS)) throw new Error("malformed validator result");
    const failures = ordinaryArrayValues(ownDataValue(result, "failures"), { minimum: 0, maximum: 32 });
    if (failures === null) throw new Error("malformed validator failures");
    if (failures.length > 0) {
      const codes = categoricalFailureCodes(result);
      if (codes === null) throw new Error("malformed validator failures");
      writeError(`App route evidence validation failed (${codes.length} categorical issue${codes.length === 1 ? "" : "s"}).`);
      for (let index = 0; index < codes.length; index += 1) writeError(`- [${codes[index]}]`);
      return 1;
    }
    const success = summarizeAppRouteEvidenceResult(result);
    if (success === null) throw new Error("malformed validator success");
    writeOutput(`App route evidence OK (${success.routeCount} routes; ${success.statusText}; Phase 4 exit not claimed).`);
  } catch {
    try {
      return writeFixedCheckerFailure(writeError);
    } catch {
      return 1;
    }
  }
  return 0;
}

const isMain = typeof process.argv[1] === "string"
  && path.resolve(process.argv[1]) === CHECKER_PATH;
if (isMain) {
  try {
    process.exitCode = runAppRouteEvidenceCheck();
  } catch {
    try {
      process.exitCode = writeFixedCheckerFailure((message) => console.error(message));
    } catch {
      process.exitCode = 1;
    }
  }
}
