import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  RELAY_PATHS,
  buildSignatureHeaders,
  safeTremendousHttpsLink,
  verifySignedResponse,
} from "../src/protocol.mjs";
import {
  REWARD_HANDOFF_PATH,
  RewardHandoffRejected,
  assertTrustedBrowserRequest,
  clearRewardHandoffCookie,
  consumeRewardHandoff,
  createRewardHandoff,
} from "./reward-handoff.mjs";

export const REWARD_CLAIM_PATH = "/api/raffle/claim-reward";
export const REWARD_CLAIM_PAGE_PATH = "/raffle/claim";
export const REWARD_CLAIM_ROUTE_POLICY = Object.freeze({
  path: REWARD_CLAIM_PAGE_PATH,
  cacheControl: "private, no-store",
  referrerPolicy: "no-referrer",
  analytics: false,
  thirdPartyScripts: false,
  thirdPartyRequests: false,
});

const REWARD_KINDS = new Set(["electronic", "in_game", "community_honor"]);
const AUTHORIZATION_STATES = new Set(["authorized", "already_authorized"]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RewardClaimBoundary {
  constructor({
    relay,
    relaySecret,
    relayEnvironment,
    handoffKey,
    trustedOrigin = "https://mochirii.com",
    storeHandoffHandle,
    consumeHandoffHandle,
    claimsEnabled = false,
    authorizeClaim = async () => null,
    recordInGameClaim = async () => false,
    recordCommunityHonor = async () => false,
    now = Date.now,
    nonce = () => randomUUID().replaceAll("-", ""),
    logger = () => {},
  }) {
    if (!relay || typeof relay.handle !== "function") throw new Error("Reward relay contract is missing.");
    if (typeof relaySecret !== "string" || relaySecret.length < 32) throw new Error("Reward relay secret is missing.");
    if (!["sandbox", "production"].includes(relayEnvironment)) {
      throw new Error("Reward relay environment is invalid.");
    }
    if (typeof storeHandoffHandle !== "function" || typeof consumeHandoffHandle !== "function") {
      throw new Error("Reward handoff store is missing.");
    }
    if (typeof claimsEnabled !== "boolean") throw new Error("Reward claim gate is invalid.");
    if (typeof authorizeClaim !== "function") throw new Error("Reward claim authorization adapter is invalid.");
    if (typeof recordInGameClaim !== "function" || typeof recordCommunityHonor !== "function") {
      throw new Error("Non-electronic reward handlers are invalid.");
    }
    this.relay = relay;
    this.relaySecret = relaySecret;
    this.relayEnvironment = relayEnvironment;
    this.handoffKey = handoffKey;
    this.trustedOrigin = trustedOrigin;
    this.storeHandoffHandle = storeHandoffHandle;
    this.consumeHandoffHandle = consumeHandoffHandle;
    this.claimsEnabled = claimsEnabled;
    this.authorizeClaim = authorizeClaim;
    this.recordInGameClaim = recordInGameClaim;
    this.recordCommunityHonor = recordCommunityHonor;
    this.now = now;
    this.nonce = nonce;
    this.logger = logger;
  }

  async beginClaim({ request, authenticatedMemberId, drawResultId }) {
    try {
      this.#assertRequest(request, "POST", REWARD_CLAIM_PATH, true);
      const memberId = identifier(authenticatedMemberId);
      const requestedDrawResultId = uuid(drawResultId);
      if (!this.claimsEnabled) return this.#unavailable("begin");
      const claim = await this.#authorize({
        phase: "begin",
        memberId,
        drawResultId: requestedDrawResultId,
        rewardReference: null,
      });
      if (
        !claim ||
        !constantTimeTextEqual(memberId, claim.memberId) ||
        !constantTimeTextEqual(requestedDrawResultId, claim.drawResultId)
      ) return this.#notFound("begin");

      if (claim.rewardKind === "in_game") {
        if (await this.recordInGameClaim(nonElectronicClaim(claim)) !== true) return this.#unavailable("begin");
        return this.#result("begin", 202, { outcome: "in_game_claim_recorded" });
      }
      if (claim.rewardKind === "community_honor") {
        if (await this.recordCommunityHonor(nonElectronicClaim(claim)) !== true) return this.#unavailable("begin");
        return this.#result("begin", 202, { outcome: "community_honor_confirmed" });
      }

      const handoff = await createRewardHandoff({
        key: this.handoffKey,
        origin: this.trustedOrigin,
        memberId,
        drawResultId: claim.drawResultId,
        rewardReference: claim.rewardReference,
        environment: this.relayEnvironment,
        storeHandoffHandle: this.storeHandoffHandle,
        nowMs: this.now(),
      });
      return this.#result("begin", 303, {}, {
        location: REWARD_HANDOFF_PATH,
        "set-cookie": handoff.setCookie,
      });
    } catch {
      return this.#notFound("begin");
    }
  }

  async openReward({ request, authenticatedMemberId }) {
    try {
      this.#assertRequest(request, "GET", REWARD_HANDOFF_PATH, false);
      if (!this.claimsEnabled) return this.#unavailable("open");
      const handoff = await consumeRewardHandoff({
        cookieHeader: request.cookie,
        key: this.handoffKey,
        origin: this.trustedOrigin,
        host: request.host,
        path: request.path,
        memberId: identifier(authenticatedMemberId),
        environment: this.relayEnvironment,
        consumeHandoffHandle: this.consumeHandoffHandle,
        nowMs: this.now(),
      });
      const claim = await this.#authorize({
        phase: "open",
        memberId: identifier(authenticatedMemberId),
        drawResultId: handoff.drawResultId,
        rewardReference: handoff.rewardReference,
      });
      if (
        !claim ||
        claim.rewardKind !== "electronic" ||
        !constantTimeTextEqual(claim.memberId, identifier(authenticatedMemberId)) ||
        !constantTimeTextEqual(claim.drawResultId, handoff.drawResultId) ||
        !constantTimeTextEqual(claim.rewardReference, handoff.rewardReference)
      ) return this.#notFound("open", true);
      const rewardUrl = await this.#generateRewardUrl(claim);
      if (!rewardUrl) return this.#unavailable("open", true);
      return this.#result("open", 303, {}, {
        location: safeTremendousHttpsLink(rewardUrl, this.relayEnvironment),
        "set-cookie": handoff.clearCookie,
      });
    } catch (error) {
      if (error instanceof RewardHandoffRejected) return this.#notFound("open", true);
      return this.#notFound("open", true);
    }
  }

  #assertRequest(request, method, path, requireOrigin) {
    if (!request || request.method !== method || request.fetchSite !== "same-origin") throw new Error("invalid request");
    assertTrustedBrowserRequest({
      expectedOrigin: this.trustedOrigin,
      requestOrigin: request.origin,
      requestHost: request.host,
      requestPath: request.path,
      expectedPath: path,
      requireOrigin,
    });
  }

  async #authorize({ phase, memberId, drawResultId, rewardReference }) {
    const value = await this.authorizeClaim(Object.freeze({
      phase,
      authenticatedMemberId: memberId,
      drawResultId,
      rewardReference,
      authorizationMode: phase === "begin" ? "authorize_or_replay" : "revalidate_for_handoff",
      requireAtomicAuthorization: true,
      nowMs: this.now(),
    }));
    return value == null ? null : exactClaimAuthorization(value);
  }

  async #generateRewardUrl(claim) {
    const requestBody = {
      operation: "generate_link",
      environment: this.relayEnvironment,
      drawResultId: claim.drawResultId,
      rewardReference: claim.rewardReference,
    };
    const rawBody = Buffer.from(JSON.stringify(requestBody), "utf8");
    const requestTimestamp = Math.floor(this.now() / 1_000);
    const requestNonce = this.nonce();
    const headers = buildSignatureHeaders({
      secret: this.relaySecret,
      path: RELAY_PATHS.generateLink,
      body: rawBody,
      timestampSeconds: requestTimestamp,
      nonce: requestNonce,
    });
    const relayResponse = await this.relay.handle({
      method: "POST",
      path: RELAY_PATHS.generateLink,
      headers,
      rawBody,
    });
    if (!verifySignedResponse({
      secret: this.relaySecret,
      path: RELAY_PATHS.generateLink,
      status: relayResponse.status,
      requestTimestamp,
      requestNonce,
      headers: relayResponse.headers,
      body: relayResponse.body,
    })) return null;
    if (
      relayResponse.status !== 200 ||
      !relayResponse.body ||
      Object.keys(relayResponse.body).length !== 1 ||
      typeof relayResponse.body.url !== "string"
    ) return null;
    try {
      return safeTremendousHttpsLink(relayResponse.body.url, this.relayEnvironment);
    } catch {
      return null;
    }
  }

  #result(phase, status, body, extraHeaders = {}) {
    const headers = {
      "cache-control": "private, no-store",
      pragma: "no-cache",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    };
    this.logger(Object.freeze({ event: "reward_claim_boundary", phase, status }));
    return Object.freeze({ status, body: Object.freeze(body), headers: Object.freeze(headers) });
  }

  #notFound(phase, clearCookie = false) {
    return this.#result(phase, 404, {}, clearCookie ? { "set-cookie": clearRewardHandoffCookie() } : {});
  }

  #unavailable(phase, clearCookie = false) {
    return this.#result(
      phase,
      503,
      { error: "reward_unavailable" },
      clearCookie ? { "set-cookie": clearRewardHandoffCookie() } : {},
    );
  }
}

