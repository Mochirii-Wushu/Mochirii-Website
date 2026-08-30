import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
const INVENTORY_COMMIT = "92fc424c6434e7baa4fe0387bfccf8d8a6631c4e";
const PRIVATE_SENTINEL = "MOCHIRII_PRIVATE_ROUTE_EVIDENCE_SENTINEL";
const SOURCE_OWNER = "Mochirii-Wushu/Mochirii-Website/apps/web";
const FIXTURE_SITE_ORIGIN = "https://fixture.example";
const CURRENT_REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CURRENT_CHECKER_PATH = path.join(CURRENT_REPOSITORY_ROOT, "scripts", "check-app-route-evidence.mjs");
const CURRENT_CHECKER_URL = pathToFileURL(CURRENT_CHECKER_PATH).href;
const CURRENT_EVIDENCE_PATH = path.join(CURRENT_REPOSITORY_ROOT, "apps", "web", "config", "app-route-evidence.v1.json");
const CURRENT_MATRIX_PATH = path.join(CURRENT_REPOSITORY_ROOT, "apps", "web", "config", "app-route-matrix.v1.json");
const CURRENT_VALIDATOR_PATH = path.join(CURRENT_REPOSITORY_ROOT, "scripts", "lib", "app-route-evidence.mjs");
const CURRENT_VALIDATOR_URL = pathToFileURL(CURRENT_VALIDATOR_PATH).href;
const CURRENT_INVENTORY_LIBRARY_PATH = path.join(CURRENT_REPOSITORY_ROOT, "scripts", "lib", "app-router-inventory.mjs");
const EXPECTED_CHECKER_OUTPUT = "App route evidence OK (38 routes; excluded_internal=1, in_progress=37; Phase 4 exit not claimed).\n";
const EXPECTED_CHECKER_BYTES = 15_211;
const EXPECTED_CHECKER_SHA256 = "599F50E2F1D5FF638991AD5B5812DE569787919CB8FFA7AFECA732A6B72DB457";
const EXPECTED_VALIDATOR_BYTES = 30_750;
const EXPECTED_VALIDATOR_SHA256 = "2EEF9A3503734D8B3A345FAC9BE5E58B6680F32AC26341CF24155E261E4F5424";
const EXPECTED_INVENTORY_LIBRARY_BYTES = 59_423;
const EXPECTED_INVENTORY_LIBRARY_SHA256 = "5051994396F6B0EAC3033F13CF2DC41BD2DCD8FF3102CF11DC49F8B53F780D84";
const CURRENT_IMPLEMENTATION_SOURCE_IDS = new Set([
  "app-route-evidence-checker",
  "app-route-evidence-tests",
  "app-route-evidence-validator",
  "app-route-inventory-library",
  "package-route-evidence-wiring",
  "repository-check-runner",
]);
const REMAINING = [
  "automated, preview, and manual route evidence remains incomplete",
  "Phase 4 state coverage remains incomplete",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function runValidatorChild(source, marker) {
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: CURRENT_REPOSITORY_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 524_288,
  });
  if (child.error || child.status !== 0 || child.signal !== null || child.stderr !== "" || child.stdout.length < 1) {
    throw new Error("validator child rejected");
  }
  const envelope = JSON.parse(child.stdout);
  if (!envelope || typeof envelope !== "object" || envelope.marker !== marker) throw new Error("validator child envelope rejected");
  return envelope.value;
}

function readValidatorContract() {
  const validatorBytes = readFileSync(CURRENT_VALIDATOR_PATH);
  const inventoryBytes = readFileSync(CURRENT_INVENTORY_LIBRARY_PATH);
  if (validatorBytes.length !== EXPECTED_VALIDATOR_BYTES
    || sha256(validatorBytes) !== EXPECTED_VALIDATOR_SHA256
    || inventoryBytes.length !== EXPECTED_INVENTORY_LIBRARY_BYTES
    || sha256(inventoryBytes) !== EXPECTED_INVENTORY_LIBRARY_SHA256) {
    throw new Error("validator source seal rejected");
  }
  const source = `
try {
  const module = await import(${JSON.stringify(CURRENT_VALIDATOR_URL)});
  process.stdout.write(JSON.stringify({
    marker: "validator-contract",
    value: {
      limits: module.APP_ROUTE_EVIDENCE_LIMITS,
      assessmentProfiles: module.ASSESSMENT_PROFILE_CONTRACT,
      evidenceSources: module.EVIDENCE_SOURCE_CONTRACT,
      routeStateClasses: module.ROUTE_STATE_CLASSES,
      stateProfiles: module.STATE_PROFILE_CONTRACT,
    },
  }));
} catch {
  process.exit(1);
}
`;
  return runValidatorChild(source, "validator-contract");
}

