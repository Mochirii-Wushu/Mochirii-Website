import {
  DISCORD_EVENT_ENTITY_EXTERNAL,
  DISCORD_EVENT_PRIVACY_GUILD_ONLY,
  desiredEventsFromSchedule,
  eventCoverImageData,
  eventLocation,
  managedEventLine,
  recurrenceRule,
  scheduledEventBody,
} from "./reaper-discord-events.ts";
import {
  indexManagedEventResources,
  selectExistingScheduledEvent,
  supersededManagedEventResources,
} from "./reaper-event-sync-workflow.ts";
import { siteUrl } from "./public-origins.ts";
import guildScheduleData from "../../../apps/web/public/data/guild-schedule.json" with { type: "json" };
import { websiteEventCardsFromSchedule } from "../../../apps/web/lib/guild-schedule.ts";

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
      discordRecurrenceRule: { frequency: 1, interval: 1, by_n_weekday: [{ n: 1, day: 2 }] },
    },
  },
};

Deno.test("canonical schedule produces eight stable activity keys and the supported native recurrence rules", () => {
  const before = structuredClone(guildScheduleData);
  const events = desiredEventsFromSchedule(guildScheduleData, new Date("2026-10-11T12:00:00+08:00"));
  assertEquals(events.map((event) => event.key), [
    "monthly-gathering", "monthly-raffle", "guild-party", "breaking-army", "showdown", "guild-wars", "guild-heros-realm", "united-resolve",
  ]);
  assertEquals(new Set(events.map((event) => event.key)).size, 8);
  for (const item of guildScheduleData.weekly) {
    const event = events.find((entry) => entry.key === item.id);
    assert(event);
    assertEquals(event.legacyKeys, item.days.map((day) => `${item.id}-${day}`));
    assertEquals(event.canonicalEventId, null);
    assertEquals(event.duplicateEventIds, []);
    assertEquals(event.coverImageUrl, siteUrl(item.discordCoverImage.slice(2) + "?v=" + guildScheduleData.discordCoverVersion));
    if (item.id === "breaking-army" || item.id === "showdown") assertEquals(event.recurrenceRule, null);
    else {
      assertEquals(event.recurrenceRule?.start, event.startIso);
      assertEquals(event.recurrenceRule?.interval, 1);
      assertEquals(event.recurrenceRule?.frequency, item.id === "guild-party" || item.id === "guild-wars" ? 3 : 2);
      assertEquals(event.recurrenceRule?.by_weekday, item.id === "guild-party" ? undefined : item.id === "guild-wars" ? [5, 6] : [4]);
    }
  }
  assertEquals(guildScheduleData, before);
});

Deno.test("native weekdays derive from UTC start day, including early local hours and supported daily sets", () => {
  const schedule = (days: number[], startTime = "00:30") => ({
    timezone: guildScheduleData.timezone,
    weekly: [{ id: "test", title: "Test", discord: true, days, startTime, endTime: "01:30" }],
  });
  for (const [days, frequency, weekdays] of [
    [[5], 2, [3]],
    [[6, 0], 3, [4, 5]],
    [[0, 1], 3, [5, 6]],
    [[1, 2, 3, 4, 5], 3, [0, 1, 2, 3, 6]],
  ] as Array<[number[], number, number[]]>) {
    const event = desiredEventsFromSchedule(schedule(days), new Date("2026-10-11T00:00:00+08:00"))[0];
    assertEquals(event.recurrenceRule, { start: event.startIso, interval: 1, frequency, by_weekday: weekdays });
    assert(weekdays.includes((new Date(event.startIso).getUTCDay() + 6) % 7));
  }
  const daily = desiredEventsFromSchedule(schedule([0, 1, 2, 3, 4, 5, 6]), new Date("2026-10-11T00:00:00+08:00"))[0];
  assertEquals(daily.recurrenceRule, { start: daily.startIso, interval: 1, frequency: 3 });
});

