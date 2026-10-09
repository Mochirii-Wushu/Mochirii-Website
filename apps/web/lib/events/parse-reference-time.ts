export function parseReferenceTime(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Events reference time must be a valid ISO timestamp.");
  return parsed;
}
