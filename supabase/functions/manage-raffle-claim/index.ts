import "@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  protectedOptionsResponse,
  withProtectedCors,
} from "../_shared/cors.ts";
import { readBoundedJson, rewardJson } from "../_shared/reward-edge.ts";
import {
  type MemberAccess,
  raffleMemberProfileIsVerified,
  requireRaffleMember,
} from "../_shared/raffle-edge.ts";
import {
  parseClaimCommand,
  privateClaimOption,
  type PrivateClaimRow,
  privateClaimStatus,
  selectPrivateClaimForAction,
} from "../_shared/raffle-claim.ts";
import { raffleOperationalGates } from "../_shared/raffle-flags.ts";

export type RaffleClaimDependencies = {
  requireMember?: (req: Request) => Promise<MemberAccess>;
  gates?: typeof raffleOperationalGates;
  now?: () => number;
};

if (import.meta.main) {
  Deno.serve((req: Request) =>
    withProtectedCors(req, handleRaffleClaimRequest(req))
  );
}

export async function handleRaffleClaimRequest(
  req: Request,
  dependencies: RaffleClaimDependencies = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return protectedOptionsResponse(req);
  if (req.method !== "POST") {
    return rewardJson({ ok: false, error: "method_not_allowed" }, 405);
  }

  const access = await (dependencies.requireMember || requireRaffleMember)(req);
  if (!access.ok) return access.response;
  if (
    !raffleMemberProfileIsVerified(
      access.profile,
      (dependencies.now || Date.now)(),
    )
  ) {
    return rewardJson({ ok: false, error: "member_access_required" }, 403);
  }
  const parsedBody = await readBoundedJson(req);
  if (!parsedBody.ok) return parsedBody.response;
  let command;
  try {
    command = parseClaimCommand(parsedBody.value);
  } catch {
    return rewardJson({ ok: false, error: "invalid_request" }, 400);
  }

  const gates = (dependencies.gates || raffleOperationalGates)();
  if (command.action !== "status" && !gates.claims) {
    return rewardJson({ ok: false, error: "claims_closed" }, 409);
  }
  const current = await resolveMemberClaim(
    access.adminClient,
    access.userId,
    command.action,
    "claimId" in command ? command.claimId : undefined,
  );
  if (!current.ok) {
    return rewardJson({ ok: false, error: current.error }, current.status);
  }

  if (command.action === "status") {
    return rewardJson({
      ok: true,
      data: {
        ...privateClaimStatus(current.row),
        claimsEnabled: gates.claims,
        selectedClaimId: current.row?.id || null,
        availableClaims: current.rows.map((row) => privateClaimOption(row)),
      },
    });
  }

  if (command.action === "claim") {
    if (!current.row) {
      return rewardJson({ ok: false, error: "claim_not_available" }, 409);
    }
    if (
      command.rewardRoute === "in_game" &&
      current.row.in_game_reward_available !== true
    ) {
      return rewardJson({ ok: false, error: "reward_choice_unavailable" }, 409);
    }
    const { data, error } = await access.adminClient.rpc(
      "claim_raffle_draw_result",
      {
        p_draw_result_id: current.row.id,
        p_member_id: access.userId,
        p_reward_route: command.rewardRoute,
      },
    );
    if (error || !data) {
      return rewardJson({ ok: false, error: "claim_not_available" }, 409);
    }
    const row = (Array.isArray(data) ? data[0] : data) as PrivateClaimRow;
    row.in_game_reward_available =
      current.row.in_game_reward_available === true;
    row.cycle_expires_at = current.row.cycle_expires_at;
    row.gross_prize_cents = current.row.gross_prize_cents;
    row.all_in_cost_cap_cents = current.row.all_in_cost_cap_cents;
    return rewardJson({ ok: true, data: privateClaimStatus(row) });
  }

  if (command.action === "decline") {
    if (!current.row) {
      return rewardJson({ ok: false, error: "claim_not_available" }, 409);
    }
    const { data, error } = await access.adminClient.rpc(
      "decline_raffle_draw_result",
      {
        p_draw_result_id: current.row.id,
        p_member_id: access.userId,
      },
    );
    if (error || !data) {
      return rewardJson({ ok: false, error: "claim_not_available" }, 409);
    }
    const row = (Array.isArray(data) ? data[0] : data) as PrivateClaimRow;
    row.cycle_expires_at = current.row.cycle_expires_at;
    row.gross_prize_cents = current.row.gross_prize_cents;
    row.all_in_cost_cap_cents = current.row.all_in_cost_cap_cents;
    return rewardJson({ ok: true, data: privateClaimStatus(row) });
  }

  return rewardJson({ ok: false, error: "invalid_request" }, 400);
}

async function resolveMemberClaim(
  adminClient: SupabaseClient,
  memberId: string,
  action: "status" | "claim" | "decline",
  claimId?: string,
): Promise<
  | { ok: true; row: PrivateClaimRow | null; rows: PrivateClaimRow[] }
  | { ok: false; error: string; status: number }
> {
  const { data, error } = await adminClient
    .from("raffle_draw_results")
    .select(
      "id,cycle_id,status,claim_opened_at,claim_deadline,claimed_at,reward_route,fulfillment_status,created_at",
    )
    .eq("member_id", memberId)
    .in("result_kind", ["paid_winner", "alternate"])
    .not("claim_opened_at", "is", null)
    .order("claim_opened_at", { ascending: false })
    .limit(5);
  if (error) {
    return { ok: false, error: "claim_status_unavailable", status: 503 };
  }
  const rows = (data || []) as PrivateClaimRow[];
  const cycleIds = [
    ...new Set(rows.map((row) => row.cycle_id).filter(Boolean)),
  ];
  if (cycleIds.length) {
    const { data: cycleData, error: cycleError } = await adminClient
      .from("raffle_cycles")
      .select(
        "id,expires_at,reward_value_cents,cycle_cost_ceiling_cents,in_game_reward_enabled,in_game_privacy_reviewed_at,in_game_privacy_reviewed_by",
      )
      .in("id", cycleIds);
    if (cycleError) {
      return { ok: false, error: "claim_status_unavailable", status: 503 };
    }
    const available = new Set(
      (cycleData || []).filter((cycle) =>
        cycle.in_game_reward_enabled === true &&
        Boolean(cycle.in_game_privacy_reviewed_at) &&
        Boolean(cycle.in_game_privacy_reviewed_by)
      ).map((cycle) => String(cycle.id)),
    );
    const expiresByCycle = new Map(
      (cycleData || []).map((
        cycle,
      ) => [String(cycle.id), String(cycle.expires_at || "")]),
    );
    const prizeByCycle = new Map(
      (cycleData || []).map((cycle) => [
        String(cycle.id),
        Number(cycle.reward_value_cents),
      ]),
    );
    const capByCycle = new Map(
      (cycleData || []).map((cycle) => [
        String(cycle.id),
        Number(cycle.cycle_cost_ceiling_cents),
      ]),
    );
    for (const row of rows) {
      row.in_game_reward_available = available.has(row.cycle_id);
      row.cycle_expires_at = expiresByCycle.get(row.cycle_id) || null;
      row.gross_prize_cents = prizeByCycle.get(row.cycle_id);
      row.all_in_cost_cap_cents = capByCycle.get(row.cycle_id);
    }
  }
  return { ok: true, ...selectPrivateClaimForAction(rows, action, claimId) };
}
