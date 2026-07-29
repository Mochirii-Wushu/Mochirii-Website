import {
  calculateEntryCount,
  completedBonusKeys,
  hashBonusAlternativeResponse,
  isClaimFraudReviewState,
  isClaimTaxReviewState,
  normalizeReviewedProductSubset,
  RAFFLE_BONUS_KEYS,
  resolveAdministratorEligibilityReview,
  resolveClaimMembershipClearance,
  verifiedBonusEvidenceIsValid,
} from "./raffle-entry.ts";
import {
  buildFrozenLedger,
  drawRaffle,
  frozenLedgerHash,
  sha256Hex,
} from "./raffle-draw.ts";
import {
  alternateTransition,
  cycleWindowForDraw,
  dueClaimReminderCodes,
  dueCycleReminderCodes,
  firstSaturdayDrawAt,
  hasActivePrizeRecipient,
  isEntryWindowOpen,
  nextDrawAfter,
  RAFFLE_TIMEZONE,
  selectCurrentCycleCandidate,
} from "./raffle-schedule.ts";
import {
  isAllowedManualAllInCostCents,
  rafflePrizeCentsFromDollars,
  rafflePublicRewardLabel,
} from "./raffle-prize.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("raffle gross prizes are whole-dollar $10 through $50 and manual costs honor the all-in cap", () => {
  for (const [dollars, cents] of [[10, 1_000], [25, 2_500], [50, 5_000]]) {
    assert(
      rafflePrizeCentsFromDollars(dollars) === cents,
      `$${dollars} should be accepted`,
    );
    assert(
      rafflePublicRewardLabel(cents).startsWith(
        `One $${dollars} digital gift card`,
      ),
      "public reward label should match the immutable gross prize",
    );
  }
  for (const dollars of [9, 10.5, 51]) {
    assert(
      rafflePrizeCentsFromDollars(dollars) === null,
      `$${dollars} should be rejected`,
    );
  }
  assert(
    isAllowedManualAllInCostCents(2_500, 2_500),
    "prize-cost floor should pass",
  );
  assert(isAllowedManualAllInCostCents(5_000, 2_500), "$50 cap should pass");
  assert(
    !isAllowedManualAllInCostCents(2_499, 2_500),
    "cost below prize should fail",
  );
  assert(
    !isAllowedManualAllInCostCents(5_001, 2_500),
    "cost above cap should fail",
  );
});

Deno.test("first Saturday schedule uses UTC+8 boundaries and 28/35-day cycles", () => {
  assert(RAFFLE_TIMEZONE === "Asia/Singapore", "timezone changed");
  const july = firstSaturdayDrawAt(2026, 6);
  const august = firstSaturdayDrawAt(2026, 7);
  const september = firstSaturdayDrawAt(2026, 8);

  assert(
    july.toISOString() === "2026-07-04T13:30:00.000Z",
    "July draw mismatch",
  );
  assert(
    august.toISOString() === "2026-08-01T13:30:00.000Z",
    "August draw mismatch",
  );
  assert(
    (august.getTime() - july.getTime()) / 86_400_000 === 28,
    "expected a 28-day cycle",
  );
  assert(
    (september.getTime() - august.getTime()) / 86_400_000 === 35,
    "expected a 35-day cycle",
  );

  const window = cycleWindowForDraw(august);
  assert(
    window.opensAt.toISOString() === "2026-07-04T14:00:00.000Z",
    "opening mismatch",
  );
  assert(
    window.closesAt.toISOString() === "2026-08-01T13:15:00.000Z",
    "close mismatch",
  );
  assert(
    window.expiresAt.toISOString() === "2026-08-31T13:30:00.000Z",
    "expiry mismatch",
  );
  assert(
    nextDrawAfter(new Date("2026-08-01T13:30:00.000Z")).toISOString() ===
      "2026-09-05T13:30:00.000Z",
    "draw boundary must advance",
  );
});

