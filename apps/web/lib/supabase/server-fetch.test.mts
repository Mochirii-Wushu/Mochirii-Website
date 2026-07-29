import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWithSupabaseServerTimeout,
  SupabaseServerRequestTimeoutError,
} from "./server-fetch.ts";

test("returns the upstream response and attaches a bounded signal", async () => {
  let receivedInput: RequestInfo | URL | undefined;
  let receivedSignal: AbortSignal | null | undefined;
  const expected = new Response("ok", { status: 200 });

  const response = await fetchWithSupabaseServerTimeout("https://example.test/auth", {
    method: "POST",
  }, {
    timeoutMs: 100,
    fetchImpl: async (input, init) => {
      receivedInput = input;
      receivedSignal = init?.signal;
      return expected;
    },
  });

  assert.equal(response, expected);
  assert.equal(receivedInput, "https://example.test/auth");
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(receivedSignal.aborted, false);
});

test("rejects a hung request at the deadline even when fetch ignores abort", async () => {
  let receivedSignal: AbortSignal | null | undefined;
  const startedAt = performance.now();

  await assert.rejects(
    fetchWithSupabaseServerTimeout("https://example.test/auth", {}, {
      timeoutMs: 20,
      fetchImpl: (_input, init) => {
        receivedSignal = init?.signal;
        return new Promise<Response>(() => {});
      },
    }),
    (error) => error instanceof SupabaseServerRequestTimeoutError,
  );

  assert.ok(receivedSignal?.aborted);
  assert.ok(performance.now() - startedAt < 500);
});

test("caller cancellation wins and propagates to the upstream request", async () => {
  const caller = new AbortController();
  const reason = new Error("request cancelled");
  let receivedSignal: AbortSignal | null | undefined;
  const pending = fetchWithSupabaseServerTimeout("https://example.test/auth", {
    signal: caller.signal,
  }, {
    timeoutMs: 1_000,
    fetchImpl: (_input, init) => {
      receivedSignal = init?.signal;
      return new Promise<Response>(() => {});
    },
  });

  caller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.ok(receivedSignal?.aborted);
  assert.equal(receivedSignal?.reason, reason);
});

test("honors a Request signal when init does not override it", async () => {
  const caller = new AbortController();
  const reason = new Error("request object cancelled");
  const request = new Request("https://example.test/auth", { signal: caller.signal });
  let receivedSignal: AbortSignal | null | undefined;
  const pending = fetchWithSupabaseServerTimeout(request, {}, {
    timeoutMs: 1_000,
    fetchImpl: (_input, init) => {
      receivedSignal = init?.signal;
      return new Promise<Response>(() => {});
    },
  });

  caller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.ok(receivedSignal?.aborted);
  assert.equal(receivedSignal?.reason, reason);
});

test("an explicit init signal overrides the Request signal", async () => {
  const requestController = new AbortController();
  const initController = new AbortController();
  const initReason = new Error("init cancelled");
  const request = new Request("https://example.test/auth", {
    signal: requestController.signal,
  });
  const pending = fetchWithSupabaseServerTimeout(request, {
    signal: initController.signal,
  }, {
    timeoutMs: 1_000,
    fetchImpl: () => new Promise<Response>(() => {}),
  });

  requestController.abort(new Error("request cancelled"));
  initController.abort(initReason);
  await assert.rejects(pending, (error) => error === initReason);
});

test("clears the deadline after a successful response", async () => {
  let receivedSignal: AbortSignal | null | undefined;
  await fetchWithSupabaseServerTimeout("https://example.test/auth", {}, {
    timeoutMs: 20,
    fetchImpl: async (_input, init) => {
      receivedSignal = init?.signal;
      return new Response("ok");
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(receivedSignal?.aborted, false);
});

test("preserves an upstream rejection", async () => {
  const failure = new Error("upstream failed");
  await assert.rejects(
    fetchWithSupabaseServerTimeout("https://example.test/auth", {}, {
      timeoutMs: 100,
      fetchImpl: async () => { throw failure; },
    }),
    (error) => error === failure,
  );
});

test("rejects an already-aborted caller without invoking fetch", async () => {
  const caller = new AbortController();
  const reason = new Error("already cancelled");
  caller.abort(reason);
  let invoked = false;

  await assert.rejects(
    fetchWithSupabaseServerTimeout("https://example.test/auth", {
      signal: caller.signal,
    }, {
      fetchImpl: async () => {
        invoked = true;
        return new Response();
      },
    }),
    (error) => error === reason,
  );
  assert.equal(invoked, false);
});

for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`rejects invalid timeout ${String(timeoutMs)}`, async () => {
    await assert.rejects(
      fetchWithSupabaseServerTimeout("https://example.test/auth", {}, { timeoutMs }),
      RangeError,
    );
  });
}
