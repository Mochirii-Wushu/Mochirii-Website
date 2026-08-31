import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateAppRouteMatrix } from "./lib/app-router-inventory.mjs";
import { SITE_ORIGIN } from "./lib/public-urls.mjs";
import { readBoundedHtmlResponse } from "./smoke-vercel-production.mjs";

const root = process.cwd();
export const OBSERVABILITY_DIAGNOSTIC_LIMITS = Object.freeze({
  messages: 64,
  messageCharacters: 256,
  aggregateCharacters: 8192,
  metadataUrlCharacters: 2048,
});
const FAILURE_OVERFLOW = "additional observability failures were suppressed";

export function createObservabilityFailureRecorder() {
  const messages = [];
  let aggregateCharacters = 0;
  let saturated = false;

  function record(message) {
    if (saturated) return;
    const raw = typeof message === "string" ? message : "observability validation failed";
    const bounded = raw.length <= OBSERVABILITY_DIAGNOSTIC_LIMITS.messageCharacters
      ? raw
      : `${raw.slice(0, OBSERVABILITY_DIAGNOSTIC_LIMITS.messageCharacters - 3)}...`;
    const reservesOverflow = messages.length < OBSERVABILITY_DIAGNOSTIC_LIMITS.messages - 1
      && aggregateCharacters + bounded.length
        <= OBSERVABILITY_DIAGNOSTIC_LIMITS.aggregateCharacters - FAILURE_OVERFLOW.length;
    if (reservesOverflow) {
      messages.push(bounded);
      aggregateCharacters += bounded.length;
      return;
    }
    if (messages.length < OBSERVABILITY_DIAGNOSTIC_LIMITS.messages
      && aggregateCharacters + FAILURE_OVERFLOW.length <= OBSERVABILITY_DIAGNOSTIC_LIMITS.aggregateCharacters) {
      messages.push(FAILURE_OVERFLOW);
      aggregateCharacters += FAILURE_OVERFLOW.length;
    }
    saturated = true;
  }

  return { messages, record };
}

const failureRecorder = createObservabilityFailureRecorder();
const failures = failureRecorder.messages;
const notes = [];
const retiredGameSlug = ["mochi", "social"].join("-");
const routeMatrixResult = validateAppRouteMatrix({
  appDirectory: path.join(root, "apps", "web", "app"),
  matrixPath: path.join(root, "apps", "web", "config", "app-route-matrix.v1.json"),
});
for (const failure of routeMatrixResult.failures) {
  failureRecorder.record(`production route matrix: ${failure}`);
}
const routeMatrixRows = Array.isArray(routeMatrixResult.matrix?.routes) ? routeMatrixResult.matrix.routes : [];
const productionSmokeRoutes = new Set(
  routeMatrixRows
    .filter((route) => route && typeof route === "object" && !Array.isArray(route)
      && route.kind === "page" && route.productionSmoke === true)
    .map((route) => route.path),
);

const publicRoutes = [
  { route: "/", label: "home", file: "apps/web/app/page.tsx", metadataFile: "apps/web/app/layout.tsx" },
  { route: "/join", key: "join", file: "apps/web/app/join/page.tsx" },
  { route: "/events", key: "events", file: "apps/web/app/events/page.tsx" },
  { route: "/gallery", key: "gallery", file: "apps/web/app/gallery/page.tsx" },
  { route: "/ranks", key: "ranks", file: "apps/web/app/ranks/page.tsx" },
  { route: "/leaders", key: "leaders", file: "apps/web/app/leaders/page.tsx" },
  { route: "/tome", key: "tome", file: "apps/web/app/tome/page.tsx" },
  { route: "/recruitment", key: "recruitment", file: "apps/web/app/recruitment/page.tsx" },
  { route: "/announcements", key: "announcements", file: "apps/web/app/announcements/page.tsx" },
  { route: "/raffle", key: "raffle", file: "apps/web/app/raffle/page.tsx" },
  { route: "/spotify", key: "spotify", file: "apps/web/app/spotify/page.tsx" },
  { route: "/spotlight", key: "spotlight", file: "apps/web/app/spotlight/page.tsx" },
  { route: "/twills", key: "twills", file: "apps/web/app/twills/page.tsx" },
  { route: "/privacy", key: "privacy", file: "apps/web/app/privacy/page.tsx" },
  { route: "/meta-data-deletion", key: "metaDataDeletion", file: "apps/web/app/meta-data-deletion/page.tsx" },
  { route: "/games/mochi-pets", key: "mochiPets", file: "apps/web/app/games/mochi-pets/page.tsx" },
];

