import { resolve } from "node:path";
import { PROVIDER_REWARD_HOSTS, stableJson, sha256Hex } from "./protocol.mjs";

export const PROVIDER_BASE_URLS = Object.freeze({
  sandbox: "https://testflight.tremendous.com/api/v2",
  production: "https://api.tremendous.com/api/v2",
});

export const PROVIDER_KEY_PREFIXES = Object.freeze({
  sandbox: "TEST_",
  production: "PROD_",
});

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_RE = /^[0-9a-f]{64}$/i;

export function loadConfig(env = process.env, options = {}) {
  const mode = oneOf(env.TREMENDOUS_MODE || "disabled", ["disabled", "sandbox", "production"], "TREMENDOUS_MODE");
  const ordersEnabled = exactBoolean(env.TREMENDOUS_ORDERS_ENABLED || "false", "TREMENDOUS_ORDERS_ENABLED");
  if (mode === "disabled" && ordersEnabled) throw new Error("Orders cannot be enabled while the provider is disabled.");

  const approvedCountries = uniqueCsv(env.TREMENDOUS_APPROVED_COUNTRIES).map((value) => {
    const code = value.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw new Error("TREMENDOUS_APPROVED_COUNTRIES must contain ISO alpha-2 codes.");
    return code;
  }).sort();
  const reviewedProductIds = uniqueCsv(env.TREMENDOUS_REVIEWED_PRODUCT_IDS).map(identifier).sort();
  const feeFreeProductIds = uniqueCsv(env.TREMENDOUS_FEE_FREE_PRODUCT_IDS).map(identifier).sort();
  const expectedOrganizationId = optionalIdentifier(env.TREMENDOUS_EXPECTED_ORG_ID);
  const campaignId = optionalIdentifier(env.TREMENDOUS_CAMPAIGN_ID);

  const hashInput = {
    schemaVersion: 3,
    environment: mode,
    rewardHost: PROVIDER_REWARD_HOSTS[mode] || null,
    organizationId: expectedOrganizationId,
    campaignId,
    approvedCountries,
    reviewedProductIds,
    feeFreeProductIds,
    fundingSourceId: "balance",
    minimumRewardValueCents: integer(env.REWARD_MINIMUM_PRIZE_CENTS, 1_000, 1_000, 1_000, "REWARD_MINIMUM_PRIZE_CENTS"),
    maximumRewardValueCents: integer(env.REWARD_MAXIMUM_PRIZE_CENTS, 5_000, 5_000, 5_000, "REWARD_MAXIMUM_PRIZE_CENTS"),
    currencyCode: "USD",
    deliveryMethod: "LINK",
    campaignFeePolicy: "SENDER",
    campaignAutoAdd: false,
    maximumCycleCostCents: integer(env.REWARD_MAXIMUM_CYCLE_COST_CENTS, 5_000, 5_000, 5_000, "REWARD_MAXIMUM_CYCLE_COST_CENTS"),
    balanceReserveCents: integer(env.REWARD_MINIMUM_AVAILABLE_BALANCE_CENTS, 5_000, 5_000, 5_000, "REWARD_MINIMUM_AVAILABLE_BALANCE_CENTS"),
    maximumBalanceCents: integer(env.REWARD_MAXIMUM_BALANCE_CENTS, 10_000, 10_000, 10_000, "REWARD_MAXIMUM_BALANCE_CENTS"),
  };
  const derivedConfigurationHash = deriveConfigurationHash(hashInput);
  const configuredHash = String(env.TREMENDOUS_CONFIGURATION_HASH || "").trim().toLowerCase();

  if (mode !== "disabled") {
    if (!expectedOrganizationId || !campaignId) throw new Error("Active provider mode requires organization and campaign identifiers.");
    if (approvedCountries.length === 0 || reviewedProductIds.length === 0) {
      throw new Error("Active provider mode requires nonempty approved-country and reviewed-product allowlists.");
    }
    if (!sameStrings(reviewedProductIds, feeFreeProductIds)) {
      throw new Error("Every reviewed product must have an exact fee-free attestation for v1.");
    }
    if (!options.forHashOnly && (!HASH_RE.test(configuredHash) || configuredHash !== derivedConfigurationHash)) {
      throw new Error("TREMENDOUS_CONFIGURATION_HASH does not match the fail-closed configuration contract.");
    }
    const key = String(env.TREMENDOUS_API_KEY || "");
    if (!options.forHashOnly && (!key.startsWith(PROVIDER_KEY_PREFIXES[mode]) || key.length < PROVIDER_KEY_PREFIXES[mode].length + 16)) {
      throw new Error("TREMENDOUS_API_KEY does not match the selected environment.");
    }
    if (!options.forHashOnly && String(env.REWARD_RELAY_HMAC_SECRET || "").length < 32) {
      throw new Error("REWARD_RELAY_HMAC_SECRET must contain at least 32 characters.");
    }
  }

  return Object.freeze({
    mode,
    ordersEnabled,
    apiKey: mode === "disabled" || options.forHashOnly ? "" : String(env.TREMENDOUS_API_KEY),
    providerBaseUrl: mode === "disabled" ? null : PROVIDER_BASE_URLS[mode],
    rewardHost: PROVIDER_REWARD_HOSTS[mode] || null,
    expectedOrganizationId,
    campaignId,
    approvedCountries: Object.freeze(approvedCountries),
    reviewedProductIds: Object.freeze(reviewedProductIds),
    feeFreeProductIds: Object.freeze(feeFreeProductIds),
    configuredHash,
    derivedConfigurationHash,
    hashInput: Object.freeze(hashInput),
    hmacSecret: String(env.REWARD_RELAY_HMAC_SECRET || ""),
    host: validateHost(env.REWARD_RELAY_HOST || "127.0.0.1"),
    port: integer(env.REWARD_RELAY_PORT, 8_787, 1, 65_535, "REWARD_RELAY_PORT"),
    databasePath: resolve(String(env.REWARD_RELAY_DATABASE_PATH || "./reward-relay.sqlite3")),
    requestTimeoutMs: integer(env.REWARD_RELAY_REQUEST_TIMEOUT_MS, 10_000, 1_000, 30_000, "REWARD_RELAY_REQUEST_TIMEOUT_MS"),
    maximumRequestBytes: integer(env.REWARD_RELAY_MAX_REQUEST_BYTES, 16_384, 1_024, 16_384, "REWARD_RELAY_MAX_REQUEST_BYTES"),
    maximumResponseBytes: integer(env.REWARD_RELAY_MAX_RESPONSE_BYTES, 524_288, 32_768, 1_048_576, "REWARD_RELAY_MAX_RESPONSE_BYTES"),
    maximumClockSkewSeconds: integer(env.REWARD_RELAY_MAX_CLOCK_SKEW_SECONDS, 60, 1, 60, "REWARD_RELAY_MAX_CLOCK_SKEW_SECONDS"),
    requestRateLimitPerMinute: integer(env.REWARD_RELAY_RATE_LIMIT_PER_MINUTE, 60, 1, 300, "REWARD_RELAY_RATE_LIMIT_PER_MINUTE"),
    maximumLinkGenerationsPerReward: 5,
    maximumCycleCostCents: hashInput.maximumCycleCostCents,
    minimumRewardValueCents: hashInput.minimumRewardValueCents,
    maximumRewardValueCents: hashInput.maximumRewardValueCents,
    balanceReserveCents: hashInput.balanceReserveCents,
    maximumBalanceCents: hashInput.maximumBalanceCents,
    minimumAvailableBalanceCents: hashInput.balanceReserveCents,
  });
}

