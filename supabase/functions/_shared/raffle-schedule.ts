export const RAFFLE_TIMEZONE = "Asia/Singapore";
export const RAFFLE_UTC_OFFSET_HOURS = 8;
export const DRAW_HOUR = 21;
export const DRAW_MINUTE = 30;
export const OPEN_HOUR = 22;
export const OPEN_MINUTE = 0;
export const DEFAULT_CLAIM_WINDOW_DAYS = 7;
export const DEFAULT_AWARD_WINDOW_DAYS = 30;

export type RaffleCycleWindow = {
  opensAt: Date;
  closesAt: Date;
  drawAt: Date;
  expiresAt: Date;
  sevenDayReminderAt: Date;
  oneDayReminderAt: Date;
};

function utcForSingapore(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(
    year,
    monthIndex,
    day,
    hour - RAFFLE_UTC_OFFSET_HOURS,
    minute,
    0,
    0,
  ));
}

function firstSaturdayDay(year: number, monthIndex: number): number {
  const firstDay = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return 1 + ((6 - firstDay + 7) % 7);
}

export function firstSaturdayDrawAt(year: number, monthIndex: number): Date {
  return utcForSingapore(
    year,
    monthIndex,
    firstSaturdayDay(year, monthIndex),
    DRAW_HOUR,
    DRAW_MINUTE,
  );
}

export function nextDrawAfter(now: Date): Date {
  const singaporeClock = new Date(
    now.getTime() + RAFFLE_UTC_OFFSET_HOURS * 60 * 60 * 1000,
  );
  let year = singaporeClock.getUTCFullYear();
  let monthIndex = singaporeClock.getUTCMonth();
  let candidate = firstSaturdayDrawAt(year, monthIndex);

  if (candidate.getTime() <= now.getTime()) {
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
    candidate = firstSaturdayDrawAt(year, monthIndex);
  }

  return candidate;
}

export function cycleWindowForDraw(
  drawAt: Date,
  awardWindowDays = DEFAULT_AWARD_WINDOW_DAYS,
): RaffleCycleWindow {
  if (
    !Number.isInteger(awardWindowDays) || awardWindowDays < 7 ||
    awardWindowDays > 90
  ) {
    throw new Error("Award window must be from 7 through 90 days.");
  }
  const singaporeClock = new Date(
    drawAt.getTime() + RAFFLE_UTC_OFFSET_HOURS * 60 * 60 * 1000,
  );
  const year = singaporeClock.getUTCFullYear();
  const monthIndex = singaporeClock.getUTCMonth();
  const expected = firstSaturdayDrawAt(year, monthIndex);

  if (expected.getTime() !== drawAt.getTime()) {
    throw new Error(
      "Draw time must be the first Saturday at 9:30 PM (UTC+8).",
    );
  }

  let priorYear = year;
  let priorMonthIndex = monthIndex - 1;
  if (priorMonthIndex < 0) {
    priorMonthIndex = 11;
    priorYear -= 1;
  }

  const priorDrawAt = firstSaturdayDrawAt(priorYear, priorMonthIndex);
  const priorSingaporeClock = new Date(
    priorDrawAt.getTime() + RAFFLE_UTC_OFFSET_HOURS * 60 * 60 * 1000,
  );
  const opensAt = utcForSingapore(
    priorSingaporeClock.getUTCFullYear(),
    priorSingaporeClock.getUTCMonth(),
    priorSingaporeClock.getUTCDate(),
    OPEN_HOUR,
    OPEN_MINUTE,
  );
  const closesAt = new Date(drawAt.getTime() - 15 * 60 * 1000);

  return {
    opensAt,
    closesAt,
    drawAt: new Date(drawAt),
    expiresAt: new Date(
      drawAt.getTime() + awardWindowDays * 24 * 60 * 60 * 1000,
    ),
    sevenDayReminderAt: new Date(closesAt.getTime() - 7 * 24 * 60 * 60 * 1000),
    oneDayReminderAt: new Date(closesAt.getTime() - 24 * 60 * 60 * 1000),
  };
}

export function nextCycleWindow(now: Date): RaffleCycleWindow {
  return cycleWindowForDraw(nextDrawAfter(now));
}

