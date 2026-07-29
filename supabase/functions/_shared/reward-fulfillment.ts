import {
  type ActiveProviderMode,
  isUuid,
  parseRelayOrderResponse,
  parseRelayReadinessResponse,
  RELAY_PATHS,
  type RelayCreateOrderRequest,
  type RelayLookupOrderRequest,
} from "./reward-relay-contract.ts";
import type {
  RelayTransport,
  RelayTransportResponse,
} from "./reward-relay-client.ts";

export type FulfillmentState =
  | "awaiting_clearance"
  | "ready"
  | "claimed"
  | "submitting"
  | "reconciling"
  | "succeeded"
  | "retryable"
  | "failed"
  | "cancelled";

export type OrderExecutionResult =
  | {
    kind: "success";
    outcome: "created" | "existing" | "reconciled";
    orderReference: string;
    rewardReference: string;
    sanitizedStatus: string;
  }
  | {
    kind: "retry";
    errorCode: string;
    retryAfterMs: number;
    mustReconcile: boolean;
  }
  | { kind: "terminal" | "pause" | "integrity"; errorCode: string };

export type ReadinessResult =
  | { ready: true; availableBalanceCents: number }
  | { ready: false; errorCode: string; pause: boolean };

const TRANSITIONS: Record<FulfillmentState, ReadonlySet<FulfillmentState>> = {
  awaiting_clearance: new Set(["ready", "cancelled"]),
  ready: new Set(["claimed", "cancelled"]),
  claimed: new Set(["submitting", "cancelled"]),
  submitting: new Set([
    "succeeded",
    "reconciling",
    "retryable",
    "failed",
    "cancelled",
  ]),
  reconciling: new Set(["succeeded", "retryable", "failed", "cancelled"]),
  succeeded: new Set(),
  retryable: new Set(["claimed", "cancelled"]),
  failed: new Set(),
  cancelled: new Set(),
};

export function canTransitionFulfillment(
  from: FulfillmentState,
  to: FulfillmentState,
): boolean {
  return TRANSITIONS[from].has(to);
}

export function makeFulfillmentExternalId(drawResultId: string): string {
  if (!isUuid(drawResultId)) {
    throw new Error("A valid draw-result ID is required.");
  }
  return `mochirii-mpd-${drawResultId.toLowerCase()}-v1`;
}

export function evaluateLinkThrottle(input: {
  nowMs: number;
  generationCount: number;
  generationLimit?: number;
  lastGeneratedAt: string | null;
}): { allowed: true } | {
  allowed: false;
  reason: "generation_limit" | "cooldown";
  retryAfterMs?: number;
} {
  const limit = Math.min(Math.max(input.generationLimit ?? 5, 1), 10);
  if (
    !Number.isSafeInteger(input.generationCount) || input.generationCount < 0 ||
    input.generationCount >= limit
  ) {
    return { allowed: false, reason: "generation_limit" };
  }
  if (input.lastGeneratedAt) {
    const last = Date.parse(input.lastGeneratedAt);
    if (!Number.isFinite(last)) {
      return { allowed: false, reason: "cooldown", retryAfterMs: 900_000 };
    }
    const remaining = last + 900_000 - input.nowMs;
    if (remaining > 0) {
      return { allowed: false, reason: "cooldown", retryAfterMs: remaining };
    }
  }
  return { allowed: true };
}

