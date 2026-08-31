import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const nodeExecutable = process.execPath;
const checkerPath = path.join(root, "scripts", "check-app-static-surface-inventory.mjs");
const checkerUrl = pathToFileURL(checkerPath).href;
const libraryPath = path.join(root, "scripts", "lib", "app-static-surface-inventory.mjs");
const libraryUrl = pathToFileURL(libraryPath).href;
const appRouterLibraryPath = path.join(root, "scripts", "lib", "app-router-inventory.mjs");
const productionCheckerPath = path.join(root, "scripts", "check-production.mjs");
const configPath = path.join(root, "apps", "web", "config", "app-static-surface-inventory.v1.json");
const expectedSuccess = "App static surface inventory OK (28 metadata routes, 249 public files, 38509460 bytes).\n";
const expectedCheckerBytes = 13_000;
const expectedCheckerSha256 = "79835F059A3B2F93F0F1D55CF45A3FBB6127ECD37FAAA64DF957AE5035EF2519";
const expectedLibraryBytes = 24_913;
const expectedLibrarySha256 = "B0370216A311FC19A6206580806CD8312572F2589989C7038359D1F9D7547733";
const expectedAppRouterLibraryBytes = 59_423;
const expectedAppRouterLibrarySha256 = "5051994396F6B0EAC3033F13CF2DC41BD2DCD8FF3102CF11DC49F8B53F780D84";
const expectedProductionCheckerBytes = 155_114;
const expectedProductionCheckerSha256 = "220FD71AEEBE508B06B7DCD65C6A10B5337BF2893605A9D13CE4E0C21A72BA24";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function exactOrdinarySource(sourcePath, expectedBytes, expectedDigest) {
  try {
    const stats = lstatSync(sourcePath);
    if (!stats.isFile()
      || stats.isSymbolicLink()
      || realpathSync(sourcePath) !== path.resolve(sourcePath)) return false;
    const bytes = readFileSync(sourcePath);
    return bytes.length === expectedBytes && sha256(bytes) === expectedDigest;
  } catch {
    return false;
  }
}

if (!exactOrdinarySource(checkerPath, expectedCheckerBytes, expectedCheckerSha256)
  || !exactOrdinarySource(libraryPath, expectedLibraryBytes, expectedLibrarySha256)
  || !exactOrdinarySource(
    appRouterLibraryPath,
    expectedAppRouterLibraryBytes,
    expectedAppRouterLibrarySha256,
  )
  || !exactOrdinarySource(
    productionCheckerPath,
    expectedProductionCheckerBytes,
    expectedProductionCheckerSha256,
  )) {
  throw new Error("Claim K executable source seal rejected");
}

const {
  PRODUCTION_CHECK_LIMITS,
  canonicalizeProductionFlightResourceEnvelopeStream,
  checkProduction,
  checkProductionWithTestFixtures,
  productionDocumentProfileMatches,
  productionDocumentPolicyMatches,
} = await import(pathToFileURL(productionCheckerPath).href);

const {
  assertNoUncataloguedAppStaticSurfaces,
  buildAppStaticSurfaceInventory,
  canonicalJson,
  enumeratePublicFiles,
  inspectCanonicalInventoryDocument,
  publicUrlMatchesAppRoute,
  readBoundedOrdinaryFile,
  STATIC_SURFACE_LIMITS,
  staticSurfaceInventorySourceBaseCommit,
  validateAppStaticSurfaceInventory,
} = await import(libraryUrl);

function fixtureDirectory() {
  return mkdtempSync(path.join(tmpdir(), "mochirii-static-inventory-"));
}

function cleanup(directory) {
  const temporaryRoot = path.resolve(tmpdir());
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(temporaryRoot + path.sep));
  assert.match(path.basename(resolved), /^mochirii-static-inventory-/);
  rmSync(directory, { recursive: true, force: true });
}

function isExactCheckerSuccess(child) {
  return child.status === 0
    && child.signal === null
    && child.stderr === ""
    && child.stdout === expectedSuccess;
}

function runCheckerSeamScenario(scenario) {
  const source = `
import { inspectStaticSurfaceValidationResult, runAppStaticSurfaceInventoryCheck } from ${JSON.stringify(checkerUrl)};
import { buildAppStaticSurfaceInventory } from ${JSON.stringify(libraryUrl)};
const root = ${JSON.stringify(root)};
const scenario = ${JSON.stringify(scenario)};
const sentinel = "MOCHIRII_PRIVATE_STATIC_CHILD_SENTINEL at C:\\\\private\\\\surface.json";
let reads = 0;
let traps = 0;
let validateCalls = 0;
if (scenario === "validateOverride") {
  const outcome = await runAppStaticSurfaceInventoryCheck({
    rootDirectory: root,
    validate() {
      validateCalls += 1;
      return { failures: [sentinel], inventory: null };
    },
  });
  process.stdout.write(JSON.stringify({
    marker: "checker-seam-result",
    scenario,
    validateCalls,
    outcome,
    sentinelPresent: JSON.stringify(outcome).includes(sentinel),
  }));
} else {
  const inventory = buildAppStaticSurfaceInventory({ rootDirectory: root });
  let result = { failures: [], inventory };
  if (scenario === "forgedSummary") {
    inventory.summary.publicFiles = 248;
  } else if (scenario === "forgedCatalog") {
    inventory.sourceCatalog = Array.from({ length: inventory.sourceCatalog.length }, (_, index) => ({
      path: "scripts/forged-" + String(index).padStart(2, "0") + ".mjs",
      bytes: 1,
      sha256: "0".repeat(64),
    }));
  } else if (scenario === "rawFailure") {
    result = { failures: [sentinel], inventory: null };
  } else if (scenario === "accessor") {
    result = {};
    Object.defineProperty(result, "failures", {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });
    Object.defineProperty(result, "inventory", { enumerable: true, value: null });
  } else if (scenario === "proxy") {
    result = new Proxy({ failures: [], inventory: null }, {
      getPrototypeOf(target) {
        traps += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        traps += 1;
        return Reflect.ownKeys(target);
      },
    });
  } else if (scenario === "nestedFailuresProxy") {
    result.failures = new Proxy([], {
      get(target, key, receiver) {
        traps += 1;
        return Reflect.get(target, key, receiver);
      },
      getPrototypeOf(target) {
        traps += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        traps += 1;
        return Reflect.ownKeys(target);
      },
    });
    result.inventory = null;
  } else if (scenario === "nestedCatalogProxy") {
    inventory.sourceCatalog = new Proxy(inventory.sourceCatalog, {
      get(target, key, receiver) {
        traps += 1;
        return Reflect.get(target, key, receiver);
      },
      getPrototypeOf(target) {
        traps += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        traps += 1;
        return Reflect.ownKeys(target);
      },
    });
  } else if (scenario === "customIterator") {
    Object.defineProperty(inventory.sourceCatalog, Symbol.iterator, {
      value() {
        traps += 1;
        return [][Symbol.iterator]();
      },
    });
  } else if (scenario === "extraKey") {
    result.extra = "unexpected";
  } else if (scenario === "arraySubclass") {
    class HostileArray extends Array {}
    inventory.metadataRoutes = new HostileArray(...inventory.metadataRoutes);
  } else if (scenario === "sparseArray") {
    delete inventory.publicFiles[0];
  }
  const inspected = inspectStaticSurfaceValidationResult(result);
  process.stdout.write(JSON.stringify({
    marker: "checker-seam-result",
    scenario,
    ok: inspected.ok === true,
    category: inspected.category ?? null,
    reads,
    traps,
    sentinelPresent: JSON.stringify(inspected).includes(sentinel),
  }));
}
`;
  const child = spawnSync(nodeExecutable, ["--input-type=module", "--eval", source], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {},
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  const result = JSON.parse(child.stdout);
  assert.equal(result.marker, "checker-seam-result");
  assert.equal(child.stdout, JSON.stringify(result));
  return result;
}

test("source base remains bound to the accepted Claim J commit", () => {
  assert.equal(
    staticSurfaceInventorySourceBaseCommit(),
    "3a59633a9ba9319f35be8ec7de758e9238032a96",
  );
});

test("current source builds the complete source-only inventory", () => {
  const inventory = buildAppStaticSurfaceInventory({ rootDirectory: root });
  assert.deepEqual(inventory.summary, {
    metadataRoutes: 28,
    indexedMetadataRoutes: 17,
    nonindexedMetadataRoutes: 11,
    publicFiles: 249,
    publicBytes: 38_509_460,
    sourceFiles: 43,
  });
  assert.deepEqual(inventory.coverage, {
    appRouterPageMetadata: "matrix_complete_source_only",
    publicDirectory: "inventory_complete_source_only",
    storefrontSurfaces: "pending_separate_decision_record",
    runtimeValidation: "not_claimed",
    phase4Exit: "not_claimed",
  });
});

test("metadata rows cover the exact accepted page matrix without live claims", () => {
  const inventory = buildAppStaticSurfaceInventory({ rootDirectory: root });
  assert.equal(inventory.metadataRoutes.length, 28);
  assert.equal(inventory.metadataRoutes.filter((row) => row.terminalStatus === "in_progress").length, 27);
  assert.deepEqual(
    inventory.metadataRoutes.filter((row) => row.terminalStatus === "excluded_internal").map((row) => row.path),
    ["/raffle-render-fixtures-internal/[scenario]"],
  );
  assert.deepEqual(
    inventory.metadataRoutes.filter((row) => row.sitemapPolicy === "included").map((row) => row.path),
    [
      "/",
      "/announcements",
      "/events",
      "/gallery",
      "/games/mochi-pets",
      "/join",
      "/leaders",
      "/meta-data-deletion",
      "/privacy",
      "/raffle",
      "/ranks",
      "/recruitment",
      "/spotify",
      "/spotlight",
      "/tome",
      "/twills",
    ],
  );
  const spinner = inventory.metadataRoutes.find((row) => row.path === "/spinner");
  assert.deepEqual(
    {
      metadataSource: spinner.metadataSource,
      canonicalPolicy: spinner.canonicalPolicy,
      robotsPolicy: spinner.robotsPolicy,
      previewPolicy: spinner.previewPolicy,
    },
    {
      metadataSource: "apps/web/app/spinner/layout.tsx",
      canonicalPolicy: "none",
      robotsPolicy: "noindex_nofollow",
      previewPolicy: "suppressed",
    },
  );
});

test("public inventory covers every ordinary file with exact aggregate categories", () => {
  const rows = enumeratePublicFiles({ rootDirectory: root });
  const categoryCounts = Object.fromEntries(
    [...new Set(rows.map((row) => row.category))]
      .sort()
      .map((category) => [category, rows.filter((row) => row.category === category).length]),
  );
  assert.equal(rows.length, 249);
  assert.equal(rows.reduce((sum, row) => sum + row.bytes, 0), 38_509_460);
  assert.deepEqual(categoryCounts, {
    asset: 231,
    discovery: 3,
    icon: 1,
    public_data: 14,
  });
  assert.equal(new Set(rows.map((row) => row.url)).size, rows.length);
  assert.equal(rows[0].url, "/.well-known/security.txt");
  assert.equal(rows.at(-1).url, "/sitemap.xml");
});

test("static collision matching covers parameter and private catch-all routes", () => {
  assert.equal(publicUrlMatchesAppRoute("/raffle/rules/legacy.txt", "/raffle/rules/[version]"), true);
  assert.equal(publicUrlMatchesAppRoute("/spinner/private.css", "/spinner/[...not-found]"), true);
  assert.equal(publicUrlMatchesAppRoute("/spinner", "/spinner/[...not-found]"), false);
  assert.equal(publicUrlMatchesAppRoute("/assets/site.css", "/raffle/rules/[version]"), false);
  assert.equal(publicUrlMatchesAppRoute("/assets/site.css", "/[...not-found]"), false);
});

test("source catalog seals the executable inventory and accepted evidence inputs", () => {
  const inventory = buildAppStaticSurfaceInventory({ rootDirectory: root });
  const byPath = new Map(inventory.sourceCatalog.map((row) => [row.path, row]));
  for (const sourcePath of [
    "apps/web/config/app-route-evidence.v1.json",
    "apps/web/config/app-route-matrix.v1.json",
    "package.json",
    "scripts/check-all.mjs",
    "scripts/check-app-static-surface-inventory.mjs",
    "scripts/check-observability-metadata-smoke.mjs",
    "scripts/lib/app-router-inventory.mjs",
    "scripts/lib/app-static-surface-inventory.mjs",
    "scripts/lib/app-static-surface-inventory.test.mjs",
  ]) {
    const row = byPath.get(sourcePath);
    assert.ok(row, "missing source catalog row");
    const bytes = readFileSync(path.join(root, ...sourcePath.split("/")));
    assert.equal(row.bytes, bytes.length);
    assert.equal(row.sha256, sha256(bytes));
  }
});

test("canonical inventory document accepts only the exact generated bytes", () => {
  const expected = buildAppStaticSurfaceInventory({ rootDirectory: root });
  const source = Buffer.from(canonicalJson(expected), "utf8");
  assert.deepEqual(inspectCanonicalInventoryDocument(source, expected).failures, []);

  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), source]);
  assert.deepEqual(inspectCanonicalInventoryDocument(bom, expected).failures, ["[CONFIG]"]);
  assert.deepEqual(
    inspectCanonicalInventoryDocument(Buffer.from(source.toString("utf8") + " ", "utf8"), expected).failures,
    ["[CONFIG]"],
  );
  assert.deepEqual(
    inspectCanonicalInventoryDocument(Buffer.from(source.toString("utf8").replace(/\n/g, "\r\n"), "utf8"), expected).failures,
    ["[CONFIG]"],
  );
  const duplicate = Buffer.from(
    source.toString("utf8").replace('{\n  "schemaVersion": 1,', '{\n  "schemaVersion": 1,\n  "schemaVersion": 1,'),
    "utf8",
  );
  assert.deepEqual(inspectCanonicalInventoryDocument(duplicate, expected).failures, ["[CONFIG]"]);

  const changed = structuredClone(expected);
  changed.publicFiles[0].sha256 = "0".repeat(64);
  assert.deepEqual(
    inspectCanonicalInventoryDocument(Buffer.from(canonicalJson(changed), "utf8"), expected).failures,
    ["[FROZEN_PAYLOAD]"],
  );
});

test("checked-in canonical inventory validates through the actual library", () => {
  assert.ok(readFileSync(configPath).length > 0);
  const result = validateAppStaticSurfaceInventory({ rootDirectory: root });
  assert.deepEqual(result.failures, []);
  assert.equal(result.inventory.summary.publicFiles, 249);
});

test("missing config remains categorical and path-free", () => {
  const result = validateAppStaticSurfaceInventory({
    rootDirectory: root,
    configPath: "apps/web/config/missing-private-sentinel.json",
  });
  assert.deepEqual(result, { failures: ["[CONFIG]"], inventory: null });
  assert.equal(JSON.stringify(result).includes("missing-private-sentinel"), false);
  assert.equal(JSON.stringify(result).includes(root), false);
});

