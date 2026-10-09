import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import guildScheduleData from "../public/data/guild-schedule.json" with { type: "json" };
import {
  currentOrUpcomingEvent,
  monthlyScheduleDate,
  nextWeeklyOccurrence,
  weeklyScheduleLines,
  websiteEventCardsFromSchedule,
  type GuildScheduleData,
} from "./guild-schedule.ts";

const firstWednesdaySchedule = {
  ...guildScheduleData,
  monthly: {
    ...guildScheduleData.monthly,
    gathering: {
      ...guildScheduleData.monthly.gathering,
      rule: "next-first-wednesday",
      startDayOffset: 0,
      startTime: "21:30",
      endTime: "22:00",
    },
  },
};

const gatheringBoundaries = [
  ["2026-11-04T21:29:00+08:00", "2026-11-04"],
  ["2026-11-04T21:30:00+08:00", "2026-11-04"],
  ["2026-11-04T21:59:59.999+08:00", "2026-11-04"],
  ["2026-11-04T22:00:00+08:00", "2026-12-02"],
  ["2026-11-04T22:00:00.001+08:00", "2026-12-02"],
] as const;

for (const [instant, expectedDate] of gatheringBoundaries) {
  test(`supported first-Wednesday fixture rolls forward at its exclusive end: ${instant}`, () => {
    const now = new Date(instant);
    assert.equal(monthlyScheduleDate(firstWednesdaySchedule, "monthly-gathering", "", now), expectedDate);
    const cards = websiteEventCardsFromSchedule(firstWednesdaySchedule, now);
    const gathering = cards.find((card) => card.id === "monthly-gathering");
    assert.equal(gathering?.date, expectedDate);
    assert.equal(gathering?.startIso, `${expectedDate}T13:30:00.000Z`);
    assert.equal(gathering?.endIso, `${expectedDate}T14:00:00.000Z`);
    assert.equal(gathering?.timezone, "UTC+8");
    assert.equal(currentOrUpcomingEvent(cards, now)?.id, expectedDate === "2026-11-04" ? "monthly-gathering" : "breaking-army");
  });
}

test("monthly occurrences remain current overnight and roll across month and year boundaries", () => {
  const overnight: GuildScheduleData = {
    timezone: guildScheduleData.timezone,
    monthly: {
      gathering: {
        ...firstWednesdaySchedule.monthly.gathering,
        startTime: "23:30",
        endTime: "01:00",
      },
    },
  };
  assert.equal(monthlyScheduleDate(overnight, "monthly-gathering", "", new Date("2026-11-05T00:30:00+08:00")), "2026-11-04");
  assert.equal(monthlyScheduleDate(overnight, "monthly-gathering", "", new Date("2026-11-05T01:00:00+08:00")), "2026-12-02");
  for (const [instant, expectedDate] of [
    ["2026-12-02T22:00:00+08:00", "2027-01-06"],
    ["2026-12-31T23:59:59.999+08:00", "2027-01-06"],
    ["2027-01-01T00:00:00+08:00", "2027-01-06"],
    ["2027-01-06T22:00:00+08:00", "2027-02-03"],
  ]) {
    assert.equal(monthlyScheduleDate(firstWednesdaySchedule, "monthly-gathering", "", new Date(instant)), expectedDate);
  }
});

test("announcement schedule lines retain authoritative clocks and timezone labels", () => {
  assert.deepEqual(weeklyScheduleLines(guildScheduleData), [
    "Guild Party: Every Day - 9:30 PM - 10:00 PM - UTC+8",
    "Breaking Army: Mondays & Wednesdays - 10:00 PM - 12:00 AM - UTC+8",
    "Showdown: Tuesdays & Thursdays - 10:00 PM - 12:00 AM - UTC+8",
    "Guild Wars: Saturdays & Sundays - 8:30 PM - 11:00 PM - UTC+8",
  ]);
});

