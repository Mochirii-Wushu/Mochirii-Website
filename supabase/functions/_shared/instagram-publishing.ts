import type { SupabaseClient } from "@supabase/supabase-js";
import { isGallerySocialDerivativeStoragePath } from "./gallery-social-path.ts";
import { validateSocialPublicationCopy } from "./social-publication-copy.ts";
import {
  fetchMetaGraphOnce,
  META_GRAPH_API_VERSION,
  metaGraphApiVersionIsPinned,
  metaGraphUrl,
  metaMutatingResponseOutcome,
  readBoundedMetaGraphJson,
} from "./meta-graph-security.ts";
import { logSafeMetaEvent } from "./safe-telemetry.ts";

export type JsonRecord = Record<string, unknown>;

const INSTAGRAM_ACCOUNT_ID_RE = /^\d{5,30}$/;
const INSTAGRAM_EXPECTED_USERNAME = "mochirii_guild";
const GRAPH_REQUEST_TIMEOUT_MS = 60_000;
const CONTAINER_STATUS_TIMEOUT_MS = 30_000;
const INSTAGRAM_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const INSTAGRAM_MIN_WIDTH = 320;
const INSTAGRAM_MAX_WIDTH = 1440;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type InstagramPublishResult = {
  attempted: boolean;
  ok: boolean;
  status: string | null;
  job: JsonRecord | null;
  instagramContainerId: string | null;
  instagramMediaId: string | null;
  instagramPermalink: string | null;
  publishedAt: string | null;
  error: string | null;
  message: string;
};

type PublishDependencies = {
  adminClient: SupabaseClient;
  actorId: string;
  jobId: string;
  caption?: string | null;
  altText?: string | null;
  expectedUpdatedAt: string;
  confirmationFingerprint: string;
  confirmationCopyHash: string;
  fetchImpl?: typeof fetch;
  config?: ReturnType<typeof instagramConfig>;
};

function safeString(value: unknown, maxLength: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

export function normalizeInstagramPostPermalink(value: unknown): string | null {
  const raw = safeString(value, 1000);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (hostname !== "instagram.com" && hostname !== "www.instagram.com") ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) return null;

    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments.length !== 2 ||
      !["p", "reel"].includes(segments[0]) ||
      !/^[A-Za-z0-9_-]+$/.test(segments[1])
    ) return null;

    return `https://www.instagram.com/${segments[0]}/${segments[1]}/`;
  } catch {
    return null;
  }
}

export function instagramTemporaryMediaUrlIsSafe(
  value: unknown,
  supabaseUrl: unknown,
): boolean {
  const raw = safeString(value, 4096);
  const rawSupabaseUrl = safeString(supabaseUrl, 2048);
  if (!raw || !rawSupabaseUrl) return false;
  try {
    const url = new URL(raw);
    const expected = new URL(rawSupabaseUrl);
    const decodedPath = decodeURIComponent(url.pathname);
    return expected.protocol === "https:" && url.protocol === "https:" &&
      url.origin === expected.origin && !url.username && !url.password &&
      !url.hash && !url.searchParams.has("access_token") &&
      decodedPath.startsWith(
        "/storage/v1/object/sign/member-gallery/_social/submissions/",
      ) && url.searchParams.has("token");
  } catch {
    return false;
  }
}

export function instagramJobIdIsValid(value: unknown): boolean {
  return UUID_RE.test(String(value ?? "").trim());
}

