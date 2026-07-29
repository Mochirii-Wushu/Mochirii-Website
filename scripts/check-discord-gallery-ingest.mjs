import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const files = {
  config: "supabase/config.toml",
  function: "supabase/functions/submit-discord-gallery-image/index.ts",
  reaperFunction: "supabase/functions/reaper-discord-interactions/index.ts",
  authHelper: "supabase/functions/_shared/discord-gallery-ingest-auth.ts",
  authTest: "supabase/functions/_shared/discord-gallery-ingest-auth_test.ts",
  importMap: "supabase/functions/submit-discord-gallery-image/deno.json",
  nonceMigration: "supabase/migrations/20260729130654_add_discord_gallery_ingest_hmac_replay_guard.sql",
  nonceDbTest: "supabase/tests/discord_gallery_ingest_hmac_test.sql",
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

function extractFunction(text, functionName) {
  const start = text.indexOf(`function ${functionName}`);
  if (start < 0) {
    failures.push(`submit-discord-gallery-image: missing ${functionName} function.`);
    return "";
  }

  const open = text.indexOf("{", start);
  if (open < 0) {
    failures.push(`submit-discord-gallery-image: malformed ${functionName} function.`);
    return "";
  }

  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }

  failures.push(`submit-discord-gallery-image: unterminated ${functionName} function.`);
  return "";
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

const config = read(files.config);
const functionSource = read(files.function);
const reaperFunction = read(files.reaperFunction);
const authHelper = read(files.authHelper);
const authTest = read(files.authTest);
const importMap = read(files.importMap);
const nonceMigration = read(files.nonceMigration);
const nonceDbTest = read(files.nonceDbTest);
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
  "const MAX_SIZE_BYTES = 50 * 1024 * 1024;",
  'const EXPECTED_DISCORD_GUILD_ID = "1078630751077142608";',
  'const EXPECTED_REQUIRED_ROLE_IDS = ["1468659807736299520", "1078630751077142615"];',
  'const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);',
  'const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net", "media.discordapp.com"]);',
  "const RECENT_VERIFICATION_MS = 7 * 24 * 60 * 60 * 1000;",
  '"Access-Control-Allow-Methods": "POST, OPTIONS"',
  "DISCORD_GALLERY_INGEST_HMAC_KEYS_ENV",
  "verifyDiscordGalleryIngestRequest",
  "readDiscordGalleryIngestBody",
  '"consume_discord_gallery_ingest_nonce"',
  "const bodyRead = await readDiscordGalleryIngestBody(req);",
  "parseJsonBody(rawBody)",
  'Deno.env.get("DISCORD_GALLERY_CHANNEL_ID")',
  'Deno.env.get("DISCORD_GUILD_ID")',
  'Deno.env.get("DISCORD_REQUIRED_ROLE_IDS")',
  "getServiceRoleKey()",
  "guildConfigMatches",
  "roleConfigMatches",
  'return jsonResponse({ ok: false, message: "Method not allowed." }, 405);',
  'if (req.method === "OPTIONS")',
  "validAttachmentUrl(body.attachmentUrl)",
  "sniffMime(bytes)",
  "responseMime",
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

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /readDiscordGalleryIngestBody\(req\)[\s\S]*verifyDiscordGalleryIngestRequest\([\s\S]*parseJsonBody\(rawBody\)/,
  "raw request bytes must be bounded and authenticated before JSON parsing.",
);

assertNotMatches(
  "submit-discord-gallery-image",
  functionSource,
  /DISCORD_GALLERY_INGEST_SECRET|x-mochirii-reaper-secret|bearerOrHeaderSecret/,
  "the retired static-secret request contract must not remain available.",
);

[
  "DISCORD_GALLERY_INGEST_HMAC_KEYS_ENV",
  "DISCORD_GALLERY_INGEST_ACTIVE_KEY_ID_ENV",
  'const AUTH_VERSION = "v1";',
  "DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS = 60",
  "DISCORD_GALLERY_INGEST_MAX_BODY_BYTES = 16 * 1024",
  "request.body.getReader()",
  "await reader.cancel().catch(() => undefined)",
  'signature: "x-mochirii-gallery-signature"',
  "crypto.subtle.digest(\"SHA-256\"",
  '{ name: "HMAC", hash: "SHA-256" }',
  "constantTimeLowerHexMatches",
  "dependencies.consumeNonce(keyId, nonce, expiresAt)",
  "verification_unavailable",
].forEach((snippet) => assertIncludes("Discord gallery ingest auth helper", authHelper, snippet));

[
  "body-bound request",
  "binds the body, method, and exact function path",
  "rejects stale, future, malformed, and unknown-key requests",
  "consumes a nonce once and fails closed on store errors",
  "supports bounded rotation and rejects weak configuration",
  "enforces media type and streaming byte limits",
].forEach((snippet) => assertIncludes("Discord gallery ingest auth tests", authTest, snippet));

[
  "createDiscordGalleryIngestHeaders",
  "DISCORD_GALLERY_INGEST_HMAC_KEYS_ENV",
  "DISCORD_GALLERY_INGEST_ACTIVE_KEY_ID_ENV",
  "discordGalleryIngestActiveKey",
  "const rawBody = JSON.stringify(payload);",
  "...authHeaders",
  "body: rawBody",
].forEach((snippet) => assertIncludes("Reaper Discord gallery caller", reaperFunction, snippet));

assertNotMatches(
  "Reaper Discord gallery caller",
  reaperFunction,
  /DISCORD_GALLERY_INGEST_SECRET|x-mochirii-reaper-secret/,
  "the caller must not retain the retired static-secret contract.",
);

[
  "create table private.discord_gallery_ingest_nonces",
  "primary key (key_id, nonce)",
  "alter table private.discord_gallery_ingest_nonces enable row level security",
  "alter table private.discord_gallery_ingest_nonces force row level security",
  "revoke all on table private.discord_gallery_ingest_nonces",
  "create or replace function public.consume_discord_gallery_ingest_nonce",
  "request_role <> 'service_role'",
  "on conflict (key_id, nonce) do nothing",
  "grant execute on function public.consume_discord_gallery_ingest_nonce",
].forEach((snippet) => assertIncludes("nonce migration", nonceMigration, snippet));

[
  "private Discord gallery ingest nonce table exists",
  "same key and nonce cannot be replayed",
  "invalid key identifiers fail closed",
  "expired nonce leases fail closed",
  "overlong nonce leases fail closed",
].forEach((snippet) => assertIncludes("nonce database tests", nonceDbTest, snippet));

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /url\.protocol !== "https:"[\s\S]*!DISCORD_CDN_HOSTS\.has\(url\.hostname\)[\s\S]*!hasAttachmentPath/,
  "attachment URL must require HTTPS, an approved Discord CDN host, and an attachment path.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /contentLength[\s\S]*contentLength > MAX_SIZE_BYTES/,
  "attachment content-length must be bounded before body read.",
);

