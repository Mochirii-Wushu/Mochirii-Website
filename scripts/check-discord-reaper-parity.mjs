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
const expectedManagedEventCount = 8;
const expectedGuildId = "1078630751077142608";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const monthlyRuleWeekdays = {
  "next-first-sunday": 0,
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

function eventEndTimestamp(schedule, localDate, item) {
  const startTime = String(item.startTime || "");
  const endTime = String(item.endTime || "");
  return Date.parse(localToUtcIso(schedule, eventEndDate(localDate, startTime, endTime), endTime));
}

function nextFirstWeekday(schedule, weekday, item, now) {
  const parts = scheduleLocalParts(schedule, now);
  const startDayOffset = item.startDayOffset === 1 ? 1 : 0;
  const first = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  const current = addDays(dateKey(parts.year, parts.month, 1 + ((weekday - first.getUTCDay() + 7) % 7)), startDayOffset);
  if (eventEndTimestamp(schedule, current, item) > now.getTime()) return current;
  const nextMonth = new Date(Date.UTC(parts.year, parts.month, 1));
  const nextFirst = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 1));
  return addDays(dateKey(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    1 + ((weekday - nextFirst.getUTCDay() + 7) % 7),
  ), startDayOffset);
}

function nextWeeklyDate(schedule, item, day, now) {
  const parts = scheduleLocalParts(schedule, now);
  const today = dateKey(parts.year, parts.month, parts.day);
  const nowMs = now.getTime();
  let delta = (day - parts.weekday + 7) % 7;
  const previousDate = addDays(today, delta - 7);
  if (eventEndTimestamp(schedule, previousDate, item) > nowMs) delta -= 7;
  else if (delta === 0 && eventEndTimestamp(schedule, today, item) <= nowMs) delta = 7;
  return addDays(today, delta);
}

function eventInstance(schedule, item, key, typeId, localDate) {
  const startTime = String(item.startTime || "");
  const endTime = String(item.endTime || "");
  const startIso = localToUtcIso(schedule, localDate, startTime);
  return {
    key,
    typeId,
    title: String(item.title || ""),
    startTime,
    endTime,
    startIso,
    endIso: localToUtcIso(schedule, eventEndDate(localDate, startTime, endTime), endTime),
    location: String(item.discordLocation || item.location || ""),
    websiteLocation: String(item.location || ""),
    cover: String(item.discordCoverImage || ""),
    recurrenceRule: item.discordRecurrenceRule ? { ...item.discordRecurrenceRule, start: startIso } : null,
    duplicateEventIds: asArray(item.discordDuplicateEventIds),
    canonicalEventId: item.discordEventId || null,
  };
}

function weeklyNativeRecurrence(schedule, item, days, startIso) {
  // Use dated UTC conversions independently of Reaper's weekday-shift formula.
  const weekdays = days.map((day) => {
    const utc = new Date(localToUtcIso(schedule, addDays("2026-01-04", day), item.startTime));
    return (utc.getUTCDay() + 6) % 7;
  }).sort((a, b) => a - b);
  if (weekdays.length === 7) return { start: startIso, frequency: 3, interval: 1 };
  if (weekdays.length === 1) return { start: startIso, frequency: 2, interval: 1, by_weekday: weekdays };
  const supportedSets = [[0, 1, 2, 3, 4], [1, 2, 3, 4, 5], [0, 1, 2, 3, 6], [4, 5], [5, 6], [0, 6]];
  return supportedSets.some((set) => set.length === weekdays.length && set.every((day, index) => day === weekdays[index]))
    ? { start: startIso, frequency: 3, interval: 1, by_weekday: weekdays }
    : null;
}

function potentialMonthlyCollision(schedule, item, days) {
  return Object.values(asObject(schedule.monthly)).some((monthly) => {
    const weekday = monthlyRuleWeekdays[String(monthly.rule || "")];
    return Number.isInteger(weekday) && days.includes((weekday + (monthly.startDayOffset === 1 ? 1 : 0)) % 7) &&
      monthly.startTime === item.startTime && monthly.endTime === item.endTime && monthly.location === item.location;
  });
}

