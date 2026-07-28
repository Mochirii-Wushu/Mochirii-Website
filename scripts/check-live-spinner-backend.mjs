import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const migrationPath =
  "supabase/migrations/20260726180052_add_private_live_spinner.sql";
const countdownMigrationPath =
  "supabase/migrations/20260727054717_enforce_three_minute_spinner_countdown.sql";
const foreignKeyIndexMigrationPath =
  "supabase/migrations/20260726213000_add_spinner_foreign_key_indexes.sql";
const mediaMigrationPath =
  "supabase/migrations/20260727033342_add_spinner_media_jobs.sql";
const officialRaffleMigrationPath =
  "supabase/migrations/20260727160000_add_official_spinner_raffle_publications.sql";
const reviewedDrawClassificationMigrationPath =
  "supabase/migrations/20260727211442_classify_reviewed_sya_spinner_draw.sql";
const files = {
  migration: migrationPath,
  countdownMigration: countdownMigrationPath,
  foreignKeyIndexMigration: foreignKeyIndexMigrationPath,
  mediaMigration: mediaMigrationPath,
  officialRaffleMigration: officialRaffleMigrationPath,
  reviewedDrawClassificationMigration: reviewedDrawClassificationMigrationPath,
  config: "supabase/config.toml",
  index: "supabase/functions/spinner-live-session/index.ts",
  engine: "supabase/functions/_shared/spinner-live.ts",
  authority: "supabase/functions/_shared/spinner-authority.ts",
  cors: "supabase/functions/_shared/cors.ts",
  dispatcher: "supabase/functions/reaper-spinner-dispatch/index.ts",
  dispatcherShared: "supabase/functions/_shared/spinner-discord-outbox.ts",
  media: "supabase/functions/_shared/spinner-media.ts",
  mediaDispatch: "supabase/functions/_shared/spinner-media-dispatch.ts",
  mediaTest: "supabase/functions/_shared/spinner-media_test.ts",
  test: "supabase/functions/_shared/spinner-live_test.ts",
  sqlTest: "supabase/tests/private_live_spinner_test.sql",
  mediaSqlTest: "supabase/tests/spinner_media_jobs_test.sql",
  winnerRunbook: "docs/operations/SPINNER-RAFFLE-WINNER-PUBLICATION.md",
  reviewedDrawReadback:
    "supabase/operations/validate_reviewed_sya_spinner_classification.sql",
  reviewedDrawFixture:
    "supabase/tests/fixtures/reviewed_sya_spinner_classification.sql",
  reviewedDrawMigrationTest:
    "scripts/test-reviewed-sya-spinner-classification.mjs",
};

