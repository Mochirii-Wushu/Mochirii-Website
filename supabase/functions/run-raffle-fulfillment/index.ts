import "@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { constantTimeTextEquals } from "../_shared/reward-crypto.ts";
import {
  createRewardAdminClient,
  getRewardEdgeConfiguration,
  rewardJson,
} from "../_shared/reward-edge.ts";
import {
  type FulfillmentJobRow,
  fulfillmentRequestHash,
  prepareFulfillment,
  processPreparedFulfillment,
  type ProviderConfigRow,
} from "../_shared/raffle-fulfillment-worker.ts";
import { createRelayClient } from "../_shared/reward-relay-client.ts";
import {
  checkRelayReadiness,
  type OrderExecutionResult,
} from "../_shared/reward-fulfillment.ts";
import { processClaimedProviderEvents } from "../_shared/raffle-provider-event-worker.ts";
import {
  isAllowedRafflePrizeCents,
  RAFFLE_ALL_IN_CAP_CENTS,
  RAFFLE_BALANCE_CEILING_CENTS,
  RAFFLE_BALANCE_RESERVE_CENTS,
  RAFFLE_MAXIMUM_PRIZE_CENTS,
  RAFFLE_MINIMUM_PRIZE_CENTS,
} from "../_shared/raffle-prize.ts";
import { raffleOperationalGates } from "../_shared/raffle-flags.ts";

