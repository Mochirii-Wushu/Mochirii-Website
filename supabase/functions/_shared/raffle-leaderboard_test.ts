import {
  constantTimeLowerHexMatches,
  parseRaffleLeaderboard,
  raffleLeaderboardHmacHex,
  socialLeaderboardCanonicalBytes,
  verifySocialLeaderboardRequest,
} from "./raffle-leaderboard.ts";

const SUBJECT = "10000000-0000-4000-8000-000000000001";
const TIMESTAMP = "1785254400";
const NONCE = "0123456789abcdef0123456789abcdef";
const SECRET = "leaderboard-test-secret-that-is-at-least-32-bytes";

Deno.test("leaderboard parser accepts only the bounded sanitized contract", () => {
  const parsed = parseRaffleLeaderboard({
    cyclePublicId: "mpd-2026-08",
    cycleStatus: "open",
    closesAt: "2026-08-01T13:15:00.000Z",
    drawAt: "2026-08-01T13:30:00.000Z",
    maximumEntries: 10,
    participantCount: 2,
    entries: [
      { rank: 1, displayName: "Sya", entryCount: 10, isViewer: false },
      { rank: 2, displayName: "Mōchī Member", entryCount: 4, isViewer: true },
    ],
  });
  assert(parsed?.entries[1].isViewer === true, "viewer row should parse");
  assert(
    parseRaffleLeaderboard({
      cyclePublicId: "mpd-2026-08",
      cycleStatus: "open",
      closesAt: "2026-08-01T13:15:00.000Z",
      drawAt: "2026-08-01T13:30:00.000Z",
      maximumEntries: 10,
      participantCount: 1,
      entries: [{
        rank: 1,
        displayName: "<script>bad</script>",
        entryCount: 11,
        isViewer: false,
      }],
    }) === null,
    "out-of-contract points must fail closed",
  );
  assert(
    parseRaffleLeaderboard({
      cyclePublicId: "mpd-2026-08",
      cycleStatus: "open",
      closesAt: "2026-08-01T13:15:00.000Z",
      drawAt: "2026-08-01T13:30:00.000Z",
      maximumEntries: 10,
      participantCount: 1,
      entries: [{
        rank: 1,
        displayName: "Mōchī\u2066Member",
        entryCount: 4,
        isViewer: false,
      }],
    }) === null,
    "bidirectional controls must fail closed",
  );
});

Deno.test("leaderboard parser accepts tied duplicate names and rejects rank gaps", () => {
  const base = {
    cyclePublicId: "mpd-2026-08",
    cycleStatus: "open",
    closesAt: "2026-08-01T13:15:00.000Z",
    drawAt: "2026-08-01T13:30:00.000Z",
    maximumEntries: 10,
    participantCount: 2,
  };
  const tied = parseRaffleLeaderboard({
    ...base,
    entries: [
      { rank: 1, displayName: "Mōchī Member", entryCount: 10, isViewer: false },
      { rank: 1, displayName: "Mōchī Member", entryCount: 10, isViewer: true },
    ],
  });
  assert(
    tied?.entries.length === 2,
    "duplicate safe names should remain valid",
  );
  assert(
    parseRaffleLeaderboard({
      ...base,
      entries: [
        { rank: 1, displayName: "Sya", entryCount: 10, isViewer: false },
        { rank: 3, displayName: "Mōchī Member", entryCount: 4, isViewer: true },
      ],
    }) === null,
    "dense ranks must not contain gaps",
  );
});

