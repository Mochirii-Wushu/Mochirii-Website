import type { SupabaseClient } from "@supabase/supabase-js";
import { isGallerySocialDerivativeStoragePath } from "./gallery-social-path.ts";

export type JsonRecord = Record<string, unknown>;

const INSTAGRAM_GRAPH_BASE_URL = "https://graph.facebook.com";
const INSTAGRAM_ACCOUNT_ID_RE = /^\d{5,30}$/;
const INSTAGRAM_API_VERSION_RE = /^v\d{1,3}\.\d{1,2}$/;
const INSTAGRAM_EXPECTED_USERNAME = "mochirii_guild";
const META_EXPECTED_APP_ID = "4210347289109364";
const GRAPH_REQUEST_TIMEOUT_MS = 60_000;
const CONTAINER_STATUS_TIMEOUT_MS = 30_000;
const CONTAINER_POLL_ATTEMPTS = 10;
const CONTAINER_POLL_INTERVAL_MS = 1_000;
const INSTAGRAM_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const INSTAGRAM_MIN_WIDTH = 320;
const INSTAGRAM_MAX_WIDTH = 1440;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number) => Promise<void>;
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

export function instagramJobIdIsValid(value: unknown): boolean {
  return UUID_RE.test(String(value ?? "").trim());
}

export function instagramConfig() {
  const accountId = Deno.env.get("INSTAGRAM_ACCOUNT_ID") || "";
  const expectedAccountId =
    Deno.env.get("INSTAGRAM_EXPECTED_ACCOUNT_ID") || "";
  const accessToken = Deno.env.get("INSTAGRAM_ACCESS_TOKEN") || "";
  const apiVersion = Deno.env.get("INSTAGRAM_API_VERSION") || "";
  const publishFlag = Deno.env.get("INSTAGRAM_PUBLISH_ENABLED") || "";
  const appId = Deno.env.get("META_APP_ID") || "";
  const appSecret = Deno.env.get("META_APP_SECRET") || "";
  const missingSecrets = [
    ["INSTAGRAM_ACCOUNT_ID", accountId],
    ["INSTAGRAM_EXPECTED_ACCOUNT_ID", expectedAccountId],
    ["INSTAGRAM_ACCESS_TOKEN", accessToken],
    ["INSTAGRAM_API_VERSION", apiVersion],
    ["META_APP_ID", appId],
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
    ...(appId && appId !== META_EXPECTED_APP_ID ? ["META_APP_ID"] : []),
  ];
  const accountIdPinned = instagramAccountIdMatchesCanonicalPin(
    accountId,
    expectedAccountId,
  );

  return {
    accountId,
    accessToken,
    apiVersion,
    appId,
    appSecret,
    expectedAppId: META_EXPECTED_APP_ID,
    expectedUsername: INSTAGRAM_EXPECTED_USERNAME,
    accountIdPinned,
    publishEnabled: instagramPublishFlagEnabled(publishFlag),
    configured: missingSecrets.length === 0 && invalidFields.length === 0,
    missingSecrets,
    invalidFields,
  };
}

export async function instagramAppSecretProof(
  appSecret: string,
  accessToken: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(accessToken),
  );
  return Array.from(
    new Uint8Array(signature),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function instagramProofUrl(
  rawUrl: string,
  appSecretProof: string,
): string {
  const url = new URL(rawUrl);
  url.searchParams.set("appsecret_proof", appSecretProof);
  return url.toString();
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
  return INSTAGRAM_API_VERSION_RE.test(value);
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
  const cleanPath = path.replace(/^\/+/, "");
  return `${INSTAGRAM_GRAPH_BASE_URL}/${version}/${cleanPath}`;
}

export function instagramTokenRequestInit(
  accessToken: string,
  init: RequestInit = {},
): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return {
    ...init,
    headers,
    redirect: "error",
  };
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
  const accountType = safeString(identity.account_type, 80)?.toUpperCase();
  return id === configuredAccountId &&
    username === INSTAGRAM_EXPECTED_USERNAME &&
    accountType === "BUSINESS";
}

