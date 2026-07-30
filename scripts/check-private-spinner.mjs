import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures = [];

function read(file) {
  const full = resolve(root, file);
  if (!existsSync(full)) {
    failures.push(`${file}: missing required file.`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function includes(label, source, snippet) {
  if (!source.includes(snippet)) failures.push(`${label}: missing ${snippet}`);
}

function excludes(label, source, snippet) {
  if (source.includes(snippet)) failures.push(`${label}: must not include ${snippet}`);
}

function before(label, source, first, second) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    failures.push(`${label}: expected ${first} before ${second}`);
  }
}

function beforeLast(label, source, first, second) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.lastIndexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    failures.push(`${label}: expected ${first} before the final ${second}`);
  }
}

const files = {
  page: "apps/web/app/spinner/page.tsx",
  spinnerLayout: "apps/web/app/spinner/layout.tsx",
  authorized: "apps/web/app/spinner/authorized.tsx",
  notFound: "apps/web/app/spinner/not-found.tsx",
  sessionRoute: "apps/web/app/spinner/session/route.ts",
  liveRoute: "apps/web/app/spinner/live/route.ts",
  proxyOutcome: "apps/web/lib/spinner/proxy-outcome.ts",
  proxy: "apps/web/proxy.ts",
  access: "apps/web/lib/spinner/access.ts",
  policy: "apps/web/lib/spinner/session-policy.ts",
  viewerHandoff: "apps/web/lib/spinner/viewer-handoff.ts",
  viewerHandoffAuthority: "apps/web/lib/spinner/viewer-handoff-authority.ts",
  stage: "apps/web/components/spinner/SpinnerStage.tsx",
  clientEntry: "apps/web/components/spinner/SpinnerClientEntry.tsx",
  guard: "apps/web/components/spinner/SpinnerSessionGuard.tsx",
  controller: "apps/web/components/spinner/RaffleSpinner.tsx",
  viewer: "apps/web/components/spinner/ViewerRaffleSpinner.tsx",
  live: "apps/web/components/spinner/live.ts",
  countdownHook: "apps/web/components/spinner/use-spinner-countdown.ts",
  raffle: "apps/web/components/spinner/raffle.ts",
  celebration: "apps/web/components/spinner/celebration.ts",
  celebrationScene: "apps/web/components/spinner/celebration-scene.ts",
  wheel: "apps/web/components/spinner/wheel.ts",
  css: "apps/web/public/assets/css/member-spinner.css",
  account: "apps/web/components/member-workflow/AccountPanel.tsx",
  dashboard: "apps/web/components/member-workflow/LeaderDashboard.tsx",
  auth: "apps/web/lib/supabase/auth.ts",
  layout: "apps/web/app/layout.tsx",
  siteShell: "apps/web/components/SiteRouteShell.tsx",
  nextConfig: "apps/web/next.config.ts",
  robots: "apps/web/public/robots.txt",
  sitemap: "apps/web/public/sitemap.xml",
  runbook: "docs/operations/private-spinner.md",
  dispatcherReadme: "supabase/functions/reaper-spinner-dispatch/README.md",
  supabaseConfig: "supabase/config.toml",
};

const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(file)]));

if (existsSync(resolve(root, "apps/web/app/favicon.ico"))) {
  failures.push("spinner metadata boundary: app-level file metadata would force the branded favicon onto the opaque 404.");
}
if (!existsSync(resolve(root, "apps/web/public/favicon.ico"))) {
  failures.push("ordinary site metadata: public favicon is missing after removing app-level file metadata.");
}
includes("ordinary site metadata", source.layout, 'icon: "/favicon.ico"');

[
  'export const dynamic = "force-dynamic";',
  "export const revalidate = 0;",
  "await getSpinnerRequestAccess()",
  "notFound();",
  'await import("./authorized")',
  "noarchive: true",
  "nosnippet: true",
  "noimageindex: true",
  "openGraph: null",
  "twitter: null",
  "canonical: null",
  'title: "Page unavailable"',
  "icons: { icon: [], apple: [] }",
].forEach((snippet) => includes("spinner page", source.page, snippet));
before("spinner page authorization", source.page, "if (!access.ok) notFound();", 'await import("./authorized")');
excludes("spinner page shell", source.page, "member-spinner.css");
includes("authorized spinner surface", source.authorized, 'preinit("/assets/css/member-spinner.css", { as: "style", precedence: "spinner" })');

