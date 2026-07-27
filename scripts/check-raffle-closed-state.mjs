import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SITE_ORIGIN } from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];

const files = {
  page: "apps/web/app/raffle/page.tsx",
  rules: "apps/web/app/raffle/rules/page.tsx",
  ruleVersion: "apps/web/app/raffle/rules/[version]/page.tsx",
  renderFixtureRoute: "apps/web/app/raffle-render-fixtures-internal/[scenario]/page.tsx",
  renderFixtureData: "apps/web/lib/raffle/public-render-fixtures.ts",
  component: "apps/web/components/public-pages/route-pages/RafflePage.tsx",
  contract: "apps/web/lib/raffle/public-view.ts",
  time: "apps/web/lib/raffle/time.ts",
  data: "apps/web/public/data/raffles.json",
  metadata: "apps/web/components/public-pages/metadata.ts",
  navigation: "apps/web/lib/site-navigation.ts",
  footer: "apps/web/components/SiteFooter.tsx",
  home: "apps/web/public/data/home.json",
  tome: "apps/web/public/data/tome.json",
  scheduleHelper: "apps/web/lib/guild-schedule.ts",
  nextConfig: "apps/web/next.config.ts",
  sitemap: "apps/web/public/sitemap.xml",
  tokens: "apps/web/app/styles/tokens-base.css",
  sideStyles: "apps/web/app/styles/public-side-pages.css",
};

const forbiddenOperationalSurfaces = [
  "apps/web/app/api/raffle",
  "apps/web/app/raffle/claim",
  "apps/web/app/leader-dashboard/raffle",
  "apps/web/app/raffles/page.tsx",
  "apps/web/components/prize-draw",
  "apps/web/lib/prize-draw.ts",
  "apps/web/lib/prize-draw-rules.ts",
  "apps/web/lib/supabase/prize-draw.ts",
  "services/reward-relay",
  "supabase/migrations/20260719130111_monthly_prize_draw.sql",
  "supabase/functions/get-current-raffle",
  "supabase/functions/manage-raffle-entry",
  "supabase/functions/manage-raffle-claim",
  "supabase/functions/moderate-raffle",
  "supabase/functions/run-raffle-fulfillment",
  "supabase/functions/run-raffle-schedule",
  "supabase/functions/reward-provider-webhook",
  "scripts/register-reaper-raffle-commands.mjs",
  "scripts/check-reaper-raffle-commands.mjs",
  "scripts/check-reward-relay.mjs",
];

for (const [label, file] of Object.entries(files)) {
  if (!existsSync(resolve(root, file))) failures.push(`${label}: required file is missing: ${file}`);
}

for (const file of forbiddenOperationalSurfaces) {
  if (existsSync(resolve(root, file))) failures.push(`${file}: operational raffle surface must stay outside the public-page track`);
}

const data = JSON.parse(read(files.data) || "{}");
const exactKeys = [
  "eligibility",
  "entryModel",
  "meta",
  "programName",
  "publicView",
  "results",
  "rewards",
  "rules",
  "schemaVersion",
  "standingPrinciples",
];
assertDeepEqual(Object.keys(data).sort(), exactKeys.sort(), "raffle data: public contract fields must be exact");
assert(data.schemaVersion === 1, "raffle data: schemaVersion must be 1");
assert(data.programName === "Mochirii Monthly Raffle", "raffle data: programName must use Mochirii branding");
assert(data.publicView?.timezone === "Asia/Singapore", "raffle data: Singapore must remain the authoritative time zone");
assert(data.publicView?.cycleStatus === "inactive", "raffle data: public release must remain inactive");
assert(data.publicView?.standardEntryStatus === "closed", "raffle data: standard entries must be closed");
assert(data.publicView?.bonusEntryStatus === "closed", "raffle data: bonus entries must be closed");
for (const key of ["opensAt", "closesAt", "drawAt", "claimEndsAt", "publicReward", "rulesUrl", "entrantCount", "totalEntryCount"]) {
  assert(data.publicView?.[key] === null, `raffle data: inactive ${key} must be null`);
}
assert(data.publicView?.publicResult === "none", "raffle data: inactive public result must be none");

