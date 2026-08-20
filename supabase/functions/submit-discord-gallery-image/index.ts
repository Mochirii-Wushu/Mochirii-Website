import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  authenticateDiscordGalleryIngestBody,
  DISCORD_GALLERY_INGEST_HEADERS,
  DISCORD_GALLERY_INGEST_HMAC_KEYS_ENV,
  exactDiscordGalleryIngestPath,
  exactDiscordGallerySupabaseOrigin,
  parseDiscordGalleryIngestHmacKeys,
  parseDiscordGalleryIngestJsonRecord,
  readDiscordGalleryIngestBody,
} from "../_shared/discord-gallery-ingest-auth.ts";
import {
  canonicalDiscordSnowflake,
  discordGalleryAuthorizationContextMatches,
} from "../_shared/discord-gallery-authorization-context.ts";
import { parseDiscordGalleryIngestPayload } from "../_shared/discord-gallery-ingest-payload.ts";
import {
  downloadAllowlistedAttachment,
  galleryDiscordIngestErrorCode,
  validDiscordGalleryAttachmentUrl,
} from "../_shared/gallery-discord-ingest.ts";
import { decodeGallerySourceImage } from "../_shared/gallery-source-decode.ts";
import {
  parseDiscordGalleryReservationAcquisition,
  parseDiscordGalleryReservationFinalization,
  parseDiscordGalleryUploadConfirmation,
} from "../_shared/discord-gallery-storage-reservation.ts";
import {
  GALLERY_SOURCE_IMAGE_MAX_BYTES,
  GALLERY_SOURCE_IMAGE_VALIDATOR_VERSION,
  validateGallerySourceBytes,
} from "../_shared/gallery-source-image.ts";
import { getServiceRoleKey } from "../_shared/supabase-service-role.ts";

type JsonRecord = Record<string, unknown>;

const CORS_OPTIONS = {
  allowedHeaders:
    `content-type, ${DISCORD_GALLERY_INGEST_HEADERS.keyId}, ${DISCORD_GALLERY_INGEST_HEADERS.timestamp}, ${DISCORD_GALLERY_INGEST_HEADERS.nonce}, ${DISCORD_GALLERY_INGEST_HEADERS.signature}`,
  allowedMethods: "POST, OPTIONS",
};

const MEMBER_GALLERY_BUCKET = "member-gallery";
const MAX_SIZE_BYTES = GALLERY_SOURCE_IMAGE_MAX_BYTES;
const ATTACHMENT_TIMEOUT_MS = 15_000;
const DISCORD_REQUIRED_ROLE_COUNT = 2;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const RECENT_VERIFICATION_MS = 7 * 24 * 60 * 60 * 1000;

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
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
    ? value.filter((item): item is string =>
      typeof item === "string" && item.length > 0
    )
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
    .filter(Boolean);
}

function configuredSnowflakeList(
  value: string | null | undefined,
): string[] | null {
  const values = parseCsv(value);
  if (
    values.length !== DISCORD_REQUIRED_ROLE_COUNT ||
    new Set(values).size !== values.length ||
    values.some((value) => !canonicalDiscordSnowflake(value))
  ) return null;
  return values;
}

