import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelResponseBody,
  readBoundedResponseText,
} from "../apps/web/lib/bounded-response.ts";
import {
  spinnerNotModifiedResponseMetadata,
  spinnerProxyOutcomeForStatus,
} from "../apps/web/lib/spinner/proxy-outcome.ts";

const encoder = new TextEncoder();

test("bounded response reader accepts chunked UTF-8 at the exact byte ceiling", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("Mō"));
        controller.enqueue(encoder.encode("chī"));
        controller.close();
      },
    }),
  );
  const expected = "Mōchī";
  assert.equal(
    await readBoundedResponseText(response, encoder.encode(expected).byteLength),
    expected,
  );
});

test("bounded response reader cancels a chunked body once the byte ceiling is crossed", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("1234"));
        controller.enqueue(encoder.encode("5678"));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  assert.equal(await readBoundedResponseText(response, 7), null);
  assert.equal(cancelled, true);
});

test("bounded response reader rejects an oversized declaration before reading", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("small"));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "Content-Length": "999" } },
  );
  assert.equal(await readBoundedResponseText(response, 8), null);
  assert.equal(cancelled, true);
});

test("bounded response reader fails closed for invalid limits", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("{}"));
    },
    cancel() {
      cancelled = true;
    },
  }));
  assert.equal(await readBoundedResponseText(response, 0), null);
  assert.equal(cancelled, true);
  assert.equal(await readBoundedResponseText(new Response("{}"), Number.NaN), null);
});

test("bounded response reader cancels and releases a failed upstream reader", async () => {
  let cancelled = false;
  let released = false;
  const failed = {
    headers: new Headers(),
    body: {
      getReader() {
        return {
          read: async () => {
            throw new Error("upstream read failed");
          },
          cancel: async () => {
            cancelled = true;
          },
          releaseLock: () => {
            released = true;
          },
        };
      },
    },
  } as unknown as Response;

  await assert.rejects(
    readBoundedResponseText(failed, 32),
    /upstream read failed/,
  );
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test("opaque upstream denials cancel their unread body without surfacing cancellation errors", async () => {
  let cancelled = false;
  const denied = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"private":"denial"}'));
    },
    cancel() {
      cancelled = true;
      throw new Error("connection already closed");
    },
  }), { status: 403 });

  await cancelResponseBody(denied);
  assert.equal(cancelled, true);
});

test("spinner proxy outcomes distinguish polling, commands, and throttling", () => {
  assert.equal(spinnerProxyOutcomeForStatus("GET", 200), "synchronized");
  assert.equal(spinnerProxyOutcomeForStatus("POST", 200), "synchronized");
  assert.equal(spinnerProxyOutcomeForStatus("GET", 429), "rate-limited");
  assert.equal(spinnerProxyOutcomeForStatus("POST", 429), "rate-limited");
  assert.equal(spinnerProxyOutcomeForStatus("POST", 400), "command-rejected");
  assert.equal(spinnerProxyOutcomeForStatus("POST", 409), "command-rejected");
  assert.equal(spinnerProxyOutcomeForStatus("GET", 400), null);
  assert.equal(spinnerProxyOutcomeForStatus("GET", 409), null);
  assert.equal(spinnerProxyOutcomeForStatus("GET", 503), null);
});

test("spinner proxy preserves the ETag and authoritative server time for bodyless 304 responses", () => {
  const headers = new Headers({
    ETag: '"spinner-session-4-revealed"',
    "X-Mochirii-Server-Time": "2026-07-31T12:00:00.000Z",
  });
  assert.deepEqual(spinnerNotModifiedResponseMetadata(headers), {
    etag: '"spinner-session-4-revealed"',
    serverTime: "2026-07-31T12:00:00.000Z",
  });
  assert.equal(
    spinnerNotModifiedResponseMetadata(new Headers({ ETag: '"spinner-session-4-revealed"' })),
    null,
  );
  assert.equal(
    spinnerNotModifiedResponseMetadata(new Headers({
      ETag: '"spinner-session-4-revealed"',
      "X-Mochirii-Server-Time": "not-a-time",
    })),
    null,
  );
});
