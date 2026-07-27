import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ActiveProviderMode,
  parseRelayOrderResponse,
  parseRelayRewardStateResponse,
  RELAY_PATHS,
} from "./reward-relay-contract.ts";
import type {
  RelayTransport,
  RelayTransportResponse,
} from "./reward-relay-client.ts";
import {
  categorizeProviderEvent,
  providerEventProcessingClass,
} from "./reward-webhook.ts";

export type ProviderEventSummary = {
  claimed: number;
  processed: number;
  ignored: number;
  deferred: number;
  completionFailures: number;
  durabilityFailure: boolean;
};

type ProviderEventRow = {
  id: string;
  provider_config_id: string;
  event_type: string;
  resource_type: string | null;
  resource_reference: string | null;
  environment: string;
  attempt_count: number;
};

type EventConfig = {
  id: string;
  environment: ActiveProviderMode;
};

type ManagedFulfillment = {
  id: string;
  external_id: string;
  provider_order_id: string | null;
  provider_reward_id: string | null;
};

type EventOutcome =
  | { kind: "processed" }
  | { kind: "ignored"; errorCode?: string }
  | { kind: "deferred"; errorCode: string; retryAfterMs: number };

export async function processClaimedProviderEvents(input: {
  adminClient: SupabaseClient;
  transport: RelayTransport;
  workerId: string;
}): Promise<ProviderEventSummary> {
  const summary: ProviderEventSummary = {
    claimed: 0,
    processed: 0,
    ignored: 0,
    deferred: 0,
    completionFailures: 0,
    durabilityFailure: false,
  };
  const { data, error } = await input.adminClient.rpc(
    "claim_raffle_provider_events",
    {
      p_worker_id: input.workerId,
      p_limit: 5,
      p_lock_seconds: 300,
    },
  );
  if (error) return { ...summary, durabilityFailure: true };
  const events = Array.isArray(data) ? data as ProviderEventRow[] : [];
  summary.claimed = events.length;
  if (!events.length) return summary;

  const configIds = [
    ...new Set(events.map((event) => event.provider_config_id)),
  ];
  const { data: configRows, error: configError } = await input.adminClient
    .from("raffle_provider_configs")
    .select("id,environment")
    .in("id", configIds);
  if (configError) return { ...summary, durabilityFailure: true };
  const configs = new Map<string, EventConfig>();
  for (const row of configRows || []) {
    if (row.environment !== "sandbox" && row.environment !== "production") {
      continue;
    }
    configs.set(String(row.id), {
      id: String(row.id),
      environment: row.environment,
    });
  }

  for (const event of events) {
    const config = configs.get(event.provider_config_id);
    let outcome: EventOutcome;
    if (!config || event.environment !== config.environment) {
      if (config && !await suspendConfig(input.adminClient, config.id)) {
        summary.durabilityFailure = true;
        break;
      }
      outcome = {
        kind: "deferred",
        errorCode: "event_environment_mismatch",
        retryAfterMs: 900_000,
      };
    } else {
      outcome = await processEvent({
        adminClient: input.adminClient,
        transport: input.transport,
        workerId: input.workerId,
        event,
        config,
      });
    }
    const completed = await completeEvent(
      input.adminClient,
      input.workerId,
      event.id,
      outcome,
    );
    if (!completed) {
      summary.completionFailures += 1;
      summary.durabilityFailure = true;
      break;
    }
    if (outcome.kind === "processed") summary.processed += 1;
    else if (outcome.kind === "ignored") summary.ignored += 1;
    else summary.deferred += 1;
  }
  return summary;
}