const protectedRoutes = [
  { route: "/auth", file: "apps/web/app/auth/page.tsx", expectedFollow: true },
  { route: "/account", file: "apps/web/app/account/page.tsx", expectedFollow: true },
  { route: "/gallery-submit", file: "apps/web/app/gallery-submit/page.tsx", expectedFollow: true },
  { route: "/leader-dashboard", file: "apps/web/app/leader-dashboard/page.tsx", expectedFollow: true },
];

const retiredRoutes = [
  { route: "/members", file: "apps/web/app/members/page.tsx" },
  { route: "/members/twills", file: "apps/web/app/members/[slug]/page.tsx" },
  { route: `/games/${retiredGameSlug}`, file: `apps/web/app/games/${retiredGameSlug}/page.tsx` },
];

const noindexRoutes = [...protectedRoutes];

const allSmokeRoutes = [...publicRoutes.map((item) => item.route), ...noindexRoutes.map((item) => item.route)];
const allSmokeRouteSet = new Set(allSmokeRoutes);
const requiredLiveHeaders = [
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "x-frame-options",
];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function fail(message) {
  failureRecorder.record(message);
}

function note(message) {
  notes.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertIncludes(label, text, snippet) {
  assert(text.includes(snippet), `${label}: expected snippet not found: ${snippet}`);
}

function assertRouteListed(label, text, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert(new RegExp(`["']${escaped}["']`).test(text), `${label}: expected route ${route}`);
}

function checkLayoutObservability() {
  const layout = read("apps/web/app/layout.tsx");
  const routeShell = read("apps/web/components/SiteRouteShell.tsx");

  assertIncludes("root layout", layout, 'import { SiteRouteShell } from "@/components/SiteRouteShell";');
  assertIncludes("root layout", layout, 'import { SITE_ORIGIN } from "@/lib/public-urls";');
  assertIncludes("root layout", layout, "<SiteRouteShell>{children}</SiteRouteShell>");
  assertIncludes("root layout", layout, "metadataBase: new URL(SITE_ORIGIN)");
  assertIncludes("root layout", layout, 'canonical: "/"');

  assertIncludes("route-aware site shell", routeShell, 'import { Analytics } from "@vercel/analytics/next";');
  assertIncludes("route-aware site shell", routeShell, 'import { SpeedInsights } from "@vercel/speed-insights/next";');
  assertIncludes("route-aware site shell", routeShell, 'pathname === "/spinner"');
  assertIncludes("route-aware site shell", routeShell, 'pathname.startsWith("/spinner/")');
  assertIncludes("route-aware site shell", routeShell, "if (isIsolatedSpinnerPath(pathname)) return children;");
  assertIncludes("route-aware site shell", routeShell, "<Analytics />");
  assertIncludes("route-aware site shell", routeShell, "<SpeedInsights />");
}

function checkPublicMetadata() {
  const metadata = read("apps/web/components/public-pages/metadata.ts");

  assertIncludes("public metadata helper", metadata, "openGraph");
  assertIncludes("public metadata helper", metadata, "twitter");
  assertIncludes("public metadata helper", metadata, "canonical: meta.path");
  assertIncludes("public metadata helper", metadata, "metadataFor(page: PageKey)");

  for (const item of publicRoutes) {
    if (item.route === "/") continue;
    const source = read(item.file);
    assertIncludes(item.file, source, `metadataFor("${item.key}")`);
    assertIncludes("public metadata helper", metadata, `${item.key}:`);
    assertIncludes("public metadata helper", metadata, `path: "${item.route}"`);
    assertIncludes("public metadata helper", metadata, "image:");
  }
}

function checkProtectedNoindex() {
  for (const item of noindexRoutes) {
    const source = read(item.file);
    assertIncludes(item.file, source, "robots:");
    assertIncludes(item.file, source, "index: false");
    assertIncludes(item.file, source, `follow: ${item.expectedFollow ? "true" : "false"}`);

    assertIncludes(item.file, source, `canonical: "${item.route}"`);
  }
}

function checkRetiredRoutes() {
  const smoke = read("scripts/smoke-vercel-production.mjs");

  for (const item of retiredRoutes) {
    assert(!existsSync(path.join(root, item.file)), `${item.file}: retired members route file must stay removed.`);
    if (item.route === `/games/${retiredGameSlug}`) {
      assertIncludes("production retired route smoke", smoke, "retiredGameRoute");
    } else {
      assertRouteListed("production retired route smoke", smoke, item.route);
    }
  }
}

function checkDiscoveryFiles() {
  const sitemap = read("apps/web/public/sitemap.xml");
  const robots = read("apps/web/public/robots.txt");

  for (const item of publicRoutes) {
    const loc = item.route === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${item.route}`;
    assertIncludes("sitemap", sitemap, `<loc>${loc}</loc>`);
  }

  for (const item of noindexRoutes) {
    assert(!sitemap.includes(`${SITE_ORIGIN}${item.route}`), `sitemap: protected route must stay excluded: ${item.route}`);
  }

  for (const item of retiredRoutes) {
    assert(!sitemap.includes(`${SITE_ORIGIN}${item.route}`), `sitemap: retired route must stay excluded: ${item.route}`);
  }

  assertIncludes("robots", robots, `Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
}

function checkProductionSmokeCoverage() {
  const smoke = read("scripts/smoke-vercel-production.mjs");
  assertIncludes("production route smoke", smoke, "app-route-matrix.v1.json");
  assertIncludes("production route smoke", smoke, "route.productionSmoke === true");

  for (const route of allSmokeRoutes) {
    assert(productionSmokeRoutes.has(route), `production route matrix: expected route ${route}`);
  }

  for (const route of ["/auth", "/account", "/gallery-submit", "/leader-dashboard", "/games/mochi-pets"]) {
    assert(smoke.includes(`["${route}",`) || smoke.includes(`['${route}',`), `production body smoke: expected content check for ${route}`);
  }
}

function checkDocs() {
  const deployment = read("docs/operations/deployment.md");
  const currentState = read("docs/current-live-state.md");
  const readme = read("apps/web/README.md");

  assertIncludes("deployment docs", deployment, "Post-deploy observability smoke");
  assertIncludes("deployment docs", deployment, "Cloudflare remains DNS-only");
  assertIncludes("current live state", currentState, "Vercel Web Analytics and Speed Insights");
  assertIncludes("app README", readme, "## Vercel Observability");
}

async function cancelLiveResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Cancellation failure must not replace a categorical validation result.
  }
}

