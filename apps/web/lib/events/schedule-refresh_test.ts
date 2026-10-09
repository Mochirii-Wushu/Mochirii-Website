import assert from "node:assert/strict";
import test from "node:test";
import guildScheduleData from "../../public/data/guild-schedule.json" with { type: "json" };
import { websiteEventCardsFromSchedule } from "../guild-schedule.ts";
import { nextScheduleRefreshDelay } from "./schedule-refresh.ts";

function nextRefreshAt(iso: string) {
  const now = new Date(iso);
  return new Date(now.getTime() + nextScheduleRefreshDelay(
    now.getTime(), websiteEventCardsFromSchedule(guildScheduleData, now),
  )).toISOString();
}

test("the refresh timer wakes at monthly start and its exclusive closing instant", () => {
  assert.equal(nextRefreshAt("2026-11-01T15:59:00.000Z"), "2026-11-01T16:00:00.000Z");
  assert.equal(nextRefreshAt("2026-11-01T16:00:00.000Z"), "2026-11-01T17:00:00.000Z");
  assert.equal(nextRefreshAt("2026-11-01T16:59:59.999Z"), "2026-11-01T17:00:00.000Z");
  assert.equal(nextRefreshAt("2026-11-01T17:00:00.000Z"), "2026-11-02T13:30:00.000Z");
  assert.equal(nextRefreshAt("2026-11-01T17:00:00.001Z"), "2026-11-02T13:30:00.000Z");
});

test("Friday Skyward Bond hands off to Hero's Realm at 23:00 before the midnight close", () => {
  assert.equal(nextRefreshAt("2026-10-09T13:59:59.999Z"), "2026-10-09T14:00:00.000Z");
  assert.equal(nextRefreshAt("2026-10-09T14:59:59.999Z"), "2026-10-09T15:00:00.000Z");
  assert.equal(nextRefreshAt("2026-10-09T15:00:00.000Z"), "2026-10-09T16:00:00.000Z");
  assert.equal(nextRefreshAt("2026-10-09T15:59:59.999Z"), "2026-10-09T16:00:00.000Z");
  assert.equal(nextRefreshAt("2026-10-09T16:00:00.000Z"), "2026-10-10T12:30:00.000Z");
});

test("UTC+8 midnight refresh rolls the calendar into the next month and year", () => {
  assert.equal(nextRefreshAt("2026-10-31T15:59:59.999Z"), "2026-10-31T16:00:00.000Z");
  assert.equal(nextRefreshAt("2026-12-31T15:59:59.999Z"), "2026-12-31T16:00:00.000Z");
});

test("an empty schedule still refreshes at authoritative midnight", () => {
  const now = Date.parse("2026-10-09T15:59:59.999Z");
  assert.equal(nextScheduleRefreshDelay(now, []), 1);
  assert.equal(nextScheduleRefreshDelay(now + 1, []), 24 * 60 * 60 * 1000);
});

test("past or malformed boundaries do not cause an immediate refresh loop", () => {
  const now = Date.parse("2026-10-09T15:00:00.000Z");
  assert.equal(nextScheduleRefreshDelay(now, [{ startIso: "bad", endIso: "2026-10-09T15:00:00.000Z" }]), 60 * 60 * 1000);
});
