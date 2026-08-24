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
const expectedSuccess = "App static surface inventory OK (29 metadata routes, 249 public files, 38482392 bytes).\n";
const expectedCheckerBytes = 13_000;
const expectedCheckerSha256 = "1B15785CAAD38240ADE40BB1C4909C5174D6A73DF7B215540A9FAAC3332B7AA0";
const expectedLibraryBytes = 24_956;
const expectedLibrarySha256 = "AF6A2D5632582D56B92C8E7CD0D7ED0A004712BFCF51091DE2A1AFB50BD63C0A";
const expectedAppRouterLibraryBytes = 59_423;
const expectedAppRouterLibrarySha256 = "5051994396F6B0EAC3033F13CF2DC41BD2DCD8FF3102CF11DC49F8B53F780D84";
const expectedProductionCheckerBytes = 107_442;
const expectedProductionCheckerSha256 = "EECF77B765BF2F724382A3E428F540E174130CB06B6E206C780B1840CC31BCB2";

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
  checkProductionWithTestFixtures,
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

const resealStaticResources = Object.freeze({
  body: '<script async="" src="/_next/static/chunks/3nk76snv1e0rj.js"></script>',
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
    bodyTransform(body, url) {
      if (url.pathname !== "/events") return body;
      const firstPayload = JSON.stringify([1, 'x:"/_next/static/']);
      const secondPayload = JSON.stringify([1, 'build_a/chunks/ordinary.js"\n']);
      return body.replace(
        "</body>",
        `<script>self.__next_f.push(${firstPayload})</script><script>self.__next_f.push(${secondPayload})</script></body>`,
      );
    },
  });
  assert.deepEqual(await checkProductionWithTestFixtures({
    baseUrl: resealBaseUrl,
    fetchImpl: splitFlightStream.fetchImpl,
    maxAttempts: 1,
  }), { ok: true });
  assert.equal(splitFlightStream.calls.length, 16);
});

test("production checker rejects publication-envelope drift", async () => {
  for (const current of [
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
        const scopedBody = resealStaticResources.body.replaceAll(
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
      String.raw`\_next\static\build_b\chunks\evil.js`,
      "_ne\nxt/static/build_b/chunks/evil.js",
      "/_ne\rxt/static/build_b/chunks/evil.js",
      String.raw`\_ne` + "\t" + String.raw`xt\static\build_b\chunks\evil.js`,
      'x:{"dangerouslySetInnerHTML":{"__html":"<img src=&#95;next/static/build_b/media/evil.webp>"}}',
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
  ]) {
    await assert.rejects(() => checkProductionWithTestFixtures({
      baseUrl: resealBaseUrl,
      fetchImpl: current.fetchImpl,
      maxAttempts: 1,
    }), { message: "HTML_DOCUMENT_REJECTED" });
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
