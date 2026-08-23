import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  APP_ROUTE_MATRIX_LIMITS,
  compareRedirectContracts,
  parseNextConfigLegacyRedirects,
  readNextConfigSource,
  validateAppRouteMatrix,
} from "./lib/app-router-inventory.mjs";

const DEFAULT_BASE_URL = "https://mochirii.vercel.app";
const TIMEOUT_MS = 30000;
export const PRODUCTION_SMOKE_HTML_BYTE_LIMIT = 1024 * 1024;
const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const retiredGameRoute = `/games/${["mochi", "social"].join("-")}`;
const unknownRoute = "/__mochirii-unknown-route__";
const defaultAppDirectory = fileURLToPath(new URL("../apps/web/app/", import.meta.url));
const defaultMatrixPath = fileURLToPath(new URL("../apps/web/config/app-route-matrix.v1.json", import.meta.url));
const defaultNextConfigPath = fileURLToPath(new URL("../apps/web/next.config.ts", import.meta.url));

const retiredRoutes = [
  "/members",
  "/members/twills",
  retiredGameRoute,
];

const bodyChecks = new Map([
  ["/privacy", /Website scope|privacy questions/i],
  ["/meta-data-deletion", /Data Deletion Requests|How to make a request/i],
  ["/auth", /Mochirii Login|Sign-in connects your website account|Website Sign-In/i],
  ["/account", /Choose a Sign-In Method|Sign In Required/i],
  ["/gallery-submit", /Login Required|Access Check/i],
  ["/leader-dashboard", /Choose a Sign-In Method|Sign In Required|Access Denied/i],
  ["/games/mochi-pets", /Mochi Pets|tester doorway|fresh Unity project/i],
]);

const requestHeaders = {
  "user-agent": "MochiriiVercelProductionSmoke/1.0",
  accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.6",
};

function isSafeRoutePath(value) {
  return typeof value === "string"
    && value.length <= APP_ROUTE_MATRIX_LIMITS.fieldCharacters
    && value.startsWith("/")
    && !value.startsWith("//")
    && !/[\\?#\s\u0000-\u001f\u007f]/.test(value);
}

function boundedSmokeDiagnostic(value) {
  if (value.length <= APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters) return value;
  return `${value.slice(0, APP_ROUTE_MATRIX_LIMITS.diagnosticCharacters - 3)}...`;
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // A failed cancellation must not replace the fixed fail-closed result.
  }
}

function hasHtmlMediaType(response) {
  const contentType = response?.headers?.get?.("content-type");
  if (typeof contentType !== "string" || contentType.length > 256) return false;
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return HTML_MEDIA_TYPES.has(mediaType);
}

export async function readBoundedHtmlResponse(response) {
  if (!hasHtmlMediaType(response)) {
    await cancelResponseBody(response);
    throw new Error("response body must use an HTML media type");
  }

  const declaredLengthText = response.headers.get("content-length");
  if (declaredLengthText !== null && /^\d+$/.test(declaredLengthText.trim())) {
    const declaredLength = Number(declaredLengthText);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > PRODUCTION_SMOKE_HTML_BYTE_LIMIT) {
      await cancelResponseBody(response);
      throw new Error("HTML response body exceeded the byte limit");
    }
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("invalid response chunk");
      byteLength += value.byteLength;
      if (!Number.isSafeInteger(byteLength) || byteLength > PRODUCTION_SMOKE_HTML_BYTE_LIMIT) {
        throw new Error("response too large");
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new Error("HTML response body could not be read within the byte limit");
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new Error("HTML response body must be valid UTF-8");
  }
}

export function assertPermanentRedirectStatus(status) {
  if (status !== 308) {
    const observed = Number.isSafeInteger(status) ? status : "invalid";
    throw new Error(`expected permanent redirect HTTP 308, got HTTP ${observed}`);
  }
}

