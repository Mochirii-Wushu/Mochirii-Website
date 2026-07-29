import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  asRecord,
  completeFrozenDraw,
  freezeCycle,
  jsonResponse,
  readJson,
  requireRaffleModerator,
  safeString,
} from "../_shared/raffle-edge.ts";
import {
  isClaimFraudReviewState,
  isClaimTaxReviewState,
  isCompletionMethod,
  isRaffleBonusKey,
  normalizeReviewedProductSubset,
  verifiedBonusEvidenceIsValid,
} from "../_shared/raffle-entry.ts";
import {
  cyclePublicId,
  cycleWindowForDraw,
  nextDrawAfter,
} from "../_shared/raffle-schedule.ts";
import {
  isAllowedRafflePrizeCents,
  RAFFLE_ALL_IN_CAP_CENTS,
  RAFFLE_DEFAULT_PRIZE_CENTS,
  RAFFLE_MINIMUM_PRIZE_CENTS,
  rafflePrizeCentsFromDollars,
  rafflePublicRewardLabel,
} from "../_shared/raffle-prize.ts";
import {
  raffleModeratorActionDecision,
  type RaffleOperationalGates,
  raffleOperationalGates,
} from "../_shared/raffle-flags.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ModerateRaffleDependencies = {
  requireModerator?: typeof requireRaffleModerator;
  gates?: () => RaffleOperationalGates;
};

if (import.meta.main) {
  Deno.serve((req: Request) =>
    withProtectedCors(req, handleModerateRaffleRequest(req))
  );
}

