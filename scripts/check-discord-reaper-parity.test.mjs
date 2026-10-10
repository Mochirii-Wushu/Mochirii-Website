import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { desiredEventsFromSchedule } from "../supabase/functions/_shared/reaper-discord-events.ts";

const schedule = JSON.parse(readFileSync(new URL("../apps/web/public/data/guild-schedule.json", import.meta.url), "utf8"));
const checkerSource = readFileSync(new URL("./check-discord-reaper-parity.mjs", import.meta.url), "utf8");
const helpersStart = checkerSource.indexOf("const MS_PER_DAY =");
const helpersEnd = checkerSource.indexOf("async function liveDiscordRead(");
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, "Parity checker scheduling helpers must be available");
// Exercise the checker calculation without executing its CLI or optional Discord read.
const { checkerEvents, liveEventMatchesExpected } = vm.runInNewContext(
  `${checkerSource.slice(helpersStart, helpersEnd)}\n({ checkerEvents: localEventInstances, liveEventMatchesExpected });`,
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
  return Array.from(events, ({ key, startIso, endIso, websiteLocation, recurrenceRule }) => ({ key, startIso, endIso, websiteLocation,
    recurrenceRule: JSON.parse(JSON.stringify(recurrenceRule)),
  }))
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
    assert.equal(events.length, 8);
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
    assert.equal(events.length, 8);
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
    assert.equal(events.length, 8);
    const hero = events.find((event) => event.key === "guild-heros-realm");
    const skyward = events.find((event) => event.key === "united-resolve");
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
  assert.equal(before.find((event) => event.key === "overnight").startIso, "2026-11-04T15:00:00.000Z");
  const closed = matchingPlan("2026-11-05T01:00:00+08:00", overnight);
  assert.equal(closed.find((event) => event.key === "monthly-gathering").startIso, "2026-12-02T15:30:00.000Z");
  assert.equal(closed.find((event) => event.key === "overnight").startIso, "2026-11-11T15:00:00.000Z");
});

test("parity checker suppresses only the exact first-Wednesday Guild Party slot", () => {
  const instant = "2026-11-04T21:30:00+08:00";
  const events = matchingPlan(instant, firstWednesday);
  assert.equal(events.find((event) => event.key === "guild-party").startIso, "2026-11-05T13:30:00.000Z");
  assert.equal(events.find((event) => event.key === "guild-party").recurrenceRule, null);
  assert.equal(events.filter((event) => event.key === "guild-party").length, 1);
  for (const change of [{ startTime: "21:31" }, { endTime: "22:01" }, { location: "https://mochirii.com/events#other" }]) {
    const changed = { ...firstWednesday, monthly: { gathering: { ...firstWednesday.monthly.gathering, ...change } } };
    const party = matchingPlan(instant, changed).find((event) => event.key === "guild-party");
    assert.equal(party.startIso, "2026-11-04T13:30:00.000Z");
    assert.equal(party.recurrenceRule.frequency, 3, "A different Website slot cannot suppress daily recurrence");
  }
});

test("parity checker generates eight stable activity keys and complete native recurrence rules", () => {
  const events = matchingPlan("2026-10-10T00:00:00+08:00");
  assert.deepEqual(Array.from(events, (event) => event.key), [
    "monthly-gathering", "monthly-raffle", "guild-party", "breaking-army", "showdown", "guild-wars", "guild-heros-realm", "united-resolve",
  ]);
  const rules = new Map(events.map((event) => [event.key, JSON.parse(JSON.stringify(event.recurrenceRule))]));
  assert.deepEqual(rules.get("guild-party"), { start: "2026-10-10T13:30:00.000Z", frequency: 3, interval: 1 });
  assert.equal(rules.get("breaking-army"), null);
  assert.equal(rules.get("showdown"), null);
  assert.deepEqual(rules.get("guild-wars"), { start: "2026-10-10T12:30:00.000Z", frequency: 3, interval: 1, by_weekday: [5, 6] });
  assert.deepEqual(rules.get("guild-heros-realm"), { start: "2026-10-16T15:00:00.000Z", frequency: 2, interval: 1, by_weekday: [4] });
  assert.deepEqual(rules.get("united-resolve"), { start: "2026-10-16T14:00:00.000Z", frequency: 2, interval: 1, by_weekday: [4] });
  assert(events.filter((event) => event.recurrenceRule).every((event) => event.recurrenceRule.start === event.startIso));
});

