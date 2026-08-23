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
const configPath = path.join(root, "apps", "web", "config", "app-static-surface-inventory.v1.json");
const expectedSuccess = "App static surface inventory OK (29 metadata routes, 249 public files, 38482392 bytes).\n";
const expectedCheckerBytes = 13_000;
const expectedCheckerSha256 = "993ADBDAD7C3552F7F022510E31D95420576771EC10FF4EE0865CEBF47B54404";
const expectedLibraryBytes = 24_956;
const expectedLibrarySha256 = "AF6A2D5632582D56B92C8E7CD0D7ED0A004712BFCF51091DE2A1AFB50BD63C0A";
const expectedAppRouterLibraryBytes = 59_423;
const expectedAppRouterLibrarySha256 = "5051994396F6B0EAC3033F13CF2DC41BD2DCD8FF3102CF11DC49F8B53F780D84";

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
  )) {
  throw new Error("Claim K executable source seal rejected");
}

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
    metadataRoutes: 29,
    indexedMetadataRoutes: 18,
    nonindexedMetadataRoutes: 11,
    publicFiles: 249,
    publicBytes: 38_482_392,
    sourceFiles: 44,
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
  assert.equal(inventory.metadataRoutes.length, 29);
  assert.equal(inventory.metadataRoutes.filter((row) => row.terminalStatus === "in_progress").length, 28);
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
      "/raffle/rules",
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
  assert.equal(rows.reduce((sum, row) => sum + row.bytes, 0), 38_482_392);
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