const VALIDATOR_CONTRACT = readValidatorContract();
const APP_ROUTE_EVIDENCE_LIMITS = Object.freeze(VALIDATOR_CONTRACT.limits);
const ASSESSMENT_PROFILE_CONTRACT = Object.freeze(VALIDATOR_CONTRACT.assessmentProfiles);
const EVIDENCE_SOURCE_CONTRACT = Object.freeze(VALIDATOR_CONTRACT.evidenceSources);
const ROUTE_STATE_CLASSES = Object.freeze(VALIDATOR_CONTRACT.routeStateClasses);
const STATE_PROFILE_CONTRACT = Object.freeze(VALIDATOR_CONTRACT.stateProfiles);

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assessmentBindings(route) {
  if (route.surface === "internal") {
    return {
      protectedCopy: "not-applicable",
      desktopMobileBehavior: "not-applicable",
      accessibility: "not-applicable",
      consoleNetwork: "not-applicable",
      metadataSecurityHeaders: "not-applicable",
      cachePrivacy: "not-applicable",
      performance: "not-applicable",
      previewVisualEvidence: "not-applicable",
      automatedTests: "inventory-automated-source",
      manualTests: "not-applicable",
    };
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

function routeRecord(route) {
  const internal = route.surface === "internal";
  const handler = route.kind === "handler";
  const upstreamData = internal
    ? ["checked-in render-fixture scenario source"]
    : handler
      ? [
        "HTTP request validation not yet evidenced",
        "route authorization dataflow not yet evidenced",
        "checked-in route source and server dependencies not yet inventoried",
      ]
      : ["checked-in route source and public data dependencies not yet inventoried"];
  return {
    path: route.path,
    kind: route.kind,
    source: route.source,
    surface: route.surface,
    productionSmoke: route.productionSmoke,
    methods: route.methods || [],
    canonicalUrl: internal || handler ? null : `${FIXTURE_SITE_ORIGIN}/`,
    routeTemplateUrl: `${FIXTURE_SITE_ORIGIN}${route.path === "/" ? "/" : route.path}`,
    sourceOwner: SOURCE_OWNER,
    audience: internal
      ? "matrix-declared build-time test harness"
      : handler
        ? "matrix-declared signed-in members"
        : "matrix-declared public visitors",
    authorizationClass: internal
      ? "matrix_declared_internal_build_only"
      : handler
        ? "matrix_declared_member_authorization_not_yet_evidenced"
        : "matrix_declared_public_access",
    upstreamData,
    downstreamContracts: internal
      ? ["build-only render-fixture response"]
      : handler
        ? ["Next.js route-handler HTTP response"]
        : ["Next.js document response and shared navigation shell"],
    assessments: assessmentBindings(route),
    stateProfile: internal ? "internal-not-applicable" : "phase4-not-run",
    terminalStatus: internal ? "excluded_internal" : "in_progress",
    remaining: internal ? [] : [...REMAINING],
  };
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "mochirii-route-evidence-"));
  const appDirectory = path.join(root, "apps", "web", "app");
  const configDirectory = path.join(root, "apps", "web", "config");
  mkdirSync(path.join(appDirectory, "api", "member"), { recursive: true });
  mkdirSync(path.join(appDirectory, "internal", "[scenario]"), { recursive: true });
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(path.join(appDirectory, "page.tsx"), "export default function Page() { return null; }\n");
  writeFileSync(path.join(appDirectory, "api", "member", "route.ts"), "export async function POST() { return new Response(null); }\n");
  writeFileSync(path.join(appDirectory, "internal", "[scenario]", "page.tsx"), "export default function Fixture() { return null; }\n");

  for (const [index, source] of EVIDENCE_SOURCE_CONTRACT.entries()) {
    const sourcePath = path.join(root, ...source.path.split("/"));
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    if (CURRENT_IMPLEMENTATION_SOURCE_IDS.has(source.id)) {
      copyFileSync(path.join(CURRENT_REPOSITORY_ROOT, ...source.path.split("/")), sourcePath);
    } else if (source.id === "public-url-config") {
      writeJson(sourcePath, { siteOrigin: FIXTURE_SITE_ORIGIN });
    } else {
      writeFileSync(sourcePath, `export const fixture${index} = true;\n`);
    }
  }

  const routeMatrix = {
    schemaVersion: 1,
    publicSafe: true,
    routes: [
      { path: "/", kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: true },
      { path: "/api/member", kind: "handler", source: "app/api/member/route.ts", surface: "member", productionSmoke: false, methods: ["POST"] },
      { path: "/internal/[scenario]", kind: "page", source: "app/internal/[scenario]/page.tsx", surface: "internal", productionSmoke: false },
    ],
    redirects: [],
  };
  const matrixPath = path.join(configDirectory, "app-route-matrix.v1.json");
  const evidencePath = path.join(configDirectory, "app-route-evidence.v1.json");
  writeJson(matrixPath, routeMatrix);
  const matrixBytes = readFileSync(matrixPath);

  const evidence = {
    schemaVersion: 1,
    publicSafe: true,
    inventoryCommit: INVENTORY_COMMIT,
    coverage: {
      appRouterRoutes: "matrix_complete_source_only",
      metadataAndStaticSurfaces: "pending_separate_inventory",
      storefrontSurfaces: "pending_separate_decision_record",
      phase4Exit: "not_claimed",
    },
    routeMatrix: {
      path: "apps/web/config/app-route-matrix.v1.json",
      bytes: matrixBytes.length,
      sha256: sha256(matrixBytes),
      sourceCommit: INVENTORY_COMMIT,
      routeCount: routeMatrix.routes.length,
      redirectCount: routeMatrix.redirects.length,
    },
    stateClasses: [...ROUTE_STATE_CLASSES],
    evidenceCatalog: EVIDENCE_SOURCE_CONTRACT.map((source) => {
      const bytes = readFileSync(path.join(root, ...source.path.split("/")));
      return { ...source, bytes: bytes.length, sha256: sha256(bytes), status: "verified_source" };
    }),
    assessmentProfiles: ASSESSMENT_PROFILE_CONTRACT.map((current) => ({
      id: current.id,
      status: current.status,
      evidence: [...current.evidence],
    })),
    stateProfiles: STATE_PROFILE_CONTRACT.map((current) => ({
      id: current.id,
      states: { ...current.states },
      evidence: [...current.evidence],
    })),
    routes: routeMatrix.routes.map(routeRecord),
  };
  writeJson(evidencePath, evidence);
  return { root, appDirectory, matrixPath, evidencePath, routeMatrix, evidence };
}

