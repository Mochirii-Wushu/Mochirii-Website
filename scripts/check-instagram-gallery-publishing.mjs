import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const files = {
  packageJson: "package.json",
  checkAll: "scripts/check-all.mjs",
  config: "supabase/config.toml",
  migrationHistory: "supabase/migrations/20260607094500_restore_instagram_gallery_publishing_history.sql",
  migration: "supabase/migrations/20260607125027_add_instagram_gallery_publishing.sql",
  publicationMigration: "supabase/migrations/20260728132000_add_gallery_publication_revisions.sql",
  hardeningMigration: "supabase/migrations/20260729054645_harden_instagram_gallery_publishing.sql",
  consentHandshakeMigration: "supabase/migrations/20260729065000_enforce_instagram_consent_contract_handshake.sql",
  socialDerivativeMigration: "supabase/migrations/20260729062000_add_sanitized_social_derivatives.sql",
  claimConsentMigration: "supabase/migrations/20260729064000_enforce_social_publish_claim_consent.sql",
  sourceBindingMigration: "supabase/migrations/20260729070000_bind_social_derivatives_to_consent_source.sql",
  reconciliationMigration: "supabase/migrations/20260729071000_allow_audited_instagram_legacy_reconciliation.sql",
  manualMigrationHistory: "supabase/migrations/20260608093407_restore_manual_instagram_share_history.sql",
  discordIngest: "supabase/functions/submit-discord-gallery-image/index.ts",
  moderation: "supabase/functions/moderate-gallery-submission/index.ts",
  listQueue: "supabase/functions/list-instagram-publish-queue/index.ts",
  checkMeta: "supabase/functions/check-instagram-api-status/index.ts",
  publish: "supabase/functions/publish-instagram-gallery-submission/index.ts",
  resolve: "supabase/functions/resolve-instagram-publish-reconciliation/index.ts",
  sharedPublishing: "supabase/functions/_shared/instagram-publishing.ts",
  sharedPublishingTest: "supabase/functions/_shared/instagram-publishing_test.ts",
  databaseTest: "supabase/tests/instagram_gallery_publishing_hardening_test.sql",
  markShared: "supabase/functions/mark-instagram-gallery-submission-shared/index.ts",
  envExample: "supabase/functions/.env.example",
  supabaseReadme: "supabase/README.md",
  moderationRunbook: "docs/member-gallery-moderation-runbook.md",
  deploymentRunbook: "docs/instagram-gallery-publishing-deployment-runbook.md",
  integrationContract: "docs/integrations/instagram-gallery-publishing.md",
  nextSubmit: "apps/web/components/member-workflow/GallerySubmitForm.tsx",
  nextDashboard: "apps/web/components/member-workflow/LeaderDashboard.tsx",
  nextDashboardParts: "apps/web/components/member-workflow/LeaderDashboardParts.tsx",
  nextHelpers: "apps/web/lib/supabase/moderation.ts",
  nextUploads: "apps/web/lib/supabase/gallery-submissions.ts",
  actionConfirmation: "apps/web/lib/gallery/instagram-action-confirmation.ts",
  actionConfirmationTest: "apps/web/lib/gallery/instagram-action-confirmation_test.ts",
  galleryMedia: "apps/web/lib/gallery-thumbnail.ts",
};

const failures = [];

function read(file) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) {
    failures.push(`${file}: missing Instagram gallery publishing file.`);
    return "";
  }
  return readFileSync(fullPath, "utf8");
}

function assertIncludes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

function assertMatches(label, text, pattern, message) {
  if (!pattern.test(text)) failures.push(`${label}: ${message}`);
}

function assertNotMatches(label, text, pattern, message) {
  if (pattern.test(text)) failures.push(`${label}: ${message}`);
}

function walkFiles(dir, results = []) {
  const full = path.join(root, dir);
  if (!existsSync(full)) return results;
  for (const entry of readdirSync(full)) {
    const child = path.join(full, entry);
    const stat = statSync(child);
    if (stat.isDirectory()) {
      if ([".next", "node_modules"].includes(entry)) continue;
      walkFiles(path.relative(root, child), results);
    } else {
      results.push(path.relative(root, child).replaceAll("\\", "/"));
    }
  }
  return results;
}

