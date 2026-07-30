export const GALLERY_SANITIZER_ATTESTATION_HEADER =
  "x-gallery-sanitizer-attestation";
export const GALLERY_LOCAL_SANITIZER_ATTESTATION = "gallery-local-sanitizer-v1";

const MAX_TOKEN_BYTES = 8 * 1024;
const MAX_JWKS_BYTES = 64 * 1024;
const MAX_JWKS_KEYS = 16;
const DEFAULT_TIMEOUT_MS = 5_000;
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LIFETIME_SECONDS = 3_700;
const VERCEL_OWNER = "mochirii";
const VERCEL_PROJECT = "mochirii";
const VERCEL_OWNER_ID = "team_kxEoikL8rs06zcQqN5w6TZN2";
const VERCEL_PROJECT_ID = "prj_iYdxmeRnENzAHWzeXgbDWpfieSEt";
const VERCEL_AUDIENCE = `https://vercel.com/${VERCEL_OWNER}`;
const ALLOWED_ENVIRONMENTS = new Set(["preview", "production"]);
const ISSUER_JWKS = new Map([
  [
    "https://oidc.vercel.com/mochirii",
    "https://oidc.vercel.com/mochirii/.well-known/jwks",
  ],
]);

type JsonRecord = Record<string, unknown>;
type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type CachedJwks = {
  expiresAt: number;
  keys: VerificationJwk[];
};

type VerificationJwk = JsonWebKey & { kid: string };

