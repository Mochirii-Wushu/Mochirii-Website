type EventTiming = {
  date?: string;
  endIso?: string;
};

export { parseReferenceTime } from "./parse-reference-time.ts";

function parseDateOnlyUTC(value: unknown) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseIso(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function eventStatusAt(item: EventTiming, referenceTimeMs: number, offsetMinutes = 480) {
  const eventEnd = parseIso(item.endIso);
  if (eventEnd) return eventEnd.getTime() > referenceTimeMs ? "upcoming" : "past";

  const eventDate = parseDateOnlyUTC(item.date);
  if (!eventDate) return "upcoming";

  const reference = new Date(referenceTimeMs + offsetMinutes * 60 * 1000);
  const referenceDay = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  return eventDate.getTime() >= referenceDay ? "upcoming" : "past";
}
