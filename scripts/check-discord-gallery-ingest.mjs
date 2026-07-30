import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const files = {
  checker: "scripts/check-discord-gallery-ingest.mjs",
  config: "supabase/config.toml",
  function: "supabase/functions/submit-discord-gallery-image/index.ts",
  ingestShared: "supabase/functions/_shared/gallery-discord-ingest.ts",
  ingestSharedTests: "supabase/functions/_shared/gallery-discord-ingest_test.ts",
  sourceImageShared: "supabase/functions/_shared/gallery-source-image.ts",
  envExample: "supabase/functions/.env.example",
  importMap: "supabase/functions/submit-discord-gallery-image/deno.json",
  sourceMigration: "supabase/migrations/20260524114802_add_discord_gallery_submission_source.sql",
  revokeMigration: "supabase/migrations/20260524115932_revoke_public_rls_auto_enable_execute.sql",
  previousGalleryMigration: "supabase/migrations/20260513081523_create_discord_role_gated_gallery_uploads.sql",
  currentConsentMigration: "supabase/migrations/20260729224212_add_gallery_social_consent_withdrawal.sql",
  readme: "supabase/README.md",
};

const failures = [];

function read(file) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) {
    failures.push(`${file}: missing required Discord gallery ingest file.`);
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

const checkerSource = read(files.checker);
const config = read(files.config);
const functionSource = read(files.function);
const ingestShared = read(files.ingestShared);
const ingestSharedTests = read(files.ingestSharedTests);
const sourceImageShared = read(files.sourceImageShared);
const envExample = read(files.envExample);
const importMap = read(files.importMap);
const sourceMigration = read(files.sourceMigration);
const revokeMigration = read(files.revokeMigration);
const previousGalleryMigration = read(files.previousGalleryMigration);
const currentConsentMigration = read(files.currentConsentMigration);
const readme = read(files.readme);
const authenticatedInsertGrant = previousGalleryMigration.match(
  /grant insert \(([\s\S]*?)\) on table public\.gallery_submissions to authenticated;/,
)?.[1] || "";

assertIncludes("supabase config", config, "[functions.submit-discord-gallery-image]");
assertIncludes("supabase config", config, "verify_jwt = false");
assertIncludes("supabase config", config, 'import_map = "./functions/submit-discord-gallery-image/deno.json"');
assertIncludes("supabase config", config, 'entrypoint = "./functions/submit-discord-gallery-image/index.ts"');

assertIncludes("import map", importMap, '"@supabase/functions-js/edge-runtime.d.ts": "jsr:@supabase/functions-js@2.110.8/edge-runtime.d.ts"');
assertIncludes("import map", importMap, '"@supabase/supabase-js": "npm:@supabase/supabase-js@2.110.8"');

[
  'const MEMBER_GALLERY_BUCKET = "member-gallery";',
  "const MAX_SIZE_BYTES = 8 * 1024 * 1024;",
  "const MAX_REQUEST_BODY_BYTES = 32 * 1024;",
  "const ATTACHMENT_TIMEOUT_MS = 15_000;",
  "const RECENT_VERIFICATION_MS = 7 * 24 * 60 * 60 * 1000;",
  '"Access-Control-Allow-Methods": "POST, OPTIONS"',
  "x-mochirii-reaper-secret",
  'Deno.env.get("DISCORD_GALLERY_INGEST_SECRET")',
  'Deno.env.get("DISCORD_GALLERY_CHANNEL_ID")',
  'Deno.env.get("DISCORD_GUILD_ID")',
  'Deno.env.get("DISCORD_REQUIRED_ROLE_IDS")',
  "getServiceRoleKey()",
  "guildConfigMatches",
  "roleConfigMatches",
  'from "../_shared/gallery-discord-ingest.ts"',
  'from "../_shared/gallery-source-image.ts"',
  "readBoundedJsonRecord(req, MAX_REQUEST_BODY_BYTES)",
  "downloadAllowlistedAttachment({",
  "maximumBytes: MAX_SIZE_BYTES",
  "timeoutMs: ATTACHMENT_TIMEOUT_MS",
  "validateGallerySourceBytes(bytes)",
  "sourceValidation.source.mimeType",
  'return jsonResponse({ ok: false, message: "Method not allowed." }, 405);',
  'if (req.method === "OPTIONS")',
  "validAttachmentUrl(body.attachmentUrl)",
  "That file could not be read as a JPEG, PNG, or WebP image.",
  ".eq(\"submission_source\", \"discord\")",
  ".eq(\"discord_message_id\", messageId)",
  ".eq(\"discord_attachment_id\", attachmentId)",
  '.from("member_profiles")',
  "memberStatus !== \"active\"",
  "profile.has_required_discord_roles !== true",
  "!verificationIsRecent(profile.discord_verified_at)",
  "missingStoredRoleIds.length > 0",
  ".upload(storagePath, bytes,",
  "upsert: false",
  "await adminClient.storage.from(MEMBER_GALLERY_BUCKET).remove([storagePath]);",
  'submission_source: "discord"',
  "discord_guild_id: guildId",
  "discord_channel_id: channelId",
  "discord_message_id: messageId",
  "discord_attachment_id: attachmentId",
  "discord_user_id: discordUserId",
  "instagramOptIn",
  "instagram_opt_in: instagramOptIn",
].forEach((snippet) => assertIncludes("submit-discord-gallery-image", functionSource, snippet));

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /const EXPECTED_DISCORD_GUILD_ID = "\d{16,22}";/,
  "the trusted bridge must pin one Discord guild snowflake without duplicating its private value in the checker.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /const EXPECTED_REQUIRED_ROLE_IDS = \[\s*"\d{16,22}",\s*"\d{16,22}",?\s*\];/,
  "the trusted bridge must pin the two required Discord role snowflakes.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /const ALLOWED_MIME_TYPES = new Set\(\[\s*"image\/jpeg",\s*"image\/png",\s*"image\/webp",?\s*\]\);/,
  "the ingest MIME allowlist must remain limited to JPEG, PNG, and WebP.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /const DISCORD_CDN_HOSTS = new Set\(\[\s*"cdn\.discordapp\.com",\s*"media\.discordapp\.net",\s*"media\.discordapp\.com",?\s*\]\);/,
  "the attachment host allowlist must remain limited to Discord CDN hosts.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /!await constantTimeSecretEquals\(\s*bearerOrHeaderSecret\(req\),\s*ingestSecret\s*\)/,
  "the trusted bridge secret must use the shared constant-time comparison.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /url\.protocol !== "https:"[\s\S]*!DISCORD_CDN_HOSTS\.has\(url\.hostname\)[\s\S]*!hasAttachmentPath/,
  "attachment URL must require HTTPS, an approved Discord CDN host, and an attachment path.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /attachmentDownload = await downloadAllowlistedAttachment\(\{[\s\S]*maximumBytes: MAX_SIZE_BYTES,[\s\S]*timeoutMs: ATTACHMENT_TIMEOUT_MS,/,
  "attachments must use the shared bounded, timed, allowlisted downloader.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /const sourceValidation = await validateGallerySourceBytes\(bytes\);[\s\S]*bytes\.byteLength <= 0 \|\| bytes\.byteLength > MAX_SIZE_BYTES \|\|[\s\S]*!sourceValidation\.ok \|\| !sniffedMime/,
  "downloaded bytes must remain bounded and pass shared structural image validation.",
);

