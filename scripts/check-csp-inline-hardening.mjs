import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { SITE_ORIGIN } from "./lib/public-urls.mjs";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const writeReport = args.has("--write") || process.env.CSP_INLINE_HARDENING_WRITE === "true";
const liveHeaders = args.has("--live") || process.env.CSP_INLINE_HARDENING_LIVE === "true";
const baseUrl = (process.env.CSP_INLINE_HARDENING_BASE_URL || SITE_ORIGIN).replace(/\/+$/, "");
const reportJsonPath = resolve(root, "reports/csp-inline-hardening-inventory.json");
const reportMdPath = resolve(root, "reports/csp-inline-hardening-inventory.md");
const checkedAt = new Date().toISOString();

const failures = [];
const warnings = [];

const routeMatrix = [
  { route: "/", surface: "home shell", features: ["Vercel analytics", "Speed Insights", "gallery media"] },
  { route: "/join", surface: "Discord funnel", features: ["Discord links", "rules and verification copy"] },
  { route: "/events", surface: "events", features: ["event cover images", "filter state"] },
  { route: "/gallery", surface: "gallery", features: ["Supabase signed media", "lightbox", "share status"] },
  { route: "/auth", surface: "auth", features: ["Supabase auth client", "status message"] },
  { route: "/account", surface: "member account", features: ["Supabase auth", "gallery submissions", "social handoff", "status messages"] },
  { route: "/gallery-submit", surface: "gallery submit", features: ["Supabase storage upload", "status message"] },
  { route: "/leader-dashboard", surface: "moderation", features: ["Supabase moderation queues", "status messages"] },
  { route: "/spotify", surface: "Spotify", features: ["Spotify iframe embeds"] },
  { route: "/spotlight", surface: "spotlight", features: ["Supabase public spotlight endpoint"] },
  { route: "/games/mochi-pets", surface: "Mochi Pets", features: ["same-origin tester form", "disconnected waiting room"] },
  { route: "/tome", surface: "Tome", features: ["static conduct content"] },
];

const nextConfigPath = resolve(root, "apps/web/next.config.ts");
const nextConfig = readRequired(nextConfigPath);
const policy = inspectPolicy(nextConfig);
const protectedCspSource = readRequired(resolve(root, "apps/web/lib/security/protected-csp.ts"));
const proxySource = readRequired(resolve(root, "apps/web/proxy.ts"));
const protectedRouteHardening = {
  routes: ["/leader-dashboard", "/oauth/consent"],
  nonceBound: protectedCspSource.includes("'nonce-${nonce}'"),
  strictDynamic: protectedCspSource.includes("'strict-dynamic'"),
  scriptUnsafeInline: /script-src[^\n]*unsafe-inline/.test(protectedCspSource),
  proxyApplied:
    proxySource.includes('const SUPABASE_SESSION_PATHS = new Set(["/leader-dashboard", "/oauth/consent"])') &&
    proxySource.includes('requestHeaders.set("Content-Security-Policy", contentSecurityPolicy)'),
};
const sourceInventory = inspectSource(policy.directiveMap);
for (const origin of sourceInventory.externalOrigins.filter((entry) => entry.allowedBy.length === 0)) {
  warnings.push(`${origin.origin} appears in app source but is not currently allowed by CSP; confirm it is not runtime-loaded before tightening.`);
}
const live = liveHeaders ? await inspectLiveHeaders() : { status: "skipped", reason: "run with --live to check production headers" };