export async function handleModerateRaffleRequest(
  req: Request,
  dependencies: ModerateRaffleDependencies = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const access = await (dependencies.requireModerator ||
    requireRaffleModerator)(req);
  if (!access.ok) return access.response;

  let body;
  try {
    body = await readJson(req, 32_768);
  } catch {
    return jsonResponse({
      ok: false,
      error: "invalid_json",
      message: "Request body must be a small valid JSON object.",
    }, 400);
  }
  const action = safeString(body.action, 40) || "readiness";
  const gateDecision = raffleModeratorActionDecision(
    action,
    (dependencies.gates || raffleOperationalGates)(),
  );
  if (!gateDecision.known) {
    return jsonResponse({
      ok: false,
      error: "invalid_action",
      message: "Raffle leader action is not supported.",
    }, 400);
  }
  if (!gateDecision.allowed) {
    return jsonResponse({
      ok: false,
      error: "operation_closed",
      message: "This Raffle operation is closed.",
    }, 409);
  }

  try {
    if (action === "create_draft") {
      const requestedDraw = safeString(body.drawAt || body.draw_at, 80);
      const drawAt = requestedDraw
        ? new Date(requestedDraw)
        : nextDrawAfter(new Date());
      const claimWindowDays = Number(
        body.claimWindowDays ?? body.claim_window_days ?? 7,
      );
      const awardWindowDays = Number(
        body.awardWindowDays ?? body.award_window_days ?? 30,
      );
      if (!Number.isFinite(drawAt.getTime())) {
        return jsonResponse({
          ok: false,
          error: "invalid_draw_time",
          message: "Draw time is invalid.",
        }, 400);
      }
      if (
        !Number.isInteger(claimWindowDays) || claimWindowDays < 1 ||
        claimWindowDays > 30 || !Number.isInteger(awardWindowDays) ||
        awardWindowDays < 7 || awardWindowDays > 90
      ) {
        return jsonResponse({
          ok: false,
          error: "invalid_claim_or_award_window",
          message: "Claim or award timing is invalid.",
        }, 400);
      }
      let window;
      try {
        window = cycleWindowForDraw(drawAt, awardWindowDays);
      } catch {
        return jsonResponse({
          ok: false,
          error: "invalid_draw_time",
          message: "Draw must be the first Saturday at 9:30 PM (UTC+8).",
        }, 400);
      }
      const rulesVersion = safeString(
        body.rulesVersion || body.rules_version,
        64,
      );
      if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(rulesVersion)) {
        return jsonResponse({
          ok: false,
          error: "invalid_rules_version",
          message: "A versioned rules identifier is required.",
        }, 400);
      }
      const rawPrizeCents = body.grossPrizeCents ?? body.gross_prize_cents;
      const rawPrizeDollars = body.rewardValueDollars ??
        body.reward_value_dollars;
      const centsPrize = rawPrizeCents === undefined
        ? null
        : isAllowedRafflePrizeCents(rawPrizeCents)
        ? Number(rawPrizeCents)
        : Number.NaN;
      const dollarPrize = rawPrizeDollars === undefined
        ? null
        : rafflePrizeCentsFromDollars(rawPrizeDollars);
      const suppliedCap = body.allInCostCapCents ??
        body.all_in_cost_cap_cents;
      const rewardValueCents = centsPrize ?? dollarPrize ??
        RAFFLE_DEFAULT_PRIZE_CENTS;
      if (
        !isAllowedRafflePrizeCents(rewardValueCents) ||
        (centsPrize !== null && dollarPrize !== null &&
          centsPrize !== dollarPrize) ||
        (suppliedCap !== undefined && suppliedCap !== RAFFLE_ALL_IN_CAP_CENTS)
      ) {
        return jsonResponse({
          ok: false,
          error: "invalid_reward_value",
          message:
            "The gross raffle prize must be a whole-dollar amount from $10 through $50.",
        }, 400);
      }
      const { data, error } = await access.adminClient.from("raffle_cycles")
        .insert({
          public_cycle_id: cyclePublicId(drawAt),
          status: "draft",
          opens_at: window.opensAt.toISOString(),
          closes_at: window.closesAt.toISOString(),
          draw_at: window.drawAt.toISOString(),
          expires_at: window.expiresAt.toISOString(),
          claim_window_days: claimWindowDays,
          award_window_days: awardWindowDays,
          minimum_eligible_entrants: 3,
          rules_version: rulesVersion,
          rules_version_url: `/raffle#drawing-rules-${rulesVersion}`,
          reward_value_cents: rewardValueCents,
          cycle_cost_ceiling_cents: RAFFLE_ALL_IN_CAP_CENTS,
          public_reward_label: rafflePublicRewardLabel(rewardValueCents),
          approved_country_codes: [],
          created_by: access.userId,
        }).select(
          "id,public_cycle_id,status,opens_at,closes_at,draw_at,rules_version,reward_value_cents,cycle_cost_ceiling_cents",
        ).single();
      if (error) throw error;
      return jsonResponse({
        ok: true,
        data: {
          ...data,
          grossPrizeCents: Number(data.reward_value_cents),
          allInCostCapCents: Number(data.cycle_cost_ceiling_cents),
        },
        message:
          "A fail-closed draft cycle was created. It cannot open until the approved launch packet sets every gate.",
      });
    }

    const cycleId = safeString(body.cycleId || body.cycle_id, 80);
    if (action !== "readiness" && (!cycleId || !UUID_RE.test(cycleId))) {
      return jsonResponse({
        ok: false,
        error: "invalid_cycle_id",
        message: "A valid Raffle cycle is required.",
      }, 400);
    }

    const claimControlActions = new Set([
      "review_claim_tax",
      "review_claim_clearance",
      "record_private_notice",
      "release_digital_fulfillment",
      "complete_in_game_fulfillment",
    ]);
    let targetDrawResultId = "";
    if (claimControlActions.has(action)) {
      targetDrawResultId = safeString(
        body.drawResultId || body.draw_result_id,
        80,
      );
      if (!UUID_RE.test(targetDrawResultId)) {
        return jsonResponse({
          ok: false,
          error: "invalid_draw_result_id",
          message: "A valid private claim result is required.",
        }, 400);
      }
      const { data: target, error: targetError } = await access.adminClient
        .from("raffle_draw_results")
        .select("id")
        .eq("id", targetDrawResultId)
        .eq("cycle_id", cycleId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) {
        return jsonResponse({
          ok: false,
          error: "claim_not_found",
          message: "That private claim is not part of this Raffle cycle.",
        }, 404);
      }
    }

    if (action === "open_cycle") {
      const now = new Date();
      const { data, error } = await access.adminClient.rpc(
        "open_raffle_cycle",
        {
          p_cycle_id: cycleId,
          p_actor_id: access.userId,
          p_now: now.toISOString(),
        },
      );
      if (error) throw error;
      const result = asRecord(Array.isArray(data) ? data[0] : data);
      if (result.opened !== true) {
        return jsonResponse({
          ok: false,
          error: "cycle_not_openable",
          data: {
            cycleState: safeString(result.cycleStatus, 30) || "blocked",
            reasonCode: safeString(result.reasonCode, 80) ||
              "readiness_incomplete",
          },
          message:
            "This cycle remains closed because a current launch or private fulfillment readiness gate did not pass.",
        }, 409);
      }
      return jsonResponse({
        ok: true,
        data: {
          cycleState: "open",
          duplicate: result.duplicate === true,
        },
        message: "Raffle entry opened.",
      });
    }

    if (action === "freeze_cycle" || action === "draw_cycle") {
      const frozen = await freezeCycle(
        access.adminClient,
        cycleId,
        access.userId,
        new Date(),
      );
      if (action === "freeze_cycle") {
        return jsonResponse({
          ok: true,
          data: {
            drawId: frozen.drawId,
            entrantCount: frozen.entrantCount,
            totalEntryCount: frozen.totalEntryCount,
            duplicate: frozen.duplicate === true,
          },
          message: "The canonical entry ledger is frozen.",
        });
      }
      const completed = await completeFrozenDraw(
        access.adminClient,
        frozen,
        access.userId,
        new Date(),
      );
      return jsonResponse({
        ok: true,
        data: completed,
        message: completed.duplicate
          ? "The existing draw result was returned without redrawing."
          : "The Raffle result and alternate order were recorded.",
      });
    }

    if (action === "review_eligibility") {
      const memberId = safeString(body.memberId || body.member_id, 80);
      const decision = safeString(body.decision, 20);
      const exclusionType = safeString(
        body.exclusionType || body.exclusion_type,
        30,
      );
      if (
        !UUID_RE.test(memberId) || !["clear", "exclude"].includes(decision) ||
        (decision === "exclude" &&
          !["administrator", "household"].includes(exclusionType))
      ) {
        return jsonResponse({
          ok: false,
          error: "invalid_eligibility_review",
          message: "Choose a member and a clear or exclude decision.",
        }, 400);
      }

      const [entryResult, profileResult, cycleResult] = await Promise.all([
        access.adminClient.from("raffle_entries")
          .select(
            "id,country_code,age_18_affirmed,rules_accepted_at,withdrawn_at",
          )
          .eq("cycle_id", cycleId).eq("member_id", memberId).maybeSingle(),
        access.adminClient.from("member_profiles")
          .select(
            "id,member_status,has_required_discord_roles,discord_verified_at,discord_roles",
          )
          .eq("id", memberId).maybeSingle(),
        access.adminClient.from("raffle_cycles")
          .select(
            "id,status,approved_country_codes,rules_version,country_matrix_version",
          )
          .eq("id", cycleId).maybeSingle(),
      ]);
      if (entryResult.error) throw entryResult.error;
      if (profileResult.error) throw profileResult.error;
      if (cycleResult.error) throw cycleResult.error;
      const entry = asRecord(entryResult.data);
      const profile = asRecord(profileResult.data);
      const cycle = asRecord(cycleResult.data);
      if (
        !entry.id || !profile.id || cycle.status !== "open" ||
        entry.withdrawn_at
      ) {
        return jsonResponse({
          ok: false,
          error: "entry_not_reviewable",
          message:
            "Only an open, opted-in entry can receive eligibility clearance.",
        }, 409);
      }

      const now = new Date().toISOString();
      const { data, error } = await access.adminClient.rpc(
        "review_raffle_entry_eligibility",
        {
          p_cycle_id: cycleId,
          p_member_id: memberId,
          p_decision: decision,
          p_exclusion_type: exclusionType,
          p_actor_id: access.userId,
          p_now: now,
        },
      );
      if (error) throw error;
      const reviewed = asRecord(Array.isArray(data) ? data[0] : data);
      const eligibilityState = safeString(
        reviewed.eligibilityState,
        30,
      ) || "pending_review";
      const reasonCode = safeString(reviewed.reasonCode, 80) ||
        "eligibility_review_required";
      return jsonResponse({
        ok: true,
        data: {
          eligibilityState,
          reasonCode,
        },
        message: eligibilityState === "eligible"
          ? "Administrator and household eligibility clearance recorded."
          : eligibilityState === "ineligible"
          ? "The entry was excluded under the administrator and household rule."
          : "Baseline eligibility must be corrected before clearance.",
      });
    }

    if (action === "award_bonus" || action === "revoke_bonus") {
      const memberId = safeString(body.memberId || body.member_id, 80);
      const bonusKey = safeString(body.bonusKey || body.bonus_key, 40);
      const completionMethod =
        safeString(body.completionMethod || body.completion_method, 20) ||
        "primary";
      const evidenceHash = safeString(
        body.evidenceHash || body.evidence_hash,
        64,
      ).toLowerCase();
      if (
        !UUID_RE.test(memberId) || !isRaffleBonusKey(bonusKey) ||
        !isCompletionMethod(completionMethod) ||
        (action === "award_bonus" &&
          !verifiedBonusEvidenceIsValid(
            bonusKey,
            completionMethod,
            evidenceHash,
          ))
      ) {
        return jsonResponse({
          ok: false,
          error: "invalid_bonus_request",
          message: "Member and bonus row must be valid.",
        }, 400);
      }
      const { data: entryData, error: entryError } = await access.adminClient
        .from("raffle_entries")
        .select("id,eligibility_status").eq("cycle_id", cycleId).eq(
          "member_id",
          memberId,
        ).maybeSingle();
      if (entryError) throw entryError;
      const entry = asRecord(entryData);
      if (!entry.id || entry.eligibility_status !== "eligible") {
        return jsonResponse({
          ok: false,
          error: "eligible_entry_required",
          message: "An open eligible entry is required.",
        }, 409);
      }
      const now = new Date().toISOString();
      const { error } = await access.adminClient.rpc(
        "manage_raffle_bonus_award",
        {
          p_cycle_id: cycleId,
          p_member_id: memberId,
          p_bonus_key: bonusKey,
          p_completion_method: completionMethod,
          p_evidence_hash: action === "award_bonus" ? evidenceHash : null,
          p_revoke: action === "revoke_bonus",
          p_revocation_reason_code: action === "revoke_bonus"
            ? safeString(body.reasonCode || body.reason_code, 80) ||
              "moderator_review"
            : null,
          p_actor_id: access.userId,
          p_now: now,
        },
      );
      if (error) throw error;
      return jsonResponse({
        ok: true,
        message: action === "award_bonus"
          ? "Bonus entry recorded."
          : "Bonus entry revoked with a redacted reason code.",
      });
    }

    if (action === "review_claim_tax") {
      const taxState = safeString(body.taxState || body.tax_state, 20);
      if (!isClaimTaxReviewState(taxState)) {
        return jsonResponse({
          ok: false,
          error: "invalid_tax_review",
          message: "Choose a permitted tax-review outcome.",
        }, 400);
      }
      const { data, error } = await access.adminClient.rpc(
        "review_raffle_claim_tax",
        {
          p_draw_result_id: targetDrawResultId,
          p_tax_status: taxState,
          p_actor_id: access.userId,
          p_now: new Date().toISOString(),
        },
      );
      if (error) throw error;
      const result = asRecord(Array.isArray(data) ? data[0] : data);
      return jsonResponse({
        ok: true,
        data: {
          claimState: safeString(result.claimState, 30) || "claimed",
          taxState: safeString(result.taxState, 30) || taxState,
          duplicate: result.duplicate === true,
        },
        message: taxState === "blocked"
          ? "The private claim remains blocked from fulfillment."
          : "The private tax-review outcome was recorded without tax documents or contact data.",
      });
    }

    if (action === "record_private_notice") {
      const { data, error } = await access.adminClient.rpc(
        "record_raffle_private_notice",
        {
          p_cycle_id: cycleId,
          p_draw_result_id: targetDrawResultId,
          p_actor_id: access.userId,
          p_now: new Date().toISOString(),
        },
      );
      if (error) throw error;
      const result = asRecord(Array.isArray(data) ? data[0] : data);
      return jsonResponse({
        ok: true,
        data: {
          noticeState: safeString(result.noticeState, 30) ||
            "notice_recorded",
          duplicate: result.duplicate === true,
        },
        message:
          "The private notice was recorded without contact content or recipient address data.",
      });
    }

    if (action === "review_claim_clearance") {
      const fraudState = safeString(body.fraudState || body.fraud_state, 20);
      if (!isClaimFraudReviewState(fraudState)) {
        return jsonResponse({
          ok: false,
          error: "invalid_claim_clearance",
          message: "Choose a permitted fraud-review outcome.",
        }, 400);
      }
      const { data, error } = await access.adminClient.rpc(
        "review_raffle_claim_clearance",
        {
          p_draw_result_id: targetDrawResultId,
          p_fraud_status: fraudState,
          p_actor_id: access.userId,
          p_now: new Date().toISOString(),
        },
      );
      if (error) throw error;
      const result = asRecord(Array.isArray(data) ? data[0] : data);
      const membershipState = safeString(result.membershipState, 30) ||
        "blocked";
      return jsonResponse({
        ok: true,
        data: {
          claimState: safeString(result.claimState, 30) || "claimed",
          membershipState,
          fraudState: safeString(result.fraudState, 30) || fraudState,
        },
        message: membershipState === "cleared" && fraudState === "cleared"
          ? "Current membership, guild standing, and bounded fraud clearance were recorded."
          : "The private claim remains blocked from fulfillment.",
      });
    }

    if (action === "release_digital_fulfillment") {
      const environment = safeString(
        body.environment || body.provider_environment,
        20,
      );
      const rawProductIds = Array.isArray(body.productIds)
        ? body.productIds
        : Array.isArray(body.product_ids)
        ? body.product_ids
        : null;
      const productIds = normalizeReviewedProductSubset(rawProductIds);
      if (
        environment !== "production" ||
        !productIds
      ) {
        return jsonResponse({
          ok: false,
          error: "invalid_fulfillment_release",
          message:
            "A reviewed environment and nonempty product set are required.",
        }, 400);
      }
      const { data, error } = await access.adminClient.rpc(
        "release_raffle_digital_fulfillment",
        {
          p_draw_result_id: targetDrawResultId,
          p_provider_environment: environment,
          p_product_ids: productIds,
          p_actor_id: access.userId,
          p_now: new Date().toISOString(),
        },
      );
      if (error) throw error;
      const result = asRecord(Array.isArray(data) ? data[0] : data);
      return jsonResponse({
        ok: true,
        data: {
          fulfillmentState: safeString(result.fulfillmentState, 30) ||
            "queued",
          duplicate: result.duplicate === true,
        },
        message:
          "Digital fulfillment passed the private release gates and was queued idempotently.",
      });
    }

    if (action === "complete_in_game_fulfillment") {
      const allInCostCents = body.allInCostCents ?? body.all_in_cost_cents;
      if (
        !Number.isSafeInteger(allInCostCents) ||
        Number(allInCostCents) < RAFFLE_MINIMUM_PRIZE_CENTS ||
        Number(allInCostCents) > RAFFLE_ALL_IN_CAP_CENTS
      ) {
        return jsonResponse({
          ok: false,
          error: "invalid_all_in_cost",
          message:
            "Record the exact whole-cent all-in cost between the gross prize and the $50 cycle cap.",
        }, 400);
      }
      const { data, error } = await access.adminClient.rpc(
        "complete_raffle_manual_in_game",
        {
          p_draw_result_id: targetDrawResultId,
          p_all_in_cost_cents: Number(allInCostCents),
          p_actor_id: access.userId,
          p_now: new Date().toISOString(),
        },
      );
      if (error) throw error;
      const result = asRecord(Array.isArray(data) ? data[0] : data);
      return jsonResponse({
        ok: true,
        data: {
          fulfillmentState: safeString(result.fulfillmentState, 30) ||
            "delivered",
          duplicate: result.duplicate === true,
          allInCostCents: Number(result.allInCostCents || allInCostCents),
        },
        message:
          "Manual in-game fulfillment was recorded without owner, account, or location details.",
      });
    }

    if (action === "unlock_reward_link") {
      const drawResultId = safeString(
        body.drawResultId || body.draw_result_id,
        80,
      );
      const newLimit = Number(body.newLimit || body.new_limit);
      if (
        !UUID_RE.test(drawResultId) || !Number.isInteger(newLimit) ||
        newLimit < 6 || newLimit > 10
      ) {
        return jsonResponse({
          ok: false,
          error: "invalid_unlock",
          message: "Choose a valid result and a link limit from 6 to 10.",
        }, 400);
      }
      const now = new Date().toISOString();
      const { data, error } = await access.adminClient.rpc(
        "unlock_raffle_reward_link",
        {
          p_draw_result_id: drawResultId,
          p_new_limit: newLimit,
          p_actor_id: access.userId,
          p_now: now,
        },
      );
      if (error) throw error;
      const result = asRecord(Array.isArray(data) ? data[0] : data);
      return jsonResponse({
        ok: true,
        data: {
          linkGenerationCount: Number(result.linkGenerationCount || 0),
          linkGenerationLimit: Number(result.linkGenerationLimit || newLimit),
          duplicate: result.duplicate === true,
        },
        message:
          "The private reward-opening limit was transactionally raised and audited.",
      });
    }

    if (action !== "readiness") {
      return jsonResponse({
        ok: false,
        error: "invalid_action",
        message: "Raffle leader action is not supported.",
      }, 400);
    }

    const [
      { data: cycles, error: cyclesError },
      { data: fulfillmentConfig, error: fulfillmentError },
      openClaimsResult,
      pendingTaxResult,
      queuedFulfillmentResult,
      failedFulfillmentResult,
    ] = await Promise.all([
      access.adminClient.from("raffle_cycles")
        .select(
          "id,public_cycle_id,status,opens_at,closes_at,draw_at,expires_at,rules_version,country_matrix_version,approved_country_codes,claim_window_days,award_window_days,minimum_eligible_entrants,reward_value_cents,cycle_cost_ceiling_cents,sponsor_approved,rules_approved,country_matrix_approved,reward_approved,privacy_approved,tax_approved,operations_approved,entrant_count,total_entry_count",
        )
        .order("draw_at", { ascending: false }).limit(12),
      access.adminClient.from("raffle_provider_configs")
        .select(
          "environment,status,orders_enabled,last_readiness_check_at,approved_country_codes",
        )
        .order("environment"),
      access.adminClient.from("raffle_draw_results")
        .select("id", { count: "exact", head: true })
        .in("status", ["selected", "contacted", "claimed"])
        .not("claim_opened_at", "is", null)
        .gte("claim_deadline", new Date().toISOString()),
      access.adminClient.from("raffle_draw_results")
        .select("id", { count: "exact", head: true })
        .eq("status", "claimed")
        .eq("tax_status", "pending"),
      access.adminClient.from("raffle_fulfillment_jobs")
        .select("id", { count: "exact", head: true })
        .in("state", [
          "ready",
          "claimed",
          "submitting",
          "reconciling",
          "retryable",
        ]),
      access.adminClient.from("raffle_fulfillment_jobs")
        .select("id", { count: "exact", head: true })
        .in("state", ["failed", "cancelled"]),
    ]);
    if (cyclesError) throw cyclesError;
    if (fulfillmentError) throw fulfillmentError;
    if (openClaimsResult.error) throw openClaimsResult.error;
    if (pendingTaxResult.error) throw pendingTaxResult.error;
    if (queuedFulfillmentResult.error) throw queuedFulfillmentResult.error;
    if (failedFulfillmentResult.error) throw failedFulfillmentResult.error;
    const cycleDtos = (cycles || []).map((value) => {
      const row = asRecord(value);
      return {
        ...row,
        grossPrizeCents: Number(row.reward_value_cents),
        allInCostCapCents: Number(row.cycle_cost_ceiling_cents),
      };
    });
    const latestCycle = asRecord(cycleDtos[0]);
    const activeProviderRows = (fulfillmentConfig || []).filter((value) => {
      const row = asRecord(value);
      const checkedAt = Date.parse(safeString(row.last_readiness_check_at, 80));
      const cycleCountries = Array.isArray(latestCycle.approved_country_codes)
        ? latestCycle.approved_country_codes.map(String)
        : [];
      const providerCountries = new Set(
        Array.isArray(row.approved_country_codes)
          ? row.approved_country_codes.map(String)
          : [],
      );
      return row.environment === "production" && row.status === "active" &&
        row.orders_enabled === true && Number.isFinite(checkedAt) &&
        checkedAt >= Date.now() - 24 * 60 * 60 * 1000 &&
        cycleCountries.length > 0 &&
        cycleCountries.every((country) => providerCountries.has(country));
    });
    const activeProvider = activeProviderRows.length === 1;
    const ordersEnabled = activeProvider;
    const latestStatus = safeString(latestCycle.status, 30) || "prelaunch";
    return jsonResponse({
      ok: true,
      data: {
        access: "granted",
        cycles: cycleDtos,
        fulfillmentReadiness: (fulfillmentConfig || []).map((value) => {
          const row = asRecord(value);
          return {
            environment: safeString(row.environment, 20),
            state: safeString(row.status, 30),
            sendingEnabled: row.orders_enabled === true,
            lastCheckedAt: safeString(row.last_readiness_check_at, 80) || null,
          };
        }),
        programState: latestStatus === "open"
          ? "active"
          : latestStatus === "ready"
          ? "ready"
          : latestStatus === "blocked" || latestStatus === "void"
          ? "paused"
          : "prelaunch",
        cycleState: latestStatus,
        rulesApproved: latestCycle.rules_approved === true,
        sponsorVerified: latestCycle.sponsor_approved === true,
        countriesApproved: latestCycle.country_matrix_approved === true &&
          Array.isArray(latestCycle.approved_country_codes) &&
          latestCycle.approved_country_codes.length > 0,
        privacyApproved: latestCycle.privacy_approved === true,
        operationsApproved: latestCycle.operations_approved === true,
        fulfillmentReady: latestCycle.reward_approved === true &&
          activeProvider,
        ordersEnabled,
        entriesFrozen: ["frozen", "drawn", "complete"].includes(latestStatus),
        drawRecorded: ["drawn", "complete"].includes(latestStatus),
        openClaims: openClaimsResult.count || 0,
        taxReviews: pendingTaxResult.count || 0,
        queuedFulfillments: queuedFulfillmentResult.count || 0,
        auditHealth: (failedFulfillmentResult.count || 0) > 0
          ? "attention"
          : "healthy",
      },
      message:
        "Raffle readiness loaded. Draft cycles remain fail-closed until an approved launch packet sets every gate.",
    });
  } catch (error) {
    console.error("moderate raffle failed", { failed: true });
    const conflict = error instanceof Error &&
      /raffle_|duplicate|unique/i.test(error.message);
    return jsonResponse({
      ok: false,
      error: "leader_action_failed",
      message: "Raffle leader action could not be completed.",
    }, conflict ? 409 : 500);
  }
}
