import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(file) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) {
    failures.push(`${file}: missing required monthly Spotlight file.`);
    return "";
  }
  return readFileSync(fullPath, "utf8");
}

function includes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected contract snippet is missing: ${snippet}`);
}

function matches(label, text, pattern, message) {
  if (!pattern.test(text)) failures.push(`${label}: ${message}`);
}

function excludes(label, text, pattern, message) {
  if (pattern.test(text)) failures.push(`${label}: ${message}`);
}

const packageJson = read("package.json");
const checkAll = read("scripts/check-all.mjs");
const migration = read("supabase/migrations/20260830164308_add_monthly_member_spotlight_selection.sql");
const databaseTest = read("supabase/tests/monthly_member_spotlight_selection_test.sql");
const publicWinner = read("supabase/functions/get-current-spotlight-winner/index.ts");
const publicWinnerTest = read("supabase/functions/get-current-spotlight-winner/index_test.ts");
const winnerComponent = read("apps/web/components/public-pages/SpotlightWinnerTitle.tsx");
const contentHelper = read("apps/web/components/public-pages/spotlight-content.ts");
const contentTest = read("apps/web/components/public-pages/spotlight-content.test.mts");
const responseBoundary = read("apps/web/lib/supabase/spotlight-response.ts");
const responseTest = read("apps/web/lib/supabase/spotlight-response.test.mts");
const spotlightPage = read("apps/web/components/public-pages/route-pages/SpotlightPage.tsx");
const homePage = read("apps/web/app/page.tsx");
const spotlightData = read("apps/web/public/data/spotlight.json");
const homeData = read("apps/web/public/data/home.json");
const scheduleData = read("apps/web/public/data/guild-schedule.json");
const privacyPage = read("apps/web/components/public-pages/route-pages/PrivacyPage.tsx");
const concurrencyTest = read("scripts/test-supabase-spotlight-concurrency.mjs");
const localPreviewWorkflow = read(".github/workflows/validate-supabase-local-preview.yml");

includes("package.json", packageJson, '"check:spotlight-selection"');
includes("package.json", packageJson, '"test:spotlight-content"');
includes("package.json", packageJson, '"test:spotlight-response"');
includes("package.json", packageJson, '"test:spotlight-winner-handler"');
includes("package.json", packageJson, '"test:spotlight-concurrency"');
includes("check-all", checkAll, '"check:spotlight-selection"');
includes("check-all", checkAll, '"test:spotlight-content"');
includes("check-all", checkAll, '"test:spotlight-response"');
includes("check-all", checkAll, '"test:spotlight-winner-handler"');

[
  "create table if not exists public.member_spotlight_selections",
  "cycle_month date primary key",
  "references public.member_profiles(id) on delete set null",
  "member_spotlight_selections_winner_profile_idx",
  "enable row level security",
  "create policy service_only_default_deny",
  "revoke all on table public.member_spotlight_selections from anon",
  "revoke all on table public.member_spotlight_selections from authenticated",
  "grant select on table public.member_spotlight_selections to service_role",
  "create or replace function private.select_monthly_member_spotlight",
  "create or replace function private.canonical_member_spotlight_name",
  "create or replace function private.backfill_legacy_member_spotlight_selections",
  "security invoker",
  "set search_path = ''",
  "at time zone 'Asia/Singapore'",
  "pg_catalog.pg_advisory_xact_lock",
  "inner join public.member_profiles as profile on profile.id = account.id",
  "account.deleted_at is null",
  "account.banned_until is null or account.banned_until <= selection_time",
  "profile.member_status = 'active'",
  "with eligible as materialized",
  "order by extensions.gen_random_uuid()",
  "select private.backfill_legacy_member_spotlight_selections();",
  "Legacy Spotlight backfill validation failed.",
  "mochirii-send-member-spotlight-poll",
  "mochirii-publish-member-spotlight-winner",
  "mochirii-select-monthly-spotlight-member",
  "'5 16 * * *'",
  "$job$select private.select_monthly_member_spotlight(now());$job$",
].forEach((snippet) => includes("monthly selection migration", migration, snippet));

matches(
  "monthly selection migration",
  migration,
  /canonical_member_spotlight_name\(profile\.display_name\)/i,
  "display-name snapshots must be canonicalized without removing the owning account from eligibility.",
);

excludes(
  "monthly selection migration",
  migration,
  /and\s+(?:char_length\(btrim\(profile\.display_name\)\)|btrim\(profile\.display_name\)\s*!~)/i,
  "active accounts must not be removed from the draw because their display name needs canonicalization.",
);

excludes(
  "monthly selection migration",
  migration,
  /discord_(?:user_id|roles|verified_at)|has_required_discord_roles/i,
  "monthly eligibility must not depend on Discord identity or role state.",
);
excludes(
  "monthly selection migration",
  migration,
  /net\.http|http_post|vault\./i,
  "the database-local monthly selector must not depend on an HTTP request or stored request secret.",
);
matches(
  "monthly selection migration",
  migration,
  /perform\s+pg_catalog\.pg_advisory_xact_lock[\s\S]*?select\s+selection\.\*[\s\S]*?if\s+found\s+then[\s\S]*?return;/i,
  "same-month retries must lock and return the immutable existing winner before drawing.",
);

[
  "select plan(27)",
  "client roles have an explicit restrictive default-deny policy",
  "every active non-banned account remains eligible without Discord or display-name filtering",
  "U&'Lantern\\000A\\200FBeta'",
  "a same-month retry does not redraw",
  "a same-month retry returns the exact original winner",
  "an active account with a control-bearing source name remains eligible and receives a safe public snapshot",
  "pending, suspended, banned, and deleted accounts cannot win",
  "the monthly boundary is calculated in Asia/Singapore",
  "legacy poll schedules are absent",
  "an empty eligible pool fails with one fixed category",
  "the actual migration backfill imports one published legacy winner",
  "the backfill preserves the month and canonical winner snapshot exactly",
  "the actual legacy backfill is idempotent",
].forEach((snippet) => includes("monthly selection database test", databaseTest, snippet));
[
  "private.select_monthly_member_spotlight",
  "exactly one caller must create the month",
  "exactly one caller must replay the month",
  "concurrent callers returned different winners",
  "concurrent calls did not retain one exact row",
  "psqlArguments(sql, true)",
  "waitForBlockedSelection",
  "waiting.granted = false",
  "held.granted = true",
  'first.child.stdin.end("commit;',
].forEach((snippet) => includes("monthly selection concurrency test", concurrencyTest, snippet));
includes("Supabase local Preview workflow", localPreviewWorkflow, "npm run test:spotlight-concurrency");

[
  "cycleMonthForImpl ?? cycleMonthFor",
  '.from("member_spotlight_selections")',
  '.select("cycle_month,winner_display_name")',
  '.eq("cycle_month", currentMonth)',
  '["42P01", "PGRST205"]',
  '.from("spotlight_poll_cycles")',
  "winnerNameForExactMonth",
  "normalizedQueryResult",
  "noStoreJsonResponse",
  'response.headers.set("Cache-Control", "no-store")',
  "record.cycle_month !== currentMonth",
  "selectionResult.data === null",
  "export async function handleCurrentSpotlightWinner",
  "if (import.meta.main)",
].forEach((snippet) => includes("public winner endpoint", publicWinner, snippet));
excludes(
  "public winner endpoint",
  publicWinner,
  /discord_(?:user_id|username|handle)|vote_count|answer_label|candidate|selection_pool_size|winner_profile_id|selected_at|publishedAt|\bsource\s*:/i,
  "the public winner DTO must not expose account, Discord, candidate, vote, source, or audit fields.",
);
excludes(
  "public winner endpoint",
  publicWinner,
  /\.order\(\s*["']cycle_month|message:\s*error\.message/i,
  "the endpoint must not return a prior month or log raw provider diagnostics.",
);
[
  "current selection wins and returns only the two public fields",
  "missing-table transition uses only an exact current-month legacy row",
  "an empty current row never delegates to dormant legacy authority",
  "the actual query builders bind exact tables, columns, filters, and cardinality",
  "stale current and legacy rows are rejected instead of being relabeled",
  "no current winner returns one exact generic current-month DTO",
  "query failures and malformed winner names fail behind fixed public categories",
  "setup and fulfilled-result hostiles resolve behind fixed no-store responses",
  "method, configuration, and month guards fail closed",
].forEach((snippet) => includes("public winner endpoint tests", publicWinnerTest, snippet));

[
  "spotlightWinnerName",
  "spotlightWinnerTitle",
  "spotlightAppreciationLines",
  "spotlightMonthKey",
  "CONTROL_OR_BIDI",
  "WINNER_PLACEHOLDER_PATTERN",
].forEach((snippet) => includes("shared Spotlight content helper", contentHelper, snippet));
[
  "one canonical winner populates both public title formats and Appreciation",
  "missing or hostile winner data remains generic",
  "invalid content collections fail closed",
].forEach((snippet) => includes("Spotlight content tests", contentTest, snippet));

[
  "MAX_SPOTLIGHT_RESPONSE_BYTES = 4_096",
  "MAX_SPOTLIGHT_ENDPOINT_CHARS = 2_048",
  "SPOTLIGHT_FETCH_TIMEOUT_MS = 5_000",
  "readBoundedResponseText",
  'new TextDecoder("utf-8", { fatal: true })',
  "cancelResponseBody",
  "exactRecord",
  "exactSpotlightEndpoint",
  "responseMatchesExactRequest",
  "parseCurrentSpotlightWinnerPayload",
  "singaporeMonthKey",
  "winner?.monthKey === expectedMonthKey",
  '["winnerName", "monthKey"]',
  '["winnerName", "monthKey", "publishedAt", "source"]',
  'legacy.source === "monthly-discord-poll"',
  'cache: "no-store"',
  'redirect: "error"',
  "AbortSignal.timeout(SPOTLIGHT_FETCH_TIMEOUT_MS)",
].forEach((snippet) => includes("Website Spotlight response boundary", responseBoundary, snippet));
[
  "the actual fetch boundary accepts only the exact bounded public winner DTO",
  "extra, malformed, hostile, and obsolete fields fail closed",
  "oversized, wrong-media, and unsuccessful responses are cancelled and rejected",
  "credentialed endpoints and observed URL drift fail before accepting a winner",
  "invalid UTF-8 is rejected instead of becoming replacement text",
  "legacy and current DTOs are bound to the Singapore month across rollover",
].forEach((snippet) => includes("Website Spotlight response tests", responseTest, snippet));

[
  "getCurrentSpotlightWinner",
  "spotlightWinnerTitle",
  "winner?: CurrentSpotlightWinner | null",
].forEach((snippet) => includes("winner title component", winnerComponent, snippet));
excludes(
  "winner title component",
  winnerComponent,
  /["']use client["']|useEffect|useState/,
  "winner resolution must remain server-rendered.",
);

[
  "export async function SpotlightPage()",
  "const winner = await getCurrentSpotlightWinner()",
  "spotlightAppreciationLines(spotlight.body, winner)",
  "const winnerMonth = spotlightMonthKey(winner, \"\")",
  "winnerMonth || spotlightScheduleDate(guildScheduleData, spotlight.date)",
  "winner={winner}",
  '<ProseStack id="spotlightBody" lines={appreciation}',
].forEach((snippet) => includes("Spotlight page", spotlightPage, snippet));
includes("home page", homePage, "SpotlightWinnerTitle");
includes("Spotlight data", spotlightData, "{{winnerName}}");
includes("Spotlight data", spotlightData, "Selected From Active Website Members");
includes("privacy page", privacyPage, "Monthly member Spotlight");
includes("privacy page", privacyPage, "current active member account at");
includes("privacy page", privacyPage, "candidate list, account identifier, and selection audit details remain");

for (const [label, text] of [
  ["winner title component", winnerComponent],
  ["shared Spotlight content helper", contentHelper],
  ["Spotlight page", spotlightPage],
  ["Spotlight data", spotlightData],
  ["Home data", homeData],
  ["schedule data", scheduleData],
]) {
  excludes(label, text, /Meenari/i, "a named historical fallback must not remain on a current Spotlight surface.");
  excludes(label, text, /memberProfileSlug/, "the random Spotlight must not expose or retain a member profile route.");
}

if (failures.length) {
  console.error("Monthly member Spotlight validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Monthly member Spotlight validation OK.");