function validate(current, { rewriteEvidence = true } = {}) {
  if (rewriteEvidence) writeJson(current.evidencePath, current.evidence);
  const source = `
import { validateAppRouteEvidence } from ${JSON.stringify(CURRENT_VALIDATOR_URL)};
try {
  const value = validateAppRouteEvidence({
    repositoryRoot: ${JSON.stringify(current.root)},
    appDirectory: ${JSON.stringify(current.appDirectory)},
    evidencePath: ${JSON.stringify(current.evidencePath)},
    routeMatrixPath: ${JSON.stringify(current.matrixPath)},
    expectedInventoryCommit: ${JSON.stringify(INVENTORY_COMMIT)},
  });
  process.stdout.write(JSON.stringify({ marker: "validator-result", value }));
} catch {
  process.exit(1);
}
`;
  return runValidatorChild(source, "validator-result");
}

function withFixture(callback) {
  const current = createFixture();
  try {
    callback(current);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
}

function assertCategorical(result) {
  assert(result.failures.length > 0);
  assert(result.failures.length <= APP_ROUTE_EVIDENCE_LIMITS.failures);
  assert(result.failures.every((failure) => failure.length <= APP_ROUTE_EVIDENCE_LIMITS.diagnosticCharacters));
  const joined = result.failures.join("\n");
  assert(!joined.includes(PRIVATE_SENTINEL));
  assert(!joined.includes("file://"));
  assert(!joined.includes("Error:"));
  assert(!joined.includes(" at "));
}

function runCheckerSeam(scenario) {
  const source = `
import { runAppRouteEvidenceCheck } from ${JSON.stringify(CURRENT_CHECKER_URL)};
const sentinel = ${JSON.stringify(PRIVATE_SENTINEL)};
let calls = 0;
const scenarios = {
  thrown: () => { throw new Error(sentinel); },
  malformed: () => ({ failures: [], evidence: null }),
  rawFailure: () => ({ failures: [\`Error: \${sentinel} at C:\\\\private\\\\evidence.json\`], evidence: null }),
  tooManyFailures: () => ({ failures: Array.from({ length: 33 }, () => "route rejected [ROUTE_KEYS]"), evidence: null }),
  forgedOneRoute: () => ({
    failures: [],
    evidence: { coverage: { phase4Exit: "not_claimed" }, routes: [{ path: "/", kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: true, terminalStatus: "in_progress" }] },
    routeMatrix: { routes: [{ path: "/", kind: "page", source: "app/page.tsx", surface: "public", productionSmoke: true }] },
  }),
  forgedAllInProgress: () => ({
    failures: [],
    evidence: {
      coverage: { phase4Exit: "not_claimed" },
      routes: Array.from({ length: 38 }, (_, index) => ({ path: \`/forged-\${index}\`, kind: "page", source: \`app/forged-\${index}/page.tsx\`, surface: "public", productionSmoke: true, terminalStatus: "in_progress" })),
    },
    routeMatrix: {
      routes: Array.from({ length: 38 }, (_, index) => ({ path: \`/forged-\${index}\`, kind: "page", source: \`app/forged-\${index}/page.tsx\`, surface: "public", productionSmoke: true })),
    },
  }),
  tooManyRoutes: () => ({
    failures: [],
    evidence: {
      coverage: { phase4Exit: "not_claimed" },
      routes: Array.from({ length: 513 }, () => ({ terminalStatus: "in_progress" })),
    },
    routeMatrix: { routes: Array.from({ length: 513 }, () => ({})) },
  }),
  customFailureIterator: () => {
    const failures = ["route rejected [ROUTE_KEYS]"];
    failures[Symbol.iterator] = function* () {
      for (let index = 0; index < 64; index += 1) yield "route rejected [ROUTE_KEYS]";
    };
    return { failures, evidence: null, routeMatrix: null };
  },
  customRouteIterator: () => {
    const routes = [{ terminalStatus: "in_progress" }];
    routes[Symbol.iterator] = function* () {
      for (let index = 0; index < 64; index += 1) yield { terminalStatus: "in_progress" };
    };
    return { failures: [], evidence: { coverage: { phase4Exit: "not_claimed" }, routes }, routeMatrix: { routes: [{}] } };
  },
};
const errors = [];
const outputs = [];
const code = runAppRouteEvidenceCheck({
  repositoryRoot: process.cwd(),
  validate: (...args) => {
    calls += 1;
    return scenarios[${JSON.stringify(scenario)}](...args);
  },
  writeError: (message) => errors.push(message),
  writeOutput: (message) => outputs.push(message),
});
process.stdout.write(JSON.stringify({ marker: "checker-seam-result", calls, code, errors, outputs }));
`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: CURRENT_REPOSITORY_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  const result = JSON.parse(child.stdout);
  assert.equal(result.marker, "checker-seam-result");
  return result;
}

function runSummarySeam(scenario) {
  const source = `
import { readFileSync } from "node:fs";
import { summarizeAppRouteEvidenceResult } from ${JSON.stringify(CURRENT_CHECKER_URL)};
const evidence = JSON.parse(readFileSync(${JSON.stringify(CURRENT_EVIDENCE_PATH)}, "utf8"));
const routeMatrix = JSON.parse(readFileSync(${JSON.stringify(CURRENT_MATRIX_PATH)}, "utf8"));
let getterCalls = 0;
let trapCalls = 0;
let result = { failures: [], evidence, routeMatrix };
const scenario = ${JSON.stringify(scenario)};
if (scenario === "forgedIdentity") {
  evidence.routes[0].path = "/forged-public-route";
  evidence.routes[0].source = "app/forged-public-route/page.tsx";
  routeMatrix.routes[0].path = "/forged-public-route";
  routeMatrix.routes[0].source = "app/forged-public-route/page.tsx";
} else if (scenario === "methodSubstitution") {
  const handlerIndex = routeMatrix.routes.findIndex((route) => route.kind === "handler");
  evidence.routes[handlerIndex].methods = ["GET"];
} else if (scenario === "allInProgress") {
  const internalIndex = routeMatrix.routes.findIndex((route) => route.surface === "internal");
  evidence.routes[internalIndex].terminalStatus = "in_progress";
} else if (scenario === "customFailureIterator") {
  result.failures[Symbol.iterator] = function* () { while (true) yield "route rejected [ROUTE_KEYS]"; };
} else if (scenario === "customRouteIterator") {
  evidence.routes[Symbol.iterator] = function* () { while (true) yield evidence.routes[0]; };
} else if (scenario === "numericGetter") {
  Object.defineProperty(evidence.routes, "0", { enumerable: true, configurable: true, get() { getterCalls += 1; return evidence.routes[1]; } });
} else if (scenario === "recordProxy") {
  result = new Proxy(result, {
    getPrototypeOf() { trapCalls += 1; throw new Error("proxy trap"); },
    getOwnPropertyDescriptor() { trapCalls += 1; throw new Error("proxy trap"); },
  });
} else if (scenario === "arrayProxy") {
  evidence.routes = new Proxy(evidence.routes, {
    getPrototypeOf() { trapCalls += 1; throw new Error("proxy trap"); },
    getOwnPropertyDescriptor() { trapCalls += 1; throw new Error("proxy trap"); },
  });
} else if (scenario === "extraArrayKey") {
  evidence.routes.extra = "unexpected";
} else if (scenario === "arraySubclass") {
  class RouteArray extends Array {}
  evidence.routes = new RouteArray(...evidence.routes);
} else if (scenario === "sparseArray") {
  delete evidence.routes[0];
} else if (scenario === "extraResultKey") {
  result.extra = "unexpected";
} else if (scenario === "extraEvidenceKey") {
  evidence.extra = "unexpected";
} else if (scenario === "extraCoverageKey") {
  evidence.coverage.extra = "unexpected";
} else if (scenario === "extraMatrixKey") {
  routeMatrix.extra = "unexpected";
} else if (scenario === "extraRouteKey") {
  evidence.routes[0].extra = "unexpected";
} else if (scenario === "extraMatrixRouteKey") {
  routeMatrix.routes[0].extra = "unexpected";
} else if (scenario === "extraSymbolKey") {
  evidence[Symbol("unexpected")] = "unexpected";
} else if (scenario === "accessorResultKey") {
  Object.defineProperty(result, "evidence", { enumerable: true, configurable: true, get() { getterCalls += 1; return evidence; } });
} else if (scenario === "accessorEvidenceKey") {
  Object.defineProperty(evidence, "schemaVersion", { enumerable: true, configurable: true, get() { getterCalls += 1; return "1"; } });
} else if (scenario === "accessorCoverageKey") {
  Object.defineProperty(evidence.coverage, "phase4Exit", { enumerable: true, configurable: true, get() { getterCalls += 1; return "not_claimed"; } });
} else if (scenario === "accessorMatrixKey") {
  Object.defineProperty(routeMatrix, "routes", { enumerable: true, configurable: true, get() { getterCalls += 1; return []; } });
} else if (scenario === "accessorRouteKey") {
  Object.defineProperty(evidence.routes[0], "canonicalUrl", { enumerable: true, configurable: true, get() { getterCalls += 1; return "https://example.invalid"; } });
} else if (scenario === "accessorMatrixRouteKey") {
  Object.defineProperty(routeMatrix.routes[0], "productionSmoke", { enumerable: true, configurable: true, get() { getterCalls += 1; return false; } });
} else if (scenario === "recordSubclass") {
  Object.setPrototypeOf(evidence, Object.create(Object.prototype));
}
let summary = null;
let threw = false;
try {
  summary = summarizeAppRouteEvidenceResult(result);
} catch {
  threw = true;
}
process.stdout.write(JSON.stringify({ marker: "summary-seam-result", getterCalls, trapCalls, threw, summary }));
`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: CURRENT_REPOSITORY_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 2_000,
    maxBuffer: 65_536,
  });
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  const result = JSON.parse(child.stdout);
  assert.equal(result.marker, "summary-seam-result");
  return result;
}

