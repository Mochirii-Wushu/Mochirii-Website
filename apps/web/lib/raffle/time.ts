import { formatPublicDateTime } from "../public-date.ts";

export const RAFFLE_TIME_ZONE = "Asia/Singapore" as const;

export function formatRaffleTime(instant: string) {
  return formatRaffleTimeForZone(instant, RAFFLE_TIME_ZONE);
}

export function formatRaffleTimeForZone(instant: string, timeZone: string) {
  const date = parseRaffleInstant(instant);
  return formatPublicDateTime(date, timeZone);
}

export function parseRaffleInstant(instant: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(instant)) {
    throw new Error("Raffle date must be a UTC instant");
  }
  const date = new Date(instant);
  const normalized = /\.\d{3}Z$/.test(instant) ? instant : instant.replace(/Z$/, ".000Z");
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== normalized) {
    throw new Error("Raffle date must be a valid UTC instant");
  }
  return date;
}
