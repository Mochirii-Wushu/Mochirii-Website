import assert from "node:assert/strict";
import test from "node:test";
import { parseRaffleViewerResultNames } from "./raffle-viewer-results.ts";

test("verified raffle result names accept only the exact private DTO", () => {
  assert.deepEqual(
    parseRaffleViewerResultNames({
      resultNames: {
        "monthly-2026-08:1": "Guild Winner",
        "monthly-2026-08:2": "Guild Honor One",
        "monthly-2026-08:3": "Guild Honor Two",
      },
    }),
    {
      "monthly-2026-08:1": "Guild Winner",
      "monthly-2026-08:2": "Guild Honor One",
      "monthly-2026-08:3": "Guild Honor Two",
    },
  );
});

test("missing, empty, excessive, malformed, or unsafe result names fail closed", () => {
  const rejected = [
    null,
    {},
    { resultNames: {} },
    { resultNames: { "bad key": "Member" } },
    { resultNames: { "monthly-2026-08:1": "\u202eMember" } },
    { resultNames: { "monthly-2026-08:1": "x".repeat(41) } },
    {
      resultNames: {
        "monthly-2026-08:1": "One",
        "monthly-2026-08:2": "Two",
        "monthly-2026-08:3": "Three",
        "monthly-2026-08:4": "Four",
      },
    },
    { resultNames: { "monthly-2026-08:1": "Member" }, provider: "leak" },
  ];

  for (const value of rejected) {
    assert.equal(parseRaffleViewerResultNames(value), undefined);
  }
});
