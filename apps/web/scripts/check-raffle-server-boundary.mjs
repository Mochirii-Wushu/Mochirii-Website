import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const appRoot = path.resolve(import.meta.dirname, "..");
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8");
}

function requireText(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

function rejectText(source, pattern, message) {
  if (pattern.test(source)) failures.push(message);
}

const packageJson = JSON.parse(read("package.json"));
if (packageJson.dependencies?.["@supabase/ssr"] !== "0.12.3") {
  failures.push("@supabase/ssr must be pinned exactly to 0.12.3.");
}
if (packageJson.dependencies?.["@supabase/supabase-js"] !== "2.110.8") {
  failures.push("@supabase/supabase-js must be pinned exactly to 2.110.8.");
}

const browserClient = read("lib/supabase/client.ts");
requireText(browserClient, /createBrowserClient\(/, "Browser auth must use the cookie-aware SSR client.");
rejectText(browserClient, /detectSessionInUrl\s*:\s*true/, "Implicit URL session detection must stay disabled.");

const publicConfig = read("lib/supabase/config.ts");
requireText(publicConfig, /sameSite:\s*"lax"/, "Auth cookies must retain OAuth-compatible SameSite=Lax protection.");
requireText(publicConfig, /secure:\s*process\.env\.NODE_ENV\s*===\s*"production"/, "Auth cookies must be Secure in production.");

const serverAuth = read("lib/supabase/server-auth.ts");
const viewerAdapter = read("lib/supabase/raffle-viewer-adapter.ts");
const viewerAdapterRegression = read("lib/supabase/raffle-viewer-adapter-core.test.mts");
const responsePolicy = read("lib/supabase/raffle-response-policy.ts");
requireText(serverAuth, /auth\.getClaims\(\)/, "Server identity must use verified getClaims().");
rejectText(serverAuth, /auth\.getSession\(\)/, "Server authorization must not trust getSession().");
requireText(serverAuth, /verify-discord-member/, "Member routes must request a fresh server-controlled guild verification.");
requireText(serverAuth, /list-gallery-review-queue/, "Moderator routes must request a fresh server-controlled moderator verification.");
requireText(serverAuth, /authorizeRaffleClaimRequest/, "Route handlers need an independent claim authorization entrypoint.");
requireText(serverAuth, /authorizeRaffleModeratorRequest/, "Route handlers need an independent moderator authorization entrypoint.");
requireText(serverAuth, /getRaffleViewerResultNames/, "The public raffle route needs a privacy-safe verified-viewer result lookup.");
requireText(viewerAdapter, /auth[\s\S]*getClaims\(\)/, "The viewer adapter must verify claims for every request-scoped client.");
requireText(viewerAdapter, /action:\s*"member_results"/, "The verified-viewer lookup must request only the private member-result DTO.");
rejectText(viewerAdapter, /unstable_cache|["']use cache|\bMap\s*\(/, "The personalized viewer adapter must not introduce shared caching.");
rejectText(viewerAdapter, /process\.env|RAFFLE_.*(?:FIXTURE|BYPASS|TEST)/, "The production viewer adapter must not contain a reachable test bypass.");
for (const cookieState of ["session-a", "session-b", "signed-out", "unverified"]) {
  requireText(viewerAdapterRegression, new RegExp(cookieState), `The production-adapter regression must cover ${cookieState}.`);
}
requireText(viewerAdapterRegression, /clientCreations,\s*5/, "The production-adapter regression must create a request-scoped client for every cookie state.");
requireText(viewerAdapterRegression, /PRIVATE_AUTH_HEADERS/, "The cache-isolation regression must verify the production response policy.");
requireText(serverAuth, /parseRaffleClaimStatus/, "Claim availability must come from the trusted Edge status DTO.");
requireText(serverAuth, /status\?\.claimsEnabled\s*&&\s*status\.claimState\s*===\s*"claimable"/, "Claim controls must require both the operational gate and a claimable winner state.");
requireText(serverAuth, /performRaffleClaimMutation/, "Claim forms must use a server-authorized mutation boundary.");

const rafflePage = read("app/raffle/page.tsx");
requireText(rafflePage, /export const dynamic = "force-dynamic"/, "The personalized public raffle route must render per request.");
requireText(rafflePage, /getRaffleViewerResultNames\(\)/, "The public raffle route must resolve verified-viewer names on the server.");
requireText(rafflePage, /<RafflePage viewerResultNames=\{viewerResultNames\}/, "The public raffle route must pass only the private result-name DTO to its renderer.");
rejectText(rafflePage, /["']use client["']|\bfetch\s*\(/, "The public raffle route must not move private result loading into the browser.");

const callback = read("app/auth/callback/route.ts");
requireText(callback, /exchangeCodeForSession\(code\)/, "The PKCE callback must exchange the server auth code.");
requireText(callback, /resolveAuthReturnPath/, "The PKCE callback must apply the return-path allowlist.");
requireText(callback, /getAll\("code"\)/, "The PKCE callback must reject ambiguous duplicate codes.");
requireText(callback, /private, no-cache, no-store/, "The PKCE callback must be private and non-cacheable.");

for (const [relativePath, decisionFunction, loginPath] of [
  ["app/raffle/claim/page.tsx", "getRaffleClaimPageState", "/raffle/claim"],
  ["app/leader-dashboard/raffle/page.tsx", "getRaffleModeratorPageDecision", "/leader-dashboard/raffle"],
]) {
  const source = read(relativePath);
  requireText(source, /export const dynamic = "force-dynamic"/, `${relativePath} must render per request.`);
  requireText(source, /export const revalidate = 0/, `${relativePath} must disable revalidation caches.`);
  requireText(source, new RegExp(`${decisionFunction}\\(\\)`), `${relativePath} must authorize at its Server Component boundary.`);
  requireText(source, /decision === "redirect-auth"[^\n]+redirect\(/, `${relativePath} must redirect signed-out visitors before rendering.`);
  requireText(source, /decision === "not-found"[^\n]+notFound\(\)/, `${relativePath} must return an opaque not-found response when denied.`);
  requireText(source, new RegExp(loginPath.replaceAll("/", "\\/")), `${relativePath} must use its exact allowlisted login destination.`);
  rejectText(source, /"use client"|PrizeDraw(?:Claim|Leader)Panel/, `${relativePath} must not defer access checks to a Client Component.`);
}

const claimActions = read("app/raffle/claim/actions.ts");
requireText(claimActions, /^["']use server["'];/m, "Raffle claim mutations must stay in Server Actions.");
requireText(claimActions, /performRaffleClaimMutation/, "Server Actions must call the independently authorized claim boundary.");
for (const action of ["claimElectronicReward", "claimInGameReward", "declineRaffleReward"]) {
  requireText(claimActions, new RegExp(`export async function ${action}\\(`), `Missing claim Server Action ${action}.`);
}
const claimPage = read("app/raffle/claim/page.tsx");
requireText(claimPage, /decision === "claim" && status\?\.selectedClaimId/, "Claim controls must require a trusted claim page decision and selected claim ID.");
for (const action of ["claimElectronicReward", "claimInGameReward", "declineRaffleReward"]) {
  requireText(claimPage, new RegExp(`action=\\{${action}\\}`), `Claim page must bind ${action} directly as a Server Action.`);
}

const proxy = read("proxy.ts");
requireText(proxy, /refreshSupabaseSession\(request\)/, "Protected raffle routes must receive the narrow session refresh.");
requireText(proxy, /"\/raffle\/claim\/:path\*"/, "Proxy matcher must include the claim route.");
requireText(proxy, /"\/leader-dashboard\/raffle\/:path\*"/, "Proxy matcher must include the moderator route.");
requireText(proxy, /"\/raffle"/, "Proxy matcher must refresh the optional raffle viewer session.");
requireText(read("lib/supabase/proxy.ts"), /PRIVATE_AUTH_HEADERS/, "Private raffle responses must apply the shared cache policy.");
requireText(responsePolicy, /"Referrer-Policy": "no-referrer"/, "Private raffle responses must suppress referrers.");
requireText(responsePolicy, /private, no-cache, no-store/, "Personalized raffle responses must be private and non-cacheable.");

const routeShell = read("components/SiteRouteShell.tsx");
requireText(routeShell, /isIsolatedPrivateRafflePath/, "Private raffle routes must use the isolated shell.");
requireText(routeShell, /pathname === "\/raffle\/claim"/, "The claim route must stay isolated from analytics and header auth.");
requireText(routeShell, /pathname === "\/leader-dashboard\/raffle"/, "The moderator route must stay isolated from analytics and header auth.");

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Raffle server-boundary contract passed.");
