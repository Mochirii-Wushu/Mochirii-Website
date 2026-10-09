import { asArray, asRecord, safeString, snowflake, type JsonRecord } from "./discord-interaction-helpers.ts";
import { SITE_ORIGIN, siteUrl } from "./public-origins.ts";

export const DISCORD_EVENT_PRIVACY_GUILD_ONLY = 2;
export const DISCORD_EVENT_ENTITY_EXTERNAL = 3;

export type ScheduleEvent = {
  key: string;
  title: string;
  description: string;
  location: string;
  websiteLocation: string;
  startIso: string;
  endIso: string;
  coverImageUrl: string | null;
  canonicalEventId: string | null;
  duplicateEventIds: string[];
  recurrenceRule: JsonRecord | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SCHEDULE_BYTES = 128 * 1024;
const MAX_COVER_BYTES = 4 * 1024 * 1024;
const COVER_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_COVER_CACHE_BYTES = 24 * 1024 * 1024;
const eventCoverImageCache = new Map<string, { data: string; expiresAt: number }>();
const MONTHLY_RULE_WEEKDAYS: Readonly<Record<string, number>> = {
  "next-first-sunday": 0,
  "next-first-saturday": 6,
  "next-first-wednesday": 3,
};

function trustedScheduleUrl(value: string, cover: boolean): URL {
  const url = new URL(value);
  if (
    url.origin !== SITE_ORIGIN || url.username || url.password || url.hash ||
    [...url.searchParams.keys()].some((key) => key !== "v") || url.searchParams.getAll("v").length > 1 ||
    (url.searchParams.has("v") && !/^[a-zA-Z0-9._-]{1,80}$/.test(url.searchParams.get("v") || "")) ||
    (cover
      ? !/^\/assets\/img\/discord-events\/[a-z0-9-]+\.(?:png|jpg|jpeg|webp)$/.test(url.pathname)
      : url.pathname !== "/data/guild-schedule.json")
  ) throw new Error("Event sync URL is outside the approved website source.");
  return url;
}

async function boundedWebsiteFetch(url: URL, accept: string, maxBytes: number, userAgent: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: accept, "User-Agent": userAgent },
    });
    const contentType = (response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
    const declaredBytes = response.headers.get("Content-Length");
    if (
      !response.ok || response.redirected || (response.url && response.url !== url.toString()) ||
      !accept.split(",").includes(contentType) ||
      (declaredBytes !== null && (!/^\d+$/.test(declaredBytes) || Number(declaredBytes) > maxBytes))
    ) {
      await response.body?.cancel();
      throw new Error("Website schedule or cover response was rejected.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Website schedule or cover response is empty.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error("Website schedule or cover exceeds its byte limit.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (!total) throw new Error("Website schedule or cover response is empty.");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

export function validateGuildSchedule(value: unknown): JsonRecord {
  const fail = (): never => { throw new Error("Website guild schedule schema is invalid."); };
  const record = (item: unknown): JsonRecord => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail();
    return item as JsonRecord;
  };
  const text = (item: unknown, max: number) => typeof item === "string" && item.length > 0 && item.length <= max;
  const time = (item: unknown) => typeof item === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item);
  const schedule = record(value);
  const timezone = record(schedule.timezone);
  if (timezone.ianaZone !== "Asia/Singapore" || timezone.offsetMinutes !== 480 || timezone.label !== "UTC+8" || (timezone.displayLabel !== undefined && timezone.displayLabel !== "UTC+8")) fail();
  if (schedule.discordCoverVersion !== undefined && !text(schedule.discordCoverVersion, 80)) fail();
  const ids = new Set<string>();
  const eventIds = new Set<string>();
  const covers = new Set<string>();
  let occurrenceCount = 2;
  const validateItem = (value: unknown, monthly: boolean) => {
    const item = record(value);
    if (!text(item.id, 80) || !/^[a-z0-9-]+$/.test(String(item.id)) || ids.has(String(item.id))) fail();
    ids.add(String(item.id));
    if (!text(item.title, 100) || !time(item.startTime) || !time(item.endTime) || !text(item.location, 300)) fail();
    if (item.timezone !== undefined && item.timezone !== "UTC+8") fail();
    for (const [field, limit] of [["description", 1000], ["summary", 1000], ["timeText", 100], ["discordLocation", 100]] as const) {
      if (item[field] !== undefined && !text(item[field], limit)) fail();
    }
    if (!text(item.discordCoverImage, 300)) fail();
    const cover = scheduleAssetUrl(item.discordCoverImage, schedule.discordCoverVersion);
    if (!cover) return fail();
    trustedScheduleUrl(cover, true);
    covers.add(cover);
    if (covers.size > 8) fail();
    for (const id of [item.discordEventId, ...asArray(item.discordDuplicateEventIds)]) {
      if (id === undefined) continue;
      if (typeof id !== "string" || !/^\d{17,20}$/.test(id) || eventIds.has(id)) fail();
      eventIds.add(String(id));
    }
    if (item.discordDuplicateEventIds !== undefined && (!Array.isArray(item.discordDuplicateEventIds) || item.discordDuplicateEventIds.length > 10)) fail();
    if (monthly) {
      if (!Object.hasOwn(MONTHLY_RULE_WEEKDAYS, String(item.rule)) || (item.startDayOffset !== undefined && item.startDayOffset !== 0 && item.startDayOffset !== 1)) fail();
      const rule = record(item.discordRecurrenceRule);
      const weekdays = rule.by_n_weekday;
      if (rule.frequency !== 1 || rule.interval !== 1 || !Array.isArray(weekdays) || weekdays.length !== 1) fail();
      const weekday = record((weekdays as unknown[])[0]);
      if (weekday.n !== 1 || !Number.isInteger(weekday.day) || Number(weekday.day) < 0 || Number(weekday.day) > 6) fail();
      const [hour, minute] = String(item.startTime).split(":").map(Number);
      const utcDayShift = (item.startDayOffset === 1 ? 1 : 0) - (hour * 60 + minute < 480 ? 1 : 0);
      // Discord's first weekday is evaluated in UTC. A shifted first weekday
      // can become the previous month's last or the next week's second weekday.
      if (utcDayShift !== 0 || weekday.day !== (MONTHLY_RULE_WEEKDAYS[String(item.rule)] + 6) % 7) fail();
    } else {
      if (item.discordRecurrenceRule !== undefined) fail();
      // Weekly items expand into one managed event per weekday; one shared
      // canonical or duplicate ID cannot identify those distinct instances.
      if (item.discordEventId !== undefined || item.discordDuplicateEventIds !== undefined) fail();
      if (typeof item.discord !== "boolean" || !Array.isArray(item.days) || !item.days.length || item.days.length > 7) fail();
      const days = item.days as unknown[];
      if (new Set(days).size !== days.length || days.some((day) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6)) fail();
      if (item.discord) occurrenceCount += days.length;
      if (occurrenceCount > 64) fail();
    }
  };
  const monthly = record(schedule.monthly);
  if (Object.keys(monthly).some((key) => key !== "gathering" && key !== "raffle")) fail();
  validateItem(monthly.gathering, true);
  validateItem(monthly.raffle, true);
  if (!Array.isArray(schedule.weekly) || !schedule.weekly.length || schedule.weekly.length > 32) fail();
  for (const item of schedule.weekly as unknown[]) validateItem(item, false);
  return schedule;
}

export async function fetchGuildSchedule(url: string, userAgent: string): Promise<JsonRecord> {
  const { bytes } = await boundedWebsiteFetch(trustedScheduleUrl(url, false), "application/json", MAX_SCHEDULE_BYTES, userAgent);
  return validateGuildSchedule(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function scheduleOffsetMinutes(schedule: JsonRecord): number {
  const timezone = asRecord(schedule.timezone);
  const value = Number(timezone.offsetMinutes);
  return Number.isFinite(value) ? value : 480;
}

function localParts(now: Date, offset: number) {
  const shifted = new Date(now.getTime() + offset * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function addDays(value: string, days: number): string {
  const parsed = parseDateKey(value);
  if (!parsed) return value;
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) + days * MS_PER_DAY);
  return dateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function parseTime(value: unknown): { hour: number; minute: number } {
  const match = String(value || "00:00").match(/^(\d{2}):(\d{2})$/);
  if (!match) return { hour: 0, minute: 0 };
  return {
    hour: Math.min(Math.max(Number(match[1]), 0), 23),
    minute: Math.min(Math.max(Number(match[2]), 0), 59),
  };
}

function localToUtcIso(localDate: string, time: string, offset: number): string {
  const parsed = parseDateKey(localDate);
  if (!parsed) return "";
  const parsedTime = parseTime(time);
  return new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsedTime.hour, parsedTime.minute) -
      offset * 60 * 1000,
  ).toISOString();
}

export function scheduleAssetUrl(value: unknown, versionValue?: unknown): string | null {
  const raw = safeString(value, 300);
  if (!raw) return null;
  const version = safeString(versionValue, 80);
  const withVersion = (url: string) => {
    if (!version) return url;
    const parsed = new URL(url);
    parsed.searchParams.set("v", version);
    return parsed.toString();
  };
  if (/^https:\/\/[^\s]+$/i.test(raw)) return withVersion(raw);
  const normalized = raw.replace(/^\.?\//, "");
  if (!normalized.startsWith("assets/")) return null;
  return withVersion(siteUrl(normalized));
}

export function recurrenceRule(value: unknown, startIso: string): JsonRecord | null {
  const rule = asRecord(value);
  const frequency = Number(rule.frequency);
  const interval = Number(rule.interval || 1);
  const byNWeekday = asArray(rule.by_n_weekday)
    .map(asRecord)
    .map((entry) => ({
      n: Number(entry.n),
      day: Number(entry.day),
    }))
    .filter((entry) =>
      Number.isInteger(entry.n) &&
      entry.n >= 1 &&
      entry.n <= 5 &&
      Number.isInteger(entry.day) &&
      entry.day >= 0 &&
      entry.day <= 6
    );

  if (!Number.isInteger(frequency) || !Number.isInteger(interval) || interval < 1) return null;

  const normalized: JsonRecord = {
    start: startIso,
    frequency,
    interval,
  };

  if (byNWeekday.length) normalized.by_n_weekday = byNWeekday.slice(0, 1);
  return normalized;
}

function eventEndDate(startDate: string, startTime: string, endTime: string): string {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const crossesMidnight = end.hour * 60 + end.minute <= start.hour * 60 + start.minute;
  return crossesMidnight ? addDays(startDate, 1) : startDate;
}

function eventEndTimestamp(startDate: string, startTime: string, endTime: string, offset: number): number {
  return Date.parse(localToUtcIso(eventEndDate(startDate, startTime, endTime), endTime, offset));
}

function firstWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  return dateKey(year, month, 1 + delta);
}

function nextFirstWeekday(schedule: JsonRecord, weekday: number, item: JsonRecord, now: Date): string {
  const offset = scheduleOffsetMinutes(schedule);
  const parts = localParts(now, offset);
  const startDayOffset = item.startDayOffset === 1 ? 1 : 0;
  const current = addDays(firstWeekdayOfMonth(parts.year, parts.month, weekday), startDayOffset);
  const startTime = safeString(item.startTime, 20) || "00:00";
  const endTime = safeString(item.endTime, 20) || "01:00";
  if (eventEndTimestamp(current, startTime, endTime, offset) > now.getTime()) return current;
  const nextMonth = new Date(Date.UTC(parts.year, parts.month, 1));
  return addDays(firstWeekdayOfMonth(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, weekday), startDayOffset);
}

function monthlyDateForRule(schedule: JsonRecord, item: JsonRecord, now: Date): string | null {
  const weekday = MONTHLY_RULE_WEEKDAYS[safeString(item.rule, 40) || ""];
  return Number.isInteger(weekday) ? nextFirstWeekday(schedule, weekday, item, now) : null;
}

function nextWeeklyDate(schedule: JsonRecord, item: JsonRecord, day: number, now: Date): string {
  const offset = scheduleOffsetMinutes(schedule);
  const parts = localParts(now, offset);
  const current = dateKey(parts.year, parts.month, parts.day);
  const startTime = safeString(item.startTime, 20) || "00:00";
  const endTime = safeString(item.endTime, 20) || "01:00";
  const nowMs = now.getTime();
  let delta = (day - parts.weekday + 7) % 7;
  const previousDate = addDays(current, delta - 7);
  if (eventEndTimestamp(previousDate, startTime, endTime, offset) > nowMs) delta -= 7;
  else if (delta === 0 && eventEndTimestamp(current, startTime, endTime, offset) <= nowMs) delta = 7;

  return addDays(current, delta);
}

function scheduleEventFromDate(schedule: JsonRecord, key: string, item: JsonRecord, localDate: string): ScheduleEvent | null {
  const title = safeString(item.title, 100);
  const websiteLocation = safeString(item.location, 300) || siteUrl("events");
  const location = safeString(item.discordLocation, 100) || safeString(item.location, 100) || siteUrl("events");
  const startTime = safeString(item.startTime, 20) || "00:00";
  const endTime = safeString(item.endTime, 20) || "01:00";
  const offset = scheduleOffsetMinutes(schedule);
  const endDate = eventEndDate(localDate, startTime, endTime);
  const startIso = localToUtcIso(localDate, startTime, offset);
  const endIso = localToUtcIso(endDate, endTime, offset);

  if (!title || !startIso || !endIso) return null;

  let description = safeString(item.description || item.summary || item.timeText, 1000) || title;
  if (!item.description && !item.summary && item.timeText && /\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b|\b\d{2}:\d{2}\b/i.test(description)) {
    const timezone = asRecord(schedule.timezone);
    const label = safeString(timezone.displayLabel || timezone.label, 80) || "UTC+8";
    description = `${description.slice(0, 997 - label.length)} - ${label}`;
  }

  return {
    key,
    title,
    description,
    location,
    websiteLocation,
    startIso,
    endIso,
    coverImageUrl: scheduleAssetUrl(item.discordCoverImage, schedule.discordCoverVersion),
    canonicalEventId: snowflake(item.discordEventId),
    duplicateEventIds: asArray(item.discordDuplicateEventIds).map(snowflake).filter((id): id is string => Boolean(id)),
    recurrenceRule: recurrenceRule(item.discordRecurrenceRule, startIso),
  };
}

function eventSlotKey(event: ScheduleEvent): string {
  return [event.startIso, event.endIso, event.websiteLocation].join("\n");
}

export function desiredEventsFromSchedule(schedule: JsonRecord, now = new Date()): ScheduleEvent[] {
  const monthly = asRecord(schedule.monthly);
  const events: ScheduleEvent[] = [];

  Object.entries(monthly).forEach(([fallbackKey, value]) => {
    const item = asRecord(value);
    const key = safeString(item.id, 80) || fallbackKey;
    const localDate = monthlyDateForRule(schedule, item, now);
    if (!localDate) return;
    const event = scheduleEventFromDate(schedule, key, item, localDate);
    if (event) events.push(event);
  });

  const monthlySlots = new Set(events.map(eventSlotKey));

  asArray(schedule.weekly).map(asRecord).forEach((item) => {
    if (item.discord !== true) return;
    const key = safeString(item.id, 80);
    if (!key) return;
    asArray(item.days)
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .forEach((day) => {
        let localDate = nextWeeklyDate(schedule, item, day, now);
        let event = scheduleEventFromDate(schedule, `${key}-${day}`, item, localDate);
        if (event && monthlySlots.has(eventSlotKey(event))) {
          localDate = addDays(localDate, 7);
          event = scheduleEventFromDate(schedule, `${key}-${day}`, item, localDate);
        }
        if (event) events.push(event);
      });
  });

  return events;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function eventCoverImageData(url: string, userAgent = "Mochirii-Reaper-RankSync/1.0"): Promise<string> {
  trustedScheduleUrl(url, true);
  for (const [key, entry] of eventCoverImageCache) {
    if (entry.expiresAt <= Date.now()) eventCoverImageCache.delete(key);
  }
  const cached = eventCoverImageCache.get(url);
  if (cached) return cached.data;
  const { bytes, contentType } = await boundedWebsiteFetch(new URL(url), "image/png,image/jpeg,image/webp", MAX_COVER_BYTES, userAgent);
  const signature = Array.from(bytes.subarray(0, 12));
  const validImage = contentType === "image/png"
    ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)
    : contentType === "image/jpeg"
    ? signature[0] === 255 && signature[1] === 216 && signature[2] === 255
    : String.fromCharCode(...signature.slice(0, 4)) === "RIFF" && String.fromCharCode(...signature.slice(8, 12)) === "WEBP";
  if (!validImage) throw new Error("Event cover image signature does not match its content type.");
  const data = `data:${contentType};base64,${bytesToBase64(bytes)}`;
  let cacheBytes = data.length;
  for (const entry of eventCoverImageCache.values()) cacheBytes += entry.data.length;
  while (eventCoverImageCache.size >= 8 || cacheBytes > MAX_COVER_CACHE_BYTES) {
    const oldestKey = eventCoverImageCache.keys().next().value;
    if (!oldestKey) break;
    cacheBytes -= eventCoverImageCache.get(oldestKey)!.data.length;
    eventCoverImageCache.delete(oldestKey);
  }
  eventCoverImageCache.set(url, { data, expiresAt: Date.now() + COVER_CACHE_TTL_MS });
  return data;
}

export async function scheduledEventBody(
  desired: ScheduleEvent,
  includeImage: boolean,
  options: { userAgent?: string } = {},
): Promise<JsonRecord> {
  const body: JsonRecord = {
    channel_id: null,
    name: desired.title.slice(0, 100),
    description: desired.description.slice(0, 1000),
    scheduled_start_time: desired.startIso,
    scheduled_end_time: desired.endIso,
    privacy_level: DISCORD_EVENT_PRIVACY_GUILD_ONLY,
    entity_type: DISCORD_EVENT_ENTITY_EXTERNAL,
    entity_metadata: {
      location: desired.location.slice(0, 100),
    },
  };

  if (desired.recurrenceRule) body.recurrence_rule = desired.recurrenceRule;
  if (includeImage && desired.coverImageUrl) {
    body.image = await eventCoverImageData(desired.coverImageUrl, options.userAgent);
  }

  return body;
}

export function eventLocation(event: JsonRecord): string {
  return safeString(asRecord(event.entity_metadata).location, 100) || "";
}

export function managedEventLine(action: string, desired: ScheduleEvent, detail = ""): string {
  return detail ? `${action}: ${desired.title} (${detail})` : `${action}: ${desired.title}`;
}