Deno.test("claim and award windows are configurable only inside reviewed bounds", () => {
  const drawAt = new Date("2026-08-01T13:30:00.000Z");
  const fortyFiveDayWindow = cycleWindowForDraw(drawAt, 45);
  assert(
    fortyFiveDayWindow.expiresAt.toISOString() ===
      "2026-09-15T13:30:00.000Z",
    "custom award window was not applied",
  );

  const now = new Date("2026-08-25T13:30:00.000Z");
  const expiry = new Date("2026-08-31T13:30:00.000Z");
  assert(
    alternateTransition(now, expiry, false, true, 5) === "promote",
    "valid five-day claim window was not honored",
  );
  assert(
    alternateTransition(now, expiry, false, true, 7) === "complete",
    "alternate was promoted without the full claim window",
  );

  for (const invalidAwardDays of [6, 91, 7.5]) {
    let rejected = false;
    try {
      cycleWindowForDraw(drawAt, invalidAwardDays);
    } catch {
      rejected = true;
    }
    assert(rejected, `invalid award window ${invalidAwardDays} was accepted`);
  }
  for (const invalidClaimDays of [0, 31, 1.5]) {
    assert(
      alternateTransition(now, expiry, false, true, invalidClaimDays) ===
        "complete",
      `invalid claim window ${invalidClaimDays} did not fail closed`,
    );
  }
});

Deno.test("entry calculation gives one base and at most nine unique free bonuses", () => {
  const completions = [
    ...RAFFLE_BONUS_KEYS.map((bonusKey, index) => ({
      bonusKey,
      completionMethod: index % 2 ? "alternative" : "primary",
    })),
    { bonusKey: "scheduled_activity", completionMethod: "alternative" },
    {
      bonusKey: "member_spotlight_nomination",
      completionMethod: "primary",
      revoked: true,
    },
    { bonusKey: "unknown", completionMethod: "primary" },
  ];

  assert(
    completedBonusKeys(completions).length === 9,
    "duplicate or invalid completion counted",
  );
  assert(calculateEntryCount(true, completions) === 10, "entry cap mismatch");
  assert(
    calculateEntryCount(false, completions) === 0,
    "ineligible member received entries",
  );
});

Deno.test("entry window uses inclusive open and exclusive close boundaries", () => {
  const opensAt = new Date("2026-07-04T14:00:00.000Z");
  const closesAt = new Date("2026-08-01T13:15:00.000Z");
  assert(
    !isEntryWindowOpen(
      "ready",
      opensAt,
      opensAt,
      closesAt,
    ),
    "ready cycle accepted entry",
  );
  assert(
    isEntryWindowOpen("open", opensAt, opensAt, closesAt),
    "opening instant must accept entry",
  );
  assert(
    isEntryWindowOpen(
      "open",
      new Date(closesAt.getTime() - 1),
      opensAt,
      closesAt,
    ),
    "last millisecond was rejected",
  );
  assert(
    !isEntryWindowOpen("open", closesAt, opensAt, closesAt),
    "closing instant must reject entry",
  );
});

Deno.test("reminder helpers expose only due milestones for idempotent outbox keys", () => {
  const opensAt = new Date("2026-07-04T14:00:00.000Z");
  const closesAt = new Date("2026-08-01T13:15:00.000Z");
  assert(
    JSON.stringify(
      dueCycleReminderCodes("open", opensAt, opensAt, closesAt),
    ) === JSON.stringify(["cycle_opened"]),
    "opening reminder mismatch",
  );
  assert(
    JSON.stringify(dueCycleReminderCodes(
      "open",
      new Date(closesAt.getTime() - 7 * 86_400_000),
      opensAt,
      closesAt,
    )) ===
      JSON.stringify(["cycle_opened", "entry_closes_in_seven_days"]),
    "seven-day boundary mismatch",
  );
  assert(
    JSON.stringify(dueCycleReminderCodes(
      "open",
      new Date(closesAt.getTime() - 86_400_000),
      opensAt,
      closesAt,
    )) === JSON.stringify([
      "cycle_opened",
      "entry_closes_in_seven_days",
      "entry_closes_in_one_day",
    ]),
    "one-day boundary mismatch",
  );
  assert(
    dueCycleReminderCodes("open", closesAt, opensAt, closesAt).length === 0,
    "closed cycle emitted reminders",
  );

  const deadline = new Date("2026-08-08T13:30:00.000Z");
  assert(
    dueClaimReminderCodes(
      new Date(deadline.getTime() - 72 * 60 * 60 * 1000),
      deadline,
    )[0] === "claim_expires_in_seventy_two_hours",
    "72-hour reminder boundary mismatch",
  );
  assert(
    dueClaimReminderCodes(
      new Date(deadline.getTime() - 24 * 60 * 60 * 1000),
      deadline,
    ).length === 2,
    "24-hour boundary must include both due milestones",
  );
  assert(
    dueClaimReminderCodes(deadline, deadline).length === 0,
    "expired claim emitted reminders",
  );
});