const jwksCache = new Map<string, CachedJwks>();

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function base64UrlBytes(value: string): Uint8Array | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padding = (4 - (value.length % 4)) % 4;
  try {
    return Uint8Array.from(
      atob(
        value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(padding),
      ),
      (character) => character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

function jsonSegment(value: string): JsonRecord | null {
  const bytes = base64UrlBytes(value);
  if (!bytes) return null;
  try {
    return asRecord(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    return null;
  }
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The remote body may already be closed.
  }
}

async function readBoundedJson(response: Response): Promise<JsonRecord | null> {
  if (!response.body) return null;
  const declared = Number(response.headers.get("content-length") || 0);
  if (
    declared &&
    (!Number.isSafeInteger(declared) || declared < 1 ||
      declared > MAX_JWKS_BYTES)
  ) {
    await cancelBody(response);
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value?.byteLength) continue;
      total += chunk.value.byteLength;
      if (total > MAX_JWKS_BYTES) {
        await reader.cancel("gallery_preview_jwks_too_large");
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  if (total < 2) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return asRecord(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    return null;
  }
}

function usableJwk(value: unknown): value is VerificationJwk {
  const key = asRecord(value);
  return key.kty === "RSA" && key.alg === "RS256" &&
    typeof key.kid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(key.kid) &&
    typeof key.n === "string" && /^[A-Za-z0-9_-]+$/.test(key.n) &&
    typeof key.e === "string" && /^[A-Za-z0-9_-]+$/.test(key.e) &&
    (key.use === undefined || key.use === "sig") &&
    (key.key_ops === undefined ||
      (Array.isArray(key.key_ops) && key.key_ops.includes("verify")));
}

async function loadJwks(
  issuer: string,
  fetchImpl: FetchLike,
  nowMs: number,
  timeoutMs: number,
  force = false,
): Promise<VerificationJwk[] | null> {
  const cached = jwksCache.get(issuer);
  if (!force && cached && cached.expiresAt > nowMs) return cached.keys;
  const jwksUrl = ISSUER_JWKS.get(issuer);
  if (!jwksUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(jwksUrl, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
  const contentType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0].trim().toLowerCase();
  if (
    !response.ok || response.status !== 200 ||
    contentType !== "application/json"
  ) {
    await cancelBody(response);
    return null;
  }
  const payload = await readBoundedJson(response);
  if (
    !payload || !Array.isArray(payload.keys) ||
    payload.keys.length > MAX_JWKS_KEYS
  ) {
    return null;
  }
  const keys = payload.keys.filter(usableJwk);
  if (keys.length < 1) return null;
  jwksCache.set(issuer, { expiresAt: nowMs + 5 * 60_000, keys });
  return keys;
}

function exactNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function claimsAreBound(
  payload: JsonRecord,
  issuer: string,
  nowSeconds: number,
) {
  const environment = typeof payload.environment === "string"
    ? payload.environment
    : "";
  const issuedAt = exactNumber(payload.iat);
  const notBefore = exactNumber(payload.nbf);
  const expiresAt = exactNumber(payload.exp);
  if (
    payload.iss !== issuer || payload.aud !== VERCEL_AUDIENCE ||
    payload.owner !== VERCEL_OWNER || payload.project !== VERCEL_PROJECT ||
    payload.owner_id !== VERCEL_OWNER_ID ||
    payload.project_id !== VERCEL_PROJECT_ID ||
    !ALLOWED_ENVIRONMENTS.has(environment) ||
    payload.sub !==
      `owner:${VERCEL_OWNER}:project:${VERCEL_PROJECT}:environment:${environment}` ||
    issuedAt === null || notBefore === null || expiresAt === null ||
    issuedAt > nowSeconds + CLOCK_SKEW_SECONDS ||
    notBefore > nowSeconds + CLOCK_SKEW_SECONDS ||
    expiresAt <= nowSeconds || expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_TOKEN_LIFETIME_SECONDS ||
    expiresAt - nowSeconds > MAX_TOKEN_LIFETIME_SECONDS
  ) {
    return false;
  }
  return true;
}

function exactLocalDevelopmentRequest(request: Request, supabaseUrl: string) {
  let requestUrl: URL;
  let configuredUrl: URL;
  try {
    requestUrl = new URL(request.url);
    configuredUrl = new URL(supabaseUrl);
  } catch {
    return false;
  }
  const isLocalHost = (hostname: string) =>
    hostname === "localhost" || hostname === "127.0.0.1";
  return requestUrl.protocol === "http:" &&
    configuredUrl.protocol === "http:" &&
    isLocalHost(requestUrl.hostname) && isLocalHost(configuredUrl.hostname) &&
    requestUrl.port === configuredUrl.port;
}

export async function galleryPreviewSanitizerIsAttested(
  request: Request,
  {
    fetchImpl = fetch,
    nowMs = Date.now(),
    supabaseUrl = "",
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: {
    fetchImpl?: FetchLike;
    nowMs?: number;
    supabaseUrl?: string;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const token = String(
    request.headers.get(GALLERY_SANITIZER_ATTESTATION_HEADER) || "",
  ).trim();
  if (!token || token.length > MAX_TOKEN_BYTES) return false;
  if (token === GALLERY_LOCAL_SANITIZER_ATTESTATION) {
    return exactLocalDevelopmentRequest(request, supabaseUrl);
  }
  const segments = token.split(".");
  if (segments.length !== 3) return false;
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = jsonSegment(encodedHeader);
  const payload = jsonSegment(encodedPayload);
  const signature = base64UrlBytes(encodedSignature);
  if (
    !header || !payload || !signature ||
    header.alg !== "RS256" ||
    String(header.typ || "").toUpperCase() !== "JWT" ||
    header.crit !== undefined ||
    typeof header.kid !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)
  ) {
    return false;
  }
  const issuer = typeof payload.iss === "string" ? payload.iss : "";
  if (!ISSUER_JWKS.has(issuer)) return false;
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!claimsAreBound(payload, issuer, nowSeconds)) return false;

  let keys = await loadJwks(issuer, fetchImpl, nowMs, timeoutMs);
  let jwk = keys?.find((candidate) => candidate.kid === header.kid) || null;
  if (!jwk) {
    keys = await loadJwks(issuer, fetchImpl, nowMs, timeoutMs, true);
    jwk = keys?.find((candidate) => candidate.kid === header.kid) || null;
  }
  if (!jwk) return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      Uint8Array.from(signature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
  } catch {
    return false;
  }
}