Deno.test("Army and Showdown roll across their two weekdays, exclusive midnight ends and year boundaries", () => {
  for (const [id, instant, expectedDate] of [
    ["breaking-army", "2026-10-12T21:59:59.999+08:00", "2026-10-12"],
    ["breaking-army", "2026-10-12T22:00:00+08:00", "2026-10-12"],
    ["breaking-army", "2026-10-12T23:59:59.999+08:00", "2026-10-12"],
    ["breaking-army", "2026-10-13T00:00:00+08:00", "2026-10-14"],
    ["breaking-army", "2026-10-13T00:00:00.001+08:00", "2026-10-14"],
    ["breaking-army", "2026-10-14T23:59:59.999+08:00", "2026-10-14"],
    ["breaking-army", "2026-10-15T00:00:00+08:00", "2026-10-19"],
    ["breaking-army", "2026-12-31T00:00:00+08:00", "2027-01-04"],
    ["showdown", "2026-10-13T23:59:59.999+08:00", "2026-10-13"],
    ["showdown", "2026-10-14T00:00:00+08:00", "2026-10-15"],
    ["showdown", "2026-10-14T00:00:00.001+08:00", "2026-10-15"],
    ["showdown", "2026-10-15T23:59:59.999+08:00", "2026-10-15"],
    ["showdown", "2026-10-16T00:00:00+08:00", "2026-10-20"],
    ["showdown", "2026-12-31T23:59:59.999+08:00", "2026-12-31"],
    ["showdown", "2027-01-01T00:00:00+08:00", "2027-01-05"],
  ]) {
    const events = desiredEventsFromSchedule(guildScheduleData, new Date(instant));
    const event = events.find((entry) => entry.key === id);
    assertEquals(events.filter((entry) => entry.key === id).length, 1);
    assertEquals(event?.startIso, `${expectedDate}T14:00:00.000Z`);
    assertEquals(event?.endIso, `${expectedDate}T16:00:00.000Z`);
    assertEquals(event?.recurrenceRule, null);
  }
});

Deno.test("Discord event payloads contain the derived recurrence and exclude registry transition keys", async () => {
  for (const event of desiredEventsFromSchedule(guildScheduleData, new Date("2026-10-11T12:00:00+08:00"))) {
    const body = await scheduledEventBody(event, false);
    assertEquals(body.scheduled_start_time, event.startIso);
    assertEquals(body.scheduled_end_time, event.endIso);
    assertEquals(body.recurrence_rule, event.recurrenceRule || undefined);
    assertEquals(Object.hasOwn(body, "legacyKeys"), false);
    assertEquals(Object.hasOwn(body, "key"), false);
  }
});

Deno.test("supported first-Wednesday fixture uses end-exclusive November, December and January rollover", () => {
  for (const [instant, expectedDate] of [
    ["2026-11-04T21:29:00+08:00", "2026-11-04"],
    ["2026-11-04T21:30:00+08:00", "2026-11-04"],
    ["2026-11-04T21:59:59.999+08:00", "2026-11-04"],
    ["2026-11-04T22:00:00+08:00", "2026-12-02"],
    ["2026-11-04T22:00:00.001+08:00", "2026-12-02"],
    ["2026-12-02T22:00:00+08:00", "2027-01-06"],
    ["2026-12-31T23:59:59.999+08:00", "2027-01-06"],
    ["2027-01-01T00:00:00+08:00", "2027-01-06"],
    ["2027-01-06T22:00:00+08:00", "2027-02-03"],
  ]) {
    const gathering = desiredEventsFromSchedule(firstWednesdaySchedule, new Date(instant))
      .find((event) => event.key === "monthly-gathering");
    assertEquals(gathering?.startIso, `${expectedDate}T13:30:00.000Z`);
    assertEquals(gathering?.endIso, `${expectedDate}T14:00:00.000Z`);
    assertEquals(gathering?.recurrenceRule?.start, gathering?.startIso);
  }
});

Deno.test("monthly and weekly overnight occurrences remain current after UTC+8 midnight", () => {
  const schedule = {
    timezone: guildScheduleData.timezone,
    monthly: { gathering: { ...firstWednesdaySchedule.monthly.gathering, startTime: "23:30", endTime: "01:00" } },
    weekly: [{ id: "overnight", title: "Overnight", discord: true, days: [3], startTime: "23:00", endTime: "01:00" }],
  };
  const beforeEnd = desiredEventsFromSchedule(schedule, new Date("2026-11-05T00:59:59.999+08:00"));
  assertEquals(beforeEnd.find((event) => event.key === "monthly-gathering")?.startIso, "2026-11-04T15:30:00.000Z");
  assertEquals(beforeEnd.find((event) => event.key === "overnight")?.startIso, "2026-11-04T15:00:00.000Z");
  const atEnd = desiredEventsFromSchedule(schedule, new Date("2026-11-05T01:00:00+08:00"));
  assertEquals(atEnd.find((event) => event.key === "monthly-gathering")?.startIso, "2026-12-02T15:30:00.000Z");
  assertEquals(atEnd.find((event) => event.key === "overnight")?.startIso, "2026-11-11T15:00:00.000Z");
});