function isCategoricalFalseEvidenceRejection(result) {
  return result.status === 1
    && result.signal === null
    && result.stderr.includes("[COVERAGE_BOUNDARY]")
    && result.stdout === "";
}

function isExactCheckerSuccess(result) {
  return result.status === 0
    && result.signal === null
    && result.stderr === ""
    && result.stdout === EXPECTED_CHECKER_OUTPUT;
}

function localRelativeImports(sourcePath) {
  const source = readFileSync(path.join(CURRENT_REPOSITORY_ROOT, ...sourcePath.split("/")), "utf8");
  const specifiers = [];
  const patterns = [
    /(?:from\s*|import\s*)["'](\.[^"']+)["']/g,
    /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return [...new Set(specifiers.map((specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier))))].sort();
}

test("accepts the exact source-only page, handler, and internal contracts", () => {
  withFixture((current) => {
    assert.deepEqual(validate(current).failures, []);
    assert.equal(current.evidence.routes[1].authorizationClass, "matrix_declared_member_authorization_not_yet_evidenced");
    assert(current.evidence.routes[1].upstreamData.every((entry) => entry.includes("not yet")));
    assert(!JSON.stringify(current.evidence.routes[1]).includes("server-verified"));
  });
});

test("binds every catalog entry to its exact checked-in bytes", () => {
  withFixture((current) => {
    const sourcePath = path.join(current.root, ...EVIDENCE_SOURCE_CONTRACT[0].path.split("/"));
    writeFileSync(sourcePath, `export const changed = "${PRIVATE_SENTINEL}";\n`);
    const result = validate(current);
    assert(result.failures.includes("evidenceCatalog[0] rejected [SOURCE_DRIFT]"));
    assertCategorical(result);
  });
});