test("bounded ordinary file reader rejects traversal and directories", () => {
  assert.throws(
    () => readBoundedOrdinaryFile({
      rootDirectory: root,
      relativePath: "../package.json",
      maxBytes: 1024,
      failureCode: "INPUT",
    }),
    (error) => error?.code === "INPUT",
  );
  assert.throws(
    () => readBoundedOrdinaryFile({
      rootDirectory: root,
      relativePath: "apps/web/public/assets",
      maxBytes: 1024,
      failureCode: "INPUT",
    }),
    (error) => error?.code === "INPUT",
  );
});

test("public enumeration rejects unsupported formats", () => {
  const directory = fixtureDirectory();
  try {
    const publicDirectory = path.join(directory, "public");
    mkdirSync(publicDirectory);
    writeFileSync(path.join(publicDirectory, "bad.exe"), Buffer.from("MZ", "ascii"));
    assert.throws(
      () => enumeratePublicFiles({ rootDirectory: directory, publicDirectory: "public" }),
      (error) => error?.code === "PUBLIC_TREE",
    );
  } finally {
    cleanup(directory);
  }
});

test("public text inventory canonicalizes CRLF and rejects unsafe source bytes", () => {
  const directory = fixtureDirectory();
  try {
    const publicDirectory = path.join(directory, "public");
    mkdirSync(publicDirectory);
    const canonicalFiles = new Map([
      ["data.json", Buffer.from('{\n  "ok": true\n}\n', "utf8")],
      ["feed.xml", Buffer.from("<root>\n</root>\n", "utf8")],
      ["NOTICE.TXT", Buffer.from("alpha\nbeta\n", "utf8")],
      ["site.css", Buffer.from("a {\n  color: red;\n}\n", "utf8")],
    ]);
    for (const [name, bytes] of canonicalFiles) writeFileSync(path.join(publicDirectory, name), bytes);
    const lfRows = enumeratePublicFiles({ rootDirectory: directory, publicDirectory: "public" });
    for (const [name, bytes] of canonicalFiles) {
      writeFileSync(
        path.join(publicDirectory, name),
        Buffer.from(bytes.toString("utf8").replace(/\n/g, "\r\n"), "utf8"),
      );
    }
    const crlfRows = enumeratePublicFiles({ rootDirectory: directory, publicDirectory: "public" });
    assert.deepEqual(crlfRows, lfRows);
    for (const [name, bytes] of canonicalFiles) {
      const row = lfRows.find((candidate) => candidate.source.endsWith("/" + name));
      assert.ok(row);
      assert.equal(row.bytes, bytes.length);
      assert.equal(row.sha256, sha256(bytes));
    }
  } finally {
    cleanup(directory);
  }

  for (const hostile of [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("bom\n", "utf8")]),
    Buffer.from("nul\0byte\n", "utf8"),
    Buffer.from("lone\rcarriage\n", "utf8"),
    Buffer.from("carriage-at-eof\r", "utf8"),
    Buffer.from("double\r\r\n", "utf8"),
    Buffer.from([0xc3, 0x28]),
  ]) {
    const hostileDirectory = fixtureDirectory();
    try {
      const publicDirectory = path.join(hostileDirectory, "public");
      mkdirSync(publicDirectory);
      writeFileSync(path.join(publicDirectory, "hostile.txt"), hostile);
      assert.throws(
        () => enumeratePublicFiles({ rootDirectory: hostileDirectory, publicDirectory: "public" }),
        (error) => error?.code === "PUBLIC_TREE",
      );
    } finally {
      cleanup(hostileDirectory);
    }
  }
});

test("public binary inventory preserves exact opaque bytes", () => {
  const directory = fixtureDirectory();
  try {
    const publicDirectory = path.join(directory, "public");
    mkdirSync(publicDirectory);
    const opaque = Buffer.from([0xef, 0xbb, 0xbf, 0x00, 0x0d, 0x0a, 0x0d, 0xc3, 0x28]);
    writeFileSync(path.join(publicDirectory, "opaque.png"), opaque);
    const rows = enumeratePublicFiles({ rootDirectory: directory, publicDirectory: "public" });
    assert.deepEqual(rows, [{
      url: "/opaque.png",
      source: "public/opaque.png",
      bytes: opaque.length,
      sha256: sha256(opaque),
      category: "other",
      format: "png",
    }]);
  } finally {
    cleanup(directory);
  }
});

test("public text limits remain bound to raw checkout bytes", () => {
  const perFileDirectory = fixtureDirectory();
  try {
    const publicDirectory = path.join(perFileDirectory, "public");
    mkdirSync(publicDirectory);
    const repetitions = Math.floor(STATIC_SURFACE_LIMITS.publicFileBytes / 3) + 1;
    const oversizedRawText = Buffer.from("x\r\n".repeat(repetitions), "ascii");
    assert.ok(oversizedRawText.length > STATIC_SURFACE_LIMITS.publicFileBytes);
    assert.ok(oversizedRawText.toString("ascii").replace(/\r\n/g, "\n").length
      < STATIC_SURFACE_LIMITS.publicFileBytes);
    writeFileSync(path.join(publicDirectory, "oversized.txt"), oversizedRawText);
    assert.throws(
      () => enumeratePublicFiles({ rootDirectory: perFileDirectory, publicDirectory: "public" }),
      (error) => error?.code === "PUBLIC_TREE",
    );
  } finally {
    cleanup(perFileDirectory);
  }

  const aggregateDirectory = fixtureDirectory();
  try {
    const publicDirectory = path.join(aggregateDirectory, "public");
    mkdirSync(publicDirectory);
    const rawFileBytes = 7.5 * 1024 * 1024;
    const aggregateText = Buffer.from("x\r\n".repeat(rawFileBytes / 3), "ascii");
    assert.equal(aggregateText.length, rawFileBytes);
    for (let index = 0; index < 9; index += 1) {
      writeFileSync(path.join(publicDirectory, `aggregate-${index}.txt`), aggregateText);
    }
    assert.ok(aggregateText.length * 9 > STATIC_SURFACE_LIMITS.publicAggregateBytes);
    assert.ok(aggregateText.toString("ascii").replace(/\r\n/g, "\n").length * 9
      < STATIC_SURFACE_LIMITS.publicAggregateBytes);
    assert.throws(
      () => enumeratePublicFiles({ rootDirectory: aggregateDirectory, publicDirectory: "public" }),
      (error) => error?.code === "PUBLIC_TREE",
    );
  } finally {
    cleanup(aggregateDirectory);
  }
});

test("reserved App Router metadata files fail closed until explicitly inventoried", () => {
  const reservedNames = [
    "robots.ts",
    "sitemap.xml",
    "manifest.webmanifest",
    "icon1.png",
    "apple-icon.tsx",
    "opengraph-image2.alt.txt",
    "twitter-image.jsx",
  ];
  for (const reservedName of reservedNames) {
    const directory = fixtureDirectory();
    try {
      const appDirectory = path.join(directory, "app");
      mkdirSync(appDirectory);
      writeFileSync(path.join(appDirectory, reservedName), "reserved", "utf8");
      assert.throws(
        () => assertNoUncataloguedAppStaticSurfaces({
          rootDirectory: directory,
          appDirectory: "app",
        }),
        (error) => error?.code === "COLLISION",
      );
    } finally {
      cleanup(directory);
    }
  }
});

test("public enumeration rejects reparse links when the host permits creating one", (context) => {
  const directory = fixtureDirectory();
  try {
    const publicDirectory = path.join(directory, "public");
    const outsideDirectory = path.join(directory, "outside");
    mkdirSync(publicDirectory);
    mkdirSync(outsideDirectory);
    writeFileSync(path.join(outsideDirectory, "private.txt"), "private", "utf8");
    try {
      symlinkSync(path.join(outsideDirectory, "private.txt"), path.join(publicDirectory, "linked.txt"), "file");
    } catch {
      context.skip("host does not permit unprivileged symlink creation");
      return;
    }
    assert.throws(
      () => enumeratePublicFiles({ rootDirectory: directory, publicDirectory: "public" }),
      (error) => error?.code === "PUBLIC_TREE",
    );
  } finally {
    cleanup(directory);
  }
});

test("surviving parent binds exact checker, validator, and parser bytes", () => {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const byPath = new Map(config.sourceCatalog.map((row) => [row.path, row]));
  for (const [sourcePath, expectedBytes, expectedDigest] of [
    ["scripts/check-app-static-surface-inventory.mjs", expectedCheckerBytes, expectedCheckerSha256],
    ["scripts/lib/app-static-surface-inventory.mjs", expectedLibraryBytes, expectedLibrarySha256],
    ["scripts/lib/app-router-inventory.mjs", expectedAppRouterLibraryBytes, expectedAppRouterLibrarySha256],
  ]) {
    const bytes = readFileSync(path.join(root, ...sourcePath.split("/")));
    assert.equal(bytes.length, expectedBytes);
    assert.equal(sha256(bytes), expectedDigest);
    assert.deepEqual(byPath.get(sourcePath), {
      path: sourcePath,
      bytes: expectedBytes,
      sha256: expectedDigest,
    });
  }
});

test("every App Router layout is discovered and sealed as metadata-capable source", () => {
  const layoutSources = assertNoUncataloguedAppStaticSurfaces({ rootDirectory: root });
  assert.deepEqual(layoutSources, [
    "apps/web/app/games/mochi-pets/layout.tsx",
    "apps/web/app/layout.tsx",
    "apps/web/app/spinner/layout.tsx",
  ]);
  const inventory = buildAppStaticSurfaceInventory({ rootDirectory: root });
  const layoutRows = inventory.sourceCatalog.filter((row) => /^apps\/web\/app\/(?:.+\/)?layout\.(?:js|jsx|ts|tsx)$/.test(row.path));
  assert.deepEqual(layoutRows.map((row) => row.path), layoutSources);
  for (const row of layoutRows) {
    const bytes = readFileSync(path.join(root, ...row.path.split("/")));
    assert.equal(row.bytes, bytes.length);
    assert.equal(row.sha256, sha256(bytes));
  }

  const directory = fixtureDirectory();
  try {
    const appDirectory = path.join(directory, "app");
    const nestedDirectory = path.join(appDirectory, "new-surface");
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(path.join(appDirectory, "layout.jsx"), "export default function Layout() {}\n", "utf8");
    writeFileSync(path.join(nestedDirectory, "layout.tsx"), "export const metadata = {};\n", "utf8");
    writeFileSync(path.join(nestedDirectory, "page.tsx"), "export default function Page() {}\n", "utf8");
    assert.deepEqual(
      assertNoUncataloguedAppStaticSurfaces({
        rootDirectory: directory,
        appDirectory: "app",
      }),
      ["app/layout.jsx", "app/new-surface/layout.tsx"],
    );
  } finally {
    cleanup(directory);
  }
});

test("checker accepts only the exact generated success payload", () => {
  assert.deepEqual(
    runCheckerSeamScenario("valid"),
    {
      marker: "checker-seam-result",
      scenario: "valid",
      ok: true,
      category: null,
      reads: 0,
      traps: 0,
      sentinelPresent: false,
    },
  );
  for (const scenario of ["forgedSummary", "forgedCatalog", "extraKey", "arraySubclass", "sparseArray"]) {
    const result = runCheckerSeamScenario(scenario);
    assert.equal(result.ok, false);
    assert.equal(result.category, "CHECKER_RESULT");
    assert.equal(result.sentinelPresent, false);
  }
});

test("checker rejects raw failures without retaining them", () => {
  const result = runCheckerSeamScenario("rawFailure");
  assert.equal(result.ok, false);
  assert.equal(result.category, "CHECKER_RESULT");
  assert.equal(result.sentinelPresent, false);
});

test("checker rejects accessors and proxies without executing them", () => {
  const accessor = runCheckerSeamScenario("accessor");
  assert.equal(accessor.ok, false);
  assert.equal(accessor.category, "CHECKER_RESULT");
  assert.equal(accessor.reads, 0);
  const proxy = runCheckerSeamScenario("proxy");
  assert.equal(proxy.ok, false);
  assert.equal(proxy.category, "CHECKER_RESULT");
  assert.equal(proxy.traps, 0);
  for (const scenario of ["nestedFailuresProxy", "nestedCatalogProxy", "customIterator"]) {
    const nested = runCheckerSeamScenario(scenario);
    assert.equal(nested.ok, false);
    assert.equal(nested.category, "CHECKER_RESULT");
    assert.equal(nested.traps, 0);
  }
});

test("actual checker refuses validator overrides behind a fixed diagnostic", () => {
  assert.deepEqual(runCheckerSeamScenario("validateOverride"), {
    marker: "checker-seam-result",
    scenario: "validateOverride",
    validateCalls: 0,
    outcome: {
      exitCode: 1,
      stdout: "",
      stderr: "App static surface inventory failed [UNEXPECTED]\n",
    },
    sentinelPresent: false,
  });
});

test("actual checker CLI is execution-bound and exact", () => {
  const child = spawnSync(nodeExecutable, [checkerPath], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {},
  });
  assert.equal(child.error, undefined);
  assert.equal(isExactCheckerSuccess(child), true);
});