Deno.test("existing first-Saturday raffle scheduling rolls at the exclusive end", () => {
  for (const [instant, expectedDate] of [
    ["2026-11-07T21:59:59.999+08:00", "2026-11-07"],
    ["2026-11-07T22:00:00+08:00", "2026-12-05"],
    ["2026-12-05T22:00:00+08:00", "2027-01-02"],
  ]) {
    const raffle = desiredEventsFromSchedule(guildScheduleData, new Date(instant))
      .find((event) => event.key === "monthly-raffle");
    assertEquals(raffle?.startIso, `${expectedDate}T13:30:00.000Z`);
    assertEquals(raffle?.endIso, `${expectedDate}T14:00:00.000Z`);
  }
});

Deno.test("Reaper timing descriptions include UTC+8 while existing descriptions and summaries remain intact", () => {
  const events = desiredEventsFromSchedule(guildScheduleData, new Date("2026-10-09T20:00:00+08:00"));
  const timingIds = ["guild-party", "breaking-army", "showdown", "guild-wars"];
  for (const id of timingIds) {
    const item = guildScheduleData.weekly.find((entry) => entry.id === id);
    assert(item, `${id} schedule must exist`);
    const instances = events.filter((event) => event.key === id);
    assertEquals(instances.length, 1);
    for (const event of instances) assertEquals(event.description, `${item.timeText} - UTC+8`);
  }
  assertEquals(events.find((event) => event.key === "monthly-gathering")?.description, guildScheduleData.monthly.gathering.description);
  assertEquals(events.find((event) => event.key === "monthly-raffle")?.description, guildScheduleData.monthly.raffle.description);
  for (const id of ["guild-heros-realm", "united-resolve"]) {
    const item = guildScheduleData.weekly.find((entry) => entry.id === id);
    assertEquals(events.find((event) => event.key === id)?.description, item?.summary);
  }
});

Deno.test("Guild Wars retains one weekend series and advances at its 23:00 UTC+8 exclusive end", () => {
  for (const [instant, date] of [
    ["2026-10-10T22:59:59.999+08:00", "2026-10-10"],
    ["2026-10-10T23:00:00+08:00", "2026-10-11"],
    ["2026-10-10T23:00:00.001+08:00", "2026-10-11"],
    ["2026-10-11T22:59:59.999+08:00", "2026-10-11"],
    ["2026-10-11T23:00:00+08:00", "2026-10-17"],
    ["2026-10-11T23:00:00.001+08:00", "2026-10-17"],
  ]) {
    const now = new Date(instant);
    const events = desiredEventsFromSchedule(guildScheduleData, now);
    const wars = events.find((event) => event.key === "guild-wars");
    assertEquals(wars?.startIso, `${date}T12:30:00.000Z`);
    assertEquals(wars?.endIso, `${date}T15:00:00.000Z`);
    assertEquals(wars?.description, "8:30 PM - 11:00 PM - UTC+8");
    assertEquals(wars?.recurrenceRule, { start: wars?.startIso, interval: 1, frequency: 3, by_weekday: [5, 6] });
    assertEquals(events.filter((event) => event.key === "guild-wars").length, 1);
    const card = websiteEventCardsFromSchedule(guildScheduleData, now).find((item) => item.id === "guild-wars");
    assertEquals(wars?.startIso, card?.startIso);
    assertEquals(wars?.endIso, card?.endIso);
  }
});