for (const snippet of [
  'title: "Page unavailable"',
  'description: "Page unavailable."',
  "canonical: null",
  "openGraph: null",
  "twitter: null",
  "icons: { icon: [], apple: [] }",
  "noarchive: true",
  "nosnippet: true",
  "noimageindex: true",
]) includes("spinner metadata boundary", source.spinnerLayout, snippet);

includes("spinner not-found", source.notFound, "Page unavailable.");
excludes("spinner not-found", source.notFound, "Raffle Spinner");
excludes("spinner not-found", source.notFound, "SpinnerViewerBootstrap");
excludes("spinner not-found", source.notFound, '"use client"');

for (const snippet of [
  'request.nextUrl.pathname !== `${SPINNER_PAGE_PATH}/`',
  'request.method !== "GET" && request.method !== "HEAD"',
  "decodeSpinnerSessionCookie(",
  "validateSpinnerAccessTokenForMode({",
  "mode: session.mode",
  "access.mode !== session.mode",
  "new NextResponse(null, {",
  "status: 404",
  "NextResponse.next()",
  'matcher: ["/spinner"]',
  'path: SPINNER_PAGE_PATH',
  "httpOnly: true",
  "secure: true",
  'sameSite: "strict"',
  "maxAge: 0",
  "expires: new Date(0)",
]) includes("spinner page proxy", source.proxy, snippet);
excludes("spinner page proxy", source.proxy, 'matcher: ["/spinner/:path*"]');
beforeLast(
  "spinner page proxy authorization",
  source.proxy,
  "validateSpinnerAccessTokenForMode({",
  "return NextResponse.next();",
);

[
  "SPINNER_SESSION_COOKIE",
  "mochirii_spinner_access_v1",
  'sameSite: "strict"',
  'path: "/spinner"',
  "httpOnly: true",
  "secure: true",
  "SPINNER_SESSION_TTL_SECONDS = 10 * 60",
  'Vary: "Cookie"',
  '"Cache-Control": "private, no-store, max-age=0"',
  'export type SpinnerAccessMode = "controller" | "viewer"',
  "resolveSpinnerAccessToken",
  "validateSpinnerAccessTokenForMode",
  "galleryEligible !== true",
  'memberStatus !== "active"',
].forEach((snippet) => includes("spinner session policy", source.policy, snippet));

[
  "export async function POST",
  "export async function GET",
  "export async function DELETE",
  "requestIsSameOrigin(request, true)",
  "requestIsSameOrigin(request, false)",
  '"X-Spinner-Mode": mode',
  'request.headers.get("X-Spinner-Mode")',
  "status: 404",
  "status: 204",
  "clearSpinnerCookie",
].forEach((snippet) => includes("spinner session route", source.sessionRoute, snippet));

[
  'import "server-only";',
  "getSpinnerRequestSession",
  "validateSpinnerAccessToken",
  "SUPABASE_PUBLISHABLE_KEY",
].forEach((snippet) => includes("spinner server access", source.access, snippet));
excludes("spinner server access", source.access, "SERVICE_ROLE");

[
  'src="/assets/img/spinner/mochirii-banner.webp"',
  'className="spinner-page"',
  "<SpinnerSessionGuard mode={mode}>",
  "<SpinnerClientEntry mode={mode} />",
].forEach((snippet) => includes("spinner stage", source.stage, snippet));
excludes("spinner stage", source.stage, "RaffleSpinner");

[
  'lazy(async () =>',
  'import("./ModeratorRaffleSpinner")',
  'import("./ViewerRaffleSpinner")',
  'mode === "controller"',
  "<Suspense",
].forEach((snippet) => includes("mode-split client entry", source.clientEntry, snippet));

for (const snippet of [
  "void checkSession();",
  "window.setInterval",
  'window.addEventListener("focus"',
  'window.addEventListener(SPINNER_SESSION_INVALID_EVENT',
  'document.addEventListener("visibilitychange"',
  'mode === "controller" ? "/leader-dashboard" : "/account"',
]) includes("spinner heartbeat", source.guard, snippet);

