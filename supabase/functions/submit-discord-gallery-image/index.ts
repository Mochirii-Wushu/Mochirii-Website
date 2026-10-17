import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { getServiceRoleKey } from "../_shared/supabase-service-role.ts";
import { GALLERY_UUID, inspectGalleryInput, readBoundedGalleryBody } from "../../../packages/gallery-media/policy.ts";

type JsonRecord = Record<string, unknown>;
type IngestDependencies = {
  createClient?: typeof createClient;
  fetchImpl?: typeof fetch;
  config?: {
    supabaseUrl: string;
    serviceRoleKey: string;
    ingestSecret: string;
    guildId: string;
    channelId: string;
    requiredRoleIds: string[];
  };
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-mochirii-reaper-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MEMBER_GALLERY_BUCKET = "member-gallery";
const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const EXPECTED_DISCORD_GUILD_ID = "1078630751077142608";
const EXPECTED_REQUIRED_ROLE_IDS = ["1468659807736299520", "1078630751077142615"];
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net", "media.discordapp.com"]);
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
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
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
  const mime = safeString(value, 80)?.split(";")[0]?.trim().toLowerCase() || null;
  if (mime === "image/jpg") return "image/jpeg";
  return mime && ALLOWED_MIME_TYPES.has(mime) ? mime : null;
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  return "webp";
}

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function filenameFromInput(value: unknown, mime: string, attachmentId: string): string {
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
  return /\.[a-z0-9]{2,5}$/i.test(withName) ? withName : `${withName}.${extensionForMime(mime)}`;
}

function validAttachmentUrl(value: unknown): string | null {
  const text = safeString(value, 4096);
  if (!text) return null;

  try {
    const url = new URL(text);
    const hasAttachmentPath = /^\/(?:ephemeral-)?attachments\/\d{16,22}\/\d{16,22}\/[^/]+$/.test(url.pathname);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash
      || !DISCORD_CDN_HOSTS.has(url.hostname) || !hasAttachmentPath) {
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
    EXPECTED_REQUIRED_ROLE_IDS.every((roleId) => configuredRoleIds.includes(roleId))
  );
}

function verificationIsRecent(value: unknown): boolean {
  const verifiedAt = safeString(value, 80);
  if (!verifiedAt) return false;

  const timestamp = Date.parse(verifiedAt);
  if (!Number.isFinite(timestamp)) return false;

  const now = Date.now();
  return timestamp <= now + 5 * 60 * 1000 && now - timestamp <= RECENT_VERIFICATION_MS;
}