const packageJson = read(files.packageJson);
const checkAll = read(files.checkAll);
const config = read(files.config);
const migrationHistory = read(files.migrationHistory);
const migration = read(files.migration);
const publicationMigration = read(files.publicationMigration);
const hardeningMigration = read(files.hardeningMigration);
const consentHandshakeMigration = read(files.consentHandshakeMigration);
const socialDerivativeMigration = read(files.socialDerivativeMigration);
const claimConsentMigration = read(files.claimConsentMigration);
const sourceBindingMigration = read(files.sourceBindingMigration);
const reconciliationMigration = read(files.reconciliationMigration);
const manualMigrationHistory = read(files.manualMigrationHistory);
const discordIngest = read(files.discordIngest);
const moderation = read(files.moderation);
const listQueue = read(files.listQueue);
const checkMeta = read(files.checkMeta);
const publish = read(files.publish);
const resolve = read(files.resolve);
const sharedPublishing = read(files.sharedPublishing);
const sharedPublishingTest = read(files.sharedPublishingTest);
const databaseTest = read(files.databaseTest);
const markShared = read(files.markShared);
const envExample = read(files.envExample);
const supabaseReadme = read(files.supabaseReadme);
const moderationRunbook = read(files.moderationRunbook);
const deploymentRunbook = read(files.deploymentRunbook);
const integrationContract = read(files.integrationContract);
const nextSubmit = read(files.nextSubmit);
const nextDashboard = [read(files.nextDashboard), read(files.nextDashboardParts)].join("\n");
const nextHelpers = read(files.nextHelpers);
const nextUploads = read(files.nextUploads);
const actionConfirmation = read(files.actionConfirmation);
const actionConfirmationTest = read(files.actionConfirmationTest);
const galleryMedia = read(files.galleryMedia);

assertIncludes("package.json", packageJson, '"check:instagram-gallery-publishing"');
assertIncludes("package.json", packageJson, '"test:instagram-publishing"');
assertIncludes("package.json", packageJson, '"test:instagram-action-confirmation"');
assertIncludes("package.json", packageJson, '"test:instagram-gallery-db"');
assertIncludes("check-all", checkAll, "check:instagram-gallery-publishing");
assertIncludes("check-all", checkAll, "test:instagram-publishing");
assertIncludes("check-all", checkAll, "test:instagram-action-confirmation");

[
  "[functions.list-instagram-publish-queue]",
  "[functions.publish-instagram-gallery-submission]",
  "[functions.resolve-instagram-publish-reconciliation]",
  "[functions.mark-instagram-gallery-submission-shared]",
  "[functions.check-instagram-api-status]",
  'verify_jwt = true',
  'entrypoint = "./functions/list-instagram-publish-queue/index.ts"',
  'entrypoint = "./functions/publish-instagram-gallery-submission/index.ts"',
  'entrypoint = "./functions/resolve-instagram-publish-reconciliation/index.ts"',
  'entrypoint = "./functions/mark-instagram-gallery-submission-shared/index.ts"',
  'entrypoint = "./functions/check-instagram-api-status/index.ts"',
].forEach((snippet) => assertIncludes("supabase config", config, snippet));

[
  "Restores the original Supabase migration version",
  "20260607125027_add_instagram_gallery_publishing.sql",
  "select 1;",
].forEach((snippet) => assertIncludes("migration history restore", migrationHistory, snippet));

[
  "Restores the original Supabase migration version",
  "20260608173000_add_manual_instagram_share_status.sql",
  "select 1;",
].forEach((snippet) => assertIncludes("manual migration history restore", manualMigrationHistory, snippet));

[
  "add column if not exists instagram_opt_in boolean not null default false",
  "add column if not exists instagram_opt_in_at timestamptz",
  "add column if not exists instagram_opt_in_source text",
  "add column if not exists instagram_opt_in_copy_version text",
  "gallery_submissions_instagram_opt_in_source_check",
  "gallery_submissions_instagram_opt_in_consistency",
  "create table if not exists public.gallery_instagram_publish_jobs",
  "create table if not exists public.gallery_instagram_publish_events",
  "status in ('queued', 'ineligible', 'publishing', 'published', 'failed', 'canceled')",
  "action in ('queued', 'ineligible', 'publishing', 'published', 'failed', 'retry', 'canceled')",
  "grant all on table public.gallery_instagram_publish_jobs to service_role",
  "grant all on table public.gallery_instagram_publish_events to service_role",
].forEach((snippet) => assertIncludes("migration", migration, snippet));

