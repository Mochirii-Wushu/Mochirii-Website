import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    failures.push(`${relativePath}: missing required file.`);
    return "";
  }
  return readFileSync(fullPath, "utf8");
}

function assertIncludes(label, source, snippet) {
  if (!source.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

function assertNotIncludes(label, source, snippet) {
  if (source.includes(snippet)) failures.push(`${label}: forbidden snippet found: ${snippet}`);
}

function assertOrdered(label, source, earlier, later) {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);
  if (earlierIndex < 0 || laterIndex < 0 || earlierIndex >= laterIndex) {
    failures.push(`${label}: expected ${earlier} before ${later}`);
  }
}

function pageFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(fullPath);
    return entry.name === "page.tsx" ? [fullPath] : [];
  });
}

for (const file of pageFiles(path.join(root, "apps/web/app"))) {
  const source = readFileSync(file, "utf8");
  if (source.includes("@/components/public-pages/pages")) {
    failures.push(`${path.relative(root, file).replaceAll("\\", "/")}: public route must use a direct route-page import.`);
  }
}

const eventsRoute = read("apps/web/app/events/page.tsx");
const eventsPage = read("apps/web/components/public-pages/route-pages/EventsPage.tsx");
const eventsBoard = read("apps/web/components/public-pages/EventsBoard.tsx");
[
  'import { connection } from "next/server";',
  "await connection();",
  "referenceTime={new Date().toISOString()}",
].forEach((snippet) => assertIncludes("Events server reference", eventsRoute, snippet));
assertIncludes("Events route page", eventsPage, "<EventsBoard");
assertIncludes("Events route page", eventsPage, "referenceTime={referenceTime}");
assertIncludes("Events route page", eventsPage, "websiteEventCardsFromSchedule(guildScheduleData, new Date(referenceTime))");
assertIncludes("Events board", eventsBoard, "eventStatusAt(item, referenceTimeMs)");
assertIncludes("Events board", eventsBoard, "parseReferenceTime(referenceTime)");
assertNotIncludes("Events board", eventsBoard, "Date.now()");
assertNotIncludes("Events board", eventsBoard, "new Date()");

const galleryBrowser = read("apps/web/components/public-pages/GalleryBrowser.tsx");
const publicGalleryFeed = read("apps/web/lib/gallery/approved-feed.ts");
const privateGalleryClient = read("apps/web/lib/supabase/gallery-submissions.ts");
const profileCardLinks = read("apps/web/components/public-pages/ProfileCardLinks.tsx");
const publicProfileCards = read("apps/web/lib/member-profiles/visible-profile-cards.ts");
assertIncludes("Gallery browser", galleryBrowser, 'from "@/lib/gallery/approved-feed"');
assertNotIncludes("Gallery browser", galleryBrowser, 'from "@/lib/supabase/gallery-submissions"');
assertIncludes("SDK-free Gallery feed", publicGalleryFeed, "list-approved-gallery-submissions");
assertIncludes("SDK-free Gallery feed", publicGalleryFeed, "export async function listApprovedGallerySubmissions");
[
  "@supabase/supabase-js",
  "@/lib/supabase/",
  "requireBrowserSupabaseClient",
  "createClient(",
].forEach((snippet) => assertNotIncludes("SDK-free Gallery feed", publicGalleryFeed, snippet));
assertNotIncludes("private Gallery client", privateGalleryClient, "listApprovedGallerySubmissions");

assertIncludes("public profile-card links", profileCardLinks, 'from "@/lib/member-profiles/visible-profile-cards"');
assertIncludes("SDK-free profile-card feed", publicProfileCards, "list-visible-profile-cards");
assertIncludes("SDK-free profile-card feed", publicProfileCards, "export async function listVisibleProfileCards");
[
  "@supabase/supabase-js",
  "@/lib/supabase/",
  "requireBrowserSupabaseClient",
  "createClient(",
].forEach((snippet) => assertNotIncludes("SDK-free profile-card feed", publicProfileCards, snippet));

const joinPage = read("apps/web/components/public-pages/route-pages/JoinPage.tsx");
const discordPreview = read("apps/web/components/public-pages/DiscordServerPreview.tsx");
const browserRouteMatrix = read("scripts/check-browser-route-matrix.mjs");
assertIncludes("Join route", joinPage, "<DiscordServerPreview />");
assertNotIncludes("Join route", joinPage, "<iframe");
[
  "const [previewVisible, setPreviewVisible] = useState(false);",
  "aria-expanded={previewVisible}",
  "previewVisible ? (",
  "<iframe",
  "Open Discord",
  'rel="noopener noreferrer"',
].forEach((snippet) => assertIncludes("user-activated Discord preview", discordPreview, snippet));
[
  "inspectDiscordPreview(page, discordPreviewRequests)",
  'getArg("--browser", process.env.BROWSER_ROUTE_MATRIX_BROWSER || "chromium")',
  '["chromium", "firefox", "webkit"]',
  'initialRequestCount !== 0',
  'requestCountAfterActivation <= preview.initialRequestCount',
  'preview.hidden.expanded !== "false"',
  'preview?.shown.horizontalOverflow',
].forEach((snippet) => assertIncludes("Discord preview browser regression", browserRouteMatrix, snippet));

const timing = read("apps/web/lib/observability/authenticated-route-timing.ts");
[
  'export type AuthenticatedRoute = "account" | "oauth-consent" | "leader-dashboard";',
  "authenticatedRouteTimingBucket",
  "performance.measure",
  "mochirii:authenticated-route-timing",
].forEach((snippet) => assertIncludes("authenticated route timing", timing, snippet));
[
  "fetch(",
  "sendBeacon",
  "XMLHttpRequest",
  "@vercel/analytics",
  "userId",
  "email",
].forEach((snippet) => assertNotIncludes("authenticated route timing", timing, snippet));

