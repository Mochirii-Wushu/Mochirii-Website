import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ALGORITHM_VERSION,
  APP_VERSION,
  ELIMINATION_ALGORITHM_VERSION,
  ELIMINATION_APP_VERSION,
  ELIMINATION_ROUND_DURATION_MS,
  DrawAttempt,
  MAX_NAME_GRAPHEMES,
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  canonicalRosterPayload,
  countGraphemes,
  createDrawReceipt,
  createParticipant,
  hashRoster,
  moveParticipant,
  normalizeDisplayName,
  normalizedNameKey,
  parseBulkNames,
  parseStoredMotion,
  parseStoredReceipts,
  parseStoredRoster,
  renumberParticipants,
  sampleUniformIndex,
  secureRandomWord,
  segmentCenterDegrees,
  targetRotationDegrees,
  validateName,
  type DrawReceiptV1,
  type DrawReceiptV2,
  type ParticipantV1,
  type RosterStateV1,
  type RevealReason,
  // @ts-expect-error Node's type-stripping runner needs the explicit source extension.
} from "../apps/web/components/spinner/raffle.ts";

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function participant(index: number, displayName = `Wanderer ${index}`): ParticipantV1 {
  return { version: 1, id: uuid(index), displayName };
}

function roster(count = 3): RosterStateV1 {
  return {
    version: 1,
    participants: Array.from({ length: count }, (_, index) => participant(index + 1)),
  };
}

function eliminationReceipt(): DrawReceiptV2 {
  const rosterSnapshot = roster(3);
  return {
    version: 2,
    drawMode: "official",
    drawId: uuid(700),
    timestampIso: "2026-07-26T00:00:00.000Z",
    singaporeTime: "26 Jul 2026, 08:00:00 SGT",
    appVersion: ELIMINATION_APP_VERSION,
    algorithmVersion: ELIMINATION_ALGORITHM_VERSION,
    rosterSnapshot,
    rosterHashSha256: "a".repeat(64),
    planHashSha256: "b".repeat(64),
    durationMs: ELIMINATION_ROUND_DURATION_MS,
    startAt: "2026-07-26T00:01:00.000Z",
    revealAt: "2026-07-26T00:01:10.000Z",
    startRotation: 0,
    finalRotation: 2_280,
    rounds: [
      {
        roundIndex: 0,
        activeCount: 3,
        selectedIndex: 1,
        eliminatedId: uuid(2),
        eliminatedParticipant: participant(2),
        rejectionLimit: 4_294_967_295,
        sampledWords: [4_294_967_295, 1],
        acceptedWord: 1,
        startedAt: "2026-07-26T00:01:00.000Z",
        revealAt: "2026-07-26T00:01:05.000Z",
        startRotation: 0,
        finalRotation: 2_400,
      },
      {
        roundIndex: 1,
        activeCount: 2,
        selectedIndex: 0,
        eliminatedId: uuid(1),
        eliminatedParticipant: participant(1),
        rejectionLimit: 4_294_967_296,
        sampledWords: [0],
        acceptedWord: 0,
        startedAt: "2026-07-26T00:01:05.000Z",
        revealAt: "2026-07-26T00:01:10.000Z",
        startRotation: 240,
        finalRotation: 2_520,
      },
    ],
    selectedIndex: 2,
    winner: participant(3),
  };
}

test("normalizes NFKC names and counts Unicode grapheme clusters", () => {
  assert.equal(normalizeDisplayName("  Ａｌｉｃｅ  "), "Alice");
  assert.equal(countGraphemes("仙侠🌙"), 3);
  assert.equal(countGraphemes("👩🏽‍💻"), 1);
  assert.equal(normalizedNameKey("Straße"), normalizedNameKey("STRASSE"));
});

test("rejects empty, overlong, and case-insensitive duplicate names", () => {
  const current = [participant(1, "Mòchiríí"), participant(2, "Straße")];

  assert.deepEqual(validateName("   ", current), {
    valid: false,
    normalizedName: "",
    error: "Enter a name before adding it to the roster.",
  });
  assert.equal(validateName("mÒCHIRÍÍ", current).valid, false);
  assert.equal(validateName("STRASSE", current).valid, false);
  assert.equal(validateName("MÒCHIRÍÍ", current, current[0].id).valid, true);

  const tooLong = "莲".repeat(MAX_NAME_GRAPHEMES + 1);
  assert.equal(validateName(tooLong, current).valid, false);
  assert.equal(validateName("莲".repeat(MAX_NAME_GRAPHEMES), current).valid, true);
  assert.equal(validateName("月", current).valid, true);
  assert.equal(validateName("Jade\u202eLantern", current).valid, false);
  assert.equal(validateName("Jade\u0007Lantern", current).valid, false);
  assert.equal(validateName("👩🏽‍💻".repeat(14), current).valid, false);
});

