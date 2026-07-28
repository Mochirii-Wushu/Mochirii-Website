import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { getServiceRoleKey } from "../_shared/supabase-service-role.ts";
import { validateGallerySourceBytes } from "../_shared/gallery-source-image.ts";
import {
  constantTimeSecretEquals,
  downloadAllowlistedAttachment,
  GalleryDiscordIngestError,
  readBoundedJsonRecord,
} from "../_shared/gallery-discord-ingest.ts";

type JsonRecord = Record<string, unknown>;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-mochirii-reaper-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MEMBER_GALLERY_BUCKET = "member-gallery";
const MAX_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const ATTACHMENT_TIMEOUT_MS = 15_000;
const EXPECTED_DISCORD_GUILD_ID = "1078630751077142608";
const EXPECTED_REQUIRED_ROLE_IDS = [
  "1468659807736299520",
  "1078630751077142615",
];
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DISCORD_CDN_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
  "media.discordapp.com",
]);
const RECENT_VERIFICATION_MS = 7 * 24 * 60 * 60 * 1000;
const INSTAGRAM_OPT_IN_COPY_VERSION = "2026-06-discord-submit-v1";

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function safeString(value: unknown, maxLength: number): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function parseCsv(value: string | null | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function booleanTrue(value: unknown): boolean {
  return value === true;
}

function snowflake(value: unknown): string | null {
  const id = safeString(value, 24);
  return id && /^\d{16,22}$/.test(id) ? id : null;
}

function normalizedMime(value: unknown): string | null {
  const mime = safeString(value, 80)?.split(";")[0]?.trim().toLowerCase() ||
    null;
  if (mime === "image/jpg") return "image/jpeg";
  return mime && ALLOWED_MIME_TYPES.has(mime) ? mime : null;
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  return "webp";
}

function filenameFromInput(
  value: unknown,
  mime: string,
  attachmentId: string,
): string {
  const fallback = `discord-${attachmentId}.${extensionForMime(mime)}`;
  const raw = safeString(value, 255) || fallback;
  const basename = raw.split(/[\\/]/).pop() || fallback;
  const clean = basename
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);
  const withName = clean || fallback;
  return /\.[a-z0-9]{2,5}$/i.test(withName)
    ? withName
    : `${withName}.${extensionForMime(mime)}`;
}

