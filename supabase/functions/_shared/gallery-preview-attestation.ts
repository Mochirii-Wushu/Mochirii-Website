export const GALLERY_SANITIZER_ATTESTATION_HEADER =
  "x-gallery-sanitizer-attestation";
export const GALLERY_LOCAL_SANITIZER_ATTESTATION = "gallery-local-sanitizer-v1";

const MAX_TOKEN_BYTES = 8 * 1024;
const MAX_JWKS_BYTES = 64 * 1024;
const MAX_JWKS_KEYS = 16;
const DEFAULT_TIMEOUT_MS = 5_000;
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LIFETIME_SECONDS = 3_700;
const VERCEL_OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const VERCEL_PROJECT_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/;
const VERCEL_OWNER_ID_PATTERN = /^team_[A-Za-z0-9]{16,64}$/;
const VERCEL_PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9]{16,64}$/;
const ALLOWED_ENVIRONMENTS = new Set(["preview", "production"]);

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

export type GalleryPreviewVercelIdentity = Readonly<{
  owner: string;
  ownerId: string;
  project: string;
  projectId: string;
}>;

type GalleryPreviewVercelIdentityInput = Readonly<{
  owner?: unknown;
  ownerId?: unknown;
  project?: unknown;
  projectId?: unknown;
}>;

type DerivedVercelIdentity =
  & GalleryPreviewVercelIdentity
  & Readonly<{
    audience: string;
    issuer: string;
    jwksUrl: string;
  }>;

type EnvReader = (name: string) => string | undefined;

const jwksCache = new Map<string, CachedJwks>();

function exactPin(
  value: unknown,
  pattern: RegExp,
  extraCheck: (pin: string) => boolean = () => true,
) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  return pattern.test(value) && extraCheck(value) ? value : null;
}

function deriveVercelIdentity(
  value: GalleryPreviewVercelIdentityInput | null | undefined,
): DerivedVercelIdentity | null {
  if (!value || typeof value !== "object") return null;
  const owner = exactPin(value.owner, VERCEL_OWNER_PATTERN);
  const ownerId = exactPin(value.ownerId, VERCEL_OWNER_ID_PATTERN);
  const project = exactPin(
    value.project,
    VERCEL_PROJECT_PATTERN,
    (pin) => !pin.includes("---"),
  );
  const projectId = exactPin(value.projectId, VERCEL_PROJECT_ID_PATTERN);
  if (!owner || !ownerId || !project || !projectId) return null;

  const issuer = `https://oidc.vercel.com/${owner}`;
  const jwksUrl = `${issuer}/.well-known/jwks`;
  let parsedJwksUrl: URL;
  try {
    parsedJwksUrl = new URL(jwksUrl);
  } catch {
    return null;
  }
  if (
    parsedJwksUrl.protocol !== "https:" ||
    parsedJwksUrl.hostname !== "oidc.vercel.com" ||
    parsedJwksUrl.port !== "" || parsedJwksUrl.username !== "" ||
    parsedJwksUrl.password !== "" || parsedJwksUrl.search !== "" ||
    parsedJwksUrl.hash !== "" ||
    parsedJwksUrl.pathname !== `/${owner}/.well-known/jwks`
  ) {
    return null;
  }

  return {
    owner,
    ownerId,
    project,
    projectId,
    issuer,
    jwksUrl: parsedJwksUrl.href,
    audience: `https://vercel.com/${owner}`,
  };
}

export function galleryPreviewVercelIdentityFromEnv(
  getEnv: EnvReader = (name) => Deno.env.get(name),
): GalleryPreviewVercelIdentity | null {
  const identity = {
    owner: getEnv("GALLERY_PREVIEW_VERCEL_OWNER"),
    ownerId: getEnv("GALLERY_PREVIEW_VERCEL_OWNER_ID"),
    project: getEnv("GALLERY_PREVIEW_VERCEL_PROJECT"),
    projectId: getEnv("GALLERY_PREVIEW_VERCEL_PROJECT_ID"),
  };
  const derived = deriveVercelIdentity(identity);
  return derived
    ? {
      owner: derived.owner,
      ownerId: derived.ownerId,
      project: derived.project,
      projectId: derived.projectId,
    }
    : null;
}

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
  identity: DerivedVercelIdentity,
  fetchImpl: FetchLike,
  nowMs: number,
  timeoutMs: number,
  force = false,
): Promise<VerificationJwk[] | null> {
  const cached = jwksCache.get(identity.issuer);
  if (!force && cached && cached.expiresAt > nowMs) return cached.keys;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(identity.jwksUrl, {
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
  jwksCache.set(identity.issuer, { expiresAt: nowMs + 5 * 60_000, keys });
  return keys;
}

function exactNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function claimsAreBound(
  payload: JsonRecord,
  identity: DerivedVercelIdentity,
  nowSeconds: number,
) {
  const environment = typeof payload.environment === "string"
    ? payload.environment
    : "";
  const issuedAt = exactNumber(payload.iat);
  const notBefore = exactNumber(payload.nbf);
  const expiresAt = exactNumber(payload.exp);
  if (
    payload.iss !== identity.issuer || payload.aud !== identity.audience ||
    payload.owner !== identity.owner || payload.project !== identity.project ||
    payload.owner_id !== identity.ownerId ||
    payload.project_id !== identity.projectId ||
    !ALLOWED_ENVIRONMENTS.has(environment) ||
    payload.sub !==
      `owner:${identity.owner}:project:${identity.project}:environment:${environment}` ||
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
    vercelIdentity = null,
  }: {
    fetchImpl?: FetchLike;
    nowMs?: number;
    supabaseUrl?: string;
    timeoutMs?: number;
    vercelIdentity?: GalleryPreviewVercelIdentity | null;
  } = {},
): Promise<boolean> {
  const token = String(
    request.headers.get(GALLERY_SANITIZER_ATTESTATION_HEADER) || "",
  ).trim();
  if (!token || token.length > MAX_TOKEN_BYTES) return false;
  if (token === GALLERY_LOCAL_SANITIZER_ATTESTATION) {
    return exactLocalDevelopmentRequest(request, supabaseUrl);
  }
  const identity = deriveVercelIdentity(vercelIdentity);
  if (!identity) return false;
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
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!claimsAreBound(payload, identity, nowSeconds)) return false;

  let keys = await loadJwks(identity, fetchImpl, nowMs, timeoutMs);
  let jwk = keys?.find((candidate) => candidate.kid === header.kid) || null;
  if (!jwk) {
    keys = await loadJwks(identity, fetchImpl, nowMs, timeoutMs, true);
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
