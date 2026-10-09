import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import authority from "../../public/data/guild-schedule.json" with { type: "json" };
import { type WebsiteEventCard, websiteEventCardsFromSchedule } from "../guild-schedule.ts";

// Match Next's server-component marker and JSON alias without changing the production module.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve(new URL("../../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).href, context);
    }
    if (specifier === "@/public/data/guild-schedule.json") {
      return {
        ...nextResolve(new URL("../../public/data/guild-schedule.json", import.meta.url).href, context),
        importAttributes: { type: "json" },
      };
    }
    return nextResolve(specifier, context);
  },
});
const { publicGuildSchedule } = await import("./public-schedule.ts");
hooks.deregister();

function publicFields(card: WebsiteEventCard) {
  const { id, title, date, days, dayText, startTime, endTime, startIso, endIso, timeText, timezone, location, href, summary, discord } = card;
  return { id, title, date, days, dayText, startTime, endTime, startIso, endIso, timeText, timezone, location, href, summary, discord };
}

test("the compact public projection preserves schedule behavior and versions only cover URLs", () => {
  for (const instant of [
    "2026-10-09T21:59:59.999+08:00", "2026-10-09T22:00:00+08:00",
    "2026-10-09T22:59:59.999+08:00", "2026-10-09T23:00:00+08:00",
    "2026-10-09T23:59:59.999+08:00", "2026-10-10T00:00:00+08:00",
    "2026-11-01T23:59:59.999+08:00", "2026-11-02T00:00:00+08:00",
    "2026-11-02T00:59:59.999+08:00", "2026-11-02T01:00:00+08:00",
    "2026-11-02T01:00:00.001+08:00", "2026-12-07T00:00:00+08:00",
    "2026-12-07T01:00:00+08:00", "2026-12-31T23:59:59.999+08:00",
    "2027-01-01T00:00:00+08:00", "2027-01-04T00:00:00+08:00",
    "2027-01-04T01:00:00+08:00",
  ]) {
    const now = new Date(instant);
    const expected = websiteEventCardsFromSchedule(authority, now);
    const projected = websiteEventCardsFromSchedule(publicGuildSchedule, now);
    assert.deepEqual(projected.map(publicFields), expected.map(publicFields), instant);
    for (let index = 0; index < projected.length; index += 1) {
      const actual = new URL(projected[index].image, "https://mochirii.com");
      const original = new URL(expected[index].image, "https://mochirii.com");
      assert.equal(actual.origin, original.origin);
      assert.equal(actual.pathname, original.pathname);
      assert.deepEqual([...actual.searchParams], [["v", authority.discordCoverVersion]]);
      assert.equal(projected[index].discordCoverImage, projected[index].image);
    }
  }
});

test("the browser projection excludes the inactive raffle and Discord management data", () => {
  assert.deepEqual(publicGuildSchedule.timezone, authority.timezone);
  const monthly = Object.values(publicGuildSchedule.monthly || {});
  assert.deepEqual(monthly.map((item) => item.id), ["monthly-gathering"]);
  assert.equal(monthly[0].startDayOffset, 1);
  for (const item of [...monthly, ...(publicGuildSchedule.weekly || [])]) {
    for (const field of ["discordEventId", "discordDuplicateEventIds", "discordRecurrenceRule", "discordLocation"]) {
      assert.equal(field in item, false);
    }
  }
  assert.equal("discordCoverVersion" in publicGuildSchedule, false);
});