Deno.test("administrator and household reviews remain pending or fail closed", () => {
  const cleared = resolveAdministratorEligibilityReview(
    "eligible",
    "clear",
    "",
  );
  assert(cleared.eligibilityState === "eligible", "clearance was ignored");
  assert(
    cleared.reasonCode === "administrator_household_cleared",
    "clearance reason mismatch",
  );

  const administrator = resolveAdministratorEligibilityReview(
    "administrator_ineligible",
    "clear",
    "",
  );
  assert(
    administrator.eligibilityState === "ineligible",
    "administrator could be cleared",
  );

  const household = resolveAdministratorEligibilityReview(
    "eligible",
    "exclude",
    "household",
  );
  assert(
    household.reasonCode === "administrator_household_ineligible",
    "household exclusion mismatch",
  );

  const unresolved = resolveAdministratorEligibilityReview(
    "country_not_approved",
    "clear",
    "",
  );
  assert(
    unresolved.eligibilityState === "pending_review" &&
      unresolved.clearanceStatus === "pending",
    "baseline failure was incorrectly cleared",
  );
});

Deno.test("bonus verification requires an objective row, path, and SHA-256 evidence", () => {
  assert(
    verifiedBonusEvidenceIsValid(
      "scheduled_activity",
      "primary",
      "aa".repeat(32),
    ),
    "valid evidence rejected",
  );
  assert(
    verifiedBonusEvidenceIsValid(
      "scheduled_activity",
      "alternative",
      "bb".repeat(32),
    ),
    "equal alternative rejected",
  );
  assert(
    !verifiedBonusEvidenceIsValid(
      "unknown",
      "primary",
      "aa".repeat(32),
    ),
    "unknown bonus accepted",
  );
  assert(
    !verifiedBonusEvidenceIsValid(
      "scheduled_activity",
      "primary",
      "not-a-hash",
    ),
    "unverified bonus accepted",
  );
});

Deno.test("claim release inputs admit only named tax states and reviewed provider IDs", () => {
  assert(isClaimTaxReviewState("not_required"), "not-required review rejected");
  assert(isClaimTaxReviewState("cleared"), "cleared review rejected");
  assert(isClaimTaxReviewState("blocked"), "blocked review rejected");
  assert(!isClaimTaxReviewState("approved"), "unknown tax state accepted");
  assert(isClaimFraudReviewState("cleared"), "fraud clearance rejected");
  assert(isClaimFraudReviewState("blocked"), "fraud block rejected");
  assert(
    !isClaimFraudReviewState("not_required"),
    "unknown fraud state accepted",
  );

  assert(
    resolveClaimMembershipClearance("active", true).state === "cleared",
    "active verified member was blocked",
  );
  assert(
    resolveClaimMembershipClearance("suspended", true).reasonCode ===
      "membership_not_active",
    "suspended member passed current-standing review",
  );
  assert(
    resolveClaimMembershipClearance("active", false).reasonCode ===
      "guild_verification_required",
    "unverified guild standing passed review",
  );

  const products = normalizeReviewedProductSubset([
    "product:b",
    "product:a",
    "product:b",
  ]);
  assert(
    JSON.stringify(products) === JSON.stringify(["product:a", "product:b"]),
    "product subset was not canonicalized",
  );
  assert(
    normalizeReviewedProductSubset([]) === null,
    "empty product fallback was accepted",
  );
  assert(
    normalizeReviewedProductSubset(["provider product"]) === null,
    "unsafe product identifier was accepted",
  );
  assert(
    normalizeReviewedProductSubset(["valid", { id: "secret" }]) === null,
    "non-string product identifier was accepted",
  );
});

Deno.test("free-alternative responses are context-bound HMACs, not stored text", async () => {
  const input = {
    secret: "server-only-test-secret-32-bytes-minimum",
    cycleId: "cycle-1",
    memberId: "member-1",
    bonusKey: "scheduled_activity" as const,
    response: "private response text",
  };
  const first = await hashBonusAlternativeResponse(input);
  const retry = await hashBonusAlternativeResponse(input);
  const otherMember = await hashBonusAlternativeResponse({
    ...input,
    memberId: "member-2",
  });
  assert(first === retry, "alternative evidence is not idempotent");
  assert(first.length === 64, "alternative evidence is not SHA-256 sized");
  assert(first !== otherMember, "alternative evidence is not member-bound");
  assert(
    !first.includes(input.response),
    "raw alternative response leaked into evidence",
  );
});