assert(data.publicView?.baseEntries === 5, "raffle data: standard entry count must be five");
assert(data.publicView?.maximumBonusEntries === 5, "raffle data: bonus entry maximum must be five");
assert(data.publicView?.maximumEntries === 10, "raffle data: total entry maximum must be ten");
assert(Array.isArray(data.entryModel?.permanentBonusMethods), "raffle data: permanent bonus methods must be an array");
assert(data.entryModel?.permanentBonusMethods?.length === 5, "raffle data: exactly five permanent bonus methods are required");
const methodTitles = new Set();
for (const [index, method] of (data.entryModel?.permanentBonusMethods || []).entries()) {
  assert(typeof method.title === "string" && method.title.trim(), `raffle data: method ${index + 1} requires a title`);
  assert(!methodTitles.has(method.title), `raffle data: duplicate permanent method ${method.title}`);
  methodTitles.add(method.title);
  assert(typeof method.primaryPath === "string" && method.primaryPath.trim(), `raffle data: method ${index + 1} requires a primary path`);
  assert(typeof method.equivalentFreePath === "string" && method.equivalentFreePath.trim(), `raffle data: method ${index + 1} requires an equivalent free path`);
  assert(method.maximumEntries === 1, `raffle data: method ${index + 1} must be capped at one entry`);
}

for (const phrase of ["Verified Mochirii guild member in good standing", "age 18 or older", "country approved for that drawing", "one account and one opt-in per person per cycle"]) {
  assert(data.eligibility?.includes(phrase), `raffle data: standing eligibility missing ${phrase}`);
}
assert(data.rewards?.categories?.length >= 4, "raffle data: electronic, in-game, and two community-honor concepts are required");
for (const phrase of ["Electronic gifts", "In-game gifts", "Guild commendation", "Hall record"]) {
  assert(JSON.stringify(data.rewards).includes(phrase), `raffle data: missing reward concept ${phrase}`);
}
assert(data.results?.current === null, "raffle data: inactive release must not invent a current result");
assertDeepEqual(data.results?.previous, [], "raffle data: completed results must not be invented");
assert(data.rules?.standingRulesUrl === "/raffle/rules", "raffle data: standing rules route must remain local");
assert(data.rules?.currentRulesState === "inactive", "raffle data: current rules must remain inactive");
assertDeepEqual(data.rules?.archive, [], "raffle data: archived rules must not be invented");
assertDeepEqual(data.rules?.versions, [], "raffle data: immutable rule versions must not be invented");

const forbiddenDataKeys = /^(?:sponsor|sponsorDisplayName|legalName|countries|eligibleCountries|entryUrl|entryAction|claimUrl|provider|prizeProvider|memberDisplayName|userId|email|accountId|externalId)$/i;
walkKeys(data, "raffle", (key, path) => {
  if (forbiddenDataKeys.test(key)) failures.push(`raffle data: private or provider field is forbidden at ${path}`);
});

const dataText = JSON.stringify(data);
assert(!/\b\d{4}-\d{2}-\d{2}(?:T|\b)/.test(dataText), "raffle data: inactive template must not publish drawing dates");

const metadataSource = read(files.metadata);
const raffleMetadataStart = metadataSource.indexOf("raffle: {");
const raffleMetadataEnd = metadataSource.indexOf("gallery:", raffleMetadataStart);
const raffleMetadataSource = raffleMetadataStart >= 0 && raffleMetadataEnd > raffleMetadataStart
  ? metadataSource.slice(raffleMetadataStart, raffleMetadataEnd)
  : "";
const publicSource = [
  read(files.page),
  read(files.rules),
  read(files.ruleVersion),
  read(files.component),
  read(files.contract),
  read(files.data),
  raffleMetadataSource,
].join("\n");
assert(publicSource.includes('drawing: "No raffle is active"'), "public raffle source: inactive drawing label must be explicit");
assert(publicSource.includes('submissions: "No submissions are being accepted."'), "public raffle source: inactive submission status must be explicit");

