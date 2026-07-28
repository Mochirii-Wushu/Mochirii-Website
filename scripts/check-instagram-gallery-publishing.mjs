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
  manualMigrationHistory: "supabase/migrations/20260608093407_restore_manual_instagram_share_history.sql",
  discordIngest: "supabase/functions/submit-discord-gallery-image/index.ts",
  moderation: "supabase/functions/moderate-gallery-submission/index.ts",
  listQueue: "supabase/functions/list-instagram-publish-queue/index.ts",
  checkMeta: "supabase/functions/check-instagram-api-status/index.ts",
  publish: "supabase/functions/publish-instagram-gallery-submission/index.ts",
  markShared: "supabase/functions/mark-instagram-gallery-submission-shared/index.ts",
  envExample: "supabase/functions/.env.example",
  supabaseReadme: "supabase/README.md",
  moderationRunbook: "docs/member-gallery-moderation-runbook.md",
  deploymentRunbook: "docs/instagram-gallery-publishing-deployment-runbook.md",
  nextSubmit: "apps/web/components/member-workflow/GallerySubmitForm.tsx",
  nextDashboard: "apps/web/components/member-workflow/LeaderDashboard.tsx",
  nextDashboardParts: "apps/web/components/member-workflow/LeaderDashboardParts.tsx",
  nextHelpers: "apps/web/lib/supabase/moderation.ts",
  nextUploads: "apps/web/lib/supabase/gallery-submissions.ts",
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
const manualMigrationHistory = read(files.manualMigrationHistory);
const discordIngest = read(files.discordIngest);
const moderation = read(files.moderation);
const listQueue = read(files.listQueue);
const checkMeta = read(files.checkMeta);
const publish = read(files.publish);
const markShared = read(files.markShared);
const envExample = read(files.envExample);
const supabaseReadme = read(files.supabaseReadme);
const moderationRunbook = read(files.moderationRunbook);
const deploymentRunbook = read(files.deploymentRunbook);
const nextSubmit = read(files.nextSubmit);
const nextDashboard = [read(files.nextDashboard), read(files.nextDashboardParts)].join("\n");
const nextHelpers = read(files.nextHelpers);
const nextUploads = read(files.nextUploads);

assertIncludes("package.json", packageJson, '"check:instagram-gallery-publishing"');
assertIncludes("check-all", checkAll, "check:instagram-gallery-publishing");

[
  "[functions.list-instagram-publish-queue]",
  "[functions.publish-instagram-gallery-submission]",
  "[functions.mark-instagram-gallery-submission-shared]",
  "[functions.check-instagram-api-status]",
  'verify_jwt = true',
  'entrypoint = "./functions/list-instagram-publish-queue/index.ts"',
  'entrypoint = "./functions/publish-instagram-gallery-submission/index.ts"',
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
  "INSTAGRAM_OPT_IN_COPY_VERSION",
  'instagram_opt_in_source: instagramOptIn ? "discord_slash_command" : null',
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
  '"gallery_commit_moderation"',
  "const instagramJob = commit.instagramJob",
  "instagramJob,",
].forEach((snippet) => assertIncludes("moderate-gallery-submission", moderation, snippet));

[
  "insert into public.gallery_instagram_publish_jobs",
  "insert into public.gallery_instagram_publish_events",
  "updated_submission.mime_type = 'image/jpeg'",
  "else 'ineligible'",
  "Shared from the Mōchirīī guild gallery.",
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
  "requireModeratorAccess(req)",
  "gallery_instagram_publish_jobs",
  "gallery_instagram_publish_events",
  "createSignedUrl",
  "signedPreviewUrl",
  "instagramOptIn",
].forEach((snippet) => assertIncludes("list-instagram-publish-queue", listQueue, snippet));

[
  "requireModeratorAccess(req)",
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_API_VERSION",
  "INSTAGRAM_API_BASE_URL",
  "confirmPublish",
  "createSignedUrl",
  "/media",
  "/media_publish",
  "access_token: instagram.accessToken",
  "signedData.signedUrl",
  "status: \"published\"",
].forEach((snippet) => assertIncludes("publish-instagram-gallery-submission", publish, snippet));

[
  "requireModeratorAccess(req)",
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_API_VERSION",
  "publishEnabled",
  "accountReachable",
  "Meta API publishing is not configured",
].forEach((snippet) => assertIncludes("check-instagram-api-status", checkMeta, snippet));

