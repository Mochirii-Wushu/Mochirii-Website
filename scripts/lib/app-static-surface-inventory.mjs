import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { validateAppRouteMatrix } from "./app-router-inventory.mjs";

export const STATIC_SURFACE_LIMITS = Object.freeze({
  configBytes: 1024 * 1024,
  sourceBytes: 2 * 1024 * 1024,
  publicFileBytes: 8 * 1024 * 1024,
  publicAggregateBytes: 64 * 1024 * 1024,
  publicFiles: 1024,
  publicDepth: 16,
  appFiles: 4096,
  appDepth: 32,
  relativePathCharacters: 512,
});

export const STATIC_SURFACE_FAILURE_CODES = Object.freeze([
  "INPUT",
  "CONFIG",
  "ROUTE_MATRIX",
  "SOURCE",
  "PUBLIC_TREE",
  "COLLISION",
  "FROZEN_PAYLOAD",
  "UNEXPECTED",
]);

const SOURCE_BASE_COMMIT = "3a59633a9ba9319f35be8ec7de758e9238032a96";
const SHA256_PATTERN = /^[A-F0-9]{64}$/;
const SAFE_RELATIVE_PATH_PATTERN = /^[A-Za-z0-9._/()[\]-]+$/;
const SAFE_ROUTE_PATTERN = /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%[\]-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%[\]-]+)*)?$/;
const FORMAT_BY_EXTENSION = Object.freeze({
  ".css": "css",
  ".ico": "ico",
  ".json": "json",
  ".mp3": "mp3",
  ".png": "png",
  ".txt": "txt",
  ".webp": "webp",
  ".xml": "xml",
});
const TEXT_PUBLIC_FORMAT_PATTERN = /^(?:css|json|txt|xml)$/;
const RESERVED_APP_STATIC_FILE_PATTERN = /^(?:favicon\.ico|robots\.(?:txt|js|jsx|ts|tsx)|sitemap\.(?:xml|js|jsx|ts|tsx)|manifest\.(?:json|webmanifest|js|jsx|ts|tsx)|(?:icon|apple-icon)[0-9]*\.(?:ico|jpg|jpeg|png|svg|js|jsx|ts|tsx)|(?:opengraph-image|twitter-image)[0-9]*\.(?:jpg|jpeg|png|gif|js|jsx|ts|tsx)|(?:opengraph-image|twitter-image)[0-9]*\.alt\.txt)$/i;
const APP_LAYOUT_FILE_PATTERN = /^layout\.(?:js|jsx|ts|tsx)$/;

const SUPPORTING_SOURCE_PATHS = Object.freeze([
  "apps/web/app/not-found.tsx",
  "apps/web/config/app-route-evidence.v1.json",
  "apps/web/config/app-route-matrix.v1.json",
  "apps/web/components/public-pages/metadata.ts",
  "package.json",
  "scripts/check-all.mjs",
  "scripts/check-app-static-surface-inventory.mjs",
  "scripts/check-assets.mjs",
  "scripts/check-observability-metadata-smoke.mjs",
  "scripts/lib/app-router-inventory.mjs",
  "scripts/lib/app-static-surface-inventory.mjs",
  "scripts/lib/app-static-surface-inventory.test.mjs",
]);

const SHARED_PUBLIC_METADATA_SOURCE = "apps/web/components/public-pages/metadata.ts";
const ROOT_METADATA_SOURCE = "apps/web/app/layout.tsx";
const SPINNER_METADATA_SOURCE = "apps/web/app/spinner/layout.tsx";

function metadataProfile({
  metadataSource,
  profile,
  canonicalPolicy,
  robotsPolicy,
  sitemapPolicy,
  previewPolicy,
  terminalStatus = "in_progress",
}) {
  return Object.freeze({
    metadataSource,
    profile,
    canonicalPolicy,
    robotsPolicy,
    sitemapPolicy,
    previewPolicy,
    terminalStatus,
  });
}