test("enforces the 100-participant limit while allowing an edit at capacity", () => {
  const full = Array.from({ length: MAX_PARTICIPANTS }, (_, index) =>
    participant(index + 1),
  );
  assert.equal(validateName("One more", full).valid, false);
  assert.equal(validateName("Renamed", full, full[20].id).valid, true);
});

test("creates versioned participants and rejects non-UUID identifiers", () => {
  assert.deepEqual(createParticipant("  青莲  ", uuid(5)), {
    version: 1,
    id: uuid(5),
    displayName: "青莲",
  });
  assert.throws(() => createParticipant("青莲", "not-a-uuid"), /UUID/);
});

test("renumbers and reorders without mutating the source roster", () => {
  const source = [participant(1), participant(2), participant(3)];
  assert.deepEqual(
    renumberParticipants(source).map(({ number, displayName }) => ({
      number,
      displayName,
    })),
    [
      { number: 1, displayName: "Wanderer 1" },
      { number: 2, displayName: "Wanderer 2" },
      { number: 3, displayName: "Wanderer 3" },
    ],
  );

  const reordered = moveParticipant(source, 0, 2);
  assert.deepEqual(
    reordered.map(({ id }) => id),
    [uuid(2), uuid(3), uuid(1)],
  );
  assert.deepEqual(
    source.map(({ id }) => id),
    [uuid(1), uuid(2), uuid(3)],
  );
  assert.notStrictEqual(moveParticipant(source, -1, 2), source);
});

test("bulk parsing trims Unicode names and reports duplicates and bad entries", () => {
  const existing = [participant(1, "Jade Fox")];
  const result = parseBulkNames(
    `  Moon Rabbit\nJADE FOX\n${"花".repeat(41)}\n月;青莲\t星河, Moon Rabbit`,
    existing,
  );

  assert.deepEqual(result.names, ["Moon Rabbit", "月", "青莲", "星河"]);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join("\n"), /already on the roster/);
  assert.match(result.errors.join("\n"), /at most 40 characters/);
  assert.deepEqual(parseBulkNames(" \n , ; ").names, []);
  assert.match(parseBulkNames(" \n , ; ").errors[0], /No names/);
});

test("rejection sampling retries at the limit and preserves every sampled word", () => {
  const words = [0xffff_ffff, 2];
  let calls = 0;
  const result = sampleUniformIndex(3, () => {
    const word = words[calls];
    calls += 1;
    return word;
  });

  assert.equal(result.rejectionLimit, 0xffff_ffff);
  assert.deepEqual(result.sampledWords, words);
  assert.equal(result.acceptedWord, 2);
  assert.equal(result.index, 2);
  assert.equal(calls, 2);
});

test("rejection sampling accepts full uint32 boundaries for divisor counts", () => {
  assert.deepEqual(sampleUniformIndex(1, () => 0xffff_ffff), {
    index: 0,
    rejectionLimit: 0x1_0000_0000,
    sampledWords: [0xffff_ffff],
    acceptedWord: 0xffff_ffff,
  });
  assert.equal(sampleUniformIndex(4, () => 0xffff_ffff).index, 3);
  assert.equal(sampleUniformIndex(MAX_PARTICIPANTS, () => 0).index, 0);
  assert.throws(() => sampleUniformIndex(0, () => 0), /range/);
  assert.throws(() => sampleUniformIndex(MAX_PARTICIPANTS + 1, () => 0), /range/);
  assert.throws(() => sampleUniformIndex(2, () => -1), /unsigned 32-bit/);
  assert.throws(() => sampleUniformIndex(2, () => 0x1_0000_0000), /unsigned 32-bit/);
});

test("secure random words fail closed when secure randomness is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  if (!descriptor?.configurable) {
    return;
  }

  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });
    assert.throws(() => secureRandomWord(), /Secure randomness is unavailable/);
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
});

test("wheel geometry maps every selected segment center back to the top pointer", () => {
  const count = 7;
  for (let index = 0; index < count; index += 1) {
    const center = segmentCenterDegrees(index, count);
    const rotation = targetRotationDegrees(index, count, 6);
    const finalAngle = ((center + rotation) % 360 + 360) % 360;
    assert.ok(Math.abs(finalAngle) < 1e-10 || Math.abs(finalAngle - 360) < 1e-10);
  }
  assert.equal(segmentCenterDegrees(0, 2), 0);
  assert.equal(segmentCenterDegrees(1, 2), 180);
  assert.equal(targetRotationDegrees(1, 2, 6), 1_980);
  assert.throws(() => segmentCenterDegrees(2, 2), /outside/);
  assert.throws(() => targetRotationDegrees(0, 2, 0), /at least one/);
});

