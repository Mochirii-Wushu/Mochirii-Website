import assert from "node:assert/strict";
import test from "node:test";

import {
  createSpinnerServerClockAnchor,
  createSpinnerCommandId,
  formatSpinnerCountdown,
  isTerminalSpinnerSpinFailure,
  parsePendingSpinnerCommand,
  parseSpinnerLiveResult,
  parseSpinnerLiveSnapshot,
  reconcileSpinnerServerClockAnchor,
  resolveInitialViewerMotion,
  stabilizeSpinnerSequencePresentation,
  SpinnerLiveRequestError,
  spinnerCountdownSeconds,
  spinnerDrawAnnouncementTransition,
  spinnerLivePollInterval,
  spinnerLiveErrorRetryDelay,
  spinnerLiveMotionRotations,
  spinnerSkipControlVisible,
  spinnerSkipStateForDraw,
  spinnerLiveTimeline,
  spinnerSequencePresentation,
  spinnerSequencePresentationBoundaryKey,
  spinnerSequenceMutationReady,
  spinnerSequenceReceiptForPromotion,
  spinnerSequenceRoundMotionRotations,
  spinnerSequenceRoundTimeline,
  spinnerServerClockAnchorForSnapshot,
  spinnerServerClockNow,
  // @ts-expect-error Node's type-stripping runner needs the explicit source extension.
} from "../apps/web/components/spinner/live.ts";
import {
  createDrawReceipt,
  ELIMINATION_ALGORITHM_VERSION,
  ELIMINATION_APP_VERSION,
  ELIMINATION_ROUND_DURATION_MS,
  type ParticipantV1,
  // @ts-expect-error Node's type-stripping runner needs the explicit source extension.
} from "../apps/web/components/spinner/raffle.ts";
import {
  CELEBRATION_LIMITS,
  celebrationCanvasMetrics,
  celebrationElapsedMs,
  celebrationProfileForViewport,
  createCelebrationScene,
  resolveCelebrationMotionMode,
  // @ts-expect-error Node's type-stripping runner needs the explicit source extension.
} from "../apps/web/components/spinner/celebration-scene.ts";
import {
  SPINNER_BROWSER_REQUEST_TIMEOUT_MS,
  SPINNER_PROXY_UPSTREAM_TIMEOUT_MS,
  SPINNER_RESPONSE_MARGIN_MS,
  // @ts-expect-error Node's type-stripping runner needs the explicit source extension.
} from "../apps/web/lib/spinner/request-timeouts.ts";

const SESSION_ID = "10000000-0000-4000-8000-000000000001";
const DRAW_ID = "20000000-0000-4000-8000-000000000002";
const OTHER_DRAW_ID = "30000000-0000-4000-8000-000000000003";
const UPDATED_AT = "2026-07-26T18:00:00.000Z";
const STARTED_AT = "2026-07-26T18:03:00.000Z";
const REVEAL_AT = "2026-07-26T18:03:08.000Z";
const SERVER_NOW = "2026-07-26T18:00:04.000Z";

const PARTICIPANTS: ParticipantV1[] = [
  { version: 1, id: "40000000-0000-4000-8000-000000000004", displayName: "Lotus" },
  { version: 1, id: "50000000-0000-4000-8000-000000000005", displayName: "明月" },
];

const SEQUENCE_PARTICIPANTS: ParticipantV1[] = [
  PARTICIPANTS[0],
  PARTICIPANTS[1],
  { version: 1, id: "60000000-0000-4000-8000-000000000006", displayName: "Starlight" },
  { version: 1, id: "70000000-0000-4000-8000-000000000007", displayName: "Cloud" },
];
const PLAN_HASH = "a".repeat(64);

test("browser spinner requests outlive the proxy upstream deadline with response margin", () => {
  assert.equal(SPINNER_PROXY_UPSTREAM_TIMEOUT_MS, 12_000);
  assert.equal(SPINNER_BROWSER_REQUEST_TIMEOUT_MS, 16_000);
  assert.equal(SPINNER_RESPONSE_MARGIN_MS, 4_000);
  assert.ok(SPINNER_BROWSER_REQUEST_TIMEOUT_MS > SPINNER_PROXY_UPSTREAM_TIMEOUT_MS);
});

function idleSnapshot(participants: ParticipantV1[] = []) {
  return {
    version: 1,
    sessionId: SESSION_ID,
    revision: 0,
    phase: "idle",
    drawMode: "unclassified",
    participants,
    startedAt: null,
    revealAt: null,
    durationMs: 0,
    startRotation: 0,
    finalRotation: 0,
    selectedIndex: null,
    winner: null,
    drawId: null,
    updatedAt: UPDATED_AT,
  };
}

function spinningSnapshot() {
  return {
    ...idleSnapshot(PARTICIPANTS),
    revision: 3,
    phase: "spinning",
    drawMode: "official",
    startedAt: STARTED_AT,
    revealAt: REVEAL_AT,
    durationMs: 8_000,
    startRotation: 45,
    finalRotation: 2_205,
    drawId: DRAW_ID,
  };
}

function revealedSnapshot() {
  return {
    ...spinningSnapshot(),
    revision: 4,
    phase: "revealed",
    selectedIndex: 1,
    winner: PARTICIPANTS[1],
  };
}