Deno.test("leaderboard parser counts Unicode code points like Postgres", () => {
  const fortyEmoji = "🍡".repeat(40);
  const base = {
    cyclePublicId: "mpd-2026-08",
    cycleStatus: "open",
    closesAt: "2026-08-01T13:15:00.000Z",
    drawAt: "2026-08-01T13:30:00.000Z",
    maximumEntries: 10,
    participantCount: 1,
  };
  assert(
    parseRaffleLeaderboard({
      ...base,
      entries: [{
        rank: 1,
        displayName: fortyEmoji,
        entryCount: 1,
        isViewer: true,
      }],
    })?.entries[0].displayName === fortyEmoji,
    "40 Unicode code points should remain valid",
  );
  assert(
    parseRaffleLeaderboard({
      ...base,
      entries: [{
        rank: 1,
        displayName: `${fortyEmoji}🍡`,
        entryCount: 1,
        isViewer: true,
      }],
    }) === null,
    "41 Unicode code points must fail closed",
  );
});

Deno.test("social leaderboard canonical bytes use the exact versioned contract", () => {
  const text = new TextDecoder().decode(
    socialLeaderboardCanonicalBytes(SUBJECT, TIMESTAMP, NONCE),
  );
  assert(
    text === `v1\n${SUBJECT}\n${TIMESTAMP}\n${NONCE}`,
    "canonical bytes must use LF with no trailing LF",
  );
});

Deno.test("social leaderboard HMAC accepts once and rejects replay", async () => {
  const signature = await raffleLeaderboardHmacHex(
    SECRET,
    SUBJECT,
    TIMESTAMP,
    NONCE,
  );
  let consumed = false;
  const headers = new Headers({
    "x-mochirii-raffle-timestamp": TIMESTAMP,
    "x-mochirii-raffle-nonce": NONCE,
    "x-mochirii-raffle-signature": `v1=${signature}`,
  });
  const dependencies = {
    secret: SECRET,
    nowMs: Number(TIMESTAMP) * 1000,
    consumeNonce: async () => {
      if (consumed) return false;
      consumed = true;
      return true;
    },
  };
  const first = await verifySocialLeaderboardRequest(
    headers,
    { sub: SUBJECT },
    dependencies,
  );
  const replay = await verifySocialLeaderboardRequest(
    headers,
    { sub: SUBJECT },
    dependencies,
  );
  assert(first.ok, "the valid request should be accepted");
  assert(
    !replay.ok && replay.error === "replayed_request",
    "the same nonce must be rejected",
  );
});

Deno.test("social leaderboard HMAC fails closed for stale, malformed, or unconfigured requests", async () => {
  const signature = await raffleLeaderboardHmacHex(
    SECRET,
    SUBJECT,
    TIMESTAMP,
    NONCE,
  );
  const validHeaders = new Headers({
    "x-mochirii-raffle-timestamp": TIMESTAMP,
    "x-mochirii-raffle-nonce": NONCE,
    "x-mochirii-raffle-signature": `v1=${signature}`,
  });
  const stale = await verifySocialLeaderboardRequest(
    validHeaders,
    { sub: SUBJECT },
    {
      secret: SECRET,
      nowMs: (Number(TIMESTAMP) + 61) * 1000,
      consumeNonce: async () => true,
    },
  );
  const extraBodyKey = await verifySocialLeaderboardRequest(
    validHeaders,
    { sub: SUBJECT, action: "leaderboard" },
    {
      secret: SECRET,
      nowMs: Number(TIMESTAMP) * 1000,
      consumeNonce: async () => true,
    },
  );
  const unconfigured = await verifySocialLeaderboardRequest(
    validHeaders,
    { sub: SUBJECT },
    {
      secret: "short",
      nowMs: Number(TIMESTAMP) * 1000,
      consumeNonce: async () => true,
    },
  );
  assert(!stale.ok && stale.status === 401, "stale requests must fail");
  assert(
    !extraBodyKey.ok && extraBodyKey.status === 401,
    "extra keys must fail",
  );
  assert(
    !unconfigured.ok && unconfigured.status === 503,
    "missing strong configuration must fail closed",
  );
  assert(
    constantTimeLowerHexMatches(signature, signature),
    "equal signatures should match",
  );
  assert(
    !constantTimeLowerHexMatches(
      signature,
      `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`,
    ),
    "different signatures must not match",
  );
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
