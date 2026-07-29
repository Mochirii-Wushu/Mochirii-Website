import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const ROUTE_SURFACES = ["public", "member", "moderator", "private", "internal", "not-found"];

const ROUTE_FILE_PATTERN = /^(page|route)\.(?:js|jsx|ts|tsx)$/;
const ROUTE_GROUP_PATTERN = /^\([^.)][^)]*\)$/;
const INTERCEPTING_ROUTE_PATTERN = /^\((?:\.|\.\.|\.\.\.)(?:\.\.)?\)/;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function routePathFromSegments(segments) {
  const routeSegments = [];
  for (const segment of segments) {
    if (segment.startsWith("_")) return null;
    if (ROUTE_GROUP_PATTERN.test(segment)) continue;
    if (segment.startsWith("@") || INTERCEPTING_ROUTE_PATTERN.test(segment)) {
      throw new Error(`unsupported App Router segment ${segment}; inventory support must be added before introducing this route`);
    }
    routeSegments.push(segment);
  }
  return routeSegments.length ? `/${routeSegments.join("/")}` : "/";
}

function explicitHandlerMethods(source) {
  const found = new Set();
  const directExport = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  const namedExport = /export\s*\{([^}]+)\}/g;

  for (const match of source.matchAll(directExport)) found.add(match[1]);
  for (const match of source.matchAll(namedExport)) {
    for (const part of match[1].split(",")) {
      const exported = part.trim().match(/(?:^|\s+as\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/);
      if (exported) found.add(exported[1]);
    }
  }

  return HTTP_METHODS.filter((method) => found.has(method));
}

export function discoverAppRouterEntries(appDirectory) {
  const entries = [];

  function visit(directory, segments = []) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("_")) visit(path.join(directory, entry.name), [...segments, entry.name]);
        continue;
      }
      if (!entry.isFile()) continue;

      const match = entry.name.match(ROUTE_FILE_PATTERN);
      if (!match) continue;
      const routePath = routePathFromSegments(segments);
      if (!routePath) continue;

      const kind = match[1] === "page" ? "page" : "handler";
      const source = normalizeRelativePath(path.relative(path.dirname(appDirectory), path.join(directory, entry.name)));
      const discovered = { path: routePath, kind, source };
      if (kind === "handler") {
        discovered.methods = explicitHandlerMethods(readFileSync(path.join(directory, entry.name), "utf8"));
      }
      entries.push(discovered);
    }
  }

  visit(appDirectory);
  return entries.sort((left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind));
}