[
  'fetch("/spinner/live"',
  'credentials: "same-origin"',
  'cache: "no-store"',
  "SPINNER_SESSION_INVALID_EVENT",
  "parseSpinnerLiveSnapshot",
  "createSpinnerCommandId",
  "spin_result_not_durable",
  "isTerminalSpinnerSpinFailure",
  "spinnerSkipStateForDraw",
  "spinnerLiveMotionRotations",
  "commandId",
].forEach((snippet) => includes("same-origin live client", source.live, snippet));
for (const forbidden of ["WebSocket", "realtime.send", "wss://", "https://", "http://", "Math.random"]) {
  excludes("same-origin live client", source.live, forbidden);
}

for (const snippet of [
  "decodeSpinnerSessionCookie",
  "parseJwtExpiryMs",
  "requestIsSameOrigin(request, true)",
  'session.mode !== "controller"',
  'method: "GET"',
  'method: "POST"',
  'Authorization: `Bearer ${accessToken}`',
  '"X-Mochirii-Spinner-Mode": mode',
  'SPINNER_OUTCOME_HEADER = "X-Mochirii-Spinner-Outcome"',
  "await cancelResponseBody(response)",
  "readBoundedResponseText(response, MAX_RESPONSE_BYTES)",
  "spinnerProxyOutcomeForStatus(method, response.status)",
  'recordProxyError("response_too_large", response.status)',
  '"access-denied"',
  '"upstream-error"',
  'console.error("spinner_live_proxy_error"',
  "/functions/v1/spinner-live-session",
  "MAX_COMMAND_BYTES",
  "UPSTREAM_TIMEOUT_MS",
]) includes("same-origin live proxy", source.liveRoute, snippet);
includes("same-origin live proxy outcomes", source.proxyOutcome, '"rate-limited"');
includes("same-origin live proxy outcomes", source.proxyOutcome, 'method === "POST"');
excludes("same-origin live proxy", source.liveRoute, "SERVICE_ROLE");

for (const forbidden of [
  "<button",
  "<input",
  "<select",
  "<textarea",
  "<form",
  "<details",
  "<a ",
  "<Link",
  "onClick=",
  "onChange=",
  "sendSpinnerLiveCommand",
  "createSpinnerCommandId",
]) excludes("view-only spinner", source.viewer, forbidden);
for (const required of [
  "useSpinnerLive",
  'role="status"',
  'aria-live="polite"',
  'className="roster-panel roster-panel--viewer"',
  'className="roster-scroll" tabIndex={0} role="region"',
  "SETTINGS_STORAGE_KEY",
  'useState<MotionMode>("full")',
  "resolveInitialViewerMotion(initialStoredValue, media.matches)",
  'drawMode === "test"',
  "Test draw · no public result",
  'animationName: "spinner-live-wheel-turn"',
  'wheelMotionHasStarted && motionMode === "full"',
  "spinnerLiveMotionRotations(snapshot, motionMode)",
  "resolveCelebrationMotionMode(",
  "if (nextMotionMode !== effectiveMotionRef.current) stopCelebration();",
  "queueWinnerCelebration(snapshot.drawId, snapshot.revealAt)",
  "requestAnimationFrame(() =>",
  "authoritativeNowMs",
  "protectedRegion: winnerRevealRef.current?.getBoundingClientRect()",
  'motionPreferenceReady && motionMode !== "off" ? (',
  'appliedKeyRef.current = ""',
  "refreshLiveRef.current?.()",
]) includes("view-only spinner", source.viewer, required);

for (const required of [
  "sendSpinnerLiveCommand",
  'action: "set_roster"',
  'action: "spin"',
  "pendingCommand.drawMode",
  "window.confirm",
  "Test spin",
  "No guild announcement or public result",
  'action: "reset"',
  'animationName: "spinner-live-wheel-turn"',
  "&& !skipRequestedRef.current",
  "isTerminalSpinnerSpinFailure(error)",
  "spinnerSkipStateForDraw({",
  'wheelMotionHasStarted && effectiveMotionMode === "full"',
  "spinnerLiveMotionRotations(snapshot, selectedMotion)",
  'id="main"',
  'src="/assets/img/brand/emblem.webp"',
  "Mōchirīī-roster-",
  "Mōchirīī-receipt-",
  "const celebrationWasActive = celebrationRef.current?.active === true;",
  "if (celebrationWasActive) stopCelebration();",
  "queueCelebration(drawId, snapshot?.revealAt);",
  "requestAnimationFrame(() =>",
  "authoritativeNowMs",
  "protectedRegion: winnerRevealRef.current?.getBoundingClientRect()",
  'hydrated && effectiveMotionMode !== "off" ? (',
]) includes("moderator spinner", source.controller, required);
excludes("moderator spinner", source.controller, "onTransitionEnd");
excludes("moderator spinner", source.controller, "document.documentElement.requestFullscreen");

