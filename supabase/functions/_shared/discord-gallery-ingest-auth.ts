export const DISCORD_GALLERY_INGEST_WIRE_CONTRACT =
  "discord-gallery-ingest-hmac.v1";
export const DISCORD_GALLERY_INGEST_HMAC_KEYS_ENV =
  "DISCORD_GALLERY_INGEST_HMAC_KEYS_JSON";
export const DISCORD_GALLERY_INGEST_PATH =
  "/functions/v1/submit-discord-gallery-image";
export const DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS = 60;
export const DISCORD_GALLERY_INGEST_MAX_BODY_BYTES = 16 * 1024;
export const DISCORD_GALLERY_SUPABASE_ORIGIN =
  "https://deyvmtncimmcinldjyqe.supabase.co";

export const DISCORD_GALLERY_INGEST_HEADERS = {
  keyId: "x-mochirii-gallery-key-id",
  timestamp: "x-mochirii-gallery-timestamp",
  nonce: "x-mochirii-gallery-nonce",
  signature: "x-mochirii-gallery-signature",
} as const;

const AUTH_VERSION = "v1";
const MAX_KEY_COUNT = 3;
const MAX_KEY_SET_BYTES = 4 * 1024;
const MIN_HMAC_KEY_BYTES = 32;
const MAX_HMAC_KEY_BYTES = 128;
const KEY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const TIMESTAMP_RE = /^[1-9][0-9]{9,12}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const SIGNATURE_RE = /^v1=([0-9a-f]{64})$/;
const encoder = new TextEncoder();

export type DiscordGalleryIngestHmacKeys = Readonly<Record<string, string>>;

export type DiscordGalleryIngestVerification =
  | { ok: true; keyId: string }
  | {
    ok: false;
    status: 401 | 503;
    error:
      | "invalid_request"
      | "replayed_request"
      | "verification_unavailable";
  };

export type DiscordGalleryIngestVerificationDependencies = {
  keys: DiscordGalleryIngestHmacKeys;
  consumeNonce: (
    keyId: string,
    nonce: string,
    expiresAt: string,
  ) => Promise<boolean>;
  nowMs?: number;
  method: string;
  path: string;
};

export type DiscordGalleryIngestBodyRead =
  | { ok: true; rawBodyBytes: Uint8Array<ArrayBuffer> }
  | {
    ok: false;
    status: 400 | 408 | 413;
    error: "invalid_request_body" | "request_timeout" | "request_too_large";
  };

export type DiscordGalleryIngestAuthenticatedBody =
  | { ok: true; keyId: string; bodyText: string }
  | {
    ok: false;
    status: 400 | 401 | 503;
    error:
      | "invalid_request"
      | "invalid_request_body"
      | "replayed_request"
      | "verification_unavailable";
  };

type ParsedJsonString = { value: string; nextIndex: number };
type ParsedJsonPrimitive = { value: unknown; nextIndex: number };

function skipJsonWhitespace(raw: string, startIndex: number): number {
  let index = startIndex;
  while (index < raw.length && /[\t\n\r ]/.test(raw[index])) index += 1;
  return index;
}

