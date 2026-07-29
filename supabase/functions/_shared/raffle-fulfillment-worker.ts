import {
  checkRelayReadiness,
  executeFulfillmentOrder,
  makeFulfillmentExternalId,
  type OrderExecutionResult,
} from "./reward-fulfillment.ts";
import type {
  ActiveProviderMode,
  RelayCreateOrderRequest,
} from "./reward-relay-contract.ts";
import type { RelayTransport } from "./reward-relay-client.ts";
import { sha256Hex } from "./reward-crypto.ts";
import {
  isAllowedRafflePrizeCents,
  RAFFLE_ALL_IN_CAP_CENTS,
  RAFFLE_BALANCE_CEILING_CENTS,
  RAFFLE_BALANCE_RESERVE_CENTS,
  RAFFLE_MAXIMUM_PRIZE_CENTS,
  RAFFLE_MINIMUM_PRIZE_CENTS,
} from "./raffle-prize.ts";

export type ProviderConfigRow = {
  id: string;
  environment: ActiveProviderMode;
  status: string;
  orders_enabled: boolean;
  expected_organization_id: string | null;
  campaign_id: string | null;
  configuration_hash: string | null;
  reviewed_product_ids: string[];
  approved_country_codes: string[];
  minimum_reward_value_cents: number;
  maximum_reward_value_cents: number;
  reward_currency: string;
  cycle_cost_ceiling_cents: number;
  balance_reserve_cents: number;
  balance_ceiling_cents: number;
};

export type FulfillmentJobRow = {
  id: string;
  draw_result_id: string;
  provider_config_id: string;
  provider_configuration_hash: string;
  campaign_id: string;
  state: string;
  external_id: string;
  country_code: string;
  reward_value_cents: number;
  reward_currency: string;
  all_in_cost_cap_cents: number;
  product_ids: string[];
  request_hash: string | null;
  attempt_count: number;
};

export type PreparedFulfillment = {
  request: RelayCreateOrderRequest;
  requiredAvailableBalanceCents: number;
  maximumTotalBalanceCents: number;
  reconcileFirst: boolean;
};

