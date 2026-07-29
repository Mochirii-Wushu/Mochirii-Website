export const RELAY_PATHS = {
  readiness: "/v1/readiness",
  createOrder: "/v1/orders",
  lookupOrder: "/v1/orders/by-external-id",
  rewardState: "/v1/rewards/state",
} as const;

export type ProviderMode = "disabled" | "sandbox" | "production";
export type ActiveProviderMode = Exclude<ProviderMode, "disabled">;

export type RelayReadinessRequest = {
  operation: "readiness";
  environment: ActiveProviderMode;
  configurationHash: string;
};

export type RelayReadinessResponse = {
  ready: boolean;
  environment: ActiveProviderMode;
  accountStatus: "active" | "inactive" | "review";
  apiOrders: boolean;
  ordersEnabled: boolean;
  organizationMatches: boolean;
  campaignMatches: boolean;
  configurationMatches: boolean;
  availableBalanceCents: number;
  pendingBalanceCents: number;
};

export type RelayCreateOrderRequest = {
  operation: "create_order";
  environment: ActiveProviderMode;
  configurationHash: string;
  cycleId: string;
  drawResultId: string;
  externalId: string;
  countryCode: string;
  campaignId: string;
  productIds: string[];
  fundingSourceId: "balance";
  denomination: number;
  currencyCode: "USD";
  deliveryMethod: "LINK";
};

export type RelayLookupOrderRequest = {
  operation: "lookup_order";
  environment: ActiveProviderMode;
  externalId: string;
};

export type RelayRewardStateRequest = {
  operation: "reward_state";
  environment: ActiveProviderMode;
  rewardReference: string;
};

export type RelayOrderResponse = {
  outcome: "created" | "existing" | "found";
  orderReference: string;
  rewardReference: string;
  sanitizedStatus: string;
};

export type RelayRewardStateResponse = {
  rewardReference: string;
  state: "active" | "succeeded" | "flagged" | "cancelled" | "unknown";
  deliveryState: "pending" | "succeeded" | "failed" | "cancelled" | "unknown";
};

export type ParsedRelayRequest =
  | RelayReadinessRequest
  | RelayCreateOrderRequest
  | RelayLookupOrderRequest
  | RelayRewardStateRequest;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EXTERNAL_ID_RE =
  /^mochirii-mpd-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-v1$/i;

export function parseRelayRequest(
  path: string,
  value: unknown,
): ParsedRelayRequest {
  const body = record(value);
  if (path === RELAY_PATHS.readiness) {
    exactKeys(body, ["operation", "environment", "configurationHash"]);
    return {
      operation: literal(body.operation, "readiness"),
      environment: activeMode(body.environment),
      configurationHash: hash(body.configurationHash),
    };
  }
  if (path === RELAY_PATHS.createOrder) {
    exactKeys(body, [
      "operation",
      "environment",
      "configurationHash",
      "cycleId",
      "drawResultId",
      "externalId",
      "countryCode",
      "campaignId",
      "productIds",
      "fundingSourceId",
      "denomination",
      "currencyCode",
      "deliveryMethod",
    ]);
    const productIds = stringArray(body.productIds, 1, 50).map(identifier);
    return {
      operation: literal(body.operation, "create_order"),
      environment: activeMode(body.environment),
      configurationHash: hash(body.configurationHash),
      cycleId: uuid(body.cycleId),
      drawResultId: uuid(body.drawResultId),
      externalId: externalId(body.externalId),
      countryCode: countryCode(body.countryCode),
      campaignId: identifier(body.campaignId),
      productIds: [...new Set(productIds)].sort(compareCodeUnits),
      fundingSourceId: literal(body.fundingSourceId, "balance"),
      denomination: grossPrizeDollars(body.denomination),
      currencyCode: literal(body.currencyCode, "USD"),
      deliveryMethod: literal(body.deliveryMethod, "LINK"),
    };
  }
  if (path === RELAY_PATHS.lookupOrder) {
    exactKeys(body, ["operation", "environment", "externalId"]);
    return {
      operation: literal(body.operation, "lookup_order"),
      environment: activeMode(body.environment),
      externalId: externalId(body.externalId),
    };
  }
  if (path === RELAY_PATHS.rewardState) {
    exactKeys(body, ["operation", "environment", "rewardReference"]);
    return {
      operation: literal(body.operation, "reward_state"),
      environment: activeMode(body.environment),
      rewardReference: identifier(body.rewardReference),
    };
  }
  throw new Error("Unsupported relay path.");
}

