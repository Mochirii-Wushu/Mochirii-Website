import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const files = {
  config: "supabase/config.toml",
  function: "supabase/functions/submit-discord-gallery-image/index.ts",
  verifier: "supabase/functions/_shared/discord-gallery-ingest-auth.ts",
  verifierTest: "supabase/functions/_shared/discord-gallery-ingest-auth_test.ts",
  authorizationContext: "supabase/functions/_shared/discord-gallery-authorization-context.ts",
  authorizationContextTest: "supabase/functions/_shared/discord-gallery-authorization-context_test.ts",
  payload: "supabase/functions/_shared/discord-gallery-ingest-payload.ts",
  payloadTest: "supabase/functions/_shared/discord-gallery-ingest-payload_test.ts",
  reservation: "supabase/functions/_shared/discord-gallery-storage-reservation.ts",
  reservationTest: "supabase/functions/_shared/discord-gallery-storage-reservation_test.ts",
  transport: "supabase/functions/_shared/gallery-discord-ingest.ts",
  transportTest: "supabase/functions/_shared/gallery-discord-ingest_test.ts",
  sourceImage: "supabase/functions/_shared/gallery-source-image.ts",
  sourceImageTest: "supabase/functions/_shared/gallery-source-image_test.ts",
  sourceDecode: "supabase/functions/_shared/gallery-source-decode.ts",
  sourceDecodeTest: "supabase/functions/_shared/gallery-source-decode_test.ts",
  moderator: "supabase/functions/moderate-gallery-submission/index.ts",
  nonceMigration: "supabase/migrations/20260729130654_add_discord_gallery_ingest_hmac_replay_guard.sql",
  reservationMigration: "supabase/migrations/20260811120000_add_discord_gallery_ingest_reservations.sql",
  hardeningMigration: "supabase/migrations/20260811121500_harden_discord_gallery_originals.sql",
  nonceDatabaseTest: "supabase/tests/discord_gallery_ingest_hmac_test.sql",
  reservationDatabaseTest: "supabase/tests/discord_gallery_ingest_reservations_test.sql",
  contract: "docs/integrations/discord-gallery-ingest-hmac.v1.json",
  authorizationContextContract: "docs/integrations/discord-gallery-authorization-context.v1.json",
  activation: "docs/operations/discord-gallery-ingest-hmac-activation.md",
  supabaseReadme: "supabase/README.md",
};
const expectedContractSha256 =
  "af3025221626aadd2d0fc82fd79bb02b3f253ccdd8753fb78082aa885c929e3f";
const expectedAuthorizationContextContractSha256 =
  "db5ab92c20df4e59957979750e2ba6d3484f6112eb0ad87787bdf1d5be8d237c";

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    failures.push(`${relativePath}: missing required Discord gallery ingest file.`);
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
const verifier = read(files.verifier);
const verifierTest = read(files.verifierTest);
const authorizationContext = read(files.authorizationContext);
const authorizationContextTest = read(files.authorizationContextTest);
const payload = read(files.payload);
const payloadTest = read(files.payloadTest);
const reservation = read(files.reservation);
const reservationTest = read(files.reservationTest);
const transport = read(files.transport);
const transportTest = read(files.transportTest);
const sourceImage = read(files.sourceImage);
const sourceImageTest = read(files.sourceImageTest);
const sourceDecode = read(files.sourceDecode);
const sourceDecodeTest = read(files.sourceDecodeTest);
const moderator = read(files.moderator);
const nonceMigration = read(files.nonceMigration);
const reservationMigration = read(files.reservationMigration);
const hardeningMigration = read(files.hardeningMigration);
const nonceDatabaseTest = read(files.nonceDatabaseTest);
const reservationDatabaseTest = read(files.reservationDatabaseTest);
const contractText = read(files.contract);
const authorizationContextContractText = read(files.authorizationContextContract);
const activation = read(files.activation);
const supabaseReadme = read(files.supabaseReadme);

