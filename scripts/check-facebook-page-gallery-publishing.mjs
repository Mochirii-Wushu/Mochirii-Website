import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const files = {
  migration: "supabase/migrations/20260729042835_add_facebook_page_gallery_publishing.sql",
  consentMigration: "supabase/migrations/20260729071146_enforce_facebook_consent_contract_and_permalink_integrity.sql",
  randomPathMigration: "supabase/migrations/20260729072000_randomize_social_derivative_paths_and_reduce_facebook_privileges.sql",
  config: "supabase/config.toml",
  env: "supabase/functions/.env.example",
  helper: "supabase/functions/_shared/facebook-page-publishing.ts",
  helperTest: "supabase/functions/_shared/facebook-page-publishing_test.ts",
  pagination: "supabase/functions/_shared/facebook-page-queue-pagination.ts",
  paginationTest: "supabase/functions/_shared/facebook-page-queue-pagination_test.ts",
  moderation: "supabase/functions/moderate-gallery-submission/index.ts",
  reviewQueue: "supabase/functions/list-gallery-review-queue/index.ts",
  listQueue: "supabase/functions/list-facebook-page-publish-queue/index.ts",
  status: "supabase/functions/check-facebook-page-api-status/index.ts",
  publish: "supabase/functions/publish-facebook-page-gallery-submission/index.ts",
  resolve: "supabase/functions/resolve-facebook-page-publish-reconciliation/index.ts",
  webTypes: "apps/web/lib/supabase/types.ts",
  webModeration: "apps/web/lib/supabase/moderation.ts",
  webQueue: "apps/web/components/member-workflow/FacebookPagePublishQueue.tsx",
  webActionConfirmation: "apps/web/lib/gallery/facebook-action-confirmation.ts",
  webActionConfirmationTest: "apps/web/lib/gallery/facebook-action-confirmation_test.ts",
  webPermalink: "apps/web/lib/gallery/facebook-permalink.ts",
  webPermalinkTest: "apps/web/lib/gallery/facebook-permalink_test.ts",
  socialPath: "supabase/functions/_shared/gallery-social-path.ts",
  gallerySubmit: "apps/web/components/member-workflow/GallerySubmitForm.tsx",
  leaderDashboard: "apps/web/components/member-workflow/LeaderDashboard.tsx",
  leaderParts: "apps/web/components/member-workflow/LeaderDashboardParts.tsx",
  galleryMedia: "apps/web/lib/gallery-thumbnail.ts",
};