Deno.test("Reaper matches every Website occurrence across handoff, midnight and gathering boundaries", () => {
  for (const instant of [
    "2026-10-09T22:59:59.999+08:00", "2026-10-09T23:00:00+08:00",
    "2026-10-09T23:59:59.999+08:00", "2026-10-10T00:00:00+08:00",
    "2026-11-04T21:29:00+08:00", "2026-11-04T21:30:00+08:00",
    "2026-11-04T21:59:59.999+08:00", "2026-11-04T22:00:00+08:00",
    "2026-11-04T22:00:00.001+08:00", "2026-12-31T23:59:59.999+08:00",
    "2027-01-01T00:00:00+08:00",
    "2026-11-01T23:59:59.999+08:00", "2026-11-02T00:00:00+08:00",
    "2026-11-02T00:59:59.999+08:00", "2026-11-02T01:00:00+08:00",
    "2026-11-02T01:00:00.001+08:00", "2027-02-01T00:00:00+08:00",
  ]) {
    const now = new Date(instant);
    const desired = desiredEventsFromSchedule(guildScheduleData, now);
    const cards = websiteEventCardsFromSchedule(guildScheduleData, now);
    for (const card of cards) {
      assert(desired.some((event) =>
        event.key === card.id &&
        event.startIso === card.startIso && event.endIso === card.endIso && event.websiteLocation === card.location
      ), `${card.id} must match at ${instant}`);
    }
    assert(desired.some((event) => event.key === "monthly-raffle"), "existing Reaper raffle remains pending a decision");
    assert(!cards.some((card) => card.id === "monthly-raffle"), "public raffle remains inactive");
  }
});

Deno.test("collision suppression chooses the next Party day and requires exact clocks and Website location", () => {
  const now = new Date("2026-11-04T21:30:00+08:00");
  const collided = desiredEventsFromSchedule(firstWednesdaySchedule, now);
  assertEquals(collided.find((event) => event.key === "guild-party")?.startIso, "2026-11-05T13:30:00.000Z");
  assertEquals(collided.find((event) => event.key === "guild-party")?.recurrenceRule, null);
  assertEquals(collided.filter((event) => event.key === "guild-party").length, 1);
  for (const change of [{ startTime: "21:31" }, { endTime: "22:01" }, { location: "https://mochirii.com/events#other" }]) {
    const schedule = {
      ...firstWednesdaySchedule,
      monthly: { gathering: { ...firstWednesdaySchedule.monthly.gathering, ...change } },
    };
    const desired = desiredEventsFromSchedule(schedule, now);
    assertEquals(desired.find((event) => event.key === "guild-party")?.startIso, "2026-11-04T13:30:00.000Z");
    assertEquals(desired.find((event) => event.key === "guild-party")?.recurrenceRule?.frequency, 3);
  }
});

Deno.test("potential monthly collisions use rolling events without suppressing neighboring Party days", () => {
  for (const [instant, date] of [
    ["2026-11-03T21:30:00+08:00", "2026-11-03"],
    ["2026-11-03T22:00:00+08:00", "2026-11-05"],
    ["2026-11-04T21:59:59.999+08:00", "2026-11-05"],
    ["2026-11-04T22:00:00+08:00", "2026-11-05"],
    ["2026-11-05T21:30:00+08:00", "2026-11-05"],
    ["2026-11-05T22:00:00+08:00", "2026-11-06"],
    ["2026-11-11T21:30:00+08:00", "2026-11-11"],
  ]) {
    const events = desiredEventsFromSchedule(firstWednesdaySchedule, new Date(instant));
    const party = events.find((event) => event.key === "guild-party");
    assertEquals(party?.startIso, `${date}T13:30:00.000Z`);
    assertEquals(party?.recurrenceRule, null);
    const card = websiteEventCardsFromSchedule(firstWednesdaySchedule, new Date(instant)).find((event) => event.id === "guild-party");
    assertEquals(party?.startIso, card?.startIso);
    assertEquals(party?.endIso, card?.endIso);
  }
  const mondayOnly = {
    ...firstWednesdaySchedule,
    weekly: [{ ...guildScheduleData.weekly[0], days: [1] }],
  };
  assertEquals(desiredEventsFromSchedule(mondayOnly, new Date("2026-11-01T12:00:00+08:00"))
    .find((event) => event.key === "guild-party")?.recurrenceRule?.by_weekday, [0]);
});

