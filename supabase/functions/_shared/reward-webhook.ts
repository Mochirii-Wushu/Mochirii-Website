import type { ActiveProviderMode } from "./reward-relay-contract.ts";

export type NormalizedProviderEvent = {
  providerEventUuid: string;
  eventType: string;
  eventCategory:
    | "order"
    | "reward"
    | "fraud"
    | "product"
    | "campaign"
    | "funding"
    | "top_up"
    | "unknown";
  resourceType: string | null;
  resourceReference: string | null;
  environment: ActiveProviderMode;
  occurredAt: string;
  bodySha256: string;
  processingStatus: "queued" | "ignored";
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPE_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/;
const REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function normalizeProviderEvent(input: {
  rawBody: Uint8Array;
  environment: ActiveProviderMode;
  bodySha256: string;
}): NormalizedProviderEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    throw new Error("Webhook body must be valid JSON.");
  }
  const root = record(parsed);
  const providerEventUuid = text(root.uuid || root.id);
  if (!UUID_RE.test(providerEventUuid)) {
    throw new Error("Webhook event UUID is invalid.");
  }
  const eventType = text(root.event_type || root.type || root.event);
  if (!EVENT_TYPE_RE.test(eventType)) {
    throw new Error("Webhook event type is invalid.");
  }
  const occurredAt = isoTimestamp(
    root.created_utc || root.occurred_at || root.created_at || root.timestamp,
  );
  const payload = optionalRecord(root.payload) || optionalRecord(root.data) ||
    {};
  const resource = optionalRecord(payload.resource) ||
    optionalRecord(payload.object) || optionalRecord(root.resource);
  const resourceReference = optionalReference(
    resource?.uuid || resource?.id || payload.resource_uuid ||
      payload.resource_id || root.resource_uuid || root.resource_id,
  );
  const resourceType = optionalType(
    resource?.type || payload.resource_type || root.resource_type,
  );
  const eventCategory = categorizeProviderEvent(eventType);
  return {
    providerEventUuid: providerEventUuid.toLowerCase(),
    eventType: eventType.toLowerCase(),
    eventCategory,
    resourceType,
    resourceReference,
    environment: input.environment,
    occurredAt,
    bodySha256: input.bodySha256.toLowerCase(),
    processingStatus: eventCategory === "unknown" ? "ignored" : "queued",
  };
}

export function categorizeProviderEvent(
  eventType: string,
): NormalizedProviderEvent["eventCategory"] {
  const prefix = eventType.trim().toLowerCase().replace(/-/g, "_");
  if (/^orders?[._]/.test(prefix)) return "order";
  if (/^rewards?[._]/.test(prefix)) return "reward";
  if (/^fraud_reviews?[._]/.test(prefix) || /^fraud[._]/.test(prefix)) {
    return "fraud";
  }
  if (/^products?[._]/.test(prefix)) return "product";
  if (/^campaigns?[._]/.test(prefix)) return "campaign";
  if (/^funding_sources?[._]/.test(prefix) || /^funding[._]/.test(prefix)) {
    return "funding";
  }
  if (/^topups?[._]/.test(prefix) || /^top_ups?[._]/.test(prefix)) {
    return "top_up";
  }
  return "unknown";
}

export function providerEventProcessingClass(eventType: string):
  | "order_reconcile"
  | "reward_reconcile"
  | "configuration_change"
  | "ignore" {
  const category = categorizeProviderEvent(eventType);
  if (category === "order") return "order_reconcile";
  if (category === "reward" || category === "fraud") return "reward_reconcile";
  if (["product", "campaign", "funding", "top_up"].includes(category)) {
    return "configuration_change";
  }
  return "ignore";
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Webhook body must be an object.");
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalReference(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  if (!REFERENCE_RE.test(candidate)) {
    throw new Error("Webhook resource reference is invalid.");
  }
  return candidate;
}

function optionalType(value: unknown): string | null {
  const candidate = text(value).toLowerCase();
  if (!candidate) return null;
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(candidate)) {
    throw new Error("Webhook resource type is invalid.");
  }
  return candidate;
}

function isoTimestamp(value: unknown): string {
  const candidate = text(value);
  const timestamp = Date.parse(candidate);
  if (!candidate || !Number.isFinite(timestamp)) {
    throw new Error("Webhook timestamp is invalid.");
  }
  return new Date(timestamp).toISOString();
}
