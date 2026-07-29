import {
  categorizeProviderEvent,
  normalizeProviderEvent,
  providerEventProcessingClass,
} from "./reward-webhook.ts";

const encoder = new TextEncoder();
const bodyHash = "a".repeat(64);

Deno.test("documented plural webhook families normalize to their readiness category", () => {
  const cases = new Map<string, string>([
    ["ORDERS.CREATED", "order"],
    ["REWARDS.FLAGGED", "reward"],
    ["REWARDS.CANCELED", "reward"],
    ["FRAUD_REVIEWS.CREATED", "fraud"],
    ["PRODUCTS.UPDATED", "product"],
    ["CAMPAIGNS.UPDATED", "campaign"],
    ["FUNDING_SOURCES.UPDATED", "funding"],
    ["TOPUPS.COMPLETED", "top_up"],
  ]);
  for (const [eventType, category] of cases) {
    assertEquals(categorizeProviderEvent(eventType), category);
  }
  assertEquals(
    providerEventProcessingClass("ORDERS.CREATED"),
    "order_reconcile",
  );
  assertEquals(
    providerEventProcessingClass("REWARDS.FLAGGED"),
    "reward_reconcile",
  );
  assertEquals(
    providerEventProcessingClass("FRAUD_REVIEWS.CREATED"),
    "reward_reconcile",
  );
  assertEquals(
    providerEventProcessingClass("PRODUCTS.UPDATED"),
    "configuration_change",
  );
  assertEquals(
    providerEventProcessingClass("CAMPAIGNS.UPDATED"),
    "configuration_change",
  );
  assertEquals(
    providerEventProcessingClass("FUNDING_SOURCES.UPDATED"),
    "configuration_change",
  );
  assertEquals(
    providerEventProcessingClass("TOPUPS.COMPLETED"),
    "configuration_change",
  );
});

Deno.test("official webhook envelope accepts event, created_utc, and resource id", () => {
  const normalized = normalizeProviderEvent({
    rawBody: encoder.encode(JSON.stringify({
      event: "CAMPAIGNS.CREATED",
      uuid: "5ccc7bb1-7659-4e23-a407-77d8cd9c62f5",
      created_utc: "2021-04-06T20:05:01.037-04:00",
      payload: {
        resource: { id: "2V3PCCL7QXDA", type: "campaigns" },
        meta: {},
      },
    })),
    environment: "production",
    bodySha256: bodyHash,
  });
  assertEquals(normalized.eventType, "campaigns.created");
  assertEquals(normalized.resourceReference, "2V3PCCL7QXDA");
  assertEquals(normalized.resourceType, "campaigns");
  assertEquals(normalized.occurredAt, "2021-04-07T00:05:01.037Z");
});

Deno.test("webhook normalization stores only event metadata and excludes raw recipient/link data", () => {
  const rawBody = encoder.encode(JSON.stringify({
    uuid: "12345678-1234-4234-9234-1234567890ab",
    event_type: "REWARDS.FLAGGED",
    occurred_at: "2026-07-19T12:00:00.000Z",
    payload: {
      resource: {
        uuid: "reward-1",
        type: "reward",
        recipient: { email: "private@example.com", name: "Private Person" },
        link: "https://private.example/claim-secret",
      },
      provider_response: { secret: "must-not-survive" },
    },
  }));
  const normalized = normalizeProviderEvent({
    rawBody,
    environment: "production",
    bodySha256: bodyHash,
  });
  assertEquals(normalized, {
    providerEventUuid: "12345678-1234-4234-9234-1234567890ab",
    eventType: "rewards.flagged",
    eventCategory: "reward",
    resourceType: "reward",
    resourceReference: "reward-1",
    environment: "production",
    occurredAt: "2026-07-19T12:00:00.000Z",
    bodySha256: bodyHash,
    processingStatus: "queued",
  });
  const serialized = JSON.stringify(normalized);
  for (
    const forbidden of [
      "private@example.com",
      "Private Person",
      "claim-secret",
      "must-not-survive",
    ]
  ) {
    assert(
      !serialized.includes(forbidden),
      `${forbidden} must not be retained`,
    );
  }
});

Deno.test("unknown valid events are durably ignorable without rejecting the webhook", () => {
  const normalized = normalizeProviderEvent({
    rawBody: encoder.encode(JSON.stringify({
      uuid: "22345678-1234-4234-9234-1234567890ab",
      type: "NEW_EVENT_FAMILY.CREATED",
      created_at: "2026-07-19T12:00:00Z",
      data: {},
    })),
    environment: "sandbox",
    bodySha256: bodyHash,
  });
  assertEquals(normalized.eventCategory, "unknown");
  assertEquals(normalized.processingStatus, "ignored");
  assertEquals(normalized.resourceReference, null);
});

Deno.test("invalid JSON, UUID, event type, timestamp, and resource reference fail closed", () => {
  assertThrows(() =>
    normalizeProviderEvent({
      rawBody: encoder.encode("not-json"),
      environment: "production",
      bodySha256: bodyHash,
    })
  );
  for (
    const overrides of [
      { uuid: "bad" },
      { event_type: "bad event type" },
      { occurred_at: "not-a-date" },
      { payload: { resource: { uuid: "bad reference with spaces" } } },
    ]
  ) {
    const payload = {
      uuid: "32345678-1234-4234-9234-1234567890ab",
      event_type: "ORDERS.CREATED",
      occurred_at: "2026-07-19T12:00:00Z",
      payload: { resource: { uuid: "order-1", type: "order" } },
      ...overrides,
    };
    assertThrows(() =>
      normalizeProviderEvent({
        rawBody: encoder.encode(JSON.stringify(payload)),
        environment: "production",
        bodySha256: bodyHash,
      })
    );
  }
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertThrows(callback: () => unknown): void {
  let threw = false;
  try {
    callback();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Expected callback to throw.");
}