const SHARED_INDEXED_PROFILE = metadataProfile({
  metadataSource: SHARED_PUBLIC_METADATA_SOURCE,
  profile: "indexed_public_static",
  canonicalPolicy: "exact_route",
  robotsPolicy: "default_index_follow",
  sitemapPolicy: "included",
  previewPolicy: "shared_public_image",
});

const METADATA_ROUTE_PROFILES = Object.freeze({
  "/": metadataProfile({
    metadataSource: ROOT_METADATA_SOURCE,
    profile: "indexed_public_static",
    canonicalPolicy: "exact_route",
    robotsPolicy: "default_index_follow",
    sitemapPolicy: "included",
    previewPolicy: "root_public_image",
  }),
  "/[...not-found]": metadataProfile({
    metadataSource: "apps/web/app/[...not-found]/page.tsx",
    profile: "not_found",
    canonicalPolicy: "none",
    robotsPolicy: "not_declared",
    sitemapPolicy: "excluded",
    previewPolicy: "not_asserted",
  }),
  "/account": metadataProfile({
    metadataSource: "apps/web/app/account/page.tsx",
    profile: "noindex_member",
    canonicalPolicy: "exact_route",
    robotsPolicy: "noindex_follow",
    sitemapPolicy: "excluded",
    previewPolicy: "explicit_image",
  }),
  "/announcements": SHARED_INDEXED_PROFILE,
  "/auth": metadataProfile({
    metadataSource: "apps/web/app/auth/page.tsx",
    profile: "noindex_access",
    canonicalPolicy: "exact_route",
    robotsPolicy: "noindex_follow",
    sitemapPolicy: "excluded",
    previewPolicy: "explicit_image",
  }),
  "/events": SHARED_INDEXED_PROFILE,
  "/forums/connect": metadataProfile({
    metadataSource: "apps/web/app/forums/connect/page.tsx",
    profile: "noindex_member",
    canonicalPolicy: "exact_route",
    robotsPolicy: "noindex_nofollow",
    sitemapPolicy: "excluded",
    previewPolicy: "not_asserted",
  }),
  "/gallery": SHARED_INDEXED_PROFILE,
  "/gallery-submit": metadataProfile({
    metadataSource: "apps/web/app/gallery-submit/page.tsx",
    profile: "noindex_member",
    canonicalPolicy: "exact_route",
    robotsPolicy: "noindex_follow",
    sitemapPolicy: "excluded",
    previewPolicy: "explicit_image",
  }),
  "/games/mochi-pets": SHARED_INDEXED_PROFILE,
  "/join": SHARED_INDEXED_PROFILE,
  "/leader-dashboard": metadataProfile({
    metadataSource: "apps/web/app/leader-dashboard/page.tsx",
    profile: "noindex_moderator",
    canonicalPolicy: "exact_route",
    robotsPolicy: "noindex_follow",
    sitemapPolicy: "excluded",
    previewPolicy: "explicit_image",
  }),
  "/leaders": SHARED_INDEXED_PROFILE,
  "/meta-data-deletion": SHARED_INDEXED_PROFILE,
  "/oauth/consent": metadataProfile({
    metadataSource: "apps/web/app/oauth/consent/page.tsx",
    profile: "noindex_member",
    canonicalPolicy: "exact_route",
    robotsPolicy: "noindex_nofollow",
    sitemapPolicy: "excluded",
    previewPolicy: "not_asserted",
  }),
  "/privacy": SHARED_INDEXED_PROFILE,
  "/raffle": SHARED_INDEXED_PROFILE,
  "/raffle-render-fixtures-internal/[scenario]": metadataProfile({
    metadataSource: "apps/web/app/raffle-render-fixtures-internal/[scenario]/page.tsx",
    profile: "excluded_internal",
    canonicalPolicy: "none",
    robotsPolicy: "noindex_nofollow",
    sitemapPolicy: "excluded",
    previewPolicy: "suppressed",
    terminalStatus: "excluded_internal",
  }),
  "/raffle/rules/[version]": metadataProfile({
    metadataSource: "apps/web/app/raffle/rules/[version]/page.tsx",
    profile: "indexed_public_dynamic",
    canonicalPolicy: "dynamic_route",
    robotsPolicy: "index_follow",
    sitemapPolicy: "excluded",
    previewPolicy: "not_asserted",
  }),
  "/ranks": SHARED_INDEXED_PROFILE,
  "/recruitment": SHARED_INDEXED_PROFILE,
  "/social": metadataProfile({
    metadataSource: "apps/web/app/social/page.tsx",
    profile: "noindex_access",
    canonicalPolicy: "exact_route",
    robotsPolicy: "noindex_nofollow",
    sitemapPolicy: "excluded",
    previewPolicy: "not_asserted",
  }),
  "/spinner": metadataProfile({
    metadataSource: SPINNER_METADATA_SOURCE,
    profile: "private_isolated",
    canonicalPolicy: "none",
    robotsPolicy: "noindex_nofollow",
    sitemapPolicy: "excluded",
    previewPolicy: "suppressed",
  }),
  "/spinner/[...not-found]": metadataProfile({
    metadataSource: SPINNER_METADATA_SOURCE,
    profile: "private_isolated",
    canonicalPolicy: "none",
    robotsPolicy: "noindex_nofollow",
    sitemapPolicy: "excluded",
    previewPolicy: "suppressed",
  }),
  "/spotify": SHARED_INDEXED_PROFILE,
  "/spotlight": SHARED_INDEXED_PROFILE,
  "/tome": SHARED_INDEXED_PROFILE,
  "/twills": SHARED_INDEXED_PROFILE,
});

