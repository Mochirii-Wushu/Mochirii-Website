export const SUPABASE_SERVER_REQUEST_TIMEOUT_MS = 5_000;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class SupabaseServerRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Supabase server request exceeded the ${timeoutMs} ms limit.`);
    this.name = "SupabaseServerRequestTimeoutError";
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason === undefined
    ? new DOMException("The operation was aborted.", "AbortError")
    : signal.reason;
}

export async function fetchWithSupabaseServerTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  {
    fetchImpl = fetch,
    timeoutMs = SUPABASE_SERVER_REQUEST_TIMEOUT_MS,
  }: {
    fetchImpl?: FetchImplementation;
    timeoutMs?: number;
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Supabase server request timeout must be a positive finite number.");
  }

  const callerSignal = init.signal !== undefined
    ? init.signal
    : input instanceof Request
      ? input.signal
      : undefined;
  if (callerSignal?.aborted) throw abortReason(callerSignal);

  const controller = new AbortController();
  let rejectStop!: (reason?: unknown) => void;
  let stopped = false;
  const stopPromise = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });

  const stop = (reason: unknown) => {
    if (stopped) return;
    stopped = true;
    controller.abort(reason);
    rejectStop(reason);
  };
  const onCallerAbort = () => stop(abortReason(callerSignal as AbortSignal));
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  const timer = setTimeout(() => {
    stop(new SupabaseServerRequestTimeoutError(timeoutMs));
  }, timeoutMs);

  try {
    const requestPromise = Promise.resolve().then(() => fetchImpl(input, {
      ...init,
      signal: controller.signal,
    }));
    return await Promise.race([requestPromise, stopPromise]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

export function supabaseServerFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetchWithSupabaseServerTimeout(input, init);
}