function sequenceSnapshot(phase: "spinning" | "revealed" = "spinning") {
  const rounds = [
    {
      roundIndex: 0,
      selectedIndex: 1,
      eliminatedId: SEQUENCE_PARTICIPANTS[1].id,
      startedAt: "2026-07-26T18:01:00.000Z",
      revealAt: "2026-07-26T18:01:05.000Z",
      startRotation: 0,
      finalRotation: 2_430,
    },
    {
      roundIndex: 1,
      selectedIndex: 2,
      eliminatedId: SEQUENCE_PARTICIPANTS[3].id,
      startedAt: "2026-07-26T18:01:05.000Z",
      revealAt: "2026-07-26T18:01:10.000Z",
      startRotation: 270,
      finalRotation: 2_640,
    },
    {
      roundIndex: 2,
      selectedIndex: 0,
      eliminatedId: SEQUENCE_PARTICIPANTS[0].id,
      startedAt: "2026-07-26T18:01:10.000Z",
      revealAt: "2026-07-26T18:01:15.000Z",
      startRotation: 120,
      finalRotation: 2_520,
    },
  ];
  return {
    version: 2,
    sessionId: SESSION_ID,
    revision: phase === "spinning" ? 5 : 6,
    phase,
    drawMode: "official",
    participants: SEQUENCE_PARTICIPANTS,
    startedAt: rounds[0].startedAt,
    revealAt: rounds.at(-1)?.revealAt,
    durationMs: 5_000,
    startRotation: 0,
    finalRotation: 2_340,
    selectedIndex: phase === "revealed" ? 2 : null,
    winner: phase === "revealed" ? SEQUENCE_PARTICIPANTS[2] : null,
    drawId: DRAW_ID,
    updatedAt: UPDATED_AT,
    planHashSha256: PLAN_HASH,
    rounds,
  };
}

function sequenceReceipt() {
  const snapshot = sequenceSnapshot("revealed");
  const active = [...SEQUENCE_PARTICIPANTS];
  const rounds = snapshot.rounds.map((round) => {
    const activeCount = active.length;
    const eliminatedParticipant = active[round.selectedIndex];
    const rejectionLimit = Math.floor(0x1_0000_0000 / activeCount) * activeCount;
    const receiptRound = {
      ...round,
      activeCount,
      eliminatedParticipant,
      rejectionLimit,
      sampledWords: [round.selectedIndex],
      acceptedWord: round.selectedIndex,
    };
    active.splice(round.selectedIndex, 1);
    return receiptRound;
  });
  return {
    version: 2,
    drawMode: snapshot.drawMode,
    drawId: snapshot.drawId,
    timestampIso: "2026-07-26T18:00:00.000Z",
    singaporeTime: "2026-07-27 02:00:00 SGT",
    appVersion: ELIMINATION_APP_VERSION,
    algorithmVersion: ELIMINATION_ALGORITHM_VERSION,
    rosterSnapshot: { version: 1, participants: SEQUENCE_PARTICIPANTS },
    rosterHashSha256: "c".repeat(64),
    planHashSha256: snapshot.planHashSha256,
    durationMs: ELIMINATION_ROUND_DURATION_MS,
    startAt: snapshot.startedAt,
    revealAt: snapshot.revealAt,
    startRotation: snapshot.startRotation,
    finalRotation: snapshot.finalRotation,
    rounds,
    selectedIndex: snapshot.selectedIndex,
    winner: snapshot.winner,
  };
}

function resultEnvelope(snapshot: ReturnType<typeof revealedSnapshot>, receipt: unknown = null) {
  return {
    ok: true,
    data: {
      mode: "controller",
      snapshot,
      serverNow: SERVER_NOW,
      receipt,
    },
  };
}

test("idle snapshots accept genuine empty and one-participant rosters", () => {
  const empty = parseSpinnerLiveSnapshot(idleSnapshot());
  assert.ok(empty);
  assert.equal(empty.phase, "idle");
  assert.deepEqual(empty.participants, []);

  const oneParticipantRoster = [PARTICIPANTS[0]];
  const one = parseSpinnerLiveSnapshot(idleSnapshot(oneParticipantRoster));
  assert.ok(one);
  assert.deepEqual(one.participants, [PARTICIPANTS[0]]);
  assert.notEqual(one.participants, oneParticipantRoster);
});

test("spinning snapshots withhold the selected index and winner", () => {
  const spinning = parseSpinnerLiveSnapshot(spinningSnapshot());
  assert.ok(spinning);
  assert.equal(spinning.phase, "spinning");
  assert.equal(spinning.selectedIndex, null);
  assert.equal(spinning.winner, null);

  assert.equal(parseSpinnerLiveSnapshot({ ...spinningSnapshot(), selectedIndex: 1 }), null);
  assert.equal(parseSpinnerLiveSnapshot({ ...spinningSnapshot(), winner: PARTICIPANTS[1] }), null);
});

test("revealed snapshots require the winner to map to the selected roster position", () => {
  const revealed = parseSpinnerLiveSnapshot(revealedSnapshot());
  assert.ok(revealed);
  assert.equal(revealed.selectedIndex, 1);
  assert.deepEqual(revealed.winner, PARTICIPANTS[1]);

  assert.equal(parseSpinnerLiveSnapshot({ ...revealedSnapshot(), selectedIndex: 0 }), null);
  assert.equal(parseSpinnerLiveSnapshot({ ...revealedSnapshot(), winner: PARTICIPANTS[0] }), null);
  assert.equal(parseSpinnerLiveSnapshot({ ...revealedSnapshot(), selectedIndex: 2 }), null);
});

test("malformed and corrupt snapshots are rejected instead of becoming empty state", () => {
  const corruptParticipant = { version: 1, id: "not-a-uuid", displayName: "Lotus" };
  const duplicateRoster = [PARTICIPANTS[0], { ...PARTICIPANTS[0] }];
  const cases: unknown[] = [
    null,
    { ...idleSnapshot(), version: 2 },
    { ...idleSnapshot(), participants: "not-a-roster" },
    { ...idleSnapshot(), participants: [corruptParticipant] },
    { ...idleSnapshot(), participants: duplicateRoster },
    { ...idleSnapshot(), updatedAt: "not-a-date" },
    { ...idleSnapshot(), revision: -1 },
    { ...idleSnapshot(), sessionId: "not-a-uuid" },
    { ...idleSnapshot(), durationMs: 1 },
    { ...idleSnapshot(), startRotation: Number.NaN },
    { ...spinningSnapshot(), revealAt: "2026-07-26T18:00:01.000Z" },
    { ...spinningSnapshot(), durationMs: 7_999 },
  ];

  for (const value of cases) assert.equal(parseSpinnerLiveSnapshot(value), null);
});

