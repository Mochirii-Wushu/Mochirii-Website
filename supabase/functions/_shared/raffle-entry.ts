export const RAFFLE_BASE_ENTRIES = 1;
export const RAFFLE_MAX_BONUS_ENTRIES = 9;
export const RAFFLE_MAX_ENTRIES = 10;

export const RAFFLE_BONUS_KEYS = [
  "scheduled_activity",
  "monthly_gathering",
  "help_session",
  "social_media_share",
  "guild_feedback",
  "member_welcome",
  "member_recruitment",
  "creative_hobby_share",
  "member_spotlight_nomination",
] as const;

export type RaffleBonusKey = typeof RAFFLE_BONUS_KEYS[number];
export type RaffleCompletionMethod = "primary" | "alternative";

export type BonusCompletion = {
  bonusKey: string;
  completionMethod: string;
  revoked?: boolean;
};

const BONUS_KEY_SET = new Set<string>(RAFFLE_BONUS_KEYS);

export function isRaffleBonusKey(value: unknown): value is RaffleBonusKey {
  return typeof value === "string" && BONUS_KEY_SET.has(value);
}

export function isCompletionMethod(
  value: unknown,
): value is RaffleCompletionMethod {
  return value === "primary" || value === "alternative";
}

export function completedBonusKeys(
  completions: BonusCompletion[],
): RaffleBonusKey[] {
  const completed = new Set<RaffleBonusKey>();

  for (const completion of completions) {
    if (
      !completion.revoked &&
      isRaffleBonusKey(completion.bonusKey) &&
      isCompletionMethod(completion.completionMethod)
    ) {
      completed.add(completion.bonusKey);
    }
  }

  return RAFFLE_BONUS_KEYS.filter((key) => completed.has(key));
}

export function calculateEntryCount(
  eligibleAndOptedIn: boolean,
  completions: BonusCompletion[],
): number {
  if (!eligibleAndOptedIn) return 0;
  return Math.min(
    RAFFLE_MAX_ENTRIES,
    RAFFLE_BASE_ENTRIES +
      Math.min(
        RAFFLE_MAX_BONUS_ENTRIES,
        completedBonusKeys(completions).length,
      ),
  );
}

export function bonusChecklist(completions: BonusCompletion[]): Array<{
  bonusKey: RaffleBonusKey;
  completed: boolean;
  completionMethod: RaffleCompletionMethod | null;
}> {
  const byKey = new Map<RaffleBonusKey, RaffleCompletionMethod>();
  for (const completion of completions) {
    if (
      !completion.revoked &&
      isRaffleBonusKey(completion.bonusKey) &&
      isCompletionMethod(completion.completionMethod) &&
      !byKey.has(completion.bonusKey)
    ) {
      byKey.set(completion.bonusKey, completion.completionMethod);
    }
  }

  return RAFFLE_BONUS_KEYS.map((bonusKey) => ({
    bonusKey,
    completed: byKey.has(bonusKey),
    completionMethod: byKey.get(bonusKey) || null,
  }));
}

export type EligibilityReviewDecision = {
  clearanceStatus: "pending" | "cleared" | "excluded";
  eligibilityState: "pending_review" | "eligible" | "ineligible";
  reasonCode: string;
};

export function resolveAdministratorEligibilityReview(
  baselineReason: string,
  decision: "clear" | "exclude",
  exclusionType: "administrator" | "household" | "",
): EligibilityReviewDecision {
  if (baselineReason === "administrator_ineligible") {
    return {
      clearanceStatus: "excluded",
      eligibilityState: "ineligible",
      reasonCode: "administrator_ineligible",
    };
  }
  if (decision === "exclude") {
    return {
      clearanceStatus: "excluded",
      eligibilityState: "ineligible",
      reasonCode: exclusionType === "administrator"
        ? "administrator_ineligible"
        : "administrator_household_ineligible",
    };
  }
  if (baselineReason === "eligible") {
    return {
      clearanceStatus: "cleared",
      eligibilityState: "eligible",
      reasonCode: "administrator_household_cleared",
    };
  }
  return {
    clearanceStatus: "pending",
    eligibilityState: "pending_review",
    reasonCode: baselineReason,
  };
}

export function verifiedBonusEvidenceIsValid(
  bonusKey: unknown,
  completionMethod: unknown,
  evidenceHash: unknown,
): boolean {
  return isRaffleBonusKey(bonusKey) && isCompletionMethod(completionMethod) &&
    typeof evidenceHash === "string" && /^[0-9a-f]{64}$/.test(evidenceHash);
}

export type ClaimTaxReviewState = "not_required" | "cleared" | "blocked";

export function isClaimTaxReviewState(
  value: unknown,
): value is ClaimTaxReviewState {
  return value === "not_required" || value === "cleared" ||
    value === "blocked";
}

export type ClaimFraudReviewState = "cleared" | "blocked";

export function isClaimFraudReviewState(
  value: unknown,
): value is ClaimFraudReviewState {
  return value === "cleared" || value === "blocked";
}

export function resolveClaimMembershipClearance(
  memberStatus: unknown,
  guildVerified: unknown,
): { state: "cleared" | "blocked"; reasonCode: string } {
  if (memberStatus !== "active") {
    return { state: "blocked", reasonCode: "membership_not_active" };
  }
  if (guildVerified !== true) {
    return { state: "blocked", reasonCode: "guild_verification_required" };
  }
  return { state: "cleared", reasonCode: "membership_cleared" };
}

export function normalizeReviewedProductSubset(
  value: unknown,
): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return null;
  }
  const normalized = value.map((productId) =>
    typeof productId === "string" ? productId.trim() : ""
  );
  if (
    normalized.some((productId) =>
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(productId)
    )
  ) return null;
  return [...new Set(normalized)].sort();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function hashBonusAlternativeResponse(input: {
  secret: string;
  cycleId: string;
  memberId: string;
  bonusKey: RaffleBonusKey;
  response: string;
}): Promise<string> {
  if (input.secret.length < 32) throw new Error("bonus_hash_not_configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const context = [
    "mochirii-raffle-alternative-v1",
    input.cycleId,
    input.memberId,
    input.bonusKey,
    input.response,
  ].join("\n");
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(context),
  );
  return bytesToHex(new Uint8Array(signature));
}
