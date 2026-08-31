import assert from "node:assert/strict";
import test from "node:test";
import guildScheduleData from "../../public/data/guild-schedule.json" with { type: "json" };
import {
  monthlyScheduleDate,
  nextFirstSaturday,
  nextFirstWednesday,
  scheduleLine,
  weeklyScheduleLines,
  websiteEventCardsFromSchedule,
} from "../guild-schedule.ts";
import { eventStatusAt, parseReferenceTime } from "./reference-time.ts";

const referenceTime = parseReferenceTime("2026-07-27T01:30:00.000Z");

test("ISO end boundaries use the same server reference instant", () => {
  assert.equal(eventStatusAt({ endIso: "2026-07-27T01:30:00.000Z" }, referenceTime), "upcoming");
  assert.equal(eventStatusAt({ endIso: "2026-07-27T01:29:59.999Z" }, referenceTime), "past");
});

test("date-only events compare against the UTC reference day", () => {
  assert.equal(eventStatusAt({ date: "2026-07-27" }, referenceTime), "upcoming");
  assert.equal(eventStatusAt({ date: "2026-07-26" }, referenceTime), "past");
});

test("invalid or missing event dates remain upcoming", () => {
  assert.equal(eventStatusAt({ date: "not-a-date" }, referenceTime), "upcoming");
  assert.equal(eventStatusAt({}, referenceTime), "upcoming");
});

test("invalid server reference timestamps fail closed", () => {
  assert.throws(() => parseReferenceTime("not-a-date"), /valid ISO timestamp/);
});

test("the schedule generator uses the supplied reference at an occurrence boundary", () => {
  const beforeEnd = websiteEventCardsFromSchedule(guildScheduleData, new Date("2026-07-27T13:59:59.999Z"));
  const atEnd = websiteEventCardsFromSchedule(guildScheduleData, new Date("2026-07-27T14:00:00.000Z"));

  assert.equal(beforeEnd.find((item) => item.id === "guild-party")?.date, "2026-07-27");
  assert.equal(atEnd.find((item) => item.id === "guild-party")?.date, "2026-07-28");
});

test("monthly rules keep the gathering on Wednesday and the raffle on Saturday", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");

  assert.equal(nextFirstSaturday(guildScheduleData, now), "2026-08-01");
  assert.equal(nextFirstWednesday(guildScheduleData, now), "2026-08-05");
  assert.equal(monthlyScheduleDate(guildScheduleData, "monthly-gathering", "", now), "2026-08-05");
  assert.equal(monthlyScheduleDate(guildScheduleData, "monthly-raffle", "", now), "2026-08-01");

  const gathering = websiteEventCardsFromSchedule(guildScheduleData, now)
    .find((item) => item.id === "monthly-gathering");
  assert.equal(gathering?.dayText, "First Wednesday");
  assert.equal(gathering?.timeText, "9:30 PM - 10:00 PM");
  assert.equal(gathering?.startIso, "2026-08-05T13:30:00.000Z");
  assert.equal(gathering?.endIso, "2026-08-05T14:00:00.000Z");
  assert.equal(gathering?.timezone, "UTC+8");
});

test("all public schedule lines retain minutes and one clock shape", () => {
  assert.deepEqual(weeklyScheduleLines(guildScheduleData), [
    "Guild Party: Every Day - 9:30 PM - 10:00 PM",
    "Breaking Army: Mondays & Wednesdays - 10:00 PM - 12:00 AM",
    "Showdown: Tuesdays & Thursdays - 10:00 PM - 12:00 AM",
    "Guild Wars: Saturdays & Sundays - 8:30 PM - 11:30 PM",
  ]);
});

test("schedule display fallbacks normalize valid clocks and reject malformed clocks", () => {
  assert.equal(
    scheduleLine({ title: "Fallback", dayText: "Friday", timeText: "7 PM - 8 PM" }, guildScheduleData),
    "Fallback: Friday - 7:00 PM - 8:00 PM",
  );
  assert.equal(
    scheduleLine({ title: "Fallback", dayText: "Friday", startTime: "bad", endTime: "25:00", timeText: "later" }, guildScheduleData),
    "Fallback: Friday",
  );
});

test("the monthly gathering takes its exact slot and advances the next Guild Party card", () => {
  const cards = websiteEventCardsFromSchedule(guildScheduleData, new Date("2026-08-04T14:00:00.000Z"));
  const slot = cards.filter((item) =>
    item.startIso === "2026-08-05T13:30:00.000Z" &&
    item.endIso === "2026-08-05T14:00:00.000Z" &&
    item.location === "https://mochirii.com/events"
  );

  assert.deepEqual(slot.map((item) => item.id), ["monthly-gathering"]);
  const guildParty = cards.find((item) => item.id === "guild-party");
  assert.equal(guildParty?.date, "2026-08-06");
  assert.equal(guildParty?.startIso, "2026-08-06T13:30:00.000Z");
});