export function readAppRouteMatrix(matrixPath) {
  return JSON.parse(readFileSync(matrixPath, "utf8"));
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateAppRouteMatrix({ appDirectory, matrixPath }) {
  const failures = [];
  let matrix;
  let discovered;

  try {
    matrix = readAppRouteMatrix(matrixPath);
  } catch (error) {
    return {
      failures: [`route matrix could not be read: ${error instanceof Error ? error.message : String(error)}`],
      matrix: null,
      discovered: [],
    };
  }

  try {
    discovered = discoverAppRouterEntries(appDirectory);
  } catch (error) {
    return {
      failures: [`App Router filesystem could not be inventoried: ${error instanceof Error ? error.message : String(error)}`],
      matrix,
      discovered: [],
    };
  }

  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    return { failures: ["route matrix root must be an object"], matrix, discovered };
  }
  if (!exactKeys(matrix, ["schemaVersion", "publicSafe", "routes", "redirects"])) {
    failures.push("route matrix root must contain only schemaVersion, publicSafe, routes, and redirects");
  }
  if (matrix.schemaVersion !== 1) failures.push("route matrix schemaVersion must be 1");
  if (matrix.publicSafe !== true) failures.push("route matrix must declare publicSafe=true");
  if (!Array.isArray(matrix.routes)) failures.push("route matrix routes must be an array");
  if (!Array.isArray(matrix.redirects)) failures.push("route matrix redirects must be an array");
  if (failures.length) return { failures, matrix, discovered };

  const routeKeys = new Set();
  const routePaths = new Set();
  const sources = new Set();
  for (const [index, route] of matrix.routes.entries()) {
    const label = `routes[${index}]`;
    if (!route || typeof route !== "object" || Array.isArray(route)) {
      failures.push(`${label} must be an object`);
      continue;
    }

    const expectedKeys = route.kind === "handler"
      ? ["path", "kind", "source", "surface", "productionSmoke", "methods"]
      : ["path", "kind", "source", "surface", "productionSmoke"];
    if (!exactKeys(route, expectedKeys)) failures.push(`${label} has unsupported or missing fields`);
    if (route.kind !== "page" && route.kind !== "handler") failures.push(`${label}.kind must be page or handler`);
    if (typeof route.path !== "string" || !route.path.startsWith("/") || route.path.includes("?") || route.path.includes("#")) {
      failures.push(`${label}.path must be a root-relative route without query or fragment`);
    }
    if (typeof route.source !== "string" || !/^app\/.+\/(?:page|route)\.(?:js|jsx|ts|tsx)$|^app\/(?:page|route)\.(?:js|jsx|ts|tsx)$/.test(route.source)) {
      failures.push(`${label}.source must be an App Router page or handler path relative to apps/web`);
    }
    if (!ROUTE_SURFACES.includes(route.surface)) failures.push(`${label}.surface is not recognized`);
    if (typeof route.productionSmoke !== "boolean") failures.push(`${label}.productionSmoke must be boolean`);
    if (route.productionSmoke && (route.kind !== "page" || route.path.includes("["))) {
      failures.push(`${label} enables production smoke for a handler or dynamic route`);
    }

    if (route.kind === "handler") {
      if (!Array.isArray(route.methods) || route.methods.length === 0) {
        failures.push(`${label}.methods must list at least one explicit handler export`);
      } else {
        const canonicalMethods = HTTP_METHODS.filter((method) => route.methods.includes(method));
        if (route.methods.some((method) => !HTTP_METHODS.includes(method)) || !sameStringArray(route.methods, canonicalMethods)) {
          failures.push(`${label}.methods must be unique and ordered as ${HTTP_METHODS.join(", ")}`);
        }
      }
    }

    const key = `${route.kind}:${route.path}`;
    if (routeKeys.has(key)) failures.push(`${label} duplicates ${key}`);
    routeKeys.add(key);
    if (routePaths.has(route.path)) failures.push(`${label} conflicts with another route kind at ${route.path}`);
    routePaths.add(route.path);
    if (sources.has(route.source)) failures.push(`${label} duplicates source ${route.source}`);
    sources.add(route.source);
  }

  const canonicalRoutes = [...matrix.routes].sort((left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind));
  if (matrix.routes.some((route, index) => route !== canonicalRoutes[index])) {
    failures.push("route matrix routes must be ordered by path, then kind");
  }

  const expectedByKey = new Map(matrix.routes.map((route) => [`${route.kind}:${route.path}`, route]));
  const discoveredByKey = new Map();
  const discoveredPaths = new Set();
  for (const route of discovered) {
    const key = `${route.kind}:${route.path}`;
    if (discoveredByKey.has(key)) failures.push(`filesystem contains duplicate ${key}`);
    if (discoveredPaths.has(route.path)) failures.push(`filesystem defines both a page and handler at ${route.path}`);
    discoveredByKey.set(key, route);
    discoveredPaths.add(route.path);
  }
  for (const [key, route] of discoveredByKey) {
    const expected = expectedByKey.get(key);
    if (!expected) {
      failures.push(`undocumented App Router ${route.kind} ${route.path} at ${route.source}`);
      continue;
    }
    if (expected.source !== route.source) failures.push(`${key} source is ${route.source}; matrix records ${expected.source}`);
    if (route.kind === "handler" && !sameStringArray(expected.methods, route.methods)) {
      failures.push(`${key} exports ${route.methods.join(", ") || "no methods"}; matrix records ${expected.methods.join(", ")}`);
    }
  }
  for (const [key, route] of expectedByKey) {
    if (!discoveredByKey.has(key)) failures.push(`documented ${key} has no filesystem route at ${route.source}`);
  }

  const pagePaths = new Set(matrix.routes.filter((route) => route.kind === "page").map((route) => route.path));
  const redirectSources = new Set();
  for (const [index, redirect] of matrix.redirects.entries()) {
    const label = `redirects[${index}]`;
    if (!redirect || typeof redirect !== "object" || Array.isArray(redirect) || !exactKeys(redirect, ["source", "destination", "permanent"])) {
      failures.push(`${label} must contain only source, destination, and permanent`);
      continue;
    }
    if (typeof redirect.source !== "string" || !redirect.source.startsWith("/") || redirect.source.includes("?") || redirect.source.includes("#")) {
      failures.push(`${label}.source must be a root-relative path without query or fragment`);
    }
    if (typeof redirect.destination !== "string" || !pagePaths.has(redirect.destination)) {
      failures.push(`${label}.destination must reference a documented page route`);
    }
    if (redirect.permanent !== true) failures.push(`${label}.permanent must be true for the legacy route contract`);
    if (redirectSources.has(redirect.source)) failures.push(`${label} duplicates source ${redirect.source}`);
    if (pagePaths.has(redirect.source)) failures.push(`${label}.source conflicts with a documented page route`);
    redirectSources.add(redirect.source);
  }
  const canonicalRedirects = [...matrix.redirects].sort((left, right) => compareText(left.source, right.source));
  if (matrix.redirects.some((redirect, index) => redirect !== canonicalRedirects[index])) {
    failures.push("route matrix redirects must be ordered by source");
  }

  return { failures, matrix, discovered };
}

export function parseNextConfigLegacyRedirects(source) {
  const block = source.match(/const\s+legacyHtmlRedirects\s*=\s*\[([\s\S]*?)\]\s*as\s+const\s*;/);
  if (!block) throw new Error("legacyHtmlRedirects tuple array was not found in next.config.ts");

  const redirects = [];
  const tuple = /\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g;
  for (const match of block[1].matchAll(tuple)) {
    redirects.push({ source: match[1], destination: match[2], permanent: true });
  }
  if (!redirects.length) throw new Error("legacyHtmlRedirects did not contain any redirect tuples");
  return redirects.sort((left, right) => compareText(left.source, right.source));
}

export function compareRedirectContracts(expected, actual) {
  const failures = [];
  const expectedBySource = new Map();
  const actualBySource = new Map();
  for (const entry of expected) {
    if (expectedBySource.has(entry.source)) failures.push(`route matrix duplicates redirect source ${entry.source}`);
    expectedBySource.set(entry.source, entry);
  }
  for (const entry of actual) {
    if (actualBySource.has(entry.source)) failures.push(`next.config.ts duplicates redirect source ${entry.source}`);
    actualBySource.set(entry.source, entry);
  }
  for (const [source, redirect] of actualBySource) {
    const documented = expectedBySource.get(source);
    if (!documented) failures.push(`undocumented Next redirect ${source} -> ${redirect.destination}`);
    else if (documented.destination !== redirect.destination || documented.permanent !== redirect.permanent) {
      failures.push(`Next redirect ${source} does not match the route matrix`);
    }
  }
  for (const [source, redirect] of expectedBySource) {
    if (!actualBySource.has(source)) failures.push(`documented redirect ${source} -> ${redirect.destination} is absent from next.config.ts`);
  }
  return failures;
}