function parseJsonStringAt(
  raw: string,
  startIndex: number,
): ParsedJsonString | null {
  if (raw[startIndex] !== '"') return null;
  let escaped = false;
  for (let index = startIndex + 1; index < raw.length; index += 1) {
    const character = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character !== '"') continue;
    try {
      const value = JSON.parse(raw.slice(startIndex, index + 1));
      return typeof value === "string" ? { value, nextIndex: index + 1 } : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseJsonPrimitiveAt(
  raw: string,
  startIndex: number,
): ParsedJsonPrimitive | null {
  const stringValue = parseJsonStringAt(raw, startIndex);
  if (stringValue) return stringValue;

  const primitive =
    /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/
      .exec(raw.slice(startIndex));
  if (!primitive) return null;
  try {
    return {
      value: JSON.parse(primitive[0]),
      nextIndex: startIndex + primitive[0].length,
    };
  } catch {
    return null;
  }
}

export function parseDiscordGalleryIngestJsonRecord(
  raw: string,
): Record<string, unknown> | null {
  let index = skipJsonWhitespace(raw, 0);
  if (raw[index] !== "{") return null;
  index = skipJsonWhitespace(raw, index + 1);
  const result = Object.create(null) as Record<string, unknown>;
  const seen = new Set<string>();
  if (raw[index] === "}") {
    index = skipJsonWhitespace(raw, index + 1);
    return index === raw.length ? result : null;
  }

  for (;;) {
    const key = parseJsonStringAt(raw, index);
    if (!key || seen.has(key.value)) return null;
    seen.add(key.value);
    index = skipJsonWhitespace(raw, key.nextIndex);
    if (raw[index] !== ":") return null;
    index = skipJsonWhitespace(raw, index + 1);
    const value = parseJsonPrimitiveAt(raw, index);
    if (!value) return null;
    result[key.value] = value.value;
    index = skipJsonWhitespace(raw, value.nextIndex);
    if (raw[index] === "}") {
      index = skipJsonWhitespace(raw, index + 1);
      return index === raw.length ? result : null;
    }
    if (raw[index] !== ",") return null;
    index = skipJsonWhitespace(raw, index + 1);
  }
}

function parseFlatStringMap(raw: string): Record<string, string> | null {
  const parsed = parseDiscordGalleryIngestJsonRecord(raw);
  if (
    !parsed || Object.values(parsed).some((value) => typeof value !== "string")
  ) {
    return null;
  }
  return parsed as Record<string, string>;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function secretIsValid(secret: string): boolean {
  const length = encoder.encode(secret).byteLength;
  return length >= MIN_HMAC_KEY_BYTES && length <= MAX_HMAC_KEY_BYTES;
}

export function exactDiscordGalleryIngestPath(
  requestUrl: string,
): string | null {
  try {
    const url = new URL(requestUrl);
    if (
      url.protocol !== "https:" ||
      url.origin !== DISCORD_GALLERY_SUPABASE_ORIGIN ||
      url.username || url.password || url.port || url.search || url.hash
    ) return null;

    // Edge Functions expose the WHATWG-normalized Request.url, not the raw
    // HTTP request-target. The HMAC contract therefore binds this exact
    // runtime pathname. Raw-target normalization must be enforced upstream.
    return url.pathname === DISCORD_GALLERY_INGEST_PATH
      ? DISCORD_GALLERY_INGEST_PATH
      : null;
  } catch {
    return null;
  }
}

export function exactDiscordGallerySupabaseOrigin(
  rawValue: unknown,
): typeof DISCORD_GALLERY_SUPABASE_ORIGIN | null {
  if (rawValue !== DISCORD_GALLERY_SUPABASE_ORIGIN) return null;
  try {
    const url = new URL(rawValue);
    return url.protocol === "https:" &&
        url.origin === DISCORD_GALLERY_SUPABASE_ORIGIN &&
        url.username === "" && url.password === "" && url.port === "" &&
        url.pathname === "/" && url.search === "" && url.hash === ""
      ? DISCORD_GALLERY_SUPABASE_ORIGIN
      : null;
  } catch {
    return null;
  }
}

export async function readDiscordGalleryIngestBody(
  request: Request,
  maxBytes = DISCORD_GALLERY_INGEST_MAX_BODY_BYTES,
  timeoutMs = 5_000,
): Promise<DiscordGalleryIngestBodyRead> {
  if (
    !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    request.signal.aborted
  ) {
    return { ok: false, status: 400, error: "invalid_request_body" };
  }

  const mediaType = (request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, status: 400, error: "invalid_request_body" };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/.test(normalizedLength)) {
      return { ok: false, status: 400, error: "invalid_request_body" };
    }
    const declaredBytes = Number(normalizedLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      return { ok: false, status: 400, error: "invalid_request_body" };
    }
    if (declaredBytes > maxBytes) {
      return { ok: false, status: 413, error: "request_too_large" };
    }
  }

  if (!request.body) {
    return {
      ok: true,
      rawBodyBytes: new Uint8Array(),
    };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let timedOut = false;
  let aborted = false;
  const cancelReader = (reason: "timeout" | "abort") => {
    if (reason === "timeout") timedOut = true;
    else aborted = true;
    void reader.cancel(reason).catch(() => undefined);
  };
  const onAbort = () => cancelReader("abort");
  request.signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => cancelReader("timeout"), timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "request_too_large" };
      }
      chunks.push(Uint8Array.from(value));
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    if (timedOut) {
      return { ok: false, status: 408, error: "request_timeout" };
    }
    if (aborted) {
      return { ok: false, status: 400, error: "invalid_request_body" };
    }
    return { ok: false, status: 400, error: "invalid_request_body" };
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  if (timedOut) {
    return { ok: false, status: 408, error: "request_timeout" };
  }
  if (aborted) {
    return { ok: false, status: 400, error: "invalid_request_body" };
  }

  if (
    declaredLength !== null &&
    Number(declaredLength.trim()) !== totalBytes
  ) {
    return { ok: false, status: 400, error: "invalid_request_body" };
  }

  const rawBodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    rawBodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, rawBodyBytes };
}

export function decodeDiscordGalleryIngestBody(
  rawBodyBytes: Uint8Array<ArrayBuffer>,
): string | null {
  // This runs only after exact-byte HMAC verification and nonce consumption.
  // Reject U+FEFF anywhere rather than letting a decoder strip a leading UTF-8
  // BOM or accepting an invisible embedded payload character.
  let bodyText: string;
  try {
    bodyText = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(rawBodyBytes);
  } catch {
    return null;
  }
  if (bodyText.includes("\uFEFF")) {
    return null;
  }

  return bodyText;
}