test("rejects catalog traversal without echoing the path", () => {
  withFixture((current) => {
    current.evidence.evidenceCatalog[0].path = `../${PRIVATE_SENTINEL}`;
    const result = validate(current);
    assert(result.failures.some((failure) => failure.includes("[CATALOG_CONTRACT]")));
    assert(result.failures.some((failure) => failure.includes("[CATALOG_TEXT]")));
    assertCategorical(result);
  });
});

test("rejects catalog size and digest substitution", () => {
  withFixture((current) => {
    current.evidence.evidenceCatalog[1].bytes += 1;
    current.evidence.evidenceCatalog[2].sha256 = "A".repeat(64);
    const result = validate(current);
    assert(result.failures.filter((failure) => failure.includes("[SOURCE_DRIFT]")).length >= 2);
  });
});

test("rejects a catalog source beyond the bounded source-input limit", () => {
  withFixture((current) => {
    const entry = current.evidence.evidenceCatalog[0];
    const sourcePath = path.join(current.root, ...entry.path.split("/"));
    const oversized = Buffer.alloc(APP_ROUTE_EVIDENCE_LIMITS.sourceBytes + 1, 0x20);
    writeFileSync(sourcePath, oversized);
    entry.bytes = oversized.length;
    entry.sha256 = sha256(oversized);
    const result = validate(current);
    assert(result.failures.includes("evidenceCatalog[0] rejected [CATALOG_BINDING]"));
    assert(result.failures.includes("evidenceCatalog[0] rejected [SOURCE_INPUT]"));
    assertCategorical(result);
  });
});

test("rejects route-matrix byte binding drift", () => {
  withFixture((current) => {
    current.evidence.routeMatrix.bytes += 1;
    current.evidence.routeMatrix.sha256 = "B".repeat(64);
    assert(validate(current).failures.includes("route matrix binding rejected [MATRIX_BINDING]"));
  });
});

test("rejects a matrix that no longer matches the App Router filesystem", () => {
  withFixture((current) => {
    current.routeMatrix.routes[0].source = "app/other/page.tsx";
    writeJson(current.matrixPath, current.routeMatrix);
    const matrixBytes = readFileSync(current.matrixPath);
    current.evidence.routeMatrix.bytes = matrixBytes.length;
    current.evidence.routeMatrix.sha256 = sha256(matrixBytes);
    const result = validate(current);
    assert.deepEqual(result.failures, ["route matrix contract rejected [MATRIX_CONTRACT]"]);
  });
});

test("rejects route identity and handler-method substitution", () => {
  withFixture((current) => {
    current.evidence.routes[0].source = "app/replacement/page.tsx";
    current.evidence.routes[1].methods = ["GET"];
    const failures = validate(current).failures;
    assert.equal(failures.filter((failure) => failure.includes("[ROUTE_IDENTITY]")).length, 2);
  });
});

test("rejects route URL and source-owner substitution", () => {
  withFixture((current) => {
    current.evidence.routes[0].canonicalUrl = `${FIXTURE_SITE_ORIGIN}/replacement`;
    current.evidence.routes[1].sourceOwner = `${SOURCE_OWNER}/replacement`;
    current.evidence.routes[2].routeTemplateUrl = `${FIXTURE_SITE_ORIGIN}/replacement`;
    const failures = validate(current).failures;
    assert.equal(failures.filter((failure) => failure.includes("[ROUTE_OWNER_URL]")).length, 3);
  });
});