Deno.test("confirmed gathering occurs after the first Sunday with a Sunday UTC recurrence and exclusive end", () => {
  for (const [instant, utcDate] of [
    ["2026-11-01T23:59:59.999+08:00", "2026-11-01"],
    ["2026-11-02T00:00:00+08:00", "2026-11-01"],
    ["2026-11-02T00:59:59.999+08:00", "2026-11-01"],
    ["2026-11-02T01:00:00+08:00", "2026-12-06"],
    ["2026-11-02T01:00:00.001+08:00", "2026-12-06"],
    ["2026-12-07T01:00:00+08:00", "2027-01-03"],
    ["2026-12-31T23:59:59.999+08:00", "2027-01-03"],
    ["2027-01-01T00:00:00+08:00", "2027-01-03"],
    ["2027-01-04T01:00:00+08:00", "2027-02-07"],
    ["2027-02-01T00:00:00+08:00", "2027-02-07"],
    ["2027-02-08T00:59:59.999+08:00", "2027-02-07"],
    ["2027-02-08T01:00:00+08:00", "2027-03-07"],
  ]) {
    const gathering = desiredEventsFromSchedule(guildScheduleData, new Date(instant)).find((event) => event.key === "monthly-gathering");
    assertEquals(gathering?.startIso, `${utcDate}T16:00:00.000Z`);
    assertEquals(gathering?.endIso, `${utcDate}T17:00:00.000Z`);
    assertEquals(gathering?.recurrenceRule?.start, gathering?.startIso);
    assertEquals(gathering?.recurrenceRule?.by_n_weekday, [{ n: 1, day: 6 }]);
  }
});

Deno.test("current gathering leaves the single daily Guild Party series intact", () => {
  const now = new Date("2026-11-01T21:30:00+08:00");
  const desired = desiredEventsFromSchedule(guildScheduleData, now);
  assertEquals(desired.find((event) => event.key === "guild-party")?.startIso, "2026-11-01T13:30:00.000Z");
  assertEquals(desired.find((event) => event.key === "monthly-gathering")?.startIso, "2026-11-01T16:00:00.000Z");
  assertEquals(desired.filter((event) => event.key === "guild-party").length, 1);
  assertEquals(desired.find((event) => event.key === "guild-party")?.recurrenceRule?.frequency, 3);
});

Deno.test("Skyward Bond hands off to Hero's Realm at 23:00 and Hero's Realm closes at UTC+8 midnight", () => {
  for (const [instant, skywardDate, heroDate] of [
    ["2026-10-09T21:59:59.999+08:00", "2026-10-09", "2026-10-09"],
    ["2026-10-09T22:00:00+08:00", "2026-10-09", "2026-10-09"],
    ["2026-10-09T22:59:59.999+08:00", "2026-10-09", "2026-10-09"],
    ["2026-10-09T23:00:00+08:00", "2026-10-16", "2026-10-09"],
    ["2026-10-09T23:00:00.001+08:00", "2026-10-16", "2026-10-09"],
    ["2026-10-09T23:59:59.999+08:00", "2026-10-16", "2026-10-09"],
    ["2026-10-10T00:00:00+08:00", "2026-10-16", "2026-10-16"],
  ]) {
    const desired = desiredEventsFromSchedule(guildScheduleData, new Date(instant));
    const skyward = desired.find((item) => item.key === "united-resolve");
    const hero = desired.find((item) => item.key === "guild-heros-realm");
    assertEquals(skyward?.startIso, `${skywardDate}T14:00:00.000Z`);
    assertEquals(skyward?.endIso, `${skywardDate}T15:00:00.000Z`);
    assertEquals(hero?.startIso, `${heroDate}T15:00:00.000Z`);
    assertEquals(hero?.endIso, `${heroDate}T16:00:00.000Z`);
    assertEquals(skyward?.title, "Skyward Bond");
    assertEquals(desired.filter((item) => item.key === "united-resolve").length, 1);
  }
});

