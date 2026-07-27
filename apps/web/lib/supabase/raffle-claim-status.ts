export type RaffleClaimStatus = {
  claimsEnabled: boolean;
  selectedClaimId: string | null;
  claimState: "not_available" | "claimable" | "claimed" | "declined" | "expired";
  fulfillmentState: "unavailable" | "not_started" | "pending_review" | "preparing" | "ready" | "completed";
  rewardChoice: "digital_choice" | "in_game" | null;
  inGameRewardAvailable: boolean;
  claimDeadline: string | null;
};

type JsonRecord = Record<string, unknown>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return typeof value === "string" &&
      (allowed as readonly string[]).includes(value)
    ? value as T[number]
    : null;
}

export function parseRaffleClaimStatus(value: unknown): RaffleClaimStatus | null {
  const payload = record(value);
  if (typeof payload.claimsEnabled !== "boolean") return null;
  const claimState = oneOf(payload.claimState, [
    "not_available",
    "claimable",
    "claimed",
    "declined",
    "expired",
  ] as const);
  const fulfillmentState = oneOf(payload.fulfillmentState, [
    "unavailable",
    "not_started",
    "pending_review",
    "preparing",
    "ready",
    "completed",
  ] as const);
  if (!claimState || !fulfillmentState) return null;
  const rewardChoice = payload.rewardChoice === null
    ? null
    : oneOf(payload.rewardChoice, ["digital_choice", "in_game"] as const);
  if (payload.rewardChoice !== null && rewardChoice === null) return null;
  const selectedClaimId = payload.selectedClaimId === null
    ? null
    : typeof payload.selectedClaimId === "string" &&
        UUID_RE.test(payload.selectedClaimId)
    ? payload.selectedClaimId
    : null;
  if (payload.selectedClaimId !== null && selectedClaimId === null) return null;
  const claimDeadline = payload.claimDeadline === null
    ? null
    : typeof payload.claimDeadline === "string" &&
        Number.isFinite(Date.parse(payload.claimDeadline))
    ? payload.claimDeadline
    : null;
  if (payload.claimDeadline !== null && claimDeadline === null) return null;
  if (typeof payload.inGameRewardAvailable !== "boolean") return null;
  if (claimState === "claimable" && (!selectedClaimId || !claimDeadline)) {
    return null;
  }

  return {
    claimsEnabled: payload.claimsEnabled,
    selectedClaimId,
    claimState,
    fulfillmentState,
    rewardChoice,
    inGameRewardAvailable: payload.inGameRewardAvailable,
    claimDeadline,
  };
}
