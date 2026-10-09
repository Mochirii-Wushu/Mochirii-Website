const INVOCATION_BUDGET_MS = 90_000;
const FINALIZATION_RESERVE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_RETRY_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TRACKED_ROUTES = 128;
const MAX_BUCKET_COOLDOWNS = 64;

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
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

function waitForReset(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("Event sync wait was aborted."));
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Event sync wait was aborted."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

type Cooldown = { until: number; notBeforeIso: string };
type RouteState = {
  bucket: string | null;
  cooldown: (Cooldown & { bucket: string | null }) | null;
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
  const wait = options.wait ?? waitForReset;
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
  let busy = false;
  let rejectedPause: EventSyncPause | null = null;
  const routes = new Map<string, RouteState>();
  const buckets = new Map<string, Cooldown>();
  let hasBucketFallback = false;
  const checkDeadline = (fullRequestSlot = false) => {
    const remaining = remainingMs();
    if (remaining <= 0 || (fullRequestSlot && remaining < REQUEST_TIMEOUT_MS)) {
      throw new EventSyncPause("deadline", new Date(wallTime()).toISOString());
    }
    return remaining;
  };
  const admit = async (route: RouteState, signal?: AbortSignal) => {
    if (rejectedPause) throw rejectedPause;
    const remaining = remainingMs();
    let cooldown: Cooldown | null = route.cooldown &&
        (route.cooldown.bucket === null ||
          route.cooldown.bucket === route.bucket)
      ? route.cooldown
      : null;
    const shared = route.bucket ? buckets.get(route.bucket) : null;
    if (shared && (!cooldown || shared.until > cooldown.until)) {
      cooldown = shared;
    }
    if (route.bucket && hasBucketFallback) {
      // Overflow remains shared by all known aliases, including aliases learned
      // later. Snapshot the original bucket so reassignment cannot move a limit.
      for (const state of routes.values()) {
        const fallback = state.cooldown;
        if (
          fallback?.bucket === route.bucket &&
          (!cooldown || fallback.until > cooldown.until)
        ) cooldown = fallback;
      }
    }
    const delay = cooldown ? cooldown.until - (deadline - remaining) : 0;
    let waited = false;
    if (cooldown && delay > 0) {
      // A full reset and request slot must fit before the finalization reserve.
      // Otherwise retain the full cooldown even after the invocation deadline.
      if (Math.ceil(delay) + REQUEST_TIMEOUT_MS > remaining) {
        throw new EventSyncPause("rate_limit", cooldown.notBeforeIso);
      }
      try {
        await wait(Math.ceil(delay), signal);
        waited = true;
      } catch {
        throw new Error(
          "Discord event sync cooldown wait could not be confirmed.",
        );
      }
      if (signal?.aborted || deadline - remainingMs() < cooldown.until) {
        throw new Error(
          "Discord event sync cooldown wait could not be confirmed.",
        );
      }
    }
    checkDeadline(waited);
    return waited;
  };
  const rememberCooldown = (
    response: Response,
    route: RouteState,
    guild: string,
  ) => {
    const rawBucket = response.headers.get("X-RateLimit-Bucket");
    const bucket = rawBucket && /^[\x21-\x7e]{1,128}$/.test(rawBucket)
      ? `${guild}:${rawBucket}`
      : route.bucket;
    // Learn shared identities even on successes with capacity remaining. Missing
    // or malformed optional telemetry cannot erase a previously learned alias.
    if (bucket) route.bucket = bucket;
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
      const cooldown = {
        until,
        notBeforeIso: new Date(now + delay).toISOString(),
      };
      for (const [key, value] of buckets) {
        if (value.until <= until - delay) buckets.delete(key);
      }
      if (
        bucket && (buckets.has(bucket) || buckets.size < MAX_BUCKET_COOLDOWNS)
      ) {
        if (!buckets.has(bucket) || until > buckets.get(bucket)!.until) {
          buckets.set(bucket, cooldown);
        }
      } else if (!route.cooldown || until > route.cooldown.until) {
        // Unknown buckets cool down only this route. At capacity, retain a known
        // shared identity for bounded admission lookup without losing the ACK.
        // Never discard a confirmed acknowledgement to store optional headers.
        route.cooldown = { ...cooldown, bucket };
        if (bucket) hasBucketFallback = true;
      }
    } catch { /* No inference from malformed optional response telemetry. */ }
  };

  return async (
    path: string,
    init: RequestInit = {},
    beforeAttempt?: () => Promise<void>,
  ): Promise<{ ok: boolean; status: number; data: unknown }> => {
    const match = /^\/guilds\/(\d{17,20})\/scheduled-events(\/\d{17,20})?$/
      .exec(path);
    if (!match) {
      throw new Error("Discord event sync API path was rejected.");
    }
    const method = (init.method ?? "GET").toUpperCase();
    if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method)) {
      throw new Error("Discord event sync method was rejected.");
    }
    if (busy) {
      throw new Error("Discord event sync request is already in flight.");
    }
    const routeKey = `${match[1]}:${method}:${match[2] ? "event" : "list"}`;
    if (!routes.has(routeKey)) {
      if (routes.size >= MAX_TRACKED_ROUTES) {
        throw new Error("Discord event sync route capacity was exceeded.");
      }
      routes.set(routeKey, { bucket: null, cooldown: null });
    }
    busy = true;
    try {
      if (init.signal?.aborted) {
        throw new Error("Discord event sync request was aborted.");
      }
      const waited = await admit(
        routes.get(routeKey)!,
        init.signal ?? undefined,
      );
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
      const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, checkDeadline(waited));
      const attemptStarted = monotonicNow();
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (init.signal?.aborted) {
        throw new Error("Discord event sync request was aborted.");
      }
      init.signal?.addEventListener("abort", abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort: (() => void) | undefined;
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
        const { response, data } = await Promise.race([
          work(),
          timeout,
          aborted,
        ]);
        if (response.status === 429) {
          const delay = rateLimitDelayMs(response, data);
          const now = wallTime();
          if (delay > MAX_DATE_MS - now) {
            throw new Error("Discord event sync retry date is unsafe.");
          }
          rejectedPause = new EventSyncPause(
            "rate_limit",
            new Date(now + delay).toISOString(),
          );
          throw rejectedPause;
        }
        if (response.ok) {
          rememberCooldown(response, routes.get(routeKey)!, match[1]);
        }
        return { ok: response.ok, status: response.status, data };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (rejectAbort) {
          controller.signal.removeEventListener("abort", rejectAbort);
        }
        init.signal?.removeEventListener("abort", abort);
      }
    } finally {
      busy = false;
    }
  };
}