test("v2 snapshots bind one compact contiguous five-second elimination plan", () => {
  const spinning = parseSpinnerLiveSnapshot(sequenceSnapshot());
  assert.ok(spinning && spinning.version === 2);
  assert.equal(spinning.rounds.length, SEQUENCE_PARTICIPANTS.length - 1);
  assert.equal(spinning.durationMs, 5_000);
  assert.equal(spinning.planHashSha256, PLAN_HASH);
  assert.equal(spinning.selectedIndex, null);
  assert.equal(spinning.winner, null);

  const revealed = parseSpinnerLiveSnapshot(sequenceSnapshot("revealed"));
  assert.ok(revealed && revealed.version === 2);
  assert.equal(revealed.selectedIndex, 2);
  assert.deepEqual(revealed.winner, SEQUENCE_PARTICIPANTS[2]);
});

test("v2 snapshots reject altered duration, order, continuity, selection, and plan identity", () => {
  const valid = sequenceSnapshot();
  const badRoundIndex = valid.rounds.map((round, index) => index === 1 ? { ...round, roundIndex: 3 } : round);
  const badSelection = valid.rounds.map((round, index) => index === 0 ? { ...round, eliminatedId: SEQUENCE_PARTICIPANTS[0].id } : round);
  const badGap = valid.rounds.map((round, index) => index === 1
    ? { ...round, startedAt: "2026-07-26T18:01:05.001Z", revealAt: "2026-07-26T18:01:10.001Z" }
    : round);
  const extraRoundField = valid.rounds.map((round, index) => index === 0 ? { ...round, participant: SEQUENCE_PARTICIPANTS[1] } : round);
  for (const hostile of [
    { ...valid, durationMs: 4_999 },
    { ...valid, planHashSha256: "not-a-hash" },
    { ...valid, rounds: valid.rounds.slice(0, -1) },
    { ...valid, rounds: badRoundIndex },
    { ...valid, rounds: badSelection },
    { ...valid, rounds: badGap },
    { ...valid, rounds: extraRoundField },
    { ...valid, rounds: valid.rounds.map((round, index) => index === 0 ? { ...round, finalRotation: 270 } : round) },
    { ...valid, rounds: valid.rounds.map((round, index) => index === 0 ? { ...round, finalRotation: 2_790 } : round) },
    { ...valid, rounds: valid.rounds.map((round, index) => index === 1 ? { ...round, startRotation: 269 } : round) },
    { ...valid, finalRotation: 180 },
    { ...valid, finalRotation: 2_700 },
    { ...valid, selectedIndex: 2 },
    { ...sequenceSnapshot("revealed"), selectedIndex: 1 },
    { ...sequenceSnapshot("revealed"), winner: { ...SEQUENCE_PARTICIPANTS[2], displayName: "Impostor" } },
  ]) assert.equal(parseSpinnerLiveSnapshot(hostile), null);
});