assertIncludes("Supabase config", config, "[functions.submit-discord-gallery-image]");
assertIncludes("Supabase config", config, "verify_jwt = false");
assertIncludes("Supabase config", config, 'entrypoint = "./functions/submit-discord-gallery-image/index.ts"');

[
  "DISCORD_GALLERY_INGEST_HMAC_KEYS_ENV",
  "exactDiscordGalleryIngestPath",
  "exactDiscordGallerySupabaseOrigin",
  "readDiscordGalleryIngestBody",
  "authenticateDiscordGalleryIngestBody",
  "parseDiscordGalleryIngestJsonRecord",
  "parseDiscordGalleryIngestPayload",
  "discordGalleryAuthorizationContextMatches",
  "downloadAllowlistedAttachment",
  "validDiscordGalleryAttachmentUrl",
  "validateGallerySourceBytes",
  "decodeGallerySourceImage",
  '"consume_discord_gallery_ingest_nonce"',
  "const bodyRead = await readDiscordGalleryIngestBody(req);",
  "parseDiscordGalleryIngestJsonRecord(authentication.bodyText)",
  'Deno.env.get("DISCORD_GUILD_ID")',
  'canonicalDiscordSnowflake(\n    Deno.env.get("DISCORD_GALLERY_CHANNEL_ID")',
  'Deno.env.get("DISCORD_REQUIRED_ROLE_IDS")',
  "const DISCORD_REQUIRED_ROLE_COUNT = 2;",
  "configuredRequiredRoleIds.filter",
  "const MAX_SIZE_BYTES = GALLERY_SOURCE_IMAGE_MAX_BYTES;",
  "const ATTACHMENT_TIMEOUT_MS = 15_000;",
  "declaredSize === bytes.byteLength",
  "missingRoleCount: missingStoredRoleIds.length",
  '"acquire_discord_gallery_ingest_reservation"',
  '"confirm_discord_gallery_ingest_upload"',
  '"finalize_discord_gallery_ingest_reservation"',
  "sourceSha256: sourceValidation.source.sha256",
  "validatorVersion: GALLERY_SOURCE_IMAGE_VALIDATOR_VERSION",
  "upsert: true",
].forEach((snippet) => assertIncludes("Website receiver", functionSource, snippet));