export function instagramIdentitySummary(value: unknown): JsonRecord | null {
  const identity = value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
  const id = safeString(identity.id, 80);
  if (!id) return null;
  return {
    id,
    username: safeString(identity.username, 80),
    accountType: safeString(identity.account_type, 80),
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
  return status >= 500 ? "reconcile_required" : "failed";
}

async function readGraphJson(response: Response): Promise<JsonRecord> {
  try {
    return asRecord(await response.json());
  } catch {
    return {};
  }
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
    console.error("Instagram publish outcome commit failed", {
      code: error.code,
      message: error.message,
      jobId: values.jobId,
      outcome: values.outcome,
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

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForContainer(
  fetchImpl: typeof fetch,
  sleepImpl: (milliseconds: number) => Promise<void>,
  config: ReturnType<typeof instagramConfig>,
  appSecretProof: string,
  containerId: string,
): Promise<
  { ready: boolean; statusCode: string | null; error: string | null }
> {
  const statusUrl = instagramGraphUrl(
    config.apiVersion,
    `${encodeURIComponent(containerId)}?fields=status_code,status`,
  );
  if (!statusUrl) {
    return { ready: false, statusCode: null, error: "invalid_status_url" };
  }

  for (let attempt = 1; attempt <= CONTAINER_POLL_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(
        instagramProofUrl(statusUrl, appSecretProof),
        instagramTokenRequestInit(config.accessToken, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(CONTAINER_STATUS_TIMEOUT_MS),
        }),
      );
    } catch {
      return { ready: false, statusCode: null, error: "status_request_failed" };
    }
    const body = await readGraphJson(response);
    const statusCode = safeString(body.status_code, 80)?.toUpperCase() || null;
    if (!response.ok) {
      return { ready: false, statusCode, error: "status_request_failed" };
    }
    if (statusCode === "FINISHED") {
      return { ready: true, statusCode, error: null };
    }
    if (statusCode && statusCode !== "IN_PROGRESS") {
      return { ready: false, statusCode, error: "container_failed" };
    }
    if (attempt < CONTAINER_POLL_ATTEMPTS) {
      await sleepImpl(CONTAINER_POLL_INTERVAL_MS);
    }
  }

  return {
    ready: false,
    statusCode: "IN_PROGRESS",
    error: "container_timeout",
  };
}

export async function publishInstagramJob(
  dependencies: PublishDependencies,
): Promise<InstagramPublishResult> {
  const { adminClient, actorId, jobId } = dependencies;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const sleepImpl = dependencies.sleepImpl || defaultSleep;
  const caption = safeString(dependencies.caption, 2200) ||
    "A pretty gameplay showcase from Mōchirīī.";
  const altText = safeString(dependencies.altText, 1000);

  if (!UUID_RE.test(jobId) || !UUID_RE.test(actorId)) {
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

  const config = instagramConfig();
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

  const appSecretProof = await instagramAppSecretProof(
    config.appSecret,
    config.accessToken,
  );

  const identityUrl = instagramGraphUrl(
    config.apiVersion,
    `${encodeURIComponent(config.accountId)}?fields=id,username,account_type`,
  );
  if (!identityUrl) {
    return result({
      attempted: false,
      ok: false,
      status: null,
      job: null,
      instagramContainerId: null,
      instagramMediaId: null,
      instagramPermalink: null,
      publishedAt: null,
      error: "instagram_invalid_configuration",
      message: "Instagram publishing configuration is invalid.",
    });
  }

  try {
    const identityResponse = await fetchImpl(
      instagramProofUrl(identityUrl, appSecretProof),
      instagramTokenRequestInit(config.accessToken, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(CONTAINER_STATUS_TIMEOUT_MS),
      }),
    );
    const identityBody = await readGraphJson(identityResponse);
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

  const { data: beginData, error: beginError } = await adminClient.rpc(
    "gallery_instagram_begin_publish",
    {
      p_job_id: jobId,
      p_actor_id: actorId,
      p_caption: caption,
      p_alt_text: altText,
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
      details: { reason: safeString(source.reason, 80) },
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
  if (signedError || !signedData?.signedUrl) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "instagram_signed_url_failed",
      message: "A temporary Instagram image URL could not be created.",
    });
  }

  const mediaUrl = instagramGraphUrl(
    config.apiVersion,
    `${encodeURIComponent(config.accountId)}/media`,
  );
  const publishUrl = instagramGraphUrl(
    config.apiVersion,
    `${encodeURIComponent(config.accountId)}/media_publish`,
  );
  if (!mediaUrl || !publishUrl) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: false,
      outcome: "failed",
      error: "instagram_api_version_invalid",
      message: "The Instagram Graph API version is invalid.",
    });
  }

  const mediaParams = new URLSearchParams({
    image_url: signedData.signedUrl,
    caption,
  });
  if (altText) mediaParams.set("alt_text", altText);

  let mediaResponse: Response;
  try {
    mediaResponse = await fetchImpl(
      instagramProofUrl(mediaUrl, appSecretProof),
      instagramTokenRequestInit(config.accessToken, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: mediaParams,
        signal: AbortSignal.timeout(GRAPH_REQUEST_TIMEOUT_MS),
      }),
    );
  } catch {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome: "failed",
      error: "instagram_container_request_failed",
      message: "The Instagram media container request did not complete.",
      details: { failure_stage: "container_request" },
    });
  }
  const mediaBody = await readGraphJson(mediaResponse);
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
      outcome: "failed",
      error: "instagram_container_failed",
      message: providerFailure.message,
      details: providerFailure.details,
    });
  }

  const container = await waitForContainer(
    fetchImpl,
    sleepImpl,
    config,
    appSecretProof,
    containerId,
  );
  if (!container.ready) {
    return finishFailure(adminClient, {
      jobId,
      actorId,
      attempted: true,
      outcome: "failed",
      error: container.error === "container_timeout"
        ? "instagram_container_in_progress"
        : "instagram_container_failed",
      message: container.error === "container_timeout"
        ? "The Instagram media container remained in progress. No publish request was sent."
        : "The Instagram media container did not become publishable.",
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
    publishResponse = await fetchImpl(
      instagramProofUrl(publishUrl, appSecretProof),
      instagramTokenRequestInit(config.accessToken, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: publishParams,
        signal: AbortSignal.timeout(GRAPH_REQUEST_TIMEOUT_MS),
      }),
    );
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

  const publishBody = await readGraphJson(publishResponse);
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

  let permalink: string | null = null;
  const permalinkUrl = instagramGraphUrl(
    config.apiVersion,
    `${encodeURIComponent(mediaId)}?fields=permalink`,
  );
  try {
    const permalinkResponse = await fetchImpl(
      instagramProofUrl(permalinkUrl, appSecretProof),
      instagramTokenRequestInit(config.accessToken, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(CONTAINER_STATUS_TIMEOUT_MS),
      }),
    );
    if (permalinkResponse.ok) {
      const permalinkBody = await readGraphJson(permalinkResponse);
      permalink = normalizeInstagramPostPermalink(permalinkBody.permalink);
    }
  } catch {
    // Publishing already succeeded. Missing permalink is non-fatal.
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