export function prepareFulfillment(input: {
  job: FulfillmentJobRow;
  config: ProviderConfigRow;
  authorizedOutstandingCents: number;
}): PreparedFulfillment {
  const { job, config } = input;
  if (config.status !== "active" || config.orders_enabled !== true) {
    throw new Error("provider_disabled");
  }
  if (config.environment !== "sandbox" && config.environment !== "production") {
    throw new Error("invalid_environment");
  }
  if (
    !config.expected_organization_id || !safeId(config.expected_organization_id)
  ) throw new Error("organization_not_reviewed");
  if (!config.campaign_id || !safeId(config.campaign_id)) {
    throw new Error("campaign_not_reviewed");
  }
  if (
    !config.configuration_hash ||
    !/^[0-9a-f]{64}$/i.test(config.configuration_hash)
  ) {
    throw new Error("configuration_not_reviewed");
  }
  if (
    job.provider_config_id !== config.id ||
    (job.state !== "claimed" && job.state !== "reconciling")
  ) {
    throw new Error("job_not_claimed");
  }
  if (job.provider_configuration_hash !== config.configuration_hash) {
    throw new Error("configuration_drift");
  }
  if (job.campaign_id !== config.campaign_id) {
    throw new Error("campaign_drift");
  }
  if (job.external_id !== makeFulfillmentExternalId(job.draw_result_id)) {
    throw new Error("external_id_mismatch");
  }
  if (
    config.minimum_reward_value_cents !== RAFFLE_MINIMUM_PRIZE_CENTS ||
    config.maximum_reward_value_cents !== RAFFLE_MAXIMUM_PRIZE_CENTS ||
    !isAllowedRafflePrizeCents(job.reward_value_cents) ||
    job.reward_value_cents < config.minimum_reward_value_cents ||
    job.reward_value_cents > config.maximum_reward_value_cents
  ) {
    throw new Error("reward_value_mismatch");
  }
  if (config.reward_currency !== "USD" || job.reward_currency !== "USD") {
    throw new Error("reward_currency_mismatch");
  }
  if (config.cycle_cost_ceiling_cents !== RAFFLE_ALL_IN_CAP_CENTS) {
    throw new Error("cycle_ceiling_mismatch");
  }
  if (
    job.all_in_cost_cap_cents !== RAFFLE_ALL_IN_CAP_CENTS ||
    job.all_in_cost_cap_cents !== config.cycle_cost_ceiling_cents
  ) {
    throw new Error("job_cycle_ceiling_mismatch");
  }
  if (config.balance_reserve_cents !== RAFFLE_BALANCE_RESERVE_CENTS) {
    throw new Error("balance_reserve_mismatch");
  }
  if (config.balance_ceiling_cents !== RAFFLE_BALANCE_CEILING_CENTS) {
    throw new Error("balance_ceiling_mismatch");
  }
  const country = String(job.country_code || "").toUpperCase();
  if (
    !/^[A-Z]{2}$/.test(country) ||
    !config.approved_country_codes.includes(country)
  ) {
    throw new Error("country_not_approved");
  }
  const reviewed = new Set(config.reviewed_product_ids);
  const products = [...new Set(job.product_ids || [])].sort();
  if (
    !products.length || products.some((id) => !safeId(id) || !reviewed.has(id))
  ) {
    throw new Error("product_set_not_approved");
  }
  if (
    !Number.isSafeInteger(input.authorizedOutstandingCents) ||
    input.authorizedOutstandingCents < 0
  ) {
    throw new Error("authorized_exposure_invalid");
  }
  const outstanding = input.authorizedOutstandingCents;
  const requiredAvailableBalanceCents = outstanding +
    config.balance_reserve_cents;
  if (requiredAvailableBalanceCents > config.balance_ceiling_cents) {
    throw new Error("authorized_exposure_exceeds_balance_ceiling");
  }
  return {
    request: {
      operation: "create_order",
      environment: config.environment,
      configurationHash: config.configuration_hash.toLowerCase(),
      drawResultId: job.draw_result_id,
      externalId: job.external_id,
      countryCode: country,
      campaignId: config.campaign_id,
      productIds: products,
      fundingSourceId: "balance",
      denomination: job.reward_value_cents / 100,
      currencyCode: "USD",
      deliveryMethod: "LINK",
    },
    requiredAvailableBalanceCents,
    maximumTotalBalanceCents: config.balance_ceiling_cents,
    reconcileFirst: job.state === "reconciling",
  };
}

export async function processPreparedFulfillment(input: {
  transport: RelayTransport;
  prepared: PreparedFulfillment;
  attempt: number;
  random?: () => number;
}): Promise<OrderExecutionResult> {
  const readiness = await checkRelayReadiness({
    transport: input.transport,
    environment: input.prepared.request.environment,
    configurationHash: input.prepared.request.configurationHash,
    requiredAvailableBalanceCents: input.prepared.requiredAvailableBalanceCents,
    maximumTotalBalanceCents: input.prepared.maximumTotalBalanceCents,
  });
  if (!readiness.ready) {
    return readiness.pause
      ? { kind: "pause", errorCode: readiness.errorCode }
      : {
        kind: "retry",
        errorCode: readiness.errorCode,
        retryAfterMs: 60_000,
        mustReconcile: false,
      };
  }
  return executeFulfillmentOrder({
    transport: input.transport,
    request: input.prepared.request,
    attempt: input.attempt,
    random: input.random,
    reconcileFirst: input.prepared.reconcileFirst,
  });
}

export async function fulfillmentRequestHash(
  request: RelayCreateOrderRequest,
): Promise<string> {
  return sha256Hex(stableJson(request));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${stableJson(record[key])}`
      ).join(",")
    }}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Cannot hash an undefined request value.");
  }
  return serialized;
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