function parseLiveBaseOrigin(value) {
  if (typeof value !== "string" || value.length === 0
    || value.length > OBSERVABILITY_DIAGNOSTIC_LIMITS.metadataUrlCharacters) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash) return null;
  return parsed.origin;
}

function isRedirectStatus(status) {
  return Number.isInteger(status) && status >= 300 && status <= 399;
}

function responseMatchesExactRequest(response, requestedUrl) {
  if (!(requestedUrl instanceof URL)
    || !["http:", "https:"].includes(requestedUrl.protocol)
    || requestedUrl.username
    || requestedUrl.password
    || response?.redirected !== false
    || typeof response.url !== "string"
    || response.url.length === 0
    || response.url.length > OBSERVABILITY_DIAGNOSTIC_LIMITS.metadataUrlCharacters) return false;
  let observed;
  try {
    observed = new URL(response.url);
  } catch {
    return false;
  }
  return ["http:", "https:"].includes(observed.protocol)
    && !observed.username
    && !observed.password
    && observed.origin === requestedUrl.origin
    && observed.href === requestedUrl.href;
}

function hasUtf8HtmlMediaType(response) {
  const contentType = response?.headers?.get?.("content-type");
  if (typeof contentType !== "string" || contentType.length > 256) return false;
  const normalized = asciiLower(contentType);
  return /^[\t ]*text\/html[\t ]*;[\t ]*charset=(?:"utf-8"|utf-8)[\t ]*$/.test(normalized);
}

