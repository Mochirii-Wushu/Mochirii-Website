import {
  readOptionalJsonBody,
  readRequiredJsonBody,
} from "./gallery-moderation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jsonRequest(body: string, contentType = "application/json"): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

Deno.test("optional moderation JSON is streamed within its byte limit", async () => {
  const result = await readOptionalJsonBody(
    jsonRequest(JSON.stringify({ page_size: 25, cursor: "next" })),
    64,
  );
  assert(result.ok, "valid optional JSON was rejected");
  assert(result.body.page_size === 25, "valid optional JSON was not decoded");
});

Deno.test("optional moderation JSON rejects oversized and malformed bodies", async () => {
  const oversized = await readOptionalJsonBody(
    jsonRequest(JSON.stringify({ query: "x".repeat(100) })),
    32,
  );
  assert(!oversized.ok, "oversized optional JSON was accepted");
  assert(
    oversized.response.status === 400,
    "oversized optional JSON did not fail closed",
  );

  const malformed = await readOptionalJsonBody(jsonRequest("{"), 32);
  assert(!malformed.ok, "malformed optional JSON was accepted");
  assert(
    (await malformed.response.json()).error === "invalid_json",
    "malformed optional JSON returned the wrong public error",
  );
});

Deno.test("optional moderation JSON counts UTF-8 bytes rather than characters", async () => {
  const result = await readOptionalJsonBody(
    jsonRequest(JSON.stringify({ query: "🙂🙂🙂🙂" })),
    20,
  );
  assert(!result.ok, "multi-byte optional JSON bypassed the byte limit");
});

Deno.test("optional moderation JSON fails closed when the request stream errors", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("untrusted_stream_failure"));
    },
  });
  const result = await readOptionalJsonBody(
    new Request("https://example.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
  assert(!result.ok, "errored optional JSON stream was accepted");
});

Deno.test("non-JSON optional requests preserve the empty-filter contract", async () => {
  const result = await readOptionalJsonBody(
    jsonRequest("ignored", "text/plain"),
    1,
  );
  assert(result.ok, "non-JSON optional request was rejected");
  assert(
    Object.keys(result.body).length === 0,
    "non-JSON optional request was not empty",
  );
});

Deno.test("required moderation JSON uses the same streaming byte boundary", async () => {
  const valid = await readRequiredJsonBody(
    jsonRequest(JSON.stringify({ action: "approve" })),
    64,
  );
  assert(
    valid.ok && valid.body.action === "approve",
    "valid required JSON was rejected",
  );

  const oversized = await readRequiredJsonBody(
    jsonRequest(JSON.stringify({ action: "x".repeat(100) })),
    32,
  );
  assert(!oversized.ok, "oversized required JSON was accepted");
  assert(
    (await oversized.response.json()).error === "invalid_request",
    "oversized required JSON returned the wrong public error",
  );
});
