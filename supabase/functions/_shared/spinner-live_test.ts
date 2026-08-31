import {
  buildDiscordOutboxPayloads,
  buildSnapshotResponseData,
  canonicalDrawPlanPayload,
  canonicalRosterPayload,
  createLiveDrawPlan,
  normalizeDisplayName,
  normalizeDurationMs,
  normalizeParticipants,
  type ParticipantV1,
  readBoundedSpinnerJsonObject,
  sampleUniformIndex,
  sanitizeDiscordDisplayName,
  serializeSnapshot,
  sha256Hex,
  SPINNER_APP_VERSION,
  SPINNER_DISCORD_CHANNEL_ID,
  SPINNER_LIVE_URL,
  SPINNER_MAX_COMMAND_BODY_BYTES,
  SPINNER_ROUND_DURATION_MS,
} from "./spinner-live.ts";
import {
  isActiveVerifiedGuildMember,
  moderatorAuthorizationIsCurrent,
  requestedSpinnerAccessMode,
  resolveModeratorAuthorizationRoute,
} from "./spinner-authority.ts";
import {
  constantTimeSecretEqual,
  dispatchSpinnerOutboxRow,
  type FinishSpinnerOutboxClaim,
  readBoundedJsonObject,
  type SpinnerOutboxRow,
} from "./spinner-discord-outbox.ts";
import { withProtectedCors } from "./cors.ts";

const PARTICIPANTS: ParticipantV1[] = [
  {
    version: 1,
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "月影",
  },
  {
    version: 1,
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "Lotus 🌸",
  },
  {
    version: 1,
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "Jade",
  },
];

Deno.test("live roster normalization supports clear and one-name editing while rejecting duplicates", () => {
  assertEquals(normalizeParticipants([]), []);
  assertEquals(
    normalizeParticipants(PARTICIPANTS.slice(0, 1)),
    PARTICIPANTS.slice(0, 1),
  );
  assertEquals(normalizeParticipants(PARTICIPANTS), PARTICIPANTS);
  assertThrows(() =>
    normalizeParticipants([
      ...PARTICIPANTS,
      {
        version: 1,
        id: "44444444-4444-4444-8444-444444444444",
        displayName: "  jade  ",
      },
    ]), "case-insensitive duplicate should fail");
});

Deno.test("live roster normalization matches the browser Unicode and whitespace contract", () => {
  assertEquals(normalizeDisplayName("  Ａｌｉｃｅ  "), "Alice");
  assertEquals(normalizeDisplayName("A   B"), "A   B");
  assertThrows(() =>
    normalizeParticipants([
      {
        version: 1,
        id: "44444444-4444-4444-8444-444444444444",
        displayName: "Straße",
      },
      {
        version: 1,
        id: "55555555-5555-4555-8555-555555555555",
        displayName: "STRASSE",
      },
    ]), "Unicode case-folding duplicates should fail");
  assertThrows(() =>
    normalizeParticipants([
      {
        version: 1,
        id: "66666666-6666-4666-8666-666666666666",
        displayName: "Ａｌｉｃｅ",
      },
      {
        version: 1,
        id: "77777777-7777-4777-8777-777777777777",
        displayName: "Alice",
      },
    ]), "compatibility-equivalent duplicates should fail");
  assertThrows(() =>
    normalizeParticipants([{
      version: 1,
      id: "88888888-8888-4888-8888-888888888888",
      displayName: 123,
    }]), "non-string display names should fail");
  assertEquals(normalizeParticipants([{
    version: 1,
    id: "99999999-9999-4999-8999-999999999999",
    displayName: "月",
  }])[0].displayName, "月");
  assertThrows(() => normalizeParticipants([{
    version: 1,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    displayName: "Jade\u202eLantern",
  }]), "bidirectional controls should fail");
  assertThrows(() => normalizeParticipants([{
    version: 1,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    displayName: "Jade\u0007Lantern",
  }]), "control characters should fail");
  assertThrows(() => normalizeParticipants([{
    version: 1,
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    displayName: "👩🏽‍💻".repeat(14),
  }]), "names exceeding the shared code-point bound should fail");
});