for (const [label, pattern] of [
  ["client component", /["']use client["']/i],
  ["form", /<form\b/i],
  ["button", /<button\b/i],
  ["input", /<(?:input|select|textarea)\b/i],
  ["iframe", /<iframe\b/i],
  ["network request", /\bfetch\s*\(/i],
  ["runtime secret", /process\.env/i],
  ["external URL", /https?:\/\//i],
  ["provider or platform name", /\b(?:Tremendous|Supabase|Vercel|Discord|DigitalOcean|Fly\.io|Shopify|Stripe)\b/i],
  ["internal system language", /\b(?:backend|integration|provider|migration|webhook|relay|database|JWT|service role|Edge Function)\b/i],
  ["unfinished implementation language", /\b(?:coming soon|TBD|work in progress|not implemented|blocked|prelaunch)\b/i],
]) {
  if (pattern.test(publicSource)) failures.push(`public raffle source: ${label} is forbidden`);
}

for (const phrase of [
  "Mochirii holds monthly drawings for eligible guild members",
  "No raffle is active",
  "Standard entries",
  "Bonus entries",
  "No submissions are being accepted",
  "No purchase necessary",
  "five standard entries",
  "five optional bonus entries",
  "maximum is ten entries",
  "electronic gifts",
  "in-game gifts",
  "community honors",
  "No active drawing rules",
  "seven days",
  "72 hours",
  "24 hours",
  "30 days",
  "selected guild display name",
  "eligible locations",
]) {
  assert(publicSource.toLowerCase().includes(phrase.toLowerCase()), `public raffle source: missing ${phrase}`);
}

const contractSource = read(files.contract);
assertIncludes("privacy-safe result contract", contractSource, 'publicLabel: "Winner confirmed" | "Community honor confirmed"');
assertIncludes("private viewer result DTO", contractSource, "RaffleViewerResultNames");
assertIncludes("verified-viewer name selection", contractSource, "viewerResultNames?.[result.resultKey]");
assert(!/\bmemberDisplayName\s*:/.test(contractSource), "raffle contract: public result contract must not define a member display-name field");
assertIncludes("runtime model validation", contractSource, "parseRafflePageModel(raffleData)");
assertIncludes("reviewed immutable rule lookup", contractSource, "getRaffleRuleVersion");
assertIncludes("strict chronological contract", contractSource, "opensAt < closesAt < drawAt < claimEndsAt");
assertIncludes("drawing-evidence parity", contractSource, "public drawing evidence time must equal the current drawing time");
const renderFixtureSource = read(files.renderFixtureRoute);
assertIncludes("render fixture production guard", renderFixtureSource, 'process.env.VERCEL === "1"');
assertIncludes("render fixture explicit opt-in", renderFixtureSource, 'process.env.RAFFLE_PUBLIC_RENDER_FIXTURES !== "1"');
assertIncludes("render fixture fail-closed response", renderFixtureSource, "notFound()");
for (const state of ["inactive", "scheduled", "open", "closed", "drawing", "results", "paused"]) {
  assertIncludes("seven-state public contract", contractSource, `| "${state}"`);
}

const tokens = read(files.tokens);
assertIncludes("grid contract", tokens, ".col-7{grid-column:span 7;}");
assertIncludes("grid contract", tokens, ".col-5{grid-column:span 5;}");
assert(/@media \(max-width:980px\)[\s\S]*\.col-8,.col-7,.col-6,.col-5,.col-4\{grid-column:span 12;\}/.test(tokens), "grid contract: 7/5 columns must become full width at 980px");
assertIncludes("raffle responsive styles", read(files.sideStyles), ".raffle-method-grid");

const nextConfig = read(files.nextConfig);
assertIncludes("Next redirects", nextConfig, '["/raffles", "/raffle"]');
assertIncludes("Next redirects", nextConfig, '["/raffles.html", "/raffle"]');
assertIncludes("navigation", read(files.navigation), 'href: "/raffle", label: "Raffle", nav: "raffle"');
assertIncludes("footer", read(files.footer), '{ href: "/raffle", label: "Raffle" }');
assertIncludes("home bulletin", read(files.home), '"href": "/raffle"');
assertIncludes("Tome raffle guidance", read(files.tome), "the current raffle status stays public & clearly labeled");
assertIncludes("website event cards", read(files.scheduleHelper), '.filter((item) => item.id !== "monthly-raffle")');
assertIncludes("metadata", metadataSource, 'path: "/raffle"');
assertIncludes("metadata", metadataSource, 'path: "/raffle/rules"');
assertIncludes("sitemap", read(files.sitemap), `${SITE_ORIGIN}/raffle</loc>`);
assertIncludes("sitemap", read(files.sitemap), `${SITE_ORIGIN}/raffle/rules</loc>`);

if (failures.length) {
  console.error(`Raffle public contract failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Raffle public contract OK.");
console.log("- The inactive monthly program, permanent 5+5 entry model, rewards, rules, and results states are complete.");
console.log("- Public content is provider-neutral; entry, claim, administration, and reward controls remain absent.");
console.log("- The 7/5 and 8/4 grid contracts reflow to full-width cards at 980px.");

function read(file) {
  const absolute = resolve(root, file);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertIncludes(label, source, snippet) {
  if (!source.includes(snippet)) failures.push(`${label}: missing ${snippet}`);
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(message);
}

function walkKeys(value, path, visit) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, `${path}.${index}`, visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    visit(key, nextPath);
    walkKeys(item, nextPath, visit);
  }
}