test("canonical roster hashing is ordered, versioned, and SHA-256 accurate", async () => {
  const source = roster(2);
  const payload = canonicalRosterPayload(source);
  assert.equal(
    payload,
    `{"version":1,"participants":[{"version":1,"id":"${uuid(1)}","displayName":"Wanderer 1"},{"version":1,"id":"${uuid(2)}","displayName":"Wanderer 2"}]}`,
  );

  const expected = createHash("sha256").update(payload).digest("hex");
  assert.equal(await hashRoster(source), expected);
  assert.notEqual(
    await hashRoster({ version: 1, participants: [...source.participants].reverse() }),
    expected,
  );
});

test("draw receipts freeze the roster and expose replayable rejection arithmetic", async () => {
  const source = roster(3);
  const words = [0xffff_ffff, 4];
  let randomCalls = 0;
  const pending = createDrawReceipt(
    source,
    () => {
      const word = words[randomCalls];
      randomCalls += 1;
      return word;
    },
    () => uuid(999),
    new Date("2026-07-26T12:34:56.000Z"),
  );

  source.participants[1].displayName = "Changed after spin";
  const receipt = await pending;

  assert.equal(receipt.version, 1);
  assert.equal(receipt.drawId, uuid(999));
  assert.equal(receipt.timestampIso, "2026-07-26T12:34:56.000Z");
  assert.match(receipt.singaporeTime, /26 Jul 2026/);
  assert.match(receipt.singaporeTime, /20:34:56/);
  assert.equal(receipt.appVersion, APP_VERSION);
  assert.equal(receipt.algorithmVersion, ALGORITHM_VERSION);
  assert.deepEqual(receipt.sampledWords, words);
  assert.equal(receipt.acceptedWord, 4);
  assert.equal(receipt.selectedIndex, 1);
  assert.equal(receipt.winner.displayName, "Wanderer 2");
  assert.equal(receipt.rosterSnapshot.participants[1].displayName, "Wanderer 2");
  assert.equal(randomCalls, 2);
  assert.equal(receipt.rosterHashSha256, await hashRoster(receipt.rosterSnapshot));
});

test("draw creation rejects ineligible and malformed rosters before sampling", async () => {
  let calls = 0;
  const randomWord = () => {
    calls += 1;
    return 0;
  };

  await assert.rejects(
    createDrawReceipt(roster(MIN_PARTICIPANTS - 1), randomWord),
    /range/,
  );
  await assert.rejects(
    createDrawReceipt(roster(MAX_PARTICIPANTS + 1), randomWord),
    /range/,
  );
  const duplicate = roster(2);
  duplicate.participants[1].displayName = duplicate.participants[0].displayName;
  await assert.rejects(createDrawReceipt(duplicate, randomWord), /duplicate/);
  assert.equal(calls, 0);
});

test("receipt preflight failures cannot strand a sampled winner", async () => {
  let calls = 0;
  const randomWord = () => {
    calls += 1;
    return 0;
  };

  await assert.rejects(
    createDrawReceipt(
      roster(2),
      randomWord,
      () => "",
      new Date("2026-07-26T00:00:00.000Z"),
    ),
    /draw ID/i,
  );
  await assert.rejects(
    createDrawReceipt(
      roster(2),
      randomWord,
      () => uuid(88),
      new Date(Number.NaN),
    ),
    /timestamp/i,
  );
  assert.equal(calls, 0);

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  if (!descriptor?.configurable) return;

  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        subtle: {
          digest: async () => {
            throw new Error("Hashing failed");
          },
        },
      },
    });
    await assert.rejects(
      createDrawReceipt(roster(2), randomWord, () => uuid(89)),
      /Hashing failed/,
    );
    assert.equal(calls, 0);
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
});

test("every reveal exit reuses one draw attempt and never resamples", async () => {
  const reasons: RevealReason[] = [
    "animation-complete",
    "animation-error",
    "off",
    "reduced",
    "skip",
    "visibility-hidden",
  ];

  for (const reason of reasons) {
    const attempt = new DrawAttempt<{ winner: string }>();
    const selected = { winner: "Moon Rabbit" };
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls += 1;
      return selected;
    };

    const first = attempt.begin(factory);
    const repeatedClick = attempt.begin(factory);
    assert.strictEqual(first, repeatedClick);
    assert.strictEqual(await first, selected);
    assert.equal(factoryCalls, 1);
    assert.equal(attempt.active, true);
    assert.equal(attempt.ready, true);
    assert.strictEqual(attempt.reveal(reason), selected);
    assert.strictEqual(attempt.reveal("animation-error"), selected);
    assert.equal(attempt.lastRevealReason, reason);
    assert.equal(factoryCalls, 1);

    attempt.reset();
    assert.equal(attempt.active, false);
    assert.equal(attempt.ready, false);
    assert.equal(attempt.reveal(reason), null);
  }
});