export function parseRelayReadinessResponse(
  value: unknown,
): RelayReadinessResponse {
  const body = record(value);
  exactKeys(body, [
    "ready",
    "environment",
    "accountStatus",
    "apiOrders",
    "ordersEnabled",
    "organizationMatches",
    "campaignMatches",
    "configurationMatches",
    "availableBalanceCents",
    "pendingBalanceCents",
  ]);
  return {
    ready: boolean(body.ready),
    environment: activeMode(body.environment),
    accountStatus: oneOf(
      body.accountStatus,
      ["active", "inactive", "review"] as const,
    ),
    apiOrders: boolean(body.apiOrders),
    ordersEnabled: boolean(body.ordersEnabled),
    organizationMatches: boolean(body.organizationMatches),
    campaignMatches: boolean(body.campaignMatches),
    configurationMatches: boolean(body.configurationMatches),
    availableBalanceCents: nonnegativeInteger(body.availableBalanceCents),
    pendingBalanceCents: nonnegativeInteger(body.pendingBalanceCents),
  };
}

export function parseRelayOrderResponse(value: unknown): RelayOrderResponse {
  const body = record(value);
  exactKeys(body, [
    "outcome",
    "orderReference",
    "rewardReference",
    "sanitizedStatus",
  ]);
  return {
    outcome: oneOf(body.outcome, ["created", "existing", "found"] as const),
    orderReference: identifier(body.orderReference),
    rewardReference: identifier(body.rewardReference),
    sanitizedStatus: safeStatus(body.sanitizedStatus),
  };
}

export function parseRelayRewardStateResponse(
  value: unknown,
): RelayRewardStateResponse {
  const body = record(value);
  exactKeys(body, ["rewardReference", "state", "deliveryState"]);
  return {
    rewardReference: identifier(body.rewardReference),
    state: oneOf(
      body.state,
      ["active", "succeeded", "flagged", "cancelled", "unknown"] as const,
    ),
    deliveryState: oneOf(
      body.deliveryState,
      ["pending", "succeeded", "failed", "cancelled", "unknown"] as const,
    ),
  };
}

export function isExternalId(value: unknown): value is string {
  return EXTERNAL_ID_RE.test(String(value || ""));
}

export function isUuid(value: unknown): value is string {
  return UUID_RE.test(String(value || ""));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length ||
    actual.some((key, index) => key !== allowed[index])
  ) {
    throw new Error("Payload has missing or unsupported fields.");
  }
}

function activeMode(value: unknown): ActiveProviderMode {
  return oneOf(value, ["sandbox", "production"] as const);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected a boolean.");
  return value;
}

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("Expected a nonnegative integer.");
  }
  return Number(value);
}

function hash(value: unknown): string {
  const text = String(value || "");
  if (!HASH_RE.test(text)) throw new Error("Expected a SHA-256 hash.");
  return text.toLowerCase();
}

function uuid(value: unknown): string {
  const text = String(value || "");
  if (!UUID_RE.test(text)) throw new Error("Expected a UUID.");
  return text.toLowerCase();
}

function externalId(value: unknown): string {
  const text = String(value || "");
  if (!EXTERNAL_ID_RE.test(text)) {
    throw new Error("Expected the immutable draw-result external ID.");
  }
  return text.toLowerCase();
}

function countryCode(value: unknown): string {
  const text = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(text)) {
    throw new Error("Expected an ISO alpha-2 country code.");
  }
  return text;
}

function identifier(value: unknown): string {
  const text = String(value || "").trim();
  if (!SAFE_ID_RE.test(text)) throw new Error("Expected a provider reference.");
  return text;
}

function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function safeIdentifier(value: unknown): boolean {
  return SAFE_ID_RE.test(String(value || "").trim());
}

function safeStatus(value: unknown): string {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(text)) {
    throw new Error("Expected a sanitized status.");
  }
  return text;
}

function literal<T extends string>(value: unknown, expected: T): T {
  if (value !== expected) throw new Error(`Expected ${expected}.`);
  return expected;
}

function grossPrizeDollars(value: unknown): number {
  if (
    !Number.isSafeInteger(value) || Number(value) < 10 || Number(value) > 50
  ) {
    throw new Error("Expected a whole-dollar gross prize from 10 through 50.");
  }
  return Number(value);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  const text = String(value || "");
  if (!allowed.includes(text)) throw new Error("Value is not allowed.");
  return text as T[number];
}

function stringArray(
  value: unknown,
  minimum: number,
  maximum: number,
): string[] {
  if (
    !Array.isArray(value) || value.length < minimum || value.length > maximum
  ) {
    throw new Error("Expected a bounded nonempty array.");
  }
  return value.map((item) => String(item || "").trim());
}
