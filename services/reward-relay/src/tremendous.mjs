import { safeTremendousHttpsLink } from "./protocol.mjs";
import { PROVIDER_BASE_URLS } from "./config.mjs";

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PROVIDER_ID_LENGTH = 128;
const DOCUMENTED_MERCHANT_CARD_CATEGORIES = new Set(["merchant_card", "merchant_cards"]);

export class TremendousApi {
  constructor({ baseUrl, apiKey, fetcher = fetch, timeoutMs = 10_000, maximumResponseBytes = 524_288 }) {
    if (!baseUrl || !apiKey) throw new Error("provider_client_disabled");
    const candidateBaseUrl = new URL(`${baseUrl}/`);
    const allowedBaseUrls = new Set(Object.values(PROVIDER_BASE_URLS).map((value) => new URL(`${value}/`).href));
    if (!allowedBaseUrls.has(candidateBaseUrl.href)) throw new Error("provider_origin_disabled");
    this.baseUrl = candidateBaseUrl;
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
    this.maximumResponseBytes = maximumResponseBytes;
  }

  listOrganizations() {
    return this.#request("GET", "organizations");
  }

  getCampaign(campaignId) {
    return this.#request("GET", `campaigns/${pathIdentifier(campaignId)}`);
  }

  getBalance() {
    return this.#request("GET", "funding_sources/BALANCE");
  }

  listProducts(countryCode) {
    if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("invalid_country");
    return this.#request("GET", `products?country=${countryCode}`);
  }

  listForex() {
    return this.#request("GET", "forex?base=USD");
  }

  createOrder(payload) {
    return this.#request("POST", "orders", payload);
  }

  getOrder(externalId) {
    return this.#request("GET", `orders/${pathIdentifier(externalId)}`);
  }

  listOrders(campaignId, offset = 0, limit = 500) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("invalid_order_page");
    }
    return this.#request("GET", `orders?campaign_id=${encodeURIComponent(identifier(campaignId))}&offset=${offset}&limit=${limit}`);
  }

  getReward(rewardId) {
    return this.#request("GET", `rewards/${pathIdentifier(rewardId)}`);
  }

  generateLink(rewardId) {
    return this.#request("POST", `rewards/${pathIdentifier(rewardId)}/generate_link`, null);
  }

  async #request(method, path, body = undefined) {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(this.baseUrl.pathname)) throw new Error("provider_path_escape");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: body === undefined ? undefined : body === null ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });
      const parsed = await readJsonBounded(response, this.maximumResponseBytes, controller.signal);
      return {
        status: response.status,
        body: parsed,
        retryAfterSeconds: retryAfterSeconds(response.headers?.get?.("retry-after")),
      };
    } catch (error) {
      if (error instanceof ProviderTransportError) throw error;
      const kind = controller.signal.aborted || error?.name === "AbortError" ? "timeout" : "transport";
      throw new ProviderTransportError(kind);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ProviderTransportError extends Error {
  constructor(kind) {
    super("provider_transport_failure");
    this.name = "ProviderTransportError";
    this.kind = kind;
  }
}

export function parseOrganizations(body) {
  const list = body?.organizations;
  if (!Array.isArray(list) || list.length !== 1) throw new Error("invalid_organizations");
  const value = record(list[0]);
  return {
    id: identifier(value.id),
    status: providerStatus(value.status),
    currencyCode: currency(value.currency_code),
  };
}

export function parseCampaign(body) {
  const value = record(body?.campaign);
  const products = identifierArray(value.products, 1, 2_000).sort();
  const autoAdd = value.auto_add_product_rule;
  if (autoAdd !== null && autoAdd !== undefined && (typeof autoAdd !== "object" || Array.isArray(autoAdd))) {
    throw new Error("invalid_campaign_auto_add");
  }
  return {
    id: identifier(value.id),
    products,
    feeChargedTo: String(value.fee_charged_to || "").toUpperCase(),
    autoAddEnabled: !Object.hasOwn(value, "auto_add_product_rule") || (autoAdd != null && autoAdd.enabled !== false),
  };
}

export function parseBalance(body) {
  const value = record(body?.funding_source);
  const meta = record(value.meta);
  return {
    id: identifier(value.id),
    method: String(value.method || "").toLowerCase(),
    status: String(value.status || "").toLowerCase(),
    usagePermissions: identifierArray(value.usage_permissions, 0, 20).map((item) => item.toLowerCase()),
    availableCents: cents(meta.available_cents),
    pendingCents: cents(meta.pending_cents),
    currencyCode: currency(meta.currency_code),
  };
}

export function parseProducts(body) {
  if (!Array.isArray(body?.products) || body.products.length > 10_000) throw new Error("invalid_products");
  return body.products.map((raw) => {
    const value = record(raw);
    const countries = Array.isArray(value.countries) ? value.countries.map((country) => String(record(country).abbr || "").toUpperCase()) : [];
    const currencies = Array.isArray(value.currency_codes) ? value.currency_codes.map(currency) : [];
    const skus = Array.isArray(value.skus) ? value.skus.map((rawSku) => {
      const sku = record(rawSku);
      const minimum = finitePositive(sku.min);
      const maximum = finitePositive(sku.max);
      if (minimum > maximum) throw new Error("invalid_sku");
      return { minimum, maximum };
    }) : [];
    return {
      id: identifier(value.id),
      category: String(value.category || "").toLowerCase(),
      countries,
      currencies,
      skus,
    };
  });
}

export function parseForex(body) {
  const value = record(body?.forex);
  const result = new Map([["USD", 1]]);
  for (const [code, rawRate] of Object.entries(value)) {
    if (!/^[A-Z]{3}$/.test(code)) continue;
    const rate = Number(rawRate);
    if (Number.isFinite(rate) && rate > 0) result.set(code, rate);
  }
  return result;
}

export function validateProductSelection({ products, requestedProductIds, countryCode, forex, denomination }) {
  if (!Number.isSafeInteger(denomination) || denomination < 10 || denomination > 50) {
    throw new Error("product_denomination");
  }
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const productId of requestedProductIds) {
    const product = byId.get(productId);
    if (!product) throw new Error("product_missing");
    if (!DOCUMENTED_MERCHANT_CARD_CATEGORIES.has(product.category)) throw new Error("product_category");
    if (!product.countries.includes(countryCode)) throw new Error("product_country");
    if (!supportsUsdDenomination(product, forex, denomination)) throw new Error("product_denomination");
  }
  return true;
}