Deno.serve(handleRequest);

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return rewardJson({ ok: false, error: "not_found" }, 404);
  }
  const gates = raffleOperationalGates();
  if (!gates.rewardOrders || !gates.relay) {
    return rewardJson({ ok: false, error: "not_found" }, 404);
  }
  const expectedSecret = Deno.env.get("RAFFLE_FULFILLMENT_CRON_SECRET") || "";
  const suppliedSecret = req.headers.get("x-raffle-fulfillment-secret") || "";
  if (
    expectedSecret.length < 32 || !suppliedSecret ||
    !constantTimeTextEquals(expectedSecret, suppliedSecret)
  ) {
    return rewardJson({ ok: false, error: "not_found" }, 404);
  }

  const adminClient = createRewardAdminClient();
  const edgeConfig = getRewardEdgeConfiguration();
  if (!adminClient || !edgeConfig) {
    return rewardJson({ ok: false, error: "service_unavailable" }, 503);
  }
  let relay;
  try {
    relay = createRelayClient({
      baseUrl: edgeConfig.relayUrl,
      hmacSecret: edgeConfig.relayHmacSecret,
    });
  } catch {
    return rewardJson({ ok: false, error: "service_unavailable" }, 503);
  }

  const workerId = crypto.randomUUID();
  const providerEvents = await processClaimedProviderEvents({
    adminClient,
    transport: relay,
    workerId,
  });
  if (providerEvents.durabilityFailure) {
    return rewardJson({
      ok: false,
      error: "event_reconciliation_unavailable",
      data: { providerEvents },
    }, 503);
  }
  const readiness = await refreshActiveProviderReadiness(adminClient, relay);
  if (readiness.durabilityFailure) {
    return rewardJson({
      ok: false,
      error: "readiness_record_unavailable",
      data: { providerEvents, readiness },
    }, 503);
  }
  const { data: claimedData, error: claimError } = await adminClient.rpc(
    "claim_raffle_fulfillment_jobs",
    {
      p_worker_id: workerId,
      p_limit: 3,
      p_lock_seconds: 300,
    },
  );
  if (claimError) {
    return rewardJson({ ok: false, error: "queue_unavailable" }, 503);
  }
  const jobs = Array.isArray(claimedData)
    ? claimedData as FulfillmentJobRow[]
    : [];
  if (!jobs.length) {
    return rewardJson({
      ok: true,
      data: {
        processed: 0,
        succeeded: 0,
        deferred: 0,
        stopped: 0,
        completionFailures: 0,
        providerEvents,
        readiness,
      },
    });
  }

  const configIds = [
    ...new Set(
      jobs.map((job) => String(job.provider_config_id || "")).filter(Boolean),
    ),
  ];
  const { data: configData, error: configError } = await adminClient
    .from("raffle_provider_configs")
    .select(
      "id,environment,status,orders_enabled,expected_organization_id,campaign_id,configuration_hash,reviewed_product_ids,approved_country_codes,minimum_reward_value_cents,maximum_reward_value_cents,reward_currency,cycle_cost_ceiling_cents,balance_reserve_cents,balance_ceiling_cents",
    )
    .in("id", configIds);
  if (configError) {
    return rewardJson({ ok: false, error: "configuration_unavailable" }, 503);
  }
  const configs = new Map(
    (configData || []).map((row) => [String(row.id), normalizeConfig(row)]),
  );
  const outstanding = await loadOutstandingBalances(adminClient, configIds);
  if (!outstanding.ok) {
    return rewardJson({ ok: false, error: "exposure_unavailable" }, 503);
  }
  const outstandingByConfig = outstanding.totals;
  const summary = {
    processed: 0,
    succeeded: 0,
    deferred: 0,
    stopped: 0,
    completionFailures: 0,
  };
  let durabilityFailure = false;

  for (const job of jobs) {
    summary.processed += 1;
    const config = configs.get(String(job.provider_config_id));
    if (!config) {
      if (
        !await completeJob(adminClient, workerId, job, {
          kind: "pause",
          errorCode: "provider_configuration_missing",
        })
      ) {
        summary.completionFailures += 1;
        durabilityFailure = true;
      }
      summary.stopped += 1;
      if (durabilityFailure) break;
      continue;
    }
    let prepared;
    try {
      prepared = prepareFulfillment({
        job,
        config,
        authorizedOutstandingCents: outstandingByConfig.get(config.id) ||
          job.reward_value_cents,
      });
    } catch (error) {
      const suspensionRecorded = await suspendProviderConfig(
        adminClient,
        config.id,
      );
      if (
        !await completeJob(adminClient, workerId, job, {
          kind: "integrity",
          errorCode:
            error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
              ? error.message
              : "fulfillment_contract_invalid",
        })
      ) {
        summary.completionFailures += 1;
        durabilityFailure = true;
      }
      if (!suspensionRecorded) durabilityFailure = true;
      summary.stopped += 1;
      if (durabilityFailure) break;
      continue;
    }

    const requestHash = await fulfillmentRequestHash(prepared.request);
    if (job.request_hash && job.request_hash !== requestHash) {
      const suspensionRecorded = await suspendProviderConfig(
        adminClient,
        config.id,
      );
      if (
        !await completeJob(adminClient, workerId, job, {
          kind: "integrity",
          errorCode: "immutable_request_mismatch",
        })
      ) {
        summary.completionFailures += 1;
        durabilityFailure = true;
      }
      if (!suspensionRecorded) durabilityFailure = true;
      summary.stopped += 1;
      if (durabilityFailure) break;
      continue;
    }
    const submissionStartedAt = new Date().toISOString();
    const freezeQuery = adminClient
      .from("raffle_fulfillment_jobs")
      .update({
        request_hash: requestHash,
        state: "reconciling",
        submitted_at: submissionStartedAt,
        updated_at: submissionStartedAt,
      })
      .eq("id", job.id)
      .eq("locked_by", workerId)
      .in("state", ["claimed", "reconciling"]);
    const { data: frozenRows, error: freezeError } = job.request_hash
      ? await freezeQuery.eq("request_hash", requestHash).select("id")
      : await freezeQuery.is("request_hash", null).select("id");
    if (freezeError || !frozenRows || frozenRows.length !== 1) {
      const suspensionRecorded = await suspendProviderConfig(
        adminClient,
        config.id,
      );
      if (
        !await completeJob(adminClient, workerId, job, {
          kind: "integrity",
          errorCode: "request_freeze_failed",
        })
      ) {
        summary.completionFailures += 1;
        durabilityFailure = true;
      }
      if (!suspensionRecorded) durabilityFailure = true;
      summary.stopped += 1;
      if (durabilityFailure) break;
      continue;
    }

    const outcome = await processPreparedFulfillment({
      transport: relay,
      prepared,
      attempt: Number(job.attempt_count || 0),
    });
    if (
      outcome.kind === "pause" || outcome.kind === "integrity" ||
      outcome.kind === "terminal"
    ) {
      if (!await suspendProviderConfig(adminClient, config.id)) {
        durabilityFailure = true;
      }
    }
    const completionRecorded = await completeJob(
      adminClient,
      workerId,
      job,
      outcome,
    );
    if (!completionRecorded) {
      summary.completionFailures += 1;
      durabilityFailure = true;
    }
    if (completionRecorded) {
      if (outcome.kind === "success") summary.succeeded += 1;
      else if (outcome.kind === "retry") summary.deferred += 1;
      else summary.stopped += 1;
    }
    if (durabilityFailure) break;
  }

  return rewardJson({
    ok: !durabilityFailure,
    data: { ...summary, providerEvents, readiness },
  }, durabilityFailure ? 503 : 200);
}

