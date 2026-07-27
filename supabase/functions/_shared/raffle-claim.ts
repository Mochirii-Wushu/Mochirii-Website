import { exactObjectKeys, type JsonRecord } from "./reward-edge.ts";

export type ClaimCommand =
  | { action: "status" }
  | { action: "claim"; rewardRoute: "digital" | "in_game"; claimId?: string }
  | { action: "decline"; claimId?: string };

export type PrivateClaimRow = {
  id: string;
  cycle_id: string;
  status: string;
  claim_opened_at: string | null;
  claim_deadline: string | null;
  claimed_at: string | null;
  reward_route: string | null;
  fulfillment_status: string;
  created_at: string;
  in_game_reward_available?: boolean;
  cycle_expires_at?: string | null;
  gross_prize_cents?: number;
  all_in_cost_cap_cents?: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalClaimId(body: JsonRecord): string | undefined {
  if (!("claim_id" in body)) return undefined;
  if (typeof body.claim_id !== "string" || !UUID_RE.test(body.claim_id)) {
    throw new Error("Claim identifier is invalid.");
  }
  return body.claim_id;
}

export function parseClaimCommand(body: JsonRecord): ClaimCommand {
  if (body.action === "status") {
    if (!exactObjectKeys(body, ["action"])) {
      throw new Error("Status fields are invalid.");
    }
    return { action: "status" };
  }
  if (body.action === "claim") {
    if (
      !exactObjectKeys(body, ["action", "reward_choice"]) &&
      !exactObjectKeys(body, ["action", "reward_choice", "claim_id"])
    ) {
      throw new Error("Claim fields are invalid.");
    }
    if (
      body.reward_choice !== "digital_choice" &&
      body.reward_choice !== "in_game"
    ) {
      throw new Error("Reward route is invalid.");
    }
    const claimId = optionalClaimId(body);
    return {
      action: "claim",
      rewardRoute: body.reward_choice === "digital_choice"
        ? "digital"
        : "in_game",
      ...(claimId ? { claimId } : {}),
    };
  }
  if (body.action === "decline") {
    if (
      (!exactObjectKeys(body, ["action", "reward_choice"]) &&
        !exactObjectKeys(body, ["action", "reward_choice", "claim_id"])) ||
      body.reward_choice !== null
    ) {
      throw new Error("Decline fields are invalid.");
    }
    const claimId = optionalClaimId(body);
    return { action: "decline", ...(claimId ? { claimId } : {}) };
  }
  throw new Error("Claim action is invalid.");
}

export function privateClaimStatus(
  row: PrivateClaimRow | null,
  nowMs = Date.now(),
): JsonRecord {
  if (!row) {
    return {
      eligibilityState: "unknown",
      optInState: "locked",
      bonusRows: [],
      totalEntries: 0,
      claimState: "not_available",
      fulfillmentState: "unavailable",
      rewardChoice: null,
      openRewardAvailable: false,
      inGameRewardAvailable: false,
      claimDeadline: null,
      grossPrizeCents: null,
      allInCostCapCents: null,
    };
  }
  const deadline = row.claim_deadline
    ? Date.parse(row.claim_deadline)
    : Number.NaN;
  const deadlinePassed = Number.isFinite(deadline) && deadline < nowMs;
  const claimState = row.status === "declined"
    ? "declined"
    : row.status === "expired" || row.status === "ineligible" ||
        row.status === "void"
    ? "expired"
    : (row.status === "selected" || row.status === "contacted") &&
        deadlinePassed
    ? "expired"
    : row.status === "selected" || row.status === "contacted"
    ? "claimable"
    : row.status === "claimed" || row.status === "fulfilled"
    ? "claimed"
    : "not_available";
  const fulfillmentState = row.fulfillment_status === "not_requested"
    ? "not_started"
    : row.fulfillment_status === "pending"
    ? "pending_review"
    : row.fulfillment_status === "processing" ||
        row.fulfillment_status === "manual"
    ? "preparing"
    : row.fulfillment_status === "delivered"
    ? row.reward_route === "digital" ? "ready" : "completed"
    : "unavailable";
  return {
    eligibilityState: "eligible",
    eligibilityReasonCode: null,
    optInState: "opted_in",
    bonusRows: [],
    totalEntries: 0,
    claimState,
    fulfillmentState,
    rewardChoice: row.reward_route === "digital"
      ? "digital_choice"
      : row.reward_route === "in_game"
      ? "in_game"
      : null,
    openRewardAvailable: false,
    inGameRewardAvailable: row.in_game_reward_available === true,
    claimDeadline: row.claim_deadline,
    grossPrizeCents: row.gross_prize_cents ?? null,
    allInCostCapCents: row.all_in_cost_cap_cents ?? null,
  };
}

export function privateClaimOption(
  row: PrivateClaimRow,
  nowMs = Date.now(),
): JsonRecord {
  const status = privateClaimStatus(row, nowMs);
  return {
    claimId: row.id,
    claimState: status.claimState,
    fulfillmentState: status.fulfillmentState,
    rewardChoice: status.rewardChoice,
    openRewardAvailable: status.openRewardAvailable,
    inGameRewardAvailable: status.inGameRewardAvailable,
    claimDeadline: status.claimDeadline,
    grossPrizeCents: status.grossPrizeCents,
    allInCostCapCents: status.allInCostCapCents,
  };
}

export function selectPrivateClaimForAction(
  rows: PrivateClaimRow[],
  action: ClaimCommand["action"],
  claimId?: string,
  nowMs = Date.now(),
): { row: PrivateClaimRow | null; rows: PrivateClaimRow[] } {
  const unexpiredRows = rows.filter((row) =>
    Boolean(row.cycle_expires_at) &&
    Date.parse(String(row.cycle_expires_at)) >= nowMs
  );
  const selectRequested = (
    candidates: PrivateClaimRow[],
  ): PrivateClaimRow | null => {
    if (!claimId) return candidates[0] || null;
    return candidates.find((row) => row.id === claimId) || null;
  };
  if (action === "status") {
    return { row: unexpiredRows[0] || null, rows: unexpiredRows };
  }
  const claimable = unexpiredRows.filter((row) =>
    ["selected", "contacted"].includes(row.status) &&
    Boolean(row.claim_deadline) &&
    Date.parse(String(row.claim_deadline)) >= nowMs
  );
  if (action === "decline") {
    const selected = selectRequested(claimable);
    if (selected) return { row: selected, rows: unexpiredRows };
    const alreadyDeclined = unexpiredRows.filter((row) =>
      row.status === "declined"
    );
    return { row: selectRequested(alreadyDeclined), rows: unexpiredRows };
  }
  if (claimId) {
    const requestedClaimable = selectRequested(claimable);
    if (requestedClaimable) {
      return { row: requestedClaimable, rows: unexpiredRows };
    }
  } else if (claimable.length) {
    return { row: claimable[0], rows: unexpiredRows };
  }
  const claimed = unexpiredRows.filter((row) =>
    row.status === "claimed" || row.status === "fulfilled"
  );
  return { row: selectRequested(claimed), rows: unexpiredRows };
}