function read(file) {
  const full = path.join(root, file);
  if (!existsSync(full)) {
    failures.push(`${file}: missing Facebook Page publishing file.`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function includes(label, text, snippet) {
  if (!text.includes(snippet)) {
    failures.push(`${label}: expected snippet not found: ${snippet}`);
  }
}

function matches(label, text, pattern, message) {
  if (!pattern.test(text)) failures.push(`${label}: ${message}`);
}

function notMatches(label, text, pattern, message) {
  if (pattern.test(text)) failures.push(`${label}: ${message}`);
}

function walk(dir, results = []) {
  const absolute = path.join(root, dir);
  if (!existsSync(absolute)) return results;
  for (const entry of readdirSync(absolute)) {
    const child = path.join(absolute, entry);
    const stat = statSync(child);
    if (stat.isDirectory()) {
      if ([".next", "node_modules"].includes(entry)) continue;
      walk(path.relative(root, child), results);
    } else {
      results.push(path.relative(root, child).replaceAll("\\", "/"));
    }
  }
  return results;
}

const migration = read(files.migration);
const consentMigration = read(files.consentMigration);
const randomPathMigration = read(files.randomPathMigration);
const config = read(files.config);
const env = read(files.env);
const helper = read(files.helper);
const helperTest = read(files.helperTest);
const pagination = read(files.pagination);
const paginationTest = read(files.paginationTest);
const moderation = read(files.moderation);
const reviewQueue = read(files.reviewQueue);
const listQueue = read(files.listQueue);
const status = read(files.status);
const publish = read(files.publish);
const resolve = read(files.resolve);
const webTypes = read(files.webTypes);
const webModeration = read(files.webModeration);
const webQueue = read(files.webQueue);
const webActionConfirmation = read(files.webActionConfirmation);
const webActionConfirmationTest = read(files.webActionConfirmationTest);
const webPermalink = read(files.webPermalink);
const webPermalinkTest = read(files.webPermalinkTest);
const socialPath = read(files.socialPath);
const gallerySubmit = read(files.gallerySubmit);
const leaderDashboard = read(files.leaderDashboard);
const leaderParts = read(files.leaderParts);
const galleryMedia = read(files.galleryMedia);

[
  "facebook_page_opt_in boolean not null default false",
  "facebook_page_opt_in_at timestamptz",
  "facebook_page_opt_in_source text",
  "facebook_page_opt_in_copy_version text",
  "gallery_submissions_facebook_page_opt_in_source_check",
  "gallery_submissions_facebook_page_opt_in_consistency_check",
  "private.attest_gallery_facebook_page_consent",
  "private.reject_gallery_facebook_page_consent_update",
  "before insert",
  "Facebook Page consent is immutable after submission.",
  "grant insert (facebook_page_opt_in)",
  "revoke insert (",
  "create table public.gallery_facebook_page_publish_jobs",
  "create table public.gallery_facebook_page_publish_events",
  "constraint gallery_facebook_page_publish_jobs_submission_key unique (submission_id)",
  "source_sha256 text not null",
  "reconcile_required",
  "alter table public.gallery_facebook_page_publish_jobs enable row level security",
  "alter table public.gallery_facebook_page_publish_events enable row level security",
  "revoke all on table public.gallery_facebook_page_publish_jobs from public, anon, authenticated",
  "revoke all on table public.gallery_facebook_page_publish_events from public, anon, authenticated",
  "create policy service_only_default_deny on public.gallery_facebook_page_publish_jobs",
  "create policy service_only_default_deny on public.gallery_facebook_page_publish_events",
  "gallery_facebook_page_publish_source",
  "gallery_facebook_page_begin_publish",
  "gallery_facebook_page_quarantine_stale_publish_jobs",
  "gallery_facebook_page_finish_publish",
  "gallery_facebook_page_resolve_reconciliation",
  "reconciliation_resolved_published",
  "reconciliation_resolved_not_published",
  "gallery_commit_moderation_without_facebook_page",
  "insert into public.gallery_facebook_page_publish_jobs",
  "insert into public.gallery_facebook_page_publish_events",
  "'facebookPageJob'",
].forEach((snippet) => includes("migration", migration, snippet));

notMatches(
  "migration",
  migration,
  /grant\s+insert\s*\([^)]*(?:facebook_page_opt_in_at|facebook_page_opt_in_source|facebook_page_opt_in_copy_version)[^)]*\)\s+on\s+table\s+public\.gallery_submissions\s+to\s+authenticated/i,
  "browser clients must not supply Facebook consent provenance.",
);

matches(
  "migration",
  migration,
  /create\s+trigger\s+attest_gallery_facebook_page_consent\s+before\s+insert\s+on\s+public\.gallery_submissions/i,
  "Facebook consent provenance must be attested only at insert time.",
);
matches(
  "migration",
  migration,
  /create\s+trigger\s+reject_gallery_facebook_page_consent_update\s+before\s+update\s+of[\s\S]*facebook_page_opt_in[\s\S]*facebook_page_opt_in_at[\s\S]*facebook_page_opt_in_source[\s\S]*facebook_page_opt_in_copy_version[\s\S]*on\s+public\.gallery_submissions/i,
  "all Facebook consent fields must be immutable after insertion.",
);

matches(
  "migration",
  migration,
  /facebook_page_opt_in is false[\s\S]*facebook_page_opt_in_at is null[\s\S]*facebook_page_opt_in is true[\s\S]*facebook_page_opt_in_at is not null/,
  "Facebook consent must remain explicit and internally consistent.",
);

[
  "facebook_page_opt_in_contract_version text",
  "claimed_contract_version",
  "gallery-facebook-page-opt-in-unverified-v1",
  "gallery_submissions_facebook_page_contract_version_check",
  "facebook_page_opt_in_contract_version is distinct from",
  "private.enforce_gallery_facebook_active_job_consent",
  "private.copy_gallery_social_derivative_to_facebook_job",
  "private.normalize_gallery_facebook_permalink",
  "p_page_ownership_verified boolean default false",
  "canonical_page_evidence_required",
  "Publication identifiers are not allowed when no Facebook Page post exists.",
].forEach((snippet) => includes("Facebook consent/permalink cutover", consentMigration, snippet));

[
  "facebook_page_opt_in_contract_version",
  "[0-9a-f]{8}-[0-9a-f]{4}",
  "revoke all\non table public.gallery_facebook_page_publish_jobs",
  "revoke all\non table public.gallery_facebook_page_publish_events",
  "grant select",
].forEach((snippet) => includes("Facebook random-path/privilege cutover", randomPathMigration, snippet));
notMatches(
  "Facebook effective random-path cutover",
  randomPathMigration,
  /_social\/submissions\/'\s*\|\|\s*p_submission_id::text\s*\|\|\s*'\/v1[.]jpg/,
  "the effective moderation RPC must not accept the deterministic v1 path.",
);
matches(
  "Facebook service-role least privilege",
  randomPathMigration,
  /revoke\s+all\s+on\s+table\s+public[.]gallery_facebook_page_publish_jobs\s+from\s+service_role;[\s\S]*revoke\s+all\s+on\s+table\s+public[.]gallery_facebook_page_publish_events\s+from\s+service_role;[\s\S]*grant\s+select/i,
  "service role must retain SELECT only on Facebook job and event tables.",
);

[
  "[functions.list-facebook-page-publish-queue]",
  "[functions.publish-facebook-page-gallery-submission]",
  "[functions.resolve-facebook-page-publish-reconciliation]",
  "[functions.check-facebook-page-api-status]",
  'entrypoint = "./functions/list-facebook-page-publish-queue/index.ts"',
  'entrypoint = "./functions/publish-facebook-page-gallery-submission/index.ts"',
  'entrypoint = "./functions/resolve-facebook-page-publish-reconciliation/index.ts"',
  'entrypoint = "./functions/check-facebook-page-api-status/index.ts"',
].forEach((snippet) => includes("Supabase config", config, snippet));

[
  "META_APP_ID=",
  "META_APP_SECRET=",
  "FACEBOOK_PAGE_ID=",
  "FACEBOOK_PAGE_ACCESS_TOKEN=",
  "FACEBOOK_API_VERSION=v25.0",
  "FACEBOOK_PAGE_PUBLISH_ENABLED=false",
].forEach((snippet) => includes("environment template", env, snippet));

[
  'Deno.env.get("FACEBOOK_PAGE_ID")',
  'Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN")',
  'Deno.env.get("FACEBOOK_API_VERSION")',
  'Deno.env.get("FACEBOOK_PAGE_PUBLISH_ENABLED")',
  'Deno.env.get("META_APP_ID")',
  'Deno.env.get("META_APP_SECRET")',
  'FACEBOOK_CANONICAL_PAGE_ID = "1222888660907862"',
  'FACEBOOK_CANONICAL_PAGE_NAME = "Mōchirīī"',
  'url.searchParams.set("appsecret_proof", proof)',
  "facebookPagePublishFlagEnabled",
  "facebook_page_publish_disabled",
  "facebookPageIdIsValid",
  "facebookApiVersionIsValid",
  'const FACEBOOK_GRAPH_BASE_URL = "https://graph.facebook.com"',
  'redirect: "error"',
  'form.set(\n    "source"',
  'form.set("message", finalMessage)',
  '.download(storagePath)',
  "sha256Hex(bytes)",
  '`${FACEBOOK_CANONICAL_PAGE_ID}/photos`',
  'outcome: "reconcile_required"',
  "normalizeFacebookPermalink",
  "facebookPageObjectEvidence",
  'fields=id,from{id},permalink_url,link',
  "pageOwnershipVerified: true",
  "facebookGraphErrorDetails",
  '"Meta rejected the Facebook Page image."',
].forEach((snippet) => includes("shared publisher", helper, snippet));

notMatches(
  "shared publisher",
  helper,
  /createSignedUrl|access_token\s*[:=]|console\.(?:log|warn|error)\([^)]*(accessToken|FACEBOOK_PAGE_ACCESS_TOKEN)/,
  "publisher must not send a mutable signed URL, put tokens in payloads, or log credentials.",
);
notMatches(
  "shared publisher",
  helper,
  /graphErrorMessage|safeString\(graphError[.]message|safeString\(body[.]message/,
  "raw Graph provider messages must not enter browser or audit surfaces.",
);

[
  "requireModeratorAccess(req)",
  "confirm_reconciliation",
  "confirmed_published",
  "confirmed_not_published",
  "gallery_facebook_page_resolve_reconciliation",
  "facebookPhotoId",
  "facebookPostId",
  "facebookPageObjectEvidence",
  "facebook_page_reconciliation_verification_failed",
  "p_page_ownership_verified: pageOwnershipVerified",
  "contradictory_facebook_page_reconciliation_evidence",
].forEach((snippet) => includes("Facebook reconciliation", resolve, snippet));
notMatches(
  "Facebook reconciliation",
  resolve,
  /\/photos|FormData|publishFacebookPageJob|\bjob\s*:\s*payload\.job\b/,
  "reconciliation must record an inspected outcome without publishing or leaking a raw job.",
);

[
  "FacebookPageReconciliationResolution",
  '"confirmed_published"',
  '"confirmed_not_published"',
  "FacebookPageReconciliationResult",
].forEach((snippet) => includes("Facebook web types", webTypes, snippet));

[
  "resolveFacebookPagePublishReconciliation",
  '"resolve-facebook-page-publish-reconciliation"',
  "confirm_reconciliation: true",
  "facebook_photo_id: cleanPhotoId",
  "facebook_post_id: cleanPostId",
  "normalizeFacebookPermalink",
  "Remove every Facebook photo id, post id, and permalink",
].forEach((snippet) => includes("Facebook web reconciliation client", webModeration, snippet));

[
  "facebookPageReconciliationFingerprint",
  "reconciliationValidation",
  "armReconciliation",
  "resolveReconciliation",
  "Arm reconciliation result",
  "Confirm inspected Page post",
  "Confirm no Page post found",
  "publishing still requires a separate approval",
].forEach((snippet) => includes("Facebook moderator reconciliation UI", webQueue, snippet));

[
  "FACEBOOK_PAGE_QUEUE_MAX_PAGE_SIZE = 50",
  "encodeFacebookPageQueueCursor",
  "decodeFacebookPageQueueCursor",
  "record.s !== expectedStatus",
  'Object.keys(record).sort().join(",") !== "i,s,u,v"',
].forEach((snippet) => includes("Facebook queue pagination", pagination, snippet));
[
  "status bound",
  "rejects malformed input",
  "page size are bounded",
].forEach((snippet) => includes("Facebook queue pagination tests", paginationTest, snippet));
[
  "decodeFacebookPageQueueCursor",
  "pageSize + 1",
  '.order("updated_at", { ascending: false })',
  '.order("id", { ascending: false })',
  "nextCursor",
  "hasMore",
].forEach((snippet) => includes("Facebook queue keyset query", listQueue, snippet));
[
  "FACEBOOK_PAGE_QUEUE_PAGE_SIZE",
  "queueCursorHistory",
  "Previous page",
  "Next page",
  "externalActionRef",
  "acquireExternalAction",
  "Exact moderator-approved Page caption",
  ").trim();",
  "facebookConsentSourceLabel",
  "Website member upload",
  "normalizeFacebookPermalink(job.facebookPermalink)",
  "facebookPagePublishFingerprint(job, message)",
].forEach((snippet) => includes("Facebook moderator queue hardening", webQueue, snippet));

notMatches(
  "Gallery moderator Facebook separation",
  leaderDashboard,
  /publishFacebookPageGallerySubmission|facebookApprovalConfirmations|facebookPageApprovalConfirmed/,
  "Gallery approval must not invoke or arm public Facebook Page publishing.",
);
[
  "Approve for Gallery only",
  "This Gallery action only queues the separate Page review",
  "public official Facebook Page",
  "optional moderator share",
].forEach((snippet) => includes("Gallery-only moderator UI", leaderParts, snippet));

notMatches(
  "Gallery browser media",
  galleryMedia,
  /GallerySocialPayload|gallerySocial|encodeBoundedSocialJpeg|includeSocial|stripJpegMetadata|\bsocial\s*:/,
  "browser code must prepare only Gallery display and thumbnail media; social derivatives are server-only.",
);
notMatches(
  "Gallery moderation client",
  webModeration,
  /\bsocial\s*:/,
  "browser-created social bytes must not cross the server moderation boundary.",
);

notMatches(
  "Facebook browser DTOs",
  `${webTypes}\n${webQueue}\n${listQueue}`,
  /social(?:StoragePath|StorageBucket|StorageObjectVersion|StorageObjectUpdatedAt|Sha256|SanitizerVersion|SignedUrl)|social_(?:storage_path|storage_bucket|storage_object_version|storage_object_updated_at|sha256|sanitizer_version|signed_url)|\bobject_(?:name|version|updated_at)\b|\bsha256\b/i,
  "social derivative paths, object identity/version/timestamps, hashes, sanitizer versions, and signed URLs must remain server-only.",
);

matches(
  "Facebook moderator reconciliation UI",
  webQueue,
  /reconciliationConfirmations\[jobId\]\s*!==\s*facebookPageReconciliationFingerprint\(job,\s*draft\)/,
  "reconciliation confirmation must be bound to the unchanged inspected evidence.",
);

[
  "facebook-page-publish-v1",
  "facebook-page-reconciliation-v1",
  "...jobState(job)",
  "normalizedAttemptCount",
].forEach((snippet) => includes("Facebook action fingerprints", webActionConfirmation, snippet));
[
  "publish confirmation is bound to job state, attempt, and normalized caption",
  "reconciliation confirmation is bound to exact queue state and inspected draft",
].forEach((snippet) => includes("Facebook action fingerprint tests", webActionConfirmationTest, snippet));

[
  "normalizeFacebookPermalink",
  '"facebook.com"',
  '"www.facebook.com"',
  '"m.facebook.com"',
  'segments[1] === "posts"',
  'segments[1] === "photos"',
  'url.searchParams.getAll("fbid")',
  'url.searchParams.getAll("story_fbid")',
].forEach((snippet) => includes("Facebook browser permalink guard", webPermalink, snippet));
[
  "javascript:alert(1)",
  "facebook.com.example.test",
  "user:pass@www.facebook.com",
  "#fragment",
  "profile.php?id=61592841711452",
  "?story_fbid=12345&id=67890",
].forEach((snippet) => includes("Facebook browser permalink tests", webPermalinkTest, snippet));

[
  "facebookPageIdIsValid",
  "facebookApiVersionIsValid",
  "facebookTasksCanPublish",
  "facebookPagePublishFlagEnabled",
  'init.redirect === "error"',
  'facebookGraphOutcome(500) === "reconcile_required"',
  "unsafe permalink was accepted",
  "unrelated Page ownership was accepted",
  "reflected Graph messages cannot enter stored audit details",
  'serialized.includes("appsecret_proof")',
  'serialized.includes("_social/")',
].forEach((snippet) => includes("publisher helper tests", helperTest, snippet));

[
  "confirm_facebook_publish",
  "facebook_page_opt_in",
  "facebook_page_opt_in_contract_version",
  "facebook_page_publish_requires_separate_review",
  "moderation_commit_outcome_unknown",
  "crypto.randomUUID()",
].forEach((snippet) => includes("moderation", moderation, snippet));

notMatches(
  "moderation",
  moderation,
  /publishFacebookPageJob|facebookPagePublish|facebookPhotoId|facebookPostId/,
  "Gallery moderation must not contain a Facebook Page publishing path.",
);

notMatches(
  "moderation",
  moderation,
  /\.from\(["']gallery_facebook_page_publish_(?:jobs|events)["']\)\s*\n?\s*\.(?:insert|upsert)\(/,
  "Facebook Page outbox creation must stay inside gallery_commit_moderation.",
);

[
  "facebook_page_opt_in",
  "facebookPageOptIn",
  "facebookPageOptInAt",
  "facebookPageOptInSource",
  "facebookPageOptInCopyVersion",
  "facebookPageOptInContractVersion",
].forEach((snippet) => includes("review queue", reviewQueue, snippet));

[
  "requireModeratorAccess(req)",
  "gallery_facebook_page_publish_jobs",
  "gallery_facebook_page_publish_events",
  "gallery_facebook_page_quarantine_stale_publish_jobs",
  "list-approved-gallery-submissions",
  "galleryPublicationId",
  "thumbnailUrl",
  "facebookPageOptIn",
  "facebookPageOptInContractVersion",
  "normalizeFacebookPermalink(job.facebook_permalink)",
].forEach((snippet) => includes("Facebook queue", listQueue, snippet));

[
  "LOWERCASE_UUID_RE",
  "revisionId",
  "_social/submissions/${submissionId}/${revisionId}.jpg",
].forEach((snippet) => includes("immutable social derivative paths", socialPath, snippet));
notMatches(
  "immutable social derivative paths",
  socialPath,
  /v1[.]jpg/,
  "new derivatives must use a random immutable revision id.",
);

[
  "strict minimal JFIF APP0",
  "no other APP0, JFXX, or APP1–APP15 metadata",
  "JPEG comments are removed",
  "I authorize Mōchirīī moderators to publish this image and its moderator-approved caption on the public official Mōchirīī Facebook Page after gallery approval, and optionally share that Page post manually to the private official Mōchirīī Guild group.",
  "share that Page post manually",
].forEach((snippet) => includes("member social eligibility copy", gallerySubmit, snippet));

notMatches(
  "Facebook queue",
  listQueue,
  /createSignedUrl|signedPreviewUrl|storageBucket|storagePath|\.storage_path|\.storage_bucket/,
  "moderator queue must expose only the credential-free approved thumbnail URL.",
);

[
  "requireModeratorAccess(req)",
  "facebookPageConfig",
  "facebookTokenRequestInit",
  "pageReachable",
  "publishEnabled",
  "publishAuthorityConfirmed",
  "facebookTasksCanPublish",
  "?fields=id,name,link",
  "?fields=tasks",
  "config.publishEnabled",
].forEach((snippet) => includes("Facebook status", status, snippet));
notMatches(
  "Facebook status",
  status,
  /\/photos|FormData|gallery_facebook_page_publish_(?:jobs|events)|\.insert\(|\.update\(/,
  "read-only Page status must not publish or mutate queue state.",
);
notMatches(
  "Facebook status",
  status,
  /error instanceof Error \? error\.message/,
  "token-bearing fetch failures must not log a URL-bearing error message.",
);

[
  "requireModeratorAccess(req)",
  "confirm_facebook_publish",
  "publishFacebookPageJob",
  "facebookPhotoId",
  "facebookPostId",
  "facebookPermalink",
  'published.error === "facebook_page_publish_disabled"',
].forEach((snippet) => includes("Facebook publish function", publish, snippet));

notMatches(
  "Facebook publisher helper",
  helper,
  /error instanceof Error \? error\.message/,
  "token-bearing fetch failures must not log a URL-bearing error message.",
);

notMatches(
  "Facebook publish function",
  publish,
  /\bjob\s*:\s*published\.job\b/,
  "standalone publisher must not return the service-only database row.",
);

for (const file of walk("apps/web").filter((name) => /\.(?:js|jsx|ts|tsx)$/i.test(name))) {
  const source = readFileSync(path.join(root, file), "utf8");
  notMatches(
    file,
    source,
    /FACEBOOK_PAGE_ACCESS_TOKEN|FACEBOOK_API_VERSION|FACEBOOK_PAGE_PUBLISH_ENABLED/,
    "Facebook server credentials must not appear in browser or Vercel code.",
  );
}

notMatches(
  "Facebook server sources",
  `${helper}\n${status}\n${publish}\n${resolve}\n${env}`,
  /FACEBOOK_API_BASE_URL/,
  "Graph API origin must not be operator-configurable.",
);

if (failures.length) {
  console.error("Facebook Page gallery publishing validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Facebook Page gallery publishing validation OK.");