function normalizeConfig(row: Record<string, unknown>): ProviderConfigRow {
  return {
    id: String(row.id || ""),
    environment: String(
      row.environment || "",
    ) as ProviderConfigRow["environment"],
    status: String(row.status || ""),
    orders_enabled: row.orders_enabled === true,
    expected_organization_id: typeof row.expected_organization_id === "string"
      ? row.expected_organization_id
      : null,
    campaign_id: typeof row.campaign_id === "string" ? row.campaign_id : null,
    configuration_hash: typeof row.configuration_hash === "string"
      ? row.configuration_hash
      : null,
    reviewed_product_ids: Array.isArray(row.reviewed_product_ids)
      ? row.reviewed_product_ids.map(String)
      : [],
    approved_country_codes: Array.isArray(row.approved_country_codes)
      ? row.approved_country_codes.map((value) => String(value).toUpperCase())
      : [],
    minimum_reward_value_cents: Number(row.minimum_reward_value_cents),
    maximum_reward_value_cents: Number(row.maximum_reward_value_cents),
    reward_currency: String(row.reward_currency || ""),
    cycle_cost_ceiling_cents: Number(row.cycle_cost_ceiling_cents),
    balance_reserve_cents: Number(row.balance_reserve_cents),
    balance_ceiling_cents: Number(row.balance_ceiling_cents),
  };
}

async function loadOutstandingBalances(
  adminClient: SupabaseClient,
  configIds: string[],
): Promise<{ ok: true; totals: Map<string, number> } | { ok: false }> {
  const totals = new Map<string, number>();
  const { data, error } = await adminClient
    .from("raffle_fulfillment_jobs")
    .select("provider_config_id,reward_value_cents")
    .in("provider_config_id", configIds)
    .in("state", [
      "ready",
      "claimed",
      "submitting",
      "reconciling",
      "retryable",
    ]);
  if (error) return { ok: false };
  for (const row of data || []) {
    const id = String(row.provider_config_id || "");
    const rewardValueCents = Number(row.reward_value_cents);
    if (!id || !isAllowedRafflePrizeCents(rewardValueCents)) {
      return { ok: false };
    }
    const total = (totals.get(id) || 0) + rewardValueCents;
    if (!Number.isSafeInteger(total)) return { ok: false };
    totals.set(id, total);
  }
  return { ok: true, totals };
}