export async function checkLiveIfRequested({
  fetchImpl = fetch,
  recordFailure = fail,
  liveEnabled = process.env.MOCHIRII_OBSERVABILITY_LIVE === "1",
  baseUrl = process.env.MOCHIRII_PRODUCTION_BASE_URL || SITE_ORIGIN,
  routes = allSmokeRoutes,
} = {}) {
  if (!liveEnabled) {
    note("Live metadata/header read skipped; set MOCHIRII_OBSERVABILITY_LIVE=1 for read-only production route/header verification.");
    return;
  }

  if (!Array.isArray(routes) || routes.some((route) => !allSmokeRouteSet.has(route))) {
    throw new Error("observability route selection was invalid");
  }

  const normalizedBaseUrl = parseLiveBaseOrigin(baseUrl);
  if (!normalizedBaseUrl) {
    recordFailure("live observability base URL rejected");
    return;
  }

  for (const route of routes) {
    const url = new URL(route, `${normalizedBaseUrl}/`);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { "user-agent": "MochiriiObservabilityMetadataSmoke/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      recordFailure(`live ${route}: route request failed`);
      continue;
    }
    try {
      await inspectLiveObservabilityResponse({
        route,
        url,
        response,
        baseUrl: normalizedBaseUrl,
        isPublic: publicRoutes.some((item) => item.route === route),
        isNoindex: noindexRoutes.some((item) => item.route === route),
        fetchImpl,
        recordFailure,
      });
    } catch {
      recordFailure(`live ${route}: HTML response rejected`);
    }
  }
}

export async function inspectLiveObservabilityResponse({
  route,
  url,
  response,
  baseUrl,
  isPublic,
  isNoindex,
  fetchImpl = fetch,
  recordFailure = fail,
}) {
  const exactResponseUrl = responseMatchesExactRequest(response, url);
  if (isRedirectStatus(response.status)) {
    recordFailure(`live ${route}: route redirect rejected`);
    await cancelLiveResponseBody(response);
    return;
  }
  if (!exactResponseUrl) {
    recordFailure(`live ${route}: route response URL rejected`);
    await cancelLiveResponseBody(response);
    return;
  }
  if (response.status !== 200) {
    recordFailure(`live ${route}: unexpected HTTP status`);
    await cancelLiveResponseBody(response);
    return;
  }
  if (!hasUtf8HtmlMediaType(response)) {
    recordFailure(`live ${route}: UTF-8 HTML media type rejected`);
    await cancelLiveResponseBody(response);
    return;
  }
  if (!(/vercel/i.test(response.headers.get("server") || "") || response.headers.get("x-vercel-id"))) {
    recordFailure(`live ${route}: expected Vercel headers`);
  }
  for (const header of requiredLiveHeaders) {
    if (!response.headers.get(header)) recordFailure(`live ${route}: expected ${header}`);
  }
  const html = await readBoundedHtmlResponse(response);
  const metadata = createActiveMetadataReader(html);

  if (isPublic) {
    await checkLivePublicMetadata({ route, url, metadata, baseUrl, fetchImpl, recordFailure });
  }
  const robots = metadata.meta("name", "robots");
  if (isNoindex && !/^noindex,\s*(?:nofollow|noarchive|follow)$/i.test(robots)) {
    recordFailure(`live ${route}: expected noindex robots meta`);
  }
}

