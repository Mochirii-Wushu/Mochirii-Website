import {
  RELAY_PATHS,
  buildResponseSignatureHeaders,
  drawResultIdFromExternalId,
  parseRelayRequest,
  stableJson,
  sha256Hex,
  verifySignedRequest,
} from "./protocol.mjs";
import {
  ProviderTransportError,
  buildOrderPayload,
  parseAndValidateOrder,
  parseBalance,
  parseCampaign,
  parseForex,
  parseGeneratedLink,
  parseOrganizations,
  parseProducts,
  parseRewardState,
  validateProductSelection,
} from "./tremendous.mjs";

export class RelayService {
  constructor({ config, state, provider, now = Date.now }) {
    this.config = config;
    this.state = state;
    this.provider = provider;
    this.now = now;
  }

  async handle({ method, path, headers, rawBody }) {
    const nowMs = this.now();
    if (method !== "POST" || !Object.values(RELAY_PATHS).includes(path)) return notFound();
    const verification = verifySignedRequest({
      secret: this.config.hmacSecret,
      method,
      path,
      headers,
      body: rawBody,
      state: this.state,
      nowMs,
      maxClockSkewSeconds: this.config.maximumClockSkewSeconds,
    });
    if (!verification.ok) return notFound();

    let request;
    try {
      request = parseRelayRequest(path, JSON.parse(rawBody.toString("utf8")));
    } catch {
      return signedResponse(notFound(), this.config.hmacSecret, path, verification);
    }
    if (request.environment !== this.config.mode) {
      return signedResponse(notFound(), this.config.hmacSecret, path, verification);
    }
    if (!this.state.consumeRate(`endpoint:${path}`, nowMs, this.config.requestRateLimitPerMinute, 60_000)) {
      return signedResponse(
        response(429, { error: "rate_limited" }, { "Retry-After": "60" }),
        this.config.hmacSecret,
        path,
        verification,
      );
    }

    let result;
    try {
      if (path === RELAY_PATHS.readiness) result = await this.#readiness(request);
      else if (path === RELAY_PATHS.createOrder) result = await this.#createOrder(request);
      else if (path === RELAY_PATHS.lookupOrder) result = await this.#lookupOrder(request);
      else if (path === RELAY_PATHS.rewardState) result = await this.#rewardState(request);
      else if (path === RELAY_PATHS.generateLink) result = await this.#generateLink(request);
      else result = notFound();
    } catch (error) {
      result = this.#mapFailure(error);
    }
    return signedResponse(result, this.config.hmacSecret, path, verification);
  }