export function parseAndValidateOrder(body, expected) {
  const value = record(body?.order);
  const rewards = Array.isArray(value.rewards) ? value.rewards : [];
  if (rewards.length !== 1) throw new Error("invalid_order_rewards");
  const reward = record(rewards[0]);
  const payment = record(value.payment);
  const rewardValue = record(reward.value);
  const delivery = record(reward.delivery);
  const externalId = String(value.external_id || "").toLowerCase();
  if (externalId !== expected.externalId) throw new Error("order_external_mismatch");
  if (String(reward.campaign_id || "") !== expected.campaignId) throw new Error("order_campaign_mismatch");
  if (!sameStrings(identifierArray(reward.products, 1, 50).sort(), [...expected.productIds].sort())) throw new Error("order_products_mismatch");
  if (
    !Number.isSafeInteger(expected.denomination) ||
    expected.denomination < 10 || expected.denomination > 50 ||
    strictNumber(rewardValue.denomination) !== expected.denomination ||
    currency(rewardValue.currency_code) !== "USD"
  ) throw new Error("order_value_mismatch");
  if (String(delivery.method || "").toUpperCase() !== "LINK") throw new Error("order_delivery_mismatch");
  const feesCents = moneyCents(payment.fees);
  const subtotalCents = moneyCents(payment.subtotal);
  const totalCents = moneyCents(payment.total);
  const expectedCents = expected.denomination * 100;
  const paymentCurrency = currency(payment.currency_code);
  if (
    feesCents !== 0 || subtotalCents !== expectedCents ||
    totalCents !== expectedCents || totalCents > 5_000 ||
    paymentCurrency !== "USD"
  ) throw new Error("order_cost_mismatch");
  return {
    orderReference: identifier(value.id),
    rewardReference: identifier(reward.id),
    sanitizedStatus: sanitizeStatus(value.status),
  };
}

export function parseOrderList(body) {
  if (!Array.isArray(body?.orders) || body.orders.length > 500) throw new Error("invalid_order_list");
  return body.orders.map((order) => record(order));
}

export function parseRewardState(body, expectedRewardReference) {
  const value = record(body?.reward);
  const id = identifier(value.id);
  if (id !== expectedRewardReference) throw new Error("reward_reference_mismatch");
  const delivery = record(value.delivery);
  return {
    rewardReference: id,
    state: mapRewardState(String(value.status || ""), String(delivery.status || "")),
    deliveryState: mapDeliveryState(String(delivery.status || "")),
  };
}

export function parseGeneratedLink(body, expectedRewardReference, mode) {
  const value = record(body?.reward);
  if (identifier(value.id) !== expectedRewardReference) throw new Error("reward_reference_mismatch");
  return safeTremendousHttpsLink(value.link, mode);
}