test("actual CLI rejects false evidence with a nonzero categorical exit", () => {
  withFixture((current) => {
    current.evidence.coverage.phase4Exit = "passing";
    writeJson(current.evidencePath, current.evidence);
    const result = spawnSync(process.execPath, [CURRENT_CHECKER_PATH], {
      cwd: current.root,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(isCategoricalFalseEvidenceRejection(result), true);
    assert(!result.stderr.includes(PRIVATE_SENTINEL));
  });
});

test("surviving parent detects a real-root-only early-success checker mutation", () => {
  withFixture((current) => {
    const checkerPath = path.join(current.root, "scripts", "check-app-route-evidence.mjs");
    const exactSource = readFileSync(CURRENT_CHECKER_PATH, "utf8");
    const marker = "const INVENTORY_COMMIT =";
    const mutatedSource = exactSource.replace(marker, `if (process.cwd() === ${JSON.stringify(CURRENT_REPOSITORY_ROOT)}) process.exit(0);\n\n${marker}`);
    assert.notEqual(mutatedSource, exactSource);
    assert.notEqual(sha256(mutatedSource), sha256(exactSource));
    writeFileSync(checkerPath, mutatedSource);
    const result = spawnSync(process.execPath, [checkerPath], {
      cwd: CURRENT_REPOSITORY_ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(isExactCheckerSuccess(result), false);
  });
});

test("exact checker rejects noncanonical validator-child output", () => {
  const exactSource = readFileSync(CURRENT_CHECKER_PATH, "utf8");
  const exactWrite = 'process.stdout.write(JSON.stringify({ marker: "app-route-evidence-validator-result", result }));';
  const replacements = [
    'process.stdout.write(" " + JSON.stringify({ marker: "app-route-evidence-validator-result", result }));',
    'process.stdout.write(JSON.stringify({ marker: "app-route-evidence-validator-result", result }) + " ");',
    `process.stdout.write('{"marker":"app-route-evidence-validator-result",' + JSON.stringify({ marker: "app-route-evidence-validator-result", result }).slice(1));`,
  ];
  for (const replacement of replacements) {
    withFixture((current) => {
      const checkerPath = path.join(current.root, "scripts", "check-app-route-evidence.mjs");
      const mutatedSource = exactSource.replace(exactWrite, replacement);
      assert.notEqual(mutatedSource, exactSource);
      assert.notEqual(sha256(mutatedSource), sha256(exactSource));
      writeFileSync(checkerPath, mutatedSource);
      const checkerEntry = current.evidence.evidenceCatalog.find((item) => item.id === "app-route-evidence-checker");
      checkerEntry.bytes = Buffer.byteLength(mutatedSource);
      checkerEntry.sha256 = sha256(mutatedSource);
      writeJson(current.evidencePath, current.evidence);
      const result = spawnSync(process.execPath, [checkerPath], {
        cwd: current.root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 2_000,
        maxBuffer: 65_536,
      });
      assert.equal(result.status, 1);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert(result.stderr.includes("[CHECKER_FAILURE]"));
      assert(result.stderr.length <= 256);
      assert(!result.stderr.includes(PRIVATE_SENTINEL));
      assert(!result.stderr.includes(current.root));
    });
  }
});

test("validator child receives no inherited Node injection options", () => {
  const preloadSource = 'if (process.argv.length === 1) process.stdout.write(" ");';
  const result = spawnSync(process.execPath, [CURRENT_CHECKER_PATH], {
    cwd: CURRENT_REPOSITORY_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(preloadSource)}`,
    },
    windowsHide: true,
    timeout: 17_000,
    maxBuffer: 589_824,
  });
  assert.equal(isExactCheckerSuccess(result), true);
});

test("exact checker rejects imported validator and parser drift before evaluation", () => {
  for (const id of ["app-route-evidence-validator", "app-route-inventory-library"]) {
    withFixture((current) => {
      const source = EVIDENCE_SOURCE_CONTRACT.find((item) => item.id === id);
      writeFileSync(path.join(current.root, ...source.path.split("/")), `process.exit(0); // ${PRIVATE_SENTINEL}\n`);
      const result = spawnSync(process.execPath, [path.join(current.root, "scripts", "check-app-route-evidence.mjs")], {
        cwd: current.root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 2_000,
        maxBuffer: 65_536,
      });
      assert.equal(result.status, 1);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert(result.stderr.includes("[CHECKER_FAILURE]"));
      assert(!result.stderr.includes(PRIVATE_SENTINEL));
      assert(!result.stderr.includes(current.root));
    });
  }
});

test("actual CLI contains malformed public-URL input before diagnostics", () => {
  withFixture((current) => {
    const publicUrlSource = EVIDENCE_SOURCE_CONTRACT.find((source) => source.id === "public-url-config");
    const publicUrlPath = path.join(current.root, ...publicUrlSource.path.split("/"));
    writeFileSync(publicUrlPath, `{"siteOrigin":"${PRIVATE_SENTINEL}`);
    const result = spawnSync(process.execPath, [CURRENT_CHECKER_PATH], {
      cwd: current.root,
      encoding: "utf8",
      windowsHide: true,
    });
    const diagnostic = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1);
    assert(diagnostic.includes("[PUBLIC_URL_INPUT]"));
    assert(!diagnostic.includes(PRIVATE_SENTINEL));
    assert(!diagnostic.includes(current.root));
    assert(!diagnostic.includes("Error:"));
    assert(!diagnostic.includes(" at "));
  });
});

test("actual CLI rejects a route-matrix BOM before diagnostics", () => {
  withFixture((current) => {
    const exact = readFileSync(current.matrixPath);
    writeFileSync(current.matrixPath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), exact]));
    const result = spawnSync(process.execPath, [CURRENT_CHECKER_PATH], {
      cwd: current.root,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert(result.stderr.includes("[MATRIX_INPUT]"));
    assert(result.stderr.length <= 256);
    assert(!result.stderr.includes(current.root));
    assert(!result.stderr.includes("Error:"));
    assert(!result.stderr.includes(" at "));
  });
});

