import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDecoder, types as utilTypes } from "node:util";

const EXPECTED_SOURCE_BASE = "3a59633a9ba9319f35be8ec7de758e9238032a96";
const EXPECTED_SUMMARY = Object.freeze({
  metadataRoutes: 29,
  indexedMetadataRoutes: 18,
  nonindexedMetadataRoutes: 11,
  publicFiles: 249,
  publicBytes: 38_509_676,
  sourceFiles: 44,
});
const EXPECTED_PAYLOAD_SHA256 = "84332D025D5DC5240CE6A217AC2E435081F442A28AD016972E314A6DD77212EF";
const EXPECTED_STABLE_SOURCE_SHA256 = "FB30687163BE227428747B704346259DA1B78157002C3A7B8CA4FE60C4EF499C";
const CHECKER_PATH = fileURLToPath(import.meta.url);
const CHECKER_DIRECTORY = path.dirname(CHECKER_PATH);
const VALIDATOR_PATH = path.join(CHECKER_DIRECTORY, "lib", "app-static-surface-inventory.mjs");
const LOCAL_SOURCE_CONTRACT = Object.freeze([
  Object.freeze({
    path: VALIDATOR_PATH,
    bytes: 24_956,
    sha256: "AF6A2D5632582D56B92C8E7CD0D7ED0A004712BFCF51091DE2A1AFB50BD63C0A",
  }),
  Object.freeze({
    path: path.join(CHECKER_DIRECTORY, "lib", "app-router-inventory.mjs"),
    bytes: 59_423,
    sha256: "5051994396F6B0EAC3033F13CF2DC41BD2DCD8FF3102CF11DC49F8B53F780D84",
  }),
]);
const VALIDATOR_RESULT_LIMIT = 1024 * 1024;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MUTABLE_WIRING_PATHS = new Set([
  "package.json",
  "scripts/check-all.mjs",
  "scripts/check-app-static-surface-inventory.mjs",
  "scripts/lib/app-static-surface-inventory.mjs",
  "scripts/lib/app-static-surface-inventory.test.mjs",
]);
const SOURCE_ROW_KEYS = Object.freeze(["path", "bytes", "sha256"]);
const SOURCE_PATH_PATTERN = /^[A-Za-z0-9._/()[\]-]+$/;
const SOURCE_SHA256_PATTERN = /^[A-F0-9]{64}$/;
const ALLOWED_FAILURES = new Set([
  "[INPUT]",
  "[CONFIG]",
  "[ROUTE_MATRIX]",
  "[SOURCE]",
  "[PUBLIC_TREE]",
  "[COLLISION]",
  "[FROZEN_PAYLOAD]",
  "[UNEXPECTED]",
]);
const RESULT_KEYS = Object.freeze(["failures", "inventory"]);
const INVENTORY_KEYS = Object.freeze([
  "schemaVersion",
  "sourceBaseCommit",
  "publicSafe",
  "coverage",
  "summary",
  "sourceCatalog",
  "metadataRoutes",
  "publicFiles",
]);
const COVERAGE_KEYS = Object.freeze([
  "appRouterPageMetadata",
  "publicDirectory",
  "storefrontSurfaces",
  "runtimeValidation",
  "phase4Exit",
]);
const SUMMARY_KEYS = Object.freeze([
  "metadataRoutes",
  "indexedMetadataRoutes",
  "nonindexedMetadataRoutes",
  "publicFiles",
  "publicBytes",
  "sourceFiles",
]);

function exactDataRecord(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (utilTypes.isProxy(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expectedKeys.length) return false;
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    if (keys[index] !== key) return false;
    const descriptor = descriptors[key];
    if (!descriptor
      || !Object.hasOwn(descriptor, "value")
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || descriptor.enumerable !== true) return false;
  }
  return true;
}