async function refreshActiveProviderReadiness(
  adminClient: SupabaseClient,
  relay: ReturnType<typeof createRelayClient>,
): Promise<{
  checked: number;
  ready: number;
  deferred: number;
  suspended: number;
  durabilityFailure: boolean;
}> {
  const summary = {
    checked: 0,
    ready: 0,
    deferred: 0,
    suspended: 0,
    durabilityFailure: false,
  };
  const { data, error } = await adminClient.from("raffle_provider_configs")
    .select(
      "id,environment,status,orders_enabled,configuration_hash,minimum_reward_value_cents,maximum_reward_value_cents,reward_currency,cycle_cost_ceiling_cents,balance_reserve_cents,balance_ceiling_cents",
    )
    .eq("status", "active")
    .eq("orders_enabled", true);
  if (error) return { ...summary, durabilityFailure: true };
  const rows = data || [];
  const ids = rows.map((row) => String(row.id || "")).filter(Boolean);
  const exposure = await loadOutstandingBalances(adminClient, ids);
  if (!exposure.ok) return { ...summary, durabilityFailure: true };

  for (const row of rows) {
    summary.checked += 1;
    const id = String(row.id || "");
    const environment = String(row.environment || "");
    const configurationHash = String(row.configuration_hash || "");
    if (
      !id ||
      (environment !== "sandbox" && environment !== "production") ||
      !/^[0-9a-f]{64}$/i.test(configurationHash) ||
      Number(row.minimum_reward_value_cents) !== RAFFLE_MINIMUM_PRIZE_CENTS ||
      Number(row.maximum_reward_value_cents) !== RAFFLE_MAXIMUM_PRIZE_CENTS ||
      String(row.reward_currency || "") !== "USD" ||
      Number(row.cycle_cost_ceiling_cents) !== RAFFLE_ALL_IN_CAP_CENTS ||
      Number(row.balance_reserve_cents) !== RAFFLE_BALANCE_RESERVE_CENTS ||
      Number(row.balance_ceiling_cents) !== RAFFLE_BALANCE_CEILING_CENTS
    ) {
      if (!await suspendProviderConfig(adminClient, id)) {
        summary.durabilityFailure = true;
        break;
      }
      summary.suspended += 1;
      continue;
    }
    const result = await checkRelayReadiness({
      transport: relay,
      environment,
      configurationHash: configurationHash.toLowerCase(),
      requiredAvailableBalanceCents: (exposure.totals.get(id) || 0) +
        RAFFLE_BALANCE_RESERVE_CENTS,
      maximumTotalBalanceCents: RAFFLE_BALANCE_CEILING_CENTS,
    });
    if (!result.ready) {
      if (result.pause) {
        if (!await suspendProviderConfig(adminClient, id)) {
          summary.durabilityFailure = true;
          break;
        }
        summary.suspended += 1;
      } else {
        summary.deferred += 1;
      }
      continue;
    }
    const checkedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await adminClient.from(
      "raffle_provider_configs",
    )
      .update({ last_readiness_check_at: checkedAt, updated_at: checkedAt })
      .eq("id", id)
      .eq("status", "active")
      .eq("orders_enabled", true)
      .eq("configuration_hash", configurationHash)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      summary.durabilityFailure = true;
      break;
    }
    summary.ready += 1;
  }
  return summary;
}

async function suspendProviderConfig(
  adminClient: SupabaseClient,
  configId: string,
): Promise<boolean> {
  if (!configId) return false;
  const { data: updated, error: updateError } = await adminClient
    .from("raffle_provider_configs")
    .update({
      status: "suspended",
      orders_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", configId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (updateError) return false;
  if (updated) return true;

  // A concurrent webhook/readiness worker may already have applied the same
  // kill switch. Treat that as durable only after reading the fail-closed row.
  const { data: current, error: currentError } = await adminClient
    .from("raffle_provider_configs")
    .select("status,orders_enabled")
    .eq("id", configId)
    .maybeSingle();
  return !currentError && Boolean(current) &&
    current?.status !== "active" && current?.orders_enabled !== true;
}

async function completeJob(
  adminClient: SupabaseClient,
  workerId: string,
  job: FulfillmentJobRow,
  outcome: OrderExecutionResult,
): Promise<boolean> {
  const success = outcome.kind === "success";
  const retry = outcome.kind === "retry";
  const nextAttempt = retry
    ? new Date(Date.now() + outcome.retryAfterMs).toISOString()
    : null;
  const { data, error } = await adminClient.rpc(
    "complete_raffle_fulfillment_job",
    {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_outcome: success
        ? "succeeded"
        : retry
        ? (outcome.mustReconcile ? "reconciling" : "retryable")
        : "failed",
      p_provider_order_id: success ? outcome.orderReference : null,
      p_provider_reward_id: success ? outcome.rewardReference : null,
      p_sanitized_status: success ? outcome.sanitizedStatus : null,
      p_error_code: success ? null : outcome.errorCode,
      p_next_attempt_at: nextAttempt,
    },
  );
  return !error && data === true;
}
