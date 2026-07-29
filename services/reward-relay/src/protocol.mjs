import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const RELAY_PATHS = Object.freeze({
  readiness: "/v1/readiness",
  createOrder: "/v1/orders",
  lookupOrder: "/v1/orders/by-external-id",
  rewardState: "/v1/rewards/state",
  generateLink: "/v1/rewards/link",
});

export const RELAY_SIGNATURE_HEADERS = Object.freeze({
  timestamp: "x-mochirii-timestamp",
  nonce: "x-mochirii-nonce",
  bodyHash: "x-mochirii-body-sha256",
  signature: "x-mochirii-signature",
});

export const RELAY_RESPONSE_SIGNATURE_HEADERS = Object.freeze({
  bodyHash: "x-mochirii-response-body-sha256",
  signature: "x-mochirii-response-signature",
});

export const PROVIDER_REWARD_HOSTS = Object.freeze({
  sandbox: "testflight.tremendous.com",
  production: "reward.tremendous.com",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EXTERNAL_ID_RE = /^mochirii-mpd-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-v1$/i;

export function endpointClass(path) {
  for (const [name, value] of Object.entries(RELAY_PATHS)) {
    if (value === path) return name;
  }
  return "unknown";
}

export function canonicalRelayMessage({ method, path, timestamp, nonce, bodyHash }) {
  return [String(method).trim().toUpperCase(), normalizePath(path), String(timestamp), String(nonce), String(bodyHash).toLowerCase()].join("\n");
}

export function canonicalRelayResponseMessage({ path, status, requestTimestamp, requestNonce, bodyHash }) {
  return [
    "RESPONSE",
    normalizePath(path),
    String(status),
    String(requestTimestamp),
    String(requestNonce),
    String(bodyHash).toLowerCase(),
  ].join("\n");
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function compareCodeUnits(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  if (leftText === rightText) return 0;
  return leftText < rightText ? -1 : 1;
}

export function buildSignatureHeaders({ secret, method = "POST", path, body, timestampSeconds = Math.floor(Date.now() / 1_000), nonce }) {
  const bodyBytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const bodyHash = sha256Hex(bodyBytes);
  const timestamp = String(timestampSeconds);
  const signature = createHmac("sha256", secret).update(canonicalRelayMessage({
    method,
    path,
    timestamp,
    nonce,
    bodyHash,
  })).digest("hex");
  return {
    [RELAY_SIGNATURE_HEADERS.timestamp]: timestamp,
    [RELAY_SIGNATURE_HEADERS.nonce]: nonce,
    [RELAY_SIGNATURE_HEADERS.bodyHash]: bodyHash,
    [RELAY_SIGNATURE_HEADERS.signature]: signature,
  };
}

export function buildResponseSignatureHeaders({ secret, path, status, requestTimestamp, requestNonce, body }) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("invalid_response_secret");
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("invalid_response_status");
  const bodyHash = sha256Hex(Buffer.from(stableJson(body)));
  const signature = createHmac("sha256", secret).update(canonicalRelayResponseMessage({
    path,
    status,
    requestTimestamp,
    requestNonce,
    bodyHash,
  })).digest("hex");
  return {
    [RELAY_RESPONSE_SIGNATURE_HEADERS.bodyHash]: bodyHash,
    [RELAY_RESPONSE_SIGNATURE_HEADERS.signature]: signature,
  };
}

export function verifySignedResponse({ secret, path, status, requestTimestamp, requestNonce, headers, body }) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  if (!Number.isInteger(status) || status < 100 || status > 599) return false;
  if (!/^\d{10}$/.test(String(requestTimestamp)) || !/^[A-Za-z0-9_-]{16,128}$/.test(String(requestNonce))) return false;
  const suppliedBodyHash = header(headers, RELAY_RESPONSE_SIGNATURE_HEADERS.bodyHash).toLowerCase();
  const suppliedSignature = header(headers, RELAY_RESPONSE_SIGNATURE_HEADERS.signature).toLowerCase();
  if (!HASH_RE.test(suppliedBodyHash) || !HASH_RE.test(suppliedSignature)) return false;
  const bodyHash = sha256Hex(Buffer.from(stableJson(body)));
  if (!constantTimeHexEqual(bodyHash, suppliedBodyHash)) return false;
  const expected = createHmac("sha256", secret).update(canonicalRelayResponseMessage({
    path,
    status,
    requestTimestamp,
    requestNonce,
    bodyHash,
  })).digest("hex");
  return constantTimeHexEqual(expected, suppliedSignature);
}

export function verifySignedRequest({ secret, method, path, headers, body, state, nowMs = Date.now(), maxClockSkewSeconds = 60 }) {
  if (typeof secret !== "string" || secret.length < 32) return { ok: false };
  const timestamp = header(headers, RELAY_SIGNATURE_HEADERS.timestamp);
  const nonce = header(headers, RELAY_SIGNATURE_HEADERS.nonce);
  const suppliedBodyHash = header(headers, RELAY_SIGNATURE_HEADERS.bodyHash).toLowerCase();
  const suppliedSignature = header(headers, RELAY_SIGNATURE_HEADERS.signature).toLowerCase();
  if (!/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return { ok: false };
  if (!HASH_RE.test(suppliedBodyHash) || !HASH_RE.test(suppliedSignature)) return { ok: false };
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Math.floor(nowMs / 1_000) - timestampSeconds) > maxClockSkewSeconds) {
    return { ok: false };
  }
  const bodyHash = sha256Hex(body);
  if (!constantTimeHexEqual(bodyHash, suppliedBodyHash)) return { ok: false };
  const expected = createHmac("sha256", secret).update(canonicalRelayMessage({
    method,
    path,
    timestamp,
    nonce,
    bodyHash,
  })).digest("hex");
  if (!constantTimeHexEqual(expected, suppliedSignature)) return { ok: false };
  const expiresAtMs = (timestampSeconds + maxClockSkewSeconds + 1) * 1_000;
  if (!state.consumeNonce(nonce, expiresAtMs, nowMs)) return { ok: false };
  return { ok: true, timestamp, nonce, bodyHash };
}