test("the retained first-Saturday schedule also rolls at its end without activating a public raffle", () => {
  assert.equal(monthlyScheduleDate(guildScheduleData, "monthly-raffle", "", new Date("2026-11-07T21:59:59.999+08:00")), "2026-11-07");
  assert.equal(monthlyScheduleDate(guildScheduleData, "monthly-raffle", "", new Date("2026-11-07T22:00:00+08:00")), "2026-12-05");
  assert.equal(monthlyScheduleDate(guildScheduleData, "monthly-raffle", "", new Date("2026-12-05T22:00:00+08:00")), "2027-01-02");
});

test("Home and Events selection hands Friday from Skyward Bond to Hero's Realm, then closes at midnight", () => {
  for (const [instant, expectedId, expectedDate] of [
    ["2026-10-09T21:29:00+08:00", "guild-party", "2026-10-09"],
    ["2026-10-09T21:30:00+08:00", "guild-party", "2026-10-09"],
    ["2026-10-09T22:00:00+08:00", "united-resolve", "2026-10-09"],
    ["2026-10-09T22:59:59.999+08:00", "united-resolve", "2026-10-09"],
    ["2026-10-09T23:00:00+08:00", "guild-heros-realm", "2026-10-09"],
    ["2026-10-09T23:59:59.999+08:00", "guild-heros-realm", "2026-10-09"],
    ["2026-10-10T00:00:00+08:00", "guild-wars", "2026-10-10"],
  ]) {
    const now = new Date(instant);
    const selected = currentOrUpcomingEvent(websiteEventCardsFromSchedule(guildScheduleData, now), now);
    assert.equal(selected?.id, expectedId, instant);
    assert.equal(selected?.date, expectedDate, instant);
  }
});

test("selection skips ended cards, orders active cards before future cards, and preserves input", () => {
  const cards = websiteEventCardsFromSchedule(guildScheduleData, new Date("2026-10-09T21:00:00+08:00"));
  const originalIds = cards.map((card) => card.id);
  assert.equal(currentOrUpcomingEvent(cards, new Date("2026-10-09T23:00:00+08:00"))?.id, "guild-heros-realm");
  assert.deepEqual(cards.map((card) => card.id), originalIds);
  assert.equal(currentOrUpcomingEvent([], new Date("2026-10-09T23:00:00+08:00")), undefined);
  assert.equal(currentOrUpcomingEvent(cards.slice(0, 1), new Date("2026-10-09T22:00:00+08:00")), undefined);
});

test("confirmed Guild Wars close at 23:00 UTC+8 on Saturday and Sunday", () => {
  for (const [instant, expectedDate, selectedId] of [
    ["2026-10-10T22:59:59.999+08:00", "2026-10-10", "guild-wars"],
    ["2026-10-10T23:00:00+08:00", "2026-10-11", "guild-wars"],
    ["2026-10-10T23:00:00.001+08:00", "2026-10-11", "guild-wars"],
    ["2026-10-11T22:59:59.999+08:00", "2026-10-11", "guild-wars"],
    ["2026-10-11T23:00:00+08:00", "2026-10-17", "guild-party"],
    ["2026-10-11T23:00:00.001+08:00", "2026-10-17", "guild-party"],
  ]) {
    const now = new Date(instant);
    const cards = websiteEventCardsFromSchedule(guildScheduleData, now);
    const wars = cards.find((card) => card.id === "guild-wars");
    assert.equal(wars?.date, expectedDate, instant);
    assert.equal(wars?.startIso, `${expectedDate}T12:30:00.000Z`, instant);
    assert.equal(wars?.endIso, `${expectedDate}T15:00:00.000Z`, instant);
    assert.equal(wars?.timeText, "8:30 PM - 11:00 PM");
    assert.equal(wars?.timezone, "UTC+8");
    assert.equal(currentOrUpcomingEvent(cards, now)?.id, selectedId, instant);
  }
});

test("weekly overnight occurrences retain the previous date until their exclusive end", () => {
  const item = { id: "overnight", days: [4], startTime: "23:00", endTime: "01:00" };
  const beforeEnd = nextWeeklyOccurrence(guildScheduleData, item, new Date("2027-01-01T00:59:59.999+08:00"));
  assert.equal(beforeEnd?.date, "2026-12-31");
  assert.equal(beforeEnd?.startIso, "2026-12-31T15:00:00.000Z");
  assert.equal(beforeEnd?.endIso, "2026-12-31T17:00:00.000Z");
  assert.equal(nextWeeklyOccurrence(guildScheduleData, item, new Date("2027-01-01T01:00:00+08:00"))?.date, "2027-01-07");
});

