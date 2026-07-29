import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SITE_ORIGIN } from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];
const notes = [];

const expectedEventTypes = [
  "monthly-gathering",
  "monthly-raffle",
  "guild-party",
  "breaking-army",
  "showdown",
  "guild-wars",
  "guild-heros-realm",
  "united-resolve",
];
const expectedManagedEventCount = 17;
const expectedGuildId = "1078630751077142608";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const monthlyRuleWeekdays = {
  "next-first-saturday": 6,
  "next-first-wednesday": 3,
};

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function fail(message) {
  failures.push(message);
}

function note(message) {
  notes.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertIncludes(label, text, snippet) {
  assert(text.includes(snippet), `${label}: expected snippet not found: ${snippet}`);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeAssetPath(value) {
  return String(value || "").replace(/^\.?\//, "");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateKey(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDateKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function addDays(value, days) {
  const parsed = parseDateKey(value);
  if (!parsed) return value;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) + days * MS_PER_DAY);
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function scheduleOffsetMinutes(schedule) {
  const value = Number(schedule.timezone?.offsetMinutes);
  return Number.isFinite(value) ? value : 480;
}

function scheduleLocalParts(schedule, now) {
  const shifted = new Date(now.getTime() + scheduleOffsetMinutes(schedule) * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function parseTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : { hour: 0, minute: 0 };
}

function localToUtcIso(schedule, localDate, time) {
  const parsedDate = parseDateKey(localDate);
  if (!parsedDate) return "";
  const parsedTime = parseTime(time);
  return new Date(
    Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day, parsedTime.hour, parsedTime.minute) -
      scheduleOffsetMinutes(schedule) * 60 * 1000,
  ).toISOString();
}

function eventEndDate(startDate, startTime, endTime) {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  return end.hour * 60 + end.minute <= start.hour * 60 + start.minute ? addDays(startDate, 1) : startDate;
}

function nextFirstWeekday(schedule, weekday, now) {
  const parts = scheduleLocalParts(schedule, now);
  const first = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  const current = dateKey(parts.year, parts.month, 1 + ((weekday - first.getUTCDay() + 7) % 7));
  const today = dateKey(parts.year, parts.month, parts.day);
  if (today <= current) return current;
  const nextMonth = new Date(Date.UTC(parts.year, parts.month, 1));
  const nextFirst = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 1));
  return dateKey(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    1 + ((weekday - nextFirst.getUTCDay() + 7) % 7),
  );
}

function nextWeeklyDate(schedule, item, day, now) {
  const parts = scheduleLocalParts(schedule, now);
  const today = dateKey(parts.year, parts.month, parts.day);
  const start = parseTime(item.startTime);
  const end = parseTime(item.endTime);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  let delta = (day - parts.weekday + 7) % 7;
  if (delta === 0) {
    const stillUpcoming = endMinutes <= startMinutes ? nowMinutes < 24 * 60 : nowMinutes < endMinutes;
    if (!stillUpcoming) delta = 7;
  }
  return addDays(today, delta);
}

function eventInstance(schedule, item, key, typeId, localDate) {
  const startTime = String(item.startTime || "");
  const endTime = String(item.endTime || "");
  return {
    key,
    typeId,
    title: String(item.title || ""),
    startTime,
    endTime,
    startIso: localToUtcIso(schedule, localDate, startTime),
    endIso: localToUtcIso(schedule, eventEndDate(localDate, startTime, endTime), endTime),
    location: String(item.discordLocation || item.location || ""),
    websiteLocation: String(item.location || ""),
    cover: String(item.discordCoverImage || ""),
    recurrenceRule: item.discordRecurrenceRule || null,
    duplicateEventIds: asArray(item.discordDuplicateEventIds),
    canonicalEventId: item.discordEventId || null,
  };
}

function localEventInstances(schedule, now) {
  const monthlyInstances = [];
  const monthly = asObject(schedule.monthly);

  for (const value of Object.values(monthly)) {
    const item = asObject(value);
    const id = String(item.id || "");
    const weekday = monthlyRuleWeekdays[String(item.rule || "")];
    if (!id || !Number.isInteger(weekday)) continue;
    monthlyInstances.push(eventInstance(schedule, item, id, id, nextFirstWeekday(schedule, weekday, now)));
  }

  const monthlySlots = new Set(
    monthlyInstances.map((event) => [event.startIso, event.endIso, event.websiteLocation].join("\n")),
  );
  const weeklyInstances = [];

  for (const value of asArray(schedule.weekly)) {
    const item = asObject(value);
    if (item.discord !== true) continue;
    const id = String(item.id || "");
    for (const day of asArray(item.days)) {
      const localDate = nextWeeklyDate(schedule, item, Number(day), now);
      const event = eventInstance(schedule, item, `${id}-${day}`, id, localDate);
      const slot = [event.startIso, event.endIso, event.websiteLocation].join("\n");
      if (monthlySlots.has(slot)) {
        weeklyInstances.push(eventInstance(schedule, item, `${id}-${day}`, id, addDays(localDate, 7)));
      } else {
        weeklyInstances.push(event);
      }
    }
  }

  return [...monthlyInstances, ...weeklyInstances];
}

