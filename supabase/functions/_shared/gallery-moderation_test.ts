import {
  moderatorConfigMatches,
  readOptionalJsonBody,
  readRequiredJsonBody,
  verifyLiveDiscordModerator,
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

Deno.test("moderator role configuration fails closed on drift", () => {
  assert(
    moderatorConfigMatches(["1078630751165222984"]),
    "exact moderator role configuration was rejected",
  );
  assert(
    !moderatorConfigMatches([]),
    "missing moderator role configuration passed",
  );
  assert(
    !moderatorConfigMatches([
      "1078630751165222984",
      "123456789012345678",
    ]),
    "extra moderator role configuration passed",
  );
});

Deno.test("live moderator lookup is bounded, redirect-safe, and single-attempt", async () => {
  let calls = 0;
  let requestInit: RequestInit | undefined;
  const result = await verifyLiveDiscordModerator(
    {
      botToken: "test-only-token",
      discordUserId: "123456789012345678",
      expectedRoleIds: ["1078630751165222984"],
      timeoutMs: 100,
    },
    (_input, init) => {
      calls += 1;
      requestInit = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            roles: ["1078630751165222984"],
            pending: false,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    },
  );

  assert(result.ok, "current moderator role was rejected");
  assert(calls === 1, "Discord lookup retried automatically");
  assert(requestInit?.redirect === "error", "Discord redirects were followed");
  assert(requestInit?.cache === "no-store", "Discord response could be cached");
  assert(
    requestInit?.signal instanceof AbortSignal,
    "timeout signal is missing",
  );
});

Deno.test("live moderator lookup times out and fails closed", async () => {
  let calls = 0;
  const result = await verifyLiveDiscordModerator(
    {
      botToken: "test-only-token",
      discordUserId: "123456789012345678",
      expectedRoleIds: ["1078630751165222984"],
      timeoutMs: 5,
    },
    (_input, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    },
  );

  assert(!result.ok, "timed-out Discord lookup passed");
  assert(result.error === "discord_lookup_timeout", "timeout category drifted");
  assert(calls === 1, "timed-out Discord lookup retried");
});

Deno.test("live moderator deadline covers a stalled response body", async () => {
  const result = await verifyLiveDiscordModerator(
    {
      botToken: "test-only-token",
      discordUserId: "123456789012345678",
      expectedRoleIds: ["1078630751165222984"],
      timeoutMs: 5,
    },
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // Keep the provider body open until the lookup deadline cancels it.
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
  );

  assert(!result.ok, "stalled Discord body passed");
  assert(
    result.error === "discord_lookup_timeout",
    "stalled Discord body returned the wrong safe category",
  );
});

Deno.test("live moderator lookup never exposes role ids or rate-limit headers", async () => {
  const missingRole = await verifyLiveDiscordModerator(
    {
      botToken: "test-only-token",
      discordUserId: "123456789012345678",
      expectedRoleIds: ["1078630751165222984"],
      timeoutMs: 100,
    },
    () =>
      Promise.resolve(
        new Response(JSON.stringify({ roles: [], pending: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
  );
  assert(!missingRole.ok, "missing live moderator role passed");
  assert(
    !JSON.stringify(missingRole).includes("1078630751165222984"),
    "moderator role id reached the failure DTO",
  );

  const rateLimited = await verifyLiveDiscordModerator(
    {
      botToken: "test-only-token",
      discordUserId: "123456789012345678",
      expectedRoleIds: ["1078630751165222984"],
      timeoutMs: 100,
    },
    () =>
      Promise.resolve(
        new Response("private provider message", {
          status: 429,
          headers: { "Retry-After": "private-provider-value" },
        }),
      ),
  );
  assert(!rateLimited.ok, "rate-limited Discord lookup passed");
  const encoded = JSON.stringify(rateLimited);
  assert(!encoded.includes("private-provider"), "provider evidence leaked");
});

Deno.test("live moderator lookup rejects oversized or malformed provider bodies", async () => {
  const result = await verifyLiveDiscordModerator(
    {
      botToken: "test-only-token",
      discordUserId: "123456789012345678",
      expectedRoleIds: ["1078630751165222984"],
      timeoutMs: 100,
    },
    () =>
      Promise.resolve(
        new Response(JSON.stringify({ roles: ["1".repeat(40_000)] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
  );
  assert(!result.ok, "oversized Discord response passed");
  assert(result.error === "discord_response_invalid", "wrong safe category");
});
