import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchCurrentSpotlightWinner,
  parseCurrentSpotlightWinnerPayload,
  type SpotlightFetch,
} from "./spotlight-response.ts";

const ENDPOINT = "https://example.invalid/functions/v1/get-current-spotlight-winner";
const AUGUST_TIME = new Date("2026-08-15T00:00:00Z");

function responseWithUrl(response: Response, url = ENDPOINT) {
  Object.defineProperty(response, "url", { configurable: true, value: url });
  return response;
}

function jsonResponse(value: unknown, contentType = "application/json", url = ENDPOINT) {
  return responseWithUrl(new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": contentType },
  }), url);
}

const selected = {
  ok: true,
  data: {
    winnerName: "  Nur   Syidah  ",
    monthKey: "2026-08-01",
  },
};

test("the actual fetch boundary accepts only the exact bounded public winner DTO", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const fetchImpl: SpotlightFetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return jsonResponse(selected);
  };

  assert.deepEqual(await fetchCurrentSpotlightWinner({
    endpoint: ENDPOINT,
    publishableKey: "placeholder",
    fetchImpl,
    currentTime: AUGUST_TIME,
  }), {
    winnerName: "Nur Syidah",
    monthKey: "2026-08-01",
  });
  const request = requests[0];
  assert.ok(request);
  assert.equal(request?.init?.method, "GET");
  assert.equal(request?.init?.cache, "no-store");
  assert.equal(request?.init?.redirect, "error");
  assert.ok(request?.init?.signal instanceof AbortSignal);
  assert.equal(request?.init?.signal?.aborted, false);
});

test("the exact generic fallback contains no member data", () => {
  assert.deepEqual(parseCurrentSpotlightWinnerPayload(JSON.stringify({
    ok: true,
    data: { winnerName: null, monthKey: "2026-09-01" },
  }), "2026-09-01"), {
    winnerName: null,
    monthKey: "2026-09-01",
  });
});

test("the exact deployed legacy DTO is accepted only as transitional input and minimized", () => {
  assert.deepEqual(parseCurrentSpotlightWinnerPayload(JSON.stringify({
    ok: true,
    data: {
      winnerName: "Nur Syidah",
      monthKey: "2026-08-01",
      publishedAt: "2026-08-07T16:20:06.544+00:00",
      source: "monthly-discord-poll",
    },
  }), "2026-08-01"), { winnerName: "Nur Syidah", monthKey: "2026-08-01" });
  assert.deepEqual(parseCurrentSpotlightWinnerPayload(JSON.stringify({
    ok: true,
    data: {
      winnerName: null,
      monthKey: "2026-09-01",
      publishedAt: null,
      source: "fallback",
    },
  }), "2026-09-01"), { winnerName: null, monthKey: "2026-09-01" });
});

test("extra, malformed, hostile, and obsolete fields fail closed", () => {
  for (const payload of [
    { ...selected, private: "sentinel" },
    { ...selected, data: { ...selected.data, accountId: "sentinel" } },
    { ...selected, data: { ...selected.data, winnerName: ["Alice"] } },
    { ...selected, data: { ...selected.data, winnerName: "Alice\nInjected" } },
    { ...selected, data: { ...selected.data, winnerName: "Alice\u061cInjected" } },
    { ...selected, data: { ...selected.data, winnerName: "Alice\u200eInjected" } },
    { ...selected, data: { ...selected.data, winnerName: "Alice\u200fInjected" } },
    { ...selected, data: { ...selected.data, winnerName: "Alice\ud800Injected" } },
    { ...selected, data: { ...selected.data, monthKey: "2026-08-02" } },
    { ...selected, data: { ...selected.data, publishedAt: "2026-08-01T00:05:00+08:00" } },
    { ...selected, data: { ...selected.data, source: "monthly-random-selection" } },
    { ok: true, data: { winnerName: "Alice", monthKey: "2026-08-01", publishedAt: null, source: "fallback" } },
    { ok: true, data: { winnerName: "Alice", monthKey: "2026-08-01", publishedAt: "not-a-time", source: "monthly-discord-poll" } },
  ]) {
    assert.equal(parseCurrentSpotlightWinnerPayload(JSON.stringify(payload), "2026-08-01"), null);
  }
});