export function parseDiscordGalleryIngestHmacKeys(
  rawValue: string | null | undefined,
): DiscordGalleryIngestHmacKeys | null {
  const raw = String(rawValue || "").trim();
  if (!raw || encoder.encode(raw).byteLength > MAX_KEY_SET_BYTES) return null;
  const parsed = parseFlatStringMap(raw);
  if (!parsed) return null;
  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > MAX_KEY_COUNT) return null;

  const keys = Object.create(null) as Record<string, string>;
  const uniqueSecrets = new Set<string>();
  for (const [keyId, secret] of entries) {
    if (
      !KEY_ID_RE.test(keyId) || !secretIsValid(secret) ||
      uniqueSecrets.has(secret)
    ) return null;
    uniqueSecrets.add(secret);
    keys[keyId] = secret;
  }
  return Object.freeze(keys);
}

async function sha256Hex(value: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return bytesToHex(new Uint8Array(digest));
}

async function canonicalBytes(input: {
  keyId: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBodyBytes: Uint8Array<ArrayBuffer>;
}): Promise<Uint8Array<ArrayBuffer>> {
  const bodyDigest = await sha256Hex(input.rawBodyBytes);
  return encoder.encode([
    AUTH_VERSION,
    input.keyId,
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    bodyDigest,
  ].join("\n"));
}

async function hmacHex(
  secret: string,
  value: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, value);
  return bytesToHex(new Uint8Array(signature));
}

export function constantTimeLowerHexMatches(
  expected: string,
  actual: string,
): boolean {
  if (
    expected.length !== actual.length || !/^[0-9a-f]+$/.test(expected) ||
    !/^[0-9a-f]+$/.test(actual)
  ) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyDiscordGalleryIngestRequest(
  headers: Headers,
  rawBodyBytes: Uint8Array<ArrayBuffer>,
  dependencies: DiscordGalleryIngestVerificationDependencies,
): Promise<DiscordGalleryIngestVerification> {
  const keyId = headers.get(DISCORD_GALLERY_INGEST_HEADERS.keyId) || "";
  const timestamp = headers.get(DISCORD_GALLERY_INGEST_HEADERS.timestamp) || "";
  const nonce = headers.get(DISCORD_GALLERY_INGEST_HEADERS.nonce) || "";
  const signature = headers.get(DISCORD_GALLERY_INGEST_HEADERS.signature) || "";
  const signatureMatch = SIGNATURE_RE.exec(signature);
  const secret = dependencies.keys[keyId] || "";

  if (
    !KEY_ID_RE.test(keyId) || !TIMESTAMP_RE.test(timestamp) ||
    !NONCE_RE.test(nonce) || !signatureMatch || !secretIsValid(secret) ||
    rawBodyBytes.byteLength > DISCORD_GALLERY_INGEST_MAX_BODY_BYTES ||
    dependencies.method.toUpperCase() !== "POST" ||
    dependencies.path !== DISCORD_GALLERY_INGEST_PATH
  ) return { ok: false, status: 401, error: "invalid_request" };

  const requestSeconds = Number(timestamp);
  const nowSeconds = Math.floor((dependencies.nowMs ?? Date.now()) / 1000);
  if (
    !Number.isSafeInteger(requestSeconds) ||
    Math.abs(nowSeconds - requestSeconds) >
      DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS
  ) return { ok: false, status: 401, error: "invalid_request" };

  const expected = await hmacHex(
    secret,
    await canonicalBytes({
      keyId,
      method: dependencies.method,
      path: dependencies.path,
      timestamp,
      nonce,
      rawBodyBytes,
    }),
  );
  if (!constantTimeLowerHexMatches(expected, signatureMatch[1])) {
    return { ok: false, status: 401, error: "invalid_request" };
  }

  const expiresAt = new Date(
    (requestSeconds + DISCORD_GALLERY_INGEST_MAX_SKEW_SECONDS + 5) * 1000,
  ).toISOString();
  try {
    if (!await dependencies.consumeNonce(keyId, nonce, expiresAt)) {
      return { ok: false, status: 401, error: "replayed_request" };
    }
  } catch {
    return { ok: false, status: 503, error: "verification_unavailable" };
  }

  return { ok: true, keyId };
}

export async function authenticateDiscordGalleryIngestBody(
  headers: Headers,
  rawBodyBytes: Uint8Array<ArrayBuffer>,
  dependencies: DiscordGalleryIngestVerificationDependencies,
): Promise<DiscordGalleryIngestAuthenticatedBody> {
  const verification = await verifyDiscordGalleryIngestRequest(
    headers,
    rawBodyBytes,
    dependencies,
  );
  if (!verification.ok) return verification;

  const bodyText = decodeDiscordGalleryIngestBody(rawBodyBytes);
  if (bodyText === null) {
    return { ok: false, status: 400, error: "invalid_request_body" };
  }
  return { ok: true, keyId: verification.keyId, bodyText };
}