for (const page of [
  ["moderator spinner", source.controller],
  ["view-only spinner", source.viewer],
]) {
  for (const snippet of [
    "Mōchirīī Guild · Raffle Wheel",
    "All members welcome to watch the pretty wheel spin for pretty Mōchī gifts in the monthly guild raffle!",
    "Mōchi Selection",
    "useSpinnerCountdown",
    "spinnerServerClockAnchorForSnapshot(",
    "serverClockAnchorRef.current,",
    "setServerClockAnchor(nextClockAnchor)",
    "spinnerLiveTimeline(snapshot, serverNowMs,",
    "serverNowMs >= revealAtMs",
    'role="timer"',
    'aria-live="off"',
    "The roster is locked. The moonwheel countdown is underway.",
    "The shared draw is underway.",
    'event.animationName === "spinner-live-wheel-turn"',
  ]) includes(page[0], page[1], snippet);
  for (const staleCopy of [
    "Mōchirīī Guild · Fair Draw Studio",
    "Mōchirīī Guild · Live Draw",
    "Every name, one equal chance.",
    "Moonlit selection chamber",
  ]) excludes(page[0], page[1], staleCopy);
}

for (const snippet of [
  "spinnerServerClockNow(serverClockAnchor, performance.now())",
  "[serverClockAnchor, startedAt]",
]) includes("monotonic spinner countdown", source.countdownHook, snippet);
excludes("monotonic spinner countdown", source.countdownHook, "Date.now()");

[
  "getCurrentSession",
  'method: "POST"',
  '"X-Spinner-Mode": requestedMode',
  '"X-Spinner-Preserve-Session": "true"',
  "openPrivateSpinnerViewerHandoff",
].forEach((snippet) => includes("central spinner launcher", source.auth, snippet));
includes("leader dashboard launcher", source.dashboard, 'id="spinnerLaunchPanel"');
includes("leader dashboard launcher", source.dashboard, 'result.mode !== "controller"');
includes("leader dashboard launcher", source.dashboard, 'openPrivateSpinnerSession("controller")');
includes("leader dashboard launcher", source.dashboard, 'window.location.assign("/spinner")');
excludes("leader dashboard launcher", source.dashboard, 'href="/spinner"');
includes("verified viewer launcher", source.account, "const spinnerViewerAvailable = access.ok && !moderatorAvailable;");
includes("verified viewer launcher", source.account, "{spinnerViewerAvailable ? (");
includes("verified viewer launcher", source.account, "openSpinnerViewer");
includes("verified viewer launcher", source.account, 'openPrivateSpinnerSession("viewer")');
includes("verified viewer launcher", source.account, 'window.location.assign("/spinner")');
for (const snippet of [
  'values.length === 1 && values[0] === "live-draw"',
  'url.searchParams.delete("open")',
]) includes("verified viewer handoff intent", source.viewerHandoff, snippet);
for (const snippet of [
  "decodeSpinnerSessionCookie(encodedSession)",
  "currentExpiryMs > nowMs",
  "validateAccess(current.accessToken, current.mode)",
  'validateAccess(viewerAccessToken, "viewer")',
]) includes("verified viewer handoff authority", source.viewerHandoffAuthority, snippet);
for (const snippet of [
  'preserveSession !== "true" || requestedMode !== "viewer"',
  "authorizeSpinnerViewerHandoff({",
  "encodedSession: request.cookies.get(SPINNER_SESSION_COOKIE)?.value",
  ": opaqueDenied(access.clearCookie)",
]) includes("atomic viewer handoff route", source.sessionRoute, snippet);
for (const snippet of [
  "consumeLiveDrawHandoffIntent(window.location.href)",
  "window.history.replaceState",
  "liveDrawHandoffStartedRef.current",
  "openPrivateSpinnerViewerHandoff()",
  'window.location.replace("/spinner")',
]) includes("verified viewer handoff", source.account, snippet);
includes("verified viewer motion preference", source.account, "updateSpinnerViewerMotion");
includes("verified viewer motion preference", source.account, "Live draw motion");
includes("verified viewer motion preference", source.account, "SETTINGS_STORAGE_KEY");
includes("central sign-out", source.auth, "await clearPrivateSpinnerSession();");