  async #readiness(request) {
    this.#requireActiveProvider();
    const readiness = await this.#loadReadiness(request.configurationHash);
    return response(200, readiness);
  }

  async #createOrder(request) {
    this.#requireActiveProvider();
    if (!this.config.ordersEnabled || this.state.getControl().ordersSuspended) throw failure(503, "orders_disabled");
    this.#validateOrderRequest(request);

    const requestJson = stableJson(request);
    const requestHash = sha256Hex(Buffer.from(requestJson));
    const reservation = this.state.reserveOrder({
      externalId: request.externalId,
      cycleId: request.cycleId,
      drawResultId: request.drawResultId,
      rewardValueCents: request.denomination * 100,
      maximumCycleCostCents: this.config.maximumCycleCostCents,
      requestHash,
      requestJson,
      environment: request.environment,
      nowMs: this.now(),
    });
    if (reservation.outcome === "cycle_budget_exceeded") throw failure(422, "cycle_budget_exceeded");
    if (reservation.outcome === "conflict") throw integrityFailure("local_idempotency_conflict");
    if (reservation.binding.state === "succeeded") {
      return response(201, orderResponse("existing", reservation.binding));
    }
    if (reservation.binding.state === "terminal") throw failure(422, reservation.binding.sanitized_status || "terminal_order_error");

    if (reservation.binding.attempted_at_ms != null || reservation.binding.state === "uncertain") {
      const reconciled = await this.#reconcileKnownOrder(reservation.binding, request, { allowNotFound: true });
      if (reconciled) return response(201, { outcome: "existing", ...reconciled });
    }

    const readiness = await this.#loadReadiness(request.configurationHash);
    if (!readiness.ready || !readiness.ordersEnabled) throw failure(503, "not_ready");

    const productResponse = await this.provider.listProducts(request.countryCode);
    this.#expectProviderStatus(productResponse, [200]);
    const forexResponse = await this.provider.listForex();
    this.#expectProviderStatus(forexResponse, [200]);
    try {
      const products = parseProducts(productResponse.body);
      const forex = parseForex(forexResponse.body);
      validateProductSelection({
        products,
        requestedProductIds: request.productIds,
        countryCode: request.countryCode,
        forex,
        denomination: request.denomination,
      });
    } catch {
      throw integrityFailure("catalog_changed");
    }

    const payload = buildOrderPayload(request);
    this.state.markOrderUncertain(request.externalId, this.now());
    let providerResponse;
    try {
      providerResponse = await this.provider.createOrder(payload);
    } catch (error) {
      if (error instanceof ProviderTransportError) throw failure(503, "provider_uncertain");
      throw error;
    }

    if (providerResponse.status === 200 || providerResponse.status === 201) {
      let parsed;
      try {
        parsed = parseAndValidateOrder(providerResponse.body, request);
      } catch {
        throw integrityFailure("order_response_integrity");
      }
      const binding = this.state.completeOrder(request.externalId, parsed, this.now());
      return response(providerResponse.status, orderResponse(providerResponse.status === 200 ? "created" : "existing", binding));
    }
    if (providerResponse.status === 400 || providerResponse.status === 422) {
      this.state.markOrderTerminal(request.externalId, "provider_validation_error", this.now());
      throw failure(providerResponse.status, "provider_validation_error");
    }
    if (providerResponse.status === 401) throw integrityFailure("provider_authorization_stop", 401, "authorization_stop");
    if (providerResponse.status === 402) throw integrityFailure("funding_stop", 402, "funding_stop");
    if (providerResponse.status === 409) throw integrityFailure("provider_idempotency_conflict");
    if (providerResponse.status === 429) {
      throw failure(429, "provider_rate_limited", providerResponse.retryAfterSeconds);
    }
    if ([500, 502, 503, 504].includes(providerResponse.status)) throw failure(503, "provider_uncertain");
    throw integrityFailure("unexpected_provider_status");
  }

  async #lookupOrder(request) {
    this.#requireActiveProvider();
    const binding = this.state.getOrderByExternalId(request.externalId);
    if (!binding || binding.environment !== request.environment) return notFound();
    const storedRequest = parseStoredRequest(binding.request_json);
    const reconciled = await this.#reconcileKnownOrder(binding, storedRequest, { allowNotFound: binding.state !== "succeeded" });
    if (!reconciled) return notFound();
    return response(200, { outcome: "found", ...reconciled });
  }

  async #rewardState(request) {
    this.#requireActiveProvider();
    const binding = this.state.getOrderByRewardReference(request.rewardReference);
    if (!binding || binding.environment !== request.environment || binding.state !== "succeeded") return notFound();
    const providerResponse = await this.provider.getReward(request.rewardReference);
    this.#expectProviderStatus(providerResponse, [200]);
    let value;
    try {
      value = parseRewardState(providerResponse.body, request.rewardReference);
    } catch {
      throw integrityFailure("reward_response_integrity");
    }
    return response(200, value);
  }

  async #generateLink(request) {
    this.#requireActiveProvider();
    const binding = this.state.getOrderByRewardReference(request.rewardReference);
    if (
      !binding ||
      binding.environment !== request.environment ||
      binding.state !== "succeeded" ||
      binding.draw_result_id !== request.drawResultId
    ) return notFound();
    const rewardStateResponse = await this.provider.getReward(request.rewardReference);
    this.#expectProviderStatus(rewardStateResponse, [200]);
    let currentRewardState;
    try {
      currentRewardState = parseRewardState(rewardStateResponse.body, request.rewardReference);
    } catch {
      throw integrityFailure("reward_response_integrity");
    }
    if (currentRewardState.state !== "active") throw failure(423, "reward_unavailable");
    const linkAuthorization = this.state.consumeLinkGeneration(
      request.rewardReference,
      this.now(),
      15 * 60_000,
      this.config.maximumLinkGenerationsPerReward,
    );
    if (!linkAuthorization.ok) {
      if (linkAuthorization.reason === "maximum") return response(423, { error: "link_locked" });
      const retrySeconds = Math.max(1, Math.ceil((linkAuthorization.retryAfterMs || 15 * 60_000) / 1_000));
      return response(429, { error: "link_rate_limited" }, { "Retry-After": String(retrySeconds) });
    }
    const providerResponse = await this.provider.generateLink(request.rewardReference);
    if (providerResponse.status === 403 || providerResponse.status === 404) throw failure(providerResponse.status, "link_unavailable");
    this.#expectProviderStatus(providerResponse, [200]);
    let url;
    try {
      url = parseGeneratedLink(providerResponse.body, request.rewardReference, this.config.mode);
    } catch {
      throw integrityFailure("link_response_integrity");
    }
    return response(200, { url });
  }

  async #loadReadiness(requestConfigurationHash) {
    const [organizationResponse, campaignResponse, balanceResponse, forexResponse, ...countryProductResponses] = await Promise.all([
      this.provider.listOrganizations(),
      this.provider.getCampaign(this.config.campaignId),
      this.provider.getBalance(),
      this.provider.listForex(),
      ...this.config.approvedCountries.map((country) => this.provider.listProducts(country)),
    ]);
    this.#expectProviderStatus(organizationResponse, [200]);
    this.#expectProviderStatus(campaignResponse, [200]);
    this.#expectProviderStatus(balanceResponse, [200]);
    this.#expectProviderStatus(forexResponse, [200]);
    for (const productResponse of countryProductResponses) this.#expectProviderStatus(productResponse, [200]);

    let organization;
    let campaign;
    let balance;
    let forex;
    try {
      organization = parseOrganizations(organizationResponse.body);
      campaign = parseCampaign(campaignResponse.body);
      balance = parseBalance(balanceResponse.body);
      forex = parseForex(forexResponse.body);
    } catch {
      throw integrityFailure("readiness_response_integrity");
    }
    const countryCatalogMatches = this.config.approvedCountries.every((countryCode, index) => {
      try {
        const products = parseProducts(countryProductResponses[index].body);
        return this.config.reviewedProductIds.some((productId) => {
          try {
            validateProductSelection({
              products,
              requestedProductIds: [productId],
              countryCode,
              forex,
              denomination: this.config.minimumRewardValueCents / 100,
            });
            validateProductSelection({
              products,
              requestedProductIds: [productId],
              countryCode,
              forex,
              denomination: this.config.maximumRewardValueCents / 100,
            });
            return true;
          } catch {
            return false;
          }
        });
      } catch {
        return false;
      }
    });
    const organizationMatches = organization.id === this.config.expectedOrganizationId && organization.currencyCode === "USD";
    const campaignMatches = campaign.id === this.config.campaignId &&
      campaign.feeChargedTo === "SENDER" &&
      !campaign.autoAddEnabled &&
      sameStrings(campaign.products, [...this.config.reviewedProductIds]) &&
      countryCatalogMatches;
    const configurationMatches = requestConfigurationHash === this.config.derivedConfigurationHash &&
      this.config.configuredHash === this.config.derivedConfigurationHash;
    const apiOrders = balance.method === "balance" && balance.status === "active" && balance.usagePermissions.includes("api_orders");
    const balanceWithinPolicy = balance.currencyCode === "USD" &&
      balance.availableCents >= this.config.minimumAvailableBalanceCents &&
      balance.availableCents + balance.pendingCents <= this.config.maximumBalanceCents;
    const accountStatus = organization.status === "APPROVED" ? "active" : organization.status.includes("REVIEW") ? "review" : "inactive";
    if (!organizationMatches || !campaignMatches || accountStatus !== "active" || !apiOrders || !balanceWithinPolicy) {
      this.state.suspendOrders("readiness_integrity_stop", this.now());
    }
    const control = this.state.getControl();
    const ordersEnabled = this.config.ordersEnabled && !control.ordersSuspended && configurationMatches;
    return {
      ready: accountStatus === "active" && apiOrders && organizationMatches && campaignMatches && configurationMatches && balanceWithinPolicy,
      environment: this.config.mode,
      accountStatus,
      apiOrders,
      ordersEnabled,
      organizationMatches,
      campaignMatches,
      configurationMatches,
      availableBalanceCents: balance.availableCents,
      pendingBalanceCents: balance.pendingCents,
    };
  }

  #validateOrderRequest(request) {
    if (request.configurationHash !== this.config.derivedConfigurationHash || request.configurationHash !== this.config.configuredHash) {
      throw failure(409, "configuration_mismatch");
    }
    if (drawResultIdFromExternalId(request.externalId) !== request.drawResultId) throw integrityFailure("external_id_mismatch");
    if (request.campaignId !== this.config.campaignId) throw failure(409, "campaign_mismatch");
    const grossPrizeCents = request.denomination * 100;
    if (
      !Number.isSafeInteger(request.denomination) ||
      grossPrizeCents < this.config.minimumRewardValueCents ||
      grossPrizeCents > this.config.maximumRewardValueCents ||
      grossPrizeCents > this.config.maximumCycleCostCents
    ) {
      throw failure(422, "reward_value_not_approved");
    }
    if (!this.config.approvedCountries.includes(request.countryCode)) throw failure(422, "country_not_approved");
    if (!request.productIds.every((id) => this.config.reviewedProductIds.includes(id) && this.config.feeFreeProductIds.includes(id))) {
      throw failure(422, "product_not_approved");
    }
  }

  async #reconcileKnownOrder(binding, request, { allowNotFound }) {
    let providerResponse;
    try {
      providerResponse = await this.provider.getOrder(binding.external_id);
    } catch (error) {
      if (error instanceof ProviderTransportError) throw failure(503, "provider_uncertain");
      throw error;
    }
    if (providerResponse.status === 404 && allowNotFound) return null;
    if (providerResponse.status === 404) throw integrityFailure("upstream_order_missing");
    this.#expectProviderStatus(providerResponse, [200]);
    let parsed;
    try {
      parsed = parseAndValidateOrder(providerResponse.body, request);
    } catch {
      throw integrityFailure("order_reconciliation_integrity");
    }
    if (
      (binding.provider_order_id && binding.provider_order_id !== parsed.orderReference) ||
      (binding.provider_reward_id && binding.provider_reward_id !== parsed.rewardReference)
    ) throw integrityFailure("provider_binding_conflict");
    const completed = this.state.completeOrder(binding.external_id, parsed, this.now());
    return {
      orderReference: completed.provider_order_id,
      rewardReference: completed.provider_reward_id,
      sanitizedStatus: completed.sanitized_status,
    };
  }

  #expectProviderStatus(providerResponse, expected) {
    if (expected.includes(providerResponse.status)) return;
    if (providerResponse.status === 401) throw integrityFailure("provider_authorization_stop", 401, "authorization_stop");
    if (providerResponse.status === 402) throw integrityFailure("funding_stop", 402, "funding_stop");
    if (providerResponse.status === 429) throw failure(429, "provider_rate_limited", providerResponse.retryAfterSeconds);
    if ([500, 502, 503, 504].includes(providerResponse.status)) throw failure(503, "provider_unavailable");
    if (providerResponse.status === 404) throw integrityFailure("provider_resource_missing");
    throw failure(503, "provider_unavailable");
  }

  #requireActiveProvider() {
    if (this.config.mode === "disabled" || !this.provider) throw failure(503, "provider_disabled");
  }

  #mapFailure(error) {
    if (error instanceof IntegrityFailure) {
      this.state.suspendOrders(error.reasonCode, this.now());
      return response(error.status, { error: error.safeCode });
    }
    if (error instanceof RelayFailure) {
      const headers = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {};
      return response(error.status, { error: error.safeCode }, headers);
    }
    if (error instanceof ProviderTransportError) return response(503, { error: "provider_unavailable" });
    return response(503, { error: "relay_failure" });
  }
}