test("oversized, wrong-media, and unsuccessful responses are cancelled and rejected", async () => {
  for (const response of [
    responseWithUrl(new Response("x".repeat(4_097), { status: 200, headers: { "content-type": "application/json" } })),
    jsonResponse(selected, "text/plain"),
    responseWithUrl(new Response(JSON.stringify(selected), { status: 500, headers: { "content-type": "application/json" } })),
  ]) {
    assert.equal(await fetchCurrentSpotlightWinner({
      endpoint: ENDPOINT,
      publishableKey: "placeholder",
      fetchImpl: async () => response,
      currentTime: AUGUST_TIME,
    }), null);
  }
});

test("credentialed endpoints and observed URL drift fail before accepting a winner", async () => {
  let credentialedFetches = 0;
  assert.equal(await fetchCurrentSpotlightWinner({
    endpoint: "https://user:placeholder@example.invalid/functions/v1/get-current-spotlight-winner",
    publishableKey: "placeholder",
    currentTime: AUGUST_TIME,
    fetchImpl: async () => {
      credentialedFetches += 1;
      return jsonResponse(selected);
    },
  }), null);
  assert.equal(credentialedFetches, 0);

  for (const observedUrl of [
    "https://outside.example/forged",
    `${ENDPOINT}?signed=sentinel`,
    "",
  ]) {
    assert.equal(await fetchCurrentSpotlightWinner({
      endpoint: ENDPOINT,
      publishableKey: "placeholder",
      fetchImpl: async () => jsonResponse(selected, "application/json", observedUrl),
      currentTime: AUGUST_TIME,
    }), null);
  }
});

test("invalid UTF-8 is rejected instead of becoming replacement text", async () => {
  const encoder = new TextEncoder();
  const prefix = encoder.encode('{"ok":true,"data":{"winnerName":"Alice');
  const suffix = encoder.encode('","monthKey":"2026-08-01"}}');
  const bytes = new Uint8Array(prefix.length + 1 + suffix.length);
  bytes.set(prefix);
  bytes[prefix.length] = 0xff;
  bytes.set(suffix, prefix.length + 1);

  assert.equal(await fetchCurrentSpotlightWinner({
    endpoint: ENDPOINT,
    publishableKey: "placeholder",
    fetchImpl: async () => responseWithUrl(new Response(bytes, {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
    currentTime: AUGUST_TIME,
  }), null);
});

test("legacy and current DTOs are bound to the Singapore month across rollover", async () => {
  const fetchImpl: SpotlightFetch = async () => jsonResponse({
    ok: true,
    data: {
      winnerName: "Nur Syidah",
      monthKey: "2026-08-01",
      publishedAt: "2026-08-07T16:20:06.544+00:00",
      source: "monthly-discord-poll",
    },
  });

  assert.deepEqual(await fetchCurrentSpotlightWinner({
    endpoint: ENDPOINT,
    publishableKey: "placeholder",
    fetchImpl,
    currentTime: new Date("2026-08-31T15:59:59.999Z"),
  }), { winnerName: "Nur Syidah", monthKey: "2026-08-01" });
  assert.equal(await fetchCurrentSpotlightWinner({
    endpoint: ENDPOINT,
    publishableKey: "placeholder",
    fetchImpl,
    currentTime: new Date("2026-08-31T16:00:00.000Z"),
  }), null);

  assert.deepEqual(await fetchCurrentSpotlightWinner({
    endpoint: ENDPOINT,
    publishableKey: "placeholder",
    fetchImpl: async () => jsonResponse({
      ok: true,
      data: { winnerName: "September Member", monthKey: "2026-09-01" },
    }),
    currentTime: new Date("2026-08-31T16:00:00.000Z"),
  }), { winnerName: "September Member", monthKey: "2026-09-01" });
});