export function instagramConfig() {
  const accountId = Deno.env.get("INSTAGRAM_ACCOUNT_ID") || "";
  const expectedAccountId = Deno.env.get("INSTAGRAM_EXPECTED_ACCOUNT_ID") || "";
  const accessToken = Deno.env.get("INSTAGRAM_ACCESS_TOKEN") || "";
  const apiVersion = Deno.env.get("INSTAGRAM_API_VERSION") || "";
  const publishFlag = Deno.env.get("INSTAGRAM_PUBLISH_ENABLED") || "";
  const appId = Deno.env.get("META_APP_ID") || "";
  const expectedAppId = Deno.env.get("META_EXPECTED_APP_ID") || "";
  const appSecret = Deno.env.get("META_APP_SECRET") || "";
  const missingSecrets = [
    ["INSTAGRAM_ACCOUNT_ID", accountId],
    ["INSTAGRAM_EXPECTED_ACCOUNT_ID", expectedAccountId],
    ["INSTAGRAM_ACCESS_TOKEN", accessToken],
    ["INSTAGRAM_API_VERSION", apiVersion],
    ["META_APP_ID", appId],
    ["META_EXPECTED_APP_ID", expectedAppId],
    ["META_APP_SECRET", appSecret],
  ].filter(([, value]) => !value).map(([name]) => name);
  const invalidFields = [
    ...(accountId && !instagramAccountIdIsValid(accountId)
      ? ["INSTAGRAM_ACCOUNT_ID"]
      : []),
    ...(expectedAccountId && !instagramAccountIdIsValid(expectedAccountId)
      ? ["INSTAGRAM_EXPECTED_ACCOUNT_ID"]
      : []),
    ...(apiVersion && !instagramApiVersionIsValid(apiVersion)
      ? ["INSTAGRAM_API_VERSION"]
      : []),
    ...(appId && !instagramAccountIdIsValid(appId) ? ["META_APP_ID"] : []),
    ...(expectedAppId && !instagramAccountIdIsValid(expectedAppId)
      ? ["META_EXPECTED_APP_ID"]
      : []),
    ...(appId && expectedAppId && appId !== expectedAppId
      ? ["META_APP_ID_PIN"]
      : []),
    ...(accountId && expectedAccountId && accountId !== expectedAccountId
      ? ["INSTAGRAM_ACCOUNT_ID_PIN"]
      : []),
  ];
  const accountIdPinned = instagramAccountIdMatchesCanonicalPin(
    accountId,
    expectedAccountId,
  );

  return {
    accountId,
    expectedAccountId,
    accessToken,
    apiVersion,
    appId,
    appSecret,
    expectedAppId,
    expectedUsername: INSTAGRAM_EXPECTED_USERNAME,
    accountIdPinned,
    publishEnabled: instagramPublishFlagEnabled(publishFlag),
    configured: missingSecrets.length === 0 && invalidFields.length === 0,
    missingSecrets,
    invalidFields,
  };
}

export function instagramAccountIdIsValid(value: string): boolean {
  return INSTAGRAM_ACCOUNT_ID_RE.test(value);
}

export function instagramAccountIdMatchesCanonicalPin(
  configuredAccountId: string,
  expectedAccountId: string,
): boolean {
  return Boolean(
    expectedAccountId &&
      instagramAccountIdIsValid(expectedAccountId) &&
      configuredAccountId === expectedAccountId,
  );
}

export function instagramApiVersionIsValid(value: string): boolean {
  return metaGraphApiVersionIsPinned(value);
}

export function instagramPublishFlagEnabled(value: unknown): boolean {
  return value === "true";
}

export function instagramFeedImageIsCompatible(values: {
  mimeType: string | null;
  sizeBytes: number;
  width: number;
  height: number;
}): boolean {
  return values.mimeType === "image/jpeg" &&
    Number.isSafeInteger(values.sizeBytes) && values.sizeBytes >= 1 &&
    values.sizeBytes <= INSTAGRAM_MAX_SOURCE_BYTES &&
    Number.isSafeInteger(values.width) &&
    values.width >= INSTAGRAM_MIN_WIDTH &&
    values.width <= INSTAGRAM_MAX_WIDTH &&
    Number.isSafeInteger(values.height) && values.height >= 1 &&
    values.width * 5 >= values.height * 4 &&
    values.width * 100 <= values.height * 191;
}

export function instagramGraphUrl(version: string, path: string): string {
  if (!instagramApiVersionIsValid(version)) return "";
  return metaGraphUrl(path);
}

export function instagramIdentityMatches(
  value: unknown,
  configuredAccountId: string,
): boolean {
  const identity = value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
  const id = safeString(identity.id, 80);
  const username = safeString(identity.username, 80)?.toLowerCase();
  return id === configuredAccountId &&
    username === INSTAGRAM_EXPECTED_USERNAME;
}

