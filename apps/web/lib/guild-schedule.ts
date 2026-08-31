import { formatPublicTime } from "./public-date.ts";

export type GuildScheduleData = {
  timezone?: {
    displayLabel?: string;
    ianaZone?: string;
    label?: string;
    offsetMinutes?: number;
  };
  discordCoverVersion?: string;
  monthly?: Record<string, GuildMonthlyScheduleItem>;
  spotlight?: {
    id?: string;
    rule?: string;
    memberProfileSlug?: string;
  };
  weekly?: GuildWeeklyScheduleItem[];
};

export type GuildMonthlyScheduleItem = {
  id?: string;
  title?: string;
  rule?: string;
  time?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  discordLocation?: string;
  discordCoverImage?: string;
  discordEventId?: string;
  discordDuplicateEventIds?: string[];
  discordRecurrenceRule?: Record<string, unknown>;
  description?: string;
};

export type GuildWeeklyScheduleItem = {
  id?: string;
  title?: string;
  days?: number[];
  dayText?: string;
  startTime?: string;
  endTime?: string;
  timeText?: string;
  timezone?: string;
  summary?: string;
  image?: string;
  href?: string;
  location?: string;
  discordCoverImage?: string;
  discord?: boolean;
  showOnEventsBoard?: boolean;
};

export type ScheduledEventOccurrence = GuildWeeklyScheduleItem & {
  date: string;
  startIso: string;
  endIso: string;
};

export type WebsiteEventCard = Omit<
  ScheduledEventOccurrence,
  "endTime" | "id" | "image" | "startTime" | "timeText" | "timezone" | "title"
> & {
  endTime: string;
  id: string;
  image: string;
  startTime: string;
  timeText: string;
  title: string;
  timezone: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHLY_RULE_WEEKDAYS: Readonly<Record<string, number>> = {
  "next-first-saturday": 6,
  "next-first-wednesday": 3,
};
const MONTHLY_RULE_LABELS: Readonly<Record<string, string>> = {
  "next-first-saturday": "First Saturday",
  "next-first-wednesday": "First Wednesday",
};

function offsetMinutes(schedule: GuildScheduleData): number {
  const value = Number(schedule.timezone?.offsetMinutes);
  return Number.isFinite(value) ? value : 480;
}

export function scheduleTimezoneLabel(schedule: GuildScheduleData): string {
  return String(schedule.timezone?.displayLabel || schedule.timezone?.label || "UTC+8");
}

function scheduleIanaZone(schedule: GuildScheduleData): string {
  return String(schedule.timezone?.ianaZone || "Asia/Singapore");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
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

function localDateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function localDateKey(now: Date, schedule: GuildScheduleData): string {
  const parts = localParts(now, offsetMinutes(schedule));
  return localDateKeyFromParts(parts.year, parts.month, parts.day);
}

function parseDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function parseTime(value: unknown): { hour: number; minute: number } {
  const raw = String(value || "00:00").trim();
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return { hour: 0, minute: 0 };
  return {
    hour: Math.min(Math.max(Number(match[1]), 0), 23),
    minute: Math.min(Math.max(Number(match[2]), 0), 59),
  };
}

function formatScheduleTime(value: unknown, schedule: GuildScheduleData): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const parsed = { hour: Number(match[1]), minute: Number(match[2]) };
  if (parsed.hour < 0 || parsed.hour > 23 || parsed.minute < 0 || parsed.minute > 59) return "";
  const instant = new Date(
    Date.UTC(2026, 0, 1, parsed.hour, parsed.minute) - offsetMinutes(schedule) * 60 * 1000,
  );
  return formatPublicTime(instant, scheduleIanaZone(schedule));
}

function normalizeFallbackTime(value: unknown): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(1[0-2]|[1-9])(?::([0-5]\d))?\s*(AM|PM)$/iu);
  if (!match) return "";
  return `${Number(match[1])}:${match[2] || "00"} ${match[3].toUpperCase()}`;
}

function normalizeFallbackTimeText(value: unknown): string {
  const raw = String(value ?? "").trim();
  const range = raw.match(/^(.+?)\s+-\s+(.+)$/u);
  if (!range) return normalizeFallbackTime(raw);
  const start = normalizeFallbackTime(range[1]);
  const end = normalizeFallbackTime(range[2]);
  return start && end ? `${start} - ${end}` : "";
}

function timeRangeText(startTime: unknown, endTime: unknown, schedule: GuildScheduleData, fallback?: unknown): string {
  const start = formatScheduleTime(startTime, schedule);
  const end = formatScheduleTime(endTime, schedule);
  return start && end ? `${start} - ${end}` : normalizeFallbackTimeText(fallback);
}

