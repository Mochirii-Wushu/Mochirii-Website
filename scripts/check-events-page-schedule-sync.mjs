import { readAppCss } from "./lib/app-css.mjs";
import { readJsonFile } from "./lib/json.mjs";
import { readPublicPageExport } from "./lib/public-page-source.mjs";
import { readText, repoRoot } from "./lib/repo-paths.mjs";

const failures = [];

function fail(message) {
  failures.push(message);
}

function assertIncludes(label, source, snippet) {
  if (!source.includes(snippet)) fail(`${label}: missing ${snippet}`);
}

function assertNotIncludes(label, source, snippet) {
  if (source.includes(snippet)) fail(`${label}: unexpected ${snippet}`);
}

const eventsSource = readPublicPageExport(repoRoot, "EventsPage", failures).text;
const eventsScheduleSource = readText("apps/web/components/public-pages/EventsSchedule.tsx");
const homeEventSource = readText("apps/web/components/public-pages/HomeNextEvent.tsx");
const clockSource = readText("apps/web/lib/events/use-guild-schedule.ts");
const publicScheduleSource = readText("apps/web/lib/events/public-schedule.ts");
const homeSource = readText("apps/web/app/page.tsx");
const boardSource = readText("apps/web/components/public-pages/EventsBoard.tsx");
const referenceTimeSource = readText("apps/web/lib/events/reference-time.ts");
const cssSource = readAppCss().replace(/\r\n/g, "\n");
const scheduleSource = readText("apps/web/lib/guild-schedule.ts");
const schedule = readJsonFile("apps/web/public/data/guild-schedule.json");
const legacyEvents = readJsonFile("apps/web/public/data/events.json");
const home = readJsonFile("apps/web/public/data/home.json");

if (!eventsSource) fail("EventsPage source block not found.");
assertIncludes("EventsPage", eventsSource, "<EventsSchedule referenceTime={referenceTime}");
assertIncludes("Events schedule clock", clockSource, "websiteEventCardsFromSchedule(schedule, new Date(referenceTimeMs))");
assertNotIncludes("Events schedule clock", clockSource, "@/public/data/guild-schedule.json");
assertIncludes("Public schedule projection", publicScheduleSource, 'import "server-only"');
assertIncludes("Public schedule projection", publicScheduleSource, 'item.id !== "monthly-raffle"');
assertIncludes("Public schedule projection", publicScheduleSource, "guildScheduleData.timezone");
assertIncludes("Public schedule projection", publicScheduleSource, 'startDayOffset: "startDayOffset" in item ? item.startDayOffset : 0');
assertIncludes("Public schedule projection", publicScheduleSource, "encodeURIComponent(guildScheduleData.discordCoverVersion)");
assertIncludes("Public schedule projection", publicScheduleSource, "discordCoverImage: eventCoverUrl(item.discordCoverImage)");
assertNotIncludes("EventsPage", eventsSource, "records(data.upcoming)");
assertNotIncludes("EventsPage", eventsSource, "eventBoardItemsFromSchedule");

assertIncludes("Home", homeSource, "<HomeNextEvent");
assertIncludes("Home", homeSource, "referenceTime={referenceTime}");
assertIncludes("Home", homeSource, '<span className="home-link">View All Events</span>');
assertNotIncludes("Home", homeSource, "monthlyScheduleDate");
for (const [label, source] of [["Home next event", homeEventSource], ["Events featured", eventsScheduleSource]]) {
  assertIncludes(label, source, "useGuildSchedule(scheduleData, referenceTime)");
  assertIncludes(label, source, "currentOrUpcomingEvent(schedule.items, new Date(schedule.referenceTime))");
}
const homeGathering = (home.bulletins || []).find((item) => item.scheduleId === "monthly-gathering");
if (!homeGathering) fail("Home must keep its gathering bulletin bound to monthly-gathering.");