function ownDataValue(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function plainJsonValue(value, state, depth = 0) {
  if (depth > 12 || state.nodes > 20_000) return false;
  state.nodes += 1;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (Array.isArray(value)) {
    if (utilTypes.isProxy(value)) return false;
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 2048) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || keys[keys.length - 1] !== "length") return false;
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      if (keys[index] !== key) return false;
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return false;
      if (!plainJsonValue(descriptor.value, state, depth + 1)) return false;
    }
    return true;
  }
  if (typeof value !== "object" || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string") || keys.length > 16) return false;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return false;
    if (!plainJsonValue(descriptor.value, state, depth + 1)) return false;
  }
  return true;
}

function payloadSha256(inventory) {
  return createHash("sha256")
    .update(JSON.stringify({
      metadataRoutes: inventory.metadataRoutes,
      publicFiles: inventory.publicFiles,
    }))
    .digest("hex")
    .toUpperCase();
}

function validSourceCatalog(sourceCatalog) {
  if (!Array.isArray(sourceCatalog)
    || sourceCatalog.length !== EXPECTED_SUMMARY.sourceFiles
    || Object.getPrototypeOf(sourceCatalog) !== Array.prototype) return false;
  const paths = new Set();
  let previousPath = "";
  for (const row of sourceCatalog) {
    if (!exactDataRecord(row, SOURCE_ROW_KEYS)
      || typeof row.path !== "string"
      || row.path.length === 0
      || row.path.length > 512
      || !SOURCE_PATH_PATTERN.test(row.path)
      || row.path.startsWith("/")
      || row.path.includes("//")
      || row.path.split("/").some((segment) => segment === "." || segment === "..")
      || !Number.isSafeInteger(row.bytes)
      || row.bytes <= 0
      || row.bytes > 2 * 1024 * 1024
      || typeof row.sha256 !== "string"
      || !SOURCE_SHA256_PATTERN.test(row.sha256)
      || paths.has(row.path)
      || (previousPath && previousPath >= row.path)) {
      return false;
    }
    paths.add(row.path);
    previousPath = row.path;
  }
  if ([...MUTABLE_WIRING_PATHS].some((sourcePath) => !paths.has(sourcePath))) return false;
  const stableRows = sourceCatalog.filter((row) => !MUTABLE_WIRING_PATHS.has(row.path));
  if (stableRows.length !== 39) return false;
  const digest = createHash("sha256").update(JSON.stringify(stableRows)).digest("hex").toUpperCase();
  return digest === EXPECTED_STABLE_SOURCE_SHA256;
}

function validSummary(summary) {
  if (!exactDataRecord(summary, SUMMARY_KEYS)) return false;
  return SUMMARY_KEYS.every((key) => summary[key] === EXPECTED_SUMMARY[key]);
}

function validCoverage(coverage) {
  return exactDataRecord(coverage, COVERAGE_KEYS)
    && coverage.appRouterPageMetadata === "matrix_complete_source_only"
    && coverage.publicDirectory === "inventory_complete_source_only"
    && coverage.storefrontSurfaces === "pending_separate_decision_record"
    && coverage.runtimeValidation === "not_claimed"
    && coverage.phase4Exit === "not_claimed";
}

function validInventory(inventory) {
  if (!exactDataRecord(inventory, INVENTORY_KEYS)
    || inventory.schemaVersion !== 1
    || inventory.sourceBaseCommit !== EXPECTED_SOURCE_BASE
    || inventory.publicSafe !== true
    || !validCoverage(inventory.coverage)
    || !validSummary(inventory.summary)
    || !validSourceCatalog(inventory.sourceCatalog)
    || !Array.isArray(inventory.metadataRoutes)
    || !Array.isArray(inventory.publicFiles)
    || inventory.metadataRoutes.length !== EXPECTED_SUMMARY.metadataRoutes
    || inventory.publicFiles.length !== EXPECTED_SUMMARY.publicFiles) {
    return false;
  }
  if (!plainJsonValue(inventory, { nodes: 0 })) return false;
  return payloadSha256(inventory) === EXPECTED_PAYLOAD_SHA256;
}