test("validator child receives no inherited Node injection options", () => {
  const preloadSource = 'if (process.argv.length === 1) process.stdout.write(" ");';
  const child = spawnSync(nodeExecutable, [checkerPath], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(preloadSource)}`,
    },
  });
  assert.equal(child.error, undefined);
  assert.equal(isExactCheckerSuccess(child), true);
});

test("surviving parent rejects an early-success checker mutation", () => {
  const directory = fixtureDirectory();
  try {
    const exact = readFileSync(checkerPath, "utf8");
    const mutated = exact.replace(
      "if (isMain) {",
      "if (isMain) {\n  process.exit(0);",
    );
    assert.notEqual(mutated, exact);
    const mutatedPath = path.join(directory, "checker.mjs");
    writeFileSync(mutatedPath, mutated, "utf8");
    const child = spawnSync(nodeExecutable, [mutatedPath], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: {},
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0);
    assert.equal(child.stdout, "");
    assert.equal(isExactCheckerSuccess(child), false);
  } finally {
    cleanup(directory);
  }
});

test("copied checker rejects benign validator and parser byte drift before evaluation", () => {
  const directory = fixtureDirectory();
  try {
    const scriptsDirectory = path.join(directory, "scripts");
    const libraryDirectory = path.join(scriptsDirectory, "lib");
    mkdirSync(libraryDirectory, { recursive: true });
    const copiedCheckerPath = path.join(scriptsDirectory, "check-app-static-surface-inventory.mjs");
    const copiedLibraryPath = path.join(libraryDirectory, "app-static-surface-inventory.mjs");
    const copiedParserPath = path.join(libraryDirectory, "app-router-inventory.mjs");
    const exactChecker = readFileSync(checkerPath, "utf8");
    const exactLibrary = readFileSync(libraryPath, "utf8");
    const exactParser = readFileSync(appRouterLibraryPath, "utf8");
    writeFileSync(copiedCheckerPath, exactChecker, "utf8");
    writeFileSync(copiedLibraryPath, exactLibrary, "utf8");
    writeFileSync(copiedParserPath, exactParser, "utf8");

    const runCopiedChecker = () => spawnSync(nodeExecutable, [copiedCheckerPath], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: {},
    });
    assert.equal(isExactCheckerSuccess(runCopiedChecker()), true);

    for (const [sourcePath, exactSource] of [
      [copiedLibraryPath, exactLibrary],
      [copiedParserPath, exactParser],
    ]) {
      writeFileSync(sourcePath, "// harmless dependency drift\n" + exactSource, "utf8");
      const child = runCopiedChecker();
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1);
      assert.equal(child.signal, null);
      assert.equal(child.stdout, "");
      assert.equal(child.stderr, "App static surface inventory failed [UNEXPECTED]\n");
      writeFileSync(sourcePath, exactSource, "utf8");
    }
  } finally {
    cleanup(directory);
  }
});

const resealSiteOrigin = "https://mochirii.com";
const resealBaseUrl = "https://preview.example";
const resealHeader = `<header id="site-header" class="site-header" data-state="top"><a class="skip-link" href="#main">Skip to content</a></header>`;

function resealHomeHtml(ogImage = resealSiteOrigin + "/assets/card.webp") {
  return `<!doctype html><html><head><title>Mōchirīī • Where Winds Meet Guild</title><meta name="description" content="Mōchirīī guild"><link rel="canonical" href="${resealSiteOrigin}"><meta property="og:title" content="Mōchirīī"><meta property="og:image" content="${ogImage}"><link rel="stylesheet" href="/_next/static/chunks/3jvcxpga865m1.css" data-precedence="next"></head><body>${resealHeader}<script async="" src="/_next/static/chunks/3nk76snv1e0rj.js"></script><footer class="site-footer" role="contentinfo"><div class="footer-wrap"><div class="footer-bottom"><nav class="footer-legal" aria-label="Privacy and support"><a href="/privacy">Privacy</a><a href="/meta-data-deletion">Data Deletion</a><a href="mailto:support@mochirii.com">support@mochirii.com</a></nav></div></div></footer></body></html>`;
}

function resealBody(url) {
  switch (url.pathname) {
    case "/":
      return resealHomeHtml();
    case "/recruitment":
      return `<!doctype html><html><head><title>Recruitment</title><link rel="canonical" href="${resealSiteOrigin}/recruitment"></head><body>${resealHeader}<main>Recruitment<audio id="recruitmentAudio" src="./assets/audio/mochiriiiiii.mp3" preload="none" class="recruitment-audio-native" aria-labelledby="recruitmentAudioTitle" aria-describedby="recruitmentAudioDesc" controlslist="nodownload">Audio fallback.</audio></main></body></html>`;
    case "/privacy":
      return `<!doctype html><html><head><title>Privacy</title><link rel="canonical" href="${resealSiteOrigin}/privacy"></head><body>${resealHeader}<main>Website scope</main></body></html>`;
    case "/meta-data-deletion":
      return `<!doctype html><html><head><title>Data Deletion</title><link rel="canonical" href="${resealSiteOrigin}/meta-data-deletion"></head><body>${resealHeader}<main>Data Deletion Requests</main></body></html>`;
    case "/robots.txt":
      return `User-agent: *\nSitemap: ${resealSiteOrigin}/sitemap.xml\n`;
    case "/sitemap.xml":
      return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${resealSiteOrigin}/gallery</loc></url><url><loc>${resealSiteOrigin}/privacy</loc></url><url><loc>${resealSiteOrigin}/meta-data-deletion</loc></url></urlset>`;
    default:
      return `<!doctype html><html><head><title>Mōchirīī</title></head><body>${resealHeader}<main>Mōchirīī</main></body></html>`;
  }
}

function resealMediaType(pathname) {
  if (pathname === "/robots.txt") return "text/plain; charset=utf-8";
  if (pathname === "/sitemap.xml") return "application/xml; charset=utf-8";
  if (pathname.startsWith("/assets/")) return "image/webp";
  return "text/html; charset=utf-8";
}

function resealReply(url, body, headers) {
  const response = new Response(body, { status: 200, headers });
  return {
    body: response.body,
    headers: response.headers,
    redirected: false,
    status: response.status,
    url,
  };
}

function resealFlightScript(record) {
  return `<script>self.__next_f.push(${JSON.stringify([1, record])})</script>`;
}

function transformResealFlightStream(body, transform) {
  const prefix = "<script>self.__next_f.push(";
  const scriptStart = body.indexOf(prefix);
  const scriptEnd = body.indexOf(")</script>", scriptStart);
  assert(scriptStart >= 0 && scriptEnd > scriptStart);
  const payload = JSON.parse(body.slice(scriptStart + prefix.length, scriptEnd));
  assert(Array.isArray(payload) && payload.length === 2 && payload[0] === 1);
  const transformed = transform(payload[1]);
  assert.equal(typeof transformed, "string");
  assert.notEqual(transformed, payload[1]);
  return body.slice(0, scriptStart)
    + resealFlightScript(transformed)
    + body.slice(scriptEnd + ")</script>".length);
}

const resealFlightBuildId = "0123456789abcdefghijk";
const resealFlightSemanticToken = "zyxwvutsrqponmlkjihgf";
const resealFlightVisiblePath = "/_next/static/chunks/copy-3nk76snv1e0rj.js";
const resealFlightAlternateVisiblePath = "/_next/static/chunks/copy-2q2n8r5k4t9bc.js";
const resealSafeFlightNode = [
  "$", "span", "copy", { children: `Mōchirīī ${resealFlightVisiblePath}` },
];

function resealFlightStream({
  buildId = resealFlightBuildId,
  fontPath = "/_next/static/media/noto_serif_sc_latin.p.2xkduggpvd1-n.woff2",
  hintStylePath = "/_next/static/chunks/1edizae69s1-8.css",
  importPath = "/_next/static/chunks/1y9qnyvp65ool.js",
  node = resealSafeFlightNode,
  scriptPath = "/_next/static/chunks/0_kqt9b7hwk8z.js",
  semanticToken = resealFlightSemanticToken,
  stylePath = "/_next/static/chunks/3u3ip5izc6gmi.css",
} = {}) {
  const resourceLink = ["$", "link", "flight-style", {
    rel: "stylesheet",
    href: stylePath,
    precedence: "next",
    crossOrigin: "$undefined",
    nonce: "$undefined",
  }];
  const root = {
    P: null,
    c: [],
    q: "",
    i: false,
    f: [resourceLink, "$L1"],
    m: "fixture",
    G: [],
    S: false,
    h: null,
    r: "",
    s: "",
    a: "",
    l: "",
    p: "",
    d: semanticToken,
    b: buildId,
  };
  const container = ["$", "div", "fixture", { children: ["$L2", "$L3", "$L4"] }];
  const structuredData = ["$", "script", "jsonld", {
    dangerouslySetInnerHTML: { __html: JSON.stringify({ "@context": "https://schema.org" }) },
    type: "application/ld+json",
  }];
  const resourceScript = ["$", "script", "flight-script", {
    src: scriptPath,
    async: true,
    nonce: "$undefined",
  }];
  return `0:${JSON.stringify(root)}\n`
    + `5:I${JSON.stringify([45129, [importPath], "FixtureModule"])}\n`
    + `:HL${JSON.stringify([hintStylePath, "style"])}\n`
    + `:HL${JSON.stringify([fontPath, "font", { crossOrigin: "", type: "font/woff2" }])}\n`
    + `1:${JSON.stringify(container)}\n`
    + `2:${JSON.stringify(node)}\n`
    + `3:${JSON.stringify(structuredData)}\n`
    + `4:${JSON.stringify(resourceScript)}\n`;
}

const resealHomeSpotlightRetainedOrder = Object.freeze(["26", "24", "21", "1f", "23"]);

function resealHomeSpotlightFlightStream({
  anchorChildren = "$L24",
  cardId = "spotlightCard",
  cardRole = "group",
  importName = "IconMark",
  order = resealHomeSpotlightRetainedOrder,
  title = "Member Spotlight",
} = {}) {
  const root = {
    P: null,
    c: [],
    q: "",
    i: false,
    f: ["$Ld", "$L12", "$L13"],
    m: "fixture",
    G: [],
    S: false,
    h: null,
    r: "",
    s: "",
    a: "",
    l: "",
    p: "",
    d: resealFlightSemanticToken,
    b: resealFlightBuildId,
  };
  const spotlight = ["$", "section", "spotlight-section", {
    className: "glass-card glass-card--primary glass-pad u-mt-24",
    "aria-label": "Member spotlight",
    children: ["$", "div", "spotlight-card", {
      id: cardId,
      className: "home-spotlight",
      role: cardRole,
      "aria-label": "Member spotlight - Fixture - Kind - Spotlight Appreciation",
      children: ["$", "div", "spotlight-plate", {
        className: "home-spotlight__plate",
        children: ["$", "h3", "spotlight-title", {
          id: "spotlightTitle",
          className: "home-title",
          children: anchorChildren,
        }],
      }],
    }],
  }];
  const viewportMetadata = [
    ["$", "meta", "0", { charSet: "utf-8" }],
    ["$", "meta", "1", {
      name: "viewport",
      content: "width=device-width, initial-scale=1, viewport-fit=cover",
    }],
    ["$", "meta", "2", { name: "theme-color", content: "#0a0c0e" }],
  ];
  const documentMetadata = Array.from({ length: 19 }, (_, index) => [
    "$", "meta", String(index), { name: `fixture-${index}`, content: `value-${index}` },
  ]);
  documentMetadata.push(["$", "$L26", "19", {}]);
  const rows = new Map([
    ["0", `0:${JSON.stringify(root)}\n`],
    ["d", `d:${JSON.stringify(["$", "main", "home-main", { children: ["stable", "$L1b"] }])}\n`],
    ["12", `12:${JSON.stringify(["$", "div", "metadata-outlet", { children: "$@1f" }])}\n`],
    ["13", `13:${JSON.stringify(["$", "div", "metadata-ready", { children: ["$L21", "$L23"] }])}\n`],
    ["1b", `1b:${JSON.stringify(spotlight)}\n`],
    ["26", `26:I${JSON.stringify([60329, [resealFlightVisiblePath], importName])}\n`],
    ["24", `24:${JSON.stringify(title)}\n`],
    ["21", `21:${JSON.stringify(viewportMetadata)}\n`],
    ["1f", "1f:null\n"],
    ["23", `23:${JSON.stringify(documentMetadata)}\n`],
  ]);
  return ["0", "d", "12", "13", "1b", ...order].map((recordId) => rows.get(recordId)).join("");
}

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index), ...values.slice(index + 1),
  ]).map((tail) => [value, ...tail]));
}

function withReachableFlightReference(stream, reference) {
  const rows = stream.trimEnd().split("\n");
  const parentIndex = rows.findIndex((row) => row.startsWith("d:"));
  assert(parentIndex >= 0);
  const parent = JSON.parse(rows[parentIndex].slice(2));
  parent[3].children.push(reference);
  rows[parentIndex] = `d:${JSON.stringify(parent)}`;
  return `${rows.join("\n")}\n`;
}

function withRootFlightReference(stream, field, reference) {
  const rows = stream.trimEnd().split("\n");
  assert(rows[0].startsWith("0:"));
  const rootRecord = JSON.parse(rows[0].slice(2));
  if (field === "c") {
    rootRecord.c.push(reference);
  } else {
    assert(["q", "m", "r", "s", "a", "l", "p", "d"].includes(field));
    rootRecord[field] = reference;
  }
  rows[0] = `0:${JSON.stringify(rootRecord)}`;
  return `${rows.join("\n")}\n`;
}

function withFlightImportReference(stream, reference) {
  const rows = stream.trimEnd().split("\n");
  const terminalIndex = Math.min(...resealHomeSpotlightRetainedOrder.map((recordId) =>
    rows.findIndex((row) => row.startsWith(`${recordId}:`))));
  assert(terminalIndex >= 0);
  rows.splice(terminalIndex, 0, `25:I${JSON.stringify([
    1, [resealFlightVisiblePath], reference,
  ])}`);
  return `${rows.join("\n")}\n`;
}

function withReachableDeferredReturn(stream, targetRecordId) {
  const rows = withReachableFlightReference(stream, "$@27").trimEnd().split("\n");
  const terminalIndex = Math.min(...resealHomeSpotlightRetainedOrder.map((recordId) =>
    rows.findIndex((row) => row.startsWith(`${recordId}:`))));
  assert(terminalIndex >= 0);
  rows.splice(terminalIndex, 0, "27:x", `27:C"$${targetRecordId}"`);
  return `${rows.join("\n")}\n`;
}

const resealSafeFlightStream = resealFlightStream();
const resealSafeFlightScript = resealFlightScript(resealSafeFlightStream);
const resealFlightInitializer = "<script>(self.__next_f=self.__next_f||[]).push([0])</script>";

const resealStaticResources = Object.freeze({
  body: '<script async="" src="/_next/static/chunks/3nk76snv1e0rj.js"></script>'
    + '<script async="" src="/_next/static/chunks/turbopack-3x7rb7n3bw1wb.js"></script>'
    + resealFlightInitializer
    + resealSafeFlightScript,
  head: '<link rel="stylesheet" href="/_next/static/chunks/3jvcxpga865m1.css" data-precedence="next">',
});

function resealFixture({
  buildId = "",
  buildIdForPath = () => buildId,
  bodyTransform = (body) => body,
  resourcePaths = new Set(),
  scriptBuildId = undefined,
  responseHeaders = () => ({}),
} = {}) {
  const calls = [];
  const requestCounts = new Map();
  return {
    calls,
    async fetchImpl(input, options) {
      const url = new URL(input);
      const occurrence = (requestCounts.get(url.pathname) || 0) + 1;
      requestCounts.set(url.pathname, occurrence);
      calls.push({ occurrence, options, path: url.pathname });
      let body = url.pathname.startsWith("/assets/")
        ? new Uint8Array([0x52, 0x49, 0x46, 0x46])
        : resealBody(url);
      if (typeof body === "string" && resourcePaths.has(url.pathname)) {
        body = body.replace("</head>", resealStaticResources.head + "</head>")
          .replace("</body>", resealStaticResources.body + "</body>");
      }
      const responseBuildId = buildIdForPath(url.pathname, occurrence);
      if (typeof body === "string" && responseBuildId) {
        body = body.replaceAll("/_next/static/", `/_next/static/${responseBuildId}/`);
        body = body.replaceAll(
          `/_next/static/${responseBuildId}/chunks/copy-`,
          "/_next/static/chunks/copy-",
        );
        const responseScriptBuildId = scriptBuildId === undefined
          ? responseBuildId : scriptBuildId;
        if (responseScriptBuildId !== responseBuildId) {
          body = body.replace(
            `src="/_next/static/${responseBuildId}/chunks/3nk76snv1e0rj.js"`,
            `src="/_next/static/${responseScriptBuildId}/chunks/3nk76snv1e0rj.js"`,
          );
        }
      }
      if (typeof body === "string") body = bodyTransform(body, url, occurrence);
      return resealReply(url.href, body, {
        "content-type": resealMediaType(url.pathname),
        ...responseHeaders(url),
      });
    },
  };
}

const fontPreload = (buildId, name) =>
  `</_next/static/${buildId ? buildId + "/" : ""}media/${name}.woff2>; rel=preload; as="font"; crossorigin=""; type="font/woff2"`;

function resealFlightPolicyFixture(bodyTransform = (body) => body) {
  return resealFixture({
    bodyTransform,
    resourcePaths: new Set(["/events", "/gallery", "/join", "/privacy"]),
    responseHeaders: (url) => url.pathname === "/events" ? {
      link: [fontPreload("", "font-a"), fontPreload("", "font-b")].join(", "),
    } : {},
  });
}

