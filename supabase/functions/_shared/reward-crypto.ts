const encoder = new TextEncoder();

export const RELAY_SIGNATURE_HEADERS = {
  timestamp: "x-mochirii-timestamp",
  nonce: "x-mochirii-nonce",
  bodyHash: "x-mochirii-body-sha256",
  signature: "x-mochirii-signature",
} as const;

export const RELAY_RESPONSE_SIGNATURE_HEADERS = {
  bodyHash: "x-mochirii-response-body-sha256",
  signature: "x-mochirii-response-signature",
} as const;

export const PROVIDER_WEBHOOK_SIGNATURE_HEADER = "Tremendous-Webhook-Signature";

export type RelaySignatureInput = {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
};

export type RelayResponseSignatureInput = {
  path: string;
  status: number;
  requestTimestamp: string;
  requestNonce: string;
  bodyHash: string;
};

export type ReplayStore = {
  consume(nonce: string, expiresAtMs: number): boolean | Promise<boolean>;
};

export type RelayVerificationResult =
  | { ok: true; bodyHash: string; timestampSeconds: number; nonce: string }
  | {
    ok: false;
    reason:
      | "missing_secret"
      | "body_too_large"
      | "missing_header"
      | "invalid_timestamp"
      | "expired_timestamp"
      | "invalid_nonce"
      | "body_hash_mismatch"
      | "invalid_signature"
      | "replayed_nonce";
  };

export function canonicalRelayMessage(input: RelaySignatureInput): string {
  const method = input.method.trim().toUpperCase();
  const path = normalizeRelayPath(input.path);
  return [
    method,
    path,
    input.timestamp,
    input.nonce,
    input.bodyHash.toLowerCase(),
  ].join("\n");
}