Deno.test("drawing still requires at least two live participants", async () => {
  await assertRejects(
    () => createLiveDrawPlan(PARTICIPANTS.slice(0, 1), { randomWord: () => 0 }),
    "one participant must not produce a draw",
  );
});

Deno.test("the fixed round duration rejects controller timing overrides", () => {
  assertEquals(normalizeDurationMs(undefined), 5_000);
  assertEquals(normalizeDurationMs(5_000), 5_000);
  assertThrows(
    () => normalizeDurationMs(4_800),
    "the retired wheel duration must not be accepted",
  );
  assertThrows(
    () => normalizeDurationMs(8_000),
    "a controller must not lengthen a round",
  );
});

Deno.test("a maximum roster produces exactly ninety-nine ordered eliminations", async () => {
  const roster: ParticipantV1[] = Array.from({ length: 100 }, (_, index) => ({
    version: 1,
    id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
    displayName: `Member ${index + 1}`,
  }));
  let sampled = 0;
  const plan = await createLiveDrawPlan(roster, {
    randomWord: () => {
      sampled += 1;
      return 0;
    },
    uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assertEquals(sampled, 99);
  assertEquals(plan.receipt.rounds.length, 99);
  assertEquals(
    plan.receipt.rounds.map(({ activeCount }) => activeCount),
    Array.from({ length: 99 }, (_, index) => 100 - index),
  );
  assertEquals(plan.receipt.selectedIndex, 99);
  assertEquals(plan.receipt.winner, roster[99]);
  const controllerPayloadBytes = new TextEncoder().encode(JSON.stringify({
    receipt: plan.receipt,
    rounds: plan.receipt.rounds,
    planHashSha256: plan.planHashSha256,
  })).byteLength;
  if (controllerPayloadBytes >= 256 * 1_024) {
    throw new Error(`Maximum controller payload is ${controllerPayloadBytes} bytes.`);
  }
});

Deno.test("secure uint32 selection records rejection retries without modulo bias", () => {
  const words = [0xffff_ffff, 42];
  let calls = 0;
  const result = sampleUniformIndex(100, () => {
    calls += 1;
    return words.shift()!;
  });
  assertEquals(result.rejectionLimit, 4_294_967_200);
  assertEquals(result.sampledWords, [0xffff_ffff, 42]);
  assertEquals(result.acceptedWord, 42);
  assertEquals(result.index, 42);
  assertEquals(calls, 2);
});

Deno.test("one live draw plan freezes every elimination round before staging", async () => {
  const now = new Date("2026-07-26T12:34:56.000Z");
  const words = [4, 1];
  let calls = 0;
  const result = await createLiveDrawPlan(PARTICIPANTS, {
    now,
    startRotation: 315,
    uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    randomWord: () => {
      calls += 1;
      return words.shift()!;
    },
  });
  const expectedHash = await sha256Hex(canonicalRosterPayload(PARTICIPANTS));

  assertEquals(calls, 2);
  assertEquals(result.startAt, "2026-07-26T12:35:56.000Z");
  assertEquals(result.revealAt, "2026-07-26T12:36:06.000Z");
  assertEquals(result.durationMs, SPINNER_ROUND_DURATION_MS);
  assertEquals(result.receipt.version, 2);
  assertEquals(result.receipt.appVersion, SPINNER_APP_VERSION);
  assertEquals(result.receipt.rosterSnapshot, {
    version: 1,
    participants: PARTICIPANTS,
  });
  assertEquals(result.receipt.rosterHashSha256, expectedHash);
  assertEquals(result.receipt.rounds, [
    {
      roundIndex: 0,
      activeCount: 3,
      selectedIndex: 1,
      eliminatedId: PARTICIPANTS[1].id,
      eliminatedParticipant: PARTICIPANTS[1],
      rejectionLimit: 4_294_967_295,
      sampledWords: [4],
      acceptedWord: 4,
      startedAt: "2026-07-26T12:35:56.000Z",
      revealAt: "2026-07-26T12:36:01.000Z",
      startRotation: 315,
      finalRotation: 2_760,
    },
    {
      roundIndex: 1,
      activeCount: 2,
      selectedIndex: 1,
      eliminatedId: PARTICIPANTS[2].id,
      eliminatedParticipant: PARTICIPANTS[2],
      rejectionLimit: 4_294_967_296,
      sampledWords: [1],
      acceptedWord: 1,
      startedAt: "2026-07-26T12:36:01.000Z",
      revealAt: "2026-07-26T12:36:06.000Z",
      startRotation: 240,
      finalRotation: 2_700,
    },
  ]);
  assertEquals(result.receipt.selectedIndex, 0);
  assertEquals(result.receipt.winner, PARTICIPANTS[0]);
  assertEquals(result.startRotation, 315);
  assertEquals(result.finalRotation, 2_520);
  assertEquals(result.receipt.planHashSha256, result.planHashSha256);
  assertEquals(
    result.planHashSha256,
    await sha256Hex(canonicalDrawPlanPayload(result.receipt)),
  );
  const finalAngle =
    (result.receipt.selectedIndex * 120 + result.finalRotation) % 360;
  assertEquals(finalAngle, 0);
});

Deno.test("repeated live spins keep rotations bounded and preserve winner geometry", async () => {
  const first = await createLiveDrawPlan(PARTICIPANTS, {
    startRotation: 99_315,
    randomWord: () => 1,
    uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const second = await createLiveDrawPlan(PARTICIPANTS, {
    startRotation: first.finalRotation,
    randomWord: () => 2,
    uuidFactory: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });

  assertEquals(first.startRotation, 315);
  assertEquals(first.finalRotation, 2_520);
  assertEquals(second.startRotation, 0);
  assertEquals(second.finalRotation, 2_400);
  assert(first.finalRotation < 2_880, "first rotation should remain bounded");
  assert(second.finalRotation < 2_880, "second rotation should remain bounded");
  assertEquals(
    (first.receipt.selectedIndex * 120 + first.finalRotation) % 360,
    0,
  );
  assertEquals(
    (second.receipt.selectedIndex * 120 + second.finalRotation) % 360,
    0,
  );
});

Deno.test("the one-minute lead is followed by contiguous five-second rounds", async () => {
  const result = await createLiveDrawPlan(PARTICIPANTS, {
    now: new Date("2026-07-26T12:34:56.000Z"),
    uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    randomWord: () => 0,
  });
  assertEquals(result.durationMs, 5_000);
  assertEquals(result.startAt, "2026-07-26T12:35:56.000Z");
  assertEquals(result.revealAt, "2026-07-26T12:36:06.000Z");
  assertEquals(result.receipt.rounds.length, PARTICIPANTS.length - 1);
  assertEquals(
    result.receipt.rounds[0].revealAt,
    result.receipt.rounds[1].startedAt,
  );
});

Deno.test("Discord outbox uses the raffle channel, live page, one safe message contract, and no mentions", async () => {
  const malicious = [
    PARTICIPANTS[0],
    {
      version: 1 as const,
      id: PARTICIPANTS[1].id,
      displayName: "<@123> @everyone **X**",
    },
  ];
  const { receipt, startAt } = await createLiveDrawPlan(malicious, {
    now: new Date("2026-07-26T12:34:56.000Z"),
    randomWord: () => 1,
    uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const outbox = buildDiscordOutboxPayloads(receipt, startAt);
  const start = outbox.startPayload as Record<string, unknown>;
  const result = outbox.resultPayload as Record<string, unknown>;
  const startMentions = start.allowed_mentions as Record<string, unknown>;
  const resultMentions = result.allowed_mentions as Record<string, unknown>;

  assertEquals(outbox.channelId, SPINNER_DISCORD_CHANNEL_ID);
  assertEquals(
    start.content,
    `A Mōchirīī monthly guild raffle begins <t:1785069356:R>.\nWatch the moonwheel live: ${SPINNER_LIVE_URL}`,
  );
  assert(
    !String(result.content).includes("<@"),
    "result should neutralize mention syntax",
  );
  assert(
    !String(result.content).includes("@everyone"),
    "result should neutralize mass mentions",
  );
  assertEquals(startMentions.parse, []);
  assertEquals(startMentions.users, []);
  assertEquals(startMentions.roles, []);
  assertEquals(startMentions.replied_user, false);
  assertEquals(resultMentions, startMentions);
  assertEquals(sanitizeDiscordDisplayName("<@123> @here"), "‹＠123› ＠here");
});

Deno.test("viewer snapshots withhold winner fields until the authoritative reveal time", () => {
  const raw = {
    version: 1,
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revision: 4,
    phase: "spinning",
    drawMode: "official",
    participants: PARTICIPANTS,
    startedAt: "2026-07-26T12:00:02.000Z",
    revealAt: "2026-07-26T12:00:10.000Z",
    durationMs: 8_000,
    startRotation: 0,
    finalRotation: 2_040,
    selectedIndex: 1,
    winner: PARTICIPANTS[1],
    drawId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    updatedAt: "2026-07-26T12:00:00.000Z",
  };
  const spinning = serializeSnapshot(raw, new Date("2026-07-26T12:00:05.000Z"));
  const revealed = serializeSnapshot(raw, new Date("2026-07-26T12:00:11.000Z"));
  assertEquals(spinning.phase, "spinning");
  assertEquals(spinning.selectedIndex, null);
  assertEquals(spinning.winner, null);
  assertEquals(revealed.phase, "revealed");
  assertEquals(revealed.selectedIndex, 1);
  assertEquals(revealed.winner, PARTICIPANTS[1]);
});

Deno.test("v2 snapshots validate the frozen round chain and trust the database phase", async () => {
  const plan = await createLiveDrawPlan(PARTICIPANTS, {
    now: new Date("2026-07-26T12:34:56.000Z"),
    randomWord: () => 0,
    uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const rounds = plan.receipt.rounds.map((round) => ({
    roundIndex: round.roundIndex,
    selectedIndex: round.selectedIndex,
    eliminatedId: round.eliminatedId,
    startedAt: round.startedAt,
    revealAt: round.revealAt,
    startRotation: round.startRotation,
    finalRotation: round.finalRotation,
  }));
  const spinningRow = {
    version: 2,
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    revision: 4,
    phase: "spinning",
    drawMode: "official",
    participants: PARTICIPANTS,
    startedAt: plan.startAt,
    revealAt: plan.revealAt,
    durationMs: 5_000,
    startRotation: plan.startRotation,
    finalRotation: plan.finalRotation,
    planHashSha256: plan.planHashSha256,
    rounds,
    selectedIndex: null,
    winner: null,
    drawId: plan.receipt.drawId,
    updatedAt: "2026-07-26T12:34:56.000Z",
  };

  const spinning = serializeSnapshot(
    spinningRow,
    new Date("2026-07-26T12:40:00.000Z"),
  );
  assert(spinning.version === 2, "the v2 row must remain a v2 snapshot");
  assertEquals(spinning.phase, "spinning");
  assertEquals(spinning.selectedIndex, null);
  assertEquals(spinning.winner, null);
  assertEquals(spinning.rounds, rounds);

  const revealed = serializeSnapshot({
    ...spinningRow,
    phase: "revealed",
    selectedIndex: plan.receipt.selectedIndex,
    winner: plan.receipt.winner,
  });
  assertEquals(revealed.phase, "revealed");
  assertEquals(revealed.selectedIndex, plan.receipt.selectedIndex);
  assertEquals(revealed.winner, plan.receipt.winner);
  assertThrows(
    () =>
      serializeSnapshot({
        ...spinningRow,
        rounds: [
          { ...rounds[0], eliminatedId: PARTICIPANTS[2].id },
          rounds[1],
        ],
      }),
    "a round cannot eliminate a participant outside its selected position",
  );
});

Deno.test("controller polling can recover the current receipt while viewer polling cannot", async () => {
  const { receipt } = await createLiveDrawPlan(PARTICIPANTS, {
    now: new Date("2026-07-26T12:34:56.000Z"),
    randomWord: () => 1,
    uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const snapshot = serializeSnapshot({
    version: 1,
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    revision: 1,
    phase: "revealed",
    drawMode: "official",
    participants: PARTICIPANTS,
    startedAt: "2026-07-26T12:34:58.000Z",
    revealAt: "2026-07-26T12:35:02.800Z",
    durationMs: 4_800,
    startRotation: 0,
    finalRotation: 2_040,
    selectedIndex: 1,
    winner: PARTICIPANTS[1],
    drawId: receipt.drawId,
    updatedAt: "2026-07-26T12:35:02.800Z",
  });
  const controller = buildSnapshotResponseData(
    "controller",
    snapshot,
    "2026-07-26T12:35:03.000Z",
    receipt,
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );
  const viewer = buildSnapshotResponseData(
    "viewer",
    snapshot,
    "2026-07-26T12:35:03.000Z",
    receipt,
  );
  assertEquals(controller.receipt, receipt);
  assertEquals(
    controller.commandId,
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );
  assertEquals("receipt" in viewer, false);
  assertEquals("commandId" in viewer, false);
});

Deno.test("viewer authority accepts only active, recently verified guild members", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  const active = {
    member_status: "active",
    discord_user_id: "111111111111111111",
    discord_verified_at: "2026-07-25T12:00:00.000Z",
  };
  assertEquals(
    isActiveVerifiedGuildMember(
      active,
      null,
      "111111111111111111",
      now,
    ),
    true,
  );
  assertEquals(
    isActiveVerifiedGuildMember(
      { ...active, member_status: "pending" },
      null,
      "111111111111111111",
      now,
    ),
    false,
  );
  assertEquals(
    isActiveVerifiedGuildMember(
      { ...active, discord_verified_at: "2026-07-18T11:59:59.000Z" },
      null,
      "111111111111111111",
      now,
    ),
    false,
  );
  assertEquals(
    isActiveVerifiedGuildMember(
      { ...active, discord_verified_at: "2026-07-27T12:00:00.000Z" },
      null,
      "111111111111111111",
      now,
    ),
    false,
  );
  assertEquals(
    isActiveVerifiedGuildMember(
      { member_status: "active", discord_verified_at: null },
      {
        gallery_access_status: "approved",
        gallery_access_verified_at: "2026-07-20T12:00:00.000Z",
        gallery_access_expires_at: "2026-08-20T12:00:00.000Z",
      },
      null,
      now,
    ),
    true,
  );
  assertEquals(
    isActiveVerifiedGuildMember(
      { member_status: "active", discord_verified_at: null },
      {
        gallery_access_status: "approved",
        gallery_access_verified_at: "2026-07-20T12:00:00.000Z",
        gallery_access_expires_at: "2026-07-25T12:00:00.000Z",
      },
      null,
      now,
    ),
    false,
  );
  assertEquals(
    isActiveVerifiedGuildMember(
      active,
      null,
      "222222222222222222",
      now,
    ),
    false,
  );
  assertEquals(isActiveVerifiedGuildMember(active, null, null, now), false);
  assertEquals(
    isActiveVerifiedGuildMember(
      active,
      {
        gallery_access_status: "approved",
        gallery_access_verified_at: "2026-07-20T12:00:00.000Z",
        gallery_access_expires_at: "2026-08-20T12:00:00.000Z",
      },
      "222222222222222222",
      now,
    ),
    true,
  );
});

Deno.test("live polling defaults to viewer authority and opts into moderator checks explicitly", () => {
  assertEquals(
    requestedSpinnerAccessMode(new Request("https://example.invalid")),
    "viewer",
  );
  assertEquals(
    requestedSpinnerAccessMode(
      new Request("https://example.invalid", {
        headers: { "x-mochirii-spinner-mode": "viewer" },
      }),
    ),
    "viewer",
  );
  assertEquals(
    requestedSpinnerAccessMode(
      new Request("https://example.invalid", {
        headers: { "x-mochirii-spinner-mode": "controller" },
      }),
    ),
    "controller",
  );
});

Deno.test("moderator polling cache expires at the five-minute revocation boundary", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  assertEquals(
    moderatorAuthorizationIsCurrent("2026-07-26T12:05:00.000Z", now),
    true,
  );
  assertEquals(
    moderatorAuthorizationIsCurrent("2026-07-26T12:05:00.001Z", now),
    false,
  );
  assertEquals(
    moderatorAuthorizationIsCurrent("2026-07-26T12:00:00.000Z", now),
    false,
  );
});

Deno.test("POST controller authorization uses current cache and exact fallback at missing or expired boundaries", async () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  let exactChecks = 0;
  assertEquals(
    await resolveModeratorAuthorizationRoute(
      "2026-07-26T12:05:00.000Z",
      () => {
        exactChecks += 1;
        return Promise.resolve(false);
      },
      now,
    ),
    "cached",
  );
  assertEquals(exactChecks, 0);

  assertEquals(
    await resolveModeratorAuthorizationRoute(
      null,
      () => {
        exactChecks += 1;
        return Promise.resolve(true);
      },
      now,
    ),
    "verified",
  );
  assertEquals(exactChecks, 1);

  assertEquals(
    await resolveModeratorAuthorizationRoute(
      "2026-07-26T12:00:00.000Z",
      () => {
        exactChecks += 1;
        return Promise.resolve(false);
      },
      now,
    ),
    "denied",
  );
  assertEquals(exactChecks, 2);

  assertEquals(
    await resolveModeratorAuthorizationRoute(
      "malformed-expiry",
      () => {
        exactChecks += 1;
        return Promise.reject(new Error("authority unavailable"));
      },
      now,
    ),
    "denied",
  );
  assertEquals(exactChecks, 3);
});

Deno.test("spinner command JSON accepts the 64 KiB boundary and rejects declared or streamed overflow", async () => {
  const overhead = new TextEncoder().encode('{"v":""}').byteLength;
  const exactBody = JSON.stringify({
    v: "x".repeat(SPINNER_MAX_COMMAND_BODY_BYTES - overhead),
  });
  assertEquals(
    new TextEncoder().encode(exactBody).byteLength,
    SPINNER_MAX_COMMAND_BODY_BYTES,
  );
  const exact = await readBoundedSpinnerJsonObject(
    new Request("https://example.invalid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: exactBody,
    }),
  );
  assert(exact.ok, "an exact-boundary JSON object should be accepted");

  const declaredOverflow = await readBoundedSpinnerJsonObject(
    new Request("https://example.invalid", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(SPINNER_MAX_COMMAND_BODY_BYTES + 1),
      },
      body: "{}",
    }),
  );
  assertEquals(declaredOverflow, { ok: false, status: 413 });

  const streamedOverflow = await readBoundedSpinnerJsonObject(
    new Request("https://example.invalid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(SPINNER_MAX_COMMAND_BODY_BYTES + 1),
    }),
  );
  assertEquals(streamedOverflow, { ok: false, status: 413 });

  const malformedLength = await readBoundedSpinnerJsonObject(
    new Request("https://example.invalid", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "not-a-length",
      },
      body: "{}",
    }),
  );
  assertEquals(malformedLength, { ok: false, status: 400 });

  const wrongMediaType = await readBoundedSpinnerJsonObject(
    new Request("https://example.invalid", {
      method: "POST",
      headers: { "content-type": "text/application/json" },
      body: "{}",
    }),
  );
  assertEquals(wrongMediaType, { ok: false, status: 400 });
});

Deno.test("spinner polling preserves authorization and mode variance when CORS adds origin", async () => {
  const response = await withProtectedCors(
    new Request("https://example.invalid", {
      headers: { origin: "https://mochirii.com" },
    }),
    new Response("{}", {
      headers: {
        Vary: "Authorization, X-Mochirii-Spinner-Mode",
      },
    }),
  );
  assertEquals(
    response.headers.get("vary"),
    "Authorization, X-Mochirii-Spinner-Mode, Origin",
  );
});

Deno.test("Reaper posts the scheduled handoff once with an enforced nonce, then edits that same message", async () => {
  const { receipt, startAt } = await createLiveDrawPlan(PARTICIPANTS, {
    now: new Date("2026-07-26T12:34:56.000Z"),
    randomWord: () => 1,
    uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const payloads = buildDiscordOutboxPayloads(receipt, startAt);
  const calls: Array<
    { path: string; method: string; body: Record<string, unknown> }
  > = [];
  const finishes: Array<{ outcome: string; messageId?: string }> = [];
  const finishClaim: FinishSpinnerOutboxClaim = (
    _row,
    outcome,
    fields = {},
  ) => {
    finishes.push({ outcome, messageId: fields.messageId });
    return Promise.resolve(true);
  };
  const startRow = outboxRow(
    "start_pending",
    payloads.startPayload,
    payloads.resultPayload,
  );
  const start = await dispatchSpinnerOutboxRow(startRow, {
    discordFetch: (path, options) => {
      calls.push({ path, method: options.method, body: options.body });
      return Promise.resolve(discordResult(200, { id: "1468667003366674722" }));
    },
    finishClaim,
  });

  assertEquals(start.outcome, "start_sent");
  assertEquals(
    calls[0].path,
    `/channels/${SPINNER_DISCORD_CHANNEL_ID}/messages`,
  );
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].body.enforce_nonce, true);
  assertEquals(String(calls[0].body.nonce).length, 25);
  assertEquals(finishes[0], {
    outcome: "start_sent",
    messageId: "1468667003366674722",
  });

  const resultRow = {
    ...startRow,
    phase: "result_pending" as const,
    discord_message_id: "1468667003366674722",
  };
  const result = await dispatchSpinnerOutboxRow(resultRow, {
    discordFetch: (path, options) => {
      calls.push({ path, method: options.method, body: options.body });
      return Promise.resolve(discordResult(200, { id: "1468667003366674722" }));
    },
    finishClaim,
  });
  assertEquals(result.outcome, "result_sent");
  assertEquals(
    calls[1].path,
    `/channels/${SPINNER_DISCORD_CHANNEL_ID}/messages/1468667003366674722`,
  );
  assertEquals(calls[1].method, "PATCH");
  assertEquals(finishes[1], {
    outcome: "result_sent",
    messageId: "1468667003366674722",
  });
});

Deno.test("Reaper retries rate limits without losing the idempotent outbox claim", async () => {
  const plan = await createLiveDrawPlan(PARTICIPANTS, {
    randomWord: () => 0,
    uuidFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const payloads = buildDiscordOutboxPayloads(plan.receipt, plan.startAt);
  const finishes: Array<
    { outcome: string; errorCode?: string; retryAt?: string }
  > = [];
  const result = await dispatchSpinnerOutboxRow(
    outboxRow("start_pending", payloads.startPayload, payloads.resultPayload),
    {
      now: () => new Date("2026-07-26T12:00:00.000Z"),
      discordFetch: () =>
        Promise.resolve(discordResult(429, null, { "retry-after": "2.5" })),
      finishClaim: (_row, outcome, fields = {}) => {
        finishes.push({
          outcome,
          errorCode: fields.errorCode,
          retryAt: fields.retryAt,
        });
        return Promise.resolve(true);
      },
    },
  );
  assertEquals(result.outcome, "retry");
  assertEquals(finishes[0], {
    outcome: "retry",
    errorCode: "discord_http_429",
    retryAt: "2026-07-26T12:00:02.500Z",
  });
});

Deno.test("Reaper authentication compares secrets without an early mismatch and caps request bodies", async () => {
  assertEquals(
    await constantTimeSecretEqual("same-secret", "same-secret"),
    true,
  );
  assertEquals(
    await constantTimeSecretEqual("same-secreu", "same-secret"),
    false,
  );
  assertEquals(
    await constantTimeSecretEqual("short", "a-longer-secret"),
    false,
  );

  const declaredOversize = await readBoundedJsonObject(
    new Request("https://example.invalid", {
      method: "POST",
      headers: { "content-length": "2048" },
      body: "{}",
    }),
  );
  assertEquals(declaredOversize, { ok: false, status: 413 });

  const streamedOversize = await readBoundedJsonObject(
    new Request("https://example.invalid", {
      method: "POST",
      body: "x".repeat(1_025),
    }),
  );
  assertEquals(streamedOversize, { ok: false, status: 413 });
});

function outboxRow(
  phase: "start_pending" | "result_pending",
  startPayload: Record<string, unknown>,
  resultPayload: Record<string, unknown>,
): SpinnerOutboxRow {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    draw_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    channel_key: "raffle_spins",
    channel_id: SPINNER_DISCORD_CHANNEL_ID,
    phase,
    start_payload: startPayload,
    result_payload: resultPayload,
    discord_message_id: null,
    attempt_count: 1,
  };
}

function discordResult(
  status: number,
  data: unknown,
  headers: HeadersInit = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    data,
    error: status >= 200 && status < 300 ? null : {},
    headers: new Headers(headers),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }.`,
    );
  }
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

async function assertRejects(
  fn: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}
