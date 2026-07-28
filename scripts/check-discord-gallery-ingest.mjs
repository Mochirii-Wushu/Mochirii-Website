import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const files = {
  config: "supabase/config.toml",
  function: "supabase/functions/submit-discord-gallery-image/index.ts",
  helper: "supabase/functions/_shared/gallery-discord-ingest.ts",
  importMap: "supabase/functions/submit-discord-gallery-image/deno.json",
  sourceMigration: "supabase/migrations/20260524114802_add_discord_gallery_submission_source.sql",
  revokeMigration: "supabase/migrations/20260524115932_revoke_public_rls_auto_enable_execute.sql",
  previousGalleryMigration: "supabase/migrations/20260513081523_create_discord_role_gated_gallery_uploads.sql",
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

const config = read(files.config);
const functionSource = read(files.function);
const helperSource = read(files.helper);
const importMap = read(files.importMap);
const sourceMigration = read(files.sourceMigration);
const revokeMigration = read(files.revokeMigration);
const previousGalleryMigration = read(files.previousGalleryMigration);
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
  'const EXPECTED_DISCORD_GUILD_ID = "1078630751077142608";',
  'const EXPECTED_REQUIRED_ROLE_IDS = [',
  '"1468659807736299520",',
  '"1078630751077142615",',
  'const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);',
  'const DISCORD_CDN_HOSTS = new Set([',
  '"cdn.discordapp.com",',
  '"media.discordapp.net",',
  '"media.discordapp.com",',
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
  "constantTimeSecretEquals(bearerOrHeaderSecret(req), ingestSecret)",
  'return jsonResponse({ ok: false, message: "Method not allowed." }, 405);',
  'if (req.method === "OPTIONS")',
  "validAttachmentUrl(body.attachmentUrl)",
  "validateGallerySourceBytes(bytes)",
  "responseMime",
  "downloadAllowlistedAttachment({",
  "downloadedSize: bytes.byteLength",
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
  "INSTAGRAM_OPT_IN_COPY_VERSION",
  "instagram_opt_in: instagramOptIn",
  'instagram_opt_in_source: instagramOptIn ? "discord_slash_command" : null',
].forEach((snippet) => assertIncludes("submit-discord-gallery-image", functionSource, snippet));

[
  "crypto.subtle.digest(\"SHA-256\"",
  "difference |= providedBytes[index] ^ expectedBytes[index]",
  "readBoundedJsonRecord",
  'await reader.cancel("request_too_large")',
  "downloadAllowlistedAttachment",
  'redirect: "manual"',
  'await reader.cancel("attachment_too_large")',
  "readBoundedResponseBytes(response, maximumBytes)",
].forEach((snippet) => assertIncludes("Discord Gallery ingest helper", helperSource, snippet));

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /url\.protocol !== "https:"[\s\S]*!DISCORD_CDN_HOSTS\.has\(url\.hostname\)[\s\S]*!hasAttachmentPath/,
  "attachment URL must require HTTPS, an approved Discord CDN host, and an attachment path.",
);

assertMatches(
  "submit-discord-gallery-image",
  helperSource,
  /contentLength[\s\S]*contentLength > maximumBytes/,
  "attachment content-length must be bounded before body read.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /bytes\.byteLength <= 0 \|\| bytes\.byteLength > MAX_SIZE_BYTES \|\|\s*!sourceValidation\.ok \|\| !sniffedMime/,
  "downloaded attachment bytes must be non-empty, bounded, and structurally validated.",
);

assertNotMatches(
  "submit-discord-gallery-image",
  `${functionSource}\n${helperSource}`,
  /\.arrayBuffer\(\)/,
  "attachment reads must stream through the hard byte ceiling even without Content-Length.",
);

assertNotMatches(
  "submit-discord-gallery-image",
  functionSource,
  /sniffedMime\s*!==\s*declaredMime/,
  "Discord-declared MIME metadata is advisory; sniffed bytes must be the final image type authority.",
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
  "discord_guild_id = '1078630751077142608'",
  "gallery_submissions_discord_id_format_check",
  "create unique index if not exists gallery_submissions_discord_attachment_key",
  "create index if not exists gallery_submissions_discord_user_id_idx",
].forEach((snippet) => assertIncludes("source migration", sourceMigration, snippet));

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

[
  "DISCORD_GALLERY_CHANNEL_ID=1508077313965817856",
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
