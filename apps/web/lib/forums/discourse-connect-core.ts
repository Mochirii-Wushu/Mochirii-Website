import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { FORUMS_DISCOURSE_CONNECT_CALLBACK } from "./discourse-connect-callback.ts";

const MAX_ENCODED_PAYLOAD_BYTES = 4_096;
const MAX_DECODED_PAYLOAD_BYTES = 2_048;
const DISCOURSE_NONCE_PATTERN = /^[0-9a-f]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const USERNAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export type VerifiedDiscourseConnectRequest = Readonly<{
  nonce: string;
  returnUrl: typeof FORUMS_DISCOURSE_CONNECT_CALLBACK;
}>;

export type DiscourseConnectRequestVerification =
  | Readonly<{ ok: true; request: VerifiedDiscourseConnectRequest }>
  | Readonly<{ ok: false; reason: "invalid_signature" | "malformed_payload" | "invalid_return_url" }>;

function hmacHex(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function exactSignatureMatch(expectedHex: string, receivedHex: string) {
  if (!HEX_SHA256_PATTERN.test(receivedHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(receivedHex, "hex"));
}

function strictBase64Decode(payload: string): string | null {
  if (
    !payload
    || Buffer.byteLength(payload, "utf8") > MAX_ENCODED_PAYLOAD_BYTES
    || !BASE64_PATTERN.test(payload)
  ) {
    return null;
  }

  const decoded = Buffer.from(payload, "base64");
  if (decoded.length === 0 || decoded.length > MAX_DECODED_PAYLOAD_BYTES) return null;
  if (decoded.toString("base64") !== payload) return null;

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    return null;
  }
}

export function verifyDiscourseConnectRequest({
  encodedPayload,
  signatureHex,
  secret,
}: {
  encodedPayload: string;
  signatureHex: string;
  secret: string;
}): DiscourseConnectRequestVerification {
  if (
    typeof encodedPayload !== "string"
    || typeof signatureHex !== "string"
    || Buffer.byteLength(encodedPayload, "utf8") > MAX_ENCODED_PAYLOAD_BYTES
  ) {
    return { ok: false, reason: "malformed_payload" };
  }

  // DiscourseConnect signs the exact Base64 text. Do not decode or parse
  // attacker-controlled bytes until this constant-time comparison succeeds.
  if (!exactSignatureMatch(hmacHex(encodedPayload, secret), signatureHex)) {
    return { ok: false, reason: "invalid_signature" };
  }

  const decodedPayload = strictBase64Decode(encodedPayload);
  if (!decodedPayload) return { ok: false, reason: "malformed_payload" };

  const fields = new URLSearchParams(decodedPayload);
  const keys = [...fields.keys()];
  if (
    keys.length !== 2
    || fields.getAll("nonce").length !== 1
    || fields.getAll("return_sso_url").length !== 1
    || keys.some((key) => key !== "nonce" && key !== "return_sso_url")
  ) {
    return { ok: false, reason: "malformed_payload" };
  }

  const nonce = fields.get("nonce") || "";
  if (!DISCOURSE_NONCE_PATTERN.test(nonce)) {
    return { ok: false, reason: "malformed_payload" };
  }

  const returnUrl = fields.get("return_sso_url") || "";
  if (returnUrl !== FORUMS_DISCOURSE_CONNECT_CALLBACK) {
    return { ok: false, reason: "invalid_return_url" };
  }

  return {
    ok: true,
    request: {
      nonce,
      returnUrl: FORUMS_DISCOURSE_CONNECT_CALLBACK,
    },
  };
}

function base32Prefix(bytes: Uint8Array, length: number) {
  let bits = 0;
  let bitCount = 0;
  let output = "";

  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5 && output.length < length) {
      output += USERNAME_ALPHABET[(bits >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
    if (output.length === length) return output;
  }

  if (bitCount > 0 && output.length < length) {
    output += USERNAME_ALPHABET[(bits << (5 - bitCount)) & 31];
  }
  return output.slice(0, length);
}

export function deterministicForumsUsername(memberId: string) {
  if (!UUID_PATTERN.test(memberId)) throw new TypeError("Member identifier is invalid.");
  const digest = createHash("sha256")
    .update(`mochirii-forums-username-v1:${memberId.toLowerCase()}`, "utf8")
    .digest();
  return `m_${base32Prefix(digest, 18)}`;
}

export function normalizedForumsDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  const length = [...normalized].length;
  if (length < 2 || length > 40 || CONTROL_OR_BIDI_PATTERN.test(normalized)) return null;
  return normalized;
}

export function normalizedForumsEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (
    !email
    || email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || CONTROL_OR_BIDI_PATTERN.test(email)
  ) {
    return null;
  }
  return email;
}

export function buildForumsDiscourseConnectRedirect({
  nonce,
  email,
  externalId,
  username,
  name,
  secret,
}: {
  nonce: string;
  email: string;
  externalId: string;
  username: string;
  name: string;
  secret: string;
}) {
  if (!DISCOURSE_NONCE_PATTERN.test(nonce)) throw new TypeError("Nonce is invalid.");
  if (!UUID_PATTERN.test(externalId)) throw new TypeError("Member identifier is invalid.");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new TypeError("Username is invalid.");
  if (!normalizedForumsDisplayName(name) || normalizedForumsDisplayName(name) !== name) {
    throw new TypeError("Display name is invalid.");
  }
  if (!normalizedForumsEmail(email) || normalizedForumsEmail(email) !== email) {
    throw new TypeError("Email address is invalid.");
  }

  const responseFields = new URLSearchParams([
    ["nonce", nonce],
    ["email", email],
    ["external_id", externalId.toLowerCase()],
    ["username", username],
    ["name", name],
    ["admin", "false"],
    ["moderator", "false"],
  ]);
  const encodedPayload = Buffer.from(responseFields.toString(), "utf8").toString("base64");
  const signatureHex = hmacHex(encodedPayload, secret);
  const callback = new URL(FORUMS_DISCOURSE_CONNECT_CALLBACK);
  callback.searchParams.set("sso", encodedPayload);
  callback.searchParams.set("sig", signatureHex);
  return callback.href;
}