export function instagramIdentitySummary(value: unknown): JsonRecord | null {
  const identity = value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
  const id = safeString(identity.id, 80);
  if (!id) return null;
  return {
    identityPresent: true,
    usernameMatches: safeString(identity.username, 80)?.toLowerCase() ===
      INSTAGRAM_EXPECTED_USERNAME,
    businessAccountSubtypeVerification: "manual_required",
  };
}

export function instagramPublishingQuota(value: unknown): {
  readable: boolean;
  exhausted: boolean;
  usage: number | null;
  total: number | null;
} {
  const body = asRecord(value);
  const first = Array.isArray(body.data) ? asRecord(body.data[0]) : body;
  const config = asRecord(first.config);
  const usage = Number(first.quota_usage);
  const total = Number(config.quota_total);
  const readable = Number.isSafeInteger(usage) && usage >= 0 &&
    Number.isSafeInteger(total) && total > 0;
  return {
    readable,
    exhausted: readable && usage >= total,
    usage: readable ? usage : null,
    total: readable ? total : null,
  };
}

export function instagramMediaObjectEvidence(
  value: unknown,
  expectedMediaId: string,
  expectedAccountId: string,
): {
  verified: boolean;
  mediaId: string | null;
  permalink: string | null;
} {
  const body = asRecord(value);
  const owner = asRecord(body.owner);
  const mediaId = safeString(body.id, 255);
  const ownerId = safeString(owner.id || body.owner, 80);
  const username = safeString(body.username, 80)?.toLowerCase();
  const mediaType = safeString(body.media_type, 40)?.toUpperCase();
  const permalink = normalizeInstagramPostPermalink(body.permalink);
  return {
    verified: Boolean(
      mediaId === expectedMediaId &&
        instagramAccountIdIsValid(expectedAccountId) &&
        ownerId === expectedAccountId &&
        username === INSTAGRAM_EXPECTED_USERNAME &&
        mediaType === "IMAGE" &&
        permalink,
    ),
    mediaId,
    permalink,
  };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function rpcRecord(value: unknown): JsonRecord {
  return asRecord(value);
}

function result(values: InstagramPublishResult): InstagramPublishResult {
  return values;
}

export function instagramGraphOutcome(
  status: number,
): "failed" | "reconcile_required" {
  return metaMutatingResponseOutcome(status);
}

export type InstagramContainerStatusCode =
  | "FINISHED"
  | "IN_PROGRESS"
  | "ERROR"
  | "EXPIRED"
  | "PUBLISHED"
  | "UNKNOWN";

export type InstagramContainerStatusDecision = {
  statusCode: InstagramContainerStatusCode;
  action: "ready" | "reconcile_required";
  error:
    | "container_failed"
    | "container_in_progress"
    | "container_status_unknown"
    | null;
};

export function normalizeInstagramContainerStatusCode(
  value: unknown,
): InstagramContainerStatusCode {
  if (typeof value !== "string" || value.length > 32) return "UNKNOWN";
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "FINISHED":
    case "IN_PROGRESS":
    case "ERROR":
    case "EXPIRED":
    case "PUBLISHED":
      return normalized;
    default:
      return "UNKNOWN";
  }
}

export function instagramContainerStatusDecision(
  value: unknown,
): InstagramContainerStatusDecision {
  const statusCode = normalizeInstagramContainerStatusCode(value);
  if (statusCode === "FINISHED") {
    return { statusCode, action: "ready", error: null };
  }
  if (statusCode === "IN_PROGRESS") {
    return {
      statusCode,
      action: "reconcile_required",
      error: "container_in_progress",
    };
  }
  return {
    statusCode,
    action: "reconcile_required",
    error: statusCode === "UNKNOWN"
      ? "container_status_unknown"
      : "container_failed",
  };
}

type InstagramGraphFailureStage = "container_create" | "publish";

function safeProviderErrorType(value: unknown): string | null {
  const providerType = safeString(value, 100);
  return providerType && /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(providerType)
    ? providerType
    : null;
}

function graphErrorDetails(body: JsonRecord, statusCode: number): JsonRecord {
  const graphError = asRecord(body.error);
  return {
    status_code: statusCode,
    provider_error_type: safeProviderErrorType(graphError.type),
    provider_error_code: Number.isFinite(Number(graphError.code))
      ? Number(graphError.code)
      : null,
    provider_error_subcode: Number.isFinite(Number(graphError.error_subcode))
      ? Number(graphError.error_subcode)
      : null,
  };
}