function bearerOrHeaderSecret(req: Request): string {
  const headerSecret = req.headers.get("x-mochirii-reaper-secret") || "";
  if (headerSecret) return headerSecret.trim();

  const authHeader = req.headers.get("authorization") || "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

async function readJsonBody(req: Request): Promise<JsonRecord | null> {
  try {
    return asRecord(await req.json());
  } catch {
    return null;
  }
}

if (import.meta.main) Deno.serve((req: Request) => withProtectedCors(req, handleRequest(req)));

export async function handleRequest(req: Request, dependencies: IngestDependencies = {}): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const supabaseUrl = dependencies.config?.supabaseUrl ?? Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = dependencies.config?.serviceRoleKey ?? getServiceRoleKey();
  const ingestSecret = dependencies.config?.ingestSecret ?? Deno.env.get("DISCORD_GALLERY_INGEST_SECRET") ?? "";
  const configuredGuildId = dependencies.config?.guildId ?? Deno.env.get("DISCORD_GUILD_ID") ?? "";
  const configuredChannelId = dependencies.config?.channelId ?? Deno.env.get("DISCORD_GALLERY_CHANNEL_ID") ?? "";
  const configuredRequiredRoleIds = dependencies.config?.requiredRoleIds ?? parseCsv(Deno.env.get("DISCORD_REQUIRED_ROLE_IDS"));
  const guildConfigMatches = configuredGuildId === EXPECTED_DISCORD_GUILD_ID;
  const roleConfigMatches = expectedRoleConfigMatches(configuredRequiredRoleIds);

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !ingestSecret ||
    !configuredGuildId ||
    !configuredChannelId ||
    !guildConfigMatches ||
    !roleConfigMatches
  ) {
    console.error("submit-discord-gallery-image missing required server configuration", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      hasIngestSecret: Boolean(ingestSecret),
      hasGuildId: Boolean(configuredGuildId),
      hasGalleryChannelId: Boolean(configuredChannelId),
      guildConfigMatches,
      roleConfigMatches,
      configuredRoleCount: configuredRequiredRoleIds.length,
    });

    return jsonResponse(
      {
        ok: false,
        error: "discord_gallery_ingest_not_configured",
        message: "Discord gallery submissions are not configured yet.",
      },
      500,
    );
  }

  if (bearerOrHeaderSecret(req) !== ingestSecret) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_ingest_secret",
        message: "Discord gallery submissions could not be authenticated.",
      },
      401,
    );
  }

  const body = await readJsonBody(req);
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
    !Number.isSafeInteger(declaredSize) ||
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

  const fetchImpl = dependencies.fetchImpl || fetch;
  const adminClient = (dependencies.createClient || createClient)(supabaseUrl, serviceRoleKey, {
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
    console.error("submit-discord-gallery-image duplicate lookup failed");

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
    .select("id,discord_user_id,discord_roles,has_required_discord_roles,discord_verified_at,member_status")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  if (profileError) {
    console.error("submit-discord-gallery-image profile lookup failed");

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
  const missingStoredRoleIds = EXPECTED_REQUIRED_ROLE_IDS.filter((roleId) => !storedRoleSet.has(roleId));

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
        error: !userId ? "discord_account_not_linked" : "discord_gallery_not_eligible",
        missingRoleIds: missingStoredRoleIds,
        message: !userId
          ? "Link your Mochirii website account with Discord before submitting gallery images."
          : "Refresh Discord verification on mochirii.com/account before submitting gallery images.",
      },
      403,
    );
  }

  let attachmentResponse: Response;
  try {
    attachmentResponse = await fetchImpl(attachmentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: [...ALLOWED_MIME_TYPES].join(", "),
        "User-Agent": "Mochirii-Reaper-Gallery-Ingest/1.0",
      },
    });
  } catch {
    console.error("submit-discord-gallery-image attachment fetch failed");

    return jsonResponse(
      {
        ok: false,
        error: "attachment_fetch_failed",
        message: "Discord attachment could not be downloaded.",
      },
      502,
    );
  }

  if (!attachmentResponse.ok || attachmentResponse.url !== attachmentUrl) {
    await attachmentResponse.body?.cancel().catch(() => {});
    console.error("submit-discord-gallery-image attachment fetch returned non-ok", {
      status: attachmentResponse.status,
    });

    return jsonResponse(
      {
        ok: false,
        error: "attachment_fetch_failed",
        message: "Discord attachment could not be downloaded.",
      },
      502,
    );
  }

  const contentLength = Number(attachmentResponse.headers.get("content-length") || 0);
  const responseMime = normalizedMime(attachmentResponse.headers.get("content-type"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SIZE_BYTES) {
    await attachmentResponse.body?.cancel().catch(() => {});
    return jsonResponse(
      {
        ok: false,
        error: "attachment_too_large",
        message: "Discord gallery images must be 50 MiB or smaller.",
      },
      413,
    );
  }

  let bytes: Uint8Array;
  let sniffedMime: string;
  try {
    bytes = await readBoundedGalleryBody(attachmentResponse, MAX_SIZE_BYTES);
    sniffedMime = inspectGalleryInput(bytes).mimeType;
    if (sniffMime(bytes) !== sniffedMime || bytes.length !== declaredSize) throw new Error("attachment_content_rejected");
  } catch {
    return jsonResponse({ ok: false, error: "invalid_attachment_content",
      message: "Choose a still JPEG, PNG, or WebP within the 50 MiB and image-dimension limits." }, 400);
  }

  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SIZE_BYTES || !sniffedMime) {
    console.error("submit-discord-gallery-image invalid attachment content", {
      declaredMime,
      responseMime,
      sniffedMime,
      declaredSize,
      contentLength,
      downloadedSize: bytes.byteLength,
    });

    return jsonResponse(
      {
        ok: false,
        error: "invalid_attachment_content",
        message: "That file could not be read as a JPEG, PNG, or WebP image. Please re-upload the original image file under 50 MB.",
      },
      400,
    );
  }

  const originalFilename = safeString(body.originalFilename, 255) || `discord-${attachmentId}.${extensionForMime(sniffedMime)}`;
  const storageFilename = filenameFromInput(originalFilename, sniffedMime, attachmentId);
  const storagePath = `${userId}/discord/${messageId}-${attachmentId}-${storageFilename}`;
  let reservationResult;
  try {
    reservationResult = await adminClient.rpc("gallery_reserve_discord_upload", {
      p_user_id: userId, p_storage_path: storagePath, p_size_bytes: bytes.length, p_mime_type: sniffedMime,
      p_discord_message_id: messageId, p_discord_attachment_id: attachmentId,
    });
  } catch {
    return jsonResponse({ ok: false, error: "upload_reservation_unconfirmed",
      message: "Upload access could not be confirmed. Retry with the same attachment." }, 503);
  }
  const reservation = asRecord(reservationResult.data);
  if (reservationResult.error || reservation.ok !== true || typeof reservation.upload_id !== "string"
    || !GALLERY_UUID.test(reservation.upload_id) || reservation.storage_path !== storagePath
    || !["reserved", "submitted"].includes(String(reservation.state))
    || (reservation.state === "submitted" && reservation.submission_id !== reservation.upload_id)) {
    const quotaCodes = new Set(["upload_daily_limit", "upload_pending_limit", "upload_storage_limit", "upload_project_limit"]);
    const code = typeof reservation.code === "string" && quotaCodes.has(reservation.code)
      ? reservation.code : "upload_reservation_rejected";
    return jsonResponse({ ok: false, error: code,
      message: quotaCodes.has(code) ? "Gallery upload capacity is reached. Wait for review or try another day."
        : "Upload access could not be confirmed. Retry with the same attachment." }, quotaCodes.has(code) ? 429 : 409);
  }

  let uploadError: unknown;
  if (reservation.state === "reserved") try {
    ({ error: uploadError } = await adminClient.storage
      .from(MEMBER_GALLERY_BUCKET)
      .upload(storagePath, bytes, {
        contentType: sniffedMime,
        upsert: false,
      }));
  } catch {
    uploadError = true;
  }

  if (uploadError) {
    let duplicateResult: { data: unknown; error: unknown };
    try {
      duplicateResult = await adminClient
        .from("gallery_submissions")
        .select("id,status,created_at")
        .eq("submission_source", "discord")
        .eq("discord_message_id", messageId)
        .eq("discord_attachment_id", attachmentId)
        .maybeSingle();
    } catch {
      duplicateResult = { data: null, error: true };
    }
    const { data: duplicateAfterUpload, error: duplicateAfterUploadError } = duplicateResult;

    if (!duplicateAfterUploadError && duplicateAfterUpload) {
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

    // A prior upload may be durable while its row insert rolled back. Adopt
    // only the exact original bytes, never an object identified by name alone.
    // An unreadable row/object or ambiguous response preserves everything.
    if (duplicateAfterUploadError || !await existingOriginalMatches(
      supabaseUrl, serviceRoleKey, storagePath, bytes, sniffedMime, fetchImpl,
    )) {
      return jsonResponse({ ok: false, error: "storage_upload_failed",
        message: "Gallery image could not be confirmed. Retry with the same attachment." }, 503);
    }
  }

  let insertResult: { data: unknown; error: unknown };
  try {
    insertResult = await adminClient.rpc("gallery_complete_discord_upload", {
      p_upload_id: reservation.upload_id,
      p_metadata: { original_filename: originalFilename, title, caption, category: "discord",
        discord_guild_id: guildId, discord_channel_id: channelId, discord_user_id: discordUserId,
        instagram_opt_in: instagramOptIn,
        instagram_opt_in_copy_version: instagramOptIn ? INSTAGRAM_OPT_IN_COPY_VERSION : null },
    });
  } catch {
    insertResult = { data: null, error: true };
  }
  const completed = asRecord(insertResult.data);
  const insertedData = asRecord(completed.submission);

  if (insertResult.error || completed.ok !== true || insertedData.id !== reservation.upload_id
    || !["pending", "approved", "rejected", "archived"].includes(String(insertedData.status))
    || typeof insertedData.created_at !== "string") {
    // An interrupted insert can already be committed. Never remove a possibly
    // selected immutable original; a retry reconciles the message/attachment ID.

    console.error("submit-discord-gallery-image submission insert failed");

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
  return jsonResponse({
    ok: true,
    duplicate: false,
    data: {
      submissionId: safeString(inserted.id, 80),
      status: safeString(inserted.status, 40),
      createdAt: safeString(inserted.created_at, 80),
    },
    message: "Image submitted to the pending gallery queue for moderator approval.",
  });
}

async function existingOriginalMatches(
  supabaseUrl: string,
  serviceRoleKey: string,
  storagePath: string,
  expected: Uint8Array,
  mimeType: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const origin = new URL(supabaseUrl);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.port
      || origin.pathname !== "/" || origin.search || origin.hash
      || !/^[a-z0-9]{20}\.supabase\.co$/.test(origin.hostname)
      || /[\\\x00-\x1f\x7f]/.test(storagePath)
      || storagePath.split("/").some((part) => !part || part === "." || part === "..")) return false;
    const target = `${origin.origin}/storage/v1/object/authenticated/${MEMBER_GALLERY_BUCKET}/`
      + storagePath.split("/").map(encodeURIComponent).join("/");
    const response = await fetchImpl(target, {
      redirect: "manual", signal: AbortSignal.timeout(30_000), cache: "no-store",
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
    });
    const length = response.headers.get("content-length");
    const etag = (response.headers.get("etag") || "").replace(/^"|"$/g, "");
    if (!response.ok || response.url !== target || normalizedMime(response.headers.get("content-type")) !== mimeType
      || !/^[0-9a-f]{32}(?:-[1-9][0-9]{0,5})?$/i.test(etag)
      || (length !== null && (!/^\d+$/.test(length) || Number(length) !== expected.length)) || !response.body) {
      await response.body?.cancel().catch(() => {});
      return false;
    }
    const reader = response.body.getReader();
    let offset = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return offset === expected.length;
        if (offset + value.length > expected.length) return false;
        for (let index = 0; index < value.length; index++) {
          if (value[index] !== expected[offset + index]) return false;
        }
        offset += value.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch {
    return false;
  }
}