test("first-Wednesday gathering suppresses only the exact Guild Party slot", () => {
  const now = new Date("2026-11-04T21:30:00+08:00");
  const cards = websiteEventCardsFromSchedule(firstWednesdaySchedule, now);
  assert.equal(currentOrUpcomingEvent(cards, now)?.id, "monthly-gathering");
  assert.equal(cards.find((card) => card.id === "guild-party")?.date, "2026-11-05");
  for (const change of [{ startTime: "21:31" }, { endTime: "22:01" }, { location: "https://mochirii.com/events#other" }]) {
    const schedule: GuildScheduleData = {
      ...firstWednesdaySchedule,
      monthly: { gathering: { ...firstWednesdaySchedule.monthly.gathering, ...change } },
    };
    assert.equal(websiteEventCardsFromSchedule(schedule, now).find((card) => card.id === "guild-party")?.date, "2026-11-04");
  }
  const afterEnd = websiteEventCardsFromSchedule(firstWednesdaySchedule, new Date("2026-11-04T22:00:00+08:00"));
  assert.equal(afterEnd.find((card) => card.id === "guild-party")?.date, "2026-11-05");
  assert.equal(afterEnd.find((card) => card.id === "monthly-gathering")?.date, "2026-12-02");
  assert.equal(cards.some((card) => card.id === "monthly-raffle"), false);
});

const confirmedGatheringBoundaries = [
  ["2026-11-01T23:59:59.999+08:00", "2026-11-02", "2026-11-01"],
  ["2026-11-02T00:00:00+08:00", "2026-11-02", "2026-11-01"],
  ["2026-11-02T00:59:59.999+08:00", "2026-11-02", "2026-11-01"],
  ["2026-11-02T01:00:00+08:00", "2026-12-07", "2026-12-06"],
  ["2026-11-02T01:00:00.001+08:00", "2026-12-07", "2026-12-06"],
  ["2026-12-07T01:00:00+08:00", "2027-01-04", "2027-01-03"],
  ["2026-12-31T23:59:59.999+08:00", "2027-01-04", "2027-01-03"],
  ["2027-01-01T00:00:00+08:00", "2027-01-04", "2027-01-03"],
  ["2027-01-04T01:00:00+08:00", "2027-02-08", "2027-02-07"],
  ["2027-02-01T00:00:00+08:00", "2027-02-08", "2027-02-07"],
  ["2027-02-08T00:59:59.999+08:00", "2027-02-08", "2027-02-07"],
  ["2027-02-08T01:00:00+08:00", "2027-03-08", "2027-03-07"],
] as const;

test("confirmed gathering starts on the Monday after the first Sunday and rolls at 01:00 UTC+8", () => {
  for (const [instant, expectedDate, utcDate] of confirmedGatheringBoundaries) {
    const now = new Date(instant);
    assert.equal(monthlyScheduleDate(guildScheduleData, "monthly-gathering", "", now), expectedDate, instant);
    const gathering = websiteEventCardsFromSchedule(guildScheduleData, now).find((card) => card.id === "monthly-gathering");
    assert.equal(gathering?.date, expectedDate, instant);
    assert.equal(gathering?.startIso, `${utcDate}T16:00:00.000Z`, instant);
    assert.equal(gathering?.endIso, `${utcDate}T17:00:00.000Z`, instant);
    assert.equal(gathering?.dayText, "After the first Sunday");
    assert.equal(gathering?.timeText, "12:00 AM - 1:00 AM");
    assert.equal(gathering?.timezone, "UTC+8");
  }
});

test("current gathering leaves all Guild Party occurrences intact", () => {
  for (const [instant, expectedPartyDate] of [
    ["2026-11-01T21:30:00+08:00", "2026-11-01"],
    ["2026-11-02T00:00:00+08:00", "2026-11-02"],
  ]) {
    const cards = websiteEventCardsFromSchedule(guildScheduleData, new Date(instant));
    assert.equal(cards.find((card) => card.id === "guild-party")?.date, expectedPartyDate);
  }
});