export function instagramGraphFailure(
  body: JsonRecord,
  statusCode: number,
  stage: InstagramGraphFailureStage,
): { message: string; details: JsonRecord } {
  return {
    message: stage === "container_create"
      ? "Instagram rejected the media container."
      : "Meta rejected the Instagram image.",
    details: {
      failure_stage: stage,
      ...graphErrorDetails(body, statusCode),
    },
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
    instagramContainerId?: string | null;
    instagramMediaId?: string | null;
    instagramPermalink?: string | null;
    error?: string | null;
    details?: JsonRecord;
  },
): Promise<
  { committed: boolean; job: JsonRecord | null; reason: string | null }
> {
  const { data, error } = await adminClient.rpc(
    "gallery_instagram_finish_publish",
    {
      p_job_id: values.jobId,
      p_actor_id: values.actorId,
      p_outcome: values.outcome,
      p_instagram_container_id: values.instagramContainerId || null,
      p_instagram_media_id: values.instagramMediaId || null,
      p_instagram_permalink: values.instagramPermalink || null,
      p_error: values.error || null,
      p_details: values.details || {},
    },
  );
  if (error) {
    logSafeMetaEvent("error", "instagram_publish_outcome_commit_failed", {
      provider: "instagram",
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

export async function finishFailure(
  adminClient: SupabaseClient,
  values: {
    jobId: string;
    actorId: string;
    attempted: boolean;
    outcome: "failed" | "reconcile_required";
    error: string;
    message: string;
    instagramContainerId?: string | null;
    instagramMediaId?: string | null;
    details?: JsonRecord;
  },
): Promise<InstagramPublishResult> {
  const finished = await finishPublish(adminClient, {
    jobId: values.jobId,
    actorId: values.actorId,
    outcome: values.outcome,
    instagramContainerId: values.instagramContainerId,
    instagramMediaId: values.instagramMediaId,
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
      instagramContainerId: values.instagramContainerId || null,
      instagramMediaId: values.instagramMediaId || null,
      instagramPermalink: null,
      publishedAt: null,
      error: "instagram_publish_audit_failed",
      message: values.attempted
        ? "The Instagram result could not be recorded. Inspect the account before any retry."
        : "The Instagram job could not record its failure. Do not retry until the queue is inspected.",
    });
  }

  return result({
    attempted: values.attempted,
    ok: false,
    status,
    job: finished.job,
    instagramContainerId: values.instagramContainerId || null,
    instagramMediaId: values.instagramMediaId || null,
    instagramPermalink: null,
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
    instagramContainerId: string | null;
    instagramMediaId: string;
    instagramPermalink: string | null;
  },
): Promise<InstagramPublishResult> {
  const { data: currentData, error: currentError } = await adminClient
    .from("gallery_instagram_publish_jobs")
    .select(
      "id,status,instagram_container_id,instagram_media_id,instagram_permalink,published_at",
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
      instagramContainerId: safeString(current?.instagram_container_id, 255),
      instagramMediaId: safeString(current?.instagram_media_id, 255),
      instagramPermalink: safeString(current?.instagram_permalink, 1000),
      publishedAt: safeString(current?.published_at, 80),
      error: null,
      message: "Image published to @mochirii_guild.",
    });
  }

  if (!currentError && currentStatus === "publishing") {
    const reconciled = await finishPublish(adminClient, {
      jobId: values.jobId,
      actorId: values.actorId,
      outcome: "reconcile_required",
      instagramContainerId: values.instagramContainerId,
      instagramMediaId: values.instagramMediaId,
      instagramPermalink: values.instagramPermalink,
      error:
        "Meta returned a media id, but the local success record was not committed. Inspect the account before any retry.",
      details: {
        provider_returned_media_id: true,
        has_permalink: Boolean(values.instagramPermalink),
      },
    });
    if (reconciled.committed) {
      return result({
        attempted: true,
        ok: false,
        status: "reconcile_required",
        job: reconciled.job,
        instagramContainerId: values.instagramContainerId,
        instagramMediaId: values.instagramMediaId,
        instagramPermalink: values.instagramPermalink,
        publishedAt: null,
        error: "instagram_publish_reconcile_required",
        message:
          "Meta may have published the image, but the local success record was incomplete. Inspect the account before any retry.",
      });
    }
  }

  return result({
    attempted: true,
    ok: false,
    status: "reconcile_required",
    job: current,
    instagramContainerId: values.instagramContainerId,
    instagramMediaId: values.instagramMediaId,
    instagramPermalink: values.instagramPermalink,
    publishedAt: null,
    error: "instagram_publish_audit_failed",
    message:
      "Meta may have published the image, but the local result could not be verified. Inspect the account before any retry.",
  });
}

async function readContainerStatusOnce(
  fetchImpl: typeof fetch,
  config: ReturnType<typeof instagramConfig>,
  containerId: string,
): Promise<
  {
    ready: boolean;
    statusCode: InstagramContainerStatusCode;
    error: string | null;
  }
> {
  let response: Response;
  try {
    response = await fetchMetaGraphOnce({
      accessToken: config.accessToken,
      appSecret: config.appSecret,
      path: encodeURIComponent(containerId),
      query: { fields: "status_code,status" },
      timeoutMs: CONTAINER_STATUS_TIMEOUT_MS,
      fetchImpl,
    });
  } catch {
    return {
      ready: false,
      statusCode: "UNKNOWN",
      error: "status_request_failed",
    };
  }
  const body = await readBoundedMetaGraphJson(response);
  const decision = instagramContainerStatusDecision(body.status_code);
  if (!response.ok) {
    return {
      ready: false,
      statusCode: decision.statusCode,
      error: "status_request_failed",
    };
  }
  return decision.action === "ready"
    ? { ready: true, statusCode: decision.statusCode, error: null }
    : {
      ready: false,
      statusCode: decision.statusCode,
      error: decision.error,
    };
}

export async function publishInstagramJob(
  dependencies: PublishDependencies,
): Promise<InstagramPublishResult> {
  const { adminClient, actorId, jobId } = dependencies;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const caption = safeString(dependencies.caption, 2200);
  const altText = safeString(dependencies.altText, 1000);
  const copyValidation = validateSocialPublicationCopy([caption, altText]);

  if (!copyValidation.ok) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      instagramContainerId: null,
      instagramMediaId: null,
      instagramPermalink: null,
      publishedAt: null,
      error: copyValidation.error,
      message: copyValidation.message,
    });
  }

  if (
    !UUID_RE.test(jobId) || !UUID_RE.test(actorId) || !altText ||
    !TIMESTAMPTZ_RE.test(dependencies.expectedUpdatedAt) ||
    !SHA256_RE.test(dependencies.confirmationFingerprint) ||
    !SHA256_RE.test(dependencies.confirmationCopyHash)
  ) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      instagramContainerId: null,
      instagramMediaId: null,
      instagramPermalink: null,
      publishedAt: null,
      error: "invalid_instagram_publish_request",
      message: "The Instagram publishing request is invalid.",
    });
  }

  const config = dependencies.config || instagramConfig();
  if (!config.configured) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      instagramContainerId: null,
      instagramMediaId: null,
      instagramPermalink: null,
      publishedAt: null,
      error: "instagram_not_configured",
      message: "Instagram publishing is not configured yet.",
    });
  }
  if (!config.accountIdPinned) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      instagramContainerId: null,
      instagramMediaId: null,
      instagramPermalink: null,
      publishedAt: null,
      error: "instagram_graph_account_id_not_pinned",
      message:
        "Instagram publishing remains disabled until the runtime account id matches the independently stored expected account id.",
    });
  }
  if (!config.publishEnabled) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      instagramContainerId: null,
      instagramMediaId: null,
      instagramPermalink: null,
      publishedAt: null,
      error: "instagram_publish_disabled",
      message:
        "Instagram publishing is disabled until the server activation flag is approved.",
    });
  }

  try {
    const identityResponse = await fetchMetaGraphOnce({
      accessToken: config.accessToken,
      appSecret: config.appSecret,
      path: encodeURIComponent(config.accountId),
      query: { fields: "id,username" },
      timeoutMs: CONTAINER_STATUS_TIMEOUT_MS,
      fetchImpl,
    });
    const identityBody = await readBoundedMetaGraphJson(identityResponse);
    if (
      !identityResponse.ok ||
      !instagramIdentityMatches(identityBody, config.accountId)
    ) {
      return result({
        attempted: false,
        ok: false,
        status: null,
        job: null,
        instagramContainerId: null,
        instagramMediaId: null,
        instagramPermalink: null,
        publishedAt: null,
        error: "instagram_account_identity_mismatch",
        message:
          "The @mochirii_guild Business identity could not be verified before publishing.",
      });
    }
  } catch {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      instagramContainerId: null,
      instagramMediaId: null,
      instagramPermalink: null,
      publishedAt: null,
      error: "instagram_identity_check_failed",
      message:
        "The @mochirii_guild Business identity could not be verified before publishing.",
    });
  }

  try {
    const quotaResponse = await fetchMetaGraphOnce({
      accessToken: config.accessToken,
      appSecret: config.appSecret,
      path: `${encodeURIComponent(config.accountId)}/content_publishing_limit`,
      query: { fields: "quota_usage,config" },
      timeoutMs: CONTAINER_STATUS_TIMEOUT_MS,
      fetchImpl,
    });
    const quota = instagramPublishingQuota(
      await readBoundedMetaGraphJson(quotaResponse),
    );
    if (!quotaResponse.ok || !quota.readable || quota.exhausted) {
      return result({
        attempted: false,
        ok: false,
        status: null,
        job: null,
        instagramContainerId: null,
        instagramMediaId: null,
        instagramPermalink: null,
        publishedAt: null,
        error: quota.exhausted
          ? "instagram_publishing_quota_exhausted"
          : "instagram_publishing_quota_unavailable",
        message: quota.exhausted
          ? "Instagram publishing is at the provider-reported publishing limit."
          : "Instagram publishing quota could not be verified.",
      });
    }
  } catch {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      instagramContainerId: null,
      instagramMediaId: null,
      instagramPermalink: null,
      publishedAt: null,
      error: "instagram_publishing_quota_unavailable",
      message: "Instagram publishing quota could not be verified.",
    });
  }

  const { data: beginData, error: beginError } = await adminClient.rpc(
    "gallery_instagram_begin_publish",
    {
      p_job_id: jobId,
      p_actor_id: actorId,
      p_caption: caption,
      p_alt_text: altText,
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
    return result({
      attempted: false,
      ok: false,
      status: safeString(begin.status, 40),
      job: begunJob,
      instagramContainerId: null,
      instagramMediaId: null,
      instagramPermalink: null,
      publishedAt: null,
      error: beginError
        ? "instagram_job_lock_failed"
        : safeString(begin.reason, 80) || "instagram_job_not_publishable",
      message: beginError
        ? "The Instagram publishing job could not be locked."
        : "Only queued or failed Instagram jobs can be published.",
    });
  }

  const { data: sourceData, error: sourceError } = await adminClient.rpc(
    "gallery_instagram_publish_source",
    { p_job_id: jobId },
  );
  const source = rpcRecord(sourceData);
  if (sourceError || source.ok !== true) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "instagram_source_unavailable",
      message: "The approved Instagram image source is unavailable.",
    });
  }

  const bucket = safeString(source.bucket_id, 80);
  const storagePath = safeString(source.object_name, 1000);
  const objectId = safeString(source.object_id, 80);
  const hasObjectVersion = Object.prototype.hasOwnProperty.call(
    source,
    "object_version",
  );
  const objectVersion = safeString(source.object_version, 255);
  const objectUpdatedAt = safeString(source.object_updated_at, 80);
  const mimeType = safeString(source.mime_type, 80);
  const expectedSha256 = safeString(source.sha256, 64);
  const expectedSize = Number(source.size_bytes || 0);
  const expectedWidth = Number(source.width || 0);
  const expectedHeight = Number(source.height || 0);
  const sanitizerVersion = safeString(source.sanitizer_version, 100);
  const metadataPolicy = safeString(source.metadata_policy, 100);
  if (
    bucket !== "member-gallery" ||
    !storagePath ||
    !isGallerySocialDerivativeStoragePath(
      storagePath,
      safeString(source.submission_id, 80),
    ) || mimeType !== "image/jpeg" ||
    !objectId || !UUID_RE.test(objectId) || !hasObjectVersion ||
    (source.object_version != null && !objectVersion) || !objectUpdatedAt ||
    !/^[0-9a-f]{64}$/.test(expectedSha256 || "") ||
    !instagramFeedImageIsCompatible({
      mimeType,
      sizeBytes: expectedSize,
      width: expectedWidth,
      height: expectedHeight,
    }) ||
    sanitizerVersion !== "gallery-social-jpeg-v1" ||
    metadataPolicy !== "jfif-only-no-app-metadata-v1"
  ) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "instagram_source_invalid",
      message: "The approved Instagram image source is invalid.",
    });
  }

  const { data: blob, error: downloadError } = await adminClient.storage
    .from(bucket)
    .download(storagePath);
  if (downloadError || !blob) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "instagram_source_download_failed",
      message: "The approved Instagram image could not be loaded.",
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
      error: "instagram_source_verification_failed",
      message: "The approved Instagram image failed integrity verification.",
      details: {
        size_matches: bytes.byteLength === expectedSize,
        hash_matches: actualSha256 === expectedSha256,
        mime_matches: !blob.type || blob.type.toLowerCase() === mimeType,
      },
    });
  }

  const { data: signedData, error: signedError } = await adminClient.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);
  const signedUrl = safeString(signedData?.signedUrl, 4096);
  if (
    signedError || !signedUrl ||
    !instagramTemporaryMediaUrlIsSafe(
      signedUrl,
      Deno.env.get("SUPABASE_URL"),
    )
  ) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "instagram_signed_url_failed",
      message: "A temporary Instagram image URL could not be created.",
    });
  }

  const mediaParams = new URLSearchParams({
    image_url: signedUrl,
    alt_text: altText,
  });
  if (caption) mediaParams.set("caption", caption);

  let mediaResponse: Response;
  try {
    mediaResponse = await fetchMetaGraphOnce({
      accessToken: config.accessToken,
      appSecret: config.appSecret,
      path: `${encodeURIComponent(config.accountId)}/media`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: mediaParams,
      },
      timeoutMs: GRAPH_REQUEST_TIMEOUT_MS,
      fetchImpl,
    });
  } catch {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome: "reconcile_required",
      error: "instagram_publish_reconcile_required",
      message:
        "The Instagram container request ended without a confirmed result. Inspect the account before any retry.",
      details: { failure_stage: "container_request" },
    });
  }
  const mediaBody = await readBoundedMetaGraphJson(mediaResponse);
  const containerId = safeString(mediaBody.id, 255);
  if (!mediaResponse.ok || !containerId) {
    const providerFailure = instagramGraphFailure(
      mediaBody,
      mediaResponse.status,
      "container_create",
    );
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome: !mediaResponse.ok
        ? instagramGraphOutcome(mediaResponse.status)
        : "reconcile_required",
      error: !mediaResponse.ok &&
          instagramGraphOutcome(mediaResponse.status) === "failed"
        ? "instagram_container_failed"
        : "instagram_publish_reconcile_required",
      message: !mediaResponse.ok &&
          instagramGraphOutcome(mediaResponse.status) === "failed"
        ? providerFailure.message
        : "The Instagram container result is ambiguous. Inspect the account before any retry.",
      details: providerFailure.details,
    });
  }

  const container = await readContainerStatusOnce(
    fetchImpl,
    config,
    containerId,
  );
  if (!container.ready) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome: "reconcile_required",
      error: "instagram_publish_reconcile_required",
      message: container.error === "container_in_progress"
        ? "The Instagram media container is still processing. Publication stopped before media_publish; inspect and resolve the job before any new attempt."
        : "The Instagram media container state is ambiguous. Inspect it before any retry.",
      instagramContainerId: containerId,
      details: {
        failure_stage: "container_status",
        provider_status: container.statusCode,
      },
    });
  }

  const publishParams = new URLSearchParams({ creation_id: containerId });
  let publishResponse: Response;
  try {
    publishResponse = await fetchMetaGraphOnce({
      accessToken: config.accessToken,
      appSecret: config.appSecret,
      path: `${encodeURIComponent(config.accountId)}/media_publish`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: publishParams,
      },
      timeoutMs: GRAPH_REQUEST_TIMEOUT_MS,
      fetchImpl,
    });
  } catch {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome: "reconcile_required",
      error: "instagram_publish_reconcile_required",
      message:
        "The Instagram publish request ended without a confirmed result. Inspect the account before any retry.",
      instagramContainerId: containerId,
      details: { failure_stage: "publish_request" },
    });
  }

  const publishBody = await readBoundedMetaGraphJson(publishResponse);
  if (!publishResponse.ok) {
    const outcome = instagramGraphOutcome(publishResponse.status);
    const providerFailure = instagramGraphFailure(
      publishBody,
      publishResponse.status,
      "publish",
    );
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome,
      error: outcome === "reconcile_required"
        ? "instagram_publish_reconcile_required"
        : "instagram_publish_failed",
      message: outcome === "reconcile_required"
        ? "Meta returned an uncertain server result. Inspect the account before any retry."
        : providerFailure.message,
      instagramContainerId: containerId,
      details: providerFailure.details,
    });
  }

  const mediaId = safeString(publishBody.id, 255);
  if (!mediaId) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome: "reconcile_required",
      error: "instagram_publish_reconcile_required",
      message:
        "Meta accepted the publish request without a media id. Inspect the account before any retry.",
      instagramContainerId: containerId,
      details: {
        status_code: publishResponse.status,
        failure_stage: "publish_response",
      },
    });
  }

  let mediaEvidence: ReturnType<typeof instagramMediaObjectEvidence> | null =
    null;
  try {
    const evidenceResponse = await fetchMetaGraphOnce({
      accessToken: config.accessToken,
      appSecret: config.appSecret,
      path: encodeURIComponent(mediaId),
      query: { fields: "id,owner,username,permalink,media_type" },
      timeoutMs: CONTAINER_STATUS_TIMEOUT_MS,
      fetchImpl,
    });
    if (evidenceResponse.ok) {
      mediaEvidence = instagramMediaObjectEvidence(
        await readBoundedMetaGraphJson(evidenceResponse),
        mediaId,
        config.expectedAccountId,
      );
    }
  } catch {
    // Publishing already succeeded; this read must never trigger a retry.
  }
  const permalink = mediaEvidence?.permalink || null;
  if (!mediaEvidence?.verified || !permalink) {
    const reconciled = await finishPublish(adminClient, {
      jobId,
      actorId,
      outcome: "reconcile_required",
      instagramContainerId: containerId,
      instagramMediaId: mediaId,
      instagramPermalink: permalink,
      error:
        "Meta accepted the publish request, but official account ownership evidence could not be verified.",
      details: {
        failure_stage: "account_ownership_verification",
        provider_returned_media_id: true,
        provider_returned_permalink: Boolean(permalink),
      },
    });
    return result({
      attempted: true,
      ok: false,
      status: "reconcile_required",
      job: reconciled.job,
      instagramContainerId: containerId,
      instagramMediaId: mediaId,
      instagramPermalink: permalink,
      publishedAt: null,
      error: "instagram_ownership_reconcile_required",
      message:
        "Meta may have published the image, but the result could not be bound to @mochirii_guild. Inspect the official account before any retry.",
    });
  }

  const finished = await finishPublish(adminClient, {
    jobId,
    actorId,
    outcome: "published",
    instagramContainerId: containerId,
    instagramMediaId: mediaId,
    instagramPermalink: permalink,
    details: {
      status_code: publishResponse.status,
      has_permalink: Boolean(permalink),
      account_ownership_verified: true,
    },
  });
  if (!finished.committed || !finished.job) {
    return reconcileAfterAuditFailure(adminClient, {
      jobId,
      actorId,
      instagramContainerId: containerId,
      instagramMediaId: mediaId,
      instagramPermalink: permalink,
    });
  }

  return result({
    attempted: true,
    ok: true,
    status: "published",
    job: finished.job,
    instagramContainerId: containerId,
    instagramMediaId: mediaId,
    instagramPermalink: permalink,
    publishedAt: safeString(finished.job.published_at, 80),
    error: null,
    message: "Image published to @mochirii_guild.",
  });
}