async function loadProductionSelectorWithFixturePolicies(directory) {
  const source = readFileSync(productionCheckerPath, "utf8");
  const productionMarker = "const PRODUCTION_DOCUMENT_POLICIES = Object.freeze({";
  const testMarker = "const TEST_DOCUMENT_POLICIES = Object.freeze({";
  const followingMarker = "const PRODUCTION_SITE_HEADER_ATTRIBUTE_NAMES =";
  assert.equal(source.split(productionMarker).length - 1, 1);
  assert.equal(source.split(testMarker).length - 1, 1);
  assert.equal(source.split(followingMarker).length - 1, 1);
  const productionStart = source.indexOf(productionMarker);
  const testStart = source.indexOf(testMarker, productionStart + productionMarker.length);
  const followingStart = source.indexOf(followingMarker, testStart + testMarker.length);
  assert(productionStart >= 0 && testStart > productionStart && followingStart > testStart);
  const fixturePolicyDeclaration = source.slice(testStart, followingStart)
    .replace(testMarker, productionMarker);
  assert.equal(fixturePolicyDeclaration.includes(testMarker), false);
  const mutated = source.slice(0, productionStart)
    + fixturePolicyDeclaration
    + "const TEST_DOCUMENT_POLICIES = Object.freeze({});\n"
    + source.slice(followingStart);
  assert.notEqual(mutated, source);
  assert.equal(mutated.split(productionMarker).length - 1, 1);
  assert.equal(mutated.split(testMarker).length - 1, 1);
  const mutatedPath = path.join(directory, "check-production-fixture-policies.mjs");
  writeFileSync(mutatedPath, mutated, "utf8");
  const module = await import(pathToFileURL(mutatedPath).href);
  assert.equal(typeof module.checkProduction, "function");
  return module.checkProduction;
}

test("production document variants preserve exact header-resource pairings", () => {
  const headerA = "A".repeat(64);
  const headerB = "B".repeat(64);
  const resourcesA = "C".repeat(64);
  const resourcesB = "D".repeat(64);
  const resourcesC = "E".repeat(64);
  const policy = {
    variants: [
      { header: headerA, resources: [resourcesA, resourcesB] },
      { header: headerB, resources: resourcesC },
    ],
  };
  assert.equal(productionDocumentPolicyMatches(policy, headerA, resourcesA), true);
  assert.equal(productionDocumentPolicyMatches(policy, headerA, resourcesB), true);
  assert.equal(productionDocumentPolicyMatches(policy, headerB, resourcesC), true);
  assert.equal(productionDocumentPolicyMatches(policy, headerA, resourcesC), false);
  assert.equal(productionDocumentPolicyMatches(policy, headerB, resourcesA), false);
});

test("production profiles bind the repaired local and live resource envelopes exactly", () => {
  const sharedHeader = "767693EE075EE31FE445A966DBE0BC2823B4353406A94C590DFF787CEED8E5E3";
  const localHomeHeader = "675E803BB871598DAD4CE0D1A3A64CB1ED1D30FB7616932CEA63CF25A98530F0";
  const localHomeResources = "3ED2476C6AE21876EADBE86B73FE0615C8FB8E1350C5E8CD9C8B34EF5B971820";
  const liveHomeResources = "AF7841F98846581A218F2CBF97474B61B44F133E70586FE31B59D404416A1A12";
  const recruitmentHeader = "179EADA7DAB503C38AD261D71B2301F8DB134C5354ED186BE6ED227C213E5649";
  const localRecruitmentResources = "C92A261DD8F4354A428EFE76BA65AC19DBE81319FAC57762A97D1FB249FA238A";
  const liveRecruitmentResources = "6CC57E08D21592A8C637D344931BBB4F508699AE69EA768C3ABC1E920DDFA023";
  const localPrivacyResources = "727E4C0D6E5C2A93C57660844BD08264A02643416CE0D63BCE58832DC2A863AA";
  const livePrivacyResources = "6EA10100B693D0E95B09CBF1F6901F0CC5EEBD853F1A2607BE846A5C7AEF4C7C";
  const localDeletionResources = "ED2A94A30FFCEF523DAA23935D4327E0782719182CDEAC3EECFA14EEF2452E4E";
  const liveDeletionResources = "43111FFA05C8E063026126CAC9A90A7C97A28C38CC8F1BD8B3F7398B904DA0CC";
  assert.equal(productionDocumentProfileMatches(
    "home", localHomeHeader, localHomeResources,
  ), true);
  assert.equal(productionDocumentProfileMatches("home", sharedHeader, liveHomeResources), true);
  assert.equal(productionDocumentProfileMatches(
    "recruitment", recruitmentHeader, localRecruitmentResources,
  ), true);
  assert.equal(productionDocumentProfileMatches(
    "recruitment", recruitmentHeader, liveRecruitmentResources,
  ), true);
  assert.equal(productionDocumentProfileMatches(
    "privacy", sharedHeader, localPrivacyResources,
  ), true);
  assert.equal(productionDocumentProfileMatches(
    "privacy", sharedHeader, livePrivacyResources,
  ), true);
  assert.equal(productionDocumentProfileMatches(
    "deletion", sharedHeader, localDeletionResources,
  ), true);
  assert.equal(productionDocumentProfileMatches(
    "deletion", sharedHeader, liveDeletionResources,
  ), true);
  assert.equal(productionDocumentProfileMatches("home", localHomeHeader, liveHomeResources), false);
  assert.equal(productionDocumentProfileMatches("home", sharedHeader, localHomeResources), false);
  assert.equal(productionDocumentProfileMatches(
    "recruitment", recruitmentHeader, localPrivacyResources,
  ), false);
  assert.equal(productionDocumentProfileMatches(
    "privacy", sharedHeader, "24BA6252EED0D271A80D25CE45A61BF813F151A0D015291F4EDC1B4D5B2E9225",
  ), false);
  assert.equal(productionDocumentProfileMatches(
    "unknown", sharedHeader, localPrivacyResources,
  ), false);
});

test("production export selects and enforces its bound policy dataflow", async () => {
  const directory = fixtureDirectory();
  try {
    const checkProductionWithFixturePolicies = await loadProductionSelectorWithFixturePolicies(
      directory,
    );
    const safe = resealFlightPolicyFixture();
    assert.deepEqual(await checkProductionWithFixturePolicies({
      baseUrl: resealBaseUrl,
      defaultBaseUrlLoader: () => resealSiteOrigin,
      fetchImpl: safe.fetchImpl,
      maxAttempts: 1,
    }), { ok: true });
    assert.equal(safe.calls.length, 16);
    assert(safe.calls.every(({ options }) => options.redirect === "manual"));

    for (const node of [
      ["$", "span", "copy", { children: "Mōchirīx" }],
      ["$", "span", "copy", { children: `Mōchirīī ${resealFlightAlternateVisiblePath}` }],
      ["$", "iframe", "copy", { src: "https://outside.example/harvest" }],
      ["$", "script", "copy", { src: "https://outside.example/injected.js" }],
    ]) {
      const hostile = resealFlightPolicyFixture((body, url, occurrence) => {
        if (url.pathname !== "/privacy" || occurrence !== 2) return body;
        return body.replace(
          resealSafeFlightScript,
          resealFlightScript(resealFlightStream({ node })),
        );
      });
      await assert.rejects(() => checkProductionWithFixturePolicies({
        baseUrl: resealBaseUrl,
        defaultBaseUrlLoader: () => resealSiteOrigin,
        fetchImpl: hostile.fetchImpl,
        maxAttempts: 1,
      }), { message: "HTML_DOCUMENT_REJECTED" });
    }
  } finally {
    cleanup(directory);
  }
});

test("production checker accepts the bounded Vercel publication envelope", async () => {
  const buildId = "build_123";
  const current = resealFixture({
    buildId,
    bodyTransform: (body, url) => url.pathname === "/events"
      ? body.replace("<main>", '<main><img src="assets/ordinary.webp">') : body,
    resourcePaths: new Set(["/events", "/gallery", "/join", "/privacy"]),
    responseHeaders(url) {
      const filename = url.pathname.split("/").at(-1) || "";
      const disposition = url.pathname.startsWith("/assets/")
        || url.pathname === "/robots.txt"
        || url.pathname === "/sitemap.xml"
        ? `inline; filename="${filename}"`
        : "inline";
      return {
        "content-disposition": disposition,
        ...(url.pathname.startsWith("/assets/")
          ? { "content-length": "0000000000000004" } : {}),
        ...(url.pathname === "/events" ? {
          link: [fontPreload(buildId, "font-a"), fontPreload(buildId, "font-b")].join(", "),
        } : {}),
      };
    },
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: current.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(current.calls.length, 16);
  assert(current.calls.every(({ options }) => options.redirect === "manual"));

  const local = resealFixture({
    resourcePaths: new Set(["/events", "/gallery", "/join", "/privacy"]),
    responseHeaders: (url) => url.pathname === "/events" ? {
      link: [fontPreload("", "font-a"), fontPreload("", "font-b")].join(", "),
    } : {},
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: local.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(local.calls.length, 16);

  const splitFlightStream = resealFixture({
    buildId: "build_a",
    resourcePaths: new Set(["/privacy"]),
    bodyTransform(body, url, occurrence) {
      if (url.pathname !== "/privacy" || occurrence !== 2) return body;
      const prefix = "<script>self.__next_f.push(";
      const scriptStart = body.indexOf(prefix);
      const scriptEnd = body.indexOf(")</script>", scriptStart);
      assert(scriptStart >= 0 && scriptEnd > scriptStart);
      const payload = JSON.parse(body.slice(scriptStart + prefix.length, scriptEnd));
      assert(Array.isArray(payload) && payload.length === 2 && payload[0] === 1);
      const stream = payload[1];
      const splitAt = stream.indexOf("build_a") + Math.floor("build_a".length / 2);
      assert(splitAt > 0 && splitAt < stream.length);
      const firstPayload = JSON.stringify([1, stream.slice(0, splitAt)]);
      const secondPayload = JSON.stringify([1, stream.slice(splitAt)]);
      return body.slice(0, scriptStart)
        + `<script>self.__next_f.push(${firstPayload})</script>`
        + `<script>self.__next_f.push(${secondPayload})</script>`
        + body.slice(scriptEnd + ")</script>".length);
    },
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: splitFlightStream.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(splitFlightStream.calls.length, 16);
});

test("production checker actual home consumer binds Spotlight normalization and diagnostics", async () => {
  const streams = [
    resealHomeSpotlightFlightStream(),
    resealHomeSpotlightFlightStream({
      order: ["26", "23", "1f", "21", "24"],
      title: "Lián 🌸",
    }),
  ];
  for (const stream of streams) {
    const fixture = resealFixture({
      resourcePaths: new Set(["/"]),
      bodyTransform: (body, url) => url.pathname === "/"
        ? body.replace(resealSafeFlightScript, resealFlightScript(stream)) : body,
    });
    assert.deepEqual(await checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      fetchImpl: fixture.fetchImpl,
      maxAttempts: 1,
    }), { ok: true });
    assert.equal(fixture.calls.length, 16);
  }

  const sentinel = "MOCHIRII_SPOTLIGHT_PRIVATE_SENTINEL";
  const messages = [];
  const hostileStream = resealHomeSpotlightFlightStream({
    title: `${sentinel}\u202e`,
  });
  const hostile = resealFixture({
    resourcePaths: new Set(["/"]),
    bodyTransform: (body, url) => url.pathname === "/"
      ? body.replace(resealSafeFlightScript, resealFlightScript(hostileStream)) : body,
  });
  await assert.rejects(() => checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    diagnose: true,
    fetchImpl: hostile.fetchImpl,
    maxAttempts: 1,
    reportDiagnostic: (message) => messages.push(message),
  }), { message: "HTML_DOCUMENT_REJECTED" });
  assert(messages.length > 0);
  assert(messages.every((message) => typeof message === "string"
    && message.length <= 128
    && !message.includes(sentinel)));

  const footerMessages = [];
  const footerHostile = resealFixture({
    resourcePaths: new Set(["/"]),
    bodyTransform: (body, url) => url.pathname === "/"
      ? body
        .replace(resealSafeFlightScript, resealFlightScript(streams[1]))
        .replace('<a href="/privacy">Privacy</a>', '<a href="/privacy-drift">Privacy</a>')
      : body,
  });
  await assert.rejects(() => checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    diagnose: true,
    fetchImpl: footerHostile.fetchImpl,
    maxAttempts: 1,
    reportDiagnostic: (message) => footerMessages.push(message),
  }), { message: "CONTENT_HOMEPAGE_FOOTER_REJECTED" });
  assert(footerMessages.length > 0);
  assert(footerMessages.every((message) => typeof message === "string"
    && message.length <= 128
    && !message.includes("privacy-drift")));
});

test("production Flight aggregation preserves its body context and resource position", async () => {
  const regularScript = '<script async="" src="/_next/static/chunks/3nk76snv1e0rj.js"></script>';
  const turbopackScript = '<script async="" src="/_next/static/chunks/turbopack-3x7rb7n3bw1wb.js"></script>';
  const splitAt = Math.floor(resealSafeFlightStream.length / 2);
  const firstFlightScript = resealFlightScript(resealSafeFlightStream.slice(0, splitAt));
  const secondFlightScript = resealFlightScript(resealSafeFlightStream.slice(splitAt));
  const flightBlock = resealFlightInitializer + resealSafeFlightScript;
  const cases = [
    ["head-context", (body) => body.replace(flightBlock, "")
      .replace("<head>", "<head>" + flightBlock)],
    ["initializer-after-flight", (body) => body.replace(
      flightBlock,
      resealSafeFlightScript + resealFlightInitializer,
    )],
    ["intervening-resource", (body) => body.replace(
      resealStaticResources.body,
      regularScript + resealFlightInitializer
        + firstFlightScript + turbopackScript + secondFlightScript,
    )],
  ];
  for (const [name, transform] of cases) {
    const current = resealFixture({
      resourcePaths: new Set(["/privacy"]),
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/privacy" || occurrence !== 2) return body;
        const mutated = transform(body);
        assert.notEqual(mutated, body, name);
        return mutated;
      },
    });
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
    assert.equal(current.calls.length, 13, name);
    assert(current.calls.every(({ options }) => options.redirect === "manual"), name);
  }
});

