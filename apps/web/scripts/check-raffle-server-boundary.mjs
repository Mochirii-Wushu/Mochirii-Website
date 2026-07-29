import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { validatePrivateRaffleOperationAllowlist } from "./private-raffle-operation-policy.mjs";

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
  failures.push("@supabase/ssr must be pinned exactly to the Supabase 2.110.8-compatible 0.12.3 release.");
}
if (packageJson.dependencies?.["@supabase/supabase-js"] !== "2.110.8") {
  failures.push("@supabase/supabase-js must remain pinned exactly to 2.110.8.");
}

const browserClient = read("lib/supabase/client.ts");
requireText(browserClient, /createBrowserClient\(/, "Browser auth must use the cookie-aware SSR client.");
rejectText(browserClient, /detectSessionInUrl\s*:\s*true/, "Implicit URL session detection must stay disabled.");

const publicConfig = read("lib/supabase/config.ts");
requireText(publicConfig, /sameSite:\s*"lax"/, "Auth cookies must retain OAuth-compatible SameSite=Lax protection.");
requireText(publicConfig, /secure:\s*process\.env\.NODE_ENV\s*===\s*"production"/, "Auth cookies must be Secure in production.");

const callback = read("app/auth/callback/route.ts");
requireText(callback, /exchangeAuthCodeForCookieSession\(supabase\.auth, code\)/, "The PKCE callback must exchange the server auth code through the fail-closed helper.");
requireText(callback, /resolveAuthReturnPath/, "The PKCE callback must apply the return-path allowlist.");
requireText(callback, /getAll\("code"\)/, "The PKCE callback must reject ambiguous duplicate codes.");
requireText(callback, /PRIVATE_RAFFLE_HEADERS/, "The PKCE callback must be private and non-cacheable.");
const nextConfig = read("next.config.ts");
requireText(nextConfig, /source: "\/auth\/callback"[\s\S]*?"Referrer-Policy"[\s\S]*?"no-referrer"/, "The callback response must override the global referrer policy.");

const serverAuth = read("lib/supabase/server-auth.ts");
requireText(serverAuth, /auth\.getClaims\(\)/, "Server identity must use verified getClaims().");
rejectText(serverAuth, /auth\.getSession\(\)/, "Server authorization must not trust getSession().");
requireText(serverAuth, /verify-discord-member/, "Member routes must request fresh guild verification.");
requireText(serverAuth, /list-gallery-review-queue/, "Moderator routes must request fresh moderator verification.");
requireText(serverAuth, /authorizeRaffleClaimRequest/, "Future claim operations need an independent authorization entrypoint.");
requireText(serverAuth, /authorizeRaffleModeratorRequest/, "Future moderator operations need an independent authorization entrypoint.");

const serverClient = read("lib/supabase/server.ts");
requireText(serverClient, /createServerComponentSupabaseClient/, "Server Components must use their tolerant read client.");
requireText(serverClient, /createRouteHandlerSupabaseClient/, "Route Handlers must use their strict write client.");
requireText(serverClient, /strictRouteHandlerCookieMethods/, "Callback cookie writes must use the strict adapter.");
const cookieAdapters = read("lib/supabase/server-cookie-adapters.ts");
requireText(cookieAdapters, /strictRouteHandlerCookieMethods/, "Strict Route Handler cookie methods must remain explicit.");
requireText(cookieAdapters, /tolerantServerComponentCookieMethods/, "Server Component cookie methods must remain separately tolerant.");

const authCutover = read("lib/supabase/legacy-auth-cutover.ts");
requireText(authCutover, /clearLegacyAuthStorage\(storage, storageKey\)/, "Legacy token material must be cleared during cutover.");
requireText(authCutover, /legacyOAuthCutoverForUrl/, "Old in-flight OAuth results must use the reviewed cutover path.");

for (const [relativePath, decisionFunction, loginPath] of [
  ["app/raffle/claim/page.tsx", "getRaffleClaimPageDecision", "/raffle/claim"],
  ["app/leader-dashboard/raffle/page.tsx", "getRaffleModeratorPageDecision", "/leader-dashboard/raffle"],
]) {
  const source = read(relativePath);
  requireText(source, /export const dynamic = "force-dynamic"/, `${relativePath} must render per request.`);
  requireText(source, /export const revalidate = 0/, `${relativePath} must disable revalidation caches.`);
  requireText(source, new RegExp(`${decisionFunction}\\(\\)`), `${relativePath} must authorize at its Server Component boundary.`);
  requireText(source, /decision === "redirect-auth"[^\n]+redirect\(/, `${relativePath} must redirect signed-out visitors before rendering.`);
  requireText(source, /decision === "not-found"[^\n]+notFound\(\)/, `${relativePath} must return an opaque not-found response when denied.`);
  requireText(source, new RegExp(loginPath.replaceAll("/", "\\/")), `${relativePath} must use its exact allowlisted login destination.`);
  rejectText(source, /["']use client["']|<form|<button/, `${relativePath} must not expose disabled client, form, or button controls.`);
}

const proxy = read("proxy.ts");
requireText(proxy, /refreshSupabaseSession\(request\)/, "Protected raffle routes must receive the narrow session refresh.");
requireText(proxy, /"\/raffle\/claim\/:path\*"/, "Proxy matcher must include the claim route.");
requireText(proxy, /"\/leader-dashboard\/raffle\/:path\*"/, "Proxy matcher must include the moderator route.");
rejectText(proxy, /["']\/raffle["']\s*[,\]]/, "The public raffle route must stay outside the session-refresh matcher.");

const responsePolicy = read("lib/supabase/raffle-response-policy.ts");
requireText(responsePolicy, /private, no-cache, no-store/, "Private raffle responses must be non-cacheable.");
requireText(responsePolicy, /noindex, nofollow/, "Private raffle responses must carry noindex headers.");
requireText(responsePolicy, /"Referrer-Policy": "no-referrer"/, "Private raffle responses must suppress referrers.");

const publicRaffle = read("app/raffle/page.tsx");
rejectText(publicRaffle, /createServerSupabaseClient|getRaffleClaimPageDecision|getRaffleModeratorPageDecision|force-dynamic|cookies\(/, "The public raffle route must stay cacheable and independent from cookie auth.");

const operationPolicy = validatePrivateRaffleOperationAllowlist(appRoot);
operationPolicy.failures.forEach((failure) => failures.push(`Private raffle operation policy: ${failure}`));
const previewSmoke = read("scripts/smoke-raffle-auth-preview.mjs");
requireText(previewSmoke, /MOCHIRII_RAFFLE_PREVIEW_AUTH_FIXTURE/, "Preview auth evidence must come from the ignored one-use fixture.");
requireText(previewSmoke, /responseCookiePairs/, "Preview auth must verify callback Set-Cookie behavior.");
requireText(previewSmoke, /destination\.pathname !== "\/raffle\/claim"/, "Preview auth must follow the exact protected claim destination.");
rejectText(previewSmoke, /console\.(?:log|error)\([^\n]*(?:callbackUrl|cookieHeader|codes\[|fixture\.)/, "Preview auth must never print callback or cookie material.");

const routeShell = read("components/SiteRouteShell.tsx");
requireText(routeShell, /isIsolatedPrivateRafflePath/, "Private raffle routes must use the isolated shell.");
requireText(routeShell, /pathname === "\/raffle\/claim"/, "The claim route must stay isolated from analytics and header auth.");
requireText(routeShell, /pathname === "\/leader-dashboard\/raffle"/, "The moderator route must stay isolated from analytics and header auth.");
requireText(routeShell, /dynamic\(\(\) => import\("@\/components\/OrdinarySiteShell"\)/, "The ordinary shell must remain a conditional chunk.");
requireText(routeShell, /dynamic\(\(\) => import\("@\/components\/AuthCutoverGuard"\)/, "The auth cutover guard must remain a conditional chunk.");
requireText(routeShell, /AUTH_CUTOVER_PATHS\.has\(pathname\)/, "Legacy reauthentication must run only on explicit auth surfaces.");
rejectText(routeShell, /ssr:\s*false/, "The ordinary shell must retain server rendering.");
for (const marker of ["SiteHeader", "SiteFooter", "useHeaderAuthState", "Analytics", "SpeedInsights"]) {
  rejectText(routeShell, new RegExp(marker), `The route selector must not statically import ${marker}.`);
}

const ordinaryShell = read("components/OrdinarySiteShell.tsx");
for (const marker of ["SiteHeader", "SiteFooter", "useHeaderAuthState", "Analytics", "SpeedInsights"]) {
  requireText(ordinaryShell, new RegExp(marker), `The ordinary shell must own ${marker}.`);
}
rejectText(ordinaryShell, /AuthCutoverGuard/, "Public ordinary pages must not eagerly load the legacy auth cutover.");

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Disabled raffle SSR server-boundary contract passed.");