test("Website participation links never fall back to Reaper event locations", () => {
  const before = structuredClone(guildScheduleData);
  const cards = websiteEventCardsFromSchedule(guildScheduleData, new Date("2026-10-09T20:00:00+08:00"));
  for (const card of cards) {
    const source = card.id === "monthly-gathering"
      ? guildScheduleData.monthly.gathering
      : guildScheduleData.weekly.find((item) => item.id === card.id);
    assert.ok(source, card.id);
    assert.equal(card.location, source.location, card.id);
    assert.equal(card.href, "href" in source ? source.href : undefined, card.id);
    assert.notEqual(card.href, card.location, card.id);
  }
  assert.deepEqual(guildScheduleData, before);
  const custom: GuildScheduleData = {
    ...guildScheduleData,
    weekly: [{ ...guildScheduleData.weekly[0], href: "https://example.com/event-details" }],
  };
  assert.equal(websiteEventCardsFromSchedule(custom, new Date("2026-10-09T20:00:00+08:00"))
    .find((card) => card.id === "guild-party")?.href, "https://example.com/event-details");
});

test("Skyward Bond retains its stable key before Hero's Realm in adjacent Friday slots", () => {
  const now = new Date("2026-10-09T22:00:00+08:00");
  const cards = websiteEventCardsFromSchedule(guildScheduleData, now);
  const skyward = cards.find((card) => card.id === "united-resolve");
  const hero = cards.find((card) => card.id === "guild-heros-realm");
  assert.equal(skyward?.title, "Skyward Bond");
  assert.equal(skyward?.startIso, "2026-10-09T14:00:00.000Z");
  assert.equal(skyward?.endIso, "2026-10-09T15:00:00.000Z");
  assert.equal(hero?.startIso, skyward?.endIso);
  assert.equal(hero?.endIso, "2026-10-09T16:00:00.000Z");
  assert.equal(hero?.date, "2026-10-09");
  for (const instant of ["2026-10-09T23:00:00+08:00", "2026-10-09T23:00:00.001+08:00"]) {
    const upcoming = websiteEventCardsFromSchedule(guildScheduleData, new Date(instant));
    assert.equal(upcoming.find((card) => card.id === "united-resolve")?.date, "2026-10-16");
    assert.equal(upcoming.find((card) => card.id === "guild-heros-realm")?.date, "2026-10-09");
  }
  assert.equal(websiteEventCardsFromSchedule(guildScheduleData, new Date("2026-10-10T00:00:00+08:00"))
    .find((card) => card.id === "guild-heros-realm")?.date, "2026-10-16");
});

test("authoritative dates, ISO timestamps and display times are independent of host timezone", () => {
  const helperUrl = new URL("./guild-schedule.ts", import.meta.url).href;
  const scheduleUrl = new URL("../public/data/guild-schedule.json", import.meta.url).href;
  const source = `
    import { websiteEventCardsFromSchedule, weeklyScheduleLines } from ${JSON.stringify(helperUrl)};
    import schedule from ${JSON.stringify(scheduleUrl)} with { type: "json" };
    const instants = ${JSON.stringify([...gatheringBoundaries, ...confirmedGatheringBoundaries].map(([instant]) => instant))};
    console.log(JSON.stringify({ cards: instants.map(instant => websiteEventCardsFromSchedule(schedule, new Date(instant))), lines: weeklyScheduleLines(schedule) }));
  `;
  const results = ["Asia/Singapore", "UTC", "America/Los_Angeles", "Pacific/Kiritimati"].map((timezone) =>
    execFileSync(process.execPath, ["--experimental-default-type=module", "--experimental-strip-types", "--input-type=module", "-e", source], {
      encoding: "utf8",
      env: { ...process.env, TZ: timezone, NODE_NO_WARNINGS: "1" },
      windowsHide: true,
    }).trim()
  );
  for (const result of results) assert.equal(result, results[0]);
});
