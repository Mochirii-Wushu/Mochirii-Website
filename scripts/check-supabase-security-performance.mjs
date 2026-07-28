import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { SITE_ORIGIN, SOCIAL_HOST } from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];
const oldGamePrefix = ["mochi", "social"].join("_");
const currentGamePrefix = ["mochi", "pets"].join("_");

const requiredIndexSnippets = [
  "gallery_submissions_user_id_idx",
  "gallery_submissions_reviewed_by_idx",
  "gallery_submissions_public_feed_order_idx",
  "gallery_submissions_public_feed_category_order_idx",
  "gallery_instagram_publish_jobs_queued_by_idx",
  "gallery_instagram_publish_jobs_published_by_idx",
  "gallery_instagram_publish_events_actor_id_idx",
  "member_profile_media_reviewed_by_idx",
  "member_profile_media_events_actor_id_idx",
  "member_verifications_reviewed_by_idx",
  "member_profiles_approved_avatar_media_id_idx",
  "member_profiles_approved_banner_media_id_idx",
  "discord_sync_log_resource_id_idx",
  "spotlight_poll_cycles_winner_profile_id_idx",
  "spotlight_poll_candidates_member_profile_id_idx",
  "spotlight_poll_results_member_profile_id_idx",
  "mochi_pets_alpha_testers_invited_by_idx",
  "mochi_pets_chain_operations_user_id_idx",
  "mochi_pets_chat_messages_user_id_idx",
  "mochi_pets_chat_reports_message_id_idx",
  "mochi_pets_chat_reports_reporter_id_idx",
  "mochi_pets_feedback_user_id_idx",
  "mochi_pets_inventory_owner_id_idx",
  "mochi_pets_ledger_events_actor_id_idx",
  "mochi_pets_market_listings_inventory_id_idx",
  "mochi_pets_market_listings_seller_id_idx",
  "mochi_pets_spirits_owner_id_idx",
  "mochi_pets_pets_owner_id_idx",
  "mochi_pets_shared_pet_snapshots_last_actor_id_idx",
  "mochi_pets_trades_recipient_id_idx",
  "mochi_pets_trades_requester_id_idx",
];

const mochiPetsCompatibilitySnippets = [
  `('${oldGamePrefix}_spirits', 'mochi_pets_spirits')`,
  `('${oldGamePrefix}_pets', 'mochi_pets_pets')`,
  `('${oldGamePrefix}_progress_snapshots', 'mochi_pets_progress_snapshots')`,
  `('${oldGamePrefix}_spirits_owner_id_idx', 'mochi_pets_spirits_owner_id_idx')`,
  `('${oldGamePrefix}_pets_owner_id_idx', 'mochi_pets_pets_owner_id_idx')`,
  `('mochi_pets_spirits', '${oldGamePrefix}_spirits_read_own', 'mochi_pets_spirits_read_own')`,
  `('mochi_pets_pets', '${oldGamePrefix}_pets_read_own', 'mochi_pets_pets_read_own')`,
  `('mochi_pets_progress_snapshots', '${oldGamePrefix}_progress_read_own', 'mochi_pets_progress_read_own')`,
  "grant %s on table public.%I to %I",
];

const serviceOnlyTables = [
  "discord_managed_permission_overwrites",
  "discord_resources",
  "discord_sync_log",
  "gallery_instagram_publish_events",
  "gallery_instagram_publish_jobs",
  "gallery_moderation_events",
  "member_auth_identities",
  "member_verifications",
  "spotlight_poll_candidates",
  "spotlight_poll_cycles",
  "spotlight_poll_results",
  "vote_confirmations",
  "vote_reminder_sends",
];

const serviceOnlyPolicyMigration = read(
  "supabase/migrations/20260712164503_service_only_default_deny_policies.sql",
);

const socialAccountSnippets = [
  "create table if not exists public.social_accounts",
  "constraint social_accounts_visible_requires_active_check",
  "create unique index if not exists social_accounts_user_provider_key",
  "create unique index if not exists social_accounts_provider_subject_key",
  "create index if not exists social_accounts_visible_profile_idx",
  "grant select on table public.social_accounts to authenticated",
  "grant update (profile_link_visible) on table public.social_accounts to authenticated",
  "grant all on table public.social_accounts to service_role",
  "create policy \"Members can read their own social accounts\"",
  "create policy \"Members can update social account visibility\"",
  "on public.social_accounts",
  "using ((select auth.uid()) = user_id)",
  "with check ((select auth.uid()) = user_id)",
];