export function buildOrderPayload(order) {
  return {
    external_id: order.externalId,
    payment: { funding_source_id: "balance" },
    reward: {
      campaign_id: order.campaignId,
      products: [...order.productIds],
      value: { denomination: order.denomination, currency_code: "USD" },
      delivery: { method: "LINK" },
    },
  };
}

function supportsUsdDenomination(product, forex, denomination) {
  if (product.skus.length === 0 || product.currencies.length === 0) return false;
  return product.currencies.some((code) => {
    const rate = forex.get(code);
    if (!Number.isFinite(rate) || rate <= 0) return false;
    const converted = denomination * rate;
    return product.skus.some(({ minimum, maximum }) => converted + 0.005 >= minimum && converted - 0.005 <= maximum);
  });
}

function mapRewardState(rewardStatus, deliveryStatus) {
  const reward = rewardStatus.toUpperCase();
  const delivery = deliveryStatus.toUpperCase();
  if (reward.includes("CANCEL")) return "cancelled";
  if (reward.includes("FLAG") || delivery.includes("FLAG")) return "flagged";
  if (reward.includes("REDEEM") || reward.includes("SUCCEED")) return "succeeded";
  if (["SUCCEEDED", "PENDING", "DELIVERED"].includes(delivery)) return "active";
  return "unknown";
}

function mapDeliveryState(status) {
  const value = status.toUpperCase();
  if (["PENDING", "QUEUED"].includes(value)) return "pending";
  if (["SUCCEEDED", "DELIVERED"].includes(value)) return "succeeded";
  if (["FAILED", "BOUNCED"].includes(value)) return "failed";
  if (value.includes("CANCEL")) return "cancelled";
  return "unknown";
}

function sanitizeStatus(value) {
  const text = String(value || "unknown").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40);
  return /^[a-z]/.test(text) ? text : "unknown";
}

async function readJsonBounded(response, maximumBytes, signal) {
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await cancelResponseBody(response);
    throw new ProviderTransportError("response_too_large");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await withAbortDeadline(response.text(), signal, () => cancelResponseBody(response));
    if (Buffer.byteLength(text) > maximumBytes) throw new ProviderTransportError("response_too_large");
    return parseJson(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await withAbortDeadline(reader.read(), signal, () => reader.cancel());
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new ProviderTransportError("response_too_large");
    }
    chunks.push(value);
  }
  return parseJson(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
}

async function withAbortDeadline(promise, signal, cancel) {
  if (!signal || typeof signal.addEventListener !== "function") return promise;
  if (signal.aborted) {
    await bestEffortCancel(cancel);
    throw new ProviderTransportError("timeout");
  }
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      void bestEffortCancel(cancel);
      reject(new ProviderTransportError("timeout"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function cancelResponseBody(response) {
  if (typeof response?.body?.cancel !== "function") return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is best effort after a response is already rejected.
  }
}

async function bestEffortCancel(cancel) {
  if (typeof cancel !== "function") return;
  try {
    await cancel();
  } catch {
    // Cancellation is a containment step; the timeout remains authoritative.
  }
}

function parseJson(text) {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function retryAfterSeconds(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.ceil(parsed), 300) : 1;
}

function pathIdentifier(value) {
  return encodeURIComponent(identifier(value));
}

function identifier(value) {
  const text = String(value || "").trim();
  if (text.length > MAX_PROVIDER_ID_LENGTH || !SAFE_ID_RE.test(text)) throw new Error("invalid_provider_identifier");
  return text;
}

function identifierArray(value, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error("invalid_identifier_array");
  const result = value.map(identifier);
  if (new Set(result).size !== result.length) throw new Error("duplicate_identifier");
  return result;
}

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_provider_object");
  return value;
}

function currency(value) {
  const text = String(value || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(text)) throw new Error("invalid_currency");
  return text;
}

function providerStatus(value) {
  const text = String(value || "").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(text)) throw new Error("invalid_provider_status");
  return text;
}

function cents(value) {
  const number = strictNumber(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("invalid_cents");
  return number;
}

function finitePositive(value) {
  const number = strictNumber(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("invalid_positive_number");
  return number;
}

function finiteNonnegative(value) {
  const number = strictNumber(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("invalid_nonnegative_number");
  return number;
}

function moneyCents(value) {
  const number = finiteNonnegative(value);
  const rawCents = number * 100;
  const roundedCents = Math.round(rawCents);
  if (!Number.isSafeInteger(roundedCents) || Math.abs(rawCents - roundedCents) > 1e-8) {
    throw new Error("invalid_money_precision");
  }
  return roundedCents;
}

function strictNumber(value) {
  if (typeof value !== "number") throw new Error("invalid_number_type");
  return value;
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
