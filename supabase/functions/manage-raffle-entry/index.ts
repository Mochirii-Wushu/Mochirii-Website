import { withProtectedCors } from "../_shared/cors.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  asRecord,
  jsonResponse,
  loadCurrentCycle,
  memberPrizeDrawStatus,
  publicCycleDto,
  readJson,
  requireRaffleMember,
  safeString,
} from "../_shared/raffle-edge.ts";
import {
  hashBonusAlternativeResponse,
  isRaffleBonusKey,
} from "../_shared/raffle-entry.ts";
import { raffleOperationalGates } from "../_shared/raffle-flags.ts";
import { isEntryWindowOpen } from "../_shared/raffle-schedule.ts";

Deno.serve((req: Request) => withProtectedCors(req, handleRequest(req)));

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const access = await requireRaffleMember(req);
  if (!access.ok) return access.response;

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error && error.message === "request_too_large"
          ? "request_too_large"
          : "invalid_json",
        message: "Request body must be a small valid JSON object.",
      },
      error instanceof Error && error.message === "request_too_large"
        ? 413
        : 400,
    );
  }

  const action = safeString(body.action, 30) || "status";
  const gates = raffleOperationalGates();
  if (
    action !== "status" &&
    (!gates.submissions ||
      (action === "submit_bonus_alternative" && !gates.bonusSubmissions))
  ) {
    return jsonResponse({
      ok: false,
      error: "entries_closed",
      message: "Raffle entry is closed.",
    }, 409);
  }
  let message = "Raffle status loaded.";

  try {
    const cycle = await loadCurrentCycle(access.adminClient);
    if (!cycle) {
      return jsonResponse({
        ok: true,
        data: {
          cycle: null,
          member: await memberPrizeDrawStatus(
            access.adminClient,
            null,
            access.userId,
          ),
        },
        message: "The Mochirii Monthly Raffle is not open.",
      });
    }

    if (action !== "status") {
      const now = new Date();
      const opensAt = new Date(safeString(cycle.opens_at, 80));
      const closesAt = new Date(safeString(cycle.closes_at, 80));
      if (
        !Number.isFinite(opensAt.getTime()) ||
        !Number.isFinite(closesAt.getTime()) ||
        !isEntryWindowOpen(
          safeString(cycle.status, 20),
          now,
          opensAt,
          closesAt,
        )
      ) {
        return jsonResponse({
          ok: false,
          error: "entry_window_closed",
          message: "Raffle entry is closed.",
        }, 409);
      }
    }

    if (action === "opt_in") {
      const countryCode = safeString(body.countryCode || body.country_code, 2)
        .toUpperCase();
      const ageAffirmed = body.age18OrOlder === true ||
        body.age_18_or_older === true;
      const rulesAccepted = body.rulesAccepted === true ||
        body.rules_accepted === true;
      const now = new Date().toISOString();
      const { data, error } = await access.adminClient.rpc(
        "manage_raffle_member_entry",
        {
          p_cycle_id: cycle.id,
          p_member_id: access.userId,
          p_actor_id: access.userId,
          p_action: "opt_in",
          p_country_code: countryCode,
          p_age_18_affirmed: ageAffirmed,
          p_rules_accepted: rulesAccepted,
          p_now: now,
        },
      );
      if (error) throw error;
      const result = asRecord(Array.isArray(data) ? data[0] : data);
      const eligibilityState = safeString(result.eligibilityState, 30);
      const eligibilityReason = safeString(result.reasonCode, 80);
      message = eligibilityState === "eligible"
        ? "You are entered with one standard entry."
        : eligibilityReason === "administrator_clearance_required"
        ? "Your monthly opt-in is pending the required administrator and household eligibility review."
        : "Your monthly opt-in was recorded, but you are not eligible for this cycle.";
    } else if (action === "withdraw") {
      const now = new Date().toISOString();
      const { error } = await access.adminClient.rpc(
        "manage_raffle_member_entry",
        {
          p_cycle_id: cycle.id,
          p_member_id: access.userId,
          p_actor_id: access.userId,
          p_action: "withdraw",
          p_country_code: null,
          p_age_18_affirmed: false,
          p_rules_accepted: false,
          p_now: now,
        },
      );
      if (error) throw error;
      message = "Your Raffle entry was withdrawn before entry closed.";
    } else if (action === "submit_bonus_alternative") {
      const bonusKey = safeString(body.bonusKey || body.bonus_key, 40);
      const rawResponse = typeof body.response === "string"
        ? body.response.trim()
        : "";
      const responseBytes = new TextEncoder().encode(rawResponse).length;
      if (
        !isRaffleBonusKey(bonusKey) || rawResponse.length === 0 ||
        rawResponse.length > 1_000 || responseBytes > 2_048
      ) {
        return jsonResponse({
          ok: false,
          error: "invalid_bonus_alternative",
          message: "Choose a bonus row and provide a short response.",
        }, 400);
      }
      const hashSecret = Deno.env.get("RAFFLE_BONUS_RESPONSE_HASH_SECRET") ||
        "";
      if (hashSecret.length < 32) {
        return jsonResponse({
          ok: false,
          error: "bonus_alternative_unavailable",
          message: "Bonus alternatives are not configured yet.",
        }, 503);
      }
      const responseHash = await hashBonusAlternativeResponse({
        secret: hashSecret,
        cycleId: safeString(cycle.id, 80),
        memberId: access.userId,
        bonusKey,
        response: rawResponse,
      });
      const { error } = await access.adminClient.rpc(
        "submit_raffle_bonus_alternative",
        {
          p_cycle_id: cycle.id,
          p_member_id: access.userId,
          p_actor_id: access.userId,
          p_bonus_key: bonusKey,
          p_response_hash: responseHash,
          p_now: new Date().toISOString(),
        },
      );
      if (error) throw error;
      message =
        "Your free alternative was recorded. The response text was discarded.";
    } else if (action === "complete_bonus") {
      return jsonResponse({
        ok: false,
        error: "server_verification_required",
        message:
          "Bonus rows are recorded only by a verified first-party workflow or leader review.",
      }, 403);
    } else if (action !== "status") {
      return jsonResponse({
        ok: false,
        error: "invalid_action",
        message: "Raffle entry action is not supported.",
      }, 400);
    }

    return jsonResponse({
      ok: true,
      data: {
        cycle: publicCycleDto(cycle),
        member: await memberPrizeDrawStatus(
          access.adminClient,
          cycle,
          access.userId,
        ),
      },
      message,
    });
  } catch (error) {
    console.error("manage raffle entry failed", { failed: true });
    return jsonResponse({
      ok: false,
      message: "Raffle entry could not be updated.",
    }, 500);
  }
}