async function processEvent(input: {
  adminClient: SupabaseClient;
  transport: RelayTransport;
  workerId: string;
  event: ProviderEventRow;
  config: EventConfig;
}): Promise<EventOutcome> {
  const processingClass = providerEventProcessingClass(input.event.event_type);
  if (processingClass === "ignore") {
    return { kind: "ignored", errorCode: "event_not_actionable" };
  }
  if (processingClass === "configuration_change") {
    const suspended = await suspendConfig(input.adminClient, input.config.id);
    return suspended ? { kind: "processed" } : {
      kind: "deferred",
      errorCode: "readiness_invalidation_failed",
      retryAfterMs: 900_000,
    };
  }
  if (!input.event.resource_reference) {
    if (
      categorizeProviderEvent(input.event.event_type) === "fraud" &&
      !await suspendConfig(input.adminClient, input.config.id)
    ) {
      return {
        kind: "deferred",
        errorCode: "readiness_invalidation_failed",
        retryAfterMs: 900_000,
      };
    }
    return {
      kind: "deferred",
      errorCode: "resource_reference_missing",
      retryAfterMs: 900_000,
    };
  }

  const jobLookup = await findManagedFulfillment(
    input.adminClient,
    input.config.id,
    input.event.resource_reference,
  );
  if (!jobLookup.ok) {
    return {
      kind: "deferred",
      errorCode: "managed_resource_lookup_failed",
      retryAfterMs: 300_000,
    };
  }
  const job = jobLookup.row;
  if (!job) {
    return input.event.attempt_count < 3
      ? {
        kind: "deferred",
        errorCode: "managed_resource_not_ready",
        retryAfterMs: 300_000,
      }
      : { kind: "ignored", errorCode: "resource_not_managed" };
  }

  if (processingClass === "order_reconcile") {
    const orderOutcome = await retrieveOrder(
      input.transport,
      input.config.environment,
      job,
    );
    if (orderOutcome) {
      if (
        orderOutcome.kind === "deferred" &&
        (orderOutcome.errorCode.includes("integrity") ||
          orderOutcome.errorCode.endsWith("_paused"))
      ) {
        if (!await suspendConfig(input.adminClient, input.config.id)) {
          return {
            kind: "deferred",
            errorCode: "readiness_invalidation_failed",
            retryAfterMs: 900_000,
          };
        }
      }
      return orderOutcome;
    }
  }
  if (!job.provider_reward_id) {
    return {
      kind: "deferred",
      errorCode: "reward_reference_not_ready",
      retryAfterMs: 300_000,
    };
  }

  const rewardState = await retrieveRewardState(
    input.transport,
    input.config.environment,
    job.provider_reward_id,
  );
  if (!rewardState.ok) {
    if (
      rewardState.pause &&
      !await suspendConfig(input.adminClient, input.config.id)
    ) {
      return {
        kind: "deferred",
        errorCode: "readiness_invalidation_failed",
        retryAfterMs: 900_000,
      };
    }
    return {
      kind: "deferred",
      errorCode: rewardState.errorCode,
      retryAfterMs: rewardState.retryAfterMs,
    };
  }
  if (categorizeProviderEvent(input.event.event_type) === "fraud") {
    if (!await suspendConfig(input.adminClient, input.config.id)) {
      return {
        kind: "deferred",
        errorCode: "readiness_invalidation_failed",
        retryAfterMs: 900_000,
      };
    }
  }
  if (rewardState.state === "unknown") {
    if (!await suspendConfig(input.adminClient, input.config.id)) {
      return {
        kind: "deferred",
        errorCode: "readiness_invalidation_failed",
        retryAfterMs: 900_000,
      };
    }
    return {
      kind: "deferred",
      errorCode: "reward_state_unknown",
      retryAfterMs: 900_000,
    };
  }
  const { data: applied, error: applyError } = await input.adminClient.rpc(
    "apply_raffle_provider_reward_state",
    {
      p_event_id: input.event.id,
      p_worker_id: input.workerId,
      p_provider_reward_id: job.provider_reward_id,
      p_reward_state: rewardState.state,
      p_delivery_state: rewardState.deliveryState,
    },
  );
  return !applyError && applied === true ? { kind: "processed" } : {
    kind: "deferred",
    errorCode: "reward_state_apply_failed",
    retryAfterMs: 900_000,
  };
}

async function retrieveOrder(
  transport: RelayTransport,
  environment: ActiveProviderMode,
  job: ManagedFulfillment,
): Promise<EventOutcome | null> {
  let response: RelayTransportResponse;
  try {
    response = await transport.request(RELAY_PATHS.lookupOrder, {
      operation: "lookup_order",
      environment,
      externalId: job.external_id,
    });
  } catch {
    return {
      kind: "deferred",
      errorCode: "order_reconciliation_unavailable",
      retryAfterMs: 300_000,
    };
  }
  if (
    response.status === 404 || response.status === 429 || response.status >= 500
  ) {
    return {
      kind: "deferred",
      errorCode: response.status === 429
        ? "provider_rate_limited"
        : "order_reconciliation_unavailable",
      retryAfterMs: Math.max(1_000, response.retryAfterMs || 300_000),
    };
  }
  if (
    response.status === 401 || response.status === 402 ||
    response.status === 403
  ) {
    return {
      kind: "deferred",
      errorCode: "order_reconciliation_paused",
      retryAfterMs: 900_000,
    };
  }
  if (response.status !== 200 && response.status !== 201) {
    return {
      kind: "deferred",
      errorCode: "order_reconciliation_integrity",
      retryAfterMs: 900_000,
    };
  }
  try {
    const order = parseRelayOrderResponse(response.body);
    if (
      (order.outcome !== "found" && order.outcome !== "existing") ||
      (job.provider_order_id && order.orderReference !== job.provider_order_id)
    ) {
      return {
        kind: "deferred",
        errorCode: "order_reconciliation_integrity",
        retryAfterMs: 900_000,
      };
    }
    return null;
  } catch {
    return {
      kind: "deferred",
      errorCode: "order_reconciliation_integrity",
      retryAfterMs: 900_000,
    };
  }
}

