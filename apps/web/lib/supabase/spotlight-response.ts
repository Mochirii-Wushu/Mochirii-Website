import { cancelResponseBody } from "../bounded-response.ts";
import type { CurrentSpotlightWinner } from "./types";

const MAX_SPOTLIGHT_RESPONSE_BYTES = 4_096;
const MAX_SPOTLIGHT_ENDPOINT_CHARS = 2_048;
const SPOTLIGHT_FETCH_TIMEOUT_MS = 5_000;
const SPOTLIGHT_FUNCTION_PATH = "/functions/v1/get-current-spotlight-winner";
const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1_000;
const MONTH_KEY = /^\d{4}-(?:0[1-9]|1[0-2])-01$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const UNPAIRED_SURROGATE = /[\ud800-\udfff]/u;

export type SpotlightFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? value as Record<string, unknown>
    : null;
}

function boundedWinnerName(value: unknown): string | null {
  if (typeof value !== "string" || CONTROL_OR_BIDI.test(value) || UNPAIRED_SURROGATE.test(value)) return null;
  const name = value.trim().replace(/\s+/gu, " ");
  return name && name.length <= 120 ? name : null;
}

function validLegacyTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && TIMESTAMP.test(value)
    && Number.isFinite(Date.parse(value));
}

function normalizedWinner(data: Record<string, unknown>): CurrentSpotlightWinner | null {
  const monthKey = data.monthKey;
  if (typeof monthKey !== "string" || !MONTH_KEY.test(monthKey)) return null;
  if (data.winnerName === null) return { winnerName: null, monthKey };
  const winnerName = boundedWinnerName(data.winnerName);
  return winnerName ? { winnerName, monthKey } : null;
}

function singaporeMonthKey(instant: Date): string | null {
  if (!(instant instanceof Date) || !Number.isFinite(instant.valueOf())) return null;
  const local = new Date(instant.valueOf() + SINGAPORE_OFFSET_MS);
  if (!Number.isFinite(local.valueOf())) return null;
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function parseCurrentSpotlightWinnerPayload(
  raw: string,
  expectedMonthKey: string,
): CurrentSpotlightWinner | null {
  if (!MONTH_KEY.test(expectedMonthKey)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }

  const envelope = exactRecord(decoded, ["ok", "data"]);
  if (envelope?.ok !== true) return null;

  const current = exactRecord(envelope.data, ["winnerName", "monthKey"]);
  if (current) {
    const winner = normalizedWinner(current);
    return winner?.monthKey === expectedMonthKey ? winner : null;
  }

  const legacy = exactRecord(envelope.data, ["winnerName", "monthKey", "publishedAt", "source"]);
  if (!legacy) return null;
  if (legacy.source === "fallback") {
    const winner = legacy.winnerName === null && legacy.publishedAt === null
      ? normalizedWinner(legacy)
      : null;
    return winner?.monthKey === expectedMonthKey ? winner : null;
  }
  const winner = legacy.source === "monthly-discord-poll" && validLegacyTimestamp(legacy.publishedAt)
    ? normalizedWinner(legacy)
    : null;
  return winner?.monthKey === expectedMonthKey ? winner : null;
}

function jsonMediaTypeIsExact(value: string | null) {
  return value?.trim().toLowerCase() === "application/json";
}

function exactSpotlightEndpoint(value: unknown): URL | null {
  if (typeof value !== "string" || !value || value.length > MAX_SPOTLIGHT_ENDPOINT_CHARS) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname === SPOTLIGHT_FUNCTION_PATH
      && url.href === value
      ? url
      : null;
  } catch {
    return null;
  }
}

function responseMatchesExactRequest(response: Response, requested: URL) {
  if (!response.url || response.url.length > MAX_SPOTLIGHT_ENDPOINT_CHARS) return false;

  try {
    const observed = new URL(response.url);
    return !observed.username
      && !observed.password
      && observed.href === requested.href;
  } catch {
    return false;
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    await cancelResponseBody(response);
    return null;
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = /^(?:0|[1-9]\d*)$/u.test(declaredLength) ? Number(declaredLength) : Number.NaN;
    if (!Number.isSafeInteger(parsedLength) || parsedLength > maxBytes) {
      await cancelResponseBody(response);
      return null;
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchCurrentSpotlightWinner({
  endpoint,
  publishableKey,
  fetchImpl = fetch,
  currentTime = new Date(),
}: {
  endpoint: string;
  publishableKey: string;
  fetchImpl?: SpotlightFetch;
  currentTime?: Date;
}): Promise<CurrentSpotlightWinner | null> {
  const requested = exactSpotlightEndpoint(endpoint);
  const expectedMonthKey = singaporeMonthKey(currentTime);
  if (!requested || !publishableKey || !expectedMonthKey) return null;

  try {
    const response = await fetchImpl(requested.href, {
      method: "GET",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(SPOTLIGHT_FETCH_TIMEOUT_MS),
    });
    if (!responseMatchesExactRequest(response, requested)
      || !response.ok
      || !jsonMediaTypeIsExact(response.headers.get("content-type"))) {
      await cancelResponseBody(response);
      return null;
    }

    const raw = await readBoundedResponseText(response, MAX_SPOTLIGHT_RESPONSE_BYTES);
    return raw === null ? null : parseCurrentSpotlightWinnerPayload(raw, expectedMonthKey);
  } catch {
    return null;
  }
}