class StaticSurfaceError extends Error {
  constructor(code) {
    super(code);
    this.name = "StaticSurfaceError";
    this.code = STATIC_SURFACE_FAILURE_CODES.includes(code) ? code : "UNEXPECTED";
  }
}

function fail(code) {
  throw new StaticSurfaceError(code);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function isInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function toSafeRelativePath(value, code) {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > STATIC_SURFACE_LIMITS.relativePathCharacters
    || value.includes("\\")
    || value.startsWith("/")
    || value.endsWith("/")
    || !SAFE_RELATIVE_PATH_PATTERN.test(value)) {
    fail(code);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) fail(code);
  return value;
}

function rootRealPath(rootDirectory, code) {
  const absolute = path.resolve(rootDirectory);
  let stats;
  let resolved;
  try {
    stats = lstatSync(absolute, { bigint: true });
    resolved = realpathSync.native(absolute);
  } catch {
    fail(code);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink() || path.resolve(resolved) !== absolute) fail(code);
  return resolved;
}

function directoryState(directory, containmentRoot, code) {
  let stats;
  let resolved;
  try {
    stats = lstatSync(directory, { bigint: true });
    resolved = realpathSync.native(directory);
  } catch {
    fail(code);
  }
  if (!stats.isDirectory()
    || stats.isSymbolicLink()
    || !isInside(containmentRoot, resolved)
    || path.resolve(resolved) !== path.resolve(directory)) {
    fail(code);
  }
  return { stats, resolved };
}

function assertSameDirectoryState(before, after, code) {
  if (before.resolved !== after.resolved
    || before.stats.dev !== after.stats.dev
    || before.stats.ino !== after.stats.ino
    || before.stats.size !== after.stats.size
    || before.stats.mtimeNs !== after.stats.mtimeNs
    || before.stats.ctimeNs !== after.stats.ctimeNs) {
    fail(code);
  }
}