test("checked-in evidence independently seals implementation bytes and the real-root CLI", () => {
  const checkedInEvidence = JSON.parse(readFileSync(CURRENT_EVIDENCE_PATH, "utf8"));
  const checkerBytes = readFileSync(CURRENT_CHECKER_PATH);
  const checkerEntry = checkedInEvidence.evidenceCatalog.find((item) => item.id === "app-route-evidence-checker");
  assert.equal(checkerBytes.length, EXPECTED_CHECKER_BYTES);
  assert.equal(sha256(checkerBytes), EXPECTED_CHECKER_SHA256);
  assert.equal(checkerEntry.bytes, EXPECTED_CHECKER_BYTES);
  assert.equal(checkerEntry.sha256, EXPECTED_CHECKER_SHA256);
  for (const id of CURRENT_IMPLEMENTATION_SOURCE_IDS) {
    const source = EVIDENCE_SOURCE_CONTRACT.find((item) => item.id === id);
    const bytes = readFileSync(path.join(CURRENT_REPOSITORY_ROOT, ...source.path.split("/")));
    const entry = checkedInEvidence.evidenceCatalog.find((item) => item.id === id);
    assert(entry);
    assert.equal(entry.path, source.path);
    assert.equal(entry.bytes, bytes.length);
    assert.equal(entry.sha256, sha256(bytes));
  }
  const result = spawnSync(process.execPath, [CURRENT_CHECKER_PATH], {
    cwd: CURRENT_REPOSITORY_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(isExactCheckerSuccess(result), true);
});

test("catalog closes every direct local import used by the evidence implementation", () => {
  const catalogPaths = new Set(EVIDENCE_SOURCE_CONTRACT.map((source) => source.path));
  const expectedImports = new Map([
    ["app-route-evidence-tests", []],
    ["app-route-evidence-validator", ["scripts/lib/app-router-inventory.mjs"]],
    ["app-route-inventory-library", []],
  ]);
  for (const [id, expected] of expectedImports) {
    const source = EVIDENCE_SOURCE_CONTRACT.find((item) => item.id === id);
    const actual = localRelativeImports(source.path);
    assert.deepEqual(actual, expected);
    for (const importedPath of actual) assert(catalogPaths.has(importedPath), `${source.path} imports uncatalogued ${importedPath}`);
  }
  const checkerSource = readFileSync(CURRENT_CHECKER_PATH, "utf8");
  assert.deepEqual(localRelativeImports("scripts/check-app-route-evidence.mjs"), []);
  assert.equal(checkerSource.match(/\bimport\s*\(/g)?.length, 1);
  assert(checkerSource.includes("await import(${JSON.stringify(pathToFileURL(VALIDATOR_PATH).href)})"));
  assert(checkerSource.includes(EXPECTED_VALIDATOR_SHA256));
  assert(checkerSource.includes("5051994396F6B0EAC3033F13CF2DC41BD2DCD8FF3102CF11DC49F8B53F780D84"));
  assert(!checkerSource.includes("require("));
  assert(!checkerSource.includes("createRequire"));
  assert(!checkerSource.includes("getBuiltinModule"));
});

test("isolated checker seam refuses every validator override before consuming its result", () => {
  for (const scenario of [
    "thrown",
    "malformed",
    "rawFailure",
    "tooManyFailures",
    "forgedOneRoute",
    "forgedAllInProgress",
    "tooManyRoutes",
    "customFailureIterator",
    "customRouteIterator",
  ]) {
    const result = runCheckerSeam(scenario);
    assert.equal(result.calls, 0);
    assert.equal(result.code, 1);
    const diagnostic = [...result.errors, ...result.outputs].join("\n");
    assert(diagnostic.includes("[CHECKER_FAILURE]"));
    assert(!diagnostic.includes(PRIVATE_SENTINEL));
    assert(!diagnostic.includes("Error:"));
    assert(!diagnostic.includes(" at "));
    assert.deepEqual(result.outputs, []);
  }
});

test("production result inspection rejects hostile arrays, proxies, getters, identities, methods, and status counts", () => {
  const exact = runSummarySeam("exact");
  assert.equal(exact.threw, false);
  assert.equal(exact.getterCalls, 0);
  assert.equal(exact.trapCalls, 0);
  assert.deepEqual(exact.summary, { routeCount: 38, statusText: "excluded_internal=1, in_progress=37" });

  for (const scenario of [
    "forgedIdentity",
    "methodSubstitution",
    "allInProgress",
    "customFailureIterator",
    "customRouteIterator",
    "numericGetter",
    "recordProxy",
    "arrayProxy",
    "extraArrayKey",
    "arraySubclass",
    "sparseArray",
    "extraResultKey",
    "extraEvidenceKey",
    "extraCoverageKey",
    "extraMatrixKey",
    "extraRouteKey",
    "extraMatrixRouteKey",
    "extraSymbolKey",
    "accessorResultKey",
    "accessorEvidenceKey",
    "accessorCoverageKey",
    "accessorMatrixKey",
    "accessorRouteKey",
    "accessorMatrixRouteKey",
    "recordSubclass",
  ]) {
    const result = runSummarySeam(scenario);
    assert.equal(result.threw, false);
    assert.equal(result.getterCalls, 0);
    assert.equal(result.trapCalls, 0);
    assert.equal(result.summary, null);
  }
});

test("rejects authorization and data-contract substitution", () => {
  withFixture((current) => {
    current.evidence.routes[1].authorizationClass = "public";
    current.evidence.routes[1].upstreamData = ["unchecked request"];
    const failures = validate(current).failures;
    assert(failures.some((failure) => failure.includes("[ROUTE_AUTHORIZATION]")));
    assert(failures.some((failure) => failure.includes("[ROUTE_CONTRACTS]")));
  });
});

test("rejects assessment-profile substitution", () => {
  withFixture((current) => {
    current.evidence.routes[0].assessments.manualTests = "inventory-automated-source";
    current.evidence.assessmentProfiles[4].status = "verified_source";
    const failures = validate(current).failures;
    assert(failures.some((failure) => failure.includes("[PROFILE_CONTRACT]")));
    assert(failures.some((failure) => failure.includes("[ASSESSMENT_BINDING]")));
  });
});

test("rejects a false passing claim and hidden remaining work", () => {
  withFixture((current) => {
    current.evidence.routes[0].terminalStatus = "passing";
    current.evidence.routes[0].remaining = [];
    current.evidence.routes[0].stateProfile = "internal-not-applicable";
    const failures = validate(current).failures;
    assert(failures.some((failure) => failure.includes("[STATE_BINDING]")));
    assert(failures.some((failure) => failure.includes("[TERMINAL_STATUS]")));
  });
});

test("rejects a false Phase 4 coverage claim", () => {
  withFixture((current) => {
    current.evidence.coverage.phase4Exit = "passing";
    current.evidence.coverage.storefrontSurfaces = "complete";
    assert(validate(current).failures.includes("route evidence coverage boundary rejected [COVERAGE_BOUNDARY]"));
  });
});

test("fails closed without throwing when a route row is missing", () => {
  withFixture((current) => {
    current.evidence.routes.pop();
    assert.deepEqual(validate(current).failures, ["route evidence rows rejected [ROUTE_SHAPE]"]);
  });
});

test("fails closed on malformed route and profile shapes", () => {
  withFixture((current) => {
    current.evidence.routes[0] = null;
    current.evidence.assessmentProfiles[0] = [];
    current.evidence.stateProfiles[0].states = null;
    const result = validate(current);
    assert(result.failures.some((failure) => failure.includes("[ROUTE_KEYS]")));
    assert(result.failures.some((failure) => failure.includes("[PROFILE_KEYS]")));
    assert(result.failures.some((failure) => failure.includes("[STATE_PROFILE_CONTRACT]")));
    assertCategorical(result);
  });
});

test("rejects malformed JSON without leaking parser text or its file name", () => {
  withFixture((current) => {
    const privatePath = path.join(path.dirname(current.evidencePath), `${PRIVATE_SENTINEL}.json`);
    writeFileSync(privatePath, `{"${PRIVATE_SENTINEL}":`);
    current.evidencePath = privatePath;
    const result = validate(current, { rewriteEvidence: false });
    assert.deepEqual(result.failures, ["route evidence input rejected [EVIDENCE_INPUT]"]);
    assertCategorical(result);
  });
});

test("rejects duplicate-key and noncanonical JSON", () => {
  withFixture((current) => {
    writeFileSync(current.evidencePath, `{"schemaVersion":1,"schemaVersion":1,"marker":"${PRIVATE_SENTINEL}"}`);
    const result = validate(current, { rewriteEvidence: false });
    assert.deepEqual(result.failures, ["route evidence input rejected [EVIDENCE_INPUT]"]);
    assertCategorical(result);
  });
});

test("rejects malformed UTF-8 before parsing", () => {
  withFixture((current) => {
    writeFileSync(current.evidencePath, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d]));
    const result = validate(current, { rewriteEvidence: false });
    assert.deepEqual(result.failures, ["route evidence input rejected [EVIDENCE_INPUT]"]);
  });
});

test("rejects a UTF-8 BOM before canonical JSON comparison", () => {
  withFixture((current) => {
    const exact = readFileSync(current.evidencePath);
    writeFileSync(current.evidencePath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), exact]));
    assert.deepEqual(validate(current, { rewriteEvidence: false }).failures, ["route evidence input rejected [EVIDENCE_INPUT]"]);
  });
});