assertMatches(
  "Website receiver",
  functionSource,
  /readDiscordGalleryIngestBody\(req\)[\s\S]*authenticateDiscordGalleryIngestBody\([\s\S]*parseDiscordGalleryIngestJsonRecord\(authentication\.bodyText\)[\s\S]*parseDiscordGalleryIngestPayload\(body\)[\s\S]*discordGalleryAuthorizationContextMatches\([\s\S]*\.from\("member_profiles"\)[\s\S]*downloadAllowlistedAttachment\([\s\S]*validateGallerySourceBytes\([\s\S]*decodeGallerySourceImage\([\s\S]*acquire_discord_gallery_ingest_reservation[\s\S]*\.upload\([\s\S]*confirm_discord_gallery_ingest_upload[\s\S]*finalize_discord_gallery_ingest_reservation/,
  "exact-byte auth and nonce, payload/context checks, current profile authorization, transport/decode, reservation, upload confirmation, and finalization order drifted.",
);
assertMatches(
  "Website receiver",
  functionSource,
  /const supabaseUrl = exactDiscordGallerySupabaseOrigin\([\s\S]*if \([\s\S]*!supabaseUrl[\s\S]*const adminClient = createClient\(supabaseUrl, serviceRoleKey/,
  "the service-role client must be created only after exact canonical Supabase origin validation.",
);
assertNotMatches(
  "Website receiver",
  functionSource,
  /attachmentResponse\.arrayBuffer\(|\bfetch\(attachmentUrl|function sniffMime|\.remove\(|\.from\(["']gallery_submissions["']\)[\s\S]{0,200}\.insert\(/,
  "unbounded attachment reads, magic-prefix-only validation, unsafe cleanup, and direct application inserts must not remain.",
);
assertNotMatches(
  "Website receiver",
  functionSource,
  /(?:nonce consumption|duplicate lookup|profile lookup|storage upload|submission insert)[\s\S]{0,240}(?:\.message|statusText)/,
  "provider and database failure logs must use only fixed codes and booleans.",
);
assertNotMatches(
  "Website receiver",
  functionSource,
  /DISCORD_GALLERY_INGEST_SECRET|x-mochirii-reaper-secret|bearerOrHeaderSecret/,
  "retired static-secret authentication must not remain available.",
);
assertNotMatches(
  "Website receiver",
  functionSource,
  /["']\d{16,22}["']/,
  "provider guild, channel, role, user, and application IDs must stay in validated runtime configuration.",
);
assertNotMatches(
  "Website receiver",
  functionSource,
  /safeString\(body\.|String\(body\.|Number\(body\.|image\/jpg/,
  "HMAC-bound payload fields must not be coerced, trimmed, truncated, or MIME-aliased.",
);

[
  '"discord-gallery-ingest-hmac.v1"',
  'const AUTH_VERSION = "v1";',
  "DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS = 60",
  "DISCORD_GALLERY_INGEST_MAX_BODY_BYTES = 16 * 1024",
  "parseFlatStringMap",
  "seen.has(key.value)",
  "request.body.getReader()",
  "timeoutMs = 5_000",
  '"https://deyvmtncimmcinldjyqe.supabase.co"',
  "exactDiscordGallerySupabaseOrigin",
  "await reader.cancel().catch(() => undefined)",
  'signature: "x-mochirii-gallery-signature"',
  'crypto.subtle.digest("SHA-256"',
  '{ name: "HMAC", hash: "SHA-256" }',
  "constantTimeLowerHexMatches",
  "dependencies.consumeNonce(keyId, nonce, expiresAt)",
  "decodeDiscordGalleryIngestBody(rawBodyBytes)",
  'bodyText.includes("\\uFEFF")',
  "verification_unavailable",
].forEach((snippet) => assertIncludes("Website verifier", verifier, snippet));
assertMatches(
  "Website verifier",
  verifier,
  /verifyDiscordGalleryIngestRequest\([\s\S]*decodeDiscordGalleryIngestBody\(rawBodyBytes\)/,
  "exact bytes must be authenticated and nonce-consumed before UTF-8/BOM decoding.",
);
assertNotMatches(
  "Website verifier",
  verifier,
  /ACTIVE_KEY_ID|createDiscordGalleryIngest(?:Headers|Signature)|discordGalleryIngestActiveKey|randomDiscordGalleryIngestNonce/,
  "Website must not duplicate Reaper signer or active-key-selection ownership.",
);

[
  "frozen Reaper signer fixture verifies once",
  "exact bytes, method, and runtime-normalized pathname",
  "exact bytes before UTF-8 and BOM rejection",
  "stale, future, malformed, and unknown-key",
  "rejects replay and fails closed",
  "decoded duplicate IDs",
  "streaming byte limit",
  "exact canonical Supabase service origin",
  "partialHeaders.delete",
  "?x=1",
  "normalizedTraversal",
  "stalled, drip-fed, and aborted request bodies",
  "FIXED_REAPER_SIGNATURE",
].forEach((snippet) => assertIncludes("Website verifier tests", verifierTest, snippet));

[
  '"discord-gallery-authorization-context.v1"',
  'rows.map(([label, value]) => `${label}\\0${value}\\n`)',
  'DISCORD_GALLERY_AUTHORIZATION_CONTEXT_REQUIRED_ROLE_MATCH = "all"',
  '"required-role-match",',
  "BigInt(value)",
  "parsed.toString(10) === value",
  "new Set(roleIds).size !== roleIds.length",
  ".sort((left, right)",
  'crypto.subtle.digest(',
  "constantTimeLowerHexMatches",
].forEach((snippet) => assertIncludes("authorization context", authorizationContext, snippet));
[
  "independently reproduces the frozen authorization-context vector",
  "af0e2e6f1bcc2f15633ed33fc8947684c0f86abf50fa82d51c7f849bd72450d2",
  "rejects duplicates and malformed IDs",
  "exact positive uint64 decimal bytes without coercion",
  "ASCII role ordering is distinguished from numeric ordering",
  "every frozen negative authorization-context override fails closed",
  "requires both exact HMAC-bound context fields",
  "literal and decoded duplicate keys",
].forEach((snippet) => assertIncludes("authorization context tests", authorizationContextTest, snippet));

[
  "parseDiscordGalleryIngestPayload",
  "keys.length !== PAYLOAD_KEYS.size",
  'value.includes("\\uFEFF")',
  "canonicalDiscordSnowflake",
  "validDiscordGalleryAttachmentUrl",
  "Number.isSafeInteger(body.sizeBytes)",
  "GALLERY_SOURCE_IMAGE_MAX_BYTES",
  "value.trim() === value",
  'body.authorizationContextVersion !==',
  "filenameMatchesMime",
  'mimeType === "image/jpeg"',
  'lowerFilename.endsWith(".jpeg")',
].forEach((snippet) => assertIncludes("ingest payload", payload, snippet));
[
  "exact 14-field Reaper payload shape",
  "missing, unknown, and implicit optional fields",
  "coercion, whitespace, and truncation",
  "escaped semantic U+FEFF",
  "size, MIME, filename, and URL identity",
  "exact authorization-context fields",
  "8_388_609",
  'mimeType: "image/jpg"',
].forEach((snippet) => assertIncludes("ingest payload tests", payloadTest, snippet));

[
  "parseDiscordGalleryReservationAcquisition",
  "parseDiscordGalleryUploadConfirmation",
  "parseDiscordGalleryReservationFinalization",
  "/discord-ingest/",
  "storagePath !== expectedStoragePath",
  '"tombstoned"',
].forEach((snippet) => assertIncludes("storage reservation parser", reservation, snippet));
[
  "lease-generation user path and MIME extension",
  "ready, busy, conflict, and tombstone outcomes",
  "malformed database outcomes",
].forEach((snippet) => assertIncludes("storage reservation parser tests", reservationTest, snippet));

[
  "validDiscordGalleryAttachmentUrl",
  'url.protocol !== "https:"',
  "url.username || url.password || url.hash || url.port",
  'redirect: "manual"',
  "maximumRedirects > 3",
  "setTimeout(() => controller.abort(), timeoutMs)",
  "response.body.getReader()",
  "reader.cancel(\"attachment_too_large\")",
  "attachment_content_length_mismatch",
  "expectedChannelId",
  "expectedAttachmentId",
  "url.toString() === value",
  "galleryDiscordIngestErrorCode",
].forEach((snippet) => assertIncludes("attachment transport", transport, snippet));
[
  "allows only exact HTTPS Discord attachment origins and paths",
  "a fourth redirect must fail before a fifth request",
  "8 MiB+1 streaming boundary must cancel",
  "applies one deadline to fetch and response streaming",
  "SIGNED_QUERY_MUST_NOT_SURVIVE",
  "URL channel identity must match the HMAC-bound body",
  "URL attachment identity must match the HMAC-bound body",
].forEach((snippet) => assertIncludes("attachment transport tests", transportTest, snippet));

[
  "GALLERY_SOURCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024",
  "GALLERY_SOURCE_IMAGE_MAX_EDGE = 4096",
  "GALLERY_SOURCE_IMAGE_MAX_PIXELS = 12_600_000",
  "GALLERY_SOURCE_WEBP_MAX_EDGE = 720",
  "source_image_webp_dimensions_unsupported",
  "source_image_mime_mismatch",
].forEach((snippet) => assertIncludes("source image validator", sourceImage, snippet));
[
  "JPEG duplicate dimensions, truncation, and trailing data",
  "PNG duplicate headers, CRC changes, nonconsecutive data, and truncation",
  "WebP metadata, animation, unknown chunks",
  "encoded-byte, edge, and pixel ceilings independently",
  "source_image_webp_dimensions_unsupported",
  "MIME confusion",
  "const zeroWidth",
  "const zeroHeight",
].forEach((snippet) => assertIncludes("source image tests", sourceImageTest, snippet));

[
  'from "./gallery-webp-decoder.ts"',
  "GALLERY_SOURCE_WEBP_DECODER_VERSION = 0x010600",
  'if (mimeType === "image/webp")',
  "isDecodableGalleryWebp",
  'typeof globalThis.createImageBitmap !== "function"',
  "decoded.close()",
].forEach((snippet) => assertIncludes("source full decoder", sourceDecode, snippet));
assertMatches(
  "source full decoder",
  sourceDecode,
  /if \(mimeType === "image\/webp"\)[\s\S]*isDecodableGalleryWebp\([\s\S]*return \{[\s\S]*const selectedDecoder = bitmapDecoder \?\? runtimeBitmapDecoder\(\)/,
  "WebP must return through libwebp before the JPEG/PNG bitmap decoder is selected.",
);
[
  "valid lossy, lossless, and alpha WebP",
  "structurally plausible corrupt WebP pixels",
  "createImageBitmap only for JPEG and PNG",
  "above the immutable 720px decode bound as unsupported",
].forEach((snippet) => assertIncludes("source full-decode tests", sourceDecodeTest, snippet));

[
  "create table private.discord_gallery_ingest_nonces",
  "primary key (key_id, nonce)",
  "enable row level security",
  "force row level security",
  "revoke all on schema private from public, anon",
  "revoke all on table private.discord_gallery_ingest_nonces",
  "from public, anon, authenticated, service_role",
  "create or replace function public.consume_discord_gallery_ingest_nonce",
  "security definer",
  "set search_path = ''",
  "request_role is distinct from 'service_role'",
  "current_setting('role', true)",
  "or p_expires_at is null",
  "on conflict (key_id, nonce) do nothing",
  "grant execute on function public.consume_discord_gallery_ingest_nonce",
  "to service_role",
].forEach((snippet) => assertIncludes("nonce migration", nonceMigration, snippet));
assertNotMatches(
  "nonce migration",
  nonceMigration,
  /create table (?!private\.)/i,
  "nonce state must not create a Data API exposed table.",
);
assertNotMatches(
  "nonce migration",
  nonceMigration,
  /revoke all on schema private from[^;]*(?:authenticated|service_role)/i,
  "the shared private schema grants used by existing Gallery RLS must remain intact.",
);

[
  "private Discord gallery ingest nonce table exists",
  "nonce migration preserves established private schema usage",
  "nonce migration preserves existing authenticated Gallery helper execution",
  "nonce table enables and forces RLS",
  "browser and service roles have no direct nonce table access",
  "only service role can call the nonce consumer",
  "same key and nonce cannot be replayed",
  "invalid key identifiers fail closed",
  "expired nonce leases fail closed",
  "overlong nonce leases fail closed",
  "null nonce leases fail closed deterministically",
  "internal guard rejects an absent role claim",
].forEach((snippet) => assertIncludes("nonce database tests", nonceDatabaseTest, snippet));

[
  "add column source_sha256 text",
  "gallery_submissions_discord_id_format_check",
  "discord_guild_id ~ '^[1-9][0-9]{15,19}$'",
  "information_schema.columns",
  "column_name = 'user_metadata'",
  "column_name = 'version'",
  "discord_gallery_ingest_storage_schema_incompatible",
  "create table private.discord_gallery_ingest_reservations",
  "primary key (discord_message_id, discord_attachment_id)",
  "unique (storage_path)",
  "enable row level security",
  "force row level security",
  "revoke all on table private.discord_gallery_ingest_reservations",
  "request_role is distinct from 'service_role'",
  "current_setting('role', true)",
  "create or replace function public.acquire_discord_gallery_ingest_reservation",
  "create or replace function public.confirm_discord_gallery_ingest_upload",
  "create or replace function public.finalize_discord_gallery_ingest_reservation",
  "new_token::text || '.' || extension",
  "storage_path = new_path",
  "reservation.state in ('uploaded', 'ready')",
  "storage_object_matches",
  "object_row.user_metadata ->> 'sourceSha256'",
  "object_row.user_metadata ->> 'validatorVersion'",
  "reservation.state = 'ready'",
  "'outcome', 'tombstoned'",
  "gallery_ingest_finalize_conflict",
  "to service_role",
].forEach((snippet) => assertIncludes("reservation migration", reservationMigration, snippet));
assertNotMatches(
  "reservation migration",
  reservationMigration,
  /create table public\./i,
  "reservation state must remain outside public Data API tables.",
);

[
  "Users can update their own pending submission metadata",
  "submission_source = 'website'",
  "name not like ((select auth.uid())::text || '/discord-ingest/%')",
  "p_object_name not like (p_user_id::text || '/discord-ingest/%')",
  "Members update own pending gallery originals",
  "Members delete own pending or orphaned gallery originals",
  "revoke all on function public.gallery_commit_moderation",
  "create or replace function public.gallery_commit_moderation_checked",
  "request_role is distinct from 'service_role'",
  "state = 'ready'",
  "object_row.id is distinct from reservation.storage_object_id",
  "object_row.version is distinct from reservation.storage_object_version",
  "source_object_changed",
].forEach((snippet) => assertIncludes("Discord original hardening migration", hardeningMigration, snippet));

[
  "submission_source,source_sha256",
  '"gallery_commit_moderation_checked"',
  "p_expected_source_sha256",
].forEach((snippet) => assertIncludes("Gallery moderation receiver", moderator, snippet));

[
  "private Discord Gallery ingest reservation table exists",
  "pinned local Storage schema exposes typed user metadata and object version",
  "acquire guard rejects an absent claim as a non-superuser",
  "set local role authenticated",
  "finalize rejects a uint64 overflow identifier",
  "storage rejects non-canonical Discord identifiers",
  "reservation binds HMAC body metadata across retries",
  "mismatched Storage digest metadata",
  "object version changed after confirmation",
  "ready duplicate disclosure requires full metadata identity",
  "ready duplicate disclosure rechecks exact Storage object identity",
  "lost-response finalization rechecks exact Storage object identity",
  "application row vanished is not resurrected",
  "failed finalization leaves a recoverable uploaded reservation",
  "takeover rotates to a fresh path before a successor can upload",
  "expired writer cannot rebind the finalized successor after its late upsert",
  "late predecessor write leaves the ready generation identity and version unchanged",
  "authenticated member cannot create inside the service reservation namespace",
  "authenticated member cannot overwrite a Discord original",
  "authenticated member cannot delete a Discord original",
  "moderation commits only after digest, reservation, and object CAS match",
].forEach((snippet) => assertIncludes("reservation database tests", reservationDatabaseTest, snippet));

if (contractText) {
  const contractBytes = Buffer.from(contractText, "utf8");
  const digest = createHash("sha256").update(contractBytes).digest("hex");
  if (digest !== expectedContractSha256) {
    failures.push(`wire contract: expected SHA-256 ${expectedContractSha256}, received ${digest}.`);
  }
  if (contractBytes.length !== 2227 || !contractText.endsWith("\n")) {
    failures.push("wire contract: expected exactly 2,227 UTF-8 bytes with final LF.");
  }
  try {
    const contract = JSON.parse(contractText);
    if (
      contract.contractId !== "discord-gallery-ingest-hmac.v1" ||
      contract.signerOwner !== "Mochirii-Wushu/Reaper-Discord-Bot" ||
      contract.verifierOwner !== "Mochirii-Wushu/Mochirii-Website" ||
      contract.wire?.pathSemantics?.verifierValue !==
        "runtime-normalized-whatwg-url-pathname" ||
      contract.wire?.pathSemantics?.rawRequestTargetBound !== false ||
      contract.wire?.bodySemantics?.digestInput !==
        "exact-bounded-request-body-bytes" ||
      contract.wire?.bodySemantics?.decodeOrNormalizeBeforeDigest !== false ||
      contract.wire?.bodySemantics?.utf8BomAccepted !== false ||
      contract.ownershipBoundary?.reaperContainsSignerAndActiveKeySelection !== true ||
      contract.ownershipBoundary?.websiteRetainsVerifierAndNonceStore !== true
    ) failures.push("wire contract: repository ownership fields drifted.");
  } catch {
    failures.push("wire contract: invalid JSON.");
  }
}

if (authorizationContextContractText) {
  const contractBytes = Buffer.from(authorizationContextContractText, "utf8");
  const digest = createHash("sha256")
    .update(contractBytes)
    .digest("hex");
  if (digest !== expectedAuthorizationContextContractSha256) {
    failures.push(
      `authorization-context contract: expected SHA-256 ${expectedAuthorizationContextContractSha256}, received ${digest}.`,
    );
  }
  if (
    contractBytes.length !== 8451 ||
    !authorizationContextContractText.endsWith("\n")
  ) {
    failures.push("authorization-context contract: expected exactly 8,451 UTF-8 bytes with final LF.");
  }
  try {
    const contract = JSON.parse(authorizationContextContractText);
    if (
      contract.contractId !== "discord-gallery-authorization-context.v1" ||
      contract.producerOwner !== "Mochirii-Wushu/Reaper-Discord-Bot" ||
      contract.consumerOwner !== "Mochirii-Wushu/Mochirii-Website" ||
      contract.canonicalization?.requiredRoleCount !== 2 ||
      contract.canonicalization?.requiredRoleMatch !== "all" ||
      contract.syntheticVector?.canonicalUtf8ByteCount !== 213 ||
      contract.syntheticVector?.sha256 !==
        "af0e2e6f1bcc2f15633ed33fc8947684c0f86abf50fa82d51c7f849bd72450d2" ||
      contract.sortDistinguishingVector?.canonicalUtf8ByteCount !== 214 ||
      contract.sortDistinguishingVector?.sha256 !==
        "70e0d0f32e819025ab8b35831e2ccd53fc2d6a95599141d4fd7761a6d79fdbab" ||
      contract.sortDistinguishingVector?.wrongNumericOrderSha256 !==
        "dfbe607461ff52ce4484eb4ad13535243c18d41460f109ec884e6c3d01847c6f" ||
      contract.negativeVectors?.length !== 13
    ) failures.push("authorization-context contract: ownership or canonical vector drifted.");
  } catch {
    failures.push("authorization-context contract: invalid JSON.");
  }
}

[
  "source-only candidate",
  "af3025221626aadd2d0fc82fd79bb02b3f253ccdd8753fb78082aa885c929e3f",
  "db5ab92c20df4e59957979750e2ba6d3484f6112eb0ad87787bdf1d5be8d237c",
  "strict HMAC-only",
  "raw HTTP request target",
  "U+FEFF anywhere",
  "semantically equivalent JSON `\\uFEFF` escape",
  "reject U+FEFF before signing",
  "were revoked during review",
  "6547fb8e06e792e59d810ab97de9609f3e0ccbf6",
  "28144a28fa540ed6d93cd5d103c566049c9589d3",
  "f7a9c927001931423af8beef57113d66f2257a63",
  "expired-lease takeover atomically rotates the reservation to a fresh path",
  "cannot overwrite",
  "successor's ready object",
  "persist after a successful retry",
  "require a future reviewed retention",
  "does not claim that every failure",
  "does not strip JPEG EXIF/APP",
  "no atomic per-member/window business rate limit",
  "public feed v1",
  "storage.objects.id uuid",
  "brief fail-closed ingest",
  "bounded transition mode",
  "provider readback",
  "No deployment is authorized",
].forEach((snippet) => assertIncludes("activation runbook", activation, snippet));

[
  "strict HMAC-only `submit-discord-gallery-image` replacement",
  "terminal replacement signer belongs to `Mochirii-Wushu/Reaper-Discord-Bot`",
  "No legacy shared-secret fallback is present.",
  "private resumable reservation",
  "not metadata-sanitized",
  "provider readback",
].forEach((snippet) => assertIncludes("Supabase Gallery documentation", supabaseReadme, snippet));

if (failures.length) {
  console.error("Discord gallery ingest validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Discord gallery ingest validation OK (Website verifier-only contract).");