async function checkLivePublicMetadata({ route, url, metadata, baseUrl, fetchImpl, recordFailure }) {
  const canonical = metadata.link("canonical");
  const expectedCanonical = route === "/" ? `${baseUrl}/` : `${baseUrl}${route}`;
  if (normalizeUrl(canonical) !== normalizeUrl(expectedCanonical)) {
    recordFailure(`live ${route}: canonical metadata mismatch`);
  }

  const requiredMeta = [
    ["og:title", "property"],
    ["og:description", "property"],
    ["og:url", "property"],
    ["og:image", "property"],
    ["twitter:card", "name"],
    ["twitter:title", "name"],
    ["twitter:description", "name"],
    ["twitter:image", "name"],
  ];

  for (const [name, attribute] of requiredMeta) {
    const value = metadata.meta(attribute, name);
    if (!value) recordFailure(`live ${route}: expected ${name} metadata`);
  }

  const ogUrl = metadata.meta("property", "og:url");
  if (normalizeUrl(ogUrl) !== normalizeUrl(expectedCanonical)) {
    recordFailure(`live ${route}: og:url metadata mismatch`);
  }
  if (metadata.meta("name", "twitter:card") !== "summary_large_image") {
    recordFailure(`live ${route}: expected twitter summary_large_image card`);
  }

  const imageValues = [
    metadata.meta("property", "og:image"),
    metadata.meta("name", "twitter:image"),
  ].filter(Boolean);
  for (const imageValue of [...new Set(imageValues)]) {
    const imageUrl = resolveSameOriginMetadataImage(url, imageValue);
    if (!imageUrl) {
      recordFailure(`live ${route}: social image URL rejected`);
      continue;
    }
    await checkReachableImage(imageUrl, route, { fetchImpl, recordFailure });
  }
}

export function resolveSameOriginMetadataImage(pageUrl, imageValue) {
  if (typeof imageValue !== "string" || imageValue.length === 0
    || imageValue.length > OBSERVABILITY_DIAGNOSTIC_LIMITS.metadataUrlCharacters
    || imageValue.includes("&")) return null;
  let page;
  let candidate;
  try {
    page = pageUrl instanceof URL ? pageUrl : new URL(pageUrl);
    candidate = new URL(imageValue, page);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(candidate.protocol)
    || candidate.origin !== page.origin
    || candidate.username
    || candidate.password
    || candidate.href.length > OBSERVABILITY_DIAGNOSTIC_LIMITS.metadataUrlCharacters
    || candidate.search
    || candidate.hash
    || candidate.href.includes("?")
    || candidate.href.includes("#")
    || !candidate.pathname.startsWith("/assets/")) return null;
  return candidate;
}

async function checkReachableImage(url, route, { fetchImpl, recordFailure }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "user-agent": "MochiriiObservabilityMetadataSmoke/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    recordFailure(`live ${route}: social image request failed`);
    return;
  }
  const exactResponseUrl = responseMatchesExactRequest(response, url);
  if (isRedirectStatus(response.status)) {
    recordFailure(`live ${route}: social image redirect rejected`);
    await cancelLiveResponseBody(response);
    return;
  }
  if (!exactResponseUrl) {
    recordFailure(`live ${route}: social image response URL rejected`);
    await cancelLiveResponseBody(response);
    return;
  }
  if (response.status !== 200) {
    recordFailure(`live ${route}: social image returned unexpected status`);
    await cancelLiveResponseBody(response);
    return;
  }
  if (!/^image\//i.test(response.headers.get("content-type") || "")) {
    recordFailure(`live ${route}: social image returned non-image content`);
  }
  await cancelLiveResponseBody(response);
}

const RAW_TEXT_ELEMENTS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);
const FOREIGN_METADATA_CONTAINERS = new Set(["math", "svg"]);
const INERT_METADATA_CONTAINERS = new Set(["math", "select", "svg", "template"]);
const OBSERVABILITY_INERT_CONTAINER_DEPTH_LIMIT = 64;
const OBSERVABILITY_METADATA_TAG_LIMIT = 256;
const OBSERVABILITY_METADATA_ATTRIBUTES = new Set(["content", "href", "name", "property", "rel"]);

