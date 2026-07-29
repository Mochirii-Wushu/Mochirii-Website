import { sha256Hex } from "./reward-crypto.ts";
import {
  type ActiveProviderMode,
  parseRelayRequest,
  RELAY_PATHS,
  type RelayCreateOrderRequest,
} from "./reward-relay-contract.ts";
import type {
  RelayTransport,
  RelayTransportResponse,
} from "./reward-relay-client.ts";

type MockOrder = {
  requestHash: string;
  orderReference: string;
  rewardReference: string;
};

export type InMemoryRewardRelayOptions = {
  environment: ActiveProviderMode;
  configurationHash: string;
  campaignId: string;
  productIds: string[];
  countryCodes: string[];
  availableBalanceCents?: number;
  pendingBalanceCents?: number;
  ready?: boolean;
};

export class InMemoryRewardRelay implements RelayTransport {
  readonly requests: Array<{ path: string; body: Record<string, unknown> }> =
    [];
  #orders = new Map<string, MockOrder>();
  #options: InMemoryRewardRelayOptions;
  #availableBalanceCents: number;

  constructor(options: InMemoryRewardRelayOptions) {
    this.#options = structuredClone(options);
    this.#availableBalanceCents = options.availableBalanceCents ?? 10_000;
  }

  async request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<RelayTransportResponse> {
    this.requests.push({ path, body: structuredClone(body) });
    let parsed;
    try {
      parsed = parseRelayRequest(path, body);
    } catch {
      return response(422, {});
    }
    if (parsed.environment !== this.#options.environment) {
      return response(422, {});
    }

    if (path === RELAY_PATHS.readiness && parsed.operation === "readiness") {
      const configurationMatches =
        parsed.configurationHash === this.#options.configurationHash;
      const ready = (this.#options.ready ?? true) && configurationMatches;
      return response(200, {
        ready,
        environment: this.#options.environment,
        accountStatus: ready ? "active" : "review",
        apiOrders: ready,
        ordersEnabled: ready,
        organizationMatches: ready,
        campaignMatches: ready,
        configurationMatches,
        availableBalanceCents: this.#availableBalanceCents,
        pendingBalanceCents: this.#options.pendingBalanceCents ?? 0,
      });
    }
    if (
      path === RELAY_PATHS.createOrder && parsed.operation === "create_order"
    ) {
      return this.#createOrder(parsed);
    }
    if (
      path === RELAY_PATHS.lookupOrder && parsed.operation === "lookup_order"
    ) {
      const existing = this.#orders.get(parsed.externalId);
      return existing
        ? response(200, {
          outcome: "found",
          orderReference: existing.orderReference,
          rewardReference: existing.rewardReference,
          sanitizedStatus: "succeeded",
        })
        : response(404, {});
    }
    if (
      path === RELAY_PATHS.rewardState && parsed.operation === "reward_state"
    ) {
      const found = [...this.#orders.values()].some((order) =>
        order.rewardReference === parsed.rewardReference
      );
      return found
        ? response(200, {
          rewardReference: parsed.rewardReference,
          state: "active",
          deliveryState: "succeeded",
        })
        : response(404, {});
    }
    return response(404, {});
  }

  async #createOrder(
    request: RelayCreateOrderRequest,
  ): Promise<RelayTransportResponse> {
    const approvedProducts = new Set(this.#options.productIds);
    if (
      request.configurationHash !== this.#options.configurationHash ||
      request.campaignId !== this.#options.campaignId ||
      !this.#options.countryCodes.includes(request.countryCode) ||
      request.productIds.some((id) => !approvedProducts.has(id))
    ) {
      return response(422, {});
    }
    const requestHash = await sha256Hex(JSON.stringify(request));
    const existing = this.#orders.get(request.externalId);
    if (existing) {
      return existing.requestHash === requestHash
        ? response(201, {
          outcome: "existing",
          orderReference: existing.orderReference,
          rewardReference: existing.rewardReference,
          sanitizedStatus: "succeeded",
        })
        : response(409, {});
    }
    const grossPrizeCents = request.denomination * 100;
    if (this.#availableBalanceCents < grossPrizeCents) {
      return response(402, {});
    }
    const suffix = String(this.#orders.size + 1).padStart(4, "0");
    const order: MockOrder = {
      requestHash,
      orderReference: `mock-order-${suffix}`,
      rewardReference: `mock-reward-${suffix}`,
    };
    this.#orders.set(request.externalId, order);
    this.#availableBalanceCents -= grossPrizeCents;
    return response(200, {
      outcome: "created",
      orderReference: order.orderReference,
      rewardReference: order.rewardReference,
      sanitizedStatus: "succeeded",
    });
  }
}

function response(status: number, body: unknown): RelayTransportResponse {
  return { status, body, retryAfterMs: null };
}