Deno.test("desiredEventsFromSchedule shapes monthly and weekly website schedule events", () => {
  const events = desiredEventsFromSchedule(
    {
      timezone: { offsetMinutes: 0 },
      discordCoverVersion: "v2",
      monthly: {
        gathering: {
          id: "monthly-gathering",
          title: "Monthly Gathering",
          rule: "next-first-wednesday",
          description: "Guild monthly gathering",
          location: siteUrl("events#gathering"),
          startTime: "21:30",
          endTime: "22:00",
          discordRecurrenceRule: {
            frequency: 1,
            interval: 1,
            by_n_weekday: [{ n: 1, day: 2 }],
          },
        },
        raffle: {
          id: "monthly-raffle",
          title: "Monthly Raffle",
          rule: "next-first-saturday",
          description: "Guild monthly raffle",
          location: siteUrl("events#raffle"),
          discordLocation: "Mochirii Hall",
          startTime: "20:00",
          endTime: "21:00",
          discordCoverImage: "assets/images/reaper.webp",
          discordEventId: "123456789012345678",
          discordDuplicateEventIds: ["223456789012345678", "bad"],
          discordRecurrenceRule: {
            frequency: 1,
            interval: 1,
            by_n_weekday: [{ n: 1, day: 6 }],
          },
        },
      },
      weekly: [
        {
          id: "training",
          discord: true,
          title: "Training",
          description: "Weekly training",
          location: siteUrl("events#training"),
          discordLocation: "Training Grounds",
          startTime: "22:00",
          endTime: "23:00",
          days: [5],
        },
      ],
    },
    new Date("2026-07-02T12:00:00.000Z"),
  );

  assertEquals(events.length, 3);

  const gathering = events.find((event) => event.key === "monthly-gathering");
  assert(gathering, "monthly gathering should exist");
  assertEquals(gathering.startIso, "2026-08-05T21:30:00.000Z");
  assertEquals(gathering.endIso, "2026-08-05T22:00:00.000Z");
  assertEquals(gathering.recurrenceRule?.by_n_weekday, [{ n: 1, day: 2 }]);

  const monthly = events.find((event) => event.key === "monthly-raffle");
  assert(monthly, "monthly event should exist");
  assertEquals(monthly.startIso, "2026-07-04T20:00:00.000Z");
  assertEquals(monthly.endIso, "2026-07-04T21:00:00.000Z");
  assertEquals(monthly.location, "Mochirii Hall");
  assertEquals(monthly.canonicalEventId, "123456789012345678");
  assertEquals(monthly.duplicateEventIds, ["223456789012345678"]);
  assert(monthly.coverImageUrl?.startsWith(siteUrl("assets/images/reaper.webp?v=v2")));
  assertEquals(monthly.recurrenceRule?.start, monthly.startIso);

  const weekly = events.find((event) => event.key === "training");
  assert(weekly, "weekly event should exist");
  assertEquals(weekly.startIso, "2026-07-03T22:00:00.000Z");
  assertEquals(weekly.endIso, "2026-07-03T23:00:00.000Z");
  assertEquals(weekly.legacyKeys, ["training-5"]);
  assertEquals(weekly.recurrenceRule, { start: weekly.startIso, interval: 1, frequency: 2, by_weekday: [4] });
});

Deno.test("the monthly gathering takes its exact slot and advances the colliding Guild Party event", () => {
  const events = desiredEventsFromSchedule(
    {
      timezone: { offsetMinutes: 480 },
      monthly: {
        gathering: {
          id: "monthly-gathering",
          title: "Monthly Guild Gathering",
          rule: "next-first-wednesday",
          location: siteUrl("events"),
          startTime: "21:30",
          endTime: "22:00",
          discordRecurrenceRule: {
            frequency: 1,
            interval: 1,
            by_n_weekday: [{ n: 1, day: 2 }],
          },
        },
      },
      weekly: [{
        id: "guild-party",
        discord: true,
        title: "Guild Party",
        location: siteUrl("events"),
        startTime: "21:30",
        endTime: "22:00",
        days: [3],
      }],
    },
    new Date("2026-08-04T14:00:00.000Z"),
  );

  assertEquals(events.map((event) => event.key), ["monthly-gathering", "guild-party"]);
  const guildParty = events.find((event) => event.key === "guild-party");
  assertEquals(guildParty?.startIso, "2026-08-12T13:30:00.000Z");
  assertEquals(guildParty?.endIso, "2026-08-12T14:00:00.000Z");
  assertEquals(guildParty?.recurrenceRule, null);
});