function asciiLower(value) {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function isHtmlSpace(character) {
  return character === "\t" || character === "\n" || character === "\f"
    || character === "\r" || character === " ";
}

function findMarkupDeclarationEnd(html, start) {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function findHtmlTagEnd(html, start) {
  let state = "before-name";
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (state === "quoted-value") {
      if (character === quote) {
        quote = "";
        state = "before-name";
      }
      continue;
    }
    if (character === ">") return index;
    if (state === "before-name") {
      if (isHtmlSpace(character) || character === "/") continue;
      state = "name";
      continue;
    }
    if (state === "name") {
      if (isHtmlSpace(character)) state = "after-name";
      else if (character === "/") state = "before-name";
      else if (character === "=") state = "before-value";
      continue;
    }
    if (state === "after-name") {
      if (isHtmlSpace(character)) continue;
      if (character === "/") state = "before-name";
      else if (character === "=") state = "before-value";
      else state = "name";
      continue;
    }
    if (state === "before-value") {
      if (isHtmlSpace(character)) continue;
      if (character === '"' || character === "'") {
        quote = character;
        state = "quoted-value";
      } else {
        state = "unquoted-value";
      }
      continue;
    }
    if (state === "unquoted-value" && isHtmlSpace(character)) state = "before-name";
  }
  return -1;
}

function parseHtmlTagAt(html, start) {
  let cursor = start + 1;
  let closing = false;
  if (html[cursor] === "/") {
    closing = true;
    cursor += 1;
  }
  const nameStart = cursor;
  while (cursor < html.length && !/[\t\n\f\r />]/.test(html[cursor])) cursor += 1;
  if (cursor === nameStart) return null;
  const name = asciiLower(html.slice(nameStart, cursor));
  const end = findHtmlTagEnd(html, cursor);
  if (end < 0) {
    return { attributes: new Map(), closing, duplicates: new Set(), end: html.length, malformed: true, name };
  }
  if (closing) {
    return { attributes: new Map(), closing, duplicates: new Set(), end, malformed: false, name };
  }

  const attributes = new Map();
  const duplicates = new Set();
  while (cursor < end) {
    while (cursor < end && /[\t\n\f\r ]/.test(html[cursor])) cursor += 1;
    if (cursor >= end || html[cursor] === "/") {
      cursor += 1;
      continue;
    }
    const attributeStart = cursor;
    if (html[cursor] === "=") cursor += 1;
    while (cursor < end && !/[\t\n\f\r />=]/.test(html[cursor])) cursor += 1;
    if (cursor === attributeStart) {
      cursor += 1;
      continue;
    }
    const attributeName = asciiLower(html.slice(attributeStart, cursor));
    while (cursor < end && /[\t\n\f\r ]/.test(html[cursor])) cursor += 1;
    let value = "";
    if (html[cursor] === "=") {
      cursor += 1;
      while (cursor < end && /[\t\n\f\r ]/.test(html[cursor])) cursor += 1;
      const quote = html[cursor] === '"' || html[cursor] === "'" ? html[cursor] : "";
      if (quote) {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < end && html[cursor] !== quote) cursor += 1;
        if (cursor >= end) {
          return { attributes, closing, duplicates, end, malformed: true, name };
        }
        value = html.slice(valueStart, cursor);
        cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < end && !/[\t\n\f\r >]/.test(html[cursor])) cursor += 1;
        value = html.slice(valueStart, cursor);
      }
    }
    if (OBSERVABILITY_METADATA_ATTRIBUTES.has(attributeName)) {
      if (attributes.has(attributeName)) duplicates.add(attributeName);
      else attributes.set(attributeName, value);
    }
  }
  return { attributes, closing, duplicates, end, malformed: false, name };
}

function findRawTextClose(html, asciiLowerHtml, start, name) {
  const needle = "</" + name;
  const scriptEscapeStart = name === "script" ? html.indexOf("<!--", start) : -1;
  let cursor = start;
  while (cursor < html.length) {
    const closingStart = asciiLowerHtml.indexOf(needle, cursor);
    if (closingStart < 0) return -1;
    const boundary = html[closingStart + needle.length];
    if (scriptEscapeStart >= 0 && scriptEscapeStart < closingStart) return -1;
    if (boundary === ">" || boundary === "/" || isHtmlSpace(boundary)) {
      const closingTag = parseHtmlTagAt(html, closingStart);
      if (closingTag?.closing && !closingTag.malformed && closingTag.name === name) {
        return closingTag.end + 1;
      }
      return -1;
    }
    cursor = closingStart + needle.length;
  }
  return -1;
}

