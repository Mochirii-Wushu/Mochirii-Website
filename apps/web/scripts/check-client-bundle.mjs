import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const buildRoot = path.resolve(".next");
const manifestPath = path.join(buildRoot, "server", "app", "page_client-reference-manifest.js");
const spinnerManifestPath = path.join(buildRoot, "server", "app", "spinner", "page_client-reference-manifest.js");
const layoutLimit = 63 * 1024;
const homeIncrementalLimit = 5 * 1024;
const homeSceneLimit = 8 * 1024;
const publicRouteLimit = 225 * 1024;
const forbiddenRuntimeMarkers = ["GoTrueClient", "PostgrestError", "RealtimeClient"];
const forbiddenSecretMarkers = ["MOCHIRII_FORUMS_DISCOURSE_CONNECT_SECRET"];
const galleryMarker = "Approved gallery feed could not be loaded.";
const publicRoutes = [
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
  "/raffle/rules/[version]",
  "/ranks",
  "/recruitment",
  "/spotify",
  "/spotlight",
  "/tome",
  "/twills",
];
const nonPublicRoutes = [
  "/[...not-found]",
  "/account",
  "/auth",
  "/gallery-submit",
  "/forums/connect",
  "/leader-dashboard",
  "/oauth/consent",
  "/raffle-render-fixtures-internal/[scenario]",
  "/social",
  "/spinner",
  "/spinner/[...not-found]",
];
const failures = [];

function appPageRoutes(directory = path.resolve("app"), segments = []) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return appPageRoutes(path.join(directory, entry.name), [...segments, entry.name]);
    if (entry.name !== "page.tsx") return [];
    return [segments.length ? `/${segments.join("/")}` : "/"];
  });
}

const discoveredRoutes = appPageRoutes();
const classifiedRoutes = new Set([...publicRoutes, ...nonPublicRoutes]);
for (const route of discoveredRoutes) {
  if (!classifiedRoutes.has(route)) failures.push(`app page ${route} is not classified in the client-bundle route inventory`);
}
for (const route of classifiedRoutes) {
  if (!discoveredRoutes.includes(route)) failures.push(`classified route ${route} has no app page`);
}

function parseManifest(file, route) {
  const source = readFileSync(file, "utf8");
  const marker = `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}] = `;
  const start = source.indexOf(marker);
  const end = source.lastIndexOf(";");
  if (start < 0 || end < start) throw new Error(`${route} client-reference manifest assignment was not found.`);
  return JSON.parse(source.slice(start + marker.length, end));
}

function entryFiles(entries, suffix) {
  const key = Object.keys(entries).find((candidate) => candidate.endsWith(suffix));
  if (!key) throw new Error(`Client bundle entry ${suffix} was not found.`);
  return entries[key];
}

function readChunk(relativePath) {
  return readFileSync(path.join(buildRoot, relativePath));
}

function routeManifestPath(route) {
  if (route === "/") return manifestPath;
  return path.join(buildRoot, "server", "app", ...route.slice(1).split("/"), "page_client-reference-manifest.js");
}

function routeManifestKey(route) {
  return route === "/" ? "/page" : `${route}/page`;
}

function routeEntrySuffix(route) {
  return route === "/" ? "/app/page" : `/app${route}/page`;
}

function publicRouteBundle(route) {
  const routeManifest = parseManifest(routeManifestPath(route), routeManifestKey(route));
  const routeEntries = routeManifest.entryJSFiles || {};
  const files = [...new Set([
    ...entryFiles(routeEntries, "/app/layout"),
    ...entryFiles(routeEntries, routeEntrySuffix(route)),
  ])];
  const chunks = files.map((file) => ({ file, buffer: readChunk(file) }));
  return {
    files,
    chunks,
    clientModules: Object.keys(routeManifest.clientModules || {}),
    brotliBytes: chunks.reduce((total, chunk) => total + brotliBytes(chunk.buffer), 0),
  };
}

