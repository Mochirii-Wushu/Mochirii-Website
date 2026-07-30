import type { SupabaseClient } from "@supabase/supabase-js";
import { isGallerySocialDerivativeStoragePath } from "./gallery-social-path.ts";
import { validateSocialPublicationCopy } from "./social-publication-copy.ts";
import {
  fetchMetaGraphOnce,
  META_GRAPH_API_VERSION,
  metaGraphApiVersionIsPinned,
  metaMutatingResponseOutcome,
  readBoundedMetaGraphJson,
} from "./meta-graph-security.ts";
import { logSafeMetaEvent } from "./safe-telemetry.ts";

export type JsonRecord = Record<string, unknown>;

export type FacebookPagePublishResult = {
  attempted: boolean;
  ok: boolean;
  status: string | null;
  job: JsonRecord | null;
  facebookPhotoId: string | null;
  facebookPostId: string | null;
  facebookPermalink: string | null;
  publishedAt: string | null;
  error: string | null;
  message: string;
};

type PublishDependencies = {
  adminClient: SupabaseClient;
  actorId: string;
  jobId: string;
  message?: string | null;
  expectedUpdatedAt: string;
  confirmationFingerprint: string;
  confirmationCopyHash: string;
  fetchImpl?: typeof fetch;
  config?: ReturnType<typeof facebookPageConfig>;
};