function nonElectronicClaim(claim) {
  return Object.freeze({
    drawResultId: claim.drawResultId,
    memberId: claim.memberId,
    rewardKind: claim.rewardKind,
    rewardReference: claim.rewardReference,
  });
}

function exactClaimAuthorization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid claim authorization");
  const keys = Object.keys(value).sort();
  const expected = [
    "authorizationState", "deadlineState", "drawResultId", "memberId", "membershipState",
    "ownershipState", "rewardKind", "rewardReference",
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("invalid claim authorization");
  }
  const rewardKind = String(value.rewardKind || "");
  if (
    !REWARD_KINDS.has(rewardKind) ||
    value.membershipState !== "active" ||
    value.ownershipState !== "winner" ||
    value.deadlineState !== "open" ||
    !AUTHORIZATION_STATES.has(value.authorizationState)
  ) throw new Error("invalid claim authorization");
  return {
    authorizationState: value.authorizationState,
    deadlineState: value.deadlineState,
    drawResultId: uuid(value.drawResultId),
    memberId: identifier(value.memberId),
    membershipState: value.membershipState,
    ownershipState: value.ownershipState,
    rewardKind,
    rewardReference: identifier(value.rewardReference),
  };
}

function identifier(value) {
  const text = String(value || "").trim();
  if (!ID_RE.test(text)) throw new Error("invalid identifier");
  return text;
}

function uuid(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(text)) throw new Error("invalid UUID");
  return text;
}

function constantTimeTextEqual(left, right) {
  const leftBytes = Buffer.from(String(left), "utf8");
  const rightBytes = Buffer.from(String(right), "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}