function brotliBytes(buffer) {
  return brotliCompressSync(buffer, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).length;
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

let manifest;
let spinnerManifest;
try {
  manifest = parseManifest(manifestPath, "/page");
  spinnerManifest = parseManifest(spinnerManifestPath, "/spinner/page");
} catch (error) {
  console.error(`Client bundle guard could not read the production build: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const entries = manifest.entryJSFiles || {};
let layoutFiles;
let homeFiles;
let spinnerFiles;
try {
  layoutFiles = entryFiles(entries, "/app/layout");
  homeFiles = entryFiles(entries, "/app/page");
  spinnerFiles = entryFiles(spinnerManifest.entryJSFiles || {}, "/app/spinner/page");
} catch (error) {
  console.error(`Client bundle guard could not resolve route entries: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const layoutSet = new Set(layoutFiles);
const homeIncrementalFiles = homeFiles.filter((file) => !layoutSet.has(file));
const layoutChunks = layoutFiles.map((file) => ({ file, buffer: readChunk(file) }));
const homeIncrementalChunks = homeIncrementalFiles.map((file) => ({ file, buffer: readChunk(file) }));
const layoutBrotli = layoutChunks.reduce((total, chunk) => total + brotliBytes(chunk.buffer), 0);
const homeIncrementalBrotli = homeIncrementalChunks.reduce((total, chunk) => total + brotliBytes(chunk.buffer), 0);

const staticChunkDirectory = path.join(buildRoot, "static");
function readStaticChunks(directory, relative = "static") {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = `${relative}/${entry.name}`;
    if (entry.isDirectory()) return readStaticChunks(path.join(directory, entry.name), file);
    return entry.isFile() && entry.name.endsWith(".js") ? [{ file, buffer: readChunk(file) }] : [];
  });
}
const staticChunks = readStaticChunks(staticChunkDirectory);
function chunksContaining(marker) {
  const encoded = Buffer.from(marker);
  return staticChunks.filter((chunk) => chunk.buffer.includes(encoded)).map((chunk) => chunk.file);
}
const sceneFiles = chunksContaining("HOME_SCENE_RENDERER_V1");
const sceneWorkerFiles = chunksContaining("Scene worker unavailable");
if (sceneWorkerFiles.length !== 1) failures.push(`expected one deferred Home worker module, found ${sceneWorkerFiles.length}`);
const chunkByPath = new Map(staticChunks.map(chunk => [chunk.file, chunk]));
function referencedChunks(file) {
  const source = chunkByPath.get(file)?.buffer.toString("utf8") || "";
  const references = new Set();
  for (const match of source.matchAll(/["']([^"'\\]*static\/(?:chunks|media)\/[^"'\\]*\.js)["']/g)) {
    const reference = match[1].replace(/^\/?_next\//, "").replace(/^\//, "");
    if (!chunkByPath.has(reference)) failures.push(`unresolved Home scene chunk reference in ${file}: ${reference}`);
    else references.add(reference);
  }
  return references;
}
// Follow every emitted bootstrap/module/dependency path, including nested chunks.
// The worker and its runtime stay charged even when not part of the Home entry.
const sceneClosure = new Set([...sceneFiles, ...sceneWorkerFiles]);
for (const file of sceneClosure) for (const reference of referencedChunks(file)) sceneClosure.add(reference);
for (const file of sceneFiles) {
  const references = referencedChunks(file);
  if (!sceneWorkerFiles.every(workerFile => references.has(workerFile))) failures.push(`Home controller must identify its emitted worker module: ${file}`);
}
const pvpPlayerFiles = chunksContaining("This clip could not be loaded. You can try opening it directly.");
if (pvpPlayerFiles.length !== 1) failures.push(`expected one intent-loaded PvP player chunk, found ${pvpPlayerFiles.length}`);
for (const file of pvpPlayerFiles) {
  if (layoutFiles.includes(file) || homeFiles.includes(file)) failures.push(`PvP player is eager: ${file}`);
}
const pvpPlayerSource = readFileSync(path.resolve("components/home/pvp-player.ts"), "utf8");
if (/^\s*import\s/m.test(pvpPlayerSource)) failures.push("PvP player dependencies need explicit budget accounting");
const pvpPlayerBrotli = pvpPlayerFiles.reduce((total, file) => total + brotliBytes(readChunk(file)), 0);
if (sceneFiles.length !== 1) failures.push(`expected one deferred Home renderer chunk, found ${sceneFiles.length}`);
for (const file of sceneClosure) {
  if (layoutFiles.includes(file) || homeFiles.includes(file)) failures.push(`Home renderer is eager: ${file}`);
}
// Count the whole new shared controller and preference source conservatively,
// in addition to the compiled renderer. Their compiled bytes also remain in
// the unchanged shared-entry guard. The renderer intentionally has no imports.
const sceneSource = readFileSync(path.resolve("components/home-scene.ts"), "utf8");
if (/^\s*import\s/m.test(sceneSource)) failures.push("Home renderer dependencies need explicit budget accounting");
const workerSource = readFileSync(path.resolve("components/home-scene-worker.js"), "utf8");
if (/^\s*import\s/m.test(workerSource)) failures.push("Home worker dependencies need explicit budget accounting");
const sceneHelperBytes = ["components/DecorativeMotion.tsx", "lib/decorative-motion.ts"]
  .reduce((total, file) => total + brotliBytes(readFileSync(path.resolve(file))), 0);
const sceneBrotli = [...sceneClosure].reduce((total, file) => total + brotliBytes(readChunk(file)), 0);
if (sceneBrotli + sceneHelperBytes > homeSceneLimit) {
  failures.push(`Home scene and helpers are ${formatKiB(sceneBrotli + sceneHelperBytes)}; limit is ${formatKiB(homeSceneLimit)}`);
}
for (const marker of forbiddenSecretMarkers) {
  const offenders = chunksContaining(marker);
  if (offenders.length) failures.push(`client chunks contain server-only marker ${marker}: ${offenders.join(", ")}`);
}
const controllerChunks = chunksContaining("Bulk paste");
const viewerChunks = chunksContaining("raffle-app--viewer");
if (controllerChunks.length !== 1) failures.push(`expected one controller-only spinner chunk, found ${controllerChunks.length}`);
if (viewerChunks.length !== 1) failures.push(`expected one viewer-only spinner chunk, found ${viewerChunks.length}`);
if (controllerChunks[0] && viewerChunks[0] && controllerChunks[0] === viewerChunks[0]) {
  failures.push("controller and viewer spinner surfaces share the same lazy chunk");
}
for (const privateChunk of [...controllerChunks, ...viewerChunks]) {
  if (spinnerFiles.includes(privateChunk)) failures.push(`spinner entry eagerly loads mode-specific chunk ${privateChunk}`);
}

for (const marker of forbiddenRuntimeMarkers) {
  const offenders = layoutChunks.filter((chunk) => chunk.buffer.includes(Buffer.from(marker))).map((chunk) => chunk.file);
  if (offenders.length) failures.push(`initial layout contains deferred Supabase marker ${marker}: ${offenders.join(", ")}`);
}

const routeBundles = new Map();
for (const route of publicRoutes) {
  try {
    const bundle = publicRouteBundle(route);
    routeBundles.set(route, bundle);
    if (route === "/" && bundle.brotliBytes + sceneBrotli + pvpPlayerBrotli > publicRouteLimit) {
      failures.push(`Home entry plus deferred scene and PvP player exceeds ${formatKiB(publicRouteLimit)}`);
    }
    if (bundle.brotliBytes > publicRouteLimit) {
      failures.push(`${route} entry JavaScript is ${formatKiB(bundle.brotliBytes)}; limit is ${formatKiB(publicRouteLimit)}`);
    }

    for (const marker of forbiddenRuntimeMarkers) {
      const offenders = bundle.chunks.filter((chunk) => chunk.buffer.includes(Buffer.from(marker))).map((chunk) => chunk.file);
      if (offenders.length) failures.push(`${route} entry contains Supabase SDK marker ${marker}: ${offenders.join(", ")}`);
    }

    const supabaseModules = bundle.clientModules.filter((modulePath) => (
      /[\\/]node_modules[\\/]@supabase[\\/]/.test(modulePath)
      || /[\\/]lib[\\/]supabase[\\/]/.test(modulePath)
    ));
    if (supabaseModules.length) {
      failures.push(`${route} entry references Supabase client modules: ${supabaseModules.join(", ")}`);
    }

    const galleryOffenders = bundle.chunks.filter((chunk) => chunk.buffer.includes(Buffer.from(galleryMarker))).map((chunk) => chunk.file);
    const galleryClientModules = bundle.clientModules.filter((modulePath) => /[\\/]components[\\/]public-pages[\\/]GalleryBrowser\.tsx/.test(modulePath));
    if (route === "/gallery" && galleryOffenders.length === 0) failures.push("Gallery entry is missing its approved-feed marker");
    if (route === "/gallery" && galleryClientModules.length === 0) failures.push("Gallery entry is missing its GalleryBrowser client module");
    if (route !== "/gallery" && galleryOffenders.length) {
      failures.push(`${route} entry contains Gallery-only code: ${galleryOffenders.join(", ")}`);
    }
    if (route !== "/gallery" && galleryClientModules.length) {
      failures.push(`${route} entry references GalleryBrowser: ${galleryClientModules.join(", ")}`);
    }
  } catch (error) {
    failures.push(`${route} entry bundle could not be inspected: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (layoutBrotli > layoutLimit) {
  failures.push(`initial layout JavaScript is ${formatKiB(layoutBrotli)}; limit is ${formatKiB(layoutLimit)}`);
}
if (homeIncrementalBrotli > homeIncrementalLimit) {
  failures.push(`Home incremental JavaScript is ${formatKiB(homeIncrementalBrotli)}; limit is ${formatKiB(homeIncrementalLimit)}`);
}

if (failures.length) {
  console.error("Client bundle guard failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Client bundle guard passed.");
console.log(`- Initial layout: ${formatKiB(layoutBrotli)} across ${layoutFiles.length} chunk(s).`);
console.log(`- Home incremental: ${formatKiB(homeIncrementalBrotli)} across ${homeIncrementalFiles.length} chunk(s).`);
console.log(`- Deferred Home scene including worker/bootstrap/dependencies: ${formatKiB(sceneBrotli)} across ${sceneClosure.size} chunks; conservative shared-helper charge: ${formatKiB(sceneHelperBytes)}; combined limit ${formatKiB(homeSceneLimit)}.`);
console.log(`- Intent-loaded PvP player: ${formatKiB(pvpPlayerBrotli)}; included in the unchanged public-route limit.`);
console.log(`- Home entry plus deferred scene and PvP player: ${formatKiB(layoutBrotli + homeIncrementalBrotli + sceneBrotli + pvpPlayerBrotli)}.`);
console.log("- Supabase Auth, PostgREST, and Realtime markers are absent from the initial layout.");
for (const route of publicRoutes) {
  const bundle = routeBundles.get(route);
  if (bundle) console.log(`- ${route}: ${formatKiB(bundle.brotliBytes)} Brotli across ${bundle.files.length} entry chunk(s).`);
}
console.log(`- Every public route entry stays within ${formatKiB(publicRouteLimit)} Brotli.`);
console.log(`- Route inventory classifies ${publicRoutes.length} public and ${nonPublicRoutes.length} non-public app pages.`);
console.log("- Gallery-only code is absent from unrelated public entries, and Supabase SDK modules and markers are absent from all public entries.");
console.log("- Private spinner controller and viewer code remain distinct, lazy chunks.");