function collectActiveMetadataTags(html) {
  if (typeof html !== "string") return [];
  const asciiLowerHtml = asciiLower(html);
  const tags = [];
  const inertContainers = [];
  let foreignContainerDepth = 0;
  let cursor = 0;

  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const commentEnd = html.indexOf("-->", start + 4);
      if (commentEnd < 0) return null;
      cursor = commentEnd + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", start) && foreignContainerDepth > 0) {
      const cdataEnd = html.indexOf("]]>", start + 9);
      if (cdataEnd < 0) break;
      cursor = cdataEnd + 3;
      continue;
    }
    if (html[start + 1] === "!" || html[start + 1] === "?") {
      const declarationEnd = findMarkupDeclarationEnd(html, start + 2);
      if (declarationEnd < 0) return null;
      cursor = declarationEnd + 1;
      continue;
    }

    const tag = parseHtmlTagAt(html, start);
    if (!tag) {
      cursor = start + 1;
      continue;
    }
    if (tag.malformed) return null;
    cursor = tag.end + 1;

    if (tag.closing) {
      if (inertContainers.at(-1) === tag.name) {
        inertContainers.pop();
        if (FOREIGN_METADATA_CONTAINERS.has(tag.name)) foreignContainerDepth -= 1;
      }
      else if (inertContainers.length > 0) continue;
      continue;
    }

    if (tag.name === "frameset") return null;

    if (RAW_TEXT_ELEMENTS.has(tag.name)) {
      if (tag.name === "plaintext") break;
      const rawTextEnd = findRawTextClose(html, asciiLowerHtml, cursor, tag.name);
      if (rawTextEnd < 0) return null;
      cursor = rawTextEnd;
      continue;
    }
    if (INERT_METADATA_CONTAINERS.has(tag.name)) {
      if (inertContainers.length >= OBSERVABILITY_INERT_CONTAINER_DEPTH_LIMIT) return null;
      inertContainers.push(tag.name);
      if (FOREIGN_METADATA_CONTAINERS.has(tag.name)) foreignContainerDepth += 1;
      continue;
    }
    if (inertContainers.length > 0) continue;
    if (tag.name === "link" || tag.name === "meta") {
      if (tags.length >= OBSERVABILITY_METADATA_TAG_LIMIT) return null;
      tags.push(tag);
    }
  }
  return inertContainers.length === 0 ? tags : null;
}

function createActiveMetadataReader(html) {
  const tags = collectActiveMetadataTags(html);
  const rejected = tags === null;
  const metadataTags = tags || [];
  return Object.freeze({
    link(rel) {
      if (rejected) return "";
      const matches = [];
      for (const tag of metadataTags) {
        if (tag.name !== "link") continue;
        if (tag.duplicates.has("rel") || tag.duplicates.has("href")) return "";
        const relTokens = asciiLower(tag.attributes.get("rel") || "")
          .split(/[\t\n\f\r ]+/)
          .filter(Boolean);
        if (relTokens.includes(asciiLower(rel))) matches.push(tag.attributes.get("href") || "");
      }
      return matches.length === 1 ? matches[0] : "";
    },
    meta(attribute, value) {
      if (rejected) return "";
      const matches = [];
      for (const tag of metadataTags) {
        if (tag.name !== "meta") continue;
        if (tag.duplicates.has(attribute) || tag.duplicates.has("content")) return "";
        if (asciiLower(tag.attributes.get(attribute) || "") === asciiLower(value)) {
          matches.push(tag.attributes.get("content") || "");
        }
      }
      return matches.length === 1 ? matches[0] : "";
    },
  });
}

function normalizeUrl(value) {
  if (typeof value !== "string" || value.length === 0
    || value.length > OBSERVABILITY_DIAGNOSTIC_LIMITS.metadataUrlCharacters) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
  if (url.pathname === "/") url.pathname = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

export async function run() {
  await checkLiveIfRequested();
  checkLayoutObservability();
  checkPublicMetadata();
  checkProtectedNoindex();
  checkRetiredRoutes();
  checkDiscoveryFiles();
  checkProductionSmokeCoverage();
  checkDocs();

  for (const message of notes) {
    console.log(`NOTE ${message}`);
  }

  if (failures.length) {
    console.error("Observability/metadata smoke validation failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Observability/metadata smoke validation OK (${publicRoutes.length} public routes, ${noindexRoutes.length} noindex routes).`);
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedUrl === import.meta.url) {
  run().catch(() => {
    console.error("Observability/metadata smoke validation failed [UNEXPECTED]");
    process.exitCode = 1;
  });
}