export function cyclePublicId(drawAt: Date): string {
  const singaporeClock = new Date(
    drawAt.getTime() + RAFFLE_UTC_OFFSET_HOURS * 60 * 60 * 1000,
  );
  return `mpd-${singaporeClock.getUTCFullYear()}-${
    String(singaporeClock.getUTCMonth() + 1).padStart(2, "0")
  }`;
}

export function isEntryWindowOpen(
  status: string,
  now: Date,
  opensAt: Date,
  closesAt: Date,
): boolean {
  return status === "open" && now.getTime() >= opensAt.getTime() &&
    now.getTime() < closesAt.getTime();
}

export type CycleReminderCode =
  | "cycle_opened"
  | "entry_closes_in_seven_days"
  | "entry_closes_in_one_day";

export function dueCycleReminderCodes(
  status: string,
  now: Date,
  opensAt: Date,
  closesAt: Date,
): CycleReminderCode[] {
  if (status !== "open" || now < opensAt || now >= closesAt) return [];
  const codes: CycleReminderCode[] = ["cycle_opened"];
  if (now.getTime() >= closesAt.getTime() - 7 * 86_400_000) {
    codes.push("entry_closes_in_seven_days");
  }
  if (now.getTime() >= closesAt.getTime() - 86_400_000) {
    codes.push("entry_closes_in_one_day");
  }
  return codes;
}

export type ClaimReminderCode =
  | "claim_expires_in_seventy_two_hours"
  | "claim_expires_in_twenty_four_hours";

export function dueClaimReminderCodes(
  now: Date,
  deadline: Date,
): ClaimReminderCode[] {
  const remaining = deadline.getTime() - now.getTime();
  if (remaining <= 0) return [];
  const codes: ClaimReminderCode[] = [];
  if (remaining <= 72 * 60 * 60 * 1000) {
    codes.push("claim_expires_in_seventy_two_hours");
  }
  if (remaining <= 24 * 60 * 60 * 1000) {
    codes.push("claim_expires_in_twenty_four_hours");
  }
  return codes;
}

export function alternateTransition(
  now: Date,
  awardExpiresAt: Date,
  hasActiveRecipient: boolean,
  hasUnusedAlternate: boolean,
  claimWindowDays = DEFAULT_CLAIM_WINDOW_DAYS,
): "wait" | "promote" | "complete" {
  if (
    !Number.isInteger(claimWindowDays) || claimWindowDays < 1 ||
    claimWindowDays > 30
  ) return "complete";
  if (now.getTime() >= awardExpiresAt.getTime()) return "complete";
  if (hasActiveRecipient) return "wait";
  if (
    hasUnusedAlternate &&
    now.getTime() + claimWindowDays * 86_400_000 <= awardExpiresAt.getTime()
  ) return "promote";
  return "complete";
}

export type PrizeRecipientState = {
  status?: unknown;
  claim_opened_at?: unknown;
  claimed_at?: unknown;
};

export function hasActivePrizeRecipient(
  results: PrizeRecipientState[],
): boolean {
  return results.some((result) => {
    const status = String(result.status || "").trim();
    return status === "claimed" || status === "fulfilled" ||
      (["selected", "contacted"].includes(status) &&
        Boolean(result.claim_opened_at));
  });
}

export type CurrentCycleCandidate = {
  status?: unknown;
  draw_at?: unknown;
  [key: string]: unknown;
};

const CURRENT_CYCLE_STATUS_PRIORITY: Record<string, number> = {
  open: 0,
  frozen: 1,
  ready: 2,
  drawn: 3,
  complete: 4,
};

export function selectCurrentCycleCandidate<T extends CurrentCycleCandidate>(
  candidates: T[],
): T | null {
  const eligible = candidates.filter((candidate) =>
    typeof candidate.status === "string" &&
    candidate.status in CURRENT_CYCLE_STATUS_PRIORITY &&
    Number.isFinite(Date.parse(String(candidate.draw_at || "")))
  );
  eligible.sort((left, right) => {
    const leftStatus = String(left.status);
    const rightStatus = String(right.status);
    const statusDifference = CURRENT_CYCLE_STATUS_PRIORITY[leftStatus] -
      CURRENT_CYCLE_STATUS_PRIORITY[rightStatus];
    if (statusDifference !== 0) return statusDifference;
    const leftDraw = Date.parse(String(left.draw_at));
    const rightDraw = Date.parse(String(right.draw_at));
    return leftStatus === "ready" ? leftDraw - rightDraw : rightDraw - leftDraw;
  });
  return eligible[0] || null;
}