const GRAPH_REQUEST_TIMEOUT_MS = 90_000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const FACEBOOK_PAGE_ID_RE = /^\d{5,30}$/;
const FACEBOOK_PROVIDER_ID_RE = /^[A-Za-z0-9_.:-]{1,255}$/;
const FACEBOOK_PERMALINK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
]);
const FACEBOOK_PAGE_PUBLISH_TASKS = new Set([
  "CREATE_CONTENT",
  "PROFILE_PLUS_CREATE_CONTENT",
]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function safeString(value: unknown, maxLength: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function rpcRecord(value: unknown): JsonRecord {
  return asRecord(value);
}

function result({
  attempted,
  ok,
  status,
  job = null,
  facebookPhotoId = null,
  facebookPostId = null,
  facebookPermalink = null,
  publishedAt = null,
  error = null,
  message,
}: FacebookPagePublishResult): FacebookPagePublishResult {
  return {
    attempted,
    ok,
    status,
    job,
    facebookPhotoId,
    facebookPostId,
    facebookPermalink,
    publishedAt,
    error,
    message,
  };
}

export function facebookPageConfig() {
  const pageId = Deno.env.get("FACEBOOK_PAGE_ID") || "";
  const accessToken = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") || "";
  const apiVersion = Deno.env.get("FACEBOOK_API_VERSION") || "";
  const publishFlag = Deno.env.get("FACEBOOK_PAGE_PUBLISH_ENABLED") || "";
  const appId = Deno.env.get("META_APP_ID") || "";
  const expectedAppId = Deno.env.get("META_EXPECTED_APP_ID") || "";
  const appSecret = Deno.env.get("META_APP_SECRET") || "";
  const expectedPageId = Deno.env.get("FACEBOOK_EXPECTED_PAGE_ID") || "";
  const missingSecrets = [
    ["META_APP_ID", appId],
    ["META_EXPECTED_APP_ID", expectedAppId],
    ["META_APP_SECRET", appSecret],
    ["FACEBOOK_PAGE_ID", pageId],
    ["FACEBOOK_EXPECTED_PAGE_ID", expectedPageId],
    ["FACEBOOK_PAGE_ACCESS_TOKEN", accessToken],
    ["FACEBOOK_API_VERSION", apiVersion],
  ].filter(([, value]) => !value).map(([name]) => name);
  const invalidFields = [
    ...(appId && !facebookPageIdIsValid(appId) ? ["META_APP_ID"] : []),
    ...(expectedAppId && !facebookPageIdIsValid(expectedAppId)
      ? ["META_EXPECTED_APP_ID"]
      : []),
    ...(appId && expectedAppId && appId !== expectedAppId
      ? ["META_APP_ID_PIN"]
      : []),
    ...(pageId && !facebookPageIdIsValid(pageId) ? ["FACEBOOK_PAGE_ID"] : []),
    ...(expectedPageId && !facebookPageIdIsValid(expectedPageId)
      ? ["FACEBOOK_EXPECTED_PAGE_ID"]
      : []),
    ...(pageId && expectedPageId && pageId !== expectedPageId
      ? ["FACEBOOK_PAGE_ID_PIN"]
      : []),
    ...(apiVersion && !facebookApiVersionIsValid(apiVersion)
      ? ["FACEBOOK_API_VERSION"]
      : []),
  ];

  return {
    appId,
    expectedAppId,
    appSecret,
    pageId,
    expectedPageId,
    accessToken,
    apiVersion,
    publishEnabled: facebookPagePublishFlagEnabled(publishFlag),
    configured: missingSecrets.length === 0 && invalidFields.length === 0,
    missingSecrets,
    invalidFields,
  };
}

export function facebookPageIdIsValid(value: string): boolean {
  return FACEBOOK_PAGE_ID_RE.test(value);
}

export function facebookPageIdentityMatches(
  id: unknown,
  expectedPageId: string,
): boolean {
  return facebookPageIdIsValid(expectedPageId) && id === expectedPageId;
}

export function facebookApiVersionIsValid(value: string): boolean {
  return metaGraphApiVersionIsPinned(value);
}

export function facebookPagePublishFlagEnabled(value: unknown): boolean {
  return value === "true";
}

export function facebookTasksCanPublish(value: unknown): boolean {
  return Array.isArray(value) &&
    value.some((task) =>
      FACEBOOK_PAGE_PUBLISH_TASKS.has(String(task || "").trim())
    );
}

export function facebookGraphUrl(apiVersion: string, path: string): string {
  const cleanPath = path.replace(/^\/+/, "");
  return facebookApiVersionIsValid(apiVersion) &&
      /^[A-Za-z0-9_.:-]+(?:\/[A-Za-z0-9_.:-]+)*$/.test(cleanPath)
    ? `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${cleanPath}`
    : "";
}

export function facebookGraphOutcome(
  status: number,
): "failed" | "reconcile_required" {
  return metaMutatingResponseOutcome(status);
}

export function normalizeFacebookPermalink(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (
    !raw || raw.length > 1000 || raw.includes("#") ||
    /[\u0000-\u0020\u007f]/.test(raw)
  ) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      !FACEBOOK_PERMALINK_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }

    if (/%(?:2f|5c)/i.test(url.pathname)) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const safeSegment = (segment: string, maxLength = 255) =>
      segment.length <= maxLength && /^[A-Za-z0-9_.:-]+$/.test(segment);
    const setCanonicalOrigin = () => {
      url.protocol = "https:";
      url.hostname = "www.facebook.com";
      url.port = "";
    };

    if (
      segments.length === 3 && segments[1] === "posts" &&
      safeSegment(segments[0], 100) && safeSegment(segments[2])
    ) {
      setCanonicalOrigin();
      url.pathname = `/${segments.join("/")}`;
      url.search = "";
    } else if (
      segments.length >= 3 && segments.length <= 5 &&
      segments[1] === "photos" && segments.every((segment, index) =>
        safeSegment(segment, index === 0 ? 100 : 255)
      )
    ) {
      setCanonicalOrigin();
      url.pathname = `/${segments.join("/")}`;
      url.search = "";
    } else if (
      segments.length === 1 &&
      (segments[0] === "photo" || segments[0] === "photo.php")
    ) {
      const fbid = url.searchParams.getAll("fbid");
      const set = url.searchParams.getAll("set");
      if (
        fbid.length !== 1 || !safeSegment(fbid[0]) || set.length > 1 ||
        (set.length === 1 && !safeSegment(set[0]))
      ) {
        return null;
      }
      setCanonicalOrigin();
      url.pathname = "/photo.php";
      url.search = "";
      url.searchParams.set("fbid", fbid[0]);
      if (set[0]) {
        url.searchParams.set("set", set[0]);
      }
    } else if (
      segments.length === 1 &&
      (segments[0] === "story.php" || segments[0] === "permalink.php")
    ) {
      const storyId = url.searchParams.getAll("story_fbid");
      const pageId = url.searchParams.getAll("id");
      if (
        storyId.length !== 1 || pageId.length !== 1 ||
        !safeSegment(storyId[0]) || !safeSegment(pageId[0], 100)
      ) {
        return null;
      }
      setCanonicalOrigin();
      url.pathname = `/${segments[0]}`;
      url.search = "";
      url.searchParams.set("story_fbid", storyId[0]);
      url.searchParams.set("id", pageId[0]);
    } else {
      return null;
    }

    const normalized = url.toString();
    return normalized.length <= 1000 ? normalized : null;
  } catch {
    return null;
  }
}