assertNotMatches(
  "check-instagram-api-status",
  checkMeta,
  /\/media\b|\/media_publish\b|createSignedUrl|gallery_instagram_publish_jobs|gallery_instagram_publish_events/,
  "Meta API diagnostic must not publish, create media containers, or mutate Instagram jobs.",
);

[
  "requireModeratorAccess(req)",
  "confirmManualShare",
  "shared_manually",
  "gallery_instagram_publish_jobs",
  "gallery_instagram_publish_events",
  "Only queued Instagram jobs can be marked shared manually.",
].forEach((snippet) => assertIncludes("mark-instagram-gallery-submission-shared", markShared, snippet));

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
  "INSTAGRAM_ACCESS_TOKEN=",
  "INSTAGRAM_API_VERSION=",
].forEach((snippet) => assertIncludes("supabase functions .env.example", envExample, snippet));

[
  "share_to_instagram",
  "instagramOptIn",
  "list-instagram-publish-queue",
  "publish-instagram-gallery-submission",
  "mark-instagram-gallery-submission-shared",
  "Instagram credentials live only in Supabase secrets",
  "no automatic Instagram publishing",
  "manual sharing",
].forEach((snippet) => assertIncludes("supabase README", supabaseReadme, snippet));

[
  "Instagram Queue",
  "final confirmation",
  "Mark shared manually",
  "signed preview URLs",
  "supabase secrets set",
].forEach((snippet) => assertIncludes("moderation runbook", moderationRunbook, snippet));

[
  "Tracking PR: <https://github.com/Mochirii-Wushu/Mochirii-Website/pull/198>",
  "/submit image:<file> [title:<title>] [subtitle:<subtitle>] [share_to_instagram:<true|false>]",
  "No real Instagram post may be created without explicit action-time owner approval.",
  "DISCORD_GALLERY_CHANNEL_ID",
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_ACCESS_TOKEN",
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
  "instagramOptIn",
  "Allow Mōchirīī to share this image on our official Instagram if approved.",
  "form-check",
].forEach((snippet) => assertIncludes("Next upload form", nextSubmit, snippet));

[
  "Instagram Queue",
  "publishInstagramGallerySubmission",
  "markInstagramGallerySubmissionShared",
  "Mark shared manually",
  "Confirm manual share",
  "Confirm Meta publish",
  "Meta API Status",
  "checkInstagramApiStatus",
  "setInstagramJobMessages",
  "Instagram caption",
  "Instagram alt text",
].forEach((snippet) => assertIncludes("Next leader dashboard", nextDashboard, snippet));

assertNotMatches(
  "Next leader dashboard",
  nextDashboard,
  /window\.confirm\("Mark this Instagram queue item|window\.confirm\("Publish this approved member image/,
  "Instagram manual share and Meta publish actions must use visible in-card confirmation, not browser confirm prompts.",
);

[
  "listInstagramPublishQueue",
  "checkInstagramApiStatus",
  "publishInstagramGallerySubmission",
  "markInstagramGallerySubmissionShared",
  "list-instagram-publish-queue",
  "check-instagram-api-status",
  "publish-instagram-gallery-submission",
  "mark-instagram-gallery-submission-shared",
].forEach((snippet) => assertIncludes("Next moderation helpers", nextHelpers, snippet));

[
  "INSTAGRAM_WEBSITE_OPT_IN_COPY_VERSION",
  "instagram_opt_in_source",
  "instagram_opt_in_copy_version",
].forEach((snippet) => assertIncludes("Next upload helper", nextUploads, snippet));

const browserFiles = walkFiles("apps/web").filter((file) => /\.(?:css|js|jsx|ts|tsx|html)$/i.test(file));

for (const file of browserFiles) {
  const source = readFileSync(path.join(root, file), "utf8");
  assertNotMatches(
    file,
    source,
    /INSTAGRAM_ACCESS_TOKEN|INSTAGRAM_ACCOUNT_ID|INSTAGRAM_API_BASE_URL|INSTAGRAM_API_VERSION/,
    "Instagram server credentials must not appear in browser/Vercel code.",
  );
}

if (failures.length) {
  console.error("Instagram gallery publishing validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Instagram gallery publishing validation OK.");