class RelayFailure extends Error {
  constructor(status, safeCode, retryAfterSeconds = null) {
    super("relay_failure");
    this.status = status;
    this.safeCode = safeCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class IntegrityFailure extends Error {
  constructor(reasonCode, status = 409, safeCode = "integrity_stop") {
    super("integrity_failure");
    this.reasonCode = reasonCode;
    this.status = status;
    this.safeCode = safeCode;
  }
}

function failure(status, safeCode, retryAfterSeconds = null) {
  return new RelayFailure(status, safeCode, retryAfterSeconds);
}

function integrityFailure(reasonCode, status = 409, safeCode = "integrity_stop") {
  return new IntegrityFailure(reasonCode, status, safeCode);
}

function response(status, body, headers = {}) {
  return { status, body, headers };
}

function signedResponse(result, secret, path, verification) {
  return {
    ...result,
    headers: {
      ...result.headers,
      ...buildResponseSignatureHeaders({
        secret,
        path,
        status: result.status,
        requestTimestamp: verification.timestamp,
        requestNonce: verification.nonce,
        body: result.body,
      }),
    },
  };
}

function notFound() {
  return response(404, {});
}

function orderResponse(outcome, binding) {
  return {
    outcome,
    orderReference: binding.provider_order_id,
    rewardReference: binding.provider_reward_id,
    sanitizedStatus: binding.sanitized_status,
  };
}

function parseStoredRequest(value) {
  const parsed = JSON.parse(value);
  return parseRelayRequest(RELAY_PATHS.createOrder, parsed);
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
