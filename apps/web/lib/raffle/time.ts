export const RAFFLE_TIME_ZONE = "Asia/Singapore" as const;
export const RAFFLE_TIME_ZONE_LABEL = "UTC+8" as const;

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "long",
  timeStyle: "short",
};

export function formatRaffleTime(instant: string) {
  return formatRaffleTimeForZone(instant, RAFFLE_TIME_ZONE);
}

export function formatRaffleTimeForZone(instant: string, timeZone: string, locale = "en") {
  const date = parseRaffleInstant(instant);
  return new Intl.DateTimeFormat(locale, { ...dateTimeOptions, timeZone }).format(date);
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
