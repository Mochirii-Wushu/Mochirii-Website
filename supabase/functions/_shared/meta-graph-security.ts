export const META_GRAPH_ORIGIN = "https://graph.facebook.com";
export const META_GRAPH_API_VERSION = "v26.0";
export const META_GRAPH_REQUEST_TIMEOUT_MS = 30_000;
export const META_APP_SECRET_PROOF_MAX_AGE_SECONDS = 300;
export const META_TOKEN_DEBUG_QUERY_TRANSPORT_NOT_APPROVED =
  "meta_token_debug_query_transport_not_approved";

const GRAPH_PATH_RE = /^[A-Za-z0-9_.:-]+(?:\/[A-Za-z0-9_.:-]+)*$/;
const MAX_GRAPH_RESPONSE_BYTES = 64 * 1024;
const FORBIDDEN_QUERY_KEYS = new Set([
  "access_token",
  "input_token",
  "appsecret_proof",
  "appsecret_time",
]);

export type MetaGraphQuery = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;
export type MetaGraphFetchOptions = {
  accessToken: string;
  appSecret: string;
  path: string;
  query?: MetaGraphQuery;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
  nowUnixSeconds?: () => number;
  timeoutMs?: number;
};
export type MetaTimedAppSecretProof = {
  appsecretTime: string;
  appsecretProof: string;
};

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function validUnixSeconds(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function metaGraphApiVersionIsPinned(value: unknown): boolean {
  return value === META_GRAPH_API_VERSION;
}

export function metaGraphPathIsSafe(value: unknown): value is string {
  const path = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return Boolean(path) && path.length <= 512 && GRAPH_PATH_RE.test(path);
}

export async function createTimedMetaAppSecretProof(
  accessToken: string,
  appSecret: string,
  unixSeconds = Math.floor(Date.now() / 1000),
): Promise<MetaTimedAppSecretProof> {
  if (!accessToken || !appSecret || !validUnixSeconds(unixSeconds)) {
    throw new TypeError(
      "A token, app secret, and Unix timestamp are required.",
    );
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const appsecretTime = String(unixSeconds);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${accessToken}|${appsecretTime}`),
  );
  return { appsecretTime, appsecretProof: bytesToHex(signature) };
}

export function metaTimedProofIsFresh(
  proofTime: unknown,
  nowUnixSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const parsed = Number(proofTime);
  return validUnixSeconds(parsed) && validUnixSeconds(nowUnixSeconds) &&
    nowUnixSeconds >= parsed &&
    nowUnixSeconds - parsed <= META_APP_SECRET_PROOF_MAX_AGE_SECONDS;
}

export function metaGraphUrl(
  path: string,
  query: MetaGraphQuery = {},
): string {
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, "");
  if (!metaGraphPathIsSafe(normalizedPath)) return "";
  const url = new URL(
    `/${META_GRAPH_API_VERSION}/${normalizedPath}`,
    META_GRAPH_ORIGIN,
  );
  for (const [key, rawValue] of Object.entries(query)) {
    if (FORBIDDEN_QUERY_KEYS.has(key.toLowerCase())) return "";
    if (
      !/^[a-z][a-z0-9_]{0,63}$/i.test(key) ||
      rawValue === null || rawValue === undefined
    ) continue;
    const value = String(rawValue);
    if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
      return "";
    }
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function metaBearerRequestInit(
  accessToken: string,
  init: RequestInit = {},
  timeoutMs = META_GRAPH_REQUEST_TIMEOUT_MS,
): RequestInit {
  if (
    !accessToken || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    timeoutMs > 90_000
  ) throw new TypeError("A token and bounded timeout are required.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  return {
    ...init,
    headers,
    redirect: "error",
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  };
}

export async function buildAuthenticatedMetaGraphRequest(
  options: Omit<MetaGraphFetchOptions, "fetchImpl">,
): Promise<{ url: string; init: RequestInit; proof: MetaTimedAppSecretProof }> {
  const proof = await createTimedMetaAppSecretProof(
    options.accessToken,
    options.appSecret,
    options.nowUnixSeconds
      ? options.nowUnixSeconds()
      : Math.floor(Date.now() / 1000),
  );
  const baseUrl = metaGraphUrl(options.path, options.query);
  if (!baseUrl) throw new TypeError("The Meta Graph path or query is invalid.");
  const url = new URL(baseUrl);
  url.searchParams.set("appsecret_time", proof.appsecretTime);
  url.searchParams.set("appsecret_proof", proof.appsecretProof);
  if (
    url.origin !== META_GRAPH_ORIGIN ||
    !url.pathname.startsWith(`/${META_GRAPH_API_VERSION}/`) ||
    url.searchParams.has("access_token") ||
    url.searchParams.has("input_token")
  ) throw new TypeError("The request escaped the fixed Meta Graph boundary.");
  return {
    url: url.toString(),
    init: metaBearerRequestInit(
      options.accessToken,
      options.init,
      options.timeoutMs,
    ),
    proof,
  };
}

// Exactly one network attempt. Ambiguous mutation outcomes must reconcile.
export async function fetchMetaGraphOnce(
  options: MetaGraphFetchOptions,
): Promise<Response> {
  const request = await buildAuthenticatedMetaGraphRequest(options);
  return await (options.fetchImpl || fetch)(request.url, request.init);
}

export async function readBoundedMetaGraphJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) && declaredLength > MAX_GRAPH_RESPONSE_BYTES
  ) return {};
  if (!response.body) return {};

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_GRAPH_RESPONSE_BYTES) {
        await reader.cancel();
        return {};
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) return {};
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function metaMutatingResponseOutcome(
  status: number,
): "failed" | "reconcile_required" {
  return status >= 500 ? "reconcile_required" : "failed";
}

// The debugger requires input_token in a URL. That exception is not approved.
export function metaTokenDebuggerTransportApproved(): false {
  return false;
}