if (!policy.headerEnforced) failures.push("apps/web/next.config.ts must set Content-Security-Policy.");
if (policy.reportOnlyMentioned) failures.push("apps/web/next.config.ts must not use Content-Security-Policy-Report-Only.");
if (policy.unsafeEvalDirectives.length) {
  failures.push(`CSP must not allow unsafe-eval: ${policy.unsafeEvalDirectives.join(", ")}`);
}
if (policy.unsafeInlineDirectives.some((directive) => !["script-src", "style-src"].includes(directive))) {
  failures.push(`unsafe-inline is only expected in script-src/style-src during this staged pass.`);
}
if (
  !protectedRouteHardening.nonceBound ||
  !protectedRouteHardening.strictDynamic ||
  protectedRouteHardening.scriptUnsafeInline ||
  !protectedRouteHardening.proxyApplied
) {
  failures.push("Protected auth routes must use the reviewed nonce-bound strict script policy.");
}
if (sourceInventory.blockingHits.length) {
  for (const hit of sourceInventory.blockingHits) {
    failures.push(`${hit.file}:${hit.line}: ${hit.label} requires a CSP review before inline hardening.`);
  }
}
if (!directiveHasSource(policy.directiveMap, "frame-src", "https://open.spotify.com")) {
  failures.push("CSP frame-src must explicitly allow Spotify embeds.");
}
if (
  !directiveHasSource(policy.directiveMap, "connect-src", "https://*.supabase.co") ||
  !directiveHasSource(policy.directiveMap, "connect-src", "wss://*.supabase.co")
) {
  failures.push("CSP connect-src must allow Supabase API and realtime origins.");
}

const report = {
  ok: failures.length === 0,
  checkedAt,
  scope:
    "CSP inline hardening inventory for the Vercel/Next production app. This is a no-secret, read-only pass that prepares the later browser-verified unsafe-inline reduction.",
  baseUrl,
  policy,
  protectedRouteHardening,
  sourceInventory,
  routeMatrix,
  live,
  nextSteps: [
    "Keep React inline style props at zero before any style-src unsafe-inline removal.",
    "Run a Vercel Preview browser pass before removing style-src unsafe-inline because framework-managed image/route helpers can still emit runtime style attributes.",
    "Keep Spotify iframe routes in the browser route sweep.",
    "Verify Supabase auth/storage, Discord handoff links, Vercel Analytics, and Speed Insights before tightening CSP.",
    "Keep nonce-based strict script CSP on the already-dynamic auth routes and include them in every browser release sweep.",
    "Keep public routes static while Turbopack lacks stable hash-based SRI; reconsider global script-src unsafe-inline only when a cache-compatible stable path exists.",
  ],
  warnings,
  failures,
};

const markdown = renderMarkdown(report);
scanRenderedReport("json", JSON.stringify(report));
scanRenderedReport("markdown", markdown);
report.ok = failures.length === 0;

if (writeReport) {
  mkdirSync(dirname(reportJsonPath), { recursive: true });
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(reportMdPath, renderMarkdown(report), "utf8");
}