function localToUtcIso(dateKey: string, time: string, schedule: GuildScheduleData): string {
  const date = parseDateKey(dateKey);
  if (!date) return "";
  const parsedTime = parseTime(time);
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, parsedTime.hour, parsedTime.minute) -
      offsetMinutes(schedule) * 60 * 1000,
  ).toISOString();
}

function addDays(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * MS_PER_DAY);
  return localDateKeyFromParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function firstWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return localDateKeyFromParts(year, month, 1 + offset);
}

function nextFirstWeekday(schedule: GuildScheduleData, weekday: number, now: Date): string {
  const parts = localParts(now, offsetMinutes(schedule));
  const currentMonth = firstWeekdayOfMonth(parts.year, parts.month, weekday);
  const today = localDateKeyFromParts(parts.year, parts.month, parts.day);
  if (today <= currentMonth) return currentMonth;

  const nextMonthDate = new Date(Date.UTC(parts.year, parts.month, 1));
  return firstWeekdayOfMonth(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, weekday);
}

export function nextFirstSaturday(schedule: GuildScheduleData, now = new Date()): string {
  return nextFirstWeekday(schedule, 6, now);
}

export function nextFirstWednesday(schedule: GuildScheduleData, now = new Date()): string {
  return nextFirstWeekday(schedule, 3, now);
}

export function firstDayOfCurrentMonth(schedule: GuildScheduleData, now = new Date()): string {
  const parts = localParts(now, offsetMinutes(schedule));
  return localDateKeyFromParts(parts.year, parts.month, 1);
}

export function monthlyScheduleDate(
  schedule: GuildScheduleData,
  scheduleId: unknown,
  fallback: unknown,
  now = new Date(),
): string {
  const id = String(scheduleId || "");
  const item = Object.values(schedule.monthly || {}).find((entry) => entry.id === id);
  const weekday = MONTHLY_RULE_WEEKDAYS[String(item?.rule || "")];
  if (Number.isInteger(weekday)) return nextFirstWeekday(schedule, weekday, now);
  return String(fallback || "");
}

export function spotlightScheduleDate(schedule: GuildScheduleData, fallback: unknown, now = new Date()): string {
  if (schedule.spotlight?.rule === "first-day-current-month") return firstDayOfCurrentMonth(schedule, now);
  return String(fallback || "");
}

function localMinute(parts: ReturnType<typeof localParts>): number {
  return parts.hour * 60 + parts.minute;
}

function eventEndDate(startDate: string, startTime: string, endTime: string): string {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const crossesMidnight = end.hour * 60 + end.minute <= start.hour * 60 + start.minute;
  return crossesMidnight ? addDays(startDate, 1) : startDate;
}

export function nextWeeklyOccurrence(
  schedule: GuildScheduleData,
  item: GuildWeeklyScheduleItem,
  now = new Date(),
): ScheduledEventOccurrence | null {
  const days = Array.isArray(item.days) ? item.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [];
  if (!days.length) return null;

  const parts = localParts(now, offsetMinutes(schedule));
  const today = localDateKeyFromParts(parts.year, parts.month, parts.day);
  const nowMinutes = localMinute(parts);
  const start = parseTime(item.startTime);
  const end = parseTime(item.endTime);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;

  let bestDate = "";
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const day of days) {
    let delta = (day - parts.weekday + 7) % 7;
    if (delta === 0) {
      const stillUpcoming = endMinutes <= startMinutes ? nowMinutes < 24 * 60 : nowMinutes < endMinutes;
      if (!stillUpcoming) delta = 7;
    }
    if (delta < bestDelta) {
      bestDelta = delta;
      bestDate = addDays(today, delta);
    }
  }

  if (!bestDate) return null;
  const startIso = localToUtcIso(bestDate, item.startTime || "00:00", schedule);
  const endDate = eventEndDate(bestDate, item.startTime || "00:00", item.endTime || "00:00");
  const endIso = localToUtcIso(endDate, item.endTime || "00:00", schedule);

  return {
    ...item,
    date: bestDate,
    startIso,
    endIso,
  };
}

export function scheduleLine(item: GuildWeeklyScheduleItem, schedule: GuildScheduleData): string {
  const title = item.title || "Event";
  const details = [item.dayText, timeRangeText(item.startTime, item.endTime, schedule, item.timeText)]
    .filter(Boolean)
    .join(" - ");
  return details ? `${title}: ${details}` : title;
}