export function loadProductionSmokeContract({
  appDirectory = defaultAppDirectory,
  matrixPath = defaultMatrixPath,
  nextConfigPath = defaultNextConfigPath,
} = {}) {
  const result = validateAppRouteMatrix({ appDirectory, matrixPath });
  if (result.failures.length) {
    throw new Error(boundedSmokeDiagnostic(
      `production smoke route matrix validation failed: ${result.failures.slice(0, 8).join("; ")}`,
    ));
  }
  let configuredRedirects;
  try {
    configuredRedirects = parseNextConfigLegacyRedirects(readNextConfigSource(nextConfigPath));
  } catch {
    throw new Error("production smoke Next redirect contract could not be read or parsed [NEXT_REDIRECT_INPUT]");
  }
  const redirectFailures = compareRedirectContracts(result.matrix.redirects, configuredRedirects);
  if (redirectFailures.length) {
    throw new Error(boundedSmokeDiagnostic(
      `production smoke redirect contract validation failed: ${redirectFailures.slice(0, 8).join("; ")}`,
    ));
  }
  return result.matrix;
}

function parseBaseUrl() {
  const baseArg = process.argv.find((value) => value.startsWith("--base-url="))?.split("=").slice(1).join("=");
  const positionalUrl = process.argv.slice(2).find((value) => /^https?:\/\//i.test(value));
  const raw = baseArg || process.env.BASE_URL || process.env.SMOKE_BASE_URL || positionalUrl || DEFAULT_BASE_URL;
  const parsed = new URL(raw);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("BASE_URL must use http or https");
  }

  return parsed.origin;
}

function urlFor(baseUrl, path) {
  if (!isSafeRoutePath(path)) {
    throw new Error("route path must be a bounded safe root-relative path");
  }
  return assertSameOriginUrl(baseUrl, new URL(path, baseUrl), `request ${path}`);
}

export function assertSameOriginUrl(baseUrl, candidateValue, label = "URL") {
  const base = new URL(baseUrl);
  const candidate = new URL(candidateValue, base);
  if (candidate.origin !== base.origin) {
    throw new Error(`${label} must remain same-origin`);
  }
  if (candidate.username || candidate.password) {
    throw new Error(`${label} must not contain URL credentials`);
  }
  return candidate;
}

export function resolveSameOriginRedirect(baseUrl, responseUrl, location) {
  if (typeof location !== "string" || location.length === 0) {
    throw new Error("redirect response did not include a Location header");
  }
  const source = assertSameOriginUrl(baseUrl, responseUrl, "redirect source");
  return assertSameOriginUrl(baseUrl, new URL(location, source), "redirect target");
}

export function assertExpectedRouteUrl(candidate, expectedPath, phase = "target") {
  const stage = phase === "completion" ? "redirect completion" : "redirect target";
  if (!(candidate instanceof URL) || !isSafeRoutePath(expectedPath)) {
    throw new Error(`${stage} contract was invalid`);
  }
  const mismatches = [];
  if (candidate.pathname !== expectedPath) mismatches.push("path mismatch");
  if (candidate.search) mismatches.push("unexpected query");
  if (candidate.hash) mismatches.push("unexpected fragment");
  if (mismatches.length) {
    throw new Error(boundedSmokeDiagnostic(
      `${stage} did not match expected route ${expectedPath} (${mismatches.join(", ")})`,
    ));
  }
  return candidate;
}