const manualMigration = read("supabase/migrations/20260608173000_add_manual_instagram_share_status.sql");
[
  "shared_manually",
  "drop constraint if exists gallery_instagram_publish_jobs_status_check",
  "drop constraint if exists gallery_instagram_publish_events_action_check",
].forEach((snippet) => assertIncludes("manual share migration", manualMigration, snippet));

assertMatches(
  "migration",
  migration,
  /instagram_opt_in\s+(?:=|is)\s+false[\s\S]*instagram_opt_in_at is null[\s\S]*instagram_opt_in\s+(?:=|is)\s+true[\s\S]*instagram_opt_in_at is not null/,
  "consent fields must be internally consistent and non-retroactive.",
);

[
  "instagramOptIn",
  "instagram_opt_in: instagramOptIn",
  ".eq(\"discord_message_id\", messageId)",
  ".eq(\"discord_attachment_id\", attachmentId)",
].forEach((snippet) => assertIncludes("submit-discord-gallery-image", discordIngest, snippet));

assertNotMatches(
  "submit-discord-gallery-image",
  discordIngest,
  /update\(\{[\s\S]*instagram_opt_in/,
  "duplicate Discord submissions must not update stored Instagram consent.",
);

[
  '"gallery_commit_moderation_with_social_derivative"',
  "commit.instagramJob",
  "instagramJob,",
].forEach((snippet) => assertIncludes("moderate-gallery-submission", moderation, snippet));

[
  "insert into public.gallery_instagram_publish_jobs",
  "insert into public.gallery_instagram_publish_events",
  "updated_submission.mime_type = 'image/jpeg'",
  "else 'ineligible'",
  "Mōchirīī guild gallery submission:",
  "'instagramJob'",
].forEach((snippet) => assertIncludes("atomic Instagram moderation outbox", publicationMigration, snippet));

assertNotMatches(
  "moderate-gallery-submission",
  moderation,
  /\.from\(["']gallery_instagram_publish_(?:jobs|events)["']\)\s*\n?\s*\.(?:insert|upsert)\(/,
  "Instagram outbox writes must stay inside the atomic gallery_commit_moderation transaction.",
);

[
  "2026-07-website-public-instagram-publish-v2",
  "gallery_instagram_begin_publish",
  "gallery_instagram_quarantine_stale_publish_jobs",
  "gallery_instagram_publish_source",
  "gallery_instagram_finish_publish",
  "gallery_instagram_resolve_reconciliation",
  "reconcile_required",
  "current_consent_required",
  "A pretty gameplay showcase from Mōchirīī.",
  "instagram_opt_in_contract_version",
].forEach((snippet) => assertIncludes("Instagram hardening migration", hardeningMigration, snippet));

[
  "2026-07-website-public-instagram-publish-v2",
  "gallery-instagram-opt-in-unverified-v1",
  "instagram_opt_in_contract_version",
  "claimed_contract_version",
  "older cached upload clients",
  "enforce_gallery_instagram_active_job_consent",
  "exact_contract_handshake_required",
  "publish_attempt_predates_exact_contract_guard",
].forEach((snippet) => assertIncludes("Instagram consent handshake migration", consentHandshakeMigration, snippet));

[
  "copy_gallery_social_derivative_to_instagram_job",
  "gallery_commit_moderation_with_social_derivative",
  "gallery_instagram_begin_publish",
  "gallery_instagram_publish_source",
  "instagram_opt_in_contract_version",
].forEach((snippet) => assertIncludes("social derivative Instagram contract boundaries", socialDerivativeMigration, snippet));

[
  "gallery_instagram_begin_publish",
  "instagram_opt_in_contract_version",
].forEach((snippet) => assertIncludes("final Instagram claim consent migration", claimConsentMigration, snippet));

[
  "gallery_commit_moderation_with_social_derivative",
  "instagram_opt_in_contract_version",
].forEach((snippet) => assertIncludes("source-bound Instagram moderation migration", sourceBindingMigration, snippet));

[
  "gallery_instagram_reconciliation_context",
  "gallery_instagram_reconciliation_context_allows",
  "status not in ('queued', 'publishing')",
  "guard_exception_used",
  "gallery_instagram_mark_shared_manually",
  "gallery_instagram_job_has_current_derivative",
  "storage.objects as social_object",
  "storage.objects as source_object",
  "current_social_derivative_binding_missing",
  "gallery_instagram_publish_events",
  "remove every database mutation RPC",
  "drop function if exists public.gallery_instagram_mark_shared_manually",
  "revoke all on table public.gallery_instagram_publish_jobs from service_role",
  "grant select on table public.gallery_instagram_publish_events to service_role",
].forEach((snippet) => assertIncludes("audited Instagram reconciliation migration", reconciliationMigration, snippet));

assertNotMatches(
  "audited Instagram reconciliation migration",
  reconciliationMigration,
  /create\s+(?:or\s+replace\s+)?function\s+public\.gallery_instagram_mark_shared_manually/i,
  "the final migration must not recreate a manual-share mutation RPC.",
);

[
  "requireModeratorAccess(req)",
  "gallery_instagram_publish_jobs",
  "gallery_instagram_publish_events",
  "gallery_instagram_quarantine_stale_publish_jobs",
  "nextCursor",
  "updated_at.lt.",
  "thumbnailUrl",
  "reconcile_required",
  "instagramOptIn",
  "instagram_opt_in_contract_version",
].forEach((snippet) => assertIncludes("list-instagram-publish-queue", listQueue, snippet));

assertNotMatches(
  "list-instagram-publish-queue",
  listQueue,
  /createSignedUrl|signedPreviewUrl|storageBucket|storagePath|\.storage_path|\.storage_bucket/,
  "the browser queue must not expose original or derivative storage references.",
);

[
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_EXPECTED_ACCOUNT_ID",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_API_VERSION",
  "INSTAGRAM_PUBLISH_ENABLED",
  "META_APP_ID",
  "META_APP_SECRET",
  "4210347289109364",
  "https://graph.facebook.com",
  'const INSTAGRAM_EXPECTED_USERNAME = "mochirii_guild"',
  "instagramPublishFlagEnabled",
  "instagramIdentityMatches",
  "instagramAppSecretProof",
  "appsecret_proof",
  "gallery-social-jpeg-v1",
  "jfif-only-no-app-metadata-v1",
  "instagramFeedImageIsCompatible",
  "gallery_instagram_publish_source",
  "source.bucket_id",
  "source.object_name",
  "source.sha256",
  "createSignedUrl",
  "/media_publish",
  "reconcile_required",
  'redirect: "error"',
  "instagramGraphFailure",
  "provider_error_subcode",
].forEach((snippet) => assertIncludes("Instagram publishing boundary", sharedPublishing, snippet));

assertNotMatches(
  "Instagram publishing boundary",
  sharedPublishing,
  /graphErrorMessage|graphError\.message|body\.message/,
  "raw provider messages must never be stored, returned, or passed to the audit RPC.",
);

[
  "requireModeratorAccess(req)",
  "publishInstagramJob",
  "confirm_instagram_publish",
].forEach((snippet) => assertIncludes("publish-instagram-gallery-submission", publish, snippet));

const publishFlagIndex = sharedPublishing.indexOf("if (!config.publishEnabled)");
const identityCheckIndex = sharedPublishing.indexOf("instagramIdentityMatches(identityBody");
const jobReadIndex = sharedPublishing.indexOf('"gallery_instagram_begin_publish"');
if (
  publishFlagIndex < 0 ||
  identityCheckIndex < 0 ||
  jobReadIndex < 0 ||
  publishFlagIndex > identityCheckIndex ||
  identityCheckIndex > jobReadIndex
) {
  failures.push(
    "Instagram shared publisher: activation and canonical account identity checks must run before reading or mutating a queue job.",
  );
}

[
  "requireModeratorAccess(req)",
  "confirm_reconciliation",
  "confirmed_published",
  "confirmed_not_published",
  "gallery_instagram_resolve_reconciliation",
  "instagram_media_id",
  "instagram_permalink",
].forEach((snippet) => assertIncludes("resolve-instagram-publish-reconciliation", resolve, snippet));

[
  "requireModeratorAccess(req)",
  "instagramConfig",
  "instagramIdentityMatches",
  "publishEnabled",
  "accountReachable",
  "@mochirii_guild",
  "Meta API publishing is not configured",
].forEach((snippet) => assertIncludes("check-instagram-api-status", checkMeta, snippet));

assertNotMatches(
  "check-instagram-api-status",
  checkMeta,
  /\/media\b|\/media_publish\b|createSignedUrl|gallery_instagram_publish_jobs|gallery_instagram_publish_events/,
  "Meta API diagnostic must not publish, create media containers, or mutate Instagram jobs.",
);

assertNotMatches(
  "check-instagram-api-status",
  checkMeta,
  /expectedAccountId|INSTAGRAM_EXPECTED_ACCOUNT_ID/,
  "Meta API diagnostic must not expose or name the private expected account-id secret.",
);

assertNotMatches(
  "Instagram Graph boundary",
  `${sharedPublishing}\n${checkMeta}\n${publish}`,
  /graph\.instagram\.com|INSTAGRAM_API_BASE_URL/,
  "Page-linked Facebook Login must stay on the fixed graph.facebook.com origin without a runtime host override.",
);

[
  "Instagram Graph account activation requires an exact expected-id secret",
  "a missing expected-id secret was treated as pinned",
  "an invalid expected-id secret was treated as pinned",
  "a mismatched expected-id secret was treated as pinned",
  "a valid Instagram job UUID was rejected",
  "a malformed Instagram job UUID was accepted",
  "old Instagram username matched",
  "non-Business account type matched",
  "Business Settings asset id substituted for the Graph account id",
  "missing flag was enabled",
  "redirects were not rejected",
  "app secret proof",
  "server outcomes require reconciliation",
  "feed derivative compatibility",
  "reflected Meta errors never expose signed media evidence",
  "fake-secret-token",
  "safe provider error identifiers were not retained",
].forEach((snippet) => assertIncludes("Instagram publishing unit tests", sharedPublishingTest, snippet));

[
  'Deno.env.get("INSTAGRAM_EXPECTED_ACCOUNT_ID")',
  '["INSTAGRAM_EXPECTED_ACCOUNT_ID", expectedAccountId]',
  "instagramAccountIdMatchesCanonicalPin",
  "instagram_graph_account_id_not_pinned",
  "independently stored expected account id",
].forEach((snippet) => assertIncludes("Instagram Graph account pin", sharedPublishing, snippet));

assertNotMatches(
  "Instagram Graph account pin",
  sharedPublishing,
  /INSTAGRAM_EXPECTED_GRAPH_ACCOUNT_ID|const\s+INSTAGRAM_EXPECTED_ACCOUNT_ID\s*=/,
  "the private expected Instagram Graph account id must come from a runtime secret, not server source.",
);

[
  "accountIdPinned",
  "expected account id secret does not match",
  "withProtectedCors(req, handleRequest(req))",
  'req.method === "OPTIONS"',
  "protectedOptionsResponse(req)",
].forEach((snippet) => assertIncludes("Instagram API status pin", checkMeta, snippet));

[
  "plan(33)",
  "2026-07-website-public-instagram-publish-v2",
  "forged-client-version",
  "an older cached browser remains historical and ineligible",
  "an arbitrary browser contract value cannot forge",
  "without the exact contract and derivative cannot enter the active Instagram queue",
  "a null contract cannot acquire a publish lease",
  "a null contract cannot resolve publishable media",
  "the final published-state transition rejects",
  "gallery_instagram_quarantine_stale_publish_jobs",
  "gallery_instagram_resolve_reconciliation",
  "external_evidence_required",
  "a direct update cannot use the legacy reconciliation exception",
  "confirmed publication rejects a non-canonical Instagram post permalink",
  "an audited confirmed-published reconciliation closes a quarantined legacy attempt",
  "an audited confirmed-not-published reconciliation closes a pre-derivative attempt",
  "manual-share completion RPCs are absent",
  "a queued job without an exact derivative is not publishable",
  "direct SQL cannot bypass the Storage object deletion guard",
  "a deleted frozen derivative object invalidates the Graph publish binding",
  "an overwritten frozen derivative object invalidates the Graph publish binding",
  "the restored exact frozen derivative remains eligible for reviewed Graph publishing",
  "cannot mutate them directly",
].forEach((snippet) => assertIncludes("Instagram database tests", databaseTest, snippet));

[
  "requireModeratorAccess(req)",
  "instagram_manual_share_disabled",
  "compatibility stub",
  "reconciliation remains available only for ambiguous API attempts",
  "409",
].forEach((snippet) => assertIncludes("mark-instagram-gallery-submission-shared", markShared, snippet));

assertNotMatches(
  "mark-instagram-gallery-submission-shared",
  markShared,
  /\.rpc\(|gallery_instagram_mark_shared_manually|readRequiredJsonBody|createSignedUrl|\.storage\b|\.(?:insert|update|delete)\(/,
  "the compatibility stub must not parse manual evidence, expose media, or reach any mutation path.",
);

assertNotMatches(
  "mark-instagram-gallery-submission-shared",
  markShared,
  /INSTAGRAM_ACCOUNT_ID|INSTAGRAM_ACCESS_TOKEN|INSTAGRAM_API_VERSION|fetch\(/,
  "manual sharing function must not call Meta or require Instagram credentials.",
);

assertNotMatches(
  "publish-instagram-gallery-submission",
  publish,
  /console\.(log|error|warn)\([^)]*(accessToken|signedUrl|INSTAGRAM_ACCESS_TOKEN)/,
  "publishing function must not log Instagram tokens or signed URLs.",
);

[
  "DISCORD_GALLERY_CHANNEL_ID=1508077313965817856",
  "DISCORD_GALLERY_INGEST_SECRET=",
  "INSTAGRAM_ACCOUNT_ID=",
  "INSTAGRAM_EXPECTED_ACCOUNT_ID=",
  "INSTAGRAM_ACCESS_TOKEN=",
  "INSTAGRAM_API_VERSION=v25.0",
  "INSTAGRAM_PUBLISH_ENABLED=false",
  "META_APP_ID=",
  "META_APP_SECRET=",
].forEach((snippet) => assertIncludes("supabase functions .env.example", envExample, snippet));

[
  "share_to_instagram",
  "instagramOptIn",
  "list-instagram-publish-queue",
  "publish-instagram-gallery-submission",
  "mark-instagram-gallery-submission-shared",
  "Instagram credentials live only in Supabase secrets",
  "INSTAGRAM_PUBLISH_ENABLED=true",
  "https://graph.facebook.com",
  "no automatic Instagram publishing",
  "Manual completion is disabled",
].forEach((snippet) => assertIncludes("supabase README", supabaseReadme, snippet));

[
  "Instagram Queue",
  "final confirmation",
  "queue review only",
  "compatibility endpoint returns `409`",
  "supabase secrets set",
].forEach((snippet) => assertIncludes("moderation runbook", moderationRunbook, snippet));

[
  "Tracking PR: <https://github.com/Mochirii-Wushu/Mochirii-Website/pull/198>",
  "/submit image:<file> [title:<title>] [subtitle:<subtitle>] [share_to_instagram:<true|false>]",
  "2026-06-discord-submit-v1",
  "API-ineligible",
  "No real Instagram post may be created without explicit action-time owner approval.",
  "DISCORD_GALLERY_CHANNEL_ID",
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_EXPECTED_ACCOUNT_ID",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_PUBLISH_ENABLED",
  "@mochirii_guild",
  "2026-08-28",
  "human reCAPTCHA",
  "instagram_business_account.id",
  "supabase functions deploy list-instagram-publish-queue",
  "supabase functions deploy publish-instagram-gallery-submission",
  "supabase functions deploy mark-instagram-gallery-submission-shared",
  "\"instagramOptIn\": true",
  "shared_manually",
  "wrong channel fail-closed",
  "duplicate Discord message/attachment does not change stored consent",
  "Rollback options",
].forEach((snippet) => assertIncludes("Instagram deployment runbook", deploymentRunbook, snippet));

[
  "@mochirii_guild",
  "https://www.facebook.com/mochiriiguildpage",
  "4210347289109364",
  "instagram_business_account.id",
  "INSTAGRAM_EXPECTED_ACCOUNT_ID",
  "INSTAGRAM_PUBLISH_ENABLED",
  "2026-08-28",
  "human reCAPTCHA",
  "https://graph.facebook.com",
  "Do not place or link `mochirii.com` in the Instagram profile",
  "support@mochirii.com",
].forEach((snippet) => assertIncludes("Instagram integration contract", integrationContract, snippet));

assertNotMatches(
  "Instagram integration contract",
  integrationContract,
  /17841443491948862|1262341610290624/,
  "non-executable provider inventory identifiers must stay out of the public integration contract.",
);

[
  "instagramOptIn",
  "I authorize Mōchirīī moderators to publish this image and its moderator-approved caption on the public official Mōchirīī Instagram account after gallery approval.",
  "form-check",
].forEach((snippet) => assertIncludes("Next upload form", nextSubmit, snippet));

[
  "Instagram Queue",
  "publishInstagramGallerySubmission",
  "Manual Instagram sharing is disabled",
  "Confirm Meta publish",
  "resolveInstagramPublishReconciliation",
  "Record as published",
  "Previous Instagram jobs",
  "Meta API Status",
  "checkInstagramApiStatus",
  "setInstagramJobMessages",
  "Instagram caption",
  "Instagram alt text",
].forEach((snippet) => assertIncludes("Next leader dashboard", nextDashboard, snippet));

[
  "fingerprintInstagramAction",
  "jobId.trim()",
  "input.status.trim().toLowerCase()",
  'input.action === "publish"',
  "input.caption",
  "input.altText",
  "input.mediaId",
  "input.permalink",
  "input.note",
  "normalizeInstagramPostPermalink",
  '!["p", "reel"].includes',
].forEach((snippet) => assertIncludes("Instagram action fingerprint", actionConfirmation, snippet));

[
  "exact normalized copy and job state",
  "reconciliation evidence accepts and normalizes only canonical Instagram posts or reels",
  "accepts and normalizes only canonical Instagram posts or reels",
  "reconciliation confirmation fingerprints resolution and every evidence field",
  "assert.notEqual",
].forEach((snippet) => assertIncludes("Instagram action fingerprint tests", actionConfirmationTest, snippet));

[
  "instagramActionFingerprint(job, action)",
  "disarmInstagramAction(id)",
  "storedConfirmation && storedConfirmation.fingerprint",
].forEach((snippet) => assertIncludes("Next leader dashboard confirmation binding", nextDashboard, snippet));

assertNotMatches(
  "Next leader dashboard",
  nextDashboard,
  /markInstagramGallerySubmissionShared|Mark shared manually|Confirm manual share|onArmManualShare|onConfirmManualShare|"manual-share"/,
  "the Leader Dashboard must not expose a manual-share completion path.",
);

[
  "listInstagramPublishQueue",
  "checkInstagramApiStatus",
  "publishInstagramGallerySubmission",
  "list-instagram-publish-queue",
  "check-instagram-api-status",
  "publish-instagram-gallery-submission",
].forEach((snippet) => assertIncludes("Next moderation helpers", nextHelpers, snippet));

assertNotMatches(
  "Next moderation helpers",
  nextHelpers,
  /markInstagramGallerySubmissionShared|mark-instagram-gallery-submission-shared/,
  "browser helpers must not invoke the disabled manual-share compatibility route.",
);

assertNotMatches(
  "Gallery browser media",
  galleryMedia,
  /GallerySocialPayload|gallerySocial|encodeBoundedSocialJpeg|includeSocial|stripJpegMetadata|\bsocial\s*:/,
  "browser code must prepare only Gallery display and thumbnail media; social derivatives are server-only.",
);

[
  "instagram_opt_in: metadata.instagramOptIn === true",
  "instagram_opt_in_contract_version: metadata.instagramOptIn === true",
  "INSTAGRAM_WEBSITE_CONSENT_CONTRACT_VERSION",
].forEach((snippet) => assertIncludes("Next upload helper", nextUploads, snippet));

assertNotMatches(
  "Next upload helper",
  nextUploads,
  /instagram_opt_in_(?:at|source|copy_version)\s*:/,
  "browser clients must not author Instagram consent provenance fields.",
);

const browserFiles = walkFiles("apps/web").filter((file) => /\.(?:css|js|jsx|ts|tsx|html)$/i.test(file));

for (const file of browserFiles) {
  const source = readFileSync(path.join(root, file), "utf8");
  assertNotMatches(
    file,
    source,
    /INSTAGRAM_ACCESS_TOKEN|INSTAGRAM_(?:EXPECTED_)?ACCOUNT_ID|INSTAGRAM_API_VERSION|INSTAGRAM_PUBLISH_ENABLED|META_APP_SECRET/,
    "Instagram server credentials must not appear in browser/Vercel code.",
  );
}

if (failures.length) {
  console.error("Instagram gallery publishing validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Instagram gallery publishing validation OK.");
