import { loadConfig } from "./config.mjs";
import { RELAY_PATHS, parseRelayRequest } from "./protocol.mjs";
import { RelayState } from "./state.mjs";
import { TremendousApi, parseAndValidateOrder, parseOrderList } from "./tremendous.mjs";

export async function reconcileCampaign({ config, state, provider, now = Date.now }) {
  try {
    return await reconcileCampaignUnsafe({ config, state, provider, now });
  } catch {
    state.suspendOrders("nightly_reconciliation_failure", now());
    throw new Error("Campaign reconciliation failed closed.");
  }
}

async function reconcileCampaignUnsafe({ config, state, provider, now }) {
  if (config.mode === "disabled" || !provider) throw new Error("Reconciliation requires an explicitly configured active environment.");
  const startedAtMs = now();
  const providerOrders = [];
  for (let offset = 0; offset <= 10_000; offset += 500) {
    const page = await provider.listOrders(config.campaignId, offset, 500);
    if (page.status !== 200) throw new Error("Campaign reconciliation could not retrieve a complete provider page.");
    const orders = parseOrderList(page.body);
    providerOrders.push(...orders);
    if (orders.length < 500) break;
    if (offset === 10_000) throw new Error("Campaign reconciliation exceeded its fail-closed page bound.");
  }

  const bindings = state.listOrderBindings();
  const localByExternalId = new Map(bindings.map((binding) => [binding.external_id, binding]));
  const providerExternalIds = new Set();
  let providerOnlyCount = 0;
  let mismatchCount = 0;
  for (const order of providerOrders) {
    const externalId = String(order.external_id || "").toLowerCase();
    if (!externalId || providerExternalIds.has(externalId)) {
      mismatchCount += 1;
      continue;
    }
    providerExternalIds.add(externalId);
    const binding = localByExternalId.get(externalId);
    if (!binding) {
      providerOnlyCount += 1;
      continue;
    }
    try {
      const stored = parseRelayRequest(RELAY_PATHS.createOrder, JSON.parse(binding.request_json));
      const parsed = parseAndValidateOrder({ order }, stored);
      if (
        (binding.provider_order_id && binding.provider_order_id !== parsed.orderReference) ||
        (binding.provider_reward_id && binding.provider_reward_id !== parsed.rewardReference)
      ) {
        mismatchCount += 1;
        continue;
      }
      if (binding.state !== "succeeded") state.completeOrder(binding.external_id, parsed, now());
    } catch {
      mismatchCount += 1;
    }
  }

  const localIssued = state.listOrderBindings().filter((binding) => binding.state === "succeeded");
  const upstreamMissingCount = localIssued.filter((binding) => !providerExternalIds.has(binding.external_id)).length;
  const status = providerOnlyCount === 0 && upstreamMissingCount === 0 && mismatchCount === 0 ? "clean" : "incident";
  const result = {
    startedAtMs,
    completedAtMs: now(),
    status,
    providerOrderCount: providerOrders.length,
    localIssuedCount: localIssued.length,
    providerOnlyCount,
    upstreamMissingCount,
    mismatchCount,
  };
  state.recordReconciliation(result);
  if (status === "incident") state.suspendOrders("nightly_reconciliation_stop", result.completedAtMs);
  return result;
}

async function main() {
  const config = loadConfig();
  const state = new RelayState(config.databasePath);
  try {
    const provider = config.mode === "disabled" ? null : new TremendousApi({
      baseUrl: config.providerBaseUrl,
      apiKey: config.apiKey,
      timeoutMs: config.requestTimeoutMs,
      maximumResponseBytes: config.maximumResponseBytes,
    });
    const result = await reconcileCampaign({ config, state, provider });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "clean") process.exitCode = 2;
  } finally {
    state.close();
  }
}

if (process.argv[1]?.endsWith("reconcile.mjs")) await main();