export function weeklyScheduleLines(schedule: GuildScheduleData): string[] {
  return (schedule.weekly || [])
    .filter((item) => item.showOnEventsBoard !== true)
    .map((item) => scheduleLine(item, schedule));
}

export function eventBoardItemsFromSchedule(schedule: GuildScheduleData, now = new Date()): ScheduledEventOccurrence[] {
  return (schedule.weekly || [])
    .filter((item) => item.showOnEventsBoard === true)
    .map((item) => nextWeeklyOccurrence(schedule, item, now))
    .filter((item): item is ScheduledEventOccurrence => Boolean(item));
}

function firstParagraph(value: unknown): string {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function eventSlotKey(event: Pick<WebsiteEventCard, "startIso" | "endIso" | "location">): string {
  return [event.startIso, event.endIso, event.location || ""].join("\n");
}

function shiftWeeklyOccurrence(
  schedule: GuildScheduleData,
  occurrence: ScheduledEventOccurrence,
  days: number,
): ScheduledEventOccurrence {
  const date = addDays(occurrence.date, days);
  const startTime = occurrence.startTime || "00:00";
  const endTime = occurrence.endTime || "00:00";
  const endDate = eventEndDate(date, startTime, endTime);
  return {
    ...occurrence,
    date,
    startIso: localToUtcIso(date, startTime, schedule),
    endIso: localToUtcIso(endDate, endTime, schedule),
  };
}

function nextNonOverlappingWeeklyOccurrence(
  schedule: GuildScheduleData,
  item: GuildWeeklyScheduleItem,
  monthlySlots: ReadonlySet<string>,
  now: Date,
): ScheduledEventOccurrence | null {
  const candidates = (item.days || [])
    .map((day) => nextWeeklyOccurrence(schedule, { ...item, days: [day] }, now))
    .filter((occurrence): occurrence is ScheduledEventOccurrence => Boolean(occurrence))
    .map((occurrence) =>
      monthlySlots.has(eventSlotKey(occurrence))
        ? shiftWeeklyOccurrence(schedule, occurrence, 7)
        : occurrence
    )
    .sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());

  return candidates[0] || null;
}

export function websiteEventCardsFromSchedule(schedule: GuildScheduleData, now = new Date()): WebsiteEventCard[] {
  const timezone = scheduleTimezoneLabel(schedule);
  const monthlyCards: WebsiteEventCard[] = Object.values(schedule.monthly || {})
    .filter((item) => item.id !== "monthly-raffle")
    .flatMap((item) => {
      const date = monthlyScheduleDate(schedule, item.id, "", now);
      if (!item.id || !item.title || !date) return [];

      const startTime = item.startTime || "00:00";
      const endTime = item.endTime || "00:00";
      const endDate = eventEndDate(date, startTime, endTime);
      const timeText = timeRangeText(startTime, endTime, schedule, item.time);

      return [{
        id: item.id,
        title: item.title,
        date,
        startTime,
        endTime,
        startIso: localToUtcIso(date, startTime, schedule),
        endIso: localToUtcIso(endDate, endTime, schedule),
        dayText: MONTHLY_RULE_LABELS[String(item.rule || "")] || item.rule,
        timeText,
        timezone,
        location: item.location,
        href: item.location,
        summary: firstParagraph(item.description) || timeText,
        image: item.discordCoverImage || "",
        discordCoverImage: item.discordCoverImage,
        discord: true,
      }];
    });

  const monthlySlots = new Set(monthlyCards.map(eventSlotKey));
  const weeklyCards: WebsiteEventCard[] = (schedule.weekly || [])
    .filter((item) => item.discord === true)
    .flatMap((item) => {
      const occurrence = nextNonOverlappingWeeklyOccurrence(schedule, item, monthlySlots, now);
      const id = occurrence?.id;
      const title = occurrence?.title;
      if (!occurrence || !id || !title) return [];

      const timeText = timeRangeText(occurrence.startTime, occurrence.endTime, schedule, occurrence.timeText);
      return [{
        ...occurrence,
        id,
        title,
        startTime: occurrence.startTime || "00:00",
        endTime: occurrence.endTime || "00:00",
        timeText,
        timezone,
        summary: occurrence.summary || [occurrence.dayText, timeText].filter(Boolean).join(" - "),
        image: occurrence.discordCoverImage || "",
        href: occurrence.href || occurrence.location,
      }];
    });

  return [...monthlyCards, ...weeklyCards].sort((a, b) => {
    const delta = new Date(a.startIso).getTime() - new Date(b.startIso).getTime();
    return delta || String(a.id || a.title).localeCompare(String(b.id || b.title));
  });
}
