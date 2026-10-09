import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { desiredEventsFromSchedule } from "../supabase/functions/_shared/reaper-discord-events.ts";

const schedule = JSON.parse(readFileSync(new URL("../apps/web/public/data/guild-schedule.json", import.meta.url), "utf8"));
const checkerSource = readFileSync(new URL("./check-discord-reaper-parity.mjs", import.meta.url), "utf8");
const helpersStart = checkerSource.indexOf("const MS_PER_DAY =");
const helpersEnd = checkerSource.indexOf("function normalizedRecurrence(");
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, "Parity checker scheduling helpers must be available");
// Exercise the checker calculation without executing its CLI or optional Discord read.
const checkerEvents = vm.runInNewContext(
  `${checkerSource.slice(helpersStart, helpersEnd)}\nlocalEventInstances;`,
  { Date },
);
const firstWednesday = {
  ...schedule,
  monthly: {
    ...schedule.monthly,
    gathering: {
      ...schedule.monthly.gathering,
      rule: "next-first-wednesday", startDayOffset: 0, startTime: "21:30", endTime: "22:00",
      discordRecurrenceRule: { ...schedule.monthly.gathering.discordRecurrenceRule, by_n_weekday: [{ n: 1, day: 2 }] },
    },
  },
};

function projection(events) {
  return Array.from(events, ({ key, startIso, endIso, websiteLocation }) => ({ key, startIso, endIso, websiteLocation }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function matchingPlan(instant, input = schedule) {
  const now = new Date(instant);
  const checked = checkerEvents(input, now);
  assert.deepEqual(projection(checked), projection(desiredEventsFromSchedule(input, now)), instant);
  assert.equal(new Set(checked.map((event) => event.key)).size, checked.length, instant);
  assert.equal(new Set(checked.map((event) => [event.startIso, event.endIso, event.websiteLocation].join("\n"))).size,
    checked.length, instant);
  for (const event of checked) {
    assert.ok(Date.parse(event.startIso) < Date.parse(event.endIso), event.key);
    assert.ok(Date.parse(event.endIso) > now.getTime(), `${event.key} must retain an exclusive future end`);
  }
  return checked;
}

test("parity checker follows the Monday after the first Sunday with an exclusive end", () => {
  for (const [instant, startIso, endIso] of [
    ["2026-11-01T23:59:59.999+08:00", "2026-11-01T16:00:00.000Z", "2026-11-01T17:00:00.000Z"],
    ["2026-11-02T00:00:00+08:00", "2026-11-01T16:00:00.000Z", "2026-11-01T17:00:00.000Z"],
    ["2026-11-02T00:59:59.999+08:00", "2026-11-01T16:00:00.000Z", "2026-11-01T17:00:00.000Z"],
    ["2026-11-02T01:00:00+08:00", "2026-12-06T16:00:00.000Z", "2026-12-06T17:00:00.000Z"],
    ["2026-11-02T01:00:00.001+08:00", "2026-12-06T16:00:00.000Z", "2026-12-06T17:00:00.000Z"],
    ["2026-12-06T23:59:59.999+08:00", "2026-12-06T16:00:00.000Z", "2026-12-06T17:00:00.000Z"],
    ["2026-12-07T00:00:00+08:00", "2026-12-06T16:00:00.000Z", "2026-12-06T17:00:00.000Z"],
    ["2026-12-07T00:59:59.999+08:00", "2026-12-06T16:00:00.000Z", "2026-12-06T17:00:00.000Z"],
    ["2026-12-07T01:00:00+08:00", "2027-01-03T16:00:00.000Z", "2027-01-03T17:00:00.000Z"],
    ["2026-12-07T01:00:00.001+08:00", "2027-01-03T16:00:00.000Z", "2027-01-03T17:00:00.000Z"],
    ["2027-02-01T00:00:00+08:00", "2027-02-07T16:00:00.000Z", "2027-02-07T17:00:00.000Z"],
    ["2027-02-07T23:59:59.999+08:00", "2027-02-07T16:00:00.000Z", "2027-02-07T17:00:00.000Z"],
    ["2027-02-08T00:00:00+08:00", "2027-02-07T16:00:00.000Z", "2027-02-07T17:00:00.000Z"],
    ["2027-02-08T00:59:59.999+08:00", "2027-02-07T16:00:00.000Z", "2027-02-07T17:00:00.000Z"],
    ["2027-02-08T01:00:00+08:00", "2027-03-07T16:00:00.000Z", "2027-03-07T17:00:00.000Z"],
    ["2027-02-08T01:00:00.001+08:00", "2027-03-07T16:00:00.000Z", "2027-03-07T17:00:00.000Z"],
  ]) {
    const events = matchingPlan(instant);
    assert.equal(events.length, 17);
    assert.equal(new Set(events.map((event) => event.typeId)).size, 8);
    const gathering = events.find((event) => event.key === "monthly-gathering");
    assert.equal(gathering.startIso, startIso);
    assert.equal(gathering.endIso, endIso);
    assert.equal(gathering.recurrenceRule.by_n_weekday[0].day, 6, "Monday UTC+8 is the first Sunday at 16:00 UTC");
    assert.ok(events.some((event) => event.key === "monthly-raffle"), "Retained Reaper raffle needs a separate decision");
  }
});

test("parity checker preserves all five historical first-Wednesday boundaries as an explicit fixture", () => {
  for (const [instant, date] of [
    ["2026-11-04T21:29:00+08:00", "2026-11-04"],
    ["2026-11-04T21:30:00+08:00", "2026-11-04"],
    ["2026-11-04T21:59:59.999+08:00", "2026-11-04"],
    ["2026-11-04T22:00:00+08:00", "2026-12-02"],
    ["2026-11-04T22:00:00.001+08:00", "2026-12-02"],
  ]) {
    const events = matchingPlan(instant, firstWednesday);
    assert.equal(events.length, 17);
    assert.equal(new Set(events.map((event) => event.typeId)).size, 8);
    const gathering = events.find((event) => event.key === "monthly-gathering");
    assert.equal(gathering.startIso, `${date}T13:30:00.000Z`);
    assert.equal(gathering.endIso, `${date}T14:00:00.000Z`);
    assert.ok(events.some((event) => event.key === "monthly-raffle"), "Retained Reaper raffle needs a separate decision");
  }
});

test("parity checker hands off Friday Skyward to Hero at 23:00 and closes Hero at midnight", () => {
  for (const [instant, skywardDate, heroDate] of [
    ["2026-10-09T21:59:59.999+08:00", "2026-10-09", "2026-10-09"],
    ["2026-10-09T22:00:00+08:00", "2026-10-09", "2026-10-09"],
    ["2026-10-09T22:59:59.999+08:00", "2026-10-09", "2026-10-09"],
    ["2026-10-09T23:00:00+08:00", "2026-10-16", "2026-10-09"],
    ["2026-10-09T23:59:59.999+08:00", "2026-10-16", "2026-10-09"],
    ["2026-10-10T00:00:00+08:00", "2026-10-16", "2026-10-16"],
  ]) {
    const events = matchingPlan(instant);
    assert.equal(events.length, 17);
    const hero = events.find((event) => event.key === "guild-heros-realm-5");
    const skyward = events.find((event) => event.key === "united-resolve-5");
    assert.equal(hero.startIso, `${heroDate}T15:00:00.000Z`);
    assert.equal(hero.endIso, `${heroDate}T16:00:00.000Z`);
    assert.equal(skyward.title, "Skyward Bond");
    assert.equal(skyward.startIso, `${skywardDate}T14:00:00.000Z`);
    assert.equal(skyward.endIso, `${skywardDate}T15:00:00.000Z`);
  }
});

test("parity checker matches midnight and month/year transitions", () => {
  for (const instant of [
    "2026-10-09T23:59:59.999+08:00", "2026-10-10T00:00:00+08:00",
    "2026-11-30T23:59:59.999+08:00", "2026-12-01T00:00:00+08:00",
    "2026-12-31T23:59:59.999+08:00", "2027-01-01T00:00:00+08:00",
  ]) matchingPlan(instant);
  assert.equal(matchingPlan("2026-12-07T01:00:00+08:00")
    .find((event) => event.key === "monthly-gathering").startIso, "2027-01-03T16:00:00.000Z");
});

test("parity checker keeps active overnight monthly and weekly occurrences until closing", () => {
  const overnight = {
    timezone: schedule.timezone,
    monthly: { gathering: { ...firstWednesday.monthly.gathering, startTime: "23:30", endTime: "01:00" } },
    weekly: [{ id: "overnight", title: "Overnight", discord: true, days: [3], startTime: "23:00", endTime: "01:00", location: "https://mochirii.com/events" }],
  };
  const before = matchingPlan("2026-11-05T00:59:59.999+08:00", overnight);
  assert.equal(before.find((event) => event.key === "monthly-gathering").startIso, "2026-11-04T15:30:00.000Z");
  assert.equal(before.find((event) => event.key === "overnight-3").startIso, "2026-11-04T15:00:00.000Z");
  const closed = matchingPlan("2026-11-05T01:00:00+08:00", overnight);
  assert.equal(closed.find((event) => event.key === "monthly-gathering").startIso, "2026-12-02T15:30:00.000Z");
  assert.equal(closed.find((event) => event.key === "overnight-3").startIso, "2026-11-11T15:00:00.000Z");
});

test("parity checker suppresses only the exact first-Wednesday Guild Party slot", () => {
  const instant = "2026-11-04T21:30:00+08:00";
  const events = matchingPlan(instant, firstWednesday);
  assert.equal(events.find((event) => event.key === "guild-party-3").startIso, "2026-11-11T13:30:00.000Z");
  assert.equal(events.filter((event) => event.key.startsWith("guild-party-")).length, 7);
  for (const change of [{ startTime: "21:31" }, { endTime: "22:01" }, { location: "https://mochirii.com/events#other" }]) {
    const changed = { ...firstWednesday, monthly: { gathering: { ...firstWednesday.monthly.gathering, ...change } } };
    assert.equal(matchingPlan(instant, changed).find((event) => event.key === "guild-party-3").startIso, "2026-11-04T13:30:00.000Z");
  }
});

test("parity checker retains the first-Saturday raffle and advances it at its end", () => {
  for (const [instant, date] of [
    ["2026-11-07T21:59:59.999+08:00", "2026-11-07"],
    ["2026-11-07T22:00:00+08:00", "2026-12-05"],
    ["2026-12-05T22:00:00+08:00", "2027-01-02"],
  ]) {
    assert.equal(matchingPlan(instant).find((event) => event.key === "monthly-raffle").startIso, `${date}T13:30:00.000Z`);
  }
});
