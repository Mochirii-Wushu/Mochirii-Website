import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRaffleLeaderboardApi,
  raffleLeaderboardApiIsEmpty,
} from "./leaderboard-core.ts";

const payload = {
  ok: true,
  data: {
    cyclePublicId: "mpd-2026-08",
    cycleStatus: "open",
    closesAt: "2026-08-01T13:15:00.000Z",
    drawAt: "2026-08-01T13:30:00.000Z",
    maximumEntries: 10,
    participantCount: 2,
    entries: [
      { rank: 1, displayName: "Sya", entryCount: 10, isViewer: false },
      { rank: 2, displayName: "Jade Lantern", entryCount: 4, isViewer: true },
    ],
    asOf: "2026-07-28T15:00:00.000Z",
  },
};

test("leaderboard API parser accepts the exact bounded member contract", () => {
  assert.deepEqual(parseRaffleLeaderboardApi(payload), payload.data);
});

test("leaderboard API parser accepts tied duplicate display names without identifiers", () => {
  const tied = {
    ...payload,
    data: {
      ...payload.data,
      entries: [
        { rank: 1, displayName: "Mōchī Member", entryCount: 10, isViewer: false },
        { rank: 1, displayName: "Mōchī Member", entryCount: 10, isViewer: true },
      ],
    },
  };
  assert.deepEqual(parseRaffleLeaderboardApi(tied)?.entries, tied.data.entries);
});

test("leaderboard API parser counts Unicode code points like the database", () => {
  const fortyEmoji = "🍡".repeat(40);
  const accepted = {
    ...payload,
    data: {
      ...payload.data,
      participantCount: 1,
      entries: [{
        rank: 1,
        displayName: fortyEmoji,
        entryCount: 1,
        isViewer: true,
      }],
    },
  };
  assert.equal(parseRaffleLeaderboardApi(accepted)?.entries[0].displayName, fortyEmoji);
  accepted.data.entries[0].displayName = `${fortyEmoji}🍡`;
  assert.equal(parseRaffleLeaderboardApi(accepted), null);
});

test("leaderboard API parser rejects identifiers, extra fields, unsafe names, and invalid points", () => {
  assert.equal(
    parseRaffleLeaderboardApi({
      ...payload,
      data: { ...payload.data, viewerId: "private" },
    }),
    null,
  );
  assert.equal(
    parseRaffleLeaderboardApi({
      ...payload,
      data: {
        ...payload.data,
        participantCount: 1,
        entries: [{
          rank: 1,
          displayName: "Jade\u202eLantern",
          entryCount: 4,
          isViewer: false,
        }],
      },
    }),
    null,
    "bidirectional controls must fail closed",
  );
  assert.equal(
    parseRaffleLeaderboardApi({
      ...payload,
      data: {
        ...payload.data,
        entries: [{
          rank: 1,
          displayName: "bad\u0007name",
          entryCount: 4,
          isViewer: false,
        }],
      },
    }),
    null,
  );
  assert.equal(
    parseRaffleLeaderboardApi({
      ...payload,
      data: {
        ...payload.data,
        participantCount: 1,
        entries: [{
          rank: 1,
          displayName: "Jade Lantern",
          entryCount: 11,
          isViewer: false,
        }],
      },
    }),
    null,
  );
  assert.equal(
    parseRaffleLeaderboardApi({
      ...payload,
      data: {
        ...payload.data,
        entries: [
          { rank: 1, displayName: "Sya", entryCount: 10, isViewer: false },
          { rank: 3, displayName: "Jade Lantern", entryCount: 4, isViewer: true },
        ],
      },
    }),
    null,
    "dense ranks must not contain gaps",
  );
});

test("leaderboard API empty state is distinct from an invalid response", () => {
  assert.equal(raffleLeaderboardApiIsEmpty({ ok: true, data: null }), true);
  assert.equal(raffleLeaderboardApiIsEmpty({ ok: false, data: null }), false);
});