const protectedFunctions = [
  "verify-discord-member",
  "verify-member-access",
  "review-member-verification",
  "list-gallery-review-queue",
  "moderate-gallery-submission",
  "list-instagram-publish-queue",
  "publish-instagram-gallery-submission",
  "mark-instagram-gallery-submission-shared",
  "list-member-profiles",
  "get-member-profile",
  "submit-member-profile-media",
  "list-member-profile-media-queue",
  "moderate-member-profile-media",
  "submit-discord-gallery-image",
  "send-vote-reminder",
  "send-member-spotlight-poll",
  "publish-member-spotlight-winner",
];

const publicFunctions = [
  "list-approved-gallery-submissions",
  "list-visible-profile-cards",
  "get-current-spotlight-winner",
];

function read(rel) {
  const full = path.join(root, rel);
  if (!existsSync(full)) {
    failures.push(`${rel}: missing required file.`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function assertIncludes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCreatedPublicTables(sql) {
  const tables = new Set();
  const pattern = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-zA-Z0-9_]+)\1\b/gi;
  for (const match of sql.matchAll(pattern)) {
    tables.add(match[2]);
  }
  return [...tables].sort();
}

function tableGrantNames(table) {
  const oldGameTablePrefix = `${oldGamePrefix}_`;
  return [...new Set([
    table,
    table.startsWith(oldGameTablePrefix) ? `${currentGamePrefix}_${table.slice(oldGameTablePrefix.length)}` : table,
  ])];
}

function hasRlsEnableForTable(sql, table) {
  const name = escapeRegExp(table);
  return new RegExp(`\\balter\\s+table\\s+public\\."?${name}"?\\s+enable\\s+row\\s+level\\s+security\\b`, "i").test(sql);
}

function hasExplicitGrantForTable(sql, table) {
  return tableGrantNames(table).some((name) => {
    const escaped = escapeRegExp(name);
    const literalGrant = new RegExp(`\\bgrant\\b[\\s\\S]{0,240}?\\bon\\s+(?:table\\s+)?public\\."?${escaped}"?\\s+to\\s+`, "i");
    const dynamicGrant = sql.includes(`('${name}',`) && sql.includes("'grant %s on table public.%I to %I'");
    return literalGrant.test(sql) || dynamicGrant;
  });
}

function assertServiceOnlyBoundary(table) {
  const name = escapeRegExp(table);
  const checks = [
    [
      "revoked public, anon, and authenticated grants",
      new RegExp(
        `\\brevoke\\s+all\\s+on\\s+table\\s+public\\.${name}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
        "i",
      ),
    ],
    [
      "service_role grant",
      new RegExp(
        `\\bgrant\\s+all\\s+on\\s+table\\s+public\\.${name}\\s+to\\s+service_role\\s*;`,
        "i",
      ),
    ],
    [
      "idempotent policy replacement",
      new RegExp(
        `\\bdrop\\s+policy\\s+if\\s+exists\\s+service_only_default_deny\\s+on\\s+public\\.${name}\\s*;`,
        "i",
      ),
    ],
    [
      "restrictive false policy for client roles",
      new RegExp(
        `\\bcreate\\s+policy\\s+service_only_default_deny\\s+on\\s+public\\.${name}`
          + "\\s+as\\s+restrictive\\s+for\\s+all\\s+to\\s+anon\\s*,\\s*authenticated"
          + "\\s+using\\s*\\(\\s*false\\s*\\)\\s+with\\s+check\\s*\\(\\s*false\\s*\\)\\s*;",
        "i",
      ),
    ],
  ];

  for (const [label, pattern] of checks) {
    if (!pattern.test(serviceOnlyPolicyMigration)) {
      failures.push(`Service-only boundary for public.${table}: missing ${label}.`);
    }
  }
}

const packageJson = read("package.json");
const checkAll = read("scripts/check-all.mjs");
const readme = read("supabase/README.md");
const corsHelper = read("supabase/functions/_shared/cors.ts");
const publicOriginsHelper = read("supabase/functions/_shared/public-origins.ts");
const memberProfilesShared = read("supabase/functions/_shared/member-profiles.ts");
const spotlightPollsShared = read("supabase/functions/_shared/spotlight-polls.ts");
const pixelfedSocialSync = read("supabase/functions/sync-pixelfed-social-account/index.ts");
const currentState = read("docs/current-live-state.md");
const migrationsDir = path.join(root, "supabase/migrations");
const migrationText = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(migrationsDir, file), "utf8"))
  .join("\n");

assertIncludes("package.json", packageJson, '"check:supabase-security-performance"');
assertIncludes("check-all", checkAll, "check:supabase-security-performance");

for (const snippet of requiredIndexSnippets) {
  assertIncludes("Supabase FK index migrations", migrationText, snippet);
}

[
  "revoke all on function public.gallery_public_feed_page_v2(integer, timestamptz, timestamptz, timestamptz, uuid, text, text, text)",
  "grant execute on function public.gallery_public_feed_page_v2(integer, timestamptz, timestamptz, timestamptz, uuid, text, text, text)",
  "revoke all on function public.gallery_public_original_v2(uuid)",
  "grant execute on function public.gallery_public_original_v2(uuid)",
  "from public, anon, authenticated;",
  "to service_role;",
].forEach((snippet) => assertIncludes("Gallery service-only function grants", migrationText, snippet));

for (const table of extractCreatedPublicTables(migrationText)) {
  if (!hasRlsEnableForTable(migrationText, table)) {
    failures.push(`Supabase public table guardrail: public.${table} is created without an explicit RLS enable migration.`);
  }

  if (!hasExplicitGrantForTable(migrationText, table)) {
    failures.push(`Supabase public table guardrail: public.${table} is created without explicit Data API grants.`);
  }
}

for (const snippet of mochiPetsCompatibilitySnippets) {
  assertIncludes("Mochi Pets table-aware compatibility migration", migrationText, snippet);
}

[
  "using ((select auth.uid()) = user_id)",
  "using ((select auth.uid()) = owner_id)",
  "with check ((select auth.uid()) = reporter_id)",
  "using ((select auth.role()) = 'authenticated' and expires_at > now())",
].forEach((snippet) => assertIncludes("Supabase optimized RLS migrations", migrationText, snippet));

for (const table of serviceOnlyTables) {
  assertIncludes("Supabase README service-only table allowlist", readme, `\`${table}\``);
  assertServiceOnlyBoundary(table);
}

[
  "Required service-only relation is missing",
  "RLS must remain enabled",
  "Explicit service-only policy is incomplete",
  "Client role retained",
  "service_role is missing",
].forEach((snippet) => assertIncludes("Service-only migration verification", serviceOnlyPolicyMigration, snippet));

for (const snippet of socialAccountSnippets) {
  assertIncludes("Pixelfed social account mapping migration", migrationText, snippet);
}

assertIncludes("Supabase README Pixelfed mapping docs", readme, "`social_accounts` maps a signed-in website member");

[
  "import { SITE_ORIGIN } from \"./public-origins.ts\"",
  "https://mochirii.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "host.endsWith(\".vercel.app\")",
  "Vary",
  "Origin",
].forEach((snippet) => assertIncludes("protected CORS helper", corsHelper, snippet));

[
  `SITE_ORIGIN = "${SITE_ORIGIN}"`,
  `SOCIAL_ORIGIN = "${SOCIAL_HOST}"`,
  "siteUrl(path = \"\")",
  "socialUrl(path = \"\")",
].forEach((snippet) => assertIncludes("Edge public origins helper", publicOriginsHelper, snippet));

for (const name of protectedFunctions) {
  const source = read(`supabase/functions/${name}/index.ts`);
  assertIncludes(`${name} CORS wrapper`, source, "withProtectedCors(req, handleRequest(req))");
  assertIncludes(`${name} request handler`, source, "async function handleRequest(req: Request): Promise<Response>");
}

for (const name of publicFunctions) {
  const source = read(`supabase/functions/${name}/index.ts`);
  if (source.includes("withProtectedCors")) {
    failures.push(`${name}: public-safe DTO endpoint must not use protected-origin CORS.`);
  }
}

assertIncludes("list-approved-gallery-submissions public CORS", read("supabase/functions/list-approved-gallery-submissions/index.ts"), "\"Access-Control-Allow-Origin\": \"*\"");
assertIncludes("member profile public card shared CORS", memberProfilesShared, "\"Access-Control-Allow-Origin\": \"*\"");
assertIncludes("spotlight public winner shared CORS", spotlightPollsShared, "\"Access-Control-Allow-Origin\": \"*\"");
[
  "PIXELFED_SOCIAL_SYNC_SECRET",
  "auth.admin.getUserById",
  ".from(\"social_accounts\")",
  "provider: \"pixelfed\"",
  "federation_enabled: false",
].forEach((snippet) => assertIncludes("Pixelfed social sync Edge Function", pixelfedSocialSync, snippet));

[
  "Supabase CLI",
  "leaked-password protection",
  "service-role-only",
  "Mochi Pets",
  "deferred",
].forEach((snippet) => assertIncludes("current Supabase security posture docs", `${currentState}\n${readme}`, snippet));

if (failures.length) {
  console.error("Supabase security/performance validation failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Supabase security/performance validation OK.");