for (const snippet of [
  'pathname === "/spinner"',
  'pathname.startsWith("/spinner/")',
  "if (isIsolatedSpinnerPath(pathname)) return children;",
]) includes("route-aware site shell", source.siteShell, snippet);
for (const snippet of [
  "<SiteHeader {...auth} />",
  '<SiteFooter authState={auth.authState} launchSpinnerViewer={auth.launchSpinnerViewer} />',
  "<Analytics />",
  "<SpeedInsights />",
]) {
  includes("ordinary route site shell", source.siteShell, snippet);
  excludes("root layout", source.layout, snippet.slice(0, -3));
}
includes("root layout", source.layout, "<SiteRouteShell>{children}</SiteRouteShell>");

for (const snippet of [
  "poweredByHeader: false",
  "skipTrailingSlashRedirect: true",
  'source: "/spinner/:path*"',
  '"connect-src \'self\'"',
  'value: "private, no-store, max-age=0"',
  'value: "noindex, nofollow, noarchive, nosnippet, noimageindex"',
]) includes("spinner response headers", source.nextConfig, snippet);
includes("robots", source.robots, "Disallow: /spinner");
excludes("sitemap", source.sitemap, "https://mochirii.com/spinner");

const configuredFunctions = Array.from(
  source.supabaseConfig.matchAll(/^\[functions\.([^\]]+)\]$/gmu),
  (match) => match[1],
);
const expectedConfiguredFunctions = [
  "verify-discord-member",
  "verify-member-access",
  "review-member-verification",
  "list-gallery-review-queue",
  "spinner-live-session",
  "moderate-gallery-submission",
  "delete-rejected-gallery-submission",
  "withdraw-gallery-publication-consent",
  "list-approved-gallery-submissions",
  "submit-discord-gallery-image",
  "reaper-discord-interactions",
  "reaper-spinner-dispatch",
  "reaper-discord-member-sync",
  "send-vote-reminder",
  "send-member-spotlight-poll",
  "publish-member-spotlight-winner",
  "get-current-spotlight-winner",
  "list-instagram-publish-queue",
  "publish-instagram-gallery-submission",
  "resolve-instagram-publish-reconciliation",
  "mark-instagram-gallery-submission-shared",
  "check-instagram-api-status",
  "list-facebook-page-publish-queue",
  "publish-facebook-page-gallery-submission",
  "resolve-facebook-page-publish-reconciliation",
  "check-facebook-page-api-status",
  "list-member-profiles",
  "list-visible-profile-cards",
  "get-member-profile",
  "submit-member-profile-media",
  "list-member-profile-media-queue",
  "moderate-member-profile-media",
  "mochi-pets-alpha-session",
  "mochi-pets-unity-auth",
  "mochi-pets-alpha-action",
  "mochi-pets-alpha-progress",
  "mochi-pets-alpha-admin",
  "submit-mochi-pets-feedback",
  "sync-pixelfed-social-account",
];
const configuredFunctionSet = new Set(configuredFunctions);
const expectedFunctionSet = new Set(expectedConfiguredFunctions);
const missingConfiguredFunctions = expectedConfiguredFunctions.filter(
  (functionName) => !configuredFunctionSet.has(functionName),
);
const unexpectedConfiguredFunctions = configuredFunctions.filter(
  (functionName) => !expectedFunctionSet.has(functionName),
);
if (
  configuredFunctions.length !== expectedConfiguredFunctions.length ||
  configuredFunctionSet.size !== configuredFunctions.length ||
  missingConfiguredFunctions.length ||
  unexpectedConfiguredFunctions.length
) {
  failures.push(
    `spinner release inventory: expected the exact reviewed ${expectedConfiguredFunctions.length}-function configuration; ` +
      `missing ${missingConfiguredFunctions.join(", ") || "none"}; ` +
      `unexpected ${unexpectedConfiguredFunctions.join(", ") || "none"}; ` +
      `found ${configuredFunctions.length} entries (${configuredFunctionSet.size} unique).`,
  );
}
for (const functionName of ["spinner-live-session", "reaper-spinner-dispatch"]) {
  if (!configuredFunctions.includes(functionName)) {
    failures.push(`spinner release inventory: missing ${functionName}.`);
  }
}
const metaGalleryFunctions = new Set([
  "withdraw-gallery-publication-consent",
  "resolve-instagram-publish-reconciliation",
  "list-facebook-page-publish-queue",
  "publish-facebook-page-gallery-submission",
  "resolve-facebook-page-publish-reconciliation",
  "check-facebook-page-api-status",
]);
for (const functionName of expectedConfiguredFunctions.filter(
  (configuredFunction) => !metaGalleryFunctions.has(configuredFunction),
)) {
  includes(
    "spinner operations runbook inventory",
    source.runbook,
    `\`${functionName}\``,
  );
}