Deno.test("alternate transition preserves a full claim window inside 30-day expiry", () => {
  const now = new Date("2026-08-10T13:30:00.000Z");
  const expiry = new Date("2026-08-31T13:30:00.000Z");
  assert(
    alternateTransition(now, expiry, true, true) === "wait",
    "active recipient was replaced",
  );
  assert(
    alternateTransition(expiry, expiry, true, true) === "wait",
    "cycle completed before the inclusive award expiry elapsed",
  );
  assert(
    alternateTransition(
      new Date("2026-08-31T13:30:00.001Z"),
      expiry,
      true,
      true,
    ) === "complete",
    "cycle remained open after the award expiry elapsed",
  );
  assert(
    alternateTransition(now, expiry, false, true) === "promote",
    "valid alternate was not promoted",
  );
  assert(
    alternateTransition(
      new Date("2026-08-25T13:30:00.001Z"),
      expiry,
      false,
      true,
    ) === "complete",
    "alternate received less than seven days",
  );
  assert(
    alternateTransition(now, expiry, false, false) === "complete",
    "exhausted alternate order did not complete",
  );
});

Deno.test("terminally blocked claimants do not prevent the next alternate", () => {
  assert(
    !hasActivePrizeRecipient([{
      status: "ineligible",
      claim_opened_at: "2026-08-01T13:30:00.000Z",
      claimed_at: "2026-08-02T13:30:00.000Z",
    }]),
    "historical claim timestamp kept an ineligible recipient active",
  );
  assert(
    hasActivePrizeRecipient([{
      status: "selected",
      claim_opened_at: "2026-08-01T13:30:00.000Z",
    }]),
    "an open initial claim was not active",
  );
  assert(
    hasActivePrizeRecipient([{ status: "claimed" }]),
    "a cleared pending claim was not active",
  );
  assert(
    hasActivePrizeRecipient([{ status: "fulfilled" }]),
    "a fulfilled prize was not active",
  );
});

Deno.test("active overlapping cycle wins over the prior unexpired results cycle", () => {
  const prior = {
    id: "prior",
    status: "drawn",
    draw_at: "2026-08-01T13:30:00.000Z",
  };
  const current = {
    id: "current",
    status: "open",
    draw_at: "2026-09-05T13:30:00.000Z",
  };
  assert(
    selectCurrentCycleCandidate([prior, current])?.id === "current",
    "prior drawn cycle blocked current opt-ins",
  );
  const scheduled = {
    id: "scheduled",
    status: "ready",
    draw_at: "2026-10-03T13:30:00.000Z",
  };
  assert(
    selectCurrentCycleCandidate([prior, scheduled])?.id === "scheduled",
    "scheduled cycle lost to results fallback",
  );
  const olderResult = {
    id: "older-result",
    status: "complete",
    draw_at: "2026-07-04T13:30:00.000Z",
  };
  assert(
    selectCurrentCycleCandidate([olderResult, prior])?.id === "prior",
    "fallback did not choose recent draw results",
  );
});