function normalizedMime(value: unknown): string | null {
  const mime = safeString(value, 80)?.split(";")[0]?.trim().toLowerCase() ||
    null;
  return mime && ALLOWED_MIME_TYPES.has(mime) ? mime : null;
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

Deno.serve((req: Request) =>
  withProtectedCors(req, handleRequest(req), CORS_OPTIONS)
);

async function handleRequest(req: Request): Promise<Response> {
  const requestPath = exactDiscordGalleryIngestPath(req.url);
  if (!requestPath) {
    return jsonResponse({
      ok: false,
      error: "not_found",
      message: "Not found.",
    }, 404);
  }

  if (req.method === "OPTIONS") {
    return new Response("ok");
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const supabaseUrl = exactDiscordGallerySupabaseOrigin(
    Deno.env.get("SUPABASE_URL"),
  );
  const serviceRoleKey = getServiceRoleKey();
  const ingestKeys = parseDiscordGalleryIngestHmacKeys(
    Deno.env.get(DISCORD_GALLERY_INGEST_HMAC_KEYS_ENV),
  );
  const configuredGuildId = canonicalDiscordSnowflake(
    Deno.env.get("DISCORD_GUILD_ID"),
  );
  const configuredChannelId = canonicalDiscordSnowflake(
    Deno.env.get("DISCORD_GALLERY_CHANNEL_ID"),
  );
  const configuredRequiredRoleIds = configuredSnowflakeList(
    Deno.env.get("DISCORD_REQUIRED_ROLE_IDS"),
  );

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !ingestKeys ||
    !configuredGuildId ||
    !configuredChannelId ||
    !configuredRequiredRoleIds
  ) {
    console.error(
      "submit-discord-gallery-image missing required server configuration",
      {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(serviceRoleKey),
        hasIngestHmacKeys: Boolean(ingestKeys),
        hasValidGuildId: Boolean(configuredGuildId),
        hasValidGalleryChannelId: Boolean(configuredChannelId),
        hasValidRequiredRoleIds: Boolean(configuredRequiredRoleIds),
        configuredRoleCount: configuredRequiredRoleIds?.length || 0,
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

  const bodyRead = await readDiscordGalleryIngestBody(req);
  if (!bodyRead.ok) {
    return jsonResponse(
      {
        ok: false,
        error: bodyRead.error,
        message: bodyRead.status === 413
          ? "Discord gallery submission metadata was too large."
          : "Discord gallery submission metadata could not be read.",
      },
      bodyRead.status,
    );
  }
  const { rawBodyBytes } = bodyRead;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const authentication = await authenticateDiscordGalleryIngestBody(
    req.headers,
    rawBodyBytes,
    {
      keys: ingestKeys,
      method: req.method,
      path: requestPath,
      consumeNonce: async (keyId, nonce, expiresAt) => {
        const { data, error } = await adminClient.rpc(
          "consume_discord_gallery_ingest_nonce",
          {
            p_key_id: keyId,
            p_nonce: nonce,
            p_expires_at: expiresAt,
          },
        );
        if (error) {
          console.error(
            "submit-discord-gallery-image nonce consumption failed",
            {
              failure: "nonce_store_unavailable",
            },
          );
          throw new Error("gallery_ingest_nonce_unavailable");
        }
        return data === true;
      },
    },
  );
  if (!authentication.ok) {
    return jsonResponse(
      {
        ok: false,
        error: authentication.error,
        message: authentication.status === 400
          ? "Discord gallery submission metadata could not be read."
          : "Discord gallery submissions could not be authenticated.",
      },
      authentication.status,
    );
  }

  const body = parseDiscordGalleryIngestJsonRecord(authentication.bodyText);
  const payload = body ? parseDiscordGalleryIngestPayload(body) : null;
  if (!body || !payload) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json",
        message: "Request body must be valid JSON.",
      },
      400,
    );
  }

  if (
    !await discordGalleryAuthorizationContextMatches(body, {
      guildId: configuredGuildId,
      galleryChannelId: configuredChannelId,
      requiredRoleIds: configuredRequiredRoleIds,
    })
  ) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_authorization_context",
        message: "Discord gallery authorization context was invalid.",
      },
      401,
    );
  }

  const {
    attachmentId,
    attachmentUrl,
    caption,
    channelId,
    discordUserId,
    guildId,
    instagramOptIn,
    messageId,
    mimeType: declaredMime,
    originalFilename,
    sizeBytes: declaredSize,
    title,
  } = payload;

  if (
    guildId !== configuredGuildId ||
    channelId !== configuredChannelId
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

  const { data: profileData, error: profileError } = await adminClient
    .from("member_profiles")
    .select(
      "id,discord_user_id,discord_roles,has_required_discord_roles,discord_verified_at,member_status",
    )
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (profileError) {
    console.error("submit-discord-gallery-image profile lookup failed", {
      failure: "profile_lookup_failed",
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
  const missingStoredRoleIds = configuredRequiredRoleIds.filter((roleId) =>
    !storedRoleSet.has(roleId)
  );

  if (
    !userId || !UUID_RE.test(userId) ||
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
        missingRoleCount: missingStoredRoleIds.length,
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
      isAllowedUrl: (value) =>
        validDiscordGalleryAttachmentUrl(value, channelId, attachmentId),
      maximumBytes: MAX_SIZE_BYTES,
      timeoutMs: ATTACHMENT_TIMEOUT_MS,
      maximumRedirects: 3,
      headers: {
        Accept: [...ALLOWED_MIME_TYPES].join(", "),
        "User-Agent": "Mochirii-Reaper-Gallery-Ingest/1.0",
      },
    });
  } catch (error) {
    const errorCode = galleryDiscordIngestErrorCode(error);
    console.error("submit-discord-gallery-image attachment fetch failed", {
      code: errorCode,
    });

    return jsonResponse(
      {
        ok: false,
        error: errorCode,
        message: errorCode === "attachment_too_large"
          ? "Gallery images must be 8 MB or smaller."
          : "Discord attachment could not be downloaded.",
      },
      errorCode === "attachment_too_large" ? 413 : 502,
    );
  }

  const bytes = attachmentDownload.bytes;
  const responseMime = normalizedMime(attachmentDownload.contentType);
  const sourceValidation = await validateGallerySourceBytes(
    bytes,
    declaredMime,
  );
  if (
    !responseMime || responseMime !== declaredMime ||
    declaredSize !== bytes.byteLength || !sourceValidation.ok
  ) {
    const validationError = sourceValidation.ok
      ? "source_image_metadata_mismatch"
      : sourceValidation.error;
    console.error("submit-discord-gallery-image invalid attachment content", {
      validationError,
      hasCanonicalResponseMime: Boolean(responseMime),
      declaredMimeMatchesResponse: responseMime === declaredMime,
      declaredSizeMatchesDownload: declaredSize === bytes.byteLength,
    });

    return jsonResponse(
      {
        ok: false,
        error: validationError === "source_image_webp_dimensions_unsupported"
          ? "unsupported_webp_dimensions"
          : "invalid_attachment_content",
        message:
          "That image did not match the bounded JPEG, PNG, or WebP submission contract.",
      },
      400,
    );
  }

  const sourceMime = sourceValidation.source.mimeType;
  const fullDecode = await decodeGallerySourceImage(
    bytes,
    sourceMime,
    sourceValidation.source.width,
    sourceValidation.source.height,
  );
  if (!fullDecode.ok) {
    console.error("submit-discord-gallery-image full decode failed", {
      code: fullDecode.error,
      mimeType: sourceMime,
    });
    return jsonResponse(
      {
        ok: false,
        error: fullDecode.error === "source_image_webp_decode_unsupported"
          ? "unsupported_webp_dimensions"
          : "invalid_attachment_content",
        message:
          "That image did not match the bounded JPEG, PNG, or WebP submission contract.",
      },
      400,
    );
  }

  const { data: reservationData, error: reservationError } = await adminClient
    .rpc(
      "acquire_discord_gallery_ingest_reservation",
      {
        p_user_id: userId,
        p_guild_id: guildId,
        p_channel_id: channelId,
        p_message_id: messageId,
        p_attachment_id: attachmentId,
        p_discord_user_id: discordUserId,
        p_source_sha256: sourceValidation.source.sha256,
        p_mime_type: sourceMime,
        p_size_bytes: bytes.byteLength,
        p_original_filename: originalFilename,
        p_title: title,
        p_caption: caption,
        p_instagram_opt_in: instagramOptIn,
      },
    );
  const reservation = reservationError
    ? null
    : parseDiscordGalleryReservationAcquisition(
      reservationData,
      userId,
      sourceMime,
    );

  if (reservation?.outcome === "ready") {
    return jsonResponse({
      ok: true,
      duplicate: true,
      data: {
        submissionId: reservation.submissionId,
        status: reservation.status,
        createdAt: reservation.createdAt,
      },
      message: "That Discord image is already in the moderation queue.",
    });
  }

  if (!reservation || reservation.outcome !== "acquired") {
    console.error("submit-discord-gallery-image reservation failed", {
      failure: reservationError
        ? "reservation_store_unavailable"
        : "reservation_not_acquired",
      outcome: reservation?.outcome || "invalid_response",
    });
    return jsonResponse(
      {
        ok: false,
        error: "submission_reservation_unavailable",
        message: "Gallery submission could not be queued.",
      },
      reservation?.outcome === "busy" ? 409 : 503,
    );
  }

  const storagePath = reservation.storagePath;

  const { error: uploadError } = await adminClient.storage
    .from(MEMBER_GALLERY_BUCKET)
    .upload(storagePath, bytes, {
      contentType: sourceMime,
      upsert: true,
      metadata: {
        sourceSha256: sourceValidation.source.sha256,
        validatorVersion: GALLERY_SOURCE_IMAGE_VALIDATOR_VERSION,
      },
    });

  if (uploadError) {
    console.error("submit-discord-gallery-image storage upload failed", {
      failure: "storage_upload_failed",
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

  const { data: confirmationData, error: confirmationError } = await adminClient
    .rpc(
      "confirm_discord_gallery_ingest_upload",
      {
        p_message_id: messageId,
        p_attachment_id: attachmentId,
        p_lease_token: reservation.leaseToken,
      },
    );
  const confirmation = confirmationError
    ? null
    : parseDiscordGalleryUploadConfirmation(confirmationData);
  if (!confirmation || confirmation.outcome !== "confirmed") {
    console.error("submit-discord-gallery-image upload confirmation failed", {
      failure: confirmationError
        ? "upload_confirmation_unavailable"
        : "upload_confirmation_rejected",
      outcome: confirmation?.outcome || "invalid_response",
    });
    return jsonResponse(
      {
        ok: false,
        error: "upload_confirmation_failed",
        message: "Gallery image could not be stored.",
      },
      503,
    );
  }

  const { data: finalizationData, error: finalizationError } = await adminClient
    .rpc(
      "finalize_discord_gallery_ingest_reservation",
      {
        p_message_id: messageId,
        p_attachment_id: attachmentId,
        p_lease_token: reservation.leaseToken,
      },
    );
  const finalization = finalizationError
    ? null
    : parseDiscordGalleryReservationFinalization(finalizationData);
  if (
    !finalization ||
    (finalization.outcome !== "created" && finalization.outcome !== "ready")
  ) {
    console.error(
      "submit-discord-gallery-image reservation finalization failed",
      {
        failure: finalizationError
          ? "reservation_finalization_unavailable"
          : "reservation_finalization_rejected",
        outcome: finalization?.outcome || "invalid_response",
      },
    );
    return jsonResponse(
      {
        ok: false,
        error: "submission_finalize_failed",
        message: "Gallery submission could not be queued.",
      },
      503,
    );
  }

  return jsonResponse({
    ok: true,
    duplicate: finalization.outcome === "ready",
    data: {
      submissionId: finalization.submissionId,
      status: finalization.status,
      createdAt: finalization.createdAt,
    },
    message: finalization.outcome === "ready"
      ? "That Discord image is already in the moderation queue."
      : "Image submitted to the pending gallery queue for moderator approval.",
  });
}
