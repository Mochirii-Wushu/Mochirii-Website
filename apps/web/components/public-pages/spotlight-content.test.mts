import assert from "node:assert/strict";
import test from "node:test";

import {
  spotlightAppreciationLines,
  spotlightMonthKey,
  spotlightWinnerName,
  spotlightWinnerTitle,
} from "./spotlight-content.ts";

test("one canonical winner populates both public title formats and Appreciation", () => {
  const winner = { winnerName: "  Nur   Syidah  ", monthKey: "2026-08-01" };

  assert.equal(spotlightWinnerName(winner), "Nur Syidah");
  assert.equal(spotlightWinnerTitle("home", "Member Spotlight", winner), "Congratulations to: Nur Syidah.");
  assert.equal(spotlightWinnerTitle("spotlight", "This Month's Spotlight", winner), "This Month: Nur Syidah");
  assert.deepEqual(
    spotlightAppreciationLines(["A lantern for {{winnerName}}.", "Thank you, {{winnerName}}."], winner),
    ["A lantern for Nur Syidah.", "Thank you, Nur Syidah."],
  );
  assert.equal(spotlightMonthKey(winner, "2020-01-01"), "2026-08-01");
});

test("missing or hostile winner data remains generic and never reaches public copy", () => {
  const hostile = { winnerName: "sentinel\nname\u202e", monthKey: "2026-08-02" };

  assert.equal(spotlightWinnerName(hostile), "");
  assert.equal(spotlightWinnerTitle("home", "Member Spotlight", hostile), "Member Spotlight");
  assert.deepEqual(
    spotlightAppreciationLines(["A lantern for {{winnerName}}."], hostile),
    ["A lantern for our selected member."],
  );
  assert.equal(spotlightMonthKey(hostile, "2026-09-01"), "2026-09-01");

  for (const winnerName of [
    ["Alice"],
    { private: "sentinel" },
    42,
    "Alice\nInjected",
    "Alice\tInjected",
    "Alice\u061cInjected",
    "Alice\u200eInjected",
    "Alice\u200fInjected",
    "Alice\ud800Injected",
  ]) {
    const malformed = { winnerName, monthKey: "2026-08-01" } as never;
    assert.equal(spotlightWinnerName(malformed), "");
    assert.equal(spotlightWinnerTitle("spotlight", "This Month's Spotlight", malformed), "This Month's Spotlight");
  }
});

test("invalid content collections fail closed", () => {
  assert.deepEqual(spotlightAppreciationLines("{{winnerName}}", null), []);
  assert.deepEqual(spotlightAppreciationLines([null, "", 42], null), []);
});

test("replacement syntax in a valid member name remains literal in Appreciation", () => {
  for (const winnerName of ["$&", "$$", "$`", "$'"]) {
    assert.deepEqual(
      spotlightAppreciationLines(
        ["Before {{winnerName}} after"],
        { winnerName, monthKey: "2026-08-01" },
      ),
      [`Before ${winnerName} after`],
    );
  }
});

test("a validated winner month remains distinct from the current-month fallback", () => {
  assert.equal(spotlightMonthKey({ winnerName: "Member", monthKey: "2026-08-01" }, "2026-09-01"), "2026-08-01");
  assert.equal(spotlightMonthKey({ winnerName: "Member", monthKey: "2026-08-02" }, "2026-09-01"), "2026-09-01");
});