assertIncludes("guild schedule helper", scheduleSource, "export function websiteEventCardsFromSchedule");
assertIncludes("guild schedule helper", scheduleSource, '.filter((item) => item.id !== "monthly-raffle")');
assertIncludes("guild schedule helper", scheduleSource, "image: item.discordCoverImage || \"\"");
assertIncludes("guild schedule helper", scheduleSource, "image: occurrence.discordCoverImage || \"\"");
assertNotIncludes("guild schedule helper", scheduleSource, "href: item.location");
assertNotIncludes("guild schedule helper", scheduleSource, "href: occurrence.href || occurrence.location");
assertIncludes("Events featured participation", eventsScheduleSource, "featuredEvent ? featuredEvent.href || DISCORD_INVITE_URL : featured.href");
assertNotIncludes("guild schedule helper", scheduleSource, 'item.id === "monthly-raffle" ? "/raffle"');

assertIncludes("EventsBoard", boardSource, "parseIso(item.startIso)");
assertIncludes("EventsBoard", boardSource, "eventStatusAt(item, referenceTimeMs)");
assertIncludes("EventsBoard", boardSource, "parseReferenceTime(referenceTime)");
assertNotIncludes("EventsBoard", boardSource, "Date.now()");
assertNotIncludes("EventsBoard", boardSource, "new Date()");
assertIncludes("Events reference-time helper", referenceTimeSource, "parseIso(item.endIso)");
assertIncludes("Events schedule", eventsScheduleSource, "<EventsBoard items={schedule.items} referenceTime={schedule.referenceTime}");
assertIncludes("EventsBoard", boardSource, "item.timeText || item.time");
assertIncludes("Events schedule", eventsScheduleSource, "events-board-card");
assertIncludes("EventsBoard", boardSource, "aria-label=\"Event Board results\"");
assertIncludes("EventsBoard", boardSource, 'role="group" aria-label="Event Board results"');
assertIncludes("EventsBoard", boardSource, 'role="status" aria-live="polite" aria-atomic="true"');
assertNotIncludes("EventsBoard", boardSource, 'className="events-upcoming" aria-live="polite"');
assertIncludes("EventsPage", eventsSource, '<div className="events-page">');
assertIncludes("Events CSS", cssSource, 'body:not([data-page="events"]) .events-page .events-filters');
assertIncludes("EventsBoard", boardSource, "tabIndex={0}");
assertIncludes("Events CSS", cssSource, ':is(body[data-page="events"], .events-page) .events-board-card');
assertIncludes("Events CSS", cssSource, "box-sizing:border-box");
assertIncludes("Events CSS", cssSource, "max-height:clamp(560px, 74vh, 820px)");
assertIncludes("Events CSS", cssSource, "overflow-y:auto");
assertIncludes("Events CSS", cssSource, "overscroll-behavior:contain");
assertIncludes("Events CSS", cssSource, ".events-upcoming:focus-visible");
assertIncludes("Events CSS", cssSource, ".events-featured__img,\n.events-list__image{\n  display:block;\n  width:100%;\n  max-width:100%;\n  height:auto;");
assertIncludes("Events schedule", eventsScheduleSource, 'className="events-featured__img"');
assertIncludes("EventsBoard", boardSource, 'className="events-list__image"');
assertNotIncludes("Events schedule", eventsScheduleSource, "style={{ width: \"100%\", height: \"auto\"");
assertNotIncludes("EventsBoard", boardSource, "style={{ width: \"100%\", height: \"auto\"");

const monthlyEvents = Object.values(schedule.monthly || {});
const publicMonthlyEvents = monthlyEvents.filter((item) => item.id !== "monthly-raffle");
const weeklyEvents = (schedule.weekly || []).filter((item) => item.discord === true);
const websiteEventCount = publicMonthlyEvents.length + weeklyEvents.length;
if (websiteEventCount !== 7) fail(`expected 7 schedule-derived website event cards, received ${websiteEventCount}.`);

