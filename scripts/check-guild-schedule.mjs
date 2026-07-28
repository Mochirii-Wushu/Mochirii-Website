import { readFileSync } from "node:fs";
import path from "node:path";
import { siteUrl } from "./lib/public-urls.mjs";

const root = process.cwd();
const schedule = JSON.parse(readFileSync(path.join(root, "apps/web/public/data/guild-schedule.json"), "utf8"));
const failures = [];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function fail(message) {
  failures.push(message);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function offsetMinutes() {
  return Number(schedule.timezone?.offsetMinutes) || 480;
}

function localParts(now) {
  const shifted = new Date(now.getTime() + offsetMinutes() * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function key(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDays(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY);
  return key(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function firstSaturday(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const delta = (6 - first.getUTCDay() + 7) % 7;
  return key(year, month, 1 + delta);
}

function nextFirstSaturday(now) {
  const parts = localParts(now);
  const current = firstSaturday(parts.year, parts.month);
  const today = key(parts.year, parts.month, parts.day);
  if (today <= current) return current;
  const nextMonth = new Date(Date.UTC(parts.year, parts.month, 1));
  return firstSaturday(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1);
}

function firstDayOfMonth(now) {
  const parts = localParts(now);
  return key(parts.year, parts.month, 1);
}

function parseTime(value) {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : { hour: 0, minute: 0 };
}

function nextWeeklyDate(item, now) {
  const parts = localParts(now);
  const today = key(parts.year, parts.month, parts.day);
  const start = parseTime(item.startTime);
  const end = parseTime(item.endTime);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  let best = "";
  let bestDelta = Infinity;
  for (const day of item.days) {
    let delta = (day - parts.weekday + 7) % 7;
    if (delta === 0) {
      const stillUpcoming = endMinutes <= startMinutes ? nowMinutes < 24 * 60 : nowMinutes < endMinutes;
      if (!stillUpcoming) delta = 7;
    }
    if (delta < bestDelta) {
      bestDelta = delta;
      best = addDays(today, delta);
    }
  }
  return best;
}

function localToUtcIso(dateKey, time) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const { hour, minute } = parseTime(time);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes() * 60 * 1000).toISOString();
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) fail(`${label}: expected ${expected}, received ${actual}`);
}

assertEqual("timezone label", schedule.timezone?.label, "UTC+8");
assertEqual("timezone display label", schedule.timezone?.displayLabel, "UTC+8");
assertEqual("timezone IANA zone", schedule.timezone?.ianaZone, "Asia/Singapore");
assertEqual("timezone offset", offsetMinutes(), 480);
assertEqual("Discord cover version", schedule.discordCoverVersion, "2026-06-10-event-panels");
assertEqual("first Saturday before rollover", nextFirstSaturday(new Date("2026-06-03T12:00:00Z")), "2026-06-06");
assertEqual("first Saturday on rollover", nextFirstSaturday(new Date("2026-06-05T17:00:00Z")), "2026-06-06");
assertEqual("first Saturday after rollover", nextFirstSaturday(new Date("2026-06-07T01:00:00Z")), "2026-07-04");
assertEqual("spotlight current month first", firstDayOfMonth(new Date("2026-06-21T12:00:00Z")), "2026-06-01");

const monthlyGathering = schedule.monthly?.gathering;
if (!monthlyGathering) fail("monthly gathering is missing.");
else {
  assertEqual("monthly gathering title", monthlyGathering.title, "Monthly Guild Gathering");
  assertEqual(
    "monthly gathering description",
    monthlyGathering.description,
    "A monthly gathering where every member can discuss anything they'd like with the guild.",
  );
  assertEqual("monthly gathering cover", monthlyGathering.discordCoverImage, "./assets/img/discord-events/monthly-gathering.png");
}

const monthlyRaffle = schedule.monthly?.raffle;
if (!monthlyRaffle) fail("monthly raffle is missing.");
else {
  assertEqual("monthly raffle title", monthlyRaffle.title, "Monthly Guild Raffle");
  assertEqual("monthly raffle time", monthlyRaffle.time, "9:30 PM");
  assertEqual("monthly raffle start", monthlyRaffle.startTime, "21:30");
  assertEqual("monthly raffle end", monthlyRaffle.endTime, "22:00");
  assertEqual("monthly raffle website location", monthlyRaffle.location, siteUrl("/raffles"));
  assertEqual("monthly raffle Discord location", monthlyRaffle.discordLocation, "Guild Base Pool");
  assertEqual("monthly raffle cover", monthlyRaffle.discordCoverImage, "./assets/img/discord-events/monthly-raffle.png");
  assertEqual("monthly raffle canonical Discord event ID", monthlyRaffle.discordEventId, "1479507429598302268");
  assertEqual("monthly raffle duplicate Discord event ID", monthlyRaffle.discordDuplicateEventIds?.[0], "1513742240760070144");
  assertEqual("monthly raffle recurrence frequency", monthlyRaffle.discordRecurrenceRule?.frequency, 1);
  assertEqual("monthly raffle recurrence interval", monthlyRaffle.discordRecurrenceRule?.interval, 1);
  assertEqual("monthly raffle first Saturday recurrence n", monthlyRaffle.discordRecurrenceRule?.by_n_weekday?.[0]?.n, 1);
  assertEqual("monthly raffle first Saturday recurrence day", monthlyRaffle.discordRecurrenceRule?.by_n_weekday?.[0]?.day, 5);
  assertEqual("monthly raffle UTC start", localToUtcIso("2026-07-04", monthlyRaffle.startTime), "2026-07-04T13:30:00.000Z");
  assertEqual("monthly raffle UTC end", localToUtcIso("2026-07-04", monthlyRaffle.endTime), "2026-07-04T14:00:00.000Z");
  [
    "Once a month we host a guild raffle where members can win pretty in-game goodies.",
    "- All guild event times are UTC+8.",
    "- Raffles are 9:30 PM at guild base. (Guild Party Time)",
    "- Sign up through Discord or the in-game event to join.",
    "- Log in at least once on raffle day, even if you can't be there for the drawing.",
    "- Any giftable item in the shop that day can be chosen as a prize.",
    "- If there's something you want that isn't in the shop, just DM Twills & ask. If it's possible, we'll try to make it happen.",
  ].forEach((snippet) => {
    if (!String(monthlyRaffle.description || "").includes(snippet)) fail(`monthly raffle description missing: ${snippet}`);
  });
}

const heroRealm = schedule.weekly.find((item) => item.id === "guild-heros-realm");
if (!heroRealm) fail("guild-heros-realm weekly event is missing.");
else {
  assertEqual("Hero's Realm next Friday", nextWeeklyDate(heroRealm, new Date("2026-06-08T12:00:00Z")), "2026-06-12");
  assertEqual("Hero's Realm UTC start", localToUtcIso("2026-06-12", heroRealm.startTime), "2026-06-12T14:00:00.000Z");
  assertEqual("Hero's Realm UTC end", localToUtcIso("2026-06-12", heroRealm.endTime), "2026-06-12T15:00:00.000Z");
}

const unitedResolve = schedule.weekly.find((item) => item.id === "united-resolve");
if (!unitedResolve) fail("united-resolve weekly event is missing.");
else {
  assertEqual("United Resolve next Friday", nextWeeklyDate(unitedResolve, new Date("2026-06-08T12:00:00Z")), "2026-06-12");
  assertEqual("United Resolve time text", unitedResolve.timeText, "11 PM - 12 AM");
  assertEqual("United Resolve UTC start", localToUtcIso("2026-06-12", unitedResolve.startTime), "2026-06-12T15:00:00.000Z");
  assertEqual("United Resolve UTC end next day", localToUtcIso("2026-06-13", unitedResolve.endTime), "2026-06-12T16:00:00.000Z");
}

[
  ["guild-party", "./assets/img/discord-events/guild-party.png"],
  ["breaking-army", "./assets/img/discord-events/breaking-army.png"],
  ["showdown", "./assets/img/discord-events/showdown.png"],
  ["guild-wars", "./assets/img/discord-events/guild-wars.png"],
  ["guild-heros-realm", "./assets/img/discord-events/guild-heros-realm.png"],
  ["united-resolve", "./assets/img/discord-events/united-resolve.png"],
].forEach(([id, expectedCover]) => {
  const event = schedule.weekly.find((item) => item.id === id);
  if (!event) fail(`${id} weekly event is missing for cover validation.`);
  else assertEqual(`${id} Discord cover`, event.discordCoverImage, expectedCover);
});

const breakingArmy = schedule.weekly.find((item) => item.id === "breaking-army");
if (!breakingArmy) fail("breaking-army weekly event is missing.");
else {
  assertEqual("Breaking Army time text", breakingArmy.timeText, "10 PM - 12 AM");
  assertEqual("Breaking Army UTC start", localToUtcIso("2026-06-08", breakingArmy.startTime), "2026-06-08T14:00:00.000Z");
  assertEqual("Breaking Army UTC end next day", localToUtcIso("2026-06-09", breakingArmy.endTime), "2026-06-08T16:00:00.000Z");
}

const scheduleLines = schedule.weekly
  .filter((item) => item.showOnEventsBoard !== true)
  .map((item) => `${item.title}: ${item.dayText} - ${item.timeText}`);
[
  "Guild Party: Every Day - 9:30 PM - 10 PM",
  "Breaking Army: Mondays & Wednesdays - 10 PM - 12 AM",
  "Showdown: Tuesdays & Thursdays - 10 PM - 12 AM",
  "Guild Wars: Saturdays & Sundays - 8:30 PM - 11:30 PM",
].forEach((line) => {
  if (!scheduleLines.includes(line)) fail(`weekly schedule line missing: ${line}`);
});

if (failures.length) {
  console.error("Guild schedule validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Guild schedule validation OK.");