export function canonicalRelayResponseMessage(
  input: RelayResponseSignatureInput,
): string {
  return [
    "RESPONSE",
    normalizeRelayPath(input.path),
    String(input.status),
    input.requestTimestamp,
    input.requestNonce,
    input.bodyHash.toLowerCase(),
  ].join("\n");
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      compareCodeUnits(left, right)
    );
    return `{${
      entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(",")
    }}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Relay response contains a non-JSON value.");
  }
  return serialized;
}

export function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export async function sha256Hex(body: string | Uint8Array): Promise<string> {
  const bytes = typeof body === "string" ? encoder.encode(body) : body;
  return hex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes))),
  );
}

export async function hmacSha256Hex(
  secret: string,
  value: string | Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return hex(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(bytes))),
  );
}

export async function buildRelaySignatureHeaders(input: {
  secret: string;
  method: string;
  path: string;
  body: string;
  timestampSeconds?: number;
  nonce?: string;
}): Promise<Record<string, string>> {
  if (!input.secret) throw new Error("Relay signing secret is required.");
  const timestamp = String(
    input.timestampSeconds ?? Math.floor(Date.now() / 1_000),
  );
  const nonce = input.nonce || crypto.randomUUID();
  const bodyHash = await sha256Hex(input.body);
  const signature = await hmacSha256Hex(
    input.secret,
    canonicalRelayMessage({
      method: input.method,
      path: input.path,
      timestamp,
      nonce,
      bodyHash,
    }),
  );

  return {
    [RELAY_SIGNATURE_HEADERS.timestamp]: timestamp,
    [RELAY_SIGNATURE_HEADERS.nonce]: nonce,
    [RELAY_SIGNATURE_HEADERS.bodyHash]: bodyHash,
    [RELAY_SIGNATURE_HEADERS.signature]: signature,
  };
}

export async function buildRelayResponseSignatureHeaders(input: {
  secret: string;
  path: string;
  status: number;
  requestTimestamp: string;
  requestNonce: string;
  body: unknown;
}): Promise<Record<string, string>> {
  if (input.secret.length < 32) {
    throw new Error("Relay response signing secret is not configured.");
  }
  if (
    !Number.isInteger(input.status) || input.status < 100 || input.status > 599
  ) {
    throw new Error("Relay response status is invalid.");
  }
  const bodyHash = await sha256Hex(stableJson(input.body));
  const signature = await hmacSha256Hex(
    input.secret,
    canonicalRelayResponseMessage({
      path: input.path,
      status: input.status,
      requestTimestamp: input.requestTimestamp,
      requestNonce: input.requestNonce,
      bodyHash,
    }),
  );
  return {
    [RELAY_RESPONSE_SIGNATURE_HEADERS.bodyHash]: bodyHash,
    [RELAY_RESPONSE_SIGNATURE_HEADERS.signature]: signature,
  };
}

export async function verifyRelayResponse(input: {
  secret: string;
  path: string;
  status: number;
  requestTimestamp: string;
  requestNonce: string;
  headers: Headers;
  body: unknown;
}): Promise<boolean> {
  try {
    if (input.secret.length < 32) return false;
    if (
      !Number.isInteger(input.status) || input.status < 100 ||
      input.status > 599 ||
      !/^\d{10}$/.test(input.requestTimestamp) ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestNonce)
    ) {
      return false;
    }
    const suppliedBodyHash = input.headers.get(
      RELAY_RESPONSE_SIGNATURE_HEADERS.bodyHash,
    )?.trim().toLowerCase() || "";
    const suppliedSignature = input.headers.get(
      RELAY_RESPONSE_SIGNATURE_HEADERS.signature,
    )?.trim().toLowerCase() || "";
    if (
      !/^[0-9a-f]{64}$/.test(suppliedBodyHash) ||
      !/^[0-9a-f]{64}$/.test(suppliedSignature)
    ) {
      return false;
    }
    const bodyHash = await sha256Hex(stableJson(input.body));
    if (!constantTimeHexEquals(bodyHash, suppliedBodyHash)) return false;
    const expectedSignature = await hmacSha256Hex(
      input.secret,
      canonicalRelayResponseMessage({
        path: input.path,
        status: input.status,
        requestTimestamp: input.requestTimestamp,
        requestNonce: input.requestNonce,
        bodyHash,
      }),
    );
    return constantTimeHexEquals(expectedSignature, suppliedSignature);
  } catch {
    return false;
  }
}

export async function verifyRelayRequest(input: {
  secret: string;
  method: string;
  path: string;
  headers: Headers;
  body: Uint8Array;
  replayStore: ReplayStore;
  nowMs?: number;
  maxBodyBytes?: number;
  maxClockSkewSeconds?: number;
}): Promise<RelayVerificationResult> {
  if (!input.secret) return { ok: false, reason: "missing_secret" };
  if (input.body.byteLength > (input.maxBodyBytes ?? 16_384)) {
    return { ok: false, reason: "body_too_large" };
  }

  const timestamp =
    input.headers.get(RELAY_SIGNATURE_HEADERS.timestamp)?.trim() || "";
  const nonce = input.headers.get(RELAY_SIGNATURE_HEADERS.nonce)?.trim() || "";
  const suppliedBodyHash =
    input.headers.get(RELAY_SIGNATURE_HEADERS.bodyHash)?.trim().toLowerCase() ||
    "";
  const suppliedSignature =
    input.headers.get(RELAY_SIGNATURE_HEADERS.signature)?.trim()
      .toLowerCase() || "";
  if (!timestamp || !nonce || !suppliedBodyHash || !suppliedSignature) {
    return { ok: false, reason: "missing_header" };
  }

  if (!/^\d{10,13}$/.test(timestamp)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  const nowMs = input.nowMs ?? Date.now();
  const skewSeconds = input.maxClockSkewSeconds ?? 60;
  if (Math.abs(Math.floor(nowMs / 1_000) - timestampSeconds) > skewSeconds) {
    return { ok: false, reason: "expired_timestamp" };
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    return { ok: false, reason: "invalid_nonce" };
  }
  if (
    !/^[0-9a-f]{64}$/.test(suppliedBodyHash) ||
    !/^[0-9a-f]{64}$/.test(suppliedSignature)
  ) {
    return { ok: false, reason: "invalid_signature" };
  }

  const bodyHash = await sha256Hex(input.body);
  if (!constantTimeHexEquals(bodyHash, suppliedBodyHash)) {
    return { ok: false, reason: "body_hash_mismatch" };
  }
  const expectedSignature = await hmacSha256Hex(
    input.secret,
    canonicalRelayMessage({
      method: input.method,
      path: input.path,
      timestamp,
      nonce,
      bodyHash,
    }),
  );
  if (!constantTimeHexEquals(expectedSignature, suppliedSignature)) {
    return { ok: false, reason: "invalid_signature" };
  }

  const consumed = await input.replayStore.consume(
    nonce,
    nowMs + skewSeconds * 1_000,
  );
  if (!consumed) return { ok: false, reason: "replayed_nonce" };
  return { ok: true, bodyHash, timestampSeconds, nonce };
}

export async function verifyProviderWebhookSignature(input: {
  secret: string;
  rawBody: Uint8Array;
  signature: string | null;
  maxBodyBytes?: number;
}): Promise<
  { ok: true; bodyHash: string } | {
    ok: false;
    reason: "missing_secret" | "body_too_large" | "invalid_signature";
  }
> {
  if (!input.secret) return { ok: false, reason: "missing_secret" };
  if (input.rawBody.byteLength > (input.maxBodyBytes ?? 65_536)) {
    return { ok: false, reason: "body_too_large" };
  }
  const supplied = normalizeHmacSignature(input.signature);
  if (!supplied) return { ok: false, reason: "invalid_signature" };
  const expected = await hmacSha256Hex(input.secret, input.rawBody);
  if (!constantTimeHexEquals(expected, supplied)) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true, bodyHash: await sha256Hex(input.rawBody) };
}

export function normalizeHmacSignature(
  value: string | null | undefined,
): string | null {
  const normalized = String(value || "").trim().toLowerCase().replace(
    /^sha256=/,
    "",
  );
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export function constantTimeHexEquals(left: string, right: string): boolean {
  const leftValid = /^(?:[0-9a-f]{2})+$/i.test(left);
  const rightValid = /^(?:[0-9a-f]{2})+$/i.test(right);
  const leftBytes = decodeHex(left);
  const rightBytes = decodeHex(right);
  const length = Math.max(leftBytes.length, rightBytes.length, 1);
  let mismatch = leftBytes.length ^ rightBytes.length ^ (leftValid ? 0 : 1) ^
    (rightValid ? 0 : 2);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

export function constantTimeTextEquals(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length, 1);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

export class MemoryReplayStore implements ReplayStore {
  #nonces = new Map<string, number>();

  consume(nonce: string, expiresAtMs: number): boolean {
    const now = Date.now();
    for (const [key, expiry] of this.#nonces) {
      if (expiry <= now) this.#nonces.delete(key);
    }
    if (this.#nonces.has(nonce)) return false;
    this.#nonces.set(nonce, expiresAtMs);
    return true;
  }
}

function normalizeRelayPath(value: string): string {
  const raw = value.trim();
  if (
    !raw.startsWith("/") || raw.includes("?") || raw.includes("#") ||
    raw.includes("\n") || raw.includes("\r")
  ) {
    throw new Error(
      "Relay paths must be absolute and must not include a query or fragment.",
    );
  }
  return raw.replace(/\/{2,}/g, "/");
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function decodeHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return new Uint8Array();
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