async function retrieveRewardState(
  transport: RelayTransport,
  environment: ActiveProviderMode,
  rewardReference: string,
): Promise<
  | {
    ok: true;
    state: "active" | "succeeded" | "flagged" | "cancelled" | "unknown";
    deliveryState: "pending" | "succeeded" | "failed" | "cancelled" | "unknown";
  }
  | { ok: false; errorCode: string; retryAfterMs: number; pause: boolean }
> {
  let response: RelayTransportResponse;
  try {
    response = await transport.request(RELAY_PATHS.rewardState, {
      operation: "reward_state",
      environment,
      rewardReference,
    });
  } catch {
    return {
      ok: false,
      errorCode: "reward_reconciliation_unavailable",
      retryAfterMs: 300_000,
      pause: false,
    };
  }
  if (
    response.status === 401 || response.status === 402 ||
    response.status === 403
  ) {
    return {
      ok: false,
      errorCode: "reward_reconciliation_paused",
      retryAfterMs: 900_000,
      pause: true,
    };
  }
  if (response.status !== 200) {
    return {
      ok: false,
      errorCode: response.status === 429
        ? "provider_rate_limited"
        : "reward_reconciliation_unavailable",
      retryAfterMs: Math.max(1_000, response.retryAfterMs || 300_000),
      pause: false,
    };
  }
  try {
    const state = parseRelayRewardStateResponse(response.body);
    if (state.rewardReference !== rewardReference) {
      return {
        ok: false,
        errorCode: "reward_reconciliation_integrity",
        retryAfterMs: 900_000,
        pause: true,
      };
    }
    return { ok: true, state: state.state, deliveryState: state.deliveryState };
  } catch {
    return {
      ok: false,
      errorCode: "reward_reconciliation_integrity",
      retryAfterMs: 900_000,
      pause: true,
    };
  }
}

async function findManagedFulfillment(
  adminClient: SupabaseClient,
  providerConfigId: string,
  reference: string,
): Promise<{ ok: true; row: ManagedFulfillment | null } | { ok: false }> {
  for (
    const column of [
      "provider_reward_id",
      "provider_order_id",
      "external_id",
    ] as const
  ) {
    const { data, error } = await adminClient
      .from("raffle_fulfillment_jobs")
      .select("id,external_id,provider_order_id,provider_reward_id")
      .eq("provider_config_id", providerConfigId)
      .eq(column, reference)
      .maybeSingle();
    if (error) return { ok: false };
    if (data) return { ok: true, row: data as ManagedFulfillment };
  }
  return { ok: true, row: null };
}

async function suspendConfig(
  adminClient: SupabaseClient,
  providerConfigId: string,
): Promise<boolean> {
  if (!providerConfigId) return false;
  const { data: updated, error } = await adminClient
    .from("raffle_provider_configs")
    .update({
      status: "suspended",
      orders_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", providerConfigId)
    .select("id")
    .maybeSingle();
  if (error) return false;
  if (updated) return true;
  const { data: current, error: currentError } = await adminClient
    .from("raffle_provider_configs")
    .select("status,orders_enabled")
    .eq("id", providerConfigId)
    .maybeSingle();
  return !currentError && Boolean(current) && current?.status !== "active" &&
    current?.orders_enabled !== true;
}

async function completeEvent(
  adminClient: SupabaseClient,
  workerId: string,
  eventId: string,
  outcome: EventOutcome,
): Promise<boolean> {
  const nextAttemptAt = outcome.kind === "deferred"
    ? new Date(Date.now() + outcome.retryAfterMs).toISOString()
    : null;
  const { data, error } = await adminClient.rpc(
    "complete_raffle_provider_event",
    {
      p_event_id: eventId,
      p_worker_id: workerId,
      p_outcome: outcome.kind === "deferred" ? "failed" : outcome.kind,
      p_error_code: outcome.kind === "processed"
        ? null
        : outcome.errorCode || null,
      p_next_attempt_at: nextAttemptAt,
    },
  );
  return !error && data === true;
}
