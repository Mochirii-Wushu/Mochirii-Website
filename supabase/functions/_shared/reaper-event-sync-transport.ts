const INVOCATION_BUDGET_MS = 90_000;
const FINALIZATION_RESERVE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_RETRY_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export class EventSyncPause extends Error {
  constructor(
    readonly reason: "rate_limit" | "deadline",
    readonly notBeforeIso: string,
  ) {
    super(
      reason === "rate_limit"
        ? "Discord rate limit requires a later fresh event sync."
        : "Event sync reached its deadline before another Discord request.",
    );
    this.name = "EventSyncPause";
    if (
      !["rate_limit", "deadline"].includes(reason) ||
      !Number.isFinite(Date.parse(notBeforeIso)) ||
      new Date(notBeforeIso).toISOString() !== notBeforeIso
    ) throw new Error("Event sync pause identity is invalid.");
  }
}

type TransportOptions = {
  fetch?: typeof fetch;
  monotonicNow?: () => number;
  wallNow?: () => number;
};

async function boundedJson(
  response: Response,
  method: string,
  signal: AbortSignal,
  checkTime: () => void,
): Promise<unknown> {
  const declaredSize = response.headers.get("Content-Length");
  if (
    declaredSize !== null &&
    (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error("Discord event sync response size was rejected.");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      if (signal.aborted) {
        throw new Error("Discord event sync response was aborted.");
      }
      while (true) {
        checkTime();
        const { value, done } = await reader.read();
        checkTime();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {});
          throw new Error(
            "Discord event sync response exceeds its byte limit.",
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      cancel();
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  }
  if (!size) {
    if ((response.status === 204 && method === "DELETE") || method === "HEAD") {
      return null;
    }
    throw new Error("Discord event sync response is empty.");
  }
  if (
    response.headers.get("Content-Type")?.split(";", 1)[0].trim()
      .toLowerCase() !== "application/json"
  ) {
    throw new Error("Discord event sync response type was rejected.");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  checkTime();
  const data: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (data === null || typeof data !== "object") {
    throw new Error("Discord event sync response shape was rejected.");
  }
  return data;
}

function rateLimitDelayMs(response: Response, data: unknown): number {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Discord event sync rate limit response is malformed.");
  }
  const seconds: number[] = [];
  for (const name of ["Retry-After", "X-RateLimit-Reset-After"]) {
    const value = response.headers.get(name);
    if (value === null) continue;
    if (!/^\d+(?:\.\d+)?$/.test(value.trim())) {
      throw new Error("Discord event sync retry delay is invalid.");
    }
    seconds.push(Number(value));
  }
  if (Object.hasOwn(data, "retry_after")) {
    const value = (data as Record<string, unknown>).retry_after;
    if (typeof value !== "number") {
      throw new Error("Discord event sync retry delay is invalid.");
    }
    seconds.push(value);
  }
  if (
    !seconds.length ||
    seconds.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error("Discord event sync retry delay is missing or invalid.");
  }
  const delay = Math.ceil(Math.max(...seconds) * 1000);
  if (
    !Number.isSafeInteger(delay) || delay <= 0 || delay > MAX_RETRY_DELAY_MS
  ) {
    throw new Error("Discord event sync retry delay is unsafe.");
  }
  return delay;
}

export function createEventSyncDiscordApi(
  baseUrl: string,
  options: TransportOptions = {},
) {
  if (baseUrl !== "https://discord.com/api/v10") {
    throw new Error("Discord event sync API origin was rejected.");
  }
  const fetcher = options.fetch ?? fetch;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const wallNow = options.wallNow ?? Date.now;
  const startedAt = monotonicNow();
  const deadline = startedAt + INVOCATION_BUDGET_MS - FINALIZATION_RESERVE_MS;
  if (
    !Number.isFinite(startedAt) || startedAt < 0 ||
    !Number.isFinite(deadline) || deadline > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Event sync clock is invalid.");
  }
  const remainingMs = () => {
    const now = monotonicNow();
    if (!Number.isFinite(now) || now < startedAt) {
      throw new Error("Event sync clock is invalid.");
    }
    return deadline - now;
  };
  const wallTime = () => {
    const now = wallNow();
    if (!Number.isSafeInteger(now) || Math.abs(now) > MAX_DATE_MS) {
      throw new Error("Event sync wall clock is invalid.");
    }
    return now;
  };
  let inFlight = false;
  let cooldown: { until: number; notBeforeIso: string } | null = null;
  const checkAdmission = () => {
    if (inFlight) {
      throw new Error("Discord event sync request is already in flight.");
    }
    const remaining = remainingMs();
    // Retain the full known cooldown even if finalization also exhausted the
    // invocation deadline; a new invocation must not be admitted prematurely.
    if (cooldown && deadline - remaining < cooldown.until) {
      throw new EventSyncPause("rate_limit", cooldown.notBeforeIso);
    }
    if (remaining <= 0) {
      throw new EventSyncPause("deadline", new Date(wallTime()).toISOString());
    }
    return remaining;
  };
  const rememberCooldown = (response: Response) => {
    const remaining = response.headers.get("X-RateLimit-Remaining")?.trim();
    const reset = response.headers.get("X-RateLimit-Reset-After")?.trim();
    if (remaining !== "0" || !reset || !/^\d+(?:\.\d+)?$/.test(reset)) return;
    const delay = Math.ceil(Number(reset) * 1000);
    if (
      !Number.isSafeInteger(delay) || delay <= 0 || delay > MAX_RETRY_DELAY_MS
    ) return;
    // Optional telemetry must never discard an acknowledged mutation. Only
    // infer a cooldown when its clocks and full reset interval are usable.
    try {
      const until = monotonicNow() + delay;
      const now = wallTime();
      if (!Number.isFinite(until) || delay > MAX_DATE_MS - now) return;
      if (!cooldown || until > cooldown.until) {
        cooldown = { until, notBeforeIso: new Date(now + delay).toISOString() };
      }
    } catch { /* No inference from malformed optional response telemetry. */ }
  };

  return async (
    path: string,
    init: RequestInit = {},
    beforeAttempt?: () => Promise<void>,
  ): Promise<{ ok: boolean; status: number; data: unknown }> => {
    if (!/^\/guilds\/\d{17,20}\/scheduled-events(?:\/\d{17,20})?$/.test(path)) {
      throw new Error("Discord event sync API path was rejected.");
    }
    const method = (init.method ?? "GET").toUpperCase();
    if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method)) {
      throw new Error("Discord event sync method was rejected.");
    }
    checkAdmission();
    if (method !== "GET" && method !== "HEAD") {
      if (!beforeAttempt) {
        throw new Error("Discord event sync mutation fence is required.");
      }
      try {
        await beforeAttempt();
      } catch {
        throw new Error(
          "Discord event sync mutation fence could not be confirmed.",
        );
      }
    }
    const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, checkAdmission());
    const attemptStarted = monotonicNow();
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal?.aborted) {
      throw new Error("Discord event sync request was aborted.");
    }
    init.signal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    inFlight = true;
    try {
      const checkTime = () => {
        const now = monotonicNow();
        if (
          !Number.isFinite(now) || now < attemptStarted ||
          now - attemptStarted >= timeoutMs
        ) {
          throw new Error(
            "Discord event sync request or response exceeded its time limit.",
          );
        }
      };
      const work = async () => {
        try {
          const response = await fetcher(`${baseUrl}${path}`, {
            ...init,
            method,
            redirect: "error",
            signal: controller.signal,
          });
          if (
            response.redirected ||
            (response.status >= 300 && response.status < 400)
          ) {
            throw new Error(
              "Discord event sync response redirect was rejected.",
            );
          }
          const data = await boundedJson(
            response,
            method,
            controller.signal,
            checkTime,
          );
          if (controller.signal.aborted) {
            throw new Error("Discord event sync request was aborted.");
          }
          checkTime();
          return { response, data };
        } catch {
          controller.abort();
          // Only our explicit deadline/429 checks may produce a safe pause.
          // A fetch, stream or callback error can never establish rejection.
          throw new Error(
            "Discord event sync request or response could not be confirmed.",
          );
        }
      };
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new Error("Discord event sync request or response timed out."),
          );
        }, timeoutMs);
      });
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () =>
          reject(new Error("Discord event sync request was aborted."));
        controller.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
      });
      const { response, data } = await Promise.race([work(), timeout, aborted]);
      if (response.status === 429) {
        const delay = rateLimitDelayMs(response, data);
        const now = wallTime();
        if (delay > MAX_DATE_MS - now) {
          throw new Error("Discord event sync retry date is unsafe.");
        }
        throw new EventSyncPause(
          "rate_limit",
          new Date(now + delay).toISOString(),
        );
      }
      if (response.ok) rememberCooldown(response);
      return { ok: response.ok, status: response.status, data };
    } finally {
      inFlight = false;
      if (timer !== undefined) clearTimeout(timer);
      if (rejectAbort) {
        controller.signal.removeEventListener("abort", rejectAbort);
      }
      init.signal?.removeEventListener("abort", abort);
    }
  };
}