test("stored roster parsing clones valid Unicode state and fails closed", () => {
  const valid: RosterStateV1 = {
    version: 1,
    participants: [participant(1, "青莲"), participant(2, "👩🏽‍💻 Moon")],
  };
  const parsed = parseStoredRoster(JSON.stringify(valid));
  assert.deepEqual(parsed, valid);
  assert.notStrictEqual(parsed, valid);
  assert.notStrictEqual(parsed.participants[0], valid.participants[0]);

  assert.deepEqual(parseStoredRoster("not json"), { version: 1, participants: [] });
  assert.deepEqual(
    parseStoredRoster({ ...valid, version: 2 }),
    { version: 1, participants: [] },
  );
  assert.deepEqual(
    parseStoredRoster({
      version: 1,
      participants: [participant(1, "Moon"), participant(2, "moon")],
    }),
    { version: 1, participants: [] },
  );
  assert.deepEqual(parseStoredRoster(roster(MAX_PARTICIPANTS + 1)), {
    version: 1,
    participants: [],
  });
});

test("stored motion parsing supports the versioned settings envelope", () => {
  assert.equal(parseStoredMotion("reduced"), "reduced");
  assert.equal(parseStoredMotion(JSON.stringify({ version: 1, motionMode: "off" })), "off");
  assert.equal(parseStoredMotion({ version: 1, motionMode: "full" }), "full");
  assert.equal(parseStoredMotion({ version: 2, motionMode: "off" }), "full");
  assert.equal(parseStoredMotion("broken"), "full");
});

test("stored receipts discard corrupted entries and cap history at the latest 100", async () => {
  const base = await createDrawReceipt(
    roster(2),
    () => 1,
    () => uuid(500),
    new Date("2026-07-26T00:00:00.000Z"),
  );
  const history: DrawReceiptV1[] = Array.from({ length: 105 }, (_, index) => ({
    ...base,
    drawId: `draw-${index}`,
    sampledWords: [...base.sampledWords],
    rosterSnapshot: {
      version: 1,
      participants: base.rosterSnapshot.participants.map((entry) => ({ ...entry })),
    },
    winner: { ...base.winner },
  }));

  const parsed = parseStoredReceipts(
    JSON.stringify({ version: 1, receipts: history }),
  );
  assert.equal(parsed.length, 100);
  assert.equal(parsed[0].drawId, "draw-0");
  assert.equal(parsed[99].drawId, "draw-99");
  assert.notStrictEqual(parsed[0], history[0]);

  const tampered = { ...base, selectedIndex: 0 };
  assert.deepEqual(parseStoredReceipts([tampered]), []);
  assert.deepEqual(parseStoredReceipts("not json"), []);
  assert.deepEqual(parseStoredReceipts({ version: 2, receipts: history }), []);
});

test("stored v2 receipts validate the complete shrinking-roster elimination chain", () => {
  const source = eliminationReceipt();
  const parsed = parseStoredReceipts([source]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.version, 2);
  assert.notStrictEqual(parsed[0], source);
  if (parsed[0]?.version !== 2) assert.fail("Expected a v2 receipt.");
  assert.equal(parsed[0].rounds.length, source.rosterSnapshot.participants.length - 1);
  assert.deepEqual(parsed[0].rosterSnapshot, source.rosterSnapshot);
  assert.equal(parsed[0].winner.id, uuid(3));

  const duplicateElimination = structuredClone(source);
  duplicateElimination.rounds[1].eliminatedId = uuid(2);
  duplicateElimination.rounds[1].eliminatedParticipant = participant(2);
  assert.deepEqual(parseStoredReceipts([duplicateElimination]), []);

  const timingDrift = structuredClone(source);
  timingDrift.rounds[1].startedAt = "2026-07-26T00:01:05.001Z";
  assert.deepEqual(parseStoredReceipts([timingDrift]), []);

  const brokenStart = structuredClone(source);
  brokenStart.rounds[0].startRotation = 1;
  assert.deepEqual(parseStoredReceipts([brokenStart]), []);

  const wrongSample = structuredClone(source);
  wrongSample.rounds[0].acceptedWord = 2;
  wrongSample.rounds[0].sampledWords[wrongSample.rounds[0].sampledWords.length - 1] = 2;
  assert.deepEqual(parseStoredReceipts([wrongSample]), []);

  const earlyWinner = structuredClone(source);
  earlyWinner.winner = participant(1);
  earlyWinner.selectedIndex = 0;
  assert.deepEqual(parseStoredReceipts([earlyWinner]), []);

  assert.deepEqual(parseStoredReceipts([{ ...source, appVersion: APP_VERSION }]), []);
});