export function facebookPageObjectEvidence(
  value: unknown,
  requestedObjectId: unknown,
  expectedPageId: string,
): {
  verified: boolean;
  objectId: string | null;
  ownerPageId: string | null;
  permalink: string | null;
} {
  const body = asRecord(value);
  const owner = asRecord(body.from);
  const requestedId = safeString(requestedObjectId, 255);
  const objectId = safeString(body.id, 255);
  const ownerPageId = safeString(owner.id, 80);
  const permalink = normalizeFacebookPermalink(
    body.permalink_url || body.link,
  );
  return {
    verified: Boolean(
      requestedId && FACEBOOK_PROVIDER_ID_RE.test(requestedId) &&
        objectId === requestedId &&
        facebookPageIdIsValid(expectedPageId) &&
        ownerPageId === expectedPageId && permalink,
    ),
    objectId,
    ownerPageId,
    permalink,
  };
}

export function facebookGraphErrorDetails(
  body: JsonRecord,
  statusCode: number,
): JsonRecord {
  const graphError = asRecord(body.error);
  const rawType = safeString(graphError.type, 100);
  const providerErrorType = rawType && /^[A-Za-z0-9_.:-]{1,100}$/.test(rawType)
    ? rawType
    : null;
  const providerErrorCode = Number(graphError.code);
  const providerErrorSubcode = Number(graphError.error_subcode);
  return {
    status_code: statusCode,
    provider_error_type: providerErrorType,
    provider_error_code: Number.isSafeInteger(providerErrorCode)
      ? providerErrorCode
      : null,
    provider_error_subcode: Number.isSafeInteger(providerErrorSubcode)
      ? providerErrorSubcode
      : null,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function finishPublish(
  adminClient: SupabaseClient,
  values: {
    jobId: string;
    actorId: string;
    outcome: "published" | "failed" | "reconcile_required";
    facebookPhotoId?: string | null;
    facebookPostId?: string | null;
    facebookPermalink?: string | null;
    pageOwnershipVerified?: boolean;
    error?: string | null;
    details?: JsonRecord;
  },
): Promise<
  { committed: boolean; job: JsonRecord | null; reason: string | null }
> {
  const { data, error } = await adminClient.rpc(
    "gallery_facebook_page_finish_publish",
    {
      p_job_id: values.jobId,
      p_actor_id: values.actorId,
      p_outcome: values.outcome,
      p_facebook_photo_id: values.facebookPhotoId || null,
      p_facebook_post_id: values.facebookPostId || null,
      p_facebook_permalink: values.facebookPermalink || null,
      p_page_ownership_verified: values.pageOwnershipVerified === true,
      p_error: values.error || null,
      p_details: values.details || {},
    },
  );

  if (error) {
    logSafeMetaEvent("error", "facebook_publish_outcome_commit_failed", {
      provider: "facebook_page",
      outcome: values.outcome,
      errorCategory: "database_commit_failed",
    });
    return { committed: false, job: null, reason: "outcome_commit_failed" };
  }

  const payload = rpcRecord(data);
  return {
    committed: payload.committed === true,
    job: payload.job && typeof payload.job === "object" &&
        !Array.isArray(payload.job)
      ? payload.job as JsonRecord
      : null,
    reason: safeString(payload.reason, 80),
  };
}

async function finishFailure(
  adminClient: SupabaseClient,
  values: {
    jobId: string;
    actorId: string;
    attempted: boolean;
    outcome: "failed" | "reconcile_required";
    error: string;
    message: string;
    details?: JsonRecord;
  },
): Promise<FacebookPagePublishResult> {
  const finished = await finishPublish(adminClient, {
    jobId: values.jobId,
    actorId: values.actorId,
    outcome: values.outcome,
    error: values.message,
    details: values.details,
  });
  const status = safeString(finished.job?.status, 40) || values.outcome;

  if (!finished.committed) {
    return result({
      attempted: values.attempted,
      ok: false,
      status: "reconcile_required",
      job: finished.job,
      facebookPhotoId: null,
      facebookPostId: null,
      facebookPermalink: null,
      publishedAt: null,
      error: "facebook_page_publish_audit_failed",
      message: values.attempted
        ? "The Facebook Page result could not be recorded. Inspect the Page before any retry."
        : "The Facebook Page job could not record its failure. Do not retry until the queue is inspected.",
    });
  }

  return result({
    attempted: values.attempted,
    ok: false,
    status,
    job: finished.job,
    facebookPhotoId: null,
    facebookPostId: null,
    facebookPermalink: null,
    publishedAt: null,
    error: values.error,
    message: values.message,
  });
}

async function reconcileAfterAuditFailure(
  adminClient: SupabaseClient,
  values: {
    jobId: string;
    actorId: string;
    facebookPhotoId: string | null;
    facebookPostId: string | null;
  },
): Promise<FacebookPagePublishResult> {
  const { data: currentData, error: currentError } = await adminClient
    .from("gallery_facebook_page_publish_jobs")
    .select(
      "id,status,facebook_photo_id,facebook_post_id,facebook_permalink,published_at",
    )
    .eq("id", values.jobId)
    .maybeSingle();
  const current = currentData as JsonRecord | null;
  const currentStatus = safeString(current?.status, 40);

  if (!currentError && currentStatus === "published") {
    return result({
      attempted: true,
      ok: true,
      status: "published",
      job: current,
      facebookPhotoId: safeString(current?.facebook_photo_id, 255),
      facebookPostId: safeString(current?.facebook_post_id, 255),
      facebookPermalink: normalizeFacebookPermalink(
        current?.facebook_permalink,
      ),
      publishedAt: safeString(current?.published_at, 80),
      error: null,
      message: "Image published to the Mōchirīī Facebook Page.",
    });
  }

  if (!currentError && currentStatus === "publishing") {
    const reconciled = await finishPublish(adminClient, {
      jobId: values.jobId,
      actorId: values.actorId,
      outcome: "reconcile_required",
      facebookPhotoId: values.facebookPhotoId,
      facebookPostId: values.facebookPostId,
      error:
        "Meta returned a publish id, but the local success record was not committed. Inspect the Page before any retry.",
      details: {
        provider_returned_photo_id: Boolean(values.facebookPhotoId),
        provider_returned_post_id: Boolean(values.facebookPostId),
      },
    });
    if (reconciled.committed) {
      return result({
        attempted: true,
        ok: false,
        status: "reconcile_required",
        job: reconciled.job,
        facebookPhotoId: values.facebookPhotoId,
        facebookPostId: values.facebookPostId,
        facebookPermalink: null,
        publishedAt: null,
        error: "facebook_page_publish_reconcile_required",
        message:
          "Meta may have published the image, but the local success record was incomplete. Inspect the Page before any retry.",
      });
    }
  }

  return result({
    attempted: true,
    ok: false,
    status: "reconcile_required",
    job: current,
    facebookPhotoId: values.facebookPhotoId,
    facebookPostId: values.facebookPostId,
    facebookPermalink: null,
    publishedAt: null,
    error: "facebook_page_publish_audit_failed",
    message:
      "Meta may have published the image, but the local result could not be verified. Inspect the Page before any retry.",
  });
}

export async function publishFacebookPageJob(
  dependencies: PublishDependencies,
): Promise<FacebookPagePublishResult> {
  const { adminClient, actorId, jobId } = dependencies;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const requestedMessage = safeString(dependencies.message, 5000);
  const copyValidation = validateSocialPublicationCopy([requestedMessage]);

  if (!copyValidation.ok) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      facebookPhotoId: null,
      facebookPostId: null,
      facebookPermalink: null,
      publishedAt: null,
      error: copyValidation.error,
      message: copyValidation.message,
    });
  }

  if (
    !UUID_RE.test(jobId) || !UUID_RE.test(actorId) ||
    !TIMESTAMPTZ_RE.test(dependencies.expectedUpdatedAt) ||
    !SHA256_RE.test(dependencies.confirmationFingerprint) ||
    !SHA256_RE.test(dependencies.confirmationCopyHash)
  ) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      facebookPhotoId: null,
      facebookPostId: null,
      facebookPermalink: null,
      publishedAt: null,
      error: "invalid_facebook_page_publish_request",
      message: "The Facebook Page publishing request is invalid.",
    });
  }

  const config = dependencies.config || facebookPageConfig();
  if (!config.configured) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      facebookPhotoId: null,
      facebookPostId: null,
      facebookPermalink: null,
      publishedAt: null,
      error: "facebook_page_not_configured",
      message: "Facebook Page publishing is not configured yet.",
    });
  }

  if (!config.publishEnabled) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      facebookPhotoId: null,
      facebookPostId: null,
      facebookPermalink: null,
      publishedAt: null,
      error: "facebook_page_publish_disabled",
      message:
        "Facebook Page publishing is disabled until the server activation flag is approved.",
    });
  }

  try {
    const identityResponse = await fetchMetaGraphOnce({
      accessToken: config.accessToken,
      appSecret: config.appSecret,
      path: config.expectedPageId,
      query: { fields: "id" },
      timeoutMs: 30_000,
      fetchImpl,
    });
    const identity = await readBoundedMetaGraphJson(identityResponse);
    if (
      !identityResponse.ok ||
      !facebookPageIdentityMatches(identity.id, config.expectedPageId)
    ) {
      return result({
        attempted: false,
        ok: false,
        status: null,
        job: null,
        facebookPhotoId: null,
        facebookPostId: null,
        facebookPermalink: null,
        publishedAt: null,
        error: "facebook_page_identity_mismatch",
        message:
          "The configured Facebook Page identity could not be verified before publishing.",
      });
    }
  } catch {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      facebookPhotoId: null,
      facebookPostId: null,
      facebookPermalink: null,
      publishedAt: null,
      error: "facebook_page_identity_unavailable",
      message:
        "The configured Facebook Page identity could not be verified before publishing.",
    });
  }

  const { data: beginData, error: beginError } = await adminClient.rpc(
    "gallery_facebook_page_begin_publish",
    {
      p_job_id: jobId,
      p_actor_id: actorId,
      p_message: requestedMessage,
      p_expected_updated_at: dependencies.expectedUpdatedAt,
      p_confirmation_fingerprint: dependencies.confirmationFingerprint,
      p_confirmation_copy_hash: dependencies.confirmationCopyHash,
    },
  );
  const begin = rpcRecord(beginData);
  const begunJob = begin.job && typeof begin.job === "object" &&
      !Array.isArray(begin.job)
    ? begin.job as JsonRecord
    : null;

  if (beginError || begin.committed !== true || !begunJob) {
    logSafeMetaEvent("warn", "facebook_publish_job_not_acquired", {
      provider: "facebook_page",
      errorCategory: beginError
        ? "database_lock_failed"
        : safeString(begin.reason, 80) || "job_not_publishable",
    });
    return result({
      attempted: false,
      ok: false,
      status: safeString(begin.status, 40),
      job: begunJob,
      facebookPhotoId: null,
      facebookPostId: null,
      facebookPermalink: null,
      publishedAt: null,
      error: beginError
        ? "facebook_page_job_lock_failed"
        : safeString(begin.reason, 80) || "facebook_page_job_not_publishable",
      message: beginError
        ? "The Facebook Page publishing job could not be locked."
        : "Only queued or failed Facebook Page jobs can be published.",
    });
  }

  const finalMessage = requestedMessage || safeString(begunJob.message, 5000);
  const finalCopyValidation = validateSocialPublicationCopy([finalMessage]);
  if (!finalCopyValidation.ok) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: finalCopyValidation.error,
      message: finalCopyValidation.message,
    });
  }

  const { data: sourceData, error: sourceError } = await adminClient.rpc(
    "gallery_facebook_page_publish_source",
    { p_job_id: jobId },
  );
  const source = rpcRecord(sourceData);
  if (sourceError || source.ok !== true) {
    logSafeMetaEvent("error", "facebook_publish_source_lookup_failed", {
      provider: "facebook_page",
      errorCategory: "source_lookup_failed",
    });
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "facebook_page_source_unavailable",
      message: "The approved Facebook Page image source is unavailable.",
    });
  }

  const bucket = safeString(source.bucket_id, 80);
  const storagePath = safeString(source.object_name, 1000);
  const mimeType = safeString(source.mime_type, 80);
  const expectedSha256 = safeString(source.sha256, 64);
  const expectedSize = Number(source.size_bytes || 0);
  const expectedWidth = Number(source.width || 0);
  const expectedHeight = Number(source.height || 0);
  const destinationClass = safeString(source.destination_page_id, 80);
  const sanitizerVersion = safeString(source.sanitizer_version, 80);
  const metadataPolicy = safeString(source.metadata_policy, 80);
  const sourceSubmissionId = safeString(source.submission_id, 80);

  if (
    bucket !== "member-gallery" || !storagePath ||
    !sourceSubmissionId ||
    !isGallerySocialDerivativeStoragePath(storagePath, sourceSubmissionId) ||
    mimeType !== "image/jpeg" ||
    !/^[0-9a-f]{64}$/.test(expectedSha256 || "") ||
    !Number.isSafeInteger(expectedSize) || expectedSize < 1 ||
    expectedSize > MAX_SOURCE_BYTES ||
    !Number.isSafeInteger(expectedWidth) || expectedWidth < 320 ||
    expectedWidth > 1440 ||
    !Number.isSafeInteger(expectedHeight) || expectedHeight < 1 ||
    expectedHeight > 1800 || expectedWidth * 5 < expectedHeight * 4 ||
    expectedWidth * 100 > expectedHeight * 191 ||
    destinationClass !== "facebook_page" ||
    sanitizerVersion !== "gallery-social-jpeg-v1" ||
    metadataPolicy !== "jfif-only-no-app-metadata-v1"
  ) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "facebook_page_source_invalid",
      message: "The approved Facebook Page image source is invalid.",
    });
  }

  const { data: blob, error: downloadError } = await adminClient.storage
    .from(bucket)
    .download(storagePath);
  if (downloadError || !blob) {
    logSafeMetaEvent("error", "facebook_publish_source_download_failed", {
      provider: "facebook_page",
      errorCategory: "source_download_failed",
    });
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "facebook_page_source_download_failed",
      message: "The approved Facebook Page image could not be loaded.",
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const actualSha256 = await sha256Hex(bytes);
  if (
    bytes.byteLength !== expectedSize || actualSha256 !== expectedSha256 ||
    (blob.type && blob.type.toLowerCase() !== mimeType)
  ) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "facebook_page_source_verification_failed",
      message:
        "The approved Facebook Page image failed integrity verification.",
      details: {
        size_matches: bytes.byteLength === expectedSize,
        hash_matches: actualSha256 === expectedSha256,
        mime_matches: !blob.type || blob.type.toLowerCase() === mimeType,
      },
    });
  }

  const mediaBuffer = new Uint8Array(bytes).buffer;
  const form = new FormData();
  form.set(
    "source",
    new Blob([mediaBuffer], { type: mimeType || "application/octet-stream" }),
    "mochirii-gallery.jpg",
  );
  // Meta's Page Photos endpoint names the photo caption field `message`.
  if (finalMessage) form.set("message", finalMessage);
  form.set("published", "true");

  let graphResponse: Response;
  try {
    graphResponse = await fetchMetaGraphOnce({
      accessToken: config.accessToken,
      appSecret: config.appSecret,
      path: `${config.expectedPageId}/photos`,
      init: { method: "POST", body: form },
      timeoutMs: GRAPH_REQUEST_TIMEOUT_MS,
      fetchImpl,
    });
  } catch (error) {
    logSafeMetaEvent("warn", "facebook_publish_request_ambiguous", {
      provider: "facebook_page",
      stage: "publish_request",
      outcome: "reconcile_required",
      errorCategory:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "provider_timeout"
          : "provider_network_error",
    });
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome: "reconcile_required",
      error: "facebook_page_publish_reconcile_required",
      message:
        "The Facebook Page request ended without a confirmed result. Inspect the Page before any retry.",
      details: { failure_stage: "graph_request" },
    });
  }

  const graphBody = await readBoundedMetaGraphJson(graphResponse);
  if (!graphResponse.ok) {
    const outcome = facebookGraphOutcome(graphResponse.status);
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome,
      error: outcome === "reconcile_required"
        ? "facebook_page_publish_reconcile_required"
        : "facebook_page_publish_failed",
      message: outcome === "reconcile_required"
        ? "Meta returned an uncertain server result. Inspect the Page before any retry."
        : "Meta rejected the Facebook Page image.",
      details: facebookGraphErrorDetails(graphBody, graphResponse.status),
    });
  }

  const facebookPhotoId = safeString(graphBody.id, 255);
  const facebookPostId = safeString(graphBody.post_id, 255);
  if (!facebookPhotoId && !facebookPostId) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome: "reconcile_required",
      error: "facebook_page_publish_reconcile_required",
      message:
        "Meta accepted the request without a publish id. Inspect the Page before any retry.",
      details: {
        status_code: graphResponse.status,
        failure_stage: "graph_response",
      },
    });
  }

  let facebookPermalink: string | null = null;
  let pageOwnershipVerified = false;
  const permalinkObjectId = facebookPostId || facebookPhotoId;
  if (permalinkObjectId) {
    try {
      const permalinkResponse = await fetchMetaGraphOnce({
        accessToken: config.accessToken,
        appSecret: config.appSecret,
        path: encodeURIComponent(permalinkObjectId),
        query: { fields: "id,from{id},permalink_url,link" },
        timeoutMs: GRAPH_REQUEST_TIMEOUT_MS,
        fetchImpl,
      });
      if (permalinkResponse.ok) {
        const permalinkBody = await readBoundedMetaGraphJson(
          permalinkResponse,
        );
        const evidence = facebookPageObjectEvidence(
          permalinkBody,
          permalinkObjectId,
          config.expectedPageId,
        );
        facebookPermalink = evidence.permalink;
        pageOwnershipVerified = evidence.verified;
      }
    } catch {
      // Publishing already succeeded. Missing permalink is non-fatal.
    }
  }

  if (!pageOwnershipVerified || !facebookPermalink) {
    const finished = await finishPublish(adminClient, {
      jobId,
      actorId,
      outcome: "reconcile_required",
      facebookPhotoId,
      facebookPostId,
      facebookPermalink,
      error:
        "Meta accepted the image, but canonical Page ownership evidence could not be verified. Inspect the official Page before any retry.",
      pageOwnershipVerified: false,
      details: {
        failure_stage: "page_ownership_verification",
        provider_returned_photo_id: Boolean(facebookPhotoId),
        provider_returned_post_id: Boolean(facebookPostId),
        provider_returned_permalink: Boolean(facebookPermalink),
      },
    });
    return result({
      attempted: true,
      ok: false,
      status: "reconcile_required",
      job: finished.job,
      facebookPhotoId,
      facebookPostId,
      facebookPermalink,
      publishedAt: null,
      error: "facebook_page_ownership_reconcile_required",
      message:
        "Meta may have published the image, but the result could not be bound to the pinned Page. Inspect the official Page before any retry.",
    });
  }

  const finished = await finishPublish(adminClient, {
    jobId,
    actorId,
    outcome: "published",
    facebookPhotoId,
    facebookPostId,
    facebookPermalink,
    pageOwnershipVerified: true,
    details: {
      status_code: graphResponse.status,
      has_permalink: Boolean(facebookPermalink),
    },
  });

  if (!finished.committed || !finished.job) {
    return reconcileAfterAuditFailure(adminClient, {
      jobId,
      actorId,
      facebookPhotoId,
      facebookPostId,
    });
  }

  return result({
    attempted: true,
    ok: true,
    status: "published",
    job: finished.job,
    facebookPhotoId,
    facebookPostId,
    facebookPermalink,
    publishedAt: safeString(finished.job.published_at, 80),
    error: null,
    message: "Image published to the Mōchirīī Facebook Page.",
  });
}