export async function checkRelayReadiness(input: {
  transport: RelayTransport;
  environment: ActiveProviderMode;
  configurationHash: string;
  requiredAvailableBalanceCents: number;
  maximumTotalBalanceCents: number;
}): Promise<ReadinessResult> {
  let response: RelayTransportResponse;
  try {
    response = await input.transport.request(RELAY_PATHS.readiness, {
      operation: "readiness",
      environment: input.environment,
      configurationHash: input.configurationHash,
    });
  } catch {
    return { ready: false, errorCode: "relay_unreachable", pause: false };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ready: false,
      errorCode: "relay_authentication_failed",
      pause: true,
    };
  }
  if (response.status !== 200) {
    return {
      ready: false,
      errorCode: response.status === 429
        ? "relay_rate_limited"
        : "relay_readiness_failed",
      pause: response.status < 500 && response.status !== 429,
    };
  }
  try {
    const readiness = parseRelayReadinessResponse(response.body);
    const controlsReady = readiness.ready &&
      readiness.environment === input.environment &&
      readiness.accountStatus === "active" &&
      readiness.apiOrders &&
      readiness.ordersEnabled &&
      readiness.organizationMatches &&
      readiness.campaignMatches &&
      readiness.configurationMatches;
    if (!controlsReady) {
      return { ready: false, errorCode: "provider_not_ready", pause: true };
    }
    if (readiness.availableBalanceCents < input.requiredAvailableBalanceCents) {
      return {
        ready: false,
        errorCode: "insufficient_settled_funds",
        pause: true,
      };
    }
    if (
      readiness.availableBalanceCents + readiness.pendingBalanceCents >
        input.maximumTotalBalanceCents
    ) {
      return {
        ready: false,
        errorCode: "balance_ceiling_exceeded",
        pause: true,
      };
    }
    return {
      ready: true,
      availableBalanceCents: readiness.availableBalanceCents,
    };
  } catch {
    return {
      ready: false,
      errorCode: "invalid_readiness_response",
      pause: true,
    };
  }
}

export async function executeFulfillmentOrder(input: {
  transport: RelayTransport;
  request: RelayCreateOrderRequest;
  attempt: number;
  random?: () => number;
  reconcileFirst?: boolean;
}): Promise<OrderExecutionResult> {
  if (input.reconcileFirst) {
    const prior = await reconcileBeforeCreate(input);
    if (prior) return prior;
  }
  let response: RelayTransportResponse;
  try {
    response = await input.transport.request(
      RELAY_PATHS.createOrder,
      input.request as unknown as Record<string, unknown>,
    );
  } catch {
    return reconcileUncertainOrder(input, "relay_timeout");
  }
  if (response.status === 200 || response.status === 201) {
    try {
      const order = parseRelayOrderResponse(response.body);
      if (response.status === 200 && order.outcome !== "created") {
        return { kind: "integrity", errorCode: "unexpected_create_outcome" };
      }
      if (response.status === 201 && order.outcome !== "existing") {
        return {
          kind: "integrity",
          errorCode: "unexpected_idempotent_outcome",
        };
      }
      return {
        kind: "success",
        outcome: response.status === 200 ? "created" : "existing",
        orderReference: order.orderReference,
        rewardReference: order.rewardReference,
        sanitizedStatus: order.sanitizedStatus,
      };
    } catch {
      return { kind: "integrity", errorCode: "invalid_order_response" };
    }
  }
  if (response.status === 400 || response.status === 422) {
    return { kind: "terminal", errorCode: "provider_configuration_invalid" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "pause", errorCode: "provider_authentication_failed" };
  }
  if (response.status === 402) {
    return { kind: "pause", errorCode: "provider_funding_stopped" };
  }
  if (response.status === 409) {
    return { kind: "integrity", errorCode: "external_id_conflict" };
  }
  if (response.status === 429) {
    return {
      kind: "retry",
      errorCode: "provider_rate_limited",
      retryAfterMs: Math.max(
        1_000,
        response.retryAfterMs || retryDelayMs(input.attempt, input.random),
      ),
      mustReconcile: false,
    };
  }
  if (
    response.status === 500 || response.status === 502 ||
    response.status === 503 || response.status === 504
  ) {
    return reconcileUncertainOrder(input, `provider_${response.status}`);
  }
  if (response.status === 404) {
    return { kind: "terminal", errorCode: "relay_operation_not_found" };
  }
  return {
    kind: "retry",
    errorCode: "unexpected_provider_status",
    retryAfterMs: retryDelayMs(input.attempt, input.random),
    mustReconcile: false,
  };
}