function validAttachmentUrl(value: unknown): string | null {
  const text = safeString(value, 4096);
  if (!text) return null;

  try {
    const url = new URL(text);
    const hasAttachmentPath = url.pathname.includes("/attachments/") ||
      url.pathname.includes("/ephemeral-attachments/");
    if (
      url.protocol !== "https:" || !DISCORD_CDN_HOSTS.has(url.hostname) ||
      !hasAttachmentPath
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function expectedRoleConfigMatches(configuredRoleIds: string[]): boolean {
  return (
    configuredRoleIds.length === EXPECTED_REQUIRED_ROLE_IDS.length &&
    EXPECTED_REQUIRED_ROLE_IDS.every((roleId) =>
      configuredRoleIds.includes(roleId)
    )
  );
}

function verificationIsRecent(value: unknown): boolean {
  const verifiedAt = safeString(value, 80);
  if (!verifiedAt) return false;

  const timestamp = Date.parse(verifiedAt);
  if (!Number.isFinite(timestamp)) return false;

  const now = Date.now();
  return timestamp <= now + 5 * 60 * 1000 &&
    now - timestamp <= RECENT_VERIFICATION_MS;
}

function bearerOrHeaderSecret(req: Request): string {
  const headerSecret = req.headers.get("x-mochirii-reaper-secret") || "";
  if (headerSecret) return headerSecret.trim();

  const authHeader = req.headers.get("authorization") || "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

Deno.serve((req: Request) => withProtectedCors(req, handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = getServiceRoleKey();
  const ingestSecret = Deno.env.get("DISCORD_GALLERY_INGEST_SECRET") || "";
  const configuredGuildId = Deno.env.get("DISCORD_GUILD_ID") || "";
  const configuredChannelId = Deno.env.get("DISCORD_GALLERY_CHANNEL_ID") || "";
  const configuredRequiredRoleIds = parseCsv(
    Deno.env.get("DISCORD_REQUIRED_ROLE_IDS"),
  );
  const guildConfigMatches = configuredGuildId === EXPECTED_DISCORD_GUILD_ID;
  const roleConfigMatches = expectedRoleConfigMatches(
    configuredRequiredRoleIds,
  );

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !ingestSecret ||
    !configuredGuildId ||
    !configuredChannelId ||
    !guildConfigMatches ||
    !roleConfigMatches
  ) {
    console.error(
      "submit-discord-gallery-image missing required server configuration",
      {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(serviceRoleKey),
        hasIngestSecret: Boolean(ingestSecret),
        hasGuildId: Boolean(configuredGuildId),
        hasGalleryChannelId: Boolean(configuredChannelId),
        guildConfigMatches,
        roleConfigMatches,
        configuredRoleCount: configuredRequiredRoleIds.length,
      },
    );

    return jsonResponse(
      {
        ok: false,
        error: "discord_gallery_ingest_not_configured",
        message: "Discord gallery submissions are not configured yet.",
      },
      500,
    );
  }

  if (!await constantTimeSecretEquals(bearerOrHeaderSecret(req), ingestSecret)) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_ingest_secret",
        message: "Discord gallery submissions could not be authenticated.",
      },
      401,
    );
  }

  const body = await readBoundedJsonRecord(req, MAX_REQUEST_BODY_BYTES);
  if (!body) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json",
        message: "Request body must be valid JSON.",
      },
      400,
    );
  }

  const guildId = snowflake(body.guildId);
  const channelId = snowflake(body.channelId);
  const messageId = snowflake(body.messageId);
  const attachmentId = snowflake(body.attachmentId);
  const discordUserId = snowflake(body.discordUserId);
  const attachmentUrl = validAttachmentUrl(body.attachmentUrl);
  const declaredMime = normalizedMime(body.mimeType);
  const declaredSize = Number(body.sizeBytes || 0);
  const title = safeString(body.title, 80);
  const caption = safeString(body.caption, 300);
  const instagramOptIn = booleanTrue(body.instagramOptIn);

  if (
    guildId !== EXPECTED_DISCORD_GUILD_ID ||
    channelId !== configuredChannelId ||
    !messageId ||
    !attachmentId ||
    !discordUserId ||
    !attachmentUrl ||
    !Number.isFinite(declaredSize) ||
    declaredSize <= 0 ||
    declaredSize > MAX_SIZE_BYTES
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_discord_submission",
        message: "Discord submission metadata was invalid.",
      },
      400,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: existingSubmission, error: existingError } = await adminClient
    .from("gallery_submissions")
    .select("id,status,created_at")
    .eq("submission_source", "discord")
    .eq("discord_message_id", messageId)
    .eq("discord_attachment_id", attachmentId)
    .maybeSingle();

  if (existingError) {
    console.error("submit-discord-gallery-image duplicate lookup failed", {
      code: existingError.code,
      message: existingError.message,
    });

    return jsonResponse(
      {
        ok: false,
        error: "duplicate_lookup_failed",
        message: "Gallery submission could not be checked.",
      },
      500,
    );
  }

  if (existingSubmission) {
    const existing = asRecord(existingSubmission);
    return jsonResponse({
      ok: true,
      duplicate: true,
      data: {
        submissionId: safeString(existing.id, 80),
        status: safeString(existing.status, 40),
        createdAt: safeString(existing.created_at, 80),
      },
      message: "That Discord image is already in the moderation queue.",
    });
  }

  const { data: profileData, error: profileError } = await adminClient
    .from("member_profiles")
    .select(
      "id,discord_user_id,discord_roles,has_required_discord_roles,discord_verified_at,member_status",
    )
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (profileError) {
    console.error("submit-discord-gallery-image profile lookup failed", {
      code: profileError.code,
      message: profileError.message,
    });

    return jsonResponse(
      {
        ok: false,
        error: "profile_lookup_failed",
        message: "Mochirii account status could not be checked.",
      },
      500,
    );
  }

  const profile = asRecord(profileData);
  const userId = safeString(profile.id, 80);
  const memberStatus = safeString(profile.member_status, 40) || "pending";
  const storedRoleSet = new Set(asStringArray(profile.discord_roles));
  const missingStoredRoleIds = EXPECTED_REQUIRED_ROLE_IDS.filter((roleId) =>
    !storedRoleSet.has(roleId)
  );

  if (
    !userId ||
    memberStatus !== "active" ||
    profile.has_required_discord_roles !== true ||
    !verificationIsRecent(profile.discord_verified_at) ||
    missingStoredRoleIds.length > 0
  ) {
    return jsonResponse(
      {
        ok: false,
        error: !userId
          ? "discord_account_not_linked"
          : "discord_gallery_not_eligible",
        missingRoleIds: missingStoredRoleIds,
        message: !userId
          ? "Link your Mochirii website account with Discord before submitting gallery images."
          : "Refresh Discord verification on mochirii.com/account before submitting gallery images.",
      },
      403,
    );
  }

  let attachmentDownload: Awaited<
    ReturnType<typeof downloadAllowlistedAttachment>
  >;
  try {
    attachmentDownload = await downloadAllowlistedAttachment({
      initialUrl: attachmentUrl,
      isAllowedUrl: validAttachmentUrl,
      maximumBytes: MAX_SIZE_BYTES,
      timeoutMs: ATTACHMENT_TIMEOUT_MS,
      headers: {
        Accept: [...ALLOWED_MIME_TYPES].join(", "),
        "User-Agent": "Mochirii-Reaper-Gallery-Ingest/1.0",
      },
    });
  } catch (error) {
    console.error("submit-discord-gallery-image attachment fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });

    const tooLarge = error instanceof GalleryDiscordIngestError &&
      error.code === "attachment_too_large";
    return jsonResponse(
      {
        ok: false,
        error: tooLarge ? "attachment_too_large" : "attachment_fetch_failed",
        message: tooLarge
          ? "Gallery images must be 8 MB or smaller."
          : "Discord attachment could not be downloaded.",
      },
      tooLarge ? 413 : 502,
    );
  }
  const bytes = attachmentDownload.bytes;
  const contentLength = bytes.byteLength;
  const responseMime = normalizedMime(attachmentDownload.contentType);
  const sourceValidation = await validateGallerySourceBytes(bytes);
  const sniffedMime = sourceValidation.ok
    ? sourceValidation.source.mimeType
    : null;

  if (
    bytes.byteLength <= 0 || bytes.byteLength > MAX_SIZE_BYTES ||
    !sourceValidation.ok || !sniffedMime
  ) {
    console.error("submit-discord-gallery-image invalid attachment content", {
      declaredMime,
      responseMime,
      sniffedMime,
      declaredSize,
      contentLength,
      downloadedSize: bytes.byteLength,
      validationError: sourceValidation.ok ? null : sourceValidation.error,
    });

    return jsonResponse(
      {
        ok: false,
        error: "invalid_attachment_content",
        message:
          "That file could not be read as a JPEG, PNG, or WebP image. Please re-upload the original image file under 8 MB.",
      },
      400,
    );
  }

  const originalFilename = safeString(body.originalFilename, 255) ||
    `discord-${attachmentId}.${extensionForMime(sniffedMime)}`;
  const storageFilename = filenameFromInput(
    originalFilename,
    sniffedMime,
    attachmentId,
  );
  const storagePath =
    `${userId}/discord/${messageId}-${attachmentId}-${storageFilename}`;

  const { error: uploadError } = await adminClient.storage
    .from(MEMBER_GALLERY_BUCKET)
    .upload(storagePath, bytes, {
      contentType: sniffedMime,
      upsert: false,
    });

  if (uploadError) {
    const { data: duplicateAfterUpload } = await adminClient
      .from("gallery_submissions")
      .select("id,status,created_at")
      .eq("submission_source", "discord")
      .eq("discord_message_id", messageId)
      .eq("discord_attachment_id", attachmentId)
      .maybeSingle();

    if (duplicateAfterUpload) {
      const existing = asRecord(duplicateAfterUpload);
      return jsonResponse({
        ok: true,
        duplicate: true,
        data: {
          submissionId: safeString(existing.id, 80),
          status: safeString(existing.status, 40),
          createdAt: safeString(existing.created_at, 80),
        },
        message: "That Discord image is already in the moderation queue.",
      });
    }

    console.error("submit-discord-gallery-image storage upload failed", {
      message: uploadError.message,
    });

    return jsonResponse(
      {
        ok: false,
        error: "storage_upload_failed",
        message: "Gallery image could not be stored.",
      },
      500,
    );
  }

  const { data: insertedData, error: insertError } = await adminClient
    .from("gallery_submissions")
    .insert({
      user_id: userId,
      storage_bucket: MEMBER_GALLERY_BUCKET,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: sniffedMime,
      size_bytes: bytes.byteLength,
      title,
      caption,
      category: null,
      status: "pending",
      submission_source: "discord",
      discord_guild_id: guildId,
      discord_channel_id: channelId,
      discord_message_id: messageId,
      discord_attachment_id: attachmentId,
      discord_user_id: discordUserId,
      instagram_opt_in: instagramOptIn,
      instagram_opt_in_at: instagramOptIn ? new Date().toISOString() : null,
      instagram_opt_in_source: instagramOptIn ? "discord_slash_command" : null,
      instagram_opt_in_copy_version: instagramOptIn
        ? INSTAGRAM_OPT_IN_COPY_VERSION
        : null,
    })
    .select("id,status,created_at")
    .maybeSingle();

  if (insertError || !insertedData) {
    await adminClient.storage.from(MEMBER_GALLERY_BUCKET).remove([storagePath]);

    console.error("submit-discord-gallery-image submission insert failed", {
      code: insertError?.code,
      message: insertError?.message || "Missing inserted row",
    });

    return jsonResponse(
      {
        ok: false,
        error: "submission_insert_failed",
        message: "Gallery submission could not be queued.",
      },
      500,
    );
  }

  const inserted = asRecord(insertedData);
  const insertedSubmissionId = safeString(inserted.id, 80);
  const { data: candidateData, error: candidateError } = insertedSubmissionId
    ? await adminClient.rpc("gallery_source_validation_candidate", {
      p_submission_id: insertedSubmissionId,
    })
    : { data: null, error: new Error("Missing inserted submission id") };
  const candidate = asRecord(candidateData);
  const { data: validationCommitData, error: validationCommitError } =
    insertedSubmissionId && sourceValidation.ok && candidate.ok === true
      ? await adminClient.rpc("gallery_commit_source_validation", {
        p_submission_id: insertedSubmissionId,
        p_expected_submission_updated_at: safeString(
          candidate.submission_updated_at,
          80,
        ),
        p_expected_storage_object_id: safeString(
          candidate.storage_object_id,
          80,
        ),
        p_expected_storage_object_version: safeString(
          candidate.storage_object_version,
          255,
        ),
        p_expected_storage_object_updated_at: safeString(
          candidate.storage_object_updated_at,
          80,
        ),
        p_source_mime_type: sourceValidation.source.mimeType,
        p_source_size_bytes: sourceValidation.source.sizeBytes,
        p_source_width: sourceValidation.source.width,
        p_source_height: sourceValidation.source.height,
        p_source_sha256: sourceValidation.source.sha256,
      })
      : { data: null, error: new Error("Missing source validation candidate") };
  const validationCommit = asRecord(validationCommitData);
  if (
    candidateError || validationCommitError ||
    validationCommit.committed !== true
  ) {
    if (insertedSubmissionId) {
      await adminClient.from("gallery_submissions").delete().eq(
        "id",
        insertedSubmissionId,
      );
    }
    await adminClient.storage.from(MEMBER_GALLERY_BUCKET).remove([storagePath]);
    console.error(
      "submit-discord-gallery-image source validation commit failed",
      {
        candidateCode: candidateError && "code" in candidateError
          ? String(candidateError.code)
          : null,
        commitCode: validationCommitError && "code" in validationCommitError
          ? String(validationCommitError.code)
          : null,
        reason: safeString(validationCommit.reason, 80),
      },
    );
    return jsonResponse(
      {
        ok: false,
        error: "source_validation_commit_failed",
        message: "Gallery image could not be queued safely.",
      },
      500,
    );
  }

  return jsonResponse({
    ok: true,
    duplicate: false,
    data: {
      submissionId: insertedSubmissionId,
      status: safeString(inserted.status, 40),
      createdAt: safeString(inserted.created_at, 80),
    },
    message:
      "Image submitted to the pending gallery queue for moderator approval.",
  });
}
