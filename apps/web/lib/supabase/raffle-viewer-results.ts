import type { RaffleViewerResultNames } from "../raffle/public-view";

const resultKeyPattern = /^[a-z0-9][a-z0-9-]{5,63}:[1-9]\d{0,2}$/;
const unsafeDisplayNamePattern = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseRaffleViewerResultNames(
  value: unknown,
): RaffleViewerResultNames | undefined {
  const payload = record(value);
  if (Object.keys(payload).length !== 1 || !("resultNames" in payload)) {
    return undefined;
  }

  const names = record(payload.resultNames);
  const entries = Object.entries(names);
  if (entries.length === 0) return undefined;
  if (entries.length > 3) return undefined;

  const parsed: Record<string, string> = {};
  for (const [resultKey, rawName] of entries) {
    if (!resultKeyPattern.test(resultKey) || typeof rawName !== "string") {
      return undefined;
    }
    const displayName = rawName.trim();
    if (
      !displayName
      || displayName.length > 40
      || unsafeDisplayNamePattern.test(displayName)
    ) {
      return undefined;
    }
    parsed[resultKey] = displayName;
  }

  return Object.freeze(parsed);
}