test("a complete 100-participant v2 result remains below the 256 KiB browser response ceiling", () => {
  const participants = Array.from({ length: 100 }, (_, index): ParticipantV1 => ({
    version: 1,
    id: `80000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    displayName: `Member-${String(index).padStart(3, "0")}-${"x".repeat(29)}`,
  }));
  const startAtMs = Date.parse("2026-07-26T18:01:00.000Z");
  const rounds = participants.slice(0, -1).map((eliminated, roundIndex) => ({
    roundIndex,
    selectedIndex: 0,
    eliminatedId: eliminated.id,
    startedAt: new Date(startAtMs + roundIndex * 5_000).toISOString(),
    revealAt: new Date(startAtMs + (roundIndex + 1) * 5_000).toISOString(),
    startRotation: 0,
    finalRotation: 2_160,
  }));
  const snapshot = {
    version: 2,
    sessionId: SESSION_ID,
    revision: 8,
    phase: "spinning",
    drawMode: "test",
    participants,
    startedAt: rounds[0].startedAt,
    revealAt: rounds.at(-1)?.revealAt,
    durationMs: 5_000,
    startRotation: 0,
    finalRotation: 2_163.6,
    selectedIndex: null,
    winner: null,
    drawId: DRAW_ID,
    updatedAt: UPDATED_AT,
    planHashSha256: "b".repeat(64),
    rounds,
  };
  const payload = {
    ok: true,
    data: {
      mode: "viewer",
      snapshot,
      receipt: null,
      commandId: null,
      serverNow: "2026-07-26T18:00:00.000Z",
    },
  };
  const encodedBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  assert.ok(encodedBytes < 256 * 1_024, `${encodedBytes} must remain below 256 KiB`);
  const parsed = parseSpinnerLiveResult(payload);
  assert.ok(parsed?.snapshot.version === 2);
  assert.equal(parsed.snapshot.rounds.length, 99);
});

test("sequence presentation is static for 01:00 then removes one entrant at each exact boundary", () => {
  const snapshot = parseSpinnerLiveSnapshot(sequenceSnapshot());
  assert.ok(snapshot && snapshot.version === 2);

  const countdown = spinnerSequencePresentation(snapshot, Date.parse("2026-07-26T18:00:00.000Z"));
  assert.equal(spinnerCountdownSeconds(snapshot.startedAt, Date.parse("2026-07-26T18:00:00.000Z")), 60);
  assert.equal(formatSpinnerCountdown(60), "01:00");
  assert.equal(countdown.stage, "countdown");
  assert.equal(countdown.round, null);
  assert.deepEqual(countdown.participants, SEQUENCE_PARTICIPANTS);

  const firstRound = spinnerSequencePresentation(snapshot, Date.parse("2026-07-26T18:01:00.000Z"));
  assert.equal(firstRound.stage, "round-spinning");
  assert.equal(firstRound.roundIndex, 0);
  assert.deepEqual(firstRound.participants, SEQUENCE_PARTICIPANTS);

  const secondRound = spinnerSequencePresentation(snapshot, Date.parse("2026-07-26T18:01:05.000Z"));
  assert.equal(secondRound.stage, "round-spinning");
  assert.equal(secondRound.roundIndex, 1);
  assert.deepEqual(secondRound.participants.map(({ id }) => id), [
    SEQUENCE_PARTICIPANTS[0].id,
    SEQUENCE_PARTICIPANTS[2].id,
    SEQUENCE_PARTICIPANTS[3].id,
  ]);
  assert.deepEqual(secondRound.lastEliminated, SEQUENCE_PARTICIPANTS[1]);

  const complete = spinnerSequencePresentation(snapshot, Date.parse("2026-07-26T18:01:15.000Z"));
  assert.equal(complete.stage, "complete");
  assert.deepEqual(complete.participants, [SEQUENCE_PARTICIPANTS[2]]);
  assert.deepEqual(complete.winner, SEQUENCE_PARTICIPANTS[2]);
  assert.deepEqual(complete.lastEliminated, SEQUENCE_PARTICIPANTS[0]);
  assert.equal(complete.nextBoundaryAt, null);
  assert.equal(spinnerSequenceMutationReady(snapshot, complete), false);
  const revealed = parseSpinnerLiveSnapshot(sequenceSnapshot("revealed"));
  assert.ok(revealed && revealed.version === 2);
  assert.equal(spinnerSequenceMutationReady(revealed, complete), true);
});

test("clock refreshes retain one presentation identity until an actual sequence boundary", () => {
  const snapshot = parseSpinnerLiveSnapshot(sequenceSnapshot());
  assert.ok(snapshot && snapshot.version === 2);
  const earlyRound = spinnerSequencePresentation(snapshot, Date.parse("2026-07-26T18:01:01.000Z"));
  const refreshedRound = spinnerSequencePresentation(snapshot, Date.parse("2026-07-26T18:01:04.000Z"));
  assert.equal(
    spinnerSequencePresentationBoundaryKey(snapshot, earlyRound),
    spinnerSequencePresentationBoundaryKey(snapshot, refreshedRound),
  );
  assert.equal(stabilizeSpinnerSequencePresentation(snapshot, earlyRound, refreshedRound), earlyRound);

  const caughtUpRound = spinnerSequencePresentation(snapshot, Date.parse("2026-07-26T18:01:05.000Z"));
  assert.notEqual(
    spinnerSequencePresentationBoundaryKey(snapshot, earlyRound),
    spinnerSequencePresentationBoundaryKey(snapshot, caughtUpRound),
  );
  assert.equal(stabilizeSpinnerSequencePresentation(snapshot, earlyRound, caughtUpRound), caughtUpRound);
});

test("v2 receipts remain hidden until the matching server reveal can promote them", () => {
  const receipt = sequenceReceipt();
  const spinning = parseSpinnerLiveResult({
    ok: true,
    data: {
      mode: "controller",
      snapshot: sequenceSnapshot(),
      receipt,
      commandId: null,
      serverNow: "2026-07-26T18:00:00.000Z",
    },
  });
  assert.ok(spinning?.snapshot.version === 2 && spinning.receipt?.version === 2);
  const completeWhileServerSpins = spinnerSequencePresentation(
    spinning.snapshot,
    Date.parse(spinning.snapshot.revealAt),
  );
  assert.equal(spinnerSequenceReceiptForPromotion(
    spinning.snapshot,
    completeWhileServerSpins,
    spinning.receipt,
  ), null);

  const revealed = parseSpinnerLiveResult({
    ok: true,
    data: {
      mode: "controller",
      snapshot: sequenceSnapshot("revealed"),
      receipt,
      commandId: null,
      serverNow: "2026-07-26T18:01:15.000Z",
    },
  });
  assert.ok(revealed?.snapshot.version === 2 && revealed.receipt?.version === 2);
  const complete = spinnerSequencePresentation(revealed.snapshot, Date.parse(revealed.snapshot.revealAt));
  assert.deepEqual(
    spinnerSequenceReceiptForPromotion(revealed.snapshot, complete, revealed.receipt),
    revealed.receipt,
  );
  assert.equal(parseSpinnerLiveResult({
    ok: true,
    data: {
      mode: "controller",
      snapshot: { ...sequenceSnapshot("revealed"), planHashSha256: "b".repeat(64) },
      receipt,
      commandId: null,
      serverNow: "2026-07-26T18:01:15.000Z",
    },
  }), null);
});

test("each sequence round has exact full motion and deterministic reduced/off landings", () => {
  const snapshot = parseSpinnerLiveSnapshot(sequenceSnapshot());
  assert.ok(snapshot && snapshot.version === 2);
  const round = snapshot.rounds[0];
  assert.deepEqual(spinnerSequenceRoundTimeline(round, Date.parse(round.startedAt), "full"), {
    startDelayMs: 0,
    revealDelayMs: 5_000,
    motionDurationMs: 5_000,
    motionDelayMs: 0,
  });
  assert.deepEqual(spinnerSequenceRoundTimeline(round, Date.parse(round.startedAt) + 2_000, "full"), {
    startDelayMs: 0,
    revealDelayMs: 3_000,
    motionDurationMs: 5_000,
    motionDelayMs: -2_000,
  });
  assert.deepEqual(spinnerSequenceRoundTimeline(round, Date.parse(round.startedAt), "reduced"), {
    startDelayMs: 3_350,
    revealDelayMs: 5_000,
    motionDurationMs: 1_650,
    motionDelayMs: 3_350,
  });
  assert.deepEqual(spinnerSequenceRoundTimeline(round, Date.parse(round.startedAt), "off"), {
    startDelayMs: 5_000,
    revealDelayMs: 5_000,
    motionDurationMs: 0,
    motionDelayMs: 5_000,
  });
  assert.deepEqual(spinnerSequenceRoundMotionRotations(round, "full"), {
    startRotation: 0,
    finalRotation: 2_430,
  });
  assert.deepEqual(spinnerSequenceRoundMotionRotations(round, "reduced"), {
    startRotation: 0,
    finalRotation: 270,
  });
  assert.deepEqual(spinnerSequenceRoundMotionRotations(round, "off"), {
    startRotation: 0,
    finalRotation: 0,
  });
});

test("live results require a valid server clock and receipt draw-ID consistency", async () => {
  const receipt = await createDrawReceipt(
    { version: 1, participants: PARTICIPANTS },
    () => 1,
    () => DRAW_ID,
    new Date(UPDATED_AT),
  );
  const parsed = parseSpinnerLiveResult(resultEnvelope(revealedSnapshot(), receipt));
  assert.ok(parsed);
  assert.equal(parsed.snapshot.drawId, receipt.drawId);
  assert.equal(parsed.receipt?.drawId, receipt.drawId);
  assert.equal(parsed.commandId, null);
  assert.equal(parsed.serverNow, SERVER_NOW);

  assert.equal(
    parseSpinnerLiveResult(resultEnvelope(revealedSnapshot(), { ...receipt, drawId: OTHER_DRAW_ID })),
    null,
  );
  assert.equal(
    parseSpinnerLiveResult({
      ...resultEnvelope(revealedSnapshot(), receipt),
      data: { ...resultEnvelope(revealedSnapshot(), receipt).data, serverNow: "not-a-date" },
    }),
    null,
  );
});

test("live timelines preserve a future start and respect every motion mode", () => {
  const snapshot = parseSpinnerLiveSnapshot(spinningSnapshot());
  assert.ok(snapshot);
  assert.deepEqual(spinnerLiveTimeline(snapshot, "2026-07-26T18:00:00.000Z", "full"), {
    startDelayMs: 180_000,
    revealDelayMs: 188_000,
    motionDurationMs: 8_000,
    motionDelayMs: 180_000,
  });
  assert.deepEqual(spinnerLiveTimeline(snapshot, "2026-07-26T18:00:00.000Z", "reduced"), {
    startDelayMs: 186_350,
    revealDelayMs: 188_000,
    motionDurationMs: 1_650,
    motionDelayMs: 186_350,
  });
  assert.deepEqual(spinnerLiveTimeline(snapshot, "2026-07-26T18:00:00.000Z", "off"), {
    startDelayMs: 188_000,
    revealDelayMs: 188_000,
    motionDurationMs: 0,
    motionDelayMs: 188_000,
  });
});

test("live timelines use the server clock for late joins and clock skew", () => {
  const snapshot = parseSpinnerLiveSnapshot(spinningSnapshot());
  assert.ok(snapshot);
  assert.deepEqual(spinnerLiveTimeline(snapshot, "2026-07-26T18:03:04.000Z", "full"), {
    startDelayMs: 0,
    revealDelayMs: 4_000,
    motionDurationMs: 8_000,
    motionDelayMs: -4_000,
  });
  assert.deepEqual(spinnerLiveTimeline(snapshot, "2026-07-26T18:03:10.000Z", "full"), {
    startDelayMs: 0,
    revealDelayMs: 0,
    motionDurationMs: 0,
    motionDelayMs: 0,
  });
  assert.deepEqual(spinnerLiveTimeline(snapshot, "2026-07-26T18:03:07.000Z", "reduced"), {
    startDelayMs: 0,
    revealDelayMs: 1_000,
    motionDurationMs: 1_650,
    motionDelayMs: -650,
  });
  assert.deepEqual(spinnerLiveTimeline(snapshot, "2026-07-26T18:03:04.000Z", "off"), {
    startDelayMs: 4_000,
    revealDelayMs: 4_000,
    motionDurationMs: 0,
    motionDelayMs: 4_000,
  });
});

test("countdown formatting follows the absolute server start from 03:00 through 00:00", () => {
  assert.equal(spinnerCountdownSeconds(STARTED_AT, Date.parse("2026-07-26T18:00:00.000Z")), 180);
  assert.equal(formatSpinnerCountdown(180), "03:00");
  assert.equal(spinnerCountdownSeconds(STARTED_AT, Date.parse("2026-07-26T18:00:01.000Z")), 179);
  assert.equal(formatSpinnerCountdown(179), "02:59");
  assert.equal(spinnerCountdownSeconds(STARTED_AT, Date.parse("2026-07-26T18:02:59.000Z")), 1);
  assert.equal(formatSpinnerCountdown(1), "00:01");
  assert.equal(spinnerCountdownSeconds(STARTED_AT, Date.parse(STARTED_AT)), 0);
  assert.equal(formatSpinnerCountdown(0), "00:00");
  assert.equal(spinnerCountdownSeconds(STARTED_AT, Date.parse("2026-07-26T18:03:04.000Z")), 0);
  assert.equal(spinnerCountdownSeconds(null, Date.parse(STARTED_AT)), 0);
  assert.equal(formatSpinnerCountdown(Number.NaN), "00:00");
});

test("monotonic server anchors ignore wall-clock jumps and react to fresh polling corrections", () => {
  const initial = createSpinnerServerClockAnchor("2026-07-26T18:00:00.000Z", 1_000);
  assert.ok(initial);
  assert.equal(spinnerServerClockNow(initial, 1_000), Date.parse("2026-07-26T18:00:00.000Z"));
  assert.equal(
    spinnerCountdownSeconds(STARTED_AT, spinnerServerClockNow(initial, 2_000)),
    179,
  );

  // Local Date changes are intentionally absent from the calculation. A fresh
  // poll replaces the reactive anchor and corrects the authoritative position.
  const jittered = reconcileSpinnerServerClockAnchor(
    initial,
    "2026-07-26T17:59:59.500Z",
    2_000,
  );
  assert.ok(jittered);
  assert.equal(
    spinnerServerClockNow(jittered, 2_000),
    Date.parse("2026-07-26T18:00:01.000Z"),
  );

  const corrected = reconcileSpinnerServerClockAnchor(
    jittered,
    "2026-07-26T18:00:02.250Z",
    3_500,
  );
  assert.ok(corrected);
  assert.equal(
    spinnerServerClockNow(corrected, 3_500),
    Date.parse("2026-07-26T18:00:02.500Z"),
  );
  assert.equal(
    spinnerCountdownSeconds(STARTED_AT, spinnerServerClockNow(corrected, 3_500)),
    178,
  );
  assert.equal(
    spinnerCountdownSeconds(STARTED_AT, spinnerServerClockNow(corrected, 4_750)),
    177,
  );
  assert.equal(spinnerServerClockNow(corrected, 500), corrected.serverNowMs);
  assert.equal(reconcileSpinnerServerClockAnchor(corrected, "not-a-clock", 5_000), corrected);
  assert.equal(createSpinnerServerClockAnchor("not-a-clock", 1), null);
  assert.equal(createSpinnerServerClockAnchor(SERVER_NOW, Number.NaN), null);
  assert.equal(Number.isNaN(spinnerServerClockNow(null, 1)), true);

  const snapshot = parseSpinnerLiveSnapshot(spinningSnapshot());
  assert.ok(snapshot);
  const atStart = createSpinnerServerClockAnchor(STARTED_AT, 10_000);
  const staleAtStart = reconcileSpinnerServerClockAnchor(
    atStart,
    "2026-07-26T18:02:59.500Z",
    10_000,
  );
  const authoritativeAtStartMs = spinnerServerClockNow(staleAtStart, 10_000);
  assert.equal(spinnerCountdownSeconds(STARTED_AT, authoritativeAtStartMs), 0);
  assert.equal(spinnerLiveTimeline(snapshot, authoritativeAtStartMs, "full").motionDelayMs, 0);

  const scheduled = spinnerServerClockAnchorForSnapshot(
    null,
    "2026-07-26T18:00:00.000Z",
    20_000,
    true,
  );
  assert.ok(scheduled);
  const sameSnapshotPoll = spinnerServerClockAnchorForSnapshot(
    scheduled,
    "2026-07-26T18:00:04.000Z",
    22_000,
    false,
  );
  assert.notEqual(sameSnapshotPoll, scheduled);
  const sameSnapshotNowMs = spinnerServerClockNow(sameSnapshotPoll, 22_000);
  assert.equal(spinnerCountdownSeconds(STARTED_AT, sameSnapshotNowMs), 176);
  assert.equal(spinnerLiveTimeline(snapshot, sameSnapshotNowMs, "full").motionDelayMs, 176_000);

  const recoveredPoll = spinnerServerClockAnchorForSnapshot(
    scheduled,
    "2026-07-26T18:00:04.000Z",
    22_000,
    true,
  );
  const recoveredNowMs = spinnerServerClockNow(recoveredPoll, 22_000);
  assert.equal(spinnerCountdownSeconds(STARTED_AT, recoveredNowMs), 176);
  assert.equal(spinnerLiveTimeline(snapshot, recoveredNowMs, "full").motionDelayMs, 176_000);
});

test("an unchanged v2 snapshot catches up after a suspended monotonic clock", () => {
  const snapshot = parseSpinnerLiveSnapshot(sequenceSnapshot());
  assert.ok(snapshot && snapshot.version === 2);
  const beforeSleep = createSpinnerServerClockAnchor("2026-07-26T18:00:00.000Z", 1_000);
  assert.ok(beforeSleep);
  const stalePresentation = spinnerSequencePresentation(
    snapshot,
    spinnerServerClockNow(beforeSleep, 2_000),
  );
  assert.equal(stalePresentation.stage, "countdown");

  const afterWake = spinnerServerClockAnchorForSnapshot(
    beforeSleep,
    "2026-07-26T18:01:11.000Z",
    2_000,
    false,
  );
  const caughtUp = spinnerSequencePresentation(
    snapshot,
    spinnerServerClockNow(afterWake, 2_000),
  );
  assert.equal(caughtUp.stage, "round-spinning");
  assert.equal(caughtUp.roundIndex, 2);
  assert.deepEqual(caughtUp.participants.map(({ id }) => id), [
    SEQUENCE_PARTICIPANTS[0].id,
    SEQUENCE_PARTICIPANTS[2].id,
  ]);
});

test("countdown polling remains normal until the authoritative start", () => {
  const snapshot = parseSpinnerLiveSnapshot(spinningSnapshot());
  assert.ok(snapshot);
  assert.equal(spinnerLivePollInterval(snapshot, "2026-07-26T18:00:00.000Z"), 2_000);
  assert.equal(spinnerLivePollInterval(snapshot, "2026-07-26T18:02:59.999Z"), 2_000);
  assert.equal(spinnerLivePollInterval(snapshot, STARTED_AT), 750);
  assert.equal(spinnerLivePollInterval(snapshot, "2026-07-26T18:03:04.000Z"), 750);

  const idle = parseSpinnerLiveSnapshot(idleSnapshot(PARTICIPANTS));
  assert.ok(idle);
  assert.equal(spinnerLivePollInterval(idle, "2026-07-26T18:04:00.000Z"), 2_000);
});

test("live polling failures back off with bounded jitter and reset-ready delays", () => {
  assert.equal(spinnerLiveErrorRetryDelay(1, 0.5), 2_500);
  assert.equal(spinnerLiveErrorRetryDelay(2, 0.5), 5_000);
  assert.equal(spinnerLiveErrorRetryDelay(3, 0.5), 10_000);
  assert.equal(spinnerLiveErrorRetryDelay(4, 0.5), 20_000);
  assert.equal(spinnerLiveErrorRetryDelay(5, 0.5), 30_000);
  assert.equal(spinnerLiveErrorRetryDelay(99, 1), 30_000);
  assert.equal(spinnerLiveErrorRetryDelay(1, 0), 2_000);
  assert.equal(spinnerLiveErrorRetryDelay(1, 1), 3_000);
  assert.equal(spinnerLiveErrorRetryDelay(Number.NaN, Number.NaN), 2_500);
});

test("draw announcements occur once per countdown and spin across refresh recovery", () => {
  const initial = { countdownDrawId: null, spinDrawId: null };
  const countdown = spinnerDrawAnnouncementTransition(DRAW_ID, true, initial);
  assert.equal(countdown.announcement, "The roster is locked. The moonwheel countdown is underway.");

  const recovered = spinnerDrawAnnouncementTransition(DRAW_ID, true, countdown.state);
  assert.equal(recovered.announcement, null);
  assert.deepEqual(recovered.state, countdown.state);

  const started = spinnerDrawAnnouncementTransition(DRAW_ID, false, recovered.state);
  assert.equal(started.announcement, "The shared draw is underway.");
  assert.equal(spinnerDrawAnnouncementTransition(DRAW_ID, false, started.state).announcement, null);

  const lateJoin = spinnerDrawAnnouncementTransition(OTHER_DRAW_ID, false, initial);
  assert.equal(lateJoin.announcement, "The shared draw is underway.");
  assert.equal(lateJoin.state.countdownDrawId, null);
});

test("Skip stays hidden until real wheel motion or celebration effects begin", () => {
  const base = {
    phase: "spinning" as const,
    wheelMotionDrawId: DRAW_ID,
    motionStartedDrawId: null,
    effectsActive: false,
  };
  assert.equal(spinnerSkipControlVisible(base), false);
  assert.equal(spinnerSkipControlVisible({ ...base, wheelMotionDrawId: null }), false);
  assert.equal(spinnerSkipControlVisible({ ...base, motionStartedDrawId: DRAW_ID }), true);
  assert.equal(spinnerSkipControlVisible({
    ...base,
    phase: "revealed",
    wheelMotionDrawId: null,
    effectsActive: true,
  }), true);
});

test("reduced motion removes full turns while preserving the exact landing angle", () => {
  const snapshot = parseSpinnerLiveSnapshot({
    ...spinningSnapshot(),
    startRotation: 45,
    finalRotation: 2_250,
  });
  assert.ok(snapshot);
  assert.deepEqual(spinnerLiveMotionRotations(snapshot, "full"), {
    startRotation: 45,
    finalRotation: 2_250,
  });
  assert.deepEqual(spinnerLiveMotionRotations(snapshot, "reduced"), {
    startRotation: 45,
    finalRotation: 90,
  });
  assert.equal(2_250 % 360, 90 % 360);
  assert.deepEqual(spinnerLiveMotionRotations(snapshot, "off"), {
    startRotation: 45,
    finalRotation: 45,
  });
});

test("secure command identifiers use canonical random UUID v4 shape", () => {
  const ids = new Set(Array.from({ length: 32 }, () => createSpinnerCommandId()));
  assert.equal(ids.size, 32);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
});

test("pending spin commands recover only valid stable identifiers", () => {
  const command = {
    version: 1,
    commandId: DRAW_ID,
    expectedRevision: 7,
    createdAt: SERVER_NOW,
    drawMode: "test",
  };
  assert.deepEqual(parsePendingSpinnerCommand(command), command);
  assert.equal(parsePendingSpinnerCommand({ ...command, commandId: "invalid" }), null);
  assert.equal(parsePendingSpinnerCommand({ ...command, expectedRevision: -1 }), null);
  assert.equal(parsePendingSpinnerCommand({ ...command, createdAt: "invalid" }), null);
  assert.equal(parsePendingSpinnerCommand({ ...command, drawMode: "unclassified" }), null);
  assert.equal(parsePendingSpinnerCommand({ ...command, drawMode: undefined }), null);
});

test("first-use viewer motion is full unless the operating system requests reduced motion", () => {
  assert.equal(resolveInitialViewerMotion(null, false), "full");
  assert.equal(resolveInitialViewerMotion(null, true), "reduced");
  assert.equal(resolveInitialViewerMotion("full", false), "full");
  assert.equal(resolveInitialViewerMotion("full", true), "reduced");
  assert.equal(resolveInitialViewerMotion("reduced", false), "reduced");
  assert.equal(resolveInitialViewerMotion("off", false), "off");
  assert.equal(resolveInitialViewerMotion("invalid", false), "full");
});

test("the default authoritative 4.8 second draw preserves full and reduced viewer timelines", () => {
  const snapshot = parseSpinnerLiveSnapshot({
    ...spinningSnapshot(),
    revealAt: "2026-07-26T18:03:04.800Z",
    durationMs: 4_800,
  });
  assert.ok(snapshot);
  assert.deepEqual(spinnerLiveTimeline(snapshot, STARTED_AT, "full"), {
    startDelayMs: 0,
    revealDelayMs: 4_800,
    motionDurationMs: 4_800,
    motionDelayMs: 0,
  });
  assert.deepEqual(spinnerLiveTimeline(snapshot, STARTED_AT, "reduced"), {
    startDelayMs: 3_150,
    revealDelayMs: 4_800,
    motionDurationMs: 1_650,
    motionDelayMs: 3_150,
  });
});

test("only an authoritative terminal spin failure permits a fresh command identifier", () => {
  const terminal = new SpinnerLiveRequestError(
    "That draw attempt was not retained.",
    409,
    "spin_result_not_durable",
  );
  const conflict = new SpinnerLiveRequestError("The live roster changed.", 409, "revision_conflict");

  assert.equal(isTerminalSpinnerSpinFailure(terminal), true);
  assert.equal(isTerminalSpinnerSpinFailure(conflict), false);
  assert.equal(isTerminalSpinnerSpinFailure(new Error("Network unavailable.")), false);
});

test("Skip remains attached to one draw across refresh and never leaks to the next draw", () => {
  assert.deepEqual(spinnerSkipStateForDraw({
    skipRequested: true,
    skippedDrawId: null,
    skippedCommandId: DRAW_ID,
    resultCommandId: DRAW_ID,
    drawId: DRAW_ID,
  }), { skipRequested: true, skippedDrawId: DRAW_ID, skippedCommandId: null });
  assert.deepEqual(spinnerSkipStateForDraw({
    skipRequested: true,
    skippedDrawId: DRAW_ID,
    skippedCommandId: null,
    resultCommandId: null,
    drawId: DRAW_ID,
  }), { skipRequested: true, skippedDrawId: DRAW_ID, skippedCommandId: null });
  assert.deepEqual(spinnerSkipStateForDraw({
    skipRequested: true,
    skippedDrawId: null,
    skippedCommandId: DRAW_ID,
    resultCommandId: DRAW_ID,
    drawId: OTHER_DRAW_ID,
  }), { skipRequested: true, skippedDrawId: OTHER_DRAW_ID, skippedCommandId: null });
  assert.deepEqual(spinnerSkipStateForDraw({
    skipRequested: true,
    skippedDrawId: DRAW_ID,
    skippedCommandId: null,
    resultCommandId: OTHER_DRAW_ID,
    drawId: OTHER_DRAW_ID,
  }), { skipRequested: false, skippedDrawId: null, skippedCommandId: null });
});

test("celebration scenes deterministically include every approved effect within exact budgets", () => {
  const expectedKinds = new Set([
    "paint-splash",
    "neon-stream",
    "ribbon",
    "petal",
    "bubble",
    "droplet",
    "streak",
    "firework",
    "star",
    "spark",
    "bloom",
  ]);
  const standard = createCelebrationScene({
    drawId: DRAW_ID,
    mode: "full",
    width: 1_280,
    height: 720,
  });
  const repeated = createCelebrationScene({
    drawId: DRAW_ID,
    mode: "full",
    width: 1_280,
    height: 720,
  });
  assert.ok(standard);
  assert.deepEqual(repeated, standard);
  assert.equal(standard.profile, "standard");
  assert.equal(standard.durationMs, 4_800);
  assert.equal(standard.particles.length, CELEBRATION_LIMITS.standard.maxParticles);
  assert.deepEqual(new Set(standard.particles.map((particle) => particle.kind)), expectedKinds);

  const differentDraw = createCelebrationScene({
    drawId: OTHER_DRAW_ID,
    mode: "full",
    width: 1_280,
    height: 720,
  });
  assert.ok(differentDraw);
  assert.notDeepEqual(differentDraw.particles, standard.particles);
});

test("celebration profiles enforce standard, compact, Reduced, and Off limits", () => {
  assert.equal(celebrationProfileForViewport("full", 1_280, 720), "standard");
  assert.equal(celebrationProfileForViewport("full", 759, 720), "compact");
  assert.equal(celebrationProfileForViewport("full", 1_280, 639), "compact");
  assert.equal(celebrationProfileForViewport("reduced", 1_280, 720), "reduced");
  assert.equal(celebrationProfileForViewport("off", 1_280, 720), null);

  const compact = createCelebrationScene({
    drawId: DRAW_ID,
    mode: "full",
    width: 720,
    height: 720,
  });
  const reduced = createCelebrationScene({
    drawId: DRAW_ID,
    mode: "reduced",
    width: 1_280,
    height: 720,
  });
  assert.ok(compact);
  assert.ok(reduced);
  assert.equal(compact.durationMs, 4_800);
  assert.equal(compact.particles.length, 96);
  assert.equal(compact.maxBackingPixels, 4_200_000);
  assert.equal(reduced.durationMs, 2_400);
  assert.equal(reduced.particles.length, 32);
  assert.equal(reduced.maxBackingPixels, 3_000_000);
  assert.equal(createCelebrationScene({
    drawId: DRAW_ID,
    mode: "off",
    width: 1_280,
    height: 720,
  }), null);
});

test("celebration canvas sizing caps pixel ratio and backing allocation", () => {
  const standard = celebrationCanvasMetrics(3_840, 2_160, 4, "standard");
  const compact = celebrationCanvasMetrics(1_920, 1_080, 3, "compact");
  const reduced = celebrationCanvasMetrics(2_560, 1_600, 3, "reduced");

  assert.ok(standard.dpr <= 2);
  assert.ok(standard.backingPixels <= 8_300_000);
  assert.ok(compact.backingPixels <= 4_200_000);
  assert.ok(reduced.backingPixels <= 3_000_000);
  assert.equal(celebrationCanvasMetrics(640, 480, 1, "standard").dpr, 1);
});

test("celebration motion and authoritative reveal timing fail toward less motion", () => {
  assert.equal(resolveCelebrationMotionMode("full", false), "full");
  assert.equal(resolveCelebrationMotionMode("full", true), "reduced");
  assert.equal(resolveCelebrationMotionMode("reduced", false), "reduced");
  assert.equal(resolveCelebrationMotionMode("off", false), "off");
  assert.equal(resolveCelebrationMotionMode("off", true), "off");

  assert.equal(celebrationElapsedMs(1_000, 2_250, 4_800), 1_250);
  assert.equal(celebrationElapsedMs(2_000, 1_000, 4_800), 0);
  assert.equal(celebrationElapsedMs(1_000, 9_000, 4_800), 4_800);
  assert.equal(celebrationElapsedMs(Number.NaN, 9_000, 4_800), 0);
});

test("celebration particle origins preserve the winner region", () => {
  const protectedRegion = { x: 360, y: 220, width: 560, height: 180 };
  const scene = createCelebrationScene({
    drawId: DRAW_ID,
    mode: "full",
    width: 1_280,
    height: 720,
    protectedRegion,
  });
  assert.ok(scene);
  assert.deepEqual(scene.protectedRegion, protectedRegion);
  for (const particle of scene.particles) {
    const inside = particle.x >= protectedRegion.x
      && particle.x <= protectedRegion.x + protectedRegion.width
      && particle.y >= protectedRegion.y
      && particle.y <= protectedRegion.y + protectedRegion.height;
    assert.equal(inside, false, `${particle.kind} originated inside the protected winner region`);
  }
});
