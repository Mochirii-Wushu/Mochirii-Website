export const RAFFLE_DEFAULT_PRIZE_CENTS = 1_000;
export const RAFFLE_MINIMUM_PRIZE_CENTS = 1_000;
export const RAFFLE_MAXIMUM_PRIZE_CENTS = 5_000;
export const RAFFLE_ALL_IN_CAP_CENTS = 5_000;
export const RAFFLE_BALANCE_RESERVE_CENTS = 5_000;
export const RAFFLE_BALANCE_CEILING_CENTS = 10_000;

export function rafflePrizeCentsFromDollars(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  const cents = value * 100;
  return isAllowedRafflePrizeCents(cents) ? cents : null;
}

export function isAllowedRafflePrizeCents(value: unknown): value is number {
  return Number.isSafeInteger(value) &&
    Number(value) >= RAFFLE_MINIMUM_PRIZE_CENTS &&
    Number(value) <= RAFFLE_MAXIMUM_PRIZE_CENTS &&
    Number(value) % 100 === 0;
}

export function isAllowedManualAllInCostCents(
  value: unknown,
  prizeCents: number,
): value is number {
  return Number.isSafeInteger(value) && isAllowedRafflePrizeCents(prizeCents) &&
    Number(value) >= prizeCents && Number(value) <= RAFFLE_ALL_IN_CAP_CENTS;
}

export function rafflePublicRewardLabel(prizeCents: number): string {
  if (!isAllowedRafflePrizeCents(prizeCents)) {
    throw new Error("invalid_raffle_prize");
  }
  return "One $" + String(prizeCents / 100) +
    " digital gift card or eligible in-game gift, plus two Mōchirīī community honors.";
}