for (const [file, route] of [
  ["apps/web/components/member-workflow/AccountPanel.tsx", "account"],
  ["apps/web/components/member-workflow/OAuthConsentPanel.tsx", "oauth-consent"],
  ["apps/web/components/member-workflow/LeaderDashboard.tsx", "leader-dashboard"],
]) {
  const source = read(file);
  assertIncludes(file, source, 'from "@/lib/observability/authenticated-route-timing"');
  assertIncludes(file, source, `measureAuthenticatedRouteTask("${route}"`);
  assertNotIncludes(file, source, `Promise.resolve().then(() => measureAuthenticatedRouteTask("${route}"`);
}

const accountPanel = read("apps/web/components/member-workflow/AccountPanel.tsx");
const leaderDashboard = read("apps/web/components/member-workflow/LeaderDashboard.tsx");
const serverFetch = read("apps/web/lib/supabase/server-fetch.ts");
[
  "SUPABASE_SERVER_REQUEST_TIMEOUT_MS = 5_000",
  "SupabaseServerRequestTimeoutError",
  "controller.abort(reason)",
  "Promise.race([requestPromise, stopPromise])",
].forEach((snippet) => assertIncludes("bounded Supabase server transport", serverFetch, snippet));
for (const file of [
  "apps/web/lib/supabase/server-client.ts",
  "apps/web/lib/supabase/server.ts",
  "apps/web/lib/supabase/proxy.ts",
]) {
  const source = read(file);
  assertIncludes(file, source, 'from "./server-fetch');
  assertIncludes(file, source, "fetch: supabaseServerFetch");
}
const oauthDecisionRoute = read("apps/web/app/api/oauth/decision/route.ts");
assertIncludes("OAuth decision route", oauthDecisionRoute, 'from "@/lib/supabase/server-fetch"');
assertIncludes("OAuth decision route", oauthDecisionRoute, "fetch: supabaseServerFetch");
if ((oauthDecisionRoute.match(/supabaseServerFetch\(/g) || []).length !== 2) {
  failures.push("OAuth decision route: authorization lookup and consent submission must both use the bounded server transport.");
}
assertNotIncludes("OAuth decision route", oauthDecisionRoute, "await fetch(endpoint");
assertIncludes("Account essential reads", accountPanel, "const [profileResult, accessResult] = await Promise.all([");
assertIncludes("Account optional reads", accountPanel, "void Promise.allSettled([");
assertIncludes("Account load generation", accountPanel, "accountLoadGenerationRef.current === loadGeneration");
assertOrdered(
  "Account access readiness before moderator discovery",
  accountPanel,
  "setBusy(false);",
  "void checkLeaderGalleryModerationAccess().then",
);
assertIncludes("Account stale optional-read guard", accountPanel, "loadSubmissions(loadGeneration)");
assertIncludes("Leader optional queues", leaderDashboard, "void Promise.allSettled([");
assertIncludes("Leader load generation", leaderDashboard, "beginAuthLoadGeneration(leaderLoadGenerationRef)");
assertIncludes(
  "Leader stale access guard",
  leaderDashboard,
  "isCurrentAuthLoadGeneration(leaderLoadGenerationRef, loadGeneration)",
);
assertIncludes(
  "Leader stale queue guard",
  leaderDashboard,
  "loadQueue({ status: \"pending\", page: 1, thumbnailState: \"all\", loadGeneration })",
);
assertIncludes(
  "Leader stale Social queue guard",
  leaderDashboard,
  "loadInstagramQueue({ status: instagramActiveStatus, loadGeneration })",
);
assertIncludes(
  "Leader stale provider-status guard",
  leaderDashboard,
  "loadInstagramApiStatus(\"\", loadGeneration)",
);
assertIncludes("Leader sensitive-state reset", leaderDashboard, "clearModeratorState();");
assertIncludes("Leader unmount invalidation", leaderDashboard, "invalidateAuthLoadGeneration(leaderLoadGenerationRef);");
assertIncludes("Leader stale spinner-launch guard", leaderDashboard, "const loadGeneration = leaderLoadGenerationRef.current;");
assertIncludes(
  "Leader denied spinner-session cleanup",
  leaderDashboard.replaceAll("\r\n", "\n"),
  "if (!access.ok) {\n      void clearPrivateSpinnerSession();",
);
assertOrdered(
  "Leader access before optional queues",
  leaderDashboard,
  'setPanel("review");',
  "void Promise.allSettled([",
);
assertIncludes("Leader queue-local loading", leaderDashboard, "setBusy(true);");
assertOrdered(
  "Leader spinner before moderation queue",
  leaderDashboard,
  'id="spinnerLaunchPanel" aria-busy={spinnerLaunchBusy}',
  'id="reviewPanel" aria-busy={busy}',
);
assertIncludes(
  "Leader spinner readiness",
  leaderDashboard,
  'disabled={spinnerLaunchBusy} onClick={openSpinner}',
);

if (failures.length) {
  console.error("Web runtime performance contract failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Web runtime performance contract OK.");
console.log("- Public routes use direct route-page imports.");
console.log("- Events hydration uses one server-generated reference time.");
console.log("- Public Gallery and profile-card feed code has no Supabase SDK dependency.");
console.log("- Discord preview is user activated and retains a direct link.");
console.log("- Authenticated route timings are local, bounded, and identifier-free.");
console.log("- Server-side Supabase requests share one bounded, cancellation-aware transport.");
console.log("- Moderator spinner access renders before optional queue reads; queue loading stays scoped to the review panel.");