test("production checker accepts only genuine stable bare Next resource hashes across rebuilds", async () => {
  const rebuilt = resealFixture({
    bodyTransform: (body) => body
      .replaceAll(
        "/_next/static/chunks/3nk76snv1e0rj.js",
        "/_next/static/chunks/45cn8rw14zvg_.js",
      )
      .replaceAll(
        "/_next/static/chunks/3jvcxpga865m1.css",
        "/_next/static/chunks/2q2n8r5k4t9bc.css",
      ),
    resourcePaths: new Set(["/events", "/gallery", "/join", "/privacy"]),
    responseHeaders: (url) => url.pathname === "/events" ? {
      link: [fontPreload("", "font-a"), fontPreload("", "font-b")].join(", "),
    } : {},
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: rebuilt.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(rebuilt.calls.length, 16);
});

test("production checker accepts genuine Turbopack-prefixed resource hashes across rebuilds", async () => {
  const rebuilt = resealFixture({
    bodyTransform: (body) => body.replaceAll(
      "turbopack-3x7rb7n3bw1wb.js",
      "turbopack-1a2b3c4d5e6-7.js",
    ),
    resourcePaths: new Set(["/events", "/gallery", "/join", "/privacy"]),
    responseHeaders: (url) => url.pathname === "/events" ? {
      link: [fontPreload("", "font-a"), fontPreload("", "font-b")].join(", "),
    } : {},
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: rebuilt.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(rebuilt.calls.length, 16);
});

test("production resource shapes reject count, order, context, type, and non-Next drift", async () => {
  const canonical = `<link rel="canonical" href="${resealSiteOrigin}">`;
  const mutations = [
    ["remove", (body) => body.replace(resealStaticResources.head, "")],
    ["add", (body) => body.replace(
      resealStaticResources.body,
      resealStaticResources.body + resealStaticResources.body,
    )],
    ["reorder", (body) => body.replace(resealStaticResources.head, "")
      .replace(canonical, resealStaticResources.head + canonical)],
    ["context", (body) => body.replace(resealStaticResources.head, "")
      .replace("</body>", resealStaticResources.head + "</body>")],
    ["type", (body) => body.replace("3jvcxpga865m1.css", "3jvcxpga865m1.js")],
    ["ordinary-word", (body) => body.replace("3nk76snv1e0rj.js", "configuration.js")],
    ["ordinary-symbols", (body) => body.replace("3nk76snv1e0rj.js", "_____________.js")],
    ["out-of-range-base38", (body) => body.replace("3nk76snv1e0rj.js", "5nk76snv1e0rj.js")],
    ["above-maximum-base38", (body) => body.replace("3nk76snv1e0rj.js", "45cn8rw14zvg-.js")],
    ["short-generated-token", (body) => body.replace("3nk76snv1e0rj.js", "3nk76snv1e0r.js")],
    ["long-generated-token", (body) => body.replace("3nk76snv1e0rj.js", "3nk76snv1e0rj0.js")],
    ["full-generated-token", (body) => body.replace(
      "3nk76snv1e0rj.js",
      "3nk76snv1e0rj0a2b4c6d8e0f.js",
    )],
    ["uppercase-generated-token", (body) => body.replace("3nk76snv1e0rj.js", "3Nk76snv1e0rj.js")],
    ["changed-stable-prefix", (body) => body.replace(
      "turbopack-3x7rb7n3bw1wb.js",
      "webpack-3x7rb7n3bw1wb.js",
    )],
    ["invalid-stable-prefix", (body) => body.replace(
      "turbopack-3x7rb7n3bw1wb.js",
      "turbopack_3x7rb7n3bw1wb.js",
    )],
    ["non-Next", (body) => body.replace(
      "/_next/static/chunks/3nk76snv1e0rj.js",
      "/assets/non-next-app.js",
    )],
  ];
  for (const [name, mutate] of mutations) {
    const current = resealFixture({
      resourcePaths: new Set(["/privacy"]),
      bodyTransform(body, url, occurrence) {
        return url.pathname === "/privacy" && occurrence === 2 ? mutate(body) : body;
      },
    });
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
  }
});

test("production resource envelopes bind every non-generated Flight payload byte", async () => {
  const safeFlightLines = resealSafeFlightStream.trimEnd().split("\n");
  const recordTwo = safeFlightLines.findIndex((line) => line.startsWith("2:"));
  const recordThree = safeFlightLines.findIndex((line) => line.startsWith("3:"));
  assert(recordTwo >= 0 && recordThree === recordTwo + 1);
  const reorderedLines = [...safeFlightLines];
  [reorderedLines[recordTwo], reorderedLines[recordThree]] = [
    reorderedLines[recordThree], reorderedLines[recordTwo],
  ];
  const reorderedFlightStream = reorderedLines.join("\n") + "\n";
  const hostileStreams = [
    ["copy", resealFlightStream({
      node: ["$", "span", "copy", { children: "Mōchirīx" }],
    })],
    ["iframe", resealFlightStream({
      node: ["$", "iframe", "copy", { src: "https://outside.example/harvest" }],
    })],
    ["script", resealFlightStream({
      node: ["$", "script", "copy", { src: "https://outside.example/injected.js" }],
    })],
    ["root-semantic", resealFlightStream({ semanticToken: "abcdefghijklmnopqrstu" })],
    ["resource-shaped-copy", resealFlightStream({
      node: [
        "$", "span", "copy", { children: `Mōchirīī ${resealFlightAlternateVisiblePath}` },
      ],
    })],
    ["record-order", reorderedFlightStream],
  ];
  for (const [name, stream] of hostileStreams) {
    const current = resealFixture({
      resourcePaths: new Set(["/privacy"]),
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/privacy" || occurrence !== 2) return body;
        const mutated = body.replace(resealSafeFlightScript, resealFlightScript(stream));
        assert.notEqual(mutated, body);
        return mutated;
      },
    });
    const messages = [];
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      diagnose: true,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
      reportDiagnostic: (message) => messages.push(message),
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
    assert.equal(current.calls.length, 13, name);
    assert(current.calls.every(({ options }) => options.redirect === "manual"), name);
    assert.equal(messages.length, 15, name);
    assert.deepEqual(messages.slice(-2), [
      name === "script" || name === "iframe"
        ? "HTML namespace parser PAYLOAD_MODEL"
        : "HTML document parser RESOURCE_DIGEST",
      "HTML metadata namespace rejected /privacy",
    ], name);
    const diagnosticText = messages.join("\n");
    assert.equal(diagnosticText.includes("outside.example"), false, name);
    assert.equal(diagnosticText.includes("Mōchirīx"), false, name);
  }
});

test("home Flight normalization binds the exact Spotlight graph and async terminal cohort", () => {
  const retained = resealHomeSpotlightFlightStream();
  const expected = canonicalizeProductionFlightResourceEnvelopeStream(retained, new Set());
  assert.notEqual(expected, null);
  assert.equal(
    canonicalizeProductionFlightResourceEnvelopeStream(retained, new Set(), null, null, true),
    expected,
  );

  const schedules = permutations([...resealHomeSpotlightRetainedOrder]);
  assert.equal(schedules.length, 120);
  const validSchedules = schedules.filter((order) => order.indexOf("26") < order.indexOf("23"));
  const invalidSchedules = schedules.filter((order) => order.indexOf("23") < order.indexOf("26"));
  assert.equal(validSchedules.length, 60);
  assert.equal(invalidSchedules.length, 60);
  for (const order of validSchedules) {
    const stream = resealHomeSpotlightFlightStream({
      order,
      title: "Lián 🌸",
    });
    assert.equal(
      canonicalizeProductionFlightResourceEnvelopeStream(stream, new Set(), null, null, true),
      expected,
    );
  }
  for (const order of invalidSchedules) {
    const stream = resealHomeSpotlightFlightStream({ order });
    assert.equal(
      canonicalizeProductionFlightResourceEnvelopeStream(stream, new Set(), null, null, true),
      null,
    );
  }

  for (const name of ["A", "山茶", "@member", "<member>", "A\\B", "A`B", "A".repeat(118) + "🌸"]) {
    const stream = resealHomeSpotlightFlightStream({ title: name });
    assert.equal(
      canonicalizeProductionFlightResourceEnvelopeStream(stream, new Set(), null, null, true),
      expected,
    );
  }

  const alternateSchedule = resealHomeSpotlightFlightStream({
    order: ["26", "23", "1f", "21", "24"],
    title: "Lián 🌸",
  });
  assert.notEqual(
    canonicalizeProductionFlightResourceEnvelopeStream(alternateSchedule, new Set()),
    expected,
  );
});

test("home Flight normalization rejects graph, title, cohort, and noncohort drift", () => {
  const retained = resealHomeSpotlightFlightStream();
  const expected = canonicalizeProductionFlightResourceEnvelopeStream(retained, new Set());
  assert.notEqual(expected, null);
  const normalize = (stream) => canonicalizeProductionFlightResourceEnvelopeStream(
    stream, new Set(), null, null, true,
  );
  const replaceRow = (stream, recordId, transform) => stream.split("\n").map((row) => {
    if (!row.startsWith(`${recordId}:`)) return row;
    return `${recordId}:${transform(row.slice(recordId.length + 1))}`;
  }).join("\n");

  const invalidTitles = [
    "",
    "A".repeat(121),
    " A",
    "A ",
    "A  B",
    "A\u00a0B",
    "A\nB",
    "A\u202eB",
    `A${String.fromCharCode(0xd800)}`,
  ];
  for (const title of invalidTitles) {
    assert.equal(normalize(resealHomeSpotlightFlightStream({ title })), null);
  }

  const duplicateAnchor = replaceRow(retained, "1b", (payload) => {
    const anchor = JSON.parse(payload);
    return JSON.stringify([anchor, anchor]);
  });
  const noncanonicalTitle = replaceRow(retained, "24", (payload) =>
    payload.replace("Member Spotlight", "Member\\u0020Spotlight"));
  const sharedTitleReference = replaceRow(retained, "d", (payload) => {
    const record = JSON.parse(payload);
    record[3].children.push("$L24");
    return JSON.stringify(record);
  });
  const targetAsImport = replaceRow(
    retained,
    "24",
    () => `I${JSON.stringify([1, [resealFlightVisiblePath], "Title"])}`,
  );
  const trailingFrame = retained + "25:\"trailing\"\n";
  const interveningTerminalFrame = retained.replace("24:", "25:\"intervening\"\n24:");
  const reorderedMetadata = replaceRow(retained, "23", (payload) =>
    JSON.stringify(JSON.parse(payload).reverse()));
  const deferredReturnAliases = ["d", "12", "13", "1b", "24", "1f", "21", "23", "26"]
    .map((recordId) => withReachableDeferredReturn(retained, recordId));
  const hostileStreams = [
    resealHomeSpotlightFlightStream({ anchorChildren: "$24" }),
    resealHomeSpotlightFlightStream({ anchorChildren: "$L25" }),
    resealHomeSpotlightFlightStream({ cardId: "spotlightTitle" }),
    resealHomeSpotlightFlightStream({ cardRole: "presentation" }),
    resealHomeSpotlightFlightStream({ importName: "OtherMark" }),
    resealHomeSpotlightFlightStream({ order: ["26", "24", "21", "1f"] }),
    resealHomeSpotlightFlightStream({ order: ["26", "24", "21", "1f", "1f"] }),
    duplicateAnchor,
    noncanonicalTitle,
    sharedTitleReference,
    targetAsImport,
    trailingFrame,
    interveningTerminalFrame,
    reorderedMetadata,
    retained.replace("$@1f", "$L1f"),
    retained.replace("$L21", "$L22"),
    retained.replace("$L23", "$L22"),
    retained.replace("$L26", "$L25"),
    ...deferredReturnAliases,
  ];
  for (const stream of hostileStreams) assert.equal(normalize(stream), null);

  for (const title of [
    "Synthetic Alpha",
    "Synthetic Beta",
  ]) {
    assert.equal(normalize(withReachableDeferredReturn(
      resealHomeSpotlightFlightStream({ title }), "24",
    )), null);
  }

  const titleReferenceAliases = [
    "$24:length",
    "$L24:ignored",
    "$@24:ignored",
    "$024",
    "$L024",
    "$@024",
    "$h24:ignored",
    "$Q24:ignored",
    "$W24:ignored",
    "$B24:ignored",
    "$K24:ignored",
    "$i24:ignored",
    "$0x24",
    "$L0x24",
    "$@0X24",
    "$+24",
    "$L+24",
    "$@+24",
    "$ 24",
    "$L 24",
    "$@ 24",
    "$24ignored",
    "$L24ignored",
    "$@24ignored",
  ];
  for (const reference of titleReferenceAliases) {
    for (const title of [
      "A",
      "Much Longer Name",
    ]) {
      assert.equal(normalize(withReachableFlightReference(
        resealHomeSpotlightFlightStream({ title }), reference,
      )), null);
    }
  }

  for (const field of ["c", "q", "m", "r", "s", "a", "l", "p", "d"]) {
    for (const title of [
      "A",
      "Much Longer Name",
    ]) {
      assert.equal(normalize(withRootFlightReference(
        resealHomeSpotlightFlightStream({ title }), field, "$24:length",
      )), null, field);
    }
  }

  for (const title of [
    "A",
    "Much Longer Name",
  ]) {
    assert.equal(normalize(withFlightImportReference(
      resealHomeSpotlightFlightStream({ title }), "$24:length",
    )), null);
  }

  for (const literal of ["$$24", "$S24", "$D24", "$n24"]) {
    const canonical = normalize(withReachableFlightReference(retained, literal));
    assert.notEqual(canonical, null);
    assert.notEqual(canonical, expected);
  }

  const decoyAlpha = retained.replace(
    "26:I", '25:"Synthetic Alpha"\n26:I',
  );
  const decoyBeta = retained.replace(
    "26:I", '25:"Synthetic Beta"\n26:I',
  );
  const normalizedDecoyAlpha = normalize(decoyAlpha);
  const normalizedDecoyBeta = normalize(decoyBeta);
  assert.notEqual(normalizedDecoyAlpha, null);
  assert.notEqual(normalizedDecoyBeta, null);
  assert.notEqual(normalizedDecoyAlpha, normalizedDecoyBeta);

  const prefixSemanticDrift = retained.replace('"stable"', '"changed"');
  const cohortSemanticDrift = replaceRow(retained, "21", (payload) => {
    const record = JSON.parse(payload);
    record[1][3].content = "width=device-width";
    return JSON.stringify(record);
  });
  const rows = retained.trimEnd().split("\n");
  const prefixOrderDrift = [rows[0], rows[2], rows[1], ...rows.slice(3)].join("\n") + "\n";
  for (const stream of [prefixSemanticDrift, cohortSemanticDrift, prefixOrderDrift]) {
    const canonical = normalize(stream);
    assert.notEqual(canonical, null);
    assert.notEqual(canonical, expected);
  }
  assert.equal(
    canonicalizeProductionFlightResourceEnvelopeStream(retained, new Set(), null, null, "home"),
    null,
  );
});

test("production Flight build identity is the only normalized root field", async () => {
  const alternateBuildId = "abcdefghijk0123456789";
  assert.equal(alternateBuildId.length, 21);
  const current = resealFixture({
    resourcePaths: new Set(["/events", "/gallery", "/join", "/privacy"]),
    responseHeaders: (url) => url.pathname === "/events" ? {
      link: [fontPreload("", "font-a"), fontPreload("", "font-b")].join(", "),
    } : {},
    bodyTransform(body, url, occurrence) {
      if (url.pathname !== "/privacy" || occurrence !== 2) return body;
      const mutated = body.replace(
        resealSafeFlightScript,
        resealFlightScript(resealFlightStream({ buildId: alternateBuildId })),
      );
      assert.notEqual(mutated, body);
      return mutated;
    },
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: current.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(current.calls.length, 16);
  assert(current.calls.every(({ options }) => options.redirect === "manual"));

  const wrapperEscaped = resealFlightPolicyFixture((body, url, occurrence) => {
    if (url.pathname !== "/privacy" || occurrence !== 2) return body;
    const escapedScript = resealSafeFlightScript.replace(
      "Mōchirīī",
      String.raw`M\u014Dchir\u012B\u012B`,
    );
    assert.notEqual(escapedScript, resealSafeFlightScript);
    return body.replace(resealSafeFlightScript, escapedScript);
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: wrapperEscaped.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(wrapperEscaped.calls.length, 16);
  assert(wrapperEscaped.calls.every(({ options }) => options.redirect === "manual"));

  const rootEscaped = resealFlightPolicyFixture((body, url, occurrence) => {
    if (url.pathname !== "/privacy" || occurrence !== 2) return body;
    const escapedRootStream = resealSafeFlightStream.replace(
      resealFlightBuildId,
      String.raw`\u0030123456789abcdefghijk`,
    );
    return body.replace(resealSafeFlightScript, resealFlightScript(escapedRootStream));
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: rootEscaped.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(rootEscaped.calls.length, 16);
  assert(rootEscaped.calls.every(({ options }) => options.redirect === "manual"));

  const resourceRebuilt = resealFlightPolicyFixture((body, url, occurrence) => {
    if (url.pathname !== "/privacy" || occurrence !== 2) return body;
    const rebuiltStream = resealFlightStream({
      fontPath: "/_next/static/media/noto_serif_sc_latin.p.3w1kw-jw7m3mi.woff2",
      hintStylePath: "/_next/static/chunks/3cfkfdpl5tlld.css",
      importPath: "/_next/static/chunks/10i858mih-457.js",
      scriptPath: "/_next/static/chunks/3ojsee-o9apn_.js",
      stylePath: "/_next/static/chunks/1edizae69s1-8.css",
    });
    return body.replace(resealSafeFlightScript, resealFlightScript(rebuiltStream));
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: resourceRebuilt.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(resourceRebuilt.calls.length, 16);
  assert(resourceRebuilt.calls.every(({ options }) => options.redirect === "manual"));
});

test("production resource envelopes reject malformed or ambiguous Flight roots", async () => {
  const rootLine = resealSafeFlightStream.slice(0, resealSafeFlightStream.indexOf("\n") + 1);
  const malformedStreams = [
    ["missing", resealSafeFlightStream.slice(rootLine.length)],
    ["duplicate", rootLine + resealSafeFlightStream],
    ["reordered", resealSafeFlightStream.replace(
      '0:{"P":null,"c":[]',
      '0:{"c":[],"P":null',
    )],
    ["non-final-build", resealSafeFlightStream.replace(
      `"d":"${resealFlightSemanticToken}","b":"${resealFlightBuildId}"}`,
      `"b":"${resealFlightBuildId}","d":"${resealFlightSemanticToken}"}`,
    )],
    ["short-build", resealFlightStream({ buildId: "too-short" })],
    ["invalid-build", resealFlightStream({ buildId: "0123456789abcdefghij." })],
  ];
  for (const [name, stream] of malformedStreams) {
    const current = resealFixture({
      resourcePaths: new Set(["/privacy"]),
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/privacy" || occurrence !== 2) return body;
        const mutated = body.replace(resealSafeFlightScript, resealFlightScript(stream));
        assert.notEqual(mutated, body);
        return mutated;
      },
    });
    const messages = [];
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      diagnose: true,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
      reportDiagnostic: (message) => messages.push(message),
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
    assert.equal(current.calls.length, 13, name);
    assert(current.calls.every(({ options }) => options.redirect === "manual"), name);
    assert.equal(messages.length, 15, name);
    assert.deepEqual(messages.slice(-2), [
      "HTML namespace parser PAYLOAD_MODEL",
      "HTML metadata namespace rejected /privacy",
    ], name);
    assert.equal(messages.join("\n").includes(stream), false, name);
  }
});

test("production Flight row identities are canonical, unique, bounded, and supported", async () => {
  const alternateRootLine = resealFlightStream({
    buildId: "abcdefghijklmnopqrstu",
  }).split("\n")[0];
  const alternateRootPayload = alternateRootLine.slice(alternateRootLine.indexOf(":") + 1);
  const duplicateModelLine = resealSafeFlightStream.split("\n").find((line) => line.startsWith("2:"));
  assert(duplicateModelLine);
  const cases = [
    ["leading-zero-root", (stream) => stream + `00:${alternateRootPayload}\n`],
    ["empty-root", (stream) => stream + `:${alternateRootPayload}\n`],
    ["overflow-root", (stream) => stream + `100000000:${alternateRootPayload}\n`],
    ["duplicate-model", (stream) => stream + duplicateModelLine + "\n"],
    ["close-without-open", (stream) => stream + "6:C\n"],
    ["duplicate-open", (stream) => stream + "6:X\n6:X\n"],
    ["missing-close", (stream) => stream + "6:X\n"],
    ["closed-model-collision", (stream) => stream + "6:X\n6:C\n6:null\n"],
    ["model-open-collision", (stream) => stream + "6:null\n6:X\n"],
    ["duplicate-close", (stream) => stream + "6:X\n6:C\n6:C\n"],
    ["unresolved-forward-close-reference", (stream) => stream + '6:X\n6:C"$7"\n'],
    ["self-close-reference", (stream) => stream + '6:X\n6:C"$6"\n'],
    ["short-text-frame", (stream) => stream + "6:x\n6:T5,safe6:C\n"],
    ["unsupported-tag", (stream) => stream + '6:E{"digest":"semantic row"}\n'],
  ];
  for (const [name, mutate] of cases) {
    const current = resealFixture({
      resourcePaths: new Set(["/events"]),
      bodyTransform(body, url) {
        if (url.pathname !== "/events") return body;
        return transformResealFlightStream(body, (stream) => {
          const mutated = mutate(stream);
          assert.notEqual(mutated, stream, name);
          return mutated;
        });
      },
    });
    const messages = [];
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      diagnose: true,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
      reportDiagnostic: (message) => messages.push(message),
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
    assert.equal(current.calls.length, 5, name);
    assert(current.calls.every(({ options }) => options.redirect === "manual"), name);
    assert.deepEqual(messages.slice(-2), [
      "HTML namespace parser PAYLOAD_MODEL",
      "HTML namespace rejected /events",
    ], name);
    const diagnostics = messages.join("\n");
    assert.equal(diagnostics.includes(alternateRootPayload), false, name);
    assert.equal(diagnostics.includes("semantic row"), false, name);
  }
});

test("production Flight parser accepts reviewed intrinsics, primitives, and deferred lifecycle", () => {
  const reviewedNode = ["$", "div", "copy", { children: [
    ["$", "link", null, {
      rel: "canonical",
      href: "https://mochirii.com/games/mochi-pets",
    }],
    ["$", "a", null, {
      href: "/events",
      target: "$undefined",
      rel: "$undefined",
      children: "Events",
    }],
    ["$", "img", null, {
      id: "recruitmentAtmosphere",
      src: "/assets/img/recruitment/atmosphere.webp",
      alt: "",
      className: "page-hero__atmos",
      decoding: "async",
      "aria-hidden": "true",
    }],
  ] }];
  const stream = resealFlightStream({ node: reviewedNode })
    + '6:"$Sreact.fragment"\n'
    + "7:null\n"
    + "8:true\n"
    + "9:42\n"
    + "a:x\n"
    + "a:T4,safe"
    + 'b:"returned"\n'
    + 'a:C"$b"\n'
    + "c:X\n"
    + 'c:{"safe":true}\n'
    + 'd:"returned"\n'
    + 'c:C"$d"\n';
  const buildIds = new Set();
  const resourceUrls = [];
  const canonical = canonicalizeProductionFlightResourceEnvelopeStream(
    stream,
    buildIds,
    resourceUrls,
    new URL("https://preview.example/games/mochi-pets"),
  );
  assert.equal(typeof canonical, "string");
  assert(canonical.includes(
    '6:"$Sreact.fragment"\n7:null\n8:true\n9:42\na:x\na:T4,safeb:"returned"\n'
      + 'a:C"$b"\nc:X\nc:{"safe":true}\nd:"returned"\nc:C"$d"\n',
  ));
  assert.deepEqual([...buildIds], [""]);
  assert.equal(resourceUrls.length, 8);
  assert(resourceUrls.every((value) => typeof value === "string" && value.length > 0));
});

test("production Flight parser accepts pinned Next iterable frames", () => {
  const probe = String.raw`
const rsc = require("./apps/web/node_modules/next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js");
async function* selfIterating() { yield "safe"; return "lower-return"; }
let step = 0;
const iterator = {
  next() {
    step += 1;
    return Promise.resolve(step === 1
      ? { done: false, value: { safe: true } }
      : { done: true, value: "upper-return" });
  },
  [Symbol.asyncIterator]() { return this; },
};
const iterable = { [Symbol.asyncIterator]() { return iterator; } };
let delayedReady = false;
let releaseDelayed;
const delayedWakeable = new Promise((resolve) => { releaseDelayed = resolve; });
const delayedReturn = {};
Object.defineProperty(delayedReturn, "delayed", {
  enumerable: true,
  get() { if (!delayedReady) throw delayedWakeable; return "later"; },
});
let delayedStep = 0;
const delayedIterator = {
  next() {
    delayedStep += 1;
    if (delayedStep === 1) return Promise.resolve({ done: false, value: "first" });
    setImmediate(() => { delayedReady = true; releaseDelayed(); });
    return Promise.resolve({ done: true, value: delayedReturn });
  },
  [Symbol.asyncIterator]() { return this; },
};
const delayedIterable = { [Symbol.asyncIterator]() { return delayedIterator; } };
const model = {
  P: null, c: [], q: "", i: false,
  f: [selfIterating(), iterable, delayedIterable], m: "fixture", G: [],
  S: false, h: null, r: "", s: "", a: "", l: "", p: "", d: "zyxwvutsrqponmlkjihgf",
  b: "0123456789abcdefghijk",
};
(async () => {
  const stream = await rsc.renderToReadableStream(model, {});
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  process.stdout.write(Buffer.concat(chunks).toString("base64"));
})().catch(() => process.exit(1));
`;
  const child = spawnSync(nodeExecutable, ["--conditions", "react-server", "-e", probe], {
    cwd: root,
    encoding: "utf8",
    env: {},
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, "");
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(child.stdout));
  const emitted = Buffer.from(child.stdout, "base64").toString("utf8");
  assert.match(emitted, /^[0-9a-f]+:x$/m);
  assert.match(emitted, /^[0-9a-f]+:X$/m);
  assert.match(emitted, /[0-9a-f]+:T4,safe/);
  assert.match(emitted, /^[0-9a-f]+:\{"safe":true\}$/m);
  assert.match(emitted, /^[0-9a-f]+:C"\$[0-9a-f]+"$/m);
  const delayedRow = emitted.match(/^([0-9a-f]+):\{"delayed":"later"\}$/m);
  assert(delayedRow);
  const delayedClose = emitted.indexOf(`C"$${delayedRow[1]}"`);
  assert(delayedClose >= 0);
  assert(delayedClose < delayedRow.index);
  assert.equal(
    typeof canonicalizeProductionFlightResourceEnvelopeStream(
      emitted,
      new Set(),
      [],
      new URL("https://preview.example/"),
    ),
    "string",
  );
});

test("pinned Next emits stable IDs with async settlement order variance", () => {
  const probe = String.raw`
const React = require("./apps/web/node_modules/react");
const rsc = require("./apps/web/node_modules/next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js");

async function render(order, winnerName) {
  let releaseWinner;
  let releaseOther;
  const winnerGate = new Promise((resolve) => { releaseWinner = resolve; });
  const otherGate = new Promise((resolve) => { releaseOther = resolve; });

  async function SpotlightWinnerTitle() {
    await winnerGate;
    return React.createElement(
      React.Fragment,
      null,
      winnerName,
    );
  }

  async function OtherSettlement() {
    await otherGate;
    return React.createElement("em", null, "fixed-other");
  }

  const plate = React.createElement(
    "div",
    { className: "home-spotlight__plate" },
    React.createElement("span", { id: "spotlightTag", className: "home-pill" }, "Spotlight"),
    React.createElement(
      "h3",
      { id: "spotlightTitle", className: "home-title" },
      React.createElement(SpotlightWinnerTitle),
    ),
    React.createElement(
      "p",
      { id: "spotlightSummary", className: "home-summary" },
      "For support & a pretty amazing spark.",
    ),
    React.createElement(
      "span",
      { className: "home-link", "aria-hidden": "true" },
      "Spotlight Appreciation",
    ),
  );

  const anchoredSection = React.createElement(
    "section",
    {
      className: "glass-card glass-card--primary glass-pad u-mt-24",
      "aria-label": "Member spotlight",
    },
    React.createElement(
      "div",
      { id: "spotlightCard", className: "home-spotlight", role: "group" },
      plate,
    ),
  );

  const model = {
    P: null,
    c: [],
    q: "",
    i: false,
    f: [
      anchoredSection,
      React.createElement("div", null, React.createElement(OtherSettlement)),
    ],
    m: "fixture",
    G: [],
    S: false,
    h: null,
    r: "",
    s: "",
    a: "",
    l: "",
    p: "",
    d: "zyxwvutsrqponmlkjihgf",
    b: "0123456789abcdefghijk",
  };

  const stream = await rsc.renderToReadableStream(model, {});
  setImmediate(() => {
    const first = order === "winner-first" ? releaseWinner : releaseOther;
    const second = order === "winner-first" ? releaseOther : releaseWinner;
    first();
    setImmediate(second);
  });

  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("base64");
}

(async () => {
  const winnerFirst = await render("winner-first", "Synthetic Alpha");
  const otherFirst = await render("other-first", "Synthetic Beta");
  process.stdout.write(JSON.stringify({ winnerFirst, otherFirst }));
})().catch(() => process.exit(1));
`;
  const child = spawnSync(nodeExecutable, ["--conditions", "react-server", "-e", probe], {
    cwd: root,
    encoding: "utf8",
    env: {},
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, "");
  const encoded = JSON.parse(child.stdout);
  const winnerFirst = Buffer.from(encoded.winnerFirst, "base64").toString("utf8");
  const otherFirst = Buffer.from(encoded.otherFirst, "base64").toString("utf8");
  const rowIds = (stream) => stream.trimEnd().split("\n").map(
    (row) => row.slice(0, row.indexOf(":")),
  );
  assert.deepEqual(rowIds(winnerFirst), ["0", "1", "2"]);
  assert.deepEqual(rowIds(otherFirst), ["0", "2", "1"]);
  assert.match(winnerFirst, /"children":"\$L1"/);
  assert.match(otherFirst, /"children":"\$L1"/);
  assert.match(winnerFirst, /^1:"Synthetic Alpha"$/m);
  assert.match(otherFirst, /^1:"Synthetic Beta"$/m);
  assert.match(winnerFirst, /^2:\["\$","em",null,\{"children":"fixed-other"\}\]$/m);
  assert.match(otherFirst, /^2:\["\$","em",null,\{"children":"fixed-other"\}\]$/m);
});

test("pinned Next emits client imports before their referring regular rows", () => {
  const probe = String.raw`
const React = require("./apps/web/node_modules/react");
const rsc = require("./apps/web/node_modules/next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js");
const IconMark = rsc.registerClientReference(
  function IconMark() {},
  "fixture-icon",
  "IconMark",
);

async function render(order) {
  let releaseClient;
  let releaseOther;
  const clientGate = new Promise((resolve) => { releaseClient = resolve; });
  const otherGate = new Promise((resolve) => { releaseOther = resolve; });

  async function ClientTask() {
    await clientGate;
    return React.createElement(IconMark, { label: "icon" });
  }
  async function OtherTask() {
    await otherGate;
    return React.createElement("em", null, "other");
  }

  const stream = rsc.renderToReadableStream(
    [React.createElement(ClientTask), React.createElement(OtherTask)],
    {
      "fixture-icon#IconMark": {
        id: 60329,
        chunks: ["/_next/static/chunks/icon.js"],
        name: "IconMark",
      },
    },
  );
  setImmediate(() => {
    const first = order === "client-first" ? releaseClient : releaseOther;
    const second = order === "client-first" ? releaseOther : releaseClient;
    first();
    setImmediate(second);
  });

  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("base64");
}

(async () => {
  process.stdout.write(JSON.stringify({
    clientFirst: await render("client-first"),
    otherFirst: await render("other-first"),
  }));
})().catch(() => process.exit(1));
`;
  const child = spawnSync(nodeExecutable, ["--conditions", "react-server", "-e", probe], {
    cwd: root,
    encoding: "utf8",
    env: {},
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, "");

  const encoded = JSON.parse(child.stdout);
  const lines = (value) => Buffer.from(value, "base64").toString("utf8").trimEnd().split("\n");
  const clientFirst = lines(encoded.clientFirst);
  const otherFirst = lines(encoded.otherFirst);
  const rowIds = (rows) => rows.map((row) => row.slice(0, row.indexOf(":")));

  assert.deepEqual(rowIds(clientFirst), ["0", "3", "1", "2"]);
  assert.deepEqual(rowIds(otherFirst), ["0", "3", "2", "1"]);
  for (const rows of [clientFirst, otherFirst]) {
    const importIndex = rows.indexOf(
      '3:I[60329,["/_next/static/chunks/icon.js"],"IconMark"]',
    );
    const parentIndex = rows.indexOf(
      '1:["$","$L3",null,{"label":"icon"}]',
    );
    assert(importIndex >= 0);
    assert(parentIndex >= 0);
    assert(importIndex < parentIndex);
  }
});

test("production Flight intrinsic resources reject active unreviewed browser surfaces", async () => {
  const sentinel = "MOCHIRII_FLIGHT_INTRINSIC_SENTINEL";
  const cases = [
    [
      "mixed-image",
      ["$", "img", "copy", {
        src: `/_next/static/build_b/media/${sentinel}.webp`,
        alt: "",
      }],
      "HTML namespace parser MIXED_NAMESPACE",
    ],
    [
      "iframe",
      ["$", "iframe", "copy", { src: `https://outside.example/${sentinel}` }],
      "HTML namespace parser PAYLOAD_MODEL",
    ],
    [
      "mixed-case-iframe",
      ["$", "IFRAME", "copy", { src: `https://outside.example/${sentinel}` }],
      "HTML namespace parser PAYLOAD_MODEL",
    ],
    [
      "inline-script",
      ["$", "script", "copy", { children: sentinel }],
      "HTML namespace parser PAYLOAD_MODEL",
    ],
    [
      "non-object-jsonld",
      ["$", "script", "copy", {
        dangerouslySetInnerHTML: { __html: JSON.stringify(sentinel) },
        type: "application/ld+json",
      }],
      "HTML namespace parser PAYLOAD_MODEL",
    ],
    [
      "style",
      ["$", "style", "copy", { children: `body{background:url(${sentinel})}` }],
      "HTML namespace parser PAYLOAD_MODEL",
    ],
    [
      "image-event-handler",
      ["$", "img", "copy", {
        src: "/assets/img/recruitment/atmosphere.webp",
        alt: "",
        onError: sentinel,
      }],
      "HTML namespace parser PAYLOAD_MODEL",
    ],
    [
      "generic-style",
      ["$", "div", "copy", { style: { background: `url(${sentinel})` } }],
      "HTML namespace parser PAYLOAD_MODEL",
    ],
    [
      "active-anchor",
      ["$", "a", "copy", { href: `javascript:${sentinel}`, children: "copy" }],
      "HTML namespace parser PAYLOAD_MODEL",
    ],
  ];
  for (const [name, node, category] of cases) {
    const current = resealFixture({
      resourcePaths: new Set(["/events"]),
      bodyTransform(body, url) {
        if (url.pathname !== "/events") return body;
        return body.replace(
          resealSafeFlightScript,
          resealFlightScript(resealFlightStream({ node })),
        );
      },
    });
    const messages = [];
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      diagnose: true,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
      reportDiagnostic: (message) => messages.push(message),
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
    assert.equal(current.calls.length, 5, name);
    assert(current.calls.every(({ options }) => options.redirect === "manual"), name);
    assert.deepEqual(messages.slice(-2), [category, "HTML namespace rejected /events"], name);
    const diagnostics = messages.join("\n");
    assert.equal(diagnostics.includes(sentinel), false, name);
    assert.equal(diagnostics.includes("outside.example"), false, name);
    assert.equal(diagnostics.includes("javascript:"), false, name);
  }
});

test("production Flight row framing requires one terminal LF and no blank rows", async () => {
  const cases = [
    ["leading-blank", (stream) => "\n" + stream],
    ["interior-blank", (stream) => stream.replace("\n5:I", "\n\n5:I")],
    ["repeated-terminal", (stream) => stream + "\n"],
    ["unterminated-final", (stream) => stream.slice(0, -1)],
  ];
  for (const [name, mutate] of cases) {
    const current = resealFixture({
      resourcePaths: new Set(["/events"]),
      bodyTransform(body, url) {
        if (url.pathname !== "/events") return body;
        return transformResealFlightStream(body, (stream) => {
          const mutated = mutate(stream);
          assert.notEqual(mutated, stream, name);
          return mutated;
        });
      },
    });
    const messages = [];
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      diagnose: true,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
      reportDiagnostic: (message) => messages.push(message),
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
    assert.equal(current.calls.length, 5, name);
    assert(current.calls.every(({ options }) => options.redirect === "manual"), name);
    assert.deepEqual(messages.slice(-2), [
      "HTML namespace parser PAYLOAD_MODEL",
      "HTML namespace rejected /events",
    ], name);
    assert.equal(messages.join("\n").includes(name), false, name);
  }
});

test("production namespace keeps the canonical origin immutable across a deferred audio base", async () => {
  for (const namespacePath of [
    "/_next/ignored/../static/build_b/media/evil.webp",
    "/%255fnext/%2573tatic/build_b/media/evil.webp",
  ]) {
    const current = resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/recruitment" || occurrence !== 1) return body;
        const disguisedMixedNamespace = `${url.origin}${namespacePath}`;
        return body.replace(
          "Audio fallback.</audio>",
          `<base href="https://outside.example/">fallback</audio><img src="${disguisedMixedNamespace}">`,
        );
      },
    });
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
    }), { message: "HTML_DOCUMENT_REJECTED" });
  }
});

test("production namespace accepts encoded active URLs only when they retain the active build", async () => {
  const current = resealFixture({
    buildId: "build_a",
    bodyTransform(body, url) {
      if (url.pathname !== "/events") return body;
      return body.replace(
        "<main>",
        `<main><img src="/%5fnext/static/build_a/media/allowed.webp">`,
      ).replace(
        resealFlightVisiblePath,
        "/%255fnext/%2573tatic/build_a/chunks/allowed.js",
      );
    },
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: current.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(current.calls.length, 16);
});

test("production namespace rejects a mixed build in every structural Flight resource slot", async () => {
  const cases = [
    ["import", "/_next/static/build_a/chunks/1y9qnyvp65ool.js"],
    ["style-hint", "/_next/static/build_a/chunks/1edizae69s1-8.css"],
    ["font-hint", "/_next/static/build_a/media/noto_serif_sc_latin.p.2xkduggpvd1-n.woff2"],
    ["root-link", "/_next/static/build_a/chunks/3u3ip5izc6gmi.css"],
    ["script", "/_next/static/build_a/chunks/0_kqt9b7hwk8z.js"],
  ];
  for (const [name, activePath] of cases) {
    const current = resealFixture({
      buildId: "build_a",
      resourcePaths: new Set(["/events"]),
      bodyTransform(body, url) {
        if (url.pathname !== "/events") return body;
        const mutated = body.replace(activePath, activePath.replace("/build_a/", "/build_b/"));
        assert.notEqual(mutated, body);
        return mutated;
      },
    });
    const messages = [];
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      diagnose: true,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
      reportDiagnostic: (message) => messages.push(message),
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
    assert.equal(current.calls.length, 5, name);
    assert(current.calls.every(({ options }) => options.redirect === "manual"), name);
    assert.deepEqual(messages.slice(-2), [
      "HTML namespace parser MIXED_NAMESPACE",
      "HTML namespace rejected /events",
    ], name);
    const diagnostics = messages.join("\n");
    assert.equal(diagnostics.includes("build_b"), false, name);
    assert.equal(diagnostics.includes(activePath), false, name);
  }
});

test("production namespace recognizes semantic resource properties and the supported image hint", async () => {
  const rootLinkPath = "/_next/static/build_a/chunks/3u3ip5izc6gmi.css";
  const scriptPath = "/_next/static/build_a/chunks/0_kqt9b7hwk8z.js";
  const current = resealFixture({
    buildId: "build_a",
    resourcePaths: new Set(["/events"]),
    bodyTransform(body, url) {
      if (url.pathname !== "/events") return body;
      return transformResealFlightStream(body, (stream) => {
        const replacements = [
          [
            JSON.stringify({
              rel: "stylesheet", href: rootLinkPath, precedence: "next",
              crossOrigin: "$undefined", nonce: "$undefined",
            }),
            JSON.stringify({
              nonce: "$undefined", href: rootLinkPath, rel: "stylesheet",
              crossOrigin: "$undefined", precedence: "next",
            }),
          ],
          [
            JSON.stringify({ src: scriptPath, async: true, nonce: "$undefined" }),
            JSON.stringify({ nonce: "$undefined", src: scriptPath, async: true }),
          ],
          [
            JSON.stringify({ crossOrigin: "", type: "font/woff2" }),
            JSON.stringify({ type: "font/woff2", crossOrigin: "" }),
          ],
          [
            "\n1:",
            `\n:HL${JSON.stringify(["/assets/img/recruitment/atmosphere.webp", "image"])}\n1:`,
          ],
        ];
        let transformed = stream;
        for (const [before, after] of replacements) {
          const next = transformed.replace(before, after);
          assert.notEqual(next, transformed);
          transformed = next;
        }
        return transformed;
      });
    },
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: current.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(current.calls.length, 16);
  assert(current.calls.every(({ options }) => options.redirect === "manual"));
});

test("production Flight image hints stay on the exact bounded public asset surface", async () => {
  const imageHint = (value) => `:HL${JSON.stringify([value, "image"])}\n`;
  const resolvedOverbound = "/assets/"
    + "a".repeat(PRODUCTION_CHECK_LIMITS.assetUrlCharacters - "/assets/".length - ".webp".length)
    + ".webp";
  assert.equal(resolvedOverbound.length, PRODUCTION_CHECK_LIMITS.assetUrlCharacters);
  const cases = [
    ["off-origin", "https://outside.example/harvest.webp"],
    ["non-http", "data:image/webp;base64,U0VOVElORUw="],
    ["query", "/assets/img/recruitment/atmosphere.webp?token=IMAGE_QUERY_SENTINEL"],
    ["fragment", "/assets/img/recruitment/atmosphere.webp#IMAGE_FRAGMENT_SENTINEL"],
    ["wrong-shape", "/assets/img/recruitment/atmosphere.png"],
    ["resolved-overbound", resolvedOverbound],
  ];
  for (const [name, value] of cases) {
    const current = resealFixture({
      resourcePaths: new Set(["/events"]),
      bodyTransform(body, url) {
        if (url.pathname !== "/events") return body;
        return transformResealFlightStream(body, (stream) => {
          const mutated = stream.replace("\n1:", `\n${imageHint(value)}1:`);
          assert.notEqual(mutated, stream, name);
          return mutated;
        });
      },
    });
    const messages = [];
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      diagnose: true,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
      reportDiagnostic: (message) => messages.push(message),
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
    assert.equal(current.calls.length, 5, name);
    assert(current.calls.every(({ options }) => options.redirect === "manual"), name);
    assert.deepEqual(messages.slice(-2), [
      "HTML namespace parser PAYLOAD_MODEL",
      "HTML namespace rejected /events",
    ], name);
    const diagnostics = messages.join("\n");
    assert.equal(diagnostics.includes("outside.example"), false, name);
    assert.equal(diagnostics.includes("IMAGE_QUERY_SENTINEL"), false, name);
    assert.equal(diagnostics.includes("IMAGE_FRAGMENT_SENTINEL"), false, name);
    assert.equal(diagnostics.includes(value), false, name);
  }
});

test("production namespace rejects active Flight resource near-matches and unknown hints", async () => {
  const rootLinkPath = "/_next/static/build_a/chunks/3u3ip5izc6gmi.css";
  const foreignLinkPath = "/_next/static/build_b/chunks/mixed-slot-sentinel.css";
  const scriptPath = "/_next/static/build_a/chunks/0_kqt9b7hwk8z.js";
  const foreignScriptPath = "/_next/static/build_b/chunks/mixed-slot-sentinel.js";
  const fontPath = "/_next/static/build_a/media/noto_serif_sc_latin.p.2xkduggpvd1-n.woff2";
  const foreignFontPath = "/_next/static/build_b/media/mixed-slot-sentinel.woff2";
  const styleHintPath = "/_next/static/build_a/chunks/1edizae69s1-8.css";
  const linkProperties = JSON.stringify({
    rel: "stylesheet", href: rootLinkPath, precedence: "next",
    crossOrigin: "$undefined", nonce: "$undefined",
  });
  const scriptProperties = JSON.stringify({
    src: scriptPath, async: true, nonce: "$undefined",
  });
  const fontHint = `:HL${JSON.stringify([
    fontPath, "font", { crossOrigin: "", type: "font/woff2" },
  ])}\n`;
  const styleHint = `:HL${JSON.stringify([styleHintPath, "style"])}\n`;
  const cases = [
    ["link-reordered", "MIXED_NAMESPACE", (stream) => stream.replace(
      linkProperties,
      JSON.stringify({
        nonce: "$undefined", href: foreignLinkPath, rel: "stylesheet",
        crossOrigin: "$undefined", precedence: "next",
      }),
    )],
    ["link-extra", "PAYLOAD_MODEL", (stream) => stream.replace(
      linkProperties,
      JSON.stringify({
        rel: "stylesheet", href: foreignLinkPath, precedence: "next",
        crossOrigin: "$undefined", nonce: "$undefined", integrity: "hostile",
      }),
    )],
    ["link-missing", "PAYLOAD_MODEL", (stream) => stream.replace(
      linkProperties,
      JSON.stringify({
        rel: "stylesheet", href: foreignLinkPath, precedence: "next",
        crossOrigin: "$undefined",
      }),
    )],
    ["script-reordered", "MIXED_NAMESPACE", (stream) => stream.replace(
      scriptProperties,
      JSON.stringify({ nonce: "$undefined", src: foreignScriptPath, async: true }),
    )],
    ["script-extra", "PAYLOAD_MODEL", (stream) => stream.replace(
      scriptProperties,
      JSON.stringify({
        src: foreignScriptPath, async: true, nonce: "$undefined", integrity: "hostile",
      }),
    )],
    ["script-missing", "PAYLOAD_MODEL", (stream) => stream.replace(
      scriptProperties,
      JSON.stringify({ src: foreignScriptPath, async: true }),
    )],
    ["hint-unknown", "PAYLOAD_MODEL", (stream) => stream.replace(
      styleHint,
      `:HL${JSON.stringify([foreignScriptPath, "script"])}\n`,
    )],
    ["hint-reordered", "PAYLOAD_MODEL", (stream) => stream.replace(
      styleHint,
      `:HL${JSON.stringify(["style", foreignLinkPath])}\n`,
    )],
    ["font-options-reordered", "MIXED_NAMESPACE", (stream) => stream.replace(
      fontHint,
      `:HL${JSON.stringify([
        foreignFontPath, "font", { type: "font/woff2", crossOrigin: "" },
      ])}\n`,
    )],
    ["font-options-extra", "PAYLOAD_MODEL", (stream) => stream.replace(
      fontHint,
      `:HL${JSON.stringify([
        foreignFontPath, "font", { crossOrigin: "", type: "font/woff2", as: "font" },
      ])}\n`,
    )],
  ];
  for (const [name, category, transform] of cases) {
    const current = resealFixture({
      buildId: "build_a",
      resourcePaths: new Set(["/events"]),
      bodyTransform(body, url) {
        return url.pathname === "/events"
          ? transformResealFlightStream(body, transform) : body;
      },
    });
    const messages = [];
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      diagnose: true,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
      reportDiagnostic: (message) => messages.push(message),
    }), { message: "HTML_DOCUMENT_REJECTED" }, name);
    assert.equal(current.calls.length, 5, name);
    assert(current.calls.every(({ options }) => options.redirect === "manual"), name);
    assert.deepEqual(messages.slice(-2), [
      `HTML namespace parser ${category}`,
      "HTML namespace rejected /events",
    ], name);
    const diagnostics = messages.join("\n");
    assert.equal(diagnostics.includes("build_b"), false, name);
    assert.equal(diagnostics.includes("mixed-slot-sentinel"), false, name);
  }
});

test("production checker rejects publication-envelope drift", async () => {
  const driftFixtures = [
    resealFixture({ buildId: "build_a", scriptBuildId: "build_b" }),
    resealFixture({ buildId: "bad.id" }),
    resealFixture({
      buildId: "build_a",
      buildIdForPath: (pathname) => pathname === "/privacy" ? "build_b" : "build_a",
      resourcePaths: new Set(["/privacy"]),
    }),
    resealFixture({
      buildId: "build_a",
      buildIdForPath: (pathname) => pathname === "/privacy" ? "" : "build_a",
      resourcePaths: new Set(["/privacy"]),
    }),
    ...["/gallery", "/join", "/events"].map((driftPath) => resealFixture({
      buildId: "build_a",
      buildIdForPath: (pathname) => pathname === driftPath ? "build_b" : "build_a",
      resourcePaths: new Set([driftPath]),
    })),
    resealFixture({
      buildId: "build_a",
      buildIdForPath: (pathname, occurrence) => pathname === "/" && occurrence === 1
        ? "build_b" : "build_a",
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/" || occurrence !== 1) return body;
        const scopedHead = resealStaticResources.head.replaceAll(
          "/_next/static/", "/_next/static/build_a/",
        );
        const scopedBody = '<script async="" src="/_next/static/chunks/3nk76snv1e0rj.js"></script>'.replaceAll(
          "/_next/static/", "/_next/static/build_a/",
        );
        return body.replace(scopedHead, "").replace(scopedBody, "");
      },
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "</head>",
          String.raw`<style>@font-face{src:url(\2f _next/static/build_b/media/evil.woff2)}</style></head>`,
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "<main>",
          String.raw`<main style="background-image:url(\2f _next/static/build_b/media/evil.webp)">`,
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url) {
        if (url.pathname !== "/events") return body;
        const payload = JSON.stringify([
          1, "/_next/static/build_b/chunks/evil.js",
        ]).replaceAll("/", "\\/");
        return body.replace("</body>", `<script>self.__next_f.push(${payload})</script></body>`);
      },
    }),
    ...[
      "_next/static/build_b/chunks/evil.js",
      "/_next/ignored/../static/build_b/chunks/evil.js",
      "/_next/%73tatic/build_b/chunks/evil.js",
      "/%5fnext/static/build_b/chunks/evil.js",
      "/%255fnext/%2573tatic/build_b/chunks/evil.js",
      String.raw`/%5cx5fnext/static/build_b/chunks/evil.js`,
      String.raw`\_next\static\build_b\chunks\evil.js`,
      "_ne\nxt/static/build_b/chunks/evil.js",
      "/_ne\rxt/static/build_b/chunks/evil.js",
      String.raw`\_ne` + "\t" + String.raw`xt\static\build_b\chunks\evil.js`,
      'x:{"dangerouslySetInnerHTML":{"__html":"<img src=&#95;next/static/build_b/media/evil.webp>"}}',
      'x:{"dangerouslySetInnerHTML":{"__html":"&#60;img src=&#47;&#95;next&#47;static&#47;build_b&#47;media&#47;evil.webp&#62;"}}',
      'x:{"dangerouslySetInnerHTML":{"__html":"&#x3c;img src=ordinary.webp&#x3e;"}}',
      'x:{"dangerouslySetInnerHTML":{"__html":"<meta http-equiv=refresh content=0;url=https://outside.example/>"}}',
      'x:["$","meta",null,{"httpEquiv":"refresh","content":"0;url=https://outside.example/"}]',
      'x:["$","base",null,{"href":"/_next/"}]\ny:["$","img",null,{"src":"static/build_b/media/evil.webp"}]',
      '1:"base"\n0:[["$","$1",null,{"href":"/_next/"}],["$","img",null,{"src":"static/build_b/media/evil.webp"}]]\n',
      'x:["$","iframe",null,{"srcDoc":"<img src=&#47;&#95;next/static/build_b/media/evil.webp>"}]',
      String.raw`x:{"style":{"backgroundImage":"url(\5f next/static/build_b/media/evil.webp)"}}`,
    ].map((flightPath) => resealFixture({
      buildId: "build_a",
      bodyTransform(body, url) {
        if (url.pathname !== "/events") return body;
        const payload = JSON.stringify([1, flightPath]);
        return body.replace("</body>", `<script>self.__next_f.push(${payload})</script></body>`);
      },
    })),
    ...[
      ['x:"/_ne', 'xt/static/build_b/chunks/evil.js"\n'],
      ['x:["$","meta",null,{"http', 'Equiv":"refresh","content":"0;url=https://outside.example/"}]\n'],
      ['x:["$","iframe",null,{"src', 'Doc":"<img src=ordinary.webp>"}]\n'],
      ['x:{"dangerouslySetInner', 'HTML":{"__html":"<img src=ordinary.webp>"}}\n'],
      ['x:["$","ba', 'se",null,{"href":"/_next/"}]\n'],
      ["x:{\"style\":{\"backgroundImage\":\"url(\\", '5f next/static/build_b/media/evil.webp)"}}'],
      ['x:"/%255fne', 'xt/%2573tatic/build_b/chunks/evil.js"\n'],
    ].map(([firstChunk, secondChunk]) => resealFixture({
      buildId: "build_a",
      bodyTransform(body, url) {
        if (url.pathname !== "/events") return body;
        const bootstrap = "(self.__next_f=self.__next_f||[]).push([0])";
        const firstPayload = JSON.stringify([1, firstChunk]);
        const secondPayload = JSON.stringify([1, secondChunk]);
        return body.replace(
          "</body>",
          `<script>${bootstrap}</script><script>self.__next_f.push(${firstPayload})</script><script>self.__next_f.push(${secondPayload})</script></body>`,
        );
      },
    })),
    ...[
      "0;url=_next/static/build_b/chunks/evil.js",
      "0;url=https://outside.example/harvest",
    ].map((content) => resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "</head>",
          `<meta http-equiv="refresh" content="${content}"></head>`,
        ) : body,
    })),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "<main>",
          '<audio><source src="_next/static/build_b/media/evil.mp3" type="audio/mpeg"></audio><main>',
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "<main>",
          '<audio><track src="_next/static/build_b/media/evil.vtt"></audio><main>',
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/recruitment" || occurrence !== 1) return body;
        return body.replace(
          "Audio fallback.</audio>",
          '<base href="/_next/">fallback</audio><img src="static/build_b/media/evil.webp">',
        );
      },
    }),
    ...[
      "/_next/%73tatic/build_b/media/evil.webp",
      "/%5fnext/static/build_b/media/evil.webp",
      "/%255fnext/%2573tatic/build_b/media/evil.webp",
    ].map((encodedPath) => resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace("<main>", `<main><img src="${encodedPath}">`)
        : body,
    })),
    ...[
      "%5fnext/static/build_b/media/evil.webp",
      "%255fnext/%2573tatic/build_b/media/evil.webp",
    ].map((encodedPath) => resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/recruitment" || occurrence !== 1) return body;
        return body.replace(
          "Audio fallback.</audio>",
          `<base href="/base/">fallback</audio><img src="${encodedPath}">`,
        );
      },
    })),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/recruitment" || occurrence !== 1) return body;
        return body.replace(
          "Audio fallback.</audio>",
          '<base href="https://outside.example/base/">fallback</audio>'
            + '<img src="../%5fnext/static/build_b/media/evil.webp">',
        );
      },
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/recruitment" || occurrence !== 1) return body;
        const payload = JSON.stringify([
          1, 'HL["static/build_b/chunks/evil.css","style"]',
        ]);
        return body.replace("<main>", `<script>self.__next_f.push(${payload})</script><main>`)
          .replace("Audio fallback.</audio>", '<base href="/_next/">fallback</audio>');
      },
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/recruitment" || occurrence !== 2) return body;
        return body.replace(
          "Audio fallback.</audio>",
          '<source src="_next/static/build_b/media/evil.mp3">Audio fallback.</audio>',
        );
      },
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/recruitment" || occurrence !== 2) return body;
        return body.replace(
          "Audio fallback.</audio>",
          '<track src="_next/static/build_b/media/evil.vtt">Audio fallback.</audio>',
        );
      },
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/recruitment" || occurrence !== 2) return body;
        return body.replace("</head>", '<base href="/_next/"></head>')
          .replace("</body>", '<img src="static/build_b/media/evil.webp"></body>');
      },
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/privacy" || occurrence !== 2) return body;
        return body.replace(
          "</head>",
          '<meta http-equiv="refresh" content="0;url=_next/static/build_b/chunks/evil.js"></head>',
        );
      },
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform(body, url, occurrence) {
        if (url.pathname !== "/meta-data-deletion" || occurrence !== 2) return body;
        const payload = JSON.stringify([
          1, "_next/static/build_b/chunks/evil.js",
        ]);
        return body.replace("</body>", `<script>self.__next_f.push(${payload})</script></body>`);
      },
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "<main>",
          `<select><input><link rel="stylesheet" href="/_next/static/build_b/chunks/evil.css" data-precedence="next"></select><main>`,
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "<main>",
          '<main><img src="_next/static/build_b/media/evil.webp">',
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "</head>",
          '<style>body{background:url(_next/static/build_b/media/evil.webp)}</style></head>',
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "<main>",
          String.raw`<main><img src="\_next\static\build_b\media\evil.webp">`,
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "</head>",
          String.raw`<style>body{background:url(\\_next\\static\\build_b\\media\\evil.webp)}</style></head>`,
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "<main>",
          '<main><img src="/_next/ignored/../static/build_b/media/evil.webp">',
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      bodyTransform: (body, url) => url.pathname === "/events"
        ? body.replace(
          "<main>",
          '<template><select></template></select><link rel="stylesheet" href="/_next/static/build_b/chunks/evil.css" data-precedence="next"></template><main>',
        ) : body,
    }),
    resealFixture({
      buildId: "build_a",
      responseHeaders: (url) => url.pathname === "/"
        ? { link: fontPreload("build_b", "font-a") } : {},
    }),
    resealFixture({
      buildId: "build_a",
      responseHeaders: (url) => url.pathname === "/"
        ? { link: fontPreload("", "font-a") } : {},
    }),
  ];
  for (const [index, current] of driftFixtures.entries()) {
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
    }), { message: "HTML_DOCUMENT_REJECTED" }, `drift fixture ${index}`);
  }

  for (const responseHeaders of [
    () => ({ "content-disposition": 'inline; filename="index.html"' }),
    (url) => url.pathname === "/events" ? {
      link: [fontPreload("build_a", "font-a"), fontPreload("build_b", "font-b")].join(", "),
    } : {},
    (url) => url.pathname === "/" ? { link: fontPreload("build_a", "font-a") }
      : url.pathname === "/events" ? { link: fontPreload("build_b", "font-b") } : {},
    (url) => url.pathname === "/events" ? {
      link: [fontPreload("build_a", "font-a"), fontPreload("build_a", "font-a")].join(", "),
    } : {},
    () => ({ link: "x".repeat(PRODUCTION_CHECK_LIMITS.linkHeaderCharacters + 1) }),
    () => ({
      "content-disposition": "x".repeat(
        PRODUCTION_CHECK_LIMITS.contentDispositionCharacters + 1,
      ),
    }),
    (url) => url.pathname.startsWith("/assets/")
      ? { "content-disposition": 'inline; filename="wrong.webp"' } : {},
  ]) {
    const current = resealFixture({ buildId: "build_a", responseHeaders });
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
    }), { message: "RESPONSE_HEADER_REJECTED" });
  }

  const oversizedContentLength = resealFixture({
    responseHeaders: () => ({
      "content-length": "0".repeat(PRODUCTION_CHECK_LIMITS.contentLengthCharacters) + "4",
    }),
  });
  await assert.rejects(() => checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: oversizedContentLength.fetchImpl,
    maxAttempts: 1,
  }), { message: "RESPONSE_HEADER_REJECTED" });

  for (const contentLength of [
    "0".repeat(PRODUCTION_CHECK_LIMITS.contentLengthCharacters) + "4",
    String(PRODUCTION_CHECK_LIMITS.assetBytes + 1),
    "9999999999999999",
    "PRIVATE_SENTINEL",
  ]) {
    const assetContentLength = resealFixture({
      responseHeaders: (url) => url.pathname.startsWith("/assets/")
        ? { "content-length": contentLength } : {},
    });
    let rejected;
    try {
      await checkProductionWithTestFixtures({
        baseUrl: resealBaseUrl,
        fetchImpl: assetContentLength.fetchImpl,
        maxAttempts: 1,
      });
    } catch (error) {
      rejected = error;
    }
    assert.equal(rejected?.message, "RESPONSE_HEADER_REJECTED");
    assert.equal(String(rejected).includes("PRIVATE_SENTINEL"), false);
    assert.equal(assetContentLength.calls.filter(({ path }) => path.startsWith("/assets/")).length, 1);
  }
});