test("parity checker derives all supported daily sets in UTC and rejects unsupported pairs", () => {
  const fixture = (days, startTime = "21:30", endTime = "22:00") => ({
    timezone: schedule.timezone, monthly: {},
    weekly: [{ id: "activity", title: "Activity", discord: true, days, startTime, endTime, location: "https://mochirii.com/events" }],
  });
  for (const [days, utcDays] of [
    [[1, 2, 3, 4, 5], [0, 1, 2, 3, 4]], [[2, 3, 4, 5, 6], [1, 2, 3, 4, 5]],
    [[0, 1, 2, 3, 4], [0, 1, 2, 3, 6]], [[5, 6], [4, 5]], [[6, 0], [5, 6]], [[0, 1], [0, 6]],
  ]) {
    const event = matchingPlan("2026-10-10T00:00:00+08:00", fixture(days))[0];
    assert.equal(event.recurrenceRule.frequency, 3);
    assert.deepEqual(Array.from(event.recurrenceRule.by_weekday), utcDays);
  }
  const early = matchingPlan("2026-10-10T00:00:00+08:00", fixture([1, 2, 3, 4, 5], "00:30", "01:30"))[0];
  assert.deepEqual(Array.from(early.recurrenceRule.by_weekday), [0, 1, 2, 3, 6]);
  const earlyMonday = matchingPlan("2026-10-10T00:00:00+08:00", fixture([1], "00:30", "01:30"))[0];
  assert.equal(earlyMonday.recurrenceRule.frequency, 2);
  assert.deepEqual(Array.from(earlyMonday.recurrenceRule.by_weekday), [6]);
  for (const days of [[1, 3], [2, 4]]) {
    assert.equal(matchingPlan("2026-10-10T00:00:00+08:00", fixture(days))[0].recurrenceRule, null);
  }
});

test("rolling Army and Showdown select their next scheduled day at the exclusive midnight end", () => {
  for (const [key, before, end, previousDate, nextDate] of [
    ["breaking-army", "2026-10-12T23:59:59.999+08:00", "2026-10-13T00:00:00+08:00", "2026-10-12", "2026-10-14"],
    ["showdown", "2026-10-13T23:59:59.999+08:00", "2026-10-14T00:00:00+08:00", "2026-10-13", "2026-10-15"],
  ]) {
    const active = matchingPlan(before).find((event) => event.key === key);
    const next = matchingPlan(end).find((event) => event.key === key);
    assert.equal(active.startIso, `${previousDate}T14:00:00.000Z`);
    assert.equal(next.startIso, `${nextDate}T14:00:00.000Z`);
    assert.equal(active.recurrenceRule, null);
    assert.equal(next.recurrenceRule, null);
  }
});

test("collision suppression uses Website location even when Discord location differs", () => {
  const changed = { ...firstWednesday, monthly: { gathering: { ...firstWednesday.monthly.gathering, discordLocation: "Different Discord label" } } };
  const party = matchingPlan("2026-11-04T21:30:00+08:00", changed).find((event) => event.key === "guild-party");
  assert.equal(party.startIso, "2026-11-05T13:30:00.000Z");
  assert.equal(party.recurrenceRule, null);
});