export function inspectStaticSurfaceValidationResult(result) {
  try {
    if (!exactDataRecord(result, RESULT_KEYS)) {
      return { ok: false, category: "CHECKER_RESULT" };
    }
    const failures = ownDataValue(result, "failures");
    const inventory = ownDataValue(result, "inventory");
    if (!plainJsonValue(failures, { nodes: 0 })
      || (inventory !== null && !plainJsonValue(inventory, { nodes: 0 }))
      || !Array.isArray(failures)
      || failures.length > 8) {
      return { ok: false, category: "CHECKER_RESULT" };
    }
    if (failures.length > 0) {
      if (inventory !== null
        || failures.some((failure) => typeof failure !== "string" || !ALLOWED_FAILURES.has(failure))) {
        return { ok: false, category: "CHECKER_RESULT" };
      }
      return { ok: false, category: "VALIDATION", failures: [...failures] };
    }
    if (!validInventory(inventory)) return { ok: false, category: "CHECKER_RESULT" };
    return { ok: true, inventory };
  } catch {
    return { ok: false, category: "CHECKER_RESULT" };
  }
}

function verifyLocalSource({ path: sourcePath, bytes: expectedBytes, sha256: expectedSha256 }) {
  const stats = lstatSync(sourcePath);
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync(sourcePath) !== path.resolve(sourcePath)) return false;
  const bytes = readFileSync(sourcePath);
  return bytes.length === expectedBytes
    && createHash("sha256").update(bytes).digest("hex").toUpperCase() === expectedSha256;
}

function runCanonicalValidator(rootDirectory) {
  for (const source of LOCAL_SOURCE_CONTRACT) {
    if (!verifyLocalSource(source)) throw new Error("local source drift");
  }
  if (typeof rootDirectory !== "string"
    || rootDirectory.length < 1
    || rootDirectory.length > 1024
    || !path.isAbsolute(rootDirectory)) {
    throw new Error("repository root rejected");
  }
  const source = `
try {
  const module = await import(${JSON.stringify(pathToFileURL(VALIDATOR_PATH).href)});
  if (typeof module.validateAppStaticSurfaceInventory !== "function") process.exit(1);
  const result = module.validateAppStaticSurfaceInventory({
    rootDirectory: ${JSON.stringify(path.resolve(rootDirectory))},
  });
  process.stdout.write(JSON.stringify({ marker: "app-static-surface-validator-result", result }));
} catch {
  process.exit(1);
}
`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: rootDirectory,
    encoding: null,
    env: {},
    windowsHide: true,
    timeout: 30_000,
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
    || (stdout.length >= 3 && stdout[0] === 0xef && stdout[1] === 0xbb && stdout[2] === 0xbf)) {
    throw new Error("validator child rejected");
  }
  const decoded = UTF8_DECODER.decode(stdout);
  const envelope = JSON.parse(decoded);
  if (!exactDataRecord(envelope, ["marker", "result"])
    || envelope.marker !== "app-static-surface-validator-result"
    || decoded !== JSON.stringify(envelope)) {
    throw new Error("validator envelope rejected");
  }
  return envelope.result;
}

export async function runAppStaticSurfaceInventoryCheck({
  rootDirectory = process.cwd(),
  validate,
} = {}) {
  try {
    if (validate !== undefined) throw new Error("validator override rejected");
    const inspected = inspectStaticSurfaceValidationResult(runCanonicalValidator(path.resolve(rootDirectory)));
    if (!inspected.ok) {
      const failures = inspected.category === "VALIDATION"
        ? inspected.failures.join(" ")
        : "[CHECKER_RESULT]";
      return {
        exitCode: 1,
        stdout: "",
        stderr: "App static surface inventory failed " + failures + "\n",
      };
    }
    const summary = inspected.inventory.summary;
    return {
      exitCode: 0,
      stdout: "App static surface inventory OK ("
        + summary.metadataRoutes + " metadata routes, "
        + summary.publicFiles + " public files, "
        + summary.publicBytes + " bytes).\n",
      stderr: "",
    };
  } catch {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "App static surface inventory failed [UNEXPECTED]\n",
    };
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(CHECKER_PATH);

if (isMain) {
  const outcome = await runAppStaticSurfaceInventoryCheck();
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  process.exitCode = outcome.exitCode;
}
