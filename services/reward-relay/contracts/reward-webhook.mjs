import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const REWARD_WEBHOOK_SIGNATURE_HEADER = "Tremendous-Webhook-Signature";
export const rewardWebhookMaxBytes = 65_536;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/;
const REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function processRewardWebhook({ rawBody, signature, secret, environment, eventStore }) {
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength > rewardWebhookMaxBytes) return rejected(413);
  if (typeof secret !== "string" || secret.length < 32) return rejected(503);
  if (!eventStore || typeof eventStore.record !== "function") return rejected(503);
  const supplied = normalizeSignature(signature);
  if (!supplied) return rejected(401);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!constantTimeHexEqual(expected, supplied)) return rejected(401);

  let event;
  try {
    event = normalizeEvent({ rawBody, environment, bodyHash: sha256Hex(rawBody) });
  } catch {
    return rejected(400);
  }
  const outcome = eventStore.record(event);
  if (outcome === "accepted") return Object.freeze({ status: 200, body: Object.freeze({ ok: true, status: event.processingStatus }) });
  if (outcome === "duplicate") return Object.freeze({ status: 200, body: Object.freeze({ ok: true, status: "duplicate" }) });
  if (outcome === "conflict") return Object.freeze({ status: 409, body: Object.freeze({ ok: false, error: "event_identity_conflict" }) });
  return rejected(503);
}

export class MemoryRewardWebhookEventStore {
  #events = new Map();

  record(event) {
    const existing = this.#events.get(event.eventUuid);
    const serialized = JSON.stringify(event);
    if (!existing) {
      this.#events.set(event.eventUuid, serialized);
      return "accepted";
    }
    return constantTimeTextEqual(existing, serialized) ? "duplicate" : "conflict";
  }

  count() {
    return this.#events.size;
  }

  snapshot() {
    return [...this.#events.values()].map((value) => JSON.parse(value));
  }
}

export function signRewardWebhook(rawBody, secret) {
  if (!(rawBody instanceof Uint8Array) || typeof secret !== "string" || secret.length < 32) {
    throw new Error("Webhook signing input is invalid.");
  }
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function normalizeEvent({ rawBody, environment, bodyHash }) {
  if (!["sandbox", "production"].includes(environment)) throw new Error("invalid environment");
  const parsed = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
  const eventUuid = text(parsed.uuid || parsed.id).toLowerCase();
  const eventType = text(parsed.event_type || parsed.type || parsed.event).toLowerCase();
  const occurredAt = isoTimestamp(parsed.created_utc || parsed.occurred_at || parsed.created_at || parsed.timestamp);
  if (!UUID_RE.test(eventUuid) || !EVENT_RE.test(eventType)) throw new Error("invalid event");
  const payload = optionalRecord(parsed.payload) || optionalRecord(parsed.data) || {};
  const resource = optionalRecord(payload.resource) || optionalRecord(payload.object) || optionalRecord(parsed.resource) || {};
  const resourceReference = optionalReference(
    resource.uuid || resource.id || payload.resource_uuid || payload.resource_id || parsed.resource_uuid || parsed.resource_id,
  );
  const resourceType = optionalType(resource.type || payload.resource_type || parsed.resource_type);
  const category = eventCategory(eventType);
  return Object.freeze({
    eventUuid,
    eventType,
    eventCategory: category,
    resourceType,
    resourceReference,
    environment,
    occurredAt,
    bodyHash,
    processingStatus: category === "unknown" ? "ignored" : "queued",
  });
}

function eventCategory(value) {
  const eventType = value.replace(/-/g, "_");
  if (/^orders?[._]/.test(eventType)) return "order";
  if (/^rewards?[._]/.test(eventType)) return "reward";
  if (/^fraud_reviews?[._]/.test(eventType) || /^fraud[._]/.test(eventType)) return "fraud";
  if (/^products?[._]/.test(eventType)) return "product";
  if (/^campaigns?[._]/.test(eventType)) return "campaign";
  if (/^funding_sources?[._]/.test(eventType) || /^funding[._]/.test(eventType)) return "funding";
  if (/^topups?[._]/.test(eventType) || /^top_ups?[._]/.test(eventType)) return "top_up";
  return "unknown";
}

function normalizeSignature(value) {
  const signature = String(value || "").trim().toLowerCase().replace(/^sha256=/, "");
  return /^[0-9a-f]{64}$/.test(signature) ? signature : null;
}

function optionalReference(value) {
  const candidate = text(value);
  if (!candidate) return null;
  if (!REFERENCE_RE.test(candidate)) throw new Error("invalid resource reference");
  return candidate;
}

function optionalType(value) {
  const candidate = text(value).toLowerCase();
  if (!candidate) return null;
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(candidate)) throw new Error("invalid resource type");
  return candidate;
}

function optionalRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function isoTimestamp(value) {
  const candidate = text(value);
  const timestamp = Date.parse(candidate);
  if (!candidate || !Number.isFinite(timestamp)) throw new Error("invalid timestamp");
  return new Date(timestamp).toISOString();
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeHexEqual(left, right) {
  const leftBytes = /^[0-9a-f]{64}$/i.test(left) ? Buffer.from(left, "hex") : Buffer.alloc(32);
  const rightBytes = /^[0-9a-f]{64}$/i.test(right) ? Buffer.from(right, "hex") : Buffer.alloc(32);
  return timingSafeEqual(leftBytes, rightBytes) && /^[0-9a-f]{64}$/i.test(left) && /^[0-9a-f]{64}$/i.test(right);
}

function constantTimeTextEqual(left, right) {
  const leftBytes = Buffer.from(String(left), "utf8");
  const rightBytes = Buffer.from(String(right), "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

function rejected(status) {
  const body = status === 503 ? { ok: false, error: "service_unavailable" } : { ok: false, error: "invalid_request" };
  return Object.freeze({ status, body: Object.freeze(body) });
}