test("live recurrence parity compares UTC anchors, selector fields and exact shapes without provider calls", () => {
  for (const key of ["monthly-gathering", "guild-party", "guild-wars", "guild-heros-realm", "breaking-army"]) {
    const expected = checkerEvents(schedule, new Date("2026-10-10T00:00:00+08:00")).find((event) => event.key === key);
    const clean = {
      id: expected.canonicalEventId || "123456789012345678", name: expected.title,
      scheduled_start_time: expected.startIso, scheduled_end_time: expected.endIso, entity_type: 3,
      entity_metadata: { location: expected.location }, recurrence_rule: structuredClone(expected.recurrenceRule),
    };
    assert.equal(liveEventMatchesExpected(clean, expected), true, key);
    for (const recurrence_rule of ["invalid", {}, { ...(expected.recurrenceRule || {}), unknown: true }]) {
      assert.equal(liveEventMatchesExpected({ ...clean, recurrence_rule }, expected), false, key);
    }
    if (!expected.recurrenceRule) continue;
    for (const change of [
      { start: "2026-10-10T00:00:00.000Z" }, { frequency: 0 }, { interval: 2 }, { by_weekday: [1, 3] },
      { by_n_weekday: [{ n: 2, day: 6 }] }, { by_month: [11] }, { count: 2 }, { end: "2027-01-01T00:00:00.000Z" },
    ]) {
      assert.equal(liveEventMatchesExpected({ ...clean, recurrence_rule: { ...expected.recurrenceRule, ...change } }, expected), false, `${key}: ${JSON.stringify(change)}`);
    }
    const reordered = { ...expected.recurrenceRule, start: expected.recurrenceRule.start.replace(".000Z", "+00:00"), end: null, count: null };
    if (reordered.by_weekday) reordered.by_weekday = [...reordered.by_weekday].reverse();
    assert.equal(liveEventMatchesExpected({ ...clean, recurrence_rule: reordered }, expected), true, "Equivalent ISO, null optional fields and weekday order");
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

test("live parity accepts equivalent original native anchors and rejects invalid dates, clocks or duration", () => {
  const old = checkerEvents(schedule, new Date("2026-10-10T00:00:00+08:00"));
  const next = checkerEvents(schedule, new Date("2026-12-10T00:00:00+08:00"));
  for (const key of ["monthly-gathering", "monthly-raffle", "guild-party", "guild-wars", "guild-heros-realm", "united-resolve"]) {
    const original = old.find((event) => event.key === key);
    const expected = next.find((event) => event.key === key);
    const event = { id: expected.canonicalEventId || "123456789012345678", name: expected.title,
      entity_type: 3, entity_metadata: { location: expected.location },
      scheduled_start_time: original.startIso, scheduled_end_time: original.endIso, recurrence_rule: original.recurrenceRule };
    assert.equal(liveEventMatchesExpected(event, expected), true, key);
    assert.equal(liveEventMatchesExpected({ ...event, scheduled_end_time: new Date(Date.parse(original.endIso) + 60000).toISOString() }, expected), false, `${key}: duration drift`);
    const shifted = { ...event, scheduled_start_time: new Date(Date.parse(original.startIso) + 60000).toISOString(),
      scheduled_end_time: new Date(Date.parse(original.endIso) + 60000).toISOString(),
      recurrence_rule: { ...original.recurrenceRule, start: new Date(Date.parse(original.startIso) + 60000).toISOString() } };
    assert.equal(liveEventMatchesExpected(shifted, expected), false, `${key}: clock drift`);
    if (key === "guild-party") continue;
    const shift = key.startsWith("monthly-") ? 7 * 86400000 : 2 * 86400000;
    const offRule = { ...event, scheduled_start_time: new Date(Date.parse(original.startIso) - shift).toISOString(),
      scheduled_end_time: new Date(Date.parse(original.endIso) - shift).toISOString(),
      recurrence_rule: { ...original.recurrenceRule, start: new Date(Date.parse(original.startIso) - shift).toISOString() } };
    assert.equal(liveEventMatchesExpected(offRule, expected), false, `${key}: selector date drift`);
  }
});

test("live parity rejects normalized-over invalid calendar dates in native anchors and event windows", () => {
  const expected = checkerEvents(schedule, new Date("2026-03-10T00:00:00+08:00")).find(event => event.key === "guild-party");
  const start = "2026-02-30T13:30:00.000Z", end = "2026-02-30T14:00:00.000Z";
  const event = { id: "123456789012345678", name: expected.title, entity_type: 3, entity_metadata: { location: expected.location },
    scheduled_start_time: "2026-03-02T13:30:00.000Z", scheduled_end_time: "2026-03-02T14:00:00.000Z",
    recurrence_rule: { ...expected.recurrenceRule, start: "2026-03-02T13:30:00.000Z" } };
  assert.equal(liveEventMatchesExpected(event, expected), true);
  for (const change of [{ scheduled_start_time: start }, { scheduled_end_time: end },
    { recurrence_rule: { ...event.recurrence_rule, start } },
    { scheduled_start_time: start, scheduled_end_time: end, recurrence_rule: { ...event.recurrence_rule, start } }]) {
    assert.equal(liveEventMatchesExpected({ ...event, ...change }, expected), false, JSON.stringify(change));
  }
});