test("rejects a UTF-8 BOM in the canonical route-matrix input", () => {
  withFixture((current) => {
    const exact = readFileSync(current.matrixPath);
    writeFileSync(current.matrixPath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), exact]));
    assert.deepEqual(validate(current).failures, ["route matrix input rejected [MATRIX_INPUT]"]);
  });
});

test("rejects a UTF-8 BOM in the canonical public URL input", () => {
  withFixture((current) => {
    const publicUrlSource = EVIDENCE_SOURCE_CONTRACT.find((source) => source.id === "public-url-config");
    const publicUrlPath = path.join(current.root, ...publicUrlSource.path.split("/"));
    const exact = readFileSync(publicUrlPath);
    writeFileSync(publicUrlPath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), exact]));
    const publicUrlEntry = current.evidence.evidenceCatalog.find((entry) => entry.id === "public-url-config");
    const changed = readFileSync(publicUrlPath);
    publicUrlEntry.bytes = changed.length;
    publicUrlEntry.sha256 = sha256(changed);
    assert.deepEqual(validate(current).failures, ["public URL config rejected [PUBLIC_URL_INPUT]"]);
  });
});

test("rejects an oversized evidence document before decoding", () => {
  withFixture((current) => {
    writeFileSync(current.evidencePath, Buffer.alloc(APP_ROUTE_EVIDENCE_LIMITS.evidenceBytes + 1, 0x20));
    const result = validate(current, { rewriteEvidence: false });
    assert.deepEqual(result.failures, ["route evidence input rejected [EVIDENCE_INPUT]"]);
  });
});

test("rejects a symbolic evidence-directory component", (t) => {
  withFixture((current) => {
    const configDirectory = path.dirname(current.evidencePath);
    const realDirectory = `${configDirectory}-real`;
    renameSync(configDirectory, realDirectory);
    try {
      symlinkSync(realDirectory, configDirectory, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip("symbolic-link creation is unavailable on this host");
        return;
      }
      throw error;
    }
    const result = validate(current, { rewriteEvidence: false });
    assert.deepEqual(result.failures, ["route evidence input rejected [EVIDENCE_INPUT]"]);
  });
});

test("rejects symbolic source-directory components", (t) => {
  withFixture((current) => {
    const scriptsDirectory = path.join(current.root, "scripts");
    const realDirectory = path.join(current.root, "source-files");
    renameSync(scriptsDirectory, realDirectory);
    try {
      symlinkSync(realDirectory, scriptsDirectory, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip("symbolic-link creation is unavailable on this host");
        return;
      }
      throw error;
    }
    const result = validate(current);
    assert(result.failures.some((failure) => failure.includes("[SOURCE_INPUT]")));
    assertCategorical(result);
  });
});

test("bounds aggregate hostile diagnostics and never includes private values", () => {
  withFixture((current) => {
    for (const item of current.evidence.evidenceCatalog) {
      item.id = PRIVATE_SENTINEL;
      item.path = `../${PRIVATE_SENTINEL}`;
      item.scope = PRIVATE_SENTINEL.repeat(32);
      item.bytes = -1;
      item.sha256 = PRIVATE_SENTINEL;
    }
    for (const profile of current.evidence.assessmentProfiles) {
      profile.id = PRIVATE_SENTINEL;
      profile.status = PRIVATE_SENTINEL;
      profile.evidence = [PRIVATE_SENTINEL, PRIVATE_SENTINEL];
    }
    const result = validate(current);
    assertCategorical(result);
  });
});

test("binds the focused checker into package and full-repository checks exactly once", () => {
  const packageJson = JSON.parse(readFileSync(path.join(CURRENT_REPOSITORY_ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["check:app-route-evidence"], "node scripts/check-app-route-evidence.mjs");
  assert.equal(packageJson.scripts["test:app-route-evidence"], "node --test scripts/lib/app-route-evidence.test.mjs");
  const checkAll = readFileSync(path.join(CURRENT_REPOSITORY_ROOT, "scripts", "check-all.mjs"), "utf8");
  assert.equal((checkAll.match(/\["check:app-route-evidence", \["node", "scripts\/check-app-route-evidence\.mjs"\]\]/g) || []).length, 1);
  assert.equal((checkAll.match(/\["test:app-route-evidence", \["node", "--test", "scripts\/lib\/app-route-evidence\.test\.mjs"\]\]/g) || []).length, 1);
});