assertNotMatches(
  "submit-discord-gallery-image",
  functionSource,
  /\bfetch\s*\(/,
  "attachment requests must stay inside the reviewed shared downloader.",
);

assertNotMatches(
  "submit-discord-gallery-image",
  functionSource,
  /!declaredMime[\s\S]{0,180}invalid_discord_submission/,
  "missing Discord-declared MIME metadata must not reject otherwise valid attachment metadata.",
);

assertNotMatches(
  "submit-discord-gallery-image",
  functionSource,
  /createSignedUrl|getPublicUrl|publicUrl|signed_url/i,
  "ingest function must not create or expose public/signed image URLs.",
);

assertNotMatches(
  "submit-discord-gallery-image",
  functionSource,
  /\b(?:uploadRightsConfirmed|facebookPageOptIn)\b|(?:upload_rights_confirmed|instagram_consent_version|facebook_page_opt_in|facebook_page_consent_version)\s*:/,
  "the Discord bridge must not mint current website rights or destination-consent evidence.",
);

[
  "export async function constantTimeSecretEquals(",
  'crypto.subtle.digest("SHA-256", encoder.encode(provided))',
  'crypto.subtle.digest("SHA-256", encoder.encode(expected))',
  "difference |= providedBytes[index] ^ expectedBytes[index]",
  "export async function readBoundedJsonRecord(",
  'contentType !== "application/json"',
  "totalBytes > maximumBytes",
  "export async function downloadAllowlistedAttachment({",
  'redirect: "manual"',
  "new AbortController()",
  "contentLength > maximumBytes",
  "readBoundedResponseBytes(response, maximumBytes)",
].forEach((snippet) => assertIncludes("shared Discord ingest boundary", ingestShared, snippet));

assertMatches(
  "shared Discord ingest boundary",
  ingestShared,
  /for \(let index = 0; index < expectedBytes\.length; index \+= 1\)[\s\S]*return difference === 0;/,
  "secret comparison must use a fixed-length digest loop before returning equality.",
);

assertMatches(
  "shared Discord ingest boundary",
  ingestShared,
  /const timeout = setTimeout\(\(\) => controller\.abort\(\), timeoutMs\);[\s\S]*finally \{\s*clearTimeout\(timeout\);/,
  "the attachment deadline must cover the full request and always be cleared.",
);

assertMatches(
  "shared Discord ingest boundary",
  ingestShared,
  /throw new GalleryDiscordIngestError\([\s\S]*controller\.signal\.aborted[\s\S]*"attachment_timeout"[\s\S]*"attachment_fetch_failed"/,
  "unexpected attachment failures must collapse to fixed, URL-free error categories.",
);

[
  "ingest secrets use a fixed-length digest comparison",
  "request JSON is content-type checked and bounded while streaming",
  "attachment redirects remain manual and inside the allowlist",
  "attachment bodies and deadlines fail closed",
  "attachment fetch failures never retain signed URL details",
].forEach((snippet) => assertIncludes("shared Discord ingest tests", ingestSharedTests, snippet));

[
  "export const GALLERY_SOURCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;",
  "function detectMimeType(bytes: Uint8Array)",
  "export async function validateGallerySourceBytes(",
  'if (mimeType === "image/jpeg") return parseJpeg(bytes);',
  'if (mimeType === "image/png") return parsePng(bytes);',
].forEach((snippet) => assertIncludes("shared Gallery source validation", sourceImageShared, snippet));

assertMatches(
  "shared Gallery source validation",
  sourceImageShared,
  /\["image\/jpeg", "image\/png", "image\/webp"\]\.includes\(declared\)/,
  "structural source validation must retain the exact accepted MIME allowlist.",
);

[
  "add column upload_rights_confirmed boolean not null default false",
  "add column instagram_consent_version text",
  "add column facebook_page_consent_version text",
  "gallery_submissions_instagram_consent_v3_check",
  "gallery_submissions_facebook_consent_v3_check",
  "2026-07-website-public-instagram-publish-v3",
  "2026-07-website-public-facebook-page-group-v3",
  "2026-07-gallery-upload-rights-v1",
  "destination in ('instagram', 'facebook_page')",
].forEach((snippet) => assertIncludes("current destination consent migration", currentConsentMigration, snippet));

assertMatches(
  "current destination consent migration",
  currentConsentMigration,
  /gallery_submissions_instagram_consent_v3_check[\s\S]*instagram_opt_in is true[\s\S]*instagram_opt_in_source = 'website_upload'[\s\S]*instagram_consent_version =[\s\S]*'2026-07-website-public-instagram-publish-v3'[\s\S]*upload_rights_confirmed is true/,
  "Instagram v3 consent must independently require its own opt-in plus website rights attestation.",
);

assertMatches(
  "current destination consent migration",
  currentConsentMigration,
  /gallery_submissions_facebook_consent_v3_check[\s\S]*facebook_page_opt_in is true[\s\S]*facebook_page_opt_in_source = 'website_upload'[\s\S]*facebook_page_consent_version =[\s\S]*'2026-07-website-public-facebook-page-group-v3'[\s\S]*upload_rights_confirmed is true/,
  "Facebook Page v3 consent must independently require its own opt-in plus website rights attestation.",
);

assertMatches(
  "current destination consent migration",
  currentConsentMigration,
  /create function private\.attest_gallery_upload_rights\(\)[\s\S]*?if new\.submission_source = 'website'[\s\S]*?and new\.upload_rights_confirmed is true[\s\S]*?else[\s\S]*?new\.upload_rights_confirmed := false;/,
  "server rights attestation must fail closed for non-website submissions.",
);

[
  "add column if not exists submission_source text not null default 'website'",
  "add column if not exists discord_guild_id text",
  "add column if not exists discord_channel_id text",
  "add column if not exists discord_message_id text",
  "add column if not exists discord_attachment_id text",
  "add column if not exists discord_user_id text",
  "gallery_submissions_submission_source_check",
  "submission_source in ('website', 'discord')",
  "gallery_submissions_discord_source_required_check",
  "gallery_submissions_discord_id_format_check",
  "create unique index if not exists gallery_submissions_discord_attachment_key",
  "create index if not exists gallery_submissions_discord_user_id_idx",
].forEach((snippet) => assertIncludes("source migration", sourceMigration, snippet));

assertMatches(
  "source migration",
  sourceMigration,
  /discord_guild_id = '\d{16,22}'/,
  "Discord-source rows must remain pinned to one guild snowflake without duplicating its private value in the checker.",
);

assertMatches(
  "source migration",
  sourceMigration,
  /validate constraint gallery_submissions_submission_source_check[\s\S]*validate constraint gallery_submissions_discord_source_required_check[\s\S]*validate constraint gallery_submissions_discord_id_format_check/,
  "new check constraints must be validated before release.",
);

assertIncludes("revoke migration", revokeMigration, "to_regprocedure('public.rls_auto_enable()')");
assertIncludes("revoke migration", revokeMigration, "revoke execute on function public.rls_auto_enable() from public");
assertIncludes("revoke migration", revokeMigration, "revoke execute on function public.rls_auto_enable() from anon");
assertIncludes("revoke migration", revokeMigration, "revoke execute on function public.rls_auto_enable() from authenticated");

assertMatches(
  "previous gallery migration",
  previousGalleryMigration,
  /grant insert \([\s\S]*user_id,[\s\S]*storage_bucket,[\s\S]*storage_path,[\s\S]*original_filename,[\s\S]*mime_type,[\s\S]*size_bytes,[\s\S]*title,[\s\S]*caption,[\s\S]*category[\s\S]*\) on table public\.gallery_submissions to authenticated;/,
  "authenticated insert grant should stay limited to website-editable submission fields.",
);

assertNotMatches(
  "previous gallery migration",
  authenticatedInsertGrant,
  /discord_/,
  "browser-authenticated insert grants must not include Discord source metadata.",
);

assertIncludes(
  "function environment example",
  envExample,
  "DISCORD_GALLERY_CHANNEL_ID=",
);

assertNotMatches(
  "Discord gallery ingest checker",
  checkerSource,
  /\b\d{16,22}\b/,
  "checker fixtures must not contain private provider identifiers.",
);

[
  "DISCORD_GALLERY_CHANNEL_ID",
  "DISCORD_GALLERY_INGEST_SECRET=<set manually, never commit>",
  "share_to_instagram",
  "instagramOptIn",
  "supabase functions serve submit-discord-gallery-image --env-file supabase/functions/.env.local",
  "supabase functions deploy submit-discord-gallery-image",
  "browser users cannot set Discord source metadata.",
  "submit-discord-gallery-image",
  "verify_jwt = false",
  "trusted Reaper bridge",
  "existing linked `member_profiles.discord_user_id`",
  "Discord uploads are idempotent by message/attachment ID.",
].forEach((snippet) => assertIncludes("supabase README", readme, snippet));

if (failures.length) {
  console.error("Discord gallery ingest validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Discord gallery ingest validation OK.");
