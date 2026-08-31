const PUBLIC_MONTH_ABBREVIATIONS = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);

function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const day = Number(values.get("day"));
  const month = Number(values.get("month"));
  const year = values.get("year") || "";

  if (!Number.isInteger(day) || day < 1 || day > 31
    || !Number.isInteger(month) || month < 1 || month > 12
    || !/^\d{4}$/u.test(year)) {
    throw new RangeError("Public date could not be formatted");
  }

  return { day, month, year };
}

export function formatPublicDate(date: Date, timeZone = "UTC") {
  if (Number.isNaN(date.valueOf())) throw new RangeError("Public date must be valid");
  const { day, month, year } = zonedDateParts(date, timeZone);
  return `${day} ${PUBLIC_MONTH_ABBREVIATIONS[month - 1]} ${year}`;
}

export function formatPublicDateTime(
  date: Date,
  timeZone: string,
  locale?: string,
) {
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${formatPublicDate(date, timeZone)}, ${time}`;
}