export function deriveConfigurationHash(value) {
  return sha256Hex(Buffer.from(stableJson(value)));
}

export function publicConfigView(config) {
  return {
    mode: config.mode,
    providerBaseUrl: config.providerBaseUrl,
    rewardHost: config.rewardHost,
    organizationId: config.expectedOrganizationId,
    campaignId: config.campaignId,
    approvedCountries: [...config.approvedCountries],
    reviewedProductIds: [...config.reviewedProductIds],
    feeFreeProductIds: [...config.feeFreeProductIds],
    configurationHash: config.derivedConfigurationHash,
    ordersEnabled: config.ordersEnabled,
    minimumRewardValueCents: config.minimumRewardValueCents,
    maximumRewardValueCents: config.maximumRewardValueCents,
    maximumCycleCostCents: config.maximumCycleCostCents,
    balanceReserveCents: config.balanceReserveCents,
    maximumBalanceCents: config.maximumBalanceCents,
  };
}

function uniqueCsv(value) {
  return [...new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean))];
}

function optionalIdentifier(value) {
  const text = String(value || "").trim();
  return text ? identifier(text) : "";
}

function identifier(value) {
  const text = String(value || "").trim();
  if (!SAFE_ID_RE.test(text)) throw new Error("Provider configuration contains an unsafe identifier.");
  return text;
}

function exactBoolean(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly true or false.`);
}

function integer(value, fallback, minimum, maximum, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function validateHost(value) {
  const host = String(value).trim();
  if (host !== "127.0.0.1" && host !== "::1") throw new Error("Reward relay must bind to loopback.");
  return host;
}

function oneOf(value, values, name) {
  if (!values.includes(value)) throw new Error(`${name} has an unsupported value.`);
  return value;
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