const legacyUpcoming = Array.isArray(legacyEvents.upcoming) ? legacyEvents.upcoming : [];
const weeklyById = new Map(weeklyEvents.map((item) => [String(item.id || ""), item]));
const seenLegacyIds = new Set();
const mirroredFields = [
  ["title", "title"],
  ["time", "timeText"],
  ["summary", "summary"],
  ["image", "image"],
  ["href", "href"],
];

for (const item of legacyUpcoming) {
  const scheduleId = String(item.scheduleId || "");
  if (!scheduleId) {
    fail("data/events.json upcoming entry is missing scheduleId.");
    continue;
  }
  if (seenLegacyIds.has(scheduleId)) fail(`data/events.json repeats scheduleId ${scheduleId}.`);
  seenLegacyIds.add(scheduleId);

  const scheduled = weeklyById.get(scheduleId);
  if (!scheduled) {
    fail(`data/events.json references missing weekly schedule ${scheduleId}.`);
    continue;
  }

  for (const [legacyField, scheduleField] of mirroredFields) {
    if (String(item[legacyField] || "") !== String(scheduled[scheduleField] || "")) {
      fail(`event source drift for ${scheduleId}: ${legacyField} must match guild-schedule ${scheduleField}.`);
    }
  }

  const scheduledTimezone = String(schedule.timezone?.displayLabel || schedule.timezone?.label || "");
  if (String(item.timezone || "") !== scheduledTimezone) {
    fail(`event source drift for ${scheduleId}: timezone must match guild-schedule timezone.`);
  }
}

const coverImages = [...monthlyEvents, ...weeklyEvents].map((item) => String(item.discordCoverImage || ""));
for (const cover of coverImages) {
  if (!cover) fail("schedule-derived event card is missing discordCoverImage.");
  if (!cover.includes("/discord-events/")) fail(`schedule-derived event card must use a Discord cover image: ${cover}`);
  if (cover.includes("upcoming-01.webp")) fail("schedule-derived event card still uses stale upcoming-01.webp.");
}

if (new Set(coverImages).size !== coverImages.length) {
  fail("schedule-derived event cards must use unique Discord cover images.");
}

function parseTime(value) {
  const match = String(value || "00:00").match(/^(\d{2}):(\d{2})$/);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : { hour: 0, minute: 0 };
}

function localToUtcIso(dateKey, time) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const { hour, minute } = parseTime(time);
  const offsetMinutes = Number(schedule.timezone?.offsetMinutes) || 480;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60 * 1000).toISOString();
}

function endDate(startDate, startTime, endTime) {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  if (endMinutes > startMinutes) return startDate;
  const [year, month, day] = startDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

const heroRealm = weeklyEvents.find((item) => item.id === "guild-heros-realm");
const skywardBond = weeklyEvents.find((item) => item.id === "united-resolve");
if (!heroRealm || !skywardBond) {
  fail("Hero's Realm and Skyward Bond are required for Friday sort validation.");
} else {
  const friday = "2026-06-12";
  const heroStart = localToUtcIso(friday, heroRealm.startTime);
  const heroEnd = localToUtcIso(endDate(friday, heroRealm.startTime, heroRealm.endTime), heroRealm.endTime);
  const skywardStart = localToUtcIso(friday, skywardBond.startTime);
  const skywardEnd = localToUtcIso(endDate(friday, skywardBond.startTime, skywardBond.endTime), skywardBond.endTime);

  if (skywardStart !== "2026-06-12T14:00:00.000Z"
    || skywardEnd !== "2026-06-12T15:00:00.000Z"
    || heroStart !== skywardEnd || heroEnd !== "2026-06-12T16:00:00.000Z") {
    fail("Friday Skyward Bond 22:00-23:00 must precede Hero's Realm 23:00-00:00 UTC+8.");
  }
}

if (failures.length) {
  console.error("Events page schedule sync validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Events page schedule sync validation OK.");