for (const snippet of [
  "all 33 Edge Functions declared in `supabase/config.toml`",
  "The Preview database is data-less by design",
  "select count(*)::integer as total_rows",
  '"claimed": 0',
  '"results": []',
  "Do not create a synthetic guild result.",
  "https://mochirii.com/account?open=live-draw",
  "reaper_spinner_dispatch_secret",
  "REAPER_SPINNER_DISPATCH_SECRET",
  "The migration is forward-only.",
  "A protected revert or forward-fix merge invokes the same 33-function production integration",
  "Do not retry blindly.",
  "operator_reconciled_start",
  "and phase = 'start_pending'",
  "and discord_message_id is null",
]) includes("spinner operations runbook", source.runbook, snippet);

for (const snippet of [
  "redeploys all 33 functions declared in",
  "zero claimed, completed,",
  "Never retry blindly",
  "forward-fix migration",
]) includes("spinner dispatcher runbook", source.dispatcherReadme, snippet);

function withoutStaticImports(value) {
  const kept = [];
  let insideImport = false;
  for (const line of value.split(/\r?\n/u)) {
    if (!insideImport && /^\s*import(?:\s|\{|\*)/u.test(line)) {
      insideImport = !line.trimEnd().endsWith(";");
      continue;
    }
    if (insideImport) {
      if (line.trimEnd().endsWith(";")) insideImport = false;
      continue;
    }
    kept.push(line);
  }
  return kept
    .join("\n")
    // These are null/empty metadata boundary keys, not rendered brand copy.
    .replace(/\b(?:apple|twitter)\s*:/giu, "");
}

// This guard covers product-facing spinner source only. Dependency, license,
// provenance, and operations documents retain their accurate internal names.
const forbiddenRenderedBrandPatterns = [
  { label: "artificial-intelligence wording", pattern: /\b(?:AI|artificial intelligence)\b/iu },
  { label: "agent wording", pattern: /\bagents?\b/iu },
  { label: "assistant-product branding", pattern: /\b(?:OpenAI|ChatGPT|GPT(?:-\d+)?|Codex|Anthropic|Claude|Gemini|Copilot)\b/iu },
  { label: "framework or runtime branding", pattern: /\b(?:Next\.js|React|Angular|Vue|Svelte|Node\.js|Deno|Bun)\b/iu },
  { label: "source-hosting branding", pattern: /\b(?:GitHub|GitLab|Bitbucket)\b/iu },
  { label: "hosting or data-provider branding", pattern: /\b(?:Vercel|Cloudflare|Netlify|Supabase|Firebase|MongoDB|PostgreSQL|AWS)\b/iu },
  { label: "company branding", pattern: /\b(?:Google|Meta|Microsoft|Apple|Amazon|Shopify|Canva|Figma)\b/iu },
  { label: "social or media branding", pattern: /\b(?:Discord|Slack|Instagram|Facebook|Twitter|TikTok|YouTube|Spotify|Pixelfed)\b/iu },
  { label: "game branding", pattern: /\bWhere Winds Meet\b/iu },
  { label: "implementation branding", pattern: /\b(?:Web Crypto|TypeScript|JavaScript|npm|pnpm|Docker)\b/iu },
];

for (const [label, renderedSource] of Object.entries({
  page: source.page,
  spinnerLayout: source.spinnerLayout,
  notFound: source.notFound,
  stage: source.stage,
  clientEntry: source.clientEntry,
  guard: source.guard,
  controller: source.controller,
  viewer: source.viewer,
})) {
  const surfaceSource = withoutStaticImports(renderedSource);
  for (const forbidden of forbiddenRenderedBrandPatterns) {
    if (forbidden.pattern.test(surfaceSource)) {
      failures.push(`rendered ${label}: must not include ${forbidden.label}`);
    }
  }
  if (/https?:\/\//iu.test(surfaceSource)) failures.push(`rendered ${label}: external URL found.`);
  if (/<iframe\b/iu.test(surfaceSource)) failures.push(`rendered ${label}: iframe found.`);
}

for (const [label, productionSource] of Object.entries({
  controller: source.controller,
  viewer: source.viewer,
  live: source.live,
  raffle: source.raffle,
  celebration: source.celebration,
  celebrationScene: source.celebrationScene,
  wheel: source.wheel,
})) {
  excludes(label, productionSource, "Math.random");
  excludes(label, productionSource, "XMLHttpRequest");
}
for (const snippet of [
  "standard: {",
  "durationMs: 4_800",
  "maxParticles: 156",
  "maxBackingPixels: 8_300_000",
  "maxParticles: 96",
  "maxBackingPixels: 4_200_000",
  "durationMs: 2_400",
  "maxParticles: 32",
  "maxBackingPixels: 3_000_000",
  'return preferredMode === "full" && prefersReducedMotion ? "reduced" : preferredMode;',
  'presentationSeed(`${drawId}:${profile}`)',
]) includes("bounded deterministic celebration", source.celebrationScene, snippet);
for (const effect of [
  "paint-splash",
  "neon-stream",
  "ribbon",
  "petal",
  "bubble",
  "droplet",
  "streak",
  "firework",
  "star",
  "spark",
  "bloom",
]) includes("celebration effects", source.celebrationScene, effect);
for (const snippet of [
  "document.hidden",
  'window.addEventListener("resize", stopOnResize',
  'document.addEventListener("fullscreenchange", stopOnResize)',
  'window.matchMedia("(forced-colors: active)")',
  "canvas.getClientRects().length === 0",
  "new ResizeObserver",
  "clearProtectedRegion",
  "canvas.width = 0",
  "canvas.height = 0",
]) includes("celebration lifecycle", source.celebration, snippet);

for (const key of [
  "mochirii.raffle.roster.v1",
  "mochirii.raffle.settings.v1",
  "mochirii.raffle.receipts.v1",
  "uniform-uint32-rejection-v1",
]) includes("raffle contract", source.raffle, key);

for (const forbidden of ["@import", "@font-face", ":root", 'url("/assets/wuxia-bg.webp")', 'url("/assets/raffle-hero.webp")']) {
  excludes("spinner CSS", source.css, forbidden);
}
source.css.split(/\r?\n/).forEach((line, index) => {
  const value = line.trim();
  if (!value.endsWith("{") || value.startsWith("@") || /^(?:from|to|\d+(?:\.\d+)?%)/.test(value)) return;
  if (!value.startsWith(".spinner-page")) failures.push(`spinner CSS line ${index + 1}: selector is not scoped: ${value}`);
});
includes("spinner CSS", source.css, "@keyframes spinner-wheel-aura");
includes("spinner CSS", source.css, "@keyframes spinner-live-wheel-turn");
includes("spinner CSS", source.css, "@keyframes spinner-celebration-stage-bloom");
includes("spinner CSS", source.css, "@keyframes spinner-winner-crown");
includes("spinner CSS", source.css, "animation-delay: var(--spinner-celebration-delay, 0ms)");
includes("spinner CSS", source.css, ".spinner-page .raffle-app.is-motion-reduced .draw-stage");
includes("spinner CSS", source.css, ".spinner-page .spinner-test-control");
includes("spinner CSS", source.css, ".spinner-page .spinner-test-badge");
excludes("spinner CSS", source.css, "@keyframes wheel-aura");

const assetPath = resolve(root, "apps/web/public/assets/img/spinner/mochirii-banner.webp");
if (!existsSync(assetPath)) {
  failures.push("spinner banner: production derivative is missing.");
} else {
  const hash = createHash("sha256").update(readFileSync(assetPath)).digest("hex");
  if (hash !== "dea33d89a11a2d58df8b50d08a25598542ee7b90f58551f120973677b807a7bb") {
    failures.push(`spinner banner: unexpected SHA-256 ${hash}.`);
  }
}

const spinnerProductionSource = Object.values(source).join("\n");
excludes("spinner source", spinnerProductionSource, "xartyzx.chatgpt.site");
excludes("spinner source", spinnerProductionSource, "mochirii-raffle-spinner");

const baseUrlArgument = process.argv.find((argument) => argument.startsWith("--base-url="));
if (baseUrlArgument) {
  await verifyDeployedSignedOutBoundary(baseUrlArgument.slice("--base-url=".length));
}

if (failures.length) {
  console.error(`Private spinner validation failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Private spinner validation OK.");
if (baseUrlArgument) console.log("- Deployed signed-out /spinner response is an empty opaque 404.");

async function verifyDeployedSignedOutBoundary(input) {
  let baseUrl;
  try {
    baseUrl = new URL(input);
  } catch {
    failures.push("deployed spinner boundary: --base-url must be an absolute URL.");
    return;
  }

  const localHost = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";
  if (baseUrl.protocol !== "https:" && !(localHost && baseUrl.protocol === "http:")) {
    failures.push("deployed spinner boundary: --base-url must use HTTPS, except for a local verification server.");
    return;
  }

  try {
    const requests = [
      { label: "GET /spinner", path: "/spinner", method: "GET", accept: "text/html" },
      { label: "HEAD /spinner", path: "/spinner", method: "HEAD", accept: "text/html" },
      { label: "GET /spinner/", path: "/spinner/", method: "GET", accept: "text/html" },
      { label: "HEAD /spinner/", path: "/spinner/", method: "HEAD", accept: "text/html" },
      { label: "GET /spinner query", path: "/spinner?boundary=1", method: "GET", accept: "text/html" },
      { label: "RSC /spinner", path: "/spinner?_rsc=boundary", method: "GET", accept: "text/x-component", rsc: true },
    ];

    for (const request of requests) {
      const response = await fetch(new URL(request.path, baseUrl), {
        method: request.method,
        cache: "no-store",
        redirect: "manual",
        headers: {
          Accept: request.accept,
          ...(request.rsc ? { RSC: "1" } : {}),
          "User-Agent": "Mochirii-Spinner-Verification/1.0",
        },
      });
      const body = await response.text();
      verifyOpaqueSpinnerResponse(request.label, response, body);
    }
  } catch (error) {
    failures.push(`deployed spinner boundary: request failed (${error instanceof Error ? error.message : String(error)}).`);
  }
}

function verifyOpaqueSpinnerResponse(label, response, body) {
  if (response.status !== 404) {
    failures.push(`deployed spinner boundary ${label}: expected 404, received ${response.status}.`);
  }
  if (body !== "") {
    failures.push(`deployed spinner boundary ${label}: expected an empty body, received ${new TextEncoder().encode(body).byteLength} bytes.`);
  }
  if (response.headers.has("link")) {
    failures.push(`deployed spinner boundary ${label}: response must not advertise preload links.`);
  }

  const cacheControl = response.headers.get("cache-control") || "";
  if (!/\bprivate\b/iu.test(cacheControl) || !/\bno-store\b/iu.test(cacheControl)) {
    failures.push(`deployed spinner boundary ${label}: response must be private and no-store.`);
  }
  const robots = response.headers.get("x-robots-tag") || "";
  for (const directive of ["noindex", "nofollow", "noarchive", "nosnippet", "noimageindex"]) {
    if (!robots.toLowerCase().includes(directive)) {
      failures.push(`deployed spinner boundary ${label}: X-Robots-Tag is missing ${directive}.`);
    }
  }
  const vary = response.headers.get("vary") || "";
  if (!vary.split(",").some((value) => value.trim().toLowerCase() === "cookie")) {
    failures.push(`deployed spinner boundary ${label}: Vary must include Cookie.`);
  }

  const setCookie = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie().join(", ")
    : response.headers.get("set-cookie") || "";
  for (const pattern of [
    /mochirii_spinner_access_v1=/iu,
    /Path=\/spinner(?:;|,|$)/iu,
    /Max-Age=0(?:;|,|$)/iu,
    /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu,
    /HttpOnly/iu,
    /Secure/iu,
    /SameSite=strict/iu,
  ]) {
    if (!pattern.test(setCookie)) {
      failures.push(`deployed spinner boundary ${label}: clearing cookie does not match ${pattern}.`);
    }
  }
}