function read(rel) {
  const full = path.join(root, rel);
  if (!existsSync(full)) {
    failures.push(`${rel}: missing required file.`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function includes(label, text, snippet) {
  if (!text.includes(snippet)) {
    failures.push(`${label}: expected snippet not found: ${snippet}`);
  }
}

function excludes(label, text, pattern, message) {
  if (pattern.test(text)) failures.push(`${label}: ${message}`);
}

const migration = read(files.migration);
const countdownMigration = read(files.countdownMigration);
const foreignKeyIndexMigration = read(files.foreignKeyIndexMigration);
const mediaMigration = read(files.mediaMigration);
const officialRaffleMigration = read(files.officialRaffleMigration);
const reviewedDrawClassificationMigration = read(
  files.reviewedDrawClassificationMigration,
);
const winnerRunbook = read(files.winnerRunbook);
const reviewedDrawReadback = read(files.reviewedDrawReadback);
const reviewedDrawFixture = read(files.reviewedDrawFixture);
const reviewedDrawMigrationTest = read(files.reviewedDrawMigrationTest);
const config = read(files.config);
const index = read(files.index);
const engine = read(files.engine);
const authority = read(files.authority);
const cors = read(files.cors);
const dispatcher = read(files.dispatcher);
const dispatcherShared = read(files.dispatcherShared);
const media = read(files.media);
const mediaDispatch = read(files.mediaDispatch);
const mediaTest = read(files.mediaTest);
const denoTest = read(files.test);
const sqlTest = read(files.sqlTest);
const mediaSqlTest = read(files.mediaSqlTest);

for (const snippet of [
  "create table if not exists public.spinner_media_jobs",
  "alter table public.spinner_media_jobs enable row level security",
  "revoke all on table public.spinner_media_jobs from public, anon, authenticated",
  "grant all on table public.spinner_media_jobs to service_role",
  "spinner_discord_outbox_create_media_job",
  "exception when others then",
  "Spinner media job was skipped.",
  "render_attempt_count between 0 and 12",
  "outbox.phase = 'completed'",
  "for update of job skip locked",
  "media_size_bytes between 1 and case when media_type = 'image/png' then 3000000 else 4250000 end",
  "discord_message_id !~ '^[0-9]{16,22}$'",
])
  includes("service-only media migration", mediaMigration, snippet);

for (const signature of [
  "spinner_claim_media_jobs(uuid, text, integer)",
  "spinner_bind_media_capability(uuid, uuid, text, timestamptz)",
  "spinner_authorize_media_manifest(uuid, text)",
  "spinner_reserve_media_attachment(uuid, text, uuid, text, integer, text, text)",
  "spinner_finish_media_attachment(uuid, uuid, text, text, text, timestamptz)",
]) {
  includes(
    "service-only media RPC",
    mediaMigration,
    `revoke all on function public.${signature} from public, anon, authenticated`,
  );
  includes(
    "service-only media RPC",
    mediaMigration,
    `grant execute on function public.${signature} to service_role`,
  );
}

[
  "create index spinner_commands_actor_id_idx\non public.spinner_commands (actor_id);",
  "create index spinner_draw_receipts_actor_id_idx\non public.spinner_draw_receipts (actor_id);",
  "create index spinner_live_state_updated_by_idx\non public.spinner_live_state (updated_by);",
].forEach((snippet) =>
  includes("spinner foreign-key indexes", foreignKeyIndexMigration, snippet)
);

for (
  const table of [
    "spinner_live_state",
    "spinner_commands",
    "spinner_draw_receipts",
    "spinner_discord_outbox",
    "spinner_moderator_authorizations",
  ]
) {
  includes(
    "migration",
    migration,
    `create table if not exists public.${table}`,
  );
  includes(
    "migration",
    migration,
    `alter table public.${table} enable row level security`,
  );
  includes(
    "migration",
    migration,
    `revoke all on table public.${table} from public, anon, authenticated`,
  );
  includes(
    "migration",
    migration,
    `grant all on table public.${table} to service_role`,
  );
  includes(
    "migration",
    migration,
    `drop policy if exists service_only_default_deny on public.${table}`,
  );
}

for (
  const signature of [
    "spinner_reserve_command(uuid, text, uuid, bigint, text)",
    "spinner_stage_command(uuid, jsonb)",
    "spinner_reject_unstaged_spin(uuid)",
    "spinner_apply_command(uuid)",
    "spinner_recover_commands()",
    "spinner_finalize_reveal()",
    "spinner_cleanup_expired(timestamptz)",
    "spinner_claim_discord_outbox(uuid, integer)",
    "spinner_finish_discord_outbox_claim(uuid, uuid, text, text, text, timestamptz)",
  ]
) {
  includes(
    "service-only command RPC",
    migration,
    `revoke all on function public.${signature} from public, anon, authenticated`,
  );
  includes(
    "service-only command RPC",
    migration,
    `grant execute on function public.${signature} to service_role`,
  );
}

[
  "revision = next_revision",
  "expected_revision = p_expected_revision",
  "command_id_conflict",
  "command_in_progress",
  "staged_payload",
  "lease_expires_at",
  "unstaged_lease_expired",
  "recoveredReservation",
  "spin_result_not_durable",
  "spinner_recover_commands",
  "idempotentReplay",
  "for update",
].forEach((snippet) =>
  includes("monotonic idempotent commands", migration, snippet)
);

[
  "uniform-uint32-rejection-v1",
  "sampled_words",
  "accepted_word",
  "rejection_limit",
  "spinner_draw_receipts_immutable",
  "Spinner draw receipts must be retained for 30 days.",
  "expires_at >= created_at + interval '30 days'",
  "receipt_timestamp_value",
  "started_at_value <> receipt_timestamp_value + interval '2 seconds'",
  "spinner_cleanup_expired",
  "spinner_moderator_authorizations",
  "expires_at <= verified_at + interval '5 minutes'",
].forEach((snippet) =>
  includes("immutable 30-day receipts", migration, snippet)
);

for (const snippet of [
  "create or replace function public.spinner_apply_command(",
  "started_at_value <> receipt_timestamp_value + interval '3 minutes'",
  "revoke all on function public.spinner_apply_command(uuid) from public, anon, authenticated",
  "grant execute on function public.spinner_apply_command(uuid) to service_role",
])
  includes("three-minute countdown migration", countdownMigration, snippet);
excludes(
  "three-minute countdown migration",
  countdownMigration,
  /interval '2 seconds'/u,
  "the forward migration must replace the released two-second timing rule.",
);

if (
  /delete from public\.spinner_discord_outbox[\s\S]*?spinner_live_state[\s\S]*?get diagnostics outbox_count/i
    .test(migration)
) {
  failures.push(
    "retention cleanup: an active live-state pointer must not extend expired outbox retention.",
  );
}
if (
  /delete from public\.spinner_draw_receipts[\s\S]*?spinner_live_state[\s\S]*?get diagnostics receipt_count/i
    .test(migration)
) {
  failures.push(
    "retention cleanup: an active live-state pointer must not extend expired receipt retention.",
  );
}

[
  "spinner_discord_outbox_draw_channel_key unique (draw_id, channel_key)",
  "channel_key = 'raffle_spins' and channel_id = '1468667003366674721'",
  "discord_message_id text",
  "start_pending",
  "result_waiting",
  "result_pending",
  "claim_token uuid",
  "for update skip locked",
  "claim_expires_at",
  "delivery_attempts_exhausted",
  "enforce_nonce",
  "allowed_mentions,parse",
  "allowed_mentions,replied_user",
  "spinner_discord_outbox_queue_dispatch",
  "spinner_invoke_reaper_dispatcher",
  "net.http_post",
  "spinner-maintenance-every-5-seconds",
  "'5 seconds'",
  "reaper_spinner_dispatch_secret",
].forEach((snippet) =>
  includes("single-message Discord outbox", migration, snippet)
);

[
  "getRandomValues",
  "Math.floor(UINT32_RANGE / count) * count",
  "sampledWords.push(word)",
  "word < rejectionLimit",
  "SPINNER_START_DELAY_MS = 180_000",
  "SPINNER_DEFAULT_DURATION_MS = 4_800",
  "startRotation",
  "finalRotation",
  "https://mochirii.com/account?open=live-draw",
  "A Mōchirīī monthly guild raffle begins <t:${startAtUnixSeconds}:R>.",
  "allowed_mentions",
  "A live roster supports 0–",
  "A draw requires",
  'normalize("NFKC").trim()',
  '.toLocaleUpperCase("und")',
  "SPINNER_MAX_COMMAND_BODY_BYTES = 64 * 1_024",
  "readBoundedSpinnerJsonObject",
].forEach((snippet) => includes("server draw engine", engine, snippet));

for (const snippet of [
  'export type SpinnerDrawMode = "official" | "test"',
  "drawMode: SpinnerDrawMode",
  "normalizeDrawMode",
  "BIDI_CONTROL_PATTERN",
  "CONTROL_PATTERN",
  "Array.from(displayName).length > SPINNER_MAX_NAME_GRAPHEMES",
]) includes("server draw classification", engine, snippet);

for (const snippet of [
  "spinner_prepare_outbox_draw_mode",
  "if receipt_mode = 'test' then return null",
  "spinner_publish_official_raffle_result",
  "spinner_raffle_result_publications",
  "get_latest_official_raffle_winner",
  "publication.reveal_at <= now()",
  "cycle_month = raffle_month",
  "else outbox_row.reveal_after",
  "2026-07-27 15:29:29.763+00",
  "2026-07-27 15:32:34.563+00",
  "2026-07-27 15:32:39.181748+00",
  "receipt.winner ->> 'displayName' = 'Sya'",
  "char_length(winner_display_name) between 1 and 40",
  "winner_display_name !~ U&'[\\202A-\\202E\\2066-\\2069]'",
  "drop function private.spinner_backfill_2026_07_reviewed_result()",
]) includes("official raffle publication migration", officialRaffleMigration, snippet);

excludes(
  "official raffle publication migration",
  officialRaffleMigration,
  /spinner_complete_official_raffle_result/u,
  "public visibility must not depend on external delivery completion",
);

for (const snippet of [
  "begin;",
  "lock table public.spinner_raffle_result_publications in share row exclusive mode",
  "publication.source_mode = 'legacy-reviewed'",
  "publication.cycle_month = '2026-07-01'::date",
  "publication.selected_at = '2026-07-27 15:29:29.763+00'::timestamptz",
  "publication.reveal_at = '2026-07-27 15:32:34.563+00'::timestamptz",
  "publication.published_at = '2026-07-27 15:32:39.181748+00'::timestamptz",
  "publication.winner_display_name = 'Sya'",
  "publication.approved_by = receipt.actor_id",
  "receipt.receipt ->> 'drawId' = receipt.draw_id::text",
  "receipt.roster_snapshot -> 'participants' -> receipt.selected_index = receipt.winner",
  "outbox.phase = 'completed'",
  "live.phase = 'revealed'",
  "exact_match_count <> 1",
  "receipt_mode = 'official' and outbox_mode = 'official' and live_mode = 'official'",
  "receipt_mode <> 'unclassified'",
  "disable trigger spinner_draw_receipts_immutable",
  "enable trigger spinner_draw_receipts_immutable",
  "set draw_mode = 'official'",
  "The reviewed spinner classification postcondition failed.",
  "Historical rows remain unclassified except for exact reviewed backfills",
  "commit;",
]) {
  includes(
    "reviewed Sya classification migration",
    reviewedDrawClassificationMigration,
    snippet,
  );
}

for (const snippet of [
  "reviewed-sya-test@example.invalid",
  "draw_mode = 'unclassified'",
  "'legacy-reviewed'",
]) {
  includes("reviewed Sya populated-state fixture", reviewedDrawFixture, snippet);
}
for (const snippet of [
  "resetTo(priorVersion)",
  'assertReadbackState("t|t|t|t|f|t|f")',
  "psql(migrationSql)",
  'assertDatabaseState("official|official|official|3")',
  'assertReadbackState("t|t|t|f|t|t|t")',
  "expectFailure: true",
  "forced reviewed Sya classification rollback test",
  "expectedError: /ERROR:",
  'assertDatabaseState("unclassified|unclassified|unclassified|3")',
  "resetTo()",
]) {
  includes("reviewed Sya migration execution test", reviewedDrawMigrationTest, snippet);
}
for (const forbidden of [
  /insert\s+into\s+public\.spinner_/iu,
  /delete\s+from\s+public\.spinner_/iu,
  /update\s+public\.spinner_raffle_result_publications/iu,
  /update\s+public\.spinner_raffle_result_revocations/iu,
  /net\.http_post/iu,
  /discord/iu,
]) {
  excludes(
    "reviewed Sya classification migration",
    reviewedDrawClassificationMigration.replace(/spinner_discord_outbox/gu, "spinner_delivery_outbox"),
    forbidden,
    `forbidden side effect matched ${forbidden}`,
  );
}

for (const snippet of [
  "winner_display_name = 'Sya'",
  "cycle_month = '2026-07-01'::date",
  "publication_count = 1",
  "exact_state_count = 1",
  "revocation_count = 0",
  "wholly_unclassified_count = 1",
  "wholly_official_count = 1",
  "migration_ready",
  "all_checks_pass",
]) {
  includes("reviewed Sya readback", reviewedDrawReadback, snippet);
}

for (const snippet of [
  "Signed-out and unverified visitors receive exactly `Winner Confirmed`",
  "A test receipt is durable for private review",
  "drops the temporary backfill function",
  "current 34-function inventory and 20/14 JWT parity",
  "20260727211442_classify_reviewed_sya_spinner_draw.sql",
  "does not publish, announce, redraw, or create a reward",
]) includes("spinner raffle winner runbook", winnerRunbook, snippet);

includes(
  "authoritative Reaper schedule",
  index,
  "buildDiscordOutboxPayloads(plan.receipt, plan.startAt)",
);
includes(
  "former timing rejection coverage",
  sqlTest,
  "the released two-second lead is rejected by the forward timing rule",
);

for (const snippet of [
  "AnimationManifestV1",
  "mochirii-raffle-film-v1",
  "SPINNER_MEDIA_DURATION_MS = 10_600",
  "SPINNER_MEDIA_MAX_MP4_BYTES = 4_250_000",
  "SPINNER_MEDIA_MAX_PNG_BYTES = 3 * 1_000_000",
  "wheelSegmentLabel",
  "mochirii-spinner-visual-v1\\0",
  "createSpinnerMediaToken",
  "verifySpinnerMediaToken",
  "validateSpinnerMedia",
])
  includes("immutable media contract", media, snippet);
excludes(
  "immutable media contract",
  media,
  /receipt\.acceptedWord/u,
  "visual presentation must not reuse raffle RNG output.",
);

for (const snippet of [
  "attachSpinnerMedia",
  "already_attached",
  "reconciled",
  '"files[0]"',
  "allowed_mentions",
  "SPINNER_DISCORD_CHANNEL_ID",
])
  includes("idempotent media attachment", mediaDispatch, snippet);

excludes(
  "server draw engine",
  engine,
  /Math\.random\s*\(/,
  "Math.random must never be used.",
);
excludes(
  "spinner Edge function",
  index,
  /https:\/\/discord(?:app)?\.com|discordFetch\s*\(/i,
  "Discord delivery must stay in the outbox; this function must not send messages.",
);
excludes(
  "spinner backend",
  `${migration}\n${index}\n${engine}`,
  /realtime\.send|realtime\.messages|wss:\/\//i,
  "the browser contract is durable same-origin polling, not a direct Realtime channel.",
);

[
  'req.method === "GET"',
  'req.method === "POST"',
  'type SpinnerAction = "set_roster" | "spin" | "reset"',
  "requireSpinnerController(req)",
  "authenticateSpinnerUser(req)",
  "requireActiveVerifiedSpinnerMember(req)",
  "resolveModeratorAuthorizationRoute(",
  "requestedSpinnerAccessMode(req)",
  "spinner_finalize_reveal",
  "spinner_recover_commands",
  "spinner_reserve_command",
  "spinner_stage_command",
  "spinner_reject_unstaged_spin",
  "spinner_apply_command",
  "if-none-match",
  "ETag",
  "serverNow",
  "X-Mochirii-Server-Time",
  'SPINNER_VARY = "Authorization, X-Mochirii-Spinner-Mode"',
  'mode === "controller" && snapshot.drawId',
  'snapshot.phase !== "revealed"',
  '.from("spinner_draw_receipts")',
  "buildSnapshotResponseData(",
  '.select("receipt,command_id")',
  "appliedCommandResponse(applied, commandId)",
  '.from("spinner_moderator_authorizations")',
  "rememberModeratorAuthorization(",
  "readBoundedSpinnerJsonObject(req)",
  "rejectUnstagedSpin(moderator.adminClient, commandId)",
  "const drawMode = normalizeDrawMode(body.drawMode)",
  "commandInput = { action, expectedRevision, durationMs, drawMode }",
].forEach((snippet) => includes("Edge HTTP contract", index, snippet));

includes(
  "protected response variance",
  cors,
  "existing ? `${existing}, ${value}` : value",
);

const reservePosition = index.indexOf('"spinner_reserve_command"');
const randomPosition = index.indexOf("createLiveDrawPlan(");
const stagePosition = index.indexOf('"spinner_stage_command"');
const applyPosition = index.lastIndexOf('"spinner_apply_command"');
if (
  !(reservePosition >= 0 && randomPosition > reservePosition &&
    stagePosition > randomPosition && applyPosition > stagePosition)
) {
  failures.push(
    "Edge draw ordering: reserve must precede selection, which must be staged before transactional apply.",
  );
}

for (const snippet of [
  "buildAnimationManifest(plan.receipt, plan)",
  "animationManifestHash(animationManifest)",
  "animationManifest,",
  "animationManifestHashSha256",
])
  includes("durable media staging", index, snippet);

[
  'member_status === "active"',
  "RECENT_VERIFICATION_MS",
  'gallery_access_status === "approved"',
  "gallery_access_verified_at",
  "gallery_access_expires_at",
  "member_auth_identities",
  '.eq("active", true)',
  "resolveDiscordIdentity(",
  "profileMatchesTrustedDiscordIdentity(",
  "adminClient.auth.getUser(",
  "accessToken",
  "resolveModeratorAuthorizationRoute",
].forEach((snippet) =>
  includes("verified member authority", authority, snippet)
);

[
  "[functions.spinner-live-session]",
  "verify_jwt = true",
  'import_map = "./functions/spinner-live-session/deno.json"',
].forEach((snippet) => includes("Supabase function config", config, snippet));

[
  "[functions.reaper-spinner-dispatch]",
  "verify_jwt = false",
  'import_map = "./functions/reaper-spinner-dispatch/deno.json"',
].forEach((snippet) => includes("Reaper dispatcher config", config, snippet));

[
  "REAPER_SPINNER_DISPATCH_SECRET",
  "dispatchSecret.length < 32",
  "dispatchSecret.length > 512",
  "DISCORD_RAFFLE_CHANNEL_ID",
  "spinner_claim_discord_outbox",
  "spinner_finish_discord_outbox_claim",
  "dispatchSpinnerOutboxRow",
  "constantTimeSecretEqual",
  "readBoundedJsonObject",
].forEach((snippet) =>
  includes("authorized Reaper dispatcher", dispatcher, snippet)
);

for (const snippet of [
  "x-mochirii-spinner-media-capability",
  'actionBody.value.action !== "manifest"',
  "spinner_claim_media_jobs",
  "spinner_bind_media_capability",
  "spinner_authorize_media_manifest",
  "spinner_reserve_media_attachment",
  "spinner_finish_media_attachment",
  "requestRenderedMedia",
  'mediaType !== "image/png" && mediaType !== "video/mp4"',
  'MEDIA_RENDER_URL = "https://mochirii.com/spinner/media/render"',
  "RENDER_TIMEOUT_MS = 55_000",
  "EdgeRuntime.waitUntil",
  "scheduleMediaBackgroundTask",
  "provisionFallbackMediaJobs",
])
  includes("capability-scoped media dispatcher", dispatcher, snippet);
excludes(
  "capability-scoped media dispatcher",
  dispatcher,
  /x-mochirii-spinner-media-action/u,
  "manifest requests must use the single bounded JSON action contract.",
);

const fallbackProvisionerStart = dispatcher.indexOf(
  "async function provisionFallbackMediaJobs(",
);
const rendererRequestStart = dispatcher.indexOf(
  "async function requestRenderedMedia(",
  fallbackProvisionerStart,
);
if (fallbackProvisionerStart < 0 || rendererRequestStart < 0) {
  failures.push(
    "fallback media backgrounding: provisioner boundary is missing.",
  );
} else {
  const fallbackProvisioner = dispatcher.slice(
    fallbackProvisionerStart,
    rendererRequestStart,
  );
  includes(
    "fallback media backgrounding",
    fallbackProvisioner,
    "scheduleMediaBackgroundTask(",
  );
  excludes(
    "fallback media backgrounding",
    fallbackProvisioner,
    /await\s+(?:requestRenderedMedia|renderAndAttach|attachWithAdminClient)\s*\(/u,
    "fallback rendering or attachment must not block the dispatcher response.",
  );
}

for (const snippet of [
  'response.headers.get("retry-after")',
  "error.retry_after",
  "Math.max(...retrySeconds)",
])
  includes("media rate-limit retry", mediaDispatch, snippet);

[
  'method: "POST"',
  'method: "PATCH"',
  "start_sent",
  "result_sent",
  "retry-after",
  "discord_network_error",
  "safeAllowedMentions",
  "SPINNER_DISPATCH_MAX_BODY_BYTES",
  'crypto.subtle.digest("SHA-256"',
].forEach((snippet) =>
  includes("idempotent Reaper delivery", dispatcherShared, snippet)
);

[
  "records rejection retries without modulo bias",
  "future synchronized timeline",
  "three-minute lead preserves the existing wheel duration",
  "controller polling can recover the current receipt while viewer polling cannot",
  "withhold winner fields",
  "no mentions",
  "recently verified guild members",
  "defaults to viewer authority and opts into moderator checks explicitly",
  "moderator polling cache expires at the five-minute revocation boundary",
  "POST controller authorization uses current cache and exact fallback at missing or expired boundaries",
  "spinner command JSON accepts the 64 KiB boundary and rejects declared or streamed overflow",
  "normalization matches the browser Unicode and whitespace contract",
  "repeated live spins keep rotations bounded and preserve winner geometry",
  "spinner polling preserves authorization and mode variance when CORS adds origin",
  "posts the scheduled handoff once with an enforced nonce",
  "retries rate limits",
  "compares secrets without an early mismatch and caps request bodies",
].forEach((snippet) => includes("focused Deno tests", denoTest, snippet));

for (const snippet of [
  "animation manifest is deterministic",
  "Unicode-safe page truncation",
  "signed, bound, expiring",
  "platform-safe byte ceilings",
  "lost response is reconciled without posting twice",
  "winner message is not ready",
  "same-message multipart edit",
  "message lookup 429 honors",
  "media upload 429 honors",
  "deleted winner message",
  "malformed media never reserves",
])
  includes("focused media tests", mediaTest, snippet);

[
  "RLS is enabled on every authoritative spinner table",
  "browser roles cannot apply moderator commands",
  "receipt immutability trigger is enabled",
  "one outbox row is keyed by draw and semantic channel",
  "persisted spin reservation lost before staging is terminal so its exact command ID cannot resample",
  "an Edge failure terminalizes an unstaged spin so retry requires a new command ID",
  "exhausted delivery is failed deterministically instead of violating its attempt bound",
  "retention cleanup removes expired evidence after 30 days even when the live stage still points at that draw",
].forEach((snippet) => includes("focused pgTAP tests", sqlTest, snippet));

for (const snippet of [
  "browser roles have no direct media job access",
  "service role can invoke every atomic media transition",
  "pre-reserve renderer failures consume a bounded claim budget",
  "render work cannot begin before the winner message is complete",
  "type-bound filename",
])
  includes("focused media pgTAP tests", mediaSqlTest, snippet);

if (failures.length) {
  console.error("Live spinner backend validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Live spinner backend validation OK.");