Deno.test("one-plus-nine ledger matches the database bytewise deterministic vector", async () => {
  const salt = "5".repeat(32);
  const seed = "6".repeat(64);
  const source = [
    { memberId: "20000000-0000-4000-8000-000000000001", entryCount: 1 },
    { memberId: "20000000-0000-4000-8000-000000000002", entryCount: 2 },
    { memberId: "20000000-0000-4000-8000-000000000003", entryCount: 4 },
    { memberId: "20000000-0000-4000-8000-000000000004", entryCount: 10 },
  ];
  const ledger = await buildFrozenLedger(source, salt);
  const hash = await frozenLedgerHash(ledger);
  const first = await drawRaffle(ledger, seed);
  const retry = await drawRaffle(ledger, seed);

  const expectedLedger = [
    {
      memberId: "20000000-0000-4000-8000-000000000004",
      entryCount: 10,
      pseudonymousMemberId:
        "4642d2941ef6adacf9ce914c0b6d77f0a2d82604fa690ec1c20645491949f4fd",
      firstOrdinal: 1,
      lastOrdinal: 10,
    },
    {
      memberId: "20000000-0000-4000-8000-000000000003",
      entryCount: 4,
      pseudonymousMemberId:
        "58f585c7bd041dba45605d4a29bf6ecc1daf9a21377dd6237442ba1eb154f17c",
      firstOrdinal: 11,
      lastOrdinal: 14,
    },
    {
      memberId: "20000000-0000-4000-8000-000000000002",
      entryCount: 2,
      pseudonymousMemberId:
        "9ef80648f10316335e97608b27b46d395c87cb5a92c2bee888710e72a2203e29",
      firstOrdinal: 15,
      lastOrdinal: 16,
    },
    {
      memberId: "20000000-0000-4000-8000-000000000001",
      entryCount: 1,
      pseudonymousMemberId:
        "a2f9b4b93835c09bba6d906a802b4c5aa46c2b2d656e63888880580ec712320a",
      firstOrdinal: 17,
      lastOrdinal: 17,
    },
  ];
  const expectedResults = [
    {
      memberId: "20000000-0000-4000-8000-000000000003",
      pseudonymousMemberId:
        "58f585c7bd041dba45605d4a29bf6ecc1daf9a21377dd6237442ba1eb154f17c",
      entryOrdinal: 11,
      selectionOrder: 1,
      kind: "paid_winner",
      alternateRank: null,
    },
    {
      memberId: "20000000-0000-4000-8000-000000000004",
      pseudonymousMemberId:
        "4642d2941ef6adacf9ce914c0b6d77f0a2d82604fa690ec1c20645491949f4fd",
      entryOrdinal: 6,
      selectionOrder: 2,
      kind: "honor",
      alternateRank: null,
    },
    {
      memberId: "20000000-0000-4000-8000-000000000002",
      pseudonymousMemberId:
        "9ef80648f10316335e97608b27b46d395c87cb5a92c2bee888710e72a2203e29",
      entryOrdinal: 16,
      selectionOrder: 3,
      kind: "honor",
      alternateRank: null,
    },
    {
      memberId: "20000000-0000-4000-8000-000000000001",
      pseudonymousMemberId:
        "a2f9b4b93835c09bba6d906a802b4c5aa46c2b2d656e63888880580ec712320a",
      entryOrdinal: 17,
      selectionOrder: 4,
      kind: "alternate",
      alternateRank: 1,
    },
  ];

  assert(
    hash === await frozenLedgerHash(ledger),
    "ledger hash is not deterministic",
  );
  assert(
    hash === "59d35f30f662fbafc8dd1ad30fb23834002ba31de3e51a74f4aa8ecda1982b1a",
    "ledger hash diverged from the database vector",
  );
  assert(
    JSON.stringify(ledger) === JSON.stringify(expectedLedger),
    "bytewise ledger order diverged from the database vector",
  );
  assert(
    JSON.stringify(first) === JSON.stringify(expectedResults),
    "draw results diverged from the database vector",
  );
  assert(
    JSON.stringify(first) === JSON.stringify(retry),
    "draw retry changed results",
  );
  assert(first.length === source.length, "alternate order is incomplete");
  assert(
    new Set(first.map((selection) => selection.memberId)).size ===
      source.length,
    "member selected twice",
  );
  assert(first[0].kind === "paid_winner", "first result is not paid winner");
  assert(
    first[1].kind === "honor" && first[2].kind === "honor",
    "honors mismatch",
  );
  assert(
    first[3].kind === "alternate" && first[3].alternateRank === 1,
    "alternate order mismatch",
  );
  assert(
    first.every((selection) =>
      selection.entryOrdinal > 0 && selection.entryOrdinal <= 17
    ),
    "ordinal outside frozen ledger",
  );
});

Deno.test("rejection sampling stream remains deterministic for a range that does not divide 256", async () => {
  const salt = "33".repeat(32);
  const ledger = await buildFrozenLedger(
    Array.from({ length: 7 }, (_, index) => ({
      memberId: `00000000-0000-4000-8000-${
        String(index + 1).padStart(12, "0")
      }`,
      entryCount: 5 + (index % 6),
    })),
    salt,
  );
  const selections = await drawRaffle(
    ledger,
    await sha256Hex("fixed-test-seed"),
  );
  assert(selections.length === 7, "all entrants must be ordered");
  assert(
    new Set(selections.map((selection) => selection.entryOrdinal)).size === 7,
    "original ordinals unexpectedly repeated",
  );
});