function normalizedRecurrence(value) {
  const rule = asObject(value);
  if (!Object.keys(rule).length) return null;
  return {
    frequency: Number(rule.frequency),
    interval: Number(rule.interval || 1),
    by_n_weekday: asArray(rule.by_n_weekday).map((entry) => {
      const normalized = asObject(entry);
      return { n: Number(normalized.n), day: Number(normalized.day) };
    }),
  };
}

function liveEventMatchesExpected(event, expected) {
  const start = new Date(String(event.scheduled_start_time || ""));
  const end = new Date(String(event.scheduled_end_time || ""));
  return String(event.name || "") === expected.title &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start.toISOString() === expected.startIso &&
    end.toISOString() === expected.endIso &&
    Number(event.entity_type) === 3 &&
    String(event.entity_metadata?.location || "") === expected.location &&
    (!expected.canonicalEventId || String(event.id || "") === expected.canonicalEventId) &&
    JSON.stringify(normalizedRecurrence(event.recurrence_rule)) === JSON.stringify(normalizedRecurrence(expected.recurrenceRule));
}

async function liveDiscordRead(scheduleInstances) {
  if (process.env.DISCORD_REAPER_PARITY_LIVE !== "1") {
    note("Live Discord read skipped; set DISCORD_REAPER_PARITY_LIVE=1 with a local bot token for read-only provider parity.");
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN || "";
  const guildId = process.env.DISCORD_GUILD_ID || expectedGuildId;
  if (!token) {
    fail("Live Discord read requested but DISCORD_BOT_TOKEN is missing from the local environment.");
    return;
  }

  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/scheduled-events`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": `Mochirii-Reaper-ParityCheck/1.0 (${SITE_ORIGIN})`,
    },
  });

  if (!response.ok) {
    fail(`Live Discord scheduled event read failed with HTTP ${response.status}.`);
    return;
  }

  const events = await response.json();
  const activeEvents = asArray(events).filter((event) => [1, 2].includes(Number(event.status)));
  const expectedTitles = new Set(scheduleInstances.map((event) => event.title));
  const matching = activeEvents.filter((event) => expectedTitles.has(String(event.name || "")));

  const matchedIds = new Set();
  for (const expected of scheduleInstances) {
    const candidates = matching.filter((event) =>
      !matchedIds.has(String(event.id || "")) && liveEventMatchesExpected(event, expected)
    );
    if (candidates.length !== 1) {
      fail(`${expected.key}: expected one exact live Discord event match, found ${candidates.length}.`);
      continue;
    }
    matchedIds.add(String(candidates[0].id || ""));
  }

  const unmatched = matching.filter((event) => !matchedIds.has(String(event.id || "")));
  if (unmatched.length) fail(`Live Discord read found ${unmatched.length} duplicate or drifted managed-title event(s).`);

  console.log(`Live Discord scheduled event read OK (${matching.length} matching active managed-title events; values redacted).`);
}

const schedule = readJson("apps/web/public/data/guild-schedule.json");
const reaper = [
  read("supabase/functions/reaper-discord-interactions/index.ts"),
  read("supabase/functions/_shared/discord-interaction-helpers.ts"),
  read("supabase/functions/_shared/reaper-event-sync-workflow.ts"),
].join("\n");
const runbook = read("docs/reaper-event-sync-runbook.md");
const runtimeChecklist = read("docs/reaper-runtime-health-checklist.md");
const currentState = read("docs/current-live-state.md");

assert(schedule.timezone?.label === "UTC+8", "Guild schedule timezone label must remain UTC+8.");
assert(schedule.timezone?.offsetMinutes === 480, "Guild schedule offset must remain 480 minutes.");
assert(typeof schedule.discordCoverVersion === "string" && schedule.discordCoverVersion.length > 0, "Schedule must include a Discord cover cache-bust version.");

const referenceNow = process.env.DISCORD_REAPER_PARITY_REFERENCE_TIME
  ? new Date(process.env.DISCORD_REAPER_PARITY_REFERENCE_TIME)
  : new Date();
assert(!Number.isNaN(referenceNow.getTime()), "DISCORD_REAPER_PARITY_REFERENCE_TIME must be a valid timestamp when provided.");
const instances = localEventInstances(schedule, referenceNow);
const typeIds = new Set(instances.map((event) => event.typeId));
assert(instances.length === expectedManagedEventCount, `Expected ${expectedManagedEventCount} managed Discord event instances, found ${instances.length}.`);
assert(typeIds.size === expectedEventTypes.length, `Expected ${expectedEventTypes.length} managed event types, found ${typeIds.size}.`);
expectedEventTypes.forEach((id) => assert(typeIds.has(id), `Missing managed event type: ${id}.`));

const keys = instances.map((event) => event.key);
assert(keys.length === new Set(keys).size, "Managed event instance keys must be unique.");
const slots = instances.map((event) => [event.startIso, event.endIso, event.websiteLocation].join("\n"));
assert(slots.length === new Set(slots).size, "Managed event instances must not share an exact Website time-and-location slot.");

instances.forEach((event) => {
  assert(event.title, `${event.key}: title is required.`);
  assert(/^\d{2}:\d{2}$/.test(event.startTime), `${event.key}: startTime must be HH:mm.`);
  assert(/^\d{2}:\d{2}$/.test(event.endTime), `${event.key}: endTime must be HH:mm.`);
  assert(event.location, `${event.key}: location is required.`);
  assert(event.cover, `${event.key}: discordCoverImage is required.`);
  const coverPath = normalizeAssetPath(event.cover);
  assert(coverPath.startsWith("assets/img/discord-events/"), `${event.key}: cover must stay under assets/img/discord-events/.`);
  assert(existsSync(path.join(root, "apps/web/public", coverPath)), `${event.key}: public cover asset missing: ${coverPath}.`);
});

const raffle = instances.find((event) => event.key === "monthly-raffle");
assert(raffle?.startTime === "21:30", "Monthly raffle must start at 21:30 UTC+8.");
assert(raffle?.endTime === "22:00", "Monthly raffle must end at 22:00 UTC+8.");
assert(raffle?.location === "Guild Base Pool", "Monthly raffle Discord location must stay Guild Base Pool.");
assert(raffle?.canonicalEventId === "1479507429598302268", "Monthly raffle canonical Discord event ID must stay recorded.");
assert(raffle?.duplicateEventIds?.includes("1513742240760070144"), "Monthly raffle duplicate event ID must stay explicitly listed until retired.");
assert(raffle?.recurrenceRule?.frequency === 1, "Monthly raffle recurrence frequency must be monthly.");
assert(raffle?.recurrenceRule?.interval === 1, "Monthly raffle recurrence interval must be 1.");
assert(raffle?.recurrenceRule?.by_n_weekday?.[0]?.n === 1, "Monthly raffle recurrence must target first weekday instance.");
assert(raffle?.recurrenceRule?.by_n_weekday?.[0]?.day === 5, "Monthly raffle recurrence must target Saturday in Discord's recurrence enum.");

const gathering = instances.find((event) => event.key === "monthly-gathering");
assert(gathering?.startTime === "21:30", "Monthly gathering must start at 21:30 UTC+8.");
assert(gathering?.endTime === "22:00", "Monthly gathering must end at 22:00 UTC+8.");
assert(gathering?.recurrenceRule?.frequency === 1, "Monthly gathering recurrence frequency must be monthly.");
assert(gathering?.recurrenceRule?.interval === 1, "Monthly gathering recurrence interval must be 1.");
assert(gathering?.recurrenceRule?.by_n_weekday?.[0]?.n === 1, "Monthly gathering recurrence must target first weekday instance.");
assert(gathering?.recurrenceRule?.by_n_weekday?.[0]?.day === 2, "Monthly gathering recurrence must target Wednesday in Discord's recurrence enum.");

[
  "MANAGE_EVENTS_PERMISSION",
  "CREATE_EVENTS_PERMISSION",
  "Retry-After",
  "retry_after",
  "managedBy: \"reaper-event-sync\"",
  "indexManagedEventResources",
  "selectExistingScheduledEvent",
  "superseded-managed-event",
  "Duplicate scheduled event was removed",
  "Event sync preview. No Discord scheduled events were changed.",
  "Run /sync-events mode:apply confirm:true after reviewing preview.",
  "allowed_mentions",
  "parse: []",
].forEach((snippet) => assertIncludes("reaper event sync", reaper, snippet));

[
  "/sync-events mode:<preview|apply> confirm:<true|false>",
  "Preview first",
  "protected-main Supabase Git integration",
  "34 functions declared in `supabase/config.toml`",
  "20 `verify_jwt=true` and 14 false",
  "Do not run `apply` if preview shows duplicate creates",
  "Duplicate removal is intentionally limited to IDs listed in `discordDuplicateEventIds`.",
].forEach((snippet) => assertIncludes("event sync runbook", runbook, snippet));

[
  "Supabase Edge Function `reaper-discord-interactions` handles slash commands",
  "Reaper Gateway worker handles `guildMemberAdd` welcome DMs and, after the second release is approved, redacted pending-verification member-event forwarding.",
  "Server Members Intent",
  "Bot does not have `Administrator`.",
  "Discord signatures are validated before JSON parsing.",
  "Reaper manages 8 event types and 17 scheduled event instances.",
  "Last token rotation date, recorded as a date only.",
].forEach((snippet) => assertIncludes("reaper runtime checklist", runtimeChecklist, snippet));

[
  "Discord event schedule source is `apps/web/public/data/guild-schedule.json`",
  "Event sync is preview-first",
  "owner-approved provider mutation",
].forEach((snippet) => assertIncludes("current live state", currentState, snippet));

await liveDiscordRead(instances);

if (failures.length) {
  console.error("Discord/Reaper parity validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

notes.forEach((message) => console.log(`NOTE ${message}`));
console.log(`Discord/Reaper parity validation OK (${instances.length} event instances, ${typeIds.size} event types).`);
