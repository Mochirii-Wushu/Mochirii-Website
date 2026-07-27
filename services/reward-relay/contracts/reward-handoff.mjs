import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const REWARD_HANDOFF_PATH = "/api/raffle/open-reward";
export const REWARD_HANDOFF_COOKIE = "__Secure-mochirii_reward_handoff";
export const REWARD_HANDOFF_MAX_AGE_SECONDS = 60;

const TOKEN_VERSION = "v2";
const RECORD_VERSION = 2;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export class RewardHandoffRejected extends Error {
  constructor() {
    super("not_found");
    this.name = "RewardHandoffRejected";
  }
}

export class MemoryRewardHandoffStore {
  #records = new Map();

  store(record) {
    const normalized = exactStoredRecord(record);
    this.#deleteExpired(normalized.issuedAt * 1_000);
    if (this.#records.has(normalized.handleDigest)) return false;
    this.#records.set(normalized.handleDigest, Object.freeze({ ...normalized }));
    return true;
  }

  consume({ handleDigest, memberId, environment, nowMs }) {
    const digest = sha256Digest(handleDigest);
    const expectedMemberId = identifier(memberId);
    const expectedEnvironment = rewardEnvironment(environment);
    const now = exactTime(nowMs);
    this.#deleteExpired(now);
    const record = this.#records.get(digest) || null;
    if (!record) return null;
    if (
      !constantTimeTextEqual(record.memberId, expectedMemberId) ||
      record.environment !== expectedEnvironment
    ) return null;
    this.#records.delete(digest);
    return record;
  }

  count() {
    return this.#records.size;
  }

  snapshot() {
    return [...this.#records.values()].map((record) => ({ ...record }));
  }

  #deleteExpired(nowMs) {
    for (const [handleDigest, record] of this.#records) {
      if (record.expiresAt * 1_000 <= nowMs) this.#records.delete(handleDigest);
    }
  }
}

export async function createRewardHandoff({
  key,
  origin,
  path = REWARD_HANDOFF_PATH,
  memberId,
  drawResultId,
  rewardReference,
  environment,
  storeHandoffHandle,
  nowMs = Date.now(),
  maxAgeSeconds = REWARD_HANDOFF_MAX_AGE_SECONDS,
  randomBytesFn = randomBytes,
}) {
  const signingKey = exactKey(key);
  const audience = exactOrigin(origin);
  const boundPath = exactPath(path);
  const issuedAt = wholeSeconds(nowMs);
  const ttl = boundedInteger(maxAgeSeconds, 1, REWARD_HANDOFF_MAX_AGE_SECONDS, "handoff lifetime");
  if (typeof storeHandoffHandle !== "function") throw new Error("Reward handoff store is missing.");
  const handleBytes = Buffer.from(randomBytesFn(32));
  if (handleBytes.length !== 32) throw new Error("Reward handoff handle generation failed.");
  const handle = handleBytes.toString("base64url");
  const record = Object.freeze({
    version: RECORD_VERSION,
    handleDigest: sha256Hex(handleBytes),
    memberId: identifier(memberId),
    drawResultId: uuid(drawResultId),
    rewardReference: identifier(rewardReference),
    environment: rewardEnvironment(environment),
    issuedAt,
    expiresAt: issuedAt + ttl,
  });
  const signature = signHandle({ key: signingKey, origin: audience, path: boundPath, handle });
  const token = `${TOKEN_VERSION}.${handle}.${signature}`;
  const setCookie = serializeCookie(token, ttl);
  if (await storeHandoffHandle(record) !== true) throw new Error("Reward handoff handle was not stored.");
  return Object.freeze({ token, setCookie, expiresAt: record.expiresAt });
}

export async function consumeRewardHandoff({
  cookieHeader,
  key,
  origin,
  host,
  path = REWARD_HANDOFF_PATH,
  memberId,
  environment,
  consumeHandoffHandle,
  nowMs = Date.now(),
}) {
  try {
    const audience = assertTrustedBrowserRequest({
      expectedOrigin: origin,
      requestHost: host,
      requestPath: path,
      expectedPath: REWARD_HANDOFF_PATH,
      requireOrigin: false,
    });
    if (typeof consumeHandoffHandle !== "function") throw new Error("missing handoff store");
    const { handle, signature } = readOpaqueHandle(readCookie(cookieHeader));
    const expectedSignature = signHandle({
      key: exactKey(key),
      origin: audience,
      path: REWARD_HANDOFF_PATH,
      handle,
    });
    if (!constantTimeTextEqual(signature, expectedSignature)) throw new Error("invalid handoff signature");
    const handleBytes = decodeCanonicalBase64Url(handle);
    if (handleBytes.length !== 32) throw new Error("invalid handoff handle");
    const handleDigest = sha256Hex(handleBytes);
    const currentEnvironment = rewardEnvironment(environment);
    const now = wholeSeconds(nowMs);
    const record = exactStoredRecord(await consumeHandoffHandle({
      handleDigest,
      memberId: identifier(memberId),
      environment: currentEnvironment,
      nowMs,
    }));
    if (
      record.version !== RECORD_VERSION ||
      record.environment !== currentEnvironment ||
      record.issuedAt > now + 5 ||
      record.expiresAt <= now ||
      record.expiresAt - record.issuedAt < 1 ||
      record.expiresAt - record.issuedAt > REWARD_HANDOFF_MAX_AGE_SECONDS ||
      !constantTimeTextEqual(record.handleDigest, handleDigest) ||
      !constantTimeTextEqual(record.memberId, identifier(memberId))
    ) throw new Error("invalid handoff");
    return Object.freeze({
      drawResultId: record.drawResultId,
      rewardReference: record.rewardReference,
      environment: record.environment,
      clearCookie: clearRewardHandoffCookie(),
    });
  } catch {
    throw new RewardHandoffRejected();
  }
}

export function assertTrustedBrowserRequest({
  expectedOrigin,
  requestOrigin,
  requestHost,
  requestPath,
  expectedPath,
  requireOrigin = true,
}) {
  try {
    const origin = exactOrigin(expectedOrigin);
    const expected = new URL(origin);
    if (String(requestHost || "").trim().toLowerCase() !== expected.host.toLowerCase()) throw new Error("invalid host");
    if (exactPath(requestPath) !== exactPath(expectedPath)) throw new Error("invalid path");
    if (requireOrigin && exactOrigin(requestOrigin) !== origin) throw new Error("invalid origin");
    return origin;
  } catch {
    throw new RewardHandoffRejected();
  }
}

export function clearRewardHandoffCookie() {
  return `${REWARD_HANDOFF_COOKIE}=; Path=${REWARD_HANDOFF_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function exactStoredRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid handoff record");
  const keys = Object.keys(value).sort();
  const expected = [
    "drawResultId", "environment", "expiresAt", "handleDigest", "issuedAt", "memberId",
    "rewardReference", "version",
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("invalid handoff record");
  }
  return {
    version: value.version,
    handleDigest: sha256Digest(value.handleDigest),
    memberId: identifier(value.memberId),
    drawResultId: uuid(value.drawResultId),
    rewardReference: identifier(value.rewardReference),
    environment: rewardEnvironment(value.environment),
    issuedAt: boundedInteger(value.issuedAt, 0, Number.MAX_SAFE_INTEGER, "handoff issued time"),
    expiresAt: boundedInteger(value.expiresAt, 0, Number.MAX_SAFE_INTEGER, "handoff expiry time"),
  };
}

function readOpaqueHandle(token) {
  const parts = String(token || "").split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== TOKEN_VERSION ||
    !BASE64URL_RE.test(parts[1]) ||
    !BASE64URL_RE.test(parts[2])
  ) throw new Error("invalid handoff token");
  const handle = decodeCanonicalBase64Url(parts[1]);
  const signature = decodeCanonicalBase64Url(parts[2]);
  if (handle.length !== 32 || signature.length !== 32) throw new Error("invalid handoff token");
  return { handle: parts[1], signature: parts[2] };
}

function signHandle({ key, origin, path, handle }) {
  return createHmac("sha256", key)
    .update(`mochirii-reward-handoff:${TOKEN_VERSION}\n${origin}\n${path}\n${handle}`)
    .digest("base64url");
}

function serializeCookie(token, maxAgeSeconds) {
  if (token.length > 256) throw new Error("Reward handoff cookie is too large.");
  return `${REWARD_HANDOFF_COOKIE}=${token}; Path=${REWARD_HANDOFF_PATH}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(value) {
  const header = String(value || "");
  if (!header || header.length > 16_384) throw new Error("invalid cookie");
  const matches = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${REWARD_HANDOFF_COOKIE}=`));
  if (matches.length !== 1) throw new Error("invalid cookie");
  const token = matches[0].slice(REWARD_HANDOFF_COOKIE.length + 1);
  if (!token || token.length > 256) throw new Error("invalid cookie");
  return token;
}

function decodeCanonicalBase64Url(value) {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("invalid token encoding");
  return decoded;
}

function exactKey(value) {
  const key = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : Buffer.alloc(0);
  if (key.length !== 32) throw new Error("Reward handoff requires a 32-byte signing key.");
  return key;
}

function exactOrigin(value) {
  const url = new URL(String(value || ""));
  if (
    url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    url.pathname !== "/" || url.port || !url.hostname
  ) throw new Error("Reward handoff origin is invalid.");
  return url.origin;
}

function exactPath(value) {
  const path = String(value || "");
  if (!/^\/[A-Za-z0-9/_-]{1,255}$/.test(path) || path.includes("//") || path.endsWith("/")) {
    throw new Error("Reward handoff path is invalid.");
  }
  return path;
}

function identifier(value) {
  const text = String(value || "").trim();
  if (!ID_RE.test(text)) throw new Error("Reward handoff identifier is invalid.");
  return text;
}

function uuid(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(text)) throw new Error("Reward handoff UUID is invalid.");
  return text;
}

function rewardEnvironment(value) {
  if (value !== "sandbox" && value !== "production") throw new Error("Reward handoff environment is invalid.");
  return value;
}

function sha256Digest(value) {
  const digest = String(value || "").toLowerCase();
  if (!HASH_RE.test(digest)) throw new Error("Reward handoff digest is invalid.");
  return digest;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactTime(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Reward handoff time is invalid.");
  return value;
}

function wholeSeconds(value) {
  return Math.floor(exactTime(value) / 1_000);
}

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is invalid.`);
  return value;
}

function constantTimeTextEqual(left, right) {
  const leftBytes = Buffer.from(String(left), "utf8");
  const rightBytes = Buffer.from(String(right), "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}
