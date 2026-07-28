import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SITE_ORIGIN } from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];
const notes = [];
const retiredGameSlug = ["mochi", "social"].join("-");

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

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function fail(message) {
  failures.push(message);
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

  for (const route of allSmokeRoutes) {
    assertRouteListed("production route smoke", smoke, route);
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

async function checkLiveIfRequested() {
  if (process.env.MOCHIRII_OBSERVABILITY_LIVE !== "1") {
    note("Live metadata/header read skipped; set MOCHIRII_OBSERVABILITY_LIVE=1 for read-only production route/header verification.");
    return;
  }

  const baseUrl = process.env.MOCHIRII_PRODUCTION_BASE_URL || SITE_ORIGIN;
  const requiredHeaders = [
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "cross-origin-opener-policy",
    "x-frame-options",
  ];

  for (const route of allSmokeRoutes) {
    const url = new URL(route, baseUrl);
    const response = await fetch(url, {
      headers: { "user-agent": "MochiriiObservabilityMetadataSmoke/1.0" },
      signal: AbortSignal.timeout(30000),
    });
    const html = await response.text();

    assert(response.status === 200, `live ${route}: expected 200, got ${response.status}`);
    assert(/vercel/i.test(response.headers.get("server") || "") || response.headers.get("x-vercel-id"), `live ${route}: expected Vercel headers`);
    for (const header of requiredHeaders) {
      assert(response.headers.get(header), `live ${route}: expected ${header}`);
    }

    if (publicRoutes.some((item) => item.route === route)) {
      await checkLivePublicMetadata({ route, url, html, baseUrl });
    }

    if (noindexRoutes.some((item) => item.route === route)) {
      assert(/<meta name="robots" content="noindex,\s*no(?:follow|archive)|<meta name="robots" content="noindex,\s*follow/i.test(html), `live ${route}: expected noindex robots meta`);
    }
  }
}

async function checkLivePublicMetadata({ route, url, html, baseUrl }) {
  const canonical = extractLink(html, "canonical");
  const expectedCanonical = route === "/" ? `${baseUrl}/` : `${baseUrl}${route}`;
  assert(normalizeUrl(canonical) === normalizeUrl(expectedCanonical), `live ${route}: expected canonical ${expectedCanonical}, got ${canonical || "missing"}`);

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
    const value = extractMeta(html, attribute, name);
    assert(value, `live ${route}: expected ${name} metadata`);
  }

  const ogUrl = extractMeta(html, "property", "og:url");
  assert(normalizeUrl(ogUrl) === normalizeUrl(expectedCanonical), `live ${route}: expected og:url ${expectedCanonical}, got ${ogUrl || "missing"}`);
  assert(extractMeta(html, "name", "twitter:card") === "summary_large_image", `live ${route}: expected twitter summary_large_image card`);

  const imageValues = [
    extractMeta(html, "property", "og:image"),
    extractMeta(html, "name", "twitter:image"),
  ].filter(Boolean);
  for (const imageValue of [...new Set(imageValues)]) {
    await checkReachableImage(new URL(imageValue, url), route);
  }
}

async function checkReachableImage(url, route) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "user-agent": "MochiriiObservabilityMetadataSmoke/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  assert(response.status === 200, `live ${route}: social image ${url.href} expected 200, got ${response.status}`);
  assert(/^image\//i.test(response.headers.get("content-type") || ""), `live ${route}: social image ${url.href} should return image content`);
  await response.body?.cancel?.();
}

function extractLink(html, rel) {
  const pattern = new RegExp(`<link\\b[^>]*\\brel=["']${escapeRegExp(rel)}["'][^>]*>`, "i");
  const tag = html.match(pattern)?.[0] || "";
  return extractAttribute(tag, "href");
}

function extractMeta(html, attribute, value) {
  const pattern = new RegExp(`<meta\\b[^>]*\\b${attribute}=["']${escapeRegExp(value)}["'][^>]*>`, "i");
  const tag = html.match(pattern)?.[0] || "";
  return extractAttribute(tag, "content");
}

function extractAttribute(tag, attribute) {
  const pattern = new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1] || "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  if (url.pathname === "/") url.pathname = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

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
  process.exit(1);
}

console.log(`Observability/metadata smoke validation OK (${publicRoutes.length} public routes, ${noindexRoutes.length} noindex routes).`);