export function readBoundedOrdinaryFile({
  rootDirectory,
  relativePath,
  maxBytes,
  failureCode = "INPUT",
}) {
  const safeRelativePath = toSafeRelativePath(relativePath, failureCode);
  const rootResolved = rootRealPath(rootDirectory, failureCode);
  const lexicalPath = path.resolve(rootResolved, ...safeRelativePath.split("/"));
  if (!isInside(rootResolved, lexicalPath) || lexicalPath === rootResolved) fail(failureCode);

  let before;
  let resolved;
  try {
    before = lstatSync(lexicalPath, { bigint: true });
    resolved = realpathSync.native(lexicalPath);
  } catch {
    fail(failureCode);
  }
  if (!before.isFile() || before.isSymbolicLink() || !isInside(rootResolved, resolved)) fail(failureCode);
  if (before.size < 0n || before.size > BigInt(maxBytes)) fail(failureCode);

  let descriptor;
  try {
    descriptor = openSync(resolved, fsConstants.O_RDONLY);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size) {
      fail(failureCode);
    }
    const buffer = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (count <= 0) fail(failureCode);
      offset += count;
    }
    const afterOpen = fstatSync(descriptor, { bigint: true });
    if (afterOpen.size !== opened.size || afterOpen.mtimeNs !== opened.mtimeNs) fail(failureCode);

    const after = lstatSync(lexicalPath, { bigint: true });
    const afterResolved = realpathSync.native(lexicalPath);
    if (!after.isFile()
      || after.isSymbolicLink()
      || after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs
      || afterResolved !== resolved) {
      fail(failureCode);
    }
    return buffer;
  } catch (error) {
    if (error instanceof StaticSurfaceError) throw error;
    fail(failureCode);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The caller receives only the fixed failure category above.
      }
    }
  }
}