async function requestAbsolute(baseUrl, requestUrl, { method = "HEAD" } = {}) {
  const target = assertSameOriginUrl(baseUrl, requestUrl, "request target");
  const response = await fetch(target, {
    method,
    redirect: "manual",
    headers: requestHeaders,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  assertSameOriginUrl(baseUrl, response.url, "response URL");
  return response;
}

async function request(baseUrl, routePath, options = {}) {
  return requestAbsolute(baseUrl, urlFor(baseUrl, routePath), options);
}

async function checkRoute(baseUrl, path) {
  let response = await request(baseUrl, path);

  if (response.status === 405) {
    response = await request(baseUrl, path, { method: "GET" });
  }

  if (response.status !== 200) {
    throw new Error(`${path} expected HTTP 200, got ${response.status}`);
  }

  console.log(`OK route ${path} 200`);
}

async function checkRetiredRoute(baseUrl, path) {
  let response = await request(baseUrl, path);

  if (response.status === 405) {
    response = await request(baseUrl, path, { method: "GET" });
  }

  if (response.status !== 404) {
    throw new Error(`${path} expected retired route HTTP 404, got ${response.status}`);
  }

  console.log(`OK retired route ${path} 404`);
}

export async function inspectBrandedNotFoundResponse(response) {
  if (response.status !== 404) {
    await cancelResponseBody(response);
    throw new Error(`${unknownRoute} expected HTTP 404, got ${response.status}`);
  }
  const body = await readBoundedHtmlResponse(response);

  for (const pattern of [/Page not found/, /Return Home/, /Mōchirīī/]) {
    if (!pattern.test(body)) {
      throw new Error(`${unknownRoute} did not render the branded recovery page`);
    }
  }

  const robotsTags = body.match(/<meta\b[^>]*>/gi) || [];
  const noindex = robotsTags.some((tag) => /name=["']robots["']/i.test(tag) && /content=["'][^"']*\bnoindex\b/i.test(tag));
  if (!noindex) {
    throw new Error(`${unknownRoute} did not render the automatic noindex directive`);
  }
}

export async function checkBrandedNotFound(
  baseUrl,
  { requestImpl = request, reportSuccess = console.log } = {},
) {
  const response = await requestImpl(baseUrl, unknownRoute, { method: "GET" });
  await inspectBrandedNotFoundResponse(response);

  reportSuccess(`OK branded unknown route ${unknownRoute} 404`);
}

async function checkRedirect(baseUrl, from, expectedPath) {
  const first = await request(baseUrl, from);
  assertPermanentRedirectStatus(first.status);

  const target = resolveSameOriginRedirect(baseUrl, first.url, first.headers.get("location"));
  assertExpectedRouteUrl(target, expectedPath);

  let followed = await requestAbsolute(baseUrl, target);
  if (followed.status === 405) {
    followed = await requestAbsolute(baseUrl, target, { method: "GET" });
  }
  const finalUrl = assertSameOriginUrl(baseUrl, followed.url, "redirect completion");
  if (followed.status !== 200) {
    throw new Error(`${from} expected final ${expectedPath} HTTP 200, got ${followed.status}`);
  }
  assertExpectedRouteUrl(finalUrl, expectedPath, "completion");

  console.log(`OK redirect ${from} ${first.status} -> ${expectedPath}`);
}

export async function inspectProductionBodyResponse(response, path, pattern) {
  if (response.status !== 200) {
    await cancelResponseBody(response);
    throw new Error(`${path} body check expected HTTP 200, got ${response.status}`);
  }
  const body = await readBoundedHtmlResponse(response);

  if (/Invalid supabaseUrl/i.test(body)) {
    throw new Error(`${path} rendered Invalid supabaseUrl`);
  }

  if (!pattern.test(body)) {
    throw new Error(`${path} did not render expected signed-out/access content`);
  }
}

export async function checkBody(
  baseUrl,
  path,
  pattern,
  { requestImpl = request, reportSuccess = console.log } = {},
) {
  const response = await requestImpl(baseUrl, path, { method: "GET" });
  await inspectProductionBodyResponse(response, path, pattern);

  reportSuccess(`OK content ${path}`);
}

export async function run() {
  const baseUrl = parseBaseUrl();
  const routeMatrix = loadProductionSmokeContract();
  const cleanRoutes = routeMatrix.routes
    .filter((route) => route.kind === "page" && route.productionSmoke === true)
    .map((route) => route.path);
  const legacyRedirects = new Map(
    routeMatrix.redirects.map((redirect) => [redirect.source, redirect.destination]),
  );
  console.log(`Smoke base: ${baseUrl}`);

  for (const route of cleanRoutes) {
    await checkRoute(baseUrl, route);
  }

  for (const route of retiredRoutes) {
    await checkRetiredRoute(baseUrl, route);
  }

  await checkBrandedNotFound(baseUrl);

  for (const [from, expectedPath] of legacyRedirects) {
    await checkRedirect(baseUrl, from, expectedPath);
  }

  for (const [path, pattern] of bodyChecks) {
    await checkBody(baseUrl, path, pattern);
  }

  console.log("Vercel production smoke check OK.");
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedUrl === import.meta.url) {
  run().catch((error) => {
    console.error(`Vercel production smoke check failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