if (!report.ok) {
  console.error("CSP inline hardening inventory failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("CSP inline hardening inventory OK.");
console.log(`- unsafe-inline directives: ${policy.unsafeInlineDirectives.join(", ") || "none"}`);
console.log(`- strict protected routes: ${protectedRouteHardening.routes.join(", ")}`);
console.log(`- React inline style props: ${sourceInventory.patterns.inlineStyleProp.count}`);
console.log(`- iframe elements: ${sourceInventory.patterns.iframeElement.count}`);
console.log(`- live header check: ${live.status}`);
if (writeReport) {
  console.log(`- JSON report: ${pathForReport(reportJsonPath)}`);
  console.log(`- Markdown report: ${pathForReport(reportMdPath)}`);
}

function inspectPolicy(text) {
  const entries = extractCspEntries(text);
  const directiveMap = {};
  for (const entry of entries) {
    const [directive, ...sources] = entry.split(/\s+/).filter(Boolean);
    if (!directive) continue;
    directiveMap[directive] = sources;
  }
  const unsafeInlineDirectives = Object.entries(directiveMap)
    .filter(([, sources]) => sources.includes("'unsafe-inline'"))
    .map(([directive]) => directive);
  const unsafeEvalDirectives = Object.entries(directiveMap)
    .filter(([, sources]) => sources.includes("'unsafe-eval'"))
    .map(([directive]) => directive);
  const externalOrigins = inspectExternalOrigins(text, directiveMap);

  return {
    headerEnforced: /key:\s*["']Content-Security-Policy["']/.test(text),
    reportOnlyMentioned: /Content-Security-Policy-Report-Only/.test(text),
    entries,
    directiveMap,
    unsafeInlineDirectives,
    unsafeEvalDirectives,
    inlineReductionReady: unsafeInlineDirectives.length === 0,
    externalOrigins,
  };
}

function extractCspEntries(text) {
  const match = text.match(/const contentSecurityPolicy = \[([\s\S]*?)\]\.join\("; "\);/);
  if (!match) {
    failures.push("apps/web/next.config.ts: unable to locate contentSecurityPolicy array.");
    return [];
  }
  const entries = [];
  for (const rawLine of match[1].split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    line = line.replace(/,\s*$/, "").trim();
    const quote = line[0];
    if (!["'", '"', "`"].includes(quote) || line[line.length - 1] !== quote) continue;
    const entry = line.slice(1, -1).trim();
    if (entry) entries.push(entry);
  }
  return entries;
}

function inspectExternalOrigins(text, directiveMap) {
  const urls = findUrls(text);
  const origins = [...new Set(urls.map((url) => url.origin))].sort();
  return origins.map((origin) => ({
    origin,
    allowedBy: Object.entries(directiveMap)
      .filter(([, sources]) => sources.some((source) => sourceAllowsOrigin(source, origin)))
      .map(([directive]) => directive),
  }));
}

function inspectSource(directiveMap) {
  const dirs = ["apps/web/app", "apps/web/components", "apps/web/lib"];
  const files = dirs.flatMap((dir) => collectFiles(resolve(root, dir))).filter((file) =>
    [".ts", ".tsx", ".js", ".jsx", ".css"].includes(extname(file)),
  );
  const patterns = {
    inlineStyleProp: { label: "React inline style prop", severity: "inventory", regex: /\bstyle\s*=\s*\{\{/g, hits: [] },
    iframeElement: { label: "iframe element", severity: "inventory", regex: /<iframe\b/g, hits: [] },
    scriptElement: { label: "script element", severity: "review", regex: /<script\b/g, hits: [] },
    nextScriptImport: { label: "next/script import", severity: "review", regex: /from\s+["']next\/script["']/g, hits: [] },
    dangerouslySetInnerHTML: {
      label: "dangerouslySetInnerHTML",
      severity: "block",
      regex: /\bdangerouslySetInnerHTML\b/g,
      hits: [],
    },
    srcDoc: { label: "iframe srcDoc", severity: "block", regex: /\bsrcDoc\b/g, hits: [] },
    evalCall: { label: "eval call", severity: "block", regex: /\beval\s*\(/g, hits: [] },
    newFunction: { label: "new Function", severity: "block", regex: /\bnew\s+Function\b/g, hits: [] },
  };
  const externalOrigins = new Map();

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = pathForReport(file);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of Object.values(patterns)) {
        pattern.regex.lastIndex = 0;
        const matches = line.match(pattern.regex);
        if (!matches) continue;
        pattern.hits.push({ file: rel, line: index + 1, count: matches.length });
      }
    });
    for (const url of findUrls(text)) {
      if (!externalOrigins.has(url.origin)) externalOrigins.set(url.origin, new Set());
      externalOrigins.get(url.origin).add(rel);
    }
  }

  const summarizedPatterns = Object.fromEntries(
    Object.entries(patterns).map(([id, pattern]) => [
      id,
      {
        label: pattern.label,
        severity: pattern.severity,
        count: pattern.hits.reduce((total, hit) => total + hit.count, 0),
        files: summarizeHitFiles(pattern.hits),
        hits: pattern.hits,
      },
    ]),
  );
  const allBlockingHits = Object.entries(summarizedPatterns)
    .filter(([, pattern]) => pattern.severity === "block")
    .flatMap(([patternId, pattern]) => pattern.hits.map((hit) => ({ ...hit, patternId, label: pattern.label })));
  const reviewedBlockingHits = allBlockingHits.filter(isReviewedInlineUsage);
  const blockingHits = allBlockingHits.filter((hit) => !isReviewedInlineUsage(hit));

  return {
    scannedFiles: files.length,
    scannedRoots: dirs,
    patterns: summarizedPatterns,
    blockingHits,
    reviewedBlockingHits,
    externalOrigins: [...externalOrigins.entries()]
      .map(([origin, originFiles]) => ({
        origin,
        allowedBy: Object.entries(directiveMap)
          .filter(([, sources]) => sources.some((source) => sourceAllowsOrigin(source, origin)))
          .map(([directive]) => directive),
        files: [...originFiles].sort(),
      }))
      .sort((a, b) => a.origin.localeCompare(b.origin)),
  };
}

function isReviewedInlineUsage(hit) {
  if (hit.patternId !== "dangerouslySetInnerHTML" || hit.file !== "apps/web/app/page.tsx") return false;
  const source = readFileSync(resolve(root, hit.file), "utf8");
  const occurrences = source.match(/\bdangerouslySetInnerHTML\b/g) || [];
  return (
    occurrences.length === 1 &&
    source.includes('type="application/ld+json"') &&
    source.includes("function serializeJsonLd") &&
    source.includes("JSON.stringify(value).replace(/</g") &&
    source.includes("\\\\u003c")
  );
}

async function inspectLiveHeaders() {
  const results = [];
  for (const route of routeMatrix) {
    const url = `${baseUrl}${route.route}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Mochirii CSP inline hardening inventory",
        },
      });
      const csp = response.headers.get("content-security-policy") || "";
      const reportOnly = response.headers.get("content-security-policy-report-only") || "";
      const parsed = parseCspHeader(csp);
      const result = {
        route: route.route,
        status: response.status,
        cspPresent: Boolean(csp),
        reportOnlyPresent: Boolean(reportOnly),
        unsafeInlineDirectives: Object.entries(parsed)
          .filter(([, sources]) => sources.includes("'unsafe-inline'"))
          .map(([directive]) => directive),
        unsafeEvalDirectives: Object.entries(parsed)
          .filter(([, sources]) => sources.includes("'unsafe-eval'"))
          .map(([directive]) => directive),
      };
      if (!result.cspPresent) failures.push(`${route.route}: live response missing Content-Security-Policy.`);
      if (result.reportOnlyPresent) failures.push(`${route.route}: live response should not include report-only CSP.`);
      if (result.unsafeEvalDirectives.length) {
        failures.push(`${route.route}: live CSP allows unsafe-eval in ${result.unsafeEvalDirectives.join(", ")}.`);
      }
      results.push(result);
    } catch (error) {
      failures.push(`${route.route}: live header check failed: ${error?.message || error}`);
      results.push({ route: route.route, status: "error", error: error?.message || String(error) });
    }
  }
  return {
    status: "checked",
    baseUrl,
    routes: results,
  };
}

function parseCspHeader(header) {
  const parsed = {};
  for (const directiveText of String(header || "").split(";")) {
    const [directive, ...sources] = directiveText.trim().split(/\s+/).filter(Boolean);
    if (directive) parsed[directive] = sources;
  }
  return parsed;
}

function directiveHasSource(directiveMap, directive, expectedSource) {
  return Array.isArray(directiveMap[directive]) && directiveMap[directive].includes(expectedSource);
}

function renderMarkdown(report) {
  const directiveRows = Object.entries(report.policy.directiveMap)
    .map(([directive, sources]) => `| ${directive} | ${sources.join(" ")} |`)
    .join("\n");
  const patternRows = Object.entries(report.sourceInventory.patterns)
    .map(
      ([id, pattern]) =>
        `| ${id} | ${pattern.severity} | ${pattern.count} | ${pattern.files.map((entry) => `${entry.file} (${entry.count})`).join("<br>") || "none"} |`,
    )
    .join("\n");
  const routeRows = report.routeMatrix
    .map((entry) => `| ${entry.route} | ${entry.surface} | ${entry.features.join(", ")} |`)
    .join("\n");
  const liveRows =
    report.live.status === "checked"
      ? report.live.routes
          .map(
            (entry) =>
              `| ${entry.route} | ${entry.status} | ${entry.cspPresent ? "yes" : "no"} | ${entry.reportOnlyPresent ? "yes" : "no"} | ${entry.unsafeInlineDirectives?.join(", ") || "none"} |`,
          )
          .join("\n")
      : `| skipped | ${report.live.reason} | n/a | n/a | n/a |`;
  const originRows =
    report.sourceInventory.externalOrigins
      .map((entry) => `| ${entry.origin} | ${entry.allowedBy.join(", ") || "none"} | ${entry.files.join("<br>")} |`)
      .join("\n") || "| none | none | none |";
  const nextSteps = report.nextSteps.map((step) => `- ${step}`).join("\n");
  const warningsText = report.warnings.length ? report.warnings.map((warning) => `- ${warning}`).join("\n") : "- None";
  const failuresText = report.failures.length ? report.failures.map((failure) => `- ${failure}`).join("\n") : "- None";

  return `# CSP Inline Hardening Inventory

Generated: ${report.checkedAt}

This file is intentionally no-secret. It inventories the current CSP and inline-sensitive production app source before any future removal of \`unsafe-inline\`.

## Result

- OK: ${report.ok ? "yes" : "no"}
- Base URL: ${report.baseUrl}
- CSP enforced in Next config: ${report.policy.headerEnforced ? "yes" : "no"}
- Report-only CSP in Next config: ${report.policy.reportOnlyMentioned ? "yes" : "no"}
- Unsafe-inline directives: ${report.policy.unsafeInlineDirectives.join(", ") || "none"}
- Unsafe-eval directives: ${report.policy.unsafeEvalDirectives.join(", ") || "none"}
- Scanned source files: ${report.sourceInventory.scannedFiles}

## Directives

| Directive | Sources |
| --- | --- |
${directiveRows}

## Inline-Sensitive Source Inventory

| Pattern | Severity | Count | Files |
| --- | --- | ---: | --- |
${patternRows}

## External Origins In App Source

| Origin | Allowed by CSP | Files |
| --- | --- | --- |
${originRows}

## Browser Route Matrix

| Route | Surface | CSP-sensitive features |
| --- | --- | --- |
${routeRows}

## Live Header Sweep

| Route | Status | CSP | Report-only | Unsafe-inline |
| --- | ---: | --- | --- | --- |
${liveRows}

## Next Steps

${nextSteps}

## Warnings

${warningsText}

## Failures

${failuresText}
`;
}

function collectFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      files.push(...collectFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function summarizeHitFiles(hits) {
  const counts = new Map();
  for (const hit of hits) counts.set(hit.file, (counts.get(hit.file) || 0) + hit.count);
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

function findUrls(text) {
  const urls = [];
  const pattern = /https?:\/\/[^\s"'`<>)}]+/g;
  for (const match of String(text || "").matchAll(pattern)) {
    if (match[0].includes("${") || match[0].includes("}")) continue;
    try {
      urls.push(new URL(match[0].replace(/[.,;]+$/, "")));
    } catch {
      // Ignore non-URL source fragments.
    }
  }
  return urls;
}

function sourceAllowsOrigin(source, origin) {
  if (!source || source === "data:" || source === "blob:") return false;
  if (source === "'self'") return origin === new URL(baseUrl).origin;
  if (source === origin) return true;
  if (source.startsWith("https://*.")) {
    const suffix = source.replace("https://*.", "");
    return origin === `https://${suffix}` || origin.endsWith(`.${suffix}`);
  }
  return false;
}

function scanRenderedReport(label, text) {
  const forbiddenPatterns = [
    { label: "GitHub token", pattern: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/ },
    { label: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{12,}\b/ },
    { label: "JWT-like token", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
    { label: "Discord bot token", pattern: /\b[A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}\b/ },
    {
      label: "Discord webhook URL",
      pattern: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
    },
    { label: "Private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/ },
    { label: "raw cookie header", pattern: /\bCookie:\s*[^;\s]+=/i },
  ];
  String(text || "")
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const { label: patternLabel, pattern } of forbiddenPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) failures.push(`rendered ${label} report line ${index + 1}: ${patternLabel}`);
      }
    });
}

function readRequired(file) {
  if (!existsSync(file)) {
    failures.push(`${pathForReport(file)}: missing required file.`);
    return "";
  }
  return readFileSync(file, "utf8");
}

function pathForReport(file) {
  return relative(root, file).replace(/\\/g, "/");
}