assertMatches(
  "submit-discord-gallery-image",
  functionSource,
  /bytes\.byteLength <= 0 \|\| bytes\.byteLength > MAX_SIZE_BYTES \|\| !sniffedMime/,
  "downloaded attachment bytes must be non-empty and bounded.",
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

const sniffMimeSource = extractFunction(functionSource, "sniffMime")
  .replace(/function sniffMime\(bytes: Uint8Array\): string \| null/, "function sniffMime(bytes)");
const sniffMime = sniffMimeSource
  ? new Function(`${sniffMimeSource}; return sniffMime;`)()
  : () => null;

assertEqual(
  "sniffMime png fixture",
  sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/png",
);
assertEqual("sniffMime jpeg fixture", sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xdb])), "image/jpeg");
assertEqual(
  "sniffMime webp fixture",
  sniffMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
  "image/webp",
);
assertEqual("sniffMime non-image fixture", sniffMime(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])), null);

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
  "DISCORD_GALLERY_INGEST_HMAC_KEYS_JSON=<JSON object of key IDs to 32+ byte secrets, never commit>",
  "DISCORD_GALLERY_INGEST_HMAC_ACTIVE_KEY_ID=<one configured key ID>",
  "share_to_instagram",
  "instagramOptIn",
  "supabase functions serve submit-discord-gallery-image --env-file supabase/functions/.env.local",
  "supabase functions deploy submit-discord-gallery-image",
  "browser users cannot set Discord source metadata.",
  "submit-discord-gallery-image",
  "verify_jwt = false",
  "trusted Reaper bridge",
  "HMAC-SHA256",
  "random one-use nonce",
  "Do not retain the former static-secret header as a fallback.",
  "existing linked `member_profiles.discord_user_id`",
  "Discord uploads are idempotent by message/attachment ID.",
].forEach((snippet) => assertIncludes("supabase README", readme, snippet));

if (failures.length) {
  console.error("Discord gallery ingest validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Discord gallery ingest validation OK.");