Deno.test("scheduledEventBody preserves Discord event contract and limits text fields", async () => {
  const body = await scheduledEventBody(
    {
      key: "long",
      title: "T".repeat(120),
      description: "D".repeat(1_200),
      location: "L".repeat(140),
      websiteLocation: siteUrl("events"),
      startIso: "2026-07-04T20:00:00.000Z",
      endIso: "2026-07-04T21:00:00.000Z",
      coverImageUrl: null,
      canonicalEventId: null,
      duplicateEventIds: [],
      recurrenceRule: recurrenceRule({ frequency: 1, interval: 1 }, "2026-07-04T20:00:00.000Z"),
    },
    false,
  );

  assertEquals(body.channel_id, null);
  assertEquals(String(body.name).length, 100);
  assertEquals(String(body.description).length, 1_000);
  assertEquals(body.privacy_level, DISCORD_EVENT_PRIVACY_GUILD_ONLY);
  assertEquals(body.entity_type, DISCORD_EVENT_ENTITY_EXTERNAL);
  assertEquals(String(asRecord(body.entity_metadata).location).length, 100);
  assertEquals(asRecord(body.recurrence_rule).start, "2026-07-04T20:00:00.000Z");
});

Deno.test("eventCoverImageData sends Discord-safe headers and rejects unsupported images", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; accept: string; userAgent: string }> = [];
  try {
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        accept: String(new Headers(init?.headers).get("Accept") || ""),
        userAgent: String(new Headers(init?.headers).get("User-Agent") || ""),
      });
      return Promise.resolve(
        new Response(new Uint8Array([255, 216, 255]), {
          headers: { "Content-Type": "image/jpeg" },
        }),
      );
    }) as typeof fetch;

    const data = await eventCoverImageData(siteUrl("assets/img/discord-events/test-cover.jpg?v=valid"), "Mochirii-Test/1.0");
    assert(data.startsWith("data:image/jpeg;base64,"));
    assertEquals(calls[0], {
      url: siteUrl("assets/img/discord-events/test-cover.jpg?v=valid"),
      accept: "image/png,image/jpeg,image/webp",
      userAgent: "Mochirii-Test/1.0",
    });

    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "text/html" },
        }),
      )) as typeof fetch;

    await assertRejects(
      () => eventCoverImageData(siteUrl("assets/img/discord-events/test-cover.png?v=invalid"), "Mochirii-Test/1.0"),
      "unsupported content type should reject",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("eventLocation and managedEventLine preserve Reaper summary formatting", () => {
  assertEquals(eventLocation({ entity_metadata: { location: "Training Grounds" } }), "Training Grounds");
  assertEquals(managedEventLine("Updated", eventStub("Training"), "event 123"), "Updated: Training (event 123)");
  assertEquals(managedEventLine("Created", eventStub("Training")), "Created: Training");
});

Deno.test("managed event registry indexing fails closed on duplicate enabled mappings", () => {
  const resource = (id: string, discordId: string) => ({
    id,
    discord_id: discordId,
    metadata: {
      managedBy: "reaper-event-sync",
      siteEventKey: "monthly-gathering",
    },
  });

  assertThrows(() =>
    indexManagedEventResources([
      resource("row-1", "123456789012345678"),
      resource("row-2", "223456789012345678"),
    ]), "duplicate enabled registry mappings should reject");
});

Deno.test("scheduled event selection rejects ambiguous exact matches", () => {
  const desired = eventStub("Training");
  const matchingEvent = (id: string) => ({
    id,
    name: desired.title,
    scheduled_start_time: desired.startIso,
    entity_type: DISCORD_EVENT_ENTITY_EXTERNAL,
    entity_metadata: { location: desired.location },
  });

  assertThrows(
    () =>
      selectExistingScheduledEvent(
        [
          matchingEvent("123456789012345678"),
          matchingEvent("223456789012345678"),
        ],
        desired,
        undefined,
      ),
    "multiple exact Discord events should reject",
  );
});

Deno.test("superseded managed event resources exclude the current event", () => {
  const resources = [
    { id: "current-row", discord_id: "123456789012345678" },
    { id: "stale-row", discord_id: "223456789012345678" },
  ];

  assertEquals(
    supersededManagedEventResources(resources, "123456789012345678"),
    [{ id: "stale-row", discord_id: "223456789012345678" }],
  );
});

function eventStub(title: string) {
  return {
    key: "event",
    title,
    description: title,
    location: "Training Grounds",
    websiteLocation: siteUrl("events"),
    startIso: "2026-07-04T20:00:00.000Z",
    endIso: "2026-07-04T21:00:00.000Z",
    coverImageUrl: null,
    canonicalEventId: null,
    duplicateEventIds: [],
    recurrenceRule: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message || "Expected assertion to pass.");
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

async function assertRejects(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}