function decodeFatalUtf8(buffer, code) {
  if (!Buffer.isBuffer(buffer)
    || (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)) {
    fail(code);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail(code);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function plainRecord(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function inspectCanonicalInventoryDocument(buffer, expectedInventory) {
  try {
    const source = decodeFatalUtf8(buffer, "CONFIG");
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      fail("CONFIG");
    }
    if (!plainRecord(parsed) || canonicalJson(parsed) !== source) fail("CONFIG");
    if (!plainRecord(expectedInventory) || canonicalJson(expectedInventory) !== source) fail("FROZEN_PAYLOAD");
    return { failures: [], inventory: parsed };
  } catch (error) {
    const code = error instanceof StaticSurfaceError ? error.code : "UNEXPECTED";
    return { failures: ["[" + code + "]"], inventory: null };
  }
}

function publicCategory(relativePath) {
  if (relativePath === "favicon.ico") return "icon";
  if (relativePath === "robots.txt"
    || relativePath === "sitemap.xml"
    || relativePath.startsWith(".well-known/")) return "discovery";
  if (relativePath.startsWith("assets/")) return "asset";
  if (relativePath.startsWith("data/")) return "public_data";
  return "other";
}

function publicFormat(relativePath) {
  const format = FORMAT_BY_EXTENSION[path.extname(relativePath).toLowerCase()];
  if (!format) fail("PUBLIC_TREE");
  return format;
}

function canonicalPublicFileBytes(buffer, format) {
  if (!TEXT_PUBLIC_FORMAT_PATTERN.test(format)) return buffer;
  const source = decodeFatalUtf8(buffer, "PUBLIC_TREE");
  if (source.includes("\0") || /\r(?!\n)/.test(source)) fail("PUBLIC_TREE");
  return source.includes("\r")
    ? Buffer.from(source.replace(/\r\n/g, "\n"), "utf8")
    : buffer;
}

export function enumeratePublicFiles({ rootDirectory, publicDirectory = "apps/web/public" }) {
  const publicRelativePath = toSafeRelativePath(publicDirectory, "PUBLIC_TREE");
  const publicAbsolutePath = path.resolve(rootDirectory, ...publicRelativePath.split("/"));
  const publicRoot = rootRealPath(publicAbsolutePath, "PUBLIC_TREE");
  const rows = [];
  let canonicalAggregateBytes = 0;
  let rawAggregateBytes = 0;

  function visit(directory, prefix, depth) {
    if (depth > STATIC_SURFACE_LIMITS.publicDepth) fail("PUBLIC_TREE");
    const before = directoryState(directory, publicRoot, "PUBLIC_TREE");
    let entries;
    try {
      entries = readdirSync(before.resolved, { withFileTypes: true })
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    } catch {
      fail("PUBLIC_TREE");
    }

    for (const entry of entries) {
      const relativePath = prefix ? prefix + "/" + entry.name : entry.name;
      toSafeRelativePath(relativePath, "PUBLIC_TREE");
      const absolutePath = path.resolve(before.resolved, entry.name);
      let stats;
      let resolved;
      try {
        stats = lstatSync(absolutePath, { bigint: true });
        resolved = realpathSync.native(absolutePath);
      } catch {
        fail("PUBLIC_TREE");
      }
      if (stats.isSymbolicLink() || !isInside(publicRoot, resolved)) fail("PUBLIC_TREE");
      if (entry.isDirectory() && stats.isDirectory()) {
        visit(resolved, relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !stats.isFile()) fail("PUBLIC_TREE");

      const format = publicFormat(relativePath);
      const rawBuffer = readBoundedOrdinaryFile({
        rootDirectory: publicRoot,
        relativePath,
        maxBytes: STATIC_SURFACE_LIMITS.publicFileBytes,
        failureCode: "PUBLIC_TREE",
      });
      const buffer = canonicalPublicFileBytes(rawBuffer, format);
      rawAggregateBytes += rawBuffer.length;
      canonicalAggregateBytes += buffer.length;
      if (rows.length >= STATIC_SURFACE_LIMITS.publicFiles
        || rawAggregateBytes > STATIC_SURFACE_LIMITS.publicAggregateBytes
        || canonicalAggregateBytes > STATIC_SURFACE_LIMITS.publicAggregateBytes) {
        fail("PUBLIC_TREE");
      }
      rows.push({
        url: "/" + relativePath,
        source: publicRelativePath + "/" + relativePath,
        bytes: buffer.length,
        sha256: sha256(buffer),
        category: publicCategory(relativePath),
        format,
      });
    }
    const after = directoryState(directory, publicRoot, "PUBLIC_TREE");
    assertSameDirectoryState(before, after, "PUBLIC_TREE");
  }

  visit(publicRoot, "", 0);
  rows.sort((left, right) => left.url < right.url ? -1 : left.url > right.url ? 1 : 0);
  const urls = new Set();
  const caseFoldedUrls = new Set();
  for (const row of rows) {
    if (!SAFE_ROUTE_PATTERN.test(row.url)
      || urls.has(row.url)
      || caseFoldedUrls.has(row.url.toLowerCase())
      || !SHA256_PATTERN.test(row.sha256)) {
      fail("PUBLIC_TREE");
    }
    urls.add(row.url);
    caseFoldedUrls.add(row.url.toLowerCase());
  }
  return rows;
}

export function assertNoUncataloguedAppStaticSurfaces({
  rootDirectory,
  appDirectory = "apps/web/app",
}) {
  const appRelativePath = toSafeRelativePath(appDirectory, "COLLISION");
  const appAbsolutePath = path.resolve(rootDirectory, ...appRelativePath.split("/"));
  const appRoot = rootRealPath(appAbsolutePath, "COLLISION");
  const layoutSources = [];
  let visited = 0;

  function visit(directory, depth) {
    if (depth > STATIC_SURFACE_LIMITS.appDepth) fail("COLLISION");
    const before = directoryState(directory, appRoot, "COLLISION");
    let entries;
    try {
      entries = readdirSync(before.resolved, { withFileTypes: true })
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    } catch {
      fail("COLLISION");
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > STATIC_SURFACE_LIMITS.appFiles) fail("COLLISION");
      const absolutePath = path.resolve(before.resolved, entry.name);
      let stats;
      let resolved;
      try {
        stats = lstatSync(absolutePath, { bigint: true });
        resolved = realpathSync.native(absolutePath);
      } catch {
        fail("COLLISION");
      }
      if (stats.isSymbolicLink() || !isInside(appRoot, resolved)) fail("COLLISION");
      if (entry.isDirectory() && stats.isDirectory()) {
        visit(resolved, depth + 1);
        continue;
      }
      if (!entry.isFile() || !stats.isFile()) fail("COLLISION");
      if (RESERVED_APP_STATIC_FILE_PATTERN.test(entry.name)) fail("COLLISION");
      if (APP_LAYOUT_FILE_PATTERN.test(entry.name)) {
        const relativeFromApp = path.relative(appRoot, resolved).split(path.sep).join("/");
        if (!relativeFromApp || relativeFromApp.startsWith("../") || relativeFromApp.includes("/../")) {
          fail("COLLISION");
        }
        layoutSources.push(toSafeRelativePath(appRelativePath + "/" + relativeFromApp, "COLLISION"));
      }
    }
    const after = directoryState(directory, appRoot, "COLLISION");
    assertSameDirectoryState(before, after, "COLLISION");
  }

  visit(appRoot, 0);
  return layoutSources.sort();
}

function buildMetadataRoutes(matrixRows) {
  const pages = matrixRows.filter((row) => row.kind === "page");
  const expectedPaths = Object.keys(METADATA_ROUTE_PROFILES).sort();
  const actualPaths = pages.map((row) => row.path);
  if (canonicalJson(actualPaths) !== canonicalJson(expectedPaths)) fail("ROUTE_MATRIX");

  return pages.map((row) => {
    const profile = METADATA_ROUTE_PROFILES[row.path];
    if (!profile || typeof row.source !== "string" || typeof row.surface !== "string"
      || typeof row.productionSmoke !== "boolean") {
      fail("ROUTE_MATRIX");
    }
    return {
      path: row.path,
      source: "apps/web/" + row.source,
      surface: row.surface,
      productionSmoke: row.productionSmoke,
      ...profile,
    };
  });
}

function buildSourceCatalog({ rootDirectory, metadataRoutes, layoutSources }) {
  const sourcePaths = new Set(SUPPORTING_SOURCE_PATHS);
  for (const layoutSource of layoutSources) sourcePaths.add(layoutSource);
  for (const route of metadataRoutes) {
    sourcePaths.add(route.source);
    sourcePaths.add(route.metadataSource);
  }
  const rows = [];
  for (const sourcePath of [...sourcePaths].sort()) {
    const buffer = readBoundedOrdinaryFile({
      rootDirectory,
      relativePath: sourcePath,
      maxBytes: STATIC_SURFACE_LIMITS.sourceBytes,
      failureCode: "SOURCE",
    });
    rows.push({
      path: sourcePath,
      bytes: buffer.length,
      sha256: sha256(buffer),
    });
  }
  return rows;
}

export function publicUrlMatchesAppRoute(publicUrl, routePath) {
  if (typeof publicUrl !== "string" || typeof routePath !== "string") return false;
  if (routePath === "/[...not-found]") return false;
  const publicSegments = publicUrl.split("/").slice(1);
  const routeSegments = routePath.split("/").slice(1);
  let publicIndex = 0;
  for (let routeIndex = 0; routeIndex < routeSegments.length; routeIndex += 1) {
    const segment = routeSegments[routeIndex];
    const catchAll = /^\[\.\.\.[A-Za-z0-9_-]+\]$/.test(segment);
    const optionalCatchAll = /^\[\[\.\.\.[A-Za-z0-9_-]+\]\]$/.test(segment);
    if (catchAll || optionalCatchAll) {
      if (routeIndex !== routeSegments.length - 1) return false;
      return optionalCatchAll || publicIndex < publicSegments.length;
    }
    if (publicIndex >= publicSegments.length) return false;
    if (!/^\[[A-Za-z0-9_-]+\]$/.test(segment) && segment !== publicSegments[publicIndex]) return false;
    publicIndex += 1;
  }
  return publicIndex === publicSegments.length;
}

function assertNoCollisions({ matrix, publicFiles }) {
  const routePaths = matrix.routes.map((row) => row.path);
  const redirectSources = new Set(matrix.redirects.map((row) => row.source));
  for (const row of publicFiles) {
    if (routePaths.some((routePath) => publicUrlMatchesAppRoute(row.url, routePath))
      || redirectSources.has(row.url)) fail("COLLISION");
  }
}

export function buildAppStaticSurfaceInventory({ rootDirectory = process.cwd() } = {}) {
  const root = rootRealPath(rootDirectory, "INPUT");
  const matrixResult = validateAppRouteMatrix({
    appDirectory: path.join(root, "apps", "web", "app"),
    matrixPath: path.join(root, "apps", "web", "config", "app-route-matrix.v1.json"),
  });
  if (!plainRecord(matrixResult)
    || !Array.isArray(matrixResult.failures)
    || matrixResult.failures.length !== 0
    || !plainRecord(matrixResult.matrix)
    || !Array.isArray(matrixResult.matrix.routes)
    || !Array.isArray(matrixResult.matrix.redirects)) {
    fail("ROUTE_MATRIX");
  }

  const layoutSources = assertNoUncataloguedAppStaticSurfaces({ rootDirectory: root });
  const metadataRoutes = buildMetadataRoutes(matrixResult.matrix.routes);
  const publicFiles = enumeratePublicFiles({ rootDirectory: root });
  assertNoCollisions({ matrix: matrixResult.matrix, publicFiles });
  const sourceCatalog = buildSourceCatalog({ rootDirectory: root, metadataRoutes, layoutSources });
  const publicBytes = publicFiles.reduce((sum, row) => sum + row.bytes, 0);

  return {
    schemaVersion: 1,
    sourceBaseCommit: SOURCE_BASE_COMMIT,
    publicSafe: true,
    coverage: {
      appRouterPageMetadata: "matrix_complete_source_only",
      publicDirectory: "inventory_complete_source_only",
      storefrontSurfaces: "pending_separate_decision_record",
      runtimeValidation: "not_claimed",
      phase4Exit: "not_claimed",
    },
    summary: {
      metadataRoutes: metadataRoutes.length,
      indexedMetadataRoutes: metadataRoutes.filter((row) => row.profile.startsWith("indexed_")).length,
      nonindexedMetadataRoutes: metadataRoutes.filter((row) => !row.profile.startsWith("indexed_")).length,
      publicFiles: publicFiles.length,
      publicBytes,
      sourceFiles: sourceCatalog.length,
    },
    sourceCatalog,
    metadataRoutes,
    publicFiles,
  };
}

export function validateAppStaticSurfaceInventory({
  rootDirectory = process.cwd(),
  configPath = "apps/web/config/app-static-surface-inventory.v1.json",
} = {}) {
  try {
    const expectedInventory = buildAppStaticSurfaceInventory({ rootDirectory });
    const configBuffer = readBoundedOrdinaryFile({
      rootDirectory,
      relativePath: configPath,
      maxBytes: STATIC_SURFACE_LIMITS.configBytes,
      failureCode: "CONFIG",
    });
    return inspectCanonicalInventoryDocument(configBuffer, expectedInventory);
  } catch (error) {
    const code = error instanceof StaticSurfaceError ? error.code : "UNEXPECTED";
    return { failures: ["[" + code + "]"], inventory: null };
  }
}

export function staticSurfaceInventorySourceBaseCommit() {
  return SOURCE_BASE_COMMIT;
}