async function reconcileBeforeCreate(input: {
  transport: RelayTransport;
  request: RelayCreateOrderRequest;
  attempt: number;
  random?: () => number;
}): Promise<OrderExecutionResult | null> {
  const lookup: RelayLookupOrderRequest = {
    operation: "lookup_order",
    environment: input.request.environment,
    externalId: input.request.externalId,
  };
  let response: RelayTransportResponse;
  try {
    response = await input.transport.request(
      RELAY_PATHS.lookupOrder,
      lookup as unknown as Record<string, unknown>,
    );
  } catch {
    return {
      kind: "retry",
      errorCode: "reconciliation_unavailable",
      retryAfterMs: retryDelayMs(input.attempt, input.random),
      mustReconcile: true,
    };
  }
  if (response.status === 404) return null;
  if (response.status === 200 || response.status === 201) {
    try {
      const order = parseRelayOrderResponse(response.body);
      if (order.outcome !== "found" && order.outcome !== "existing") {
        return { kind: "integrity", errorCode: "unexpected_lookup_outcome" };
      }
      return {
        kind: "success",
        outcome: "reconciled",
        orderReference: order.orderReference,
        rewardReference: order.rewardReference,
        sanitizedStatus: order.sanitizedStatus,
      };
    } catch {
      return { kind: "integrity", errorCode: "invalid_lookup_response" };
    }
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "pause", errorCode: "provider_authentication_failed" };
  }
  if (response.status === 402) {
    return { kind: "pause", errorCode: "provider_funding_stopped" };
  }
  if (response.status === 409) {
    return { kind: "integrity", errorCode: "external_id_conflict" };
  }
  return {
    kind: "retry",
    errorCode: response.status === 429
      ? "provider_rate_limited"
      : "reconciliation_unavailable",
    retryAfterMs: Math.max(
      1_000,
      response.retryAfterMs || retryDelayMs(input.attempt, input.random),
    ),
    mustReconcile: true,
  };
}

async function reconcileUncertainOrder(
  input: {
    transport: RelayTransport;
    request: RelayCreateOrderRequest;
    attempt: number;
    random?: () => number;
  },
  uncertaintyCode: string,
): Promise<OrderExecutionResult> {
  const lookup: RelayLookupOrderRequest = {
    operation: "lookup_order",
    environment: input.request.environment,
    externalId: input.request.externalId,
  };
  let response: RelayTransportResponse;
  try {
    response = await input.transport.request(
      RELAY_PATHS.lookupOrder,
      lookup as unknown as Record<string, unknown>,
    );
  } catch {
    return {
      kind: "retry",
      errorCode: uncertaintyCode,
      retryAfterMs: retryDelayMs(input.attempt, input.random),
      mustReconcile: true,
    };
  }
  if (response.status === 200 || response.status === 201) {
    try {
      const order = parseRelayOrderResponse(response.body);
      if (order.outcome !== "found" && order.outcome !== "existing") {
        return { kind: "integrity", errorCode: "unexpected_lookup_outcome" };
      }
      return {
        kind: "success",
        outcome: "reconciled",
        orderReference: order.orderReference,
        rewardReference: order.rewardReference,
        sanitizedStatus: order.sanitizedStatus,
      };
    } catch {
      return { kind: "integrity", errorCode: "invalid_lookup_response" };
    }
  }
  if (response.status === 409) {
    return { kind: "integrity", errorCode: "external_id_conflict" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "pause", errorCode: "provider_authentication_failed" };
  }
  if (response.status === 402) {
    return { kind: "pause", errorCode: "provider_funding_stopped" };
  }
  return {
    kind: "retry",
    errorCode: uncertaintyCode,
    retryAfterMs: Math.max(
      1_000,
      response.retryAfterMs || retryDelayMs(input.attempt, input.random),
    ),
    mustReconcile: true,
  };
}

export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const boundedAttempt = Math.min(Math.max(Math.trunc(attempt), 0), 6);
  const base = Math.min(60_000, 1_000 * 2 ** boundedAttempt);
  const jitter = Math.floor(base * 0.25 * Math.min(Math.max(random(), 0), 1));
  return Math.max(1_000, base + jitter);
}