export function parseRelayRequest(path, value) {
  const body = record(value);
  if (path === RELAY_PATHS.readiness) {
    exactKeys(body, ["operation", "environment", "configurationHash"]);
    return {
      operation: literal(body.operation, "readiness"),
      environment: environment(body.environment),
      configurationHash: hash(body.configurationHash),
    };
  }
  if (path === RELAY_PATHS.createOrder) {
    exactKeys(body, [
      "operation", "environment", "configurationHash", "cycleId", "drawResultId", "externalId", "countryCode",
      "campaignId", "productIds", "fundingSourceId", "denomination", "currencyCode", "deliveryMethod",
    ]);
    const productIds = boundedStringArray(body.productIds, 1, 50).map(identifier);
    return {
      operation: literal(body.operation, "create_order"),
      environment: environment(body.environment),
      configurationHash: hash(body.configurationHash),
      cycleId: uuid(body.cycleId),
      drawResultId: uuid(body.drawResultId),
      externalId: externalId(body.externalId),
      countryCode: countryCode(body.countryCode),
      campaignId: identifier(body.campaignId),
      productIds: [...new Set(productIds)].sort(),
      fundingSourceId: literal(body.fundingSourceId, "balance"),
      denomination: grossPrizeDollars(body.denomination),
      currencyCode: literal(body.currencyCode, "USD"),
      deliveryMethod: literal(body.deliveryMethod, "LINK"),
    };
  }
  if (path === RELAY_PATHS.lookupOrder) {
    exactKeys(body, ["operation", "environment", "externalId"]);
    return {
      operation: literal(body.operation, "lookup_order"),
      environment: environment(body.environment),
      externalId: externalId(body.externalId),
    };
  }
  if (path === RELAY_PATHS.rewardState) {
    exactKeys(body, ["operation", "environment", "rewardReference"]);
    return {
      operation: literal(body.operation, "reward_state"),
      environment: environment(body.environment),
      rewardReference: identifier(body.rewardReference),
    };
  }
  if (path === RELAY_PATHS.generateLink) {
    exactKeys(body, ["operation", "environment", "drawResultId", "rewardReference"]);
    return {
      operation: literal(body.operation, "generate_link"),
      environment: environment(body.environment),
      drawResultId: uuid(body.drawResultId),
      rewardReference: identifier(body.rewardReference),
    };
  }
  throw new Error("unsupported_path");
}

export function drawResultIdFromExternalId(value) {
  const match = EXTERNAL_ID_RE.exec(String(value));
  return match ? match[1].toLowerCase() : null;
}

export function safeTremendousHttpsLink(value, mode) {
  const url = new URL(String(value || ""));
  const hostname = url.hostname.toLowerCase();
  const expectedHost = PROVIDER_REWARD_HOSTS[mode];
  if (
    !expectedHost ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.startsWith("/rewards/") ||
    hostname !== expectedHost
  ) throw new Error("invalid_link");
  return url.toString();
}

function header(headers, name) {
  if (headers && typeof headers.get === "function") return String(headers.get(name) || "").trim();
  return String(headers?.[name] || headers?.[name.toLowerCase()] || "").trim();
}

function normalizePath(value) {
  const url = new URL(String(value || "/"), "https://relay.invalid");
  if (url.search || url.hash) throw new Error("invalid_path");
  return url.pathname.replace(/\/{2,}/g, "/");
}

function constantTimeHexEqual(left, right) {
  if (!HASH_RE.test(left) || !HASH_RE.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected_object");
  return value;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new Error("invalid_fields");
  }
}

function environment(value) {
  if (value !== "sandbox" && value !== "production") throw new Error("invalid_environment");
  return value;
}

function hash(value) {
  const text = String(value || "").toLowerCase();
  if (!HASH_RE.test(text)) throw new Error("invalid_hash");
  return text;
}

function uuid(value) {
  const text = String(value || "").toLowerCase();
  if (!UUID_RE.test(text)) throw new Error("invalid_uuid");
  return text;
}

function externalId(value) {
  const text = String(value || "").toLowerCase();
  if (!EXTERNAL_ID_RE.test(text)) throw new Error("invalid_external_id");
  return text;
}

function identifier(value) {
  const text = String(value || "").trim();
  if (!SAFE_ID_RE.test(text)) throw new Error("invalid_identifier");
  return text;
}

function countryCode(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(text)) throw new Error("invalid_country");
  return text;
}

function literal(value, expected) {
  if (value !== expected) throw new Error("invalid_literal");
  return expected;
}

function grossPrizeDollars(value) {
  if (!Number.isSafeInteger(value) || value < 10 || value > 50) {
    throw new Error("invalid_number");
  }
  return value;
}

function boundedStringArray(value, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error("invalid_array");
  return value.map((item) => String(item || "").trim());
}