function localEventInstances(schedule, now) {
  const monthlyInstances = [];
  const monthly = asObject(schedule.monthly);

  for (const value of Object.values(monthly)) {
    const item = asObject(value);
    const id = String(item.id || "");
    const weekday = monthlyRuleWeekdays[String(item.rule || "")];
    if (!id || !Number.isInteger(weekday)) continue;
    monthlyInstances.push(eventInstance(schedule, item, id, id, nextFirstWeekday(schedule, weekday, item, now)));
  }

  const monthlySlots = new Set(
    monthlyInstances.map((event) => [event.startIso, event.endIso, event.websiteLocation].join("\n")),
  );
  const weeklyInstances = [];

  for (const value of asArray(schedule.weekly)) {
    const item = asObject(value);
    if (item.discord !== true) continue;
    const id = String(item.id || "");
    const days = [...new Set(asArray(item.days).map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    const candidates = days.map((day) => {
      const localDate = nextWeeklyDate(schedule, item, day, now);
      const event = eventInstance(schedule, item, id, id, localDate);
      const slot = [event.startIso, event.endIso, event.websiteLocation].join("\n");
      return monthlySlots.has(slot) ? eventInstance(schedule, item, id, id, addDays(localDate, 7)) : event;
    }).sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
    const event = candidates[0];
    if (!event) continue;
    event.recurrenceRule = potentialMonthlyCollision(schedule, item, days)
      ? null : weeklyNativeRecurrence(schedule, item, days, event.startIso);
    weeklyInstances.push(event);
  }

  return [...monthlyInstances, ...weeklyInstances];
}

function validInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59 && Number.isFinite(Date.parse(value));
}

function normalizedRecurrence(value) {
  if (value === null || value === undefined) return null;
  const rule = asObject(value);
  const arrays = ["by_weekday", "by_n_weekday", "by_month", "by_month_day", "by_year_day"];
  if (Object.keys(rule).some((key) => !["start", "end", "frequency", "interval", "count", ...arrays].includes(key)) ||
    !validInstant(rule.start) ||
    !Number.isInteger(rule.frequency) || !Number.isInteger(rule.interval)) return undefined;
  const result = { start: new Date(rule.start).toISOString(), frequency: rule.frequency, interval: rule.interval, end: null, count: null };
  if (rule.end !== undefined && rule.end !== null) {
    if (!validInstant(rule.end)) return undefined;
    result.end = new Date(rule.end).toISOString();
  }
  if (rule.count !== undefined && rule.count !== null) {
    if (!Number.isInteger(rule.count)) return undefined;
    result.count = rule.count;
  }
  for (const key of arrays) {
    const values = rule[key];
    if (values === undefined || values === null) { result[key] = null; continue; }
    if (!Array.isArray(values)) return undefined;
    const normalized = [];
    for (const value of values) {
      if (key === "by_n_weekday") {
        const weekday = asObject(value);
        if (Object.keys(weekday).length !== 2 || !Number.isInteger(weekday.n) || !Number.isInteger(weekday.day)) return undefined;
        normalized.push(JSON.stringify([weekday.n, weekday.day]));
      } else {
        if (!Number.isInteger(value)) return undefined;
        normalized.push(JSON.stringify(value));
      }
    }
    if (new Set(normalized).size !== normalized.length) return undefined;
    result[key] = normalized.sort();
  }
  return result;
}

function liveEventMatchesExpected(event, expected) {
  const start = new Date(String(event.scheduled_start_time || ""));
  const end = new Date(String(event.scheduled_end_time || ""));
  const recurrence = normalizedRecurrence(expected.recurrenceRule);
  const actualRule = normalizedRecurrence(event.recurrence_rule);
  let scheduleMatches = start.toJSON() === expected.startIso && end.toJSON() === expected.endIso &&
    JSON.stringify(actualRule) === JSON.stringify(recurrence);
  if (recurrence && actualRule) {
    const selected = Date.parse(expected.startIso);
    const anchor = Date.parse(actualRule.start);
    const originalRule = asObject(event.recurrence_rule);
    const onRule = (value) => {
      const date = new Date(value);
      const day = (date.getUTCDay() + 6) % 7;
      if (originalRule.interval !== 1) return false;
      if (originalRule.frequency === 3) return !Array.isArray(originalRule.by_weekday) || originalRule.by_weekday.includes(day);
      if (originalRule.frequency === 2) return originalRule.by_weekday?.length === 1 && originalRule.by_weekday[0] === day;
      if (originalRule.frequency === 1) {
        const nth = asArray(originalRule.by_n_weekday);
        return nth.length === 1 && nth[0].day === day && nth[0].n === Math.ceil(date.getUTCDate() / 7);
      }
      return false;
    };
    scheduleMatches = anchor <= start.getTime() && start.getTime() <= selected &&
      anchor % 86400000 === selected % 86400000 && start.getTime() % 86400000 === selected % 86400000 &&
      end.getTime() - start.getTime() === Date.parse(expected.endIso) - selected &&
      onRule(anchor) && onRule(start.getTime()) && onRule(selected) &&
      JSON.stringify({ ...actualRule, start: recurrence.start }) === JSON.stringify(recurrence);
  }
  return recurrence !== undefined && String(event.name || "") === expected.title &&
    validInstant(event.scheduled_start_time) &&
    validInstant(event.scheduled_end_time) &&
    scheduleMatches &&
    Number(event.entity_type) === 3 &&
    String(event.entity_metadata?.location || "") === expected.location &&
    (!expected.canonicalEventId || String(event.id || "") === expected.canonicalEventId);
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
assert(keys.every((key) => expectedEventTypes.includes(key)), "Managed event keys must identify activities without weekday suffixes.");
const slots = instances.map((event) => [event.startIso, event.endIso, event.websiteLocation].join("\n"));
assert(slots.length === new Set(slots).size, "Managed event instances must not share an exact Website time-and-location slot.");
Object.values(asObject(schedule.monthly)).forEach((value) => {
  const item = asObject(value);
  assert(item.startDayOffset === undefined || item.startDayOffset === 0 || item.startDayOffset === 1,
    `${item.id}: monthly startDayOffset must be 0 or 1 when present.`);
});

instances.forEach((event) => {
  assert(event.title, `${event.key}: title is required.`);
  assert(Date.parse(event.startIso) < Date.parse(event.endIso), `${event.key}: start must precede the exclusive end.`);
  assert(Date.parse(event.endIso) > referenceNow.getTime(), `${event.key}: occurrence must not have ended at the reference instant.`);
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
assert(schedule.monthly?.gathering?.rule === "next-first-sunday", "Monthly gathering must follow the first Sunday rule.");
assert(schedule.monthly?.gathering?.startDayOffset === 1, "Monthly gathering must start on the day after the first Sunday.");
assert(gathering?.startTime === "00:00", "Monthly gathering must start at 00:00 UTC+8 after the first Sunday.");
assert(gathering?.endTime === "01:00", "Monthly gathering must end at 01:00 UTC+8 after the first Sunday.");
assert(gathering?.recurrenceRule?.frequency === 1, "Monthly gathering recurrence frequency must be monthly.");
assert(gathering?.recurrenceRule?.interval === 1, "Monthly gathering recurrence interval must be 1.");
assert(gathering?.recurrenceRule?.by_n_weekday?.[0]?.n === 1, "Monthly gathering recurrence must target first weekday instance.");
assert(gathering?.recurrenceRule?.by_n_weekday?.[0]?.day === 6, "Monthly gathering recurrence must target Sunday UTC in Discord's recurrence enum.");

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
  "33 functions declared in `supabase/config.toml`",
  "20 `verify_jwt=true` and 13 false",
  "Do not run `apply` if preview shows duplicate creates",
  "Duplicate removal is limited to explicit `discordDuplicateEventIds` and unambiguous owned legacy activity mappings in the reviewed plan.",
].forEach((snippet) => assertIncludes("event sync runbook", runbook, snippet));

[
  "Supabase Edge Function `reaper-discord-interactions` handles slash commands",
  "Reaper Gateway worker handles `guildMemberAdd` welcome DMs and, after the second release is approved, redacted pending-verification member-event forwarding.",
  "Server Members Intent",
  "Bot does not have `Administrator`.",
  "Discord signatures are validated before JSON parsing.",
  "Reaper manages 8 event types and 8 scheduled events, one per activity.",
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
