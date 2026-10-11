import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkGatewayStatus, GATEWAY_STATUS_URL } from "./check-reaper-gateway-status.mjs";

function response(body = "ok", options = {}) {
  const value = new Response(body, { status: 200, headers: { "content-type": "text/plain", "cache-control": "no-store" }, ...options });
  Object.defineProperty(value, "url", { value: GATEWAY_STATUS_URL });
  return value;
}

test("monitor makes one credential-free, fixed-origin read with redirects disabled", async () => {
  let calls = 0;
  await checkGatewayStatus(async (url, init) => {
    calls++;
    assert.equal(url, GATEWAY_STATUS_URL);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.deepEqual(Object.keys(init.headers).sort(), ["Accept", "Accept-Encoding", "User-Agent"]);
    assert.equal(init.body, undefined);
    assert.ok(init.signal instanceof AbortSignal);
    return response();
  });
  assert.equal(calls, 1);
});

test("monitor fails closed for unavailable, cached, encoded, redirected or malformed status", async () => {
  const cases = [
    response("unavailable", { status: 503 }), response("not ok"), response("ok\n"),
    response("", { headers: { "content-type": "text/plain", "cache-control": "no-store", "content-length": "0" } }),
    ...[
      { "content-type": "text/html", "cache-control": "no-store" },
      { "content-type": "text/plain", "cache-control": "public, max-age=60" },
      { "content-type": "text/plain", "cache-control": "no-store", "content-encoding": "gzip" },
      { "content-type": "text/plain", "cache-control": "no-store", "content-length": "10000" },
    ].map((headers) => response("ok", { headers })),
  ];
  const foreign = response();
  Object.defineProperty(foreign, "redirected", { value: true });
  cases.push(foreign);
  for (const value of cases) await assert.rejects(checkGatewayStatus(async () => value), /hosted health unavailable/);
});

test("oversized and stalled streams are bounded without printing provider payloads", async () => {
  let cancelled = false;
  const oversized = response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(checkGatewayStatus(async () => oversized), /hosted health unavailable/);
  assert.equal(cancelled, true);
  cancelled = false;
  const stalled = response(new ReadableStream({ cancel() { cancelled = true; } }));
  await assert.rejects(checkGatewayStatus(async () => stalled, 20), /hosted health unavailable/);
  assert.equal(cancelled, true);
  await assert.rejects(checkGatewayStatus(async () => { throw new Error("private-provider-error"); }), (error) => !error.message.includes("private-provider"));
});

test("hosted monitor remains opt-in, public-read-only and bound to protected main", () => {
  const workflow = readFileSync(new URL("../.github/workflows/reaper-gateway-monitor.yml", import.meta.url), "utf8");
  for (const expected of [
    'cron: "2-57/5 * * * *"', "contents: read", "vars.REAPER_GATEWAY_MONITOR_ENABLED == 'true'",
    "github.repository == 'Mochirii-Wushu/Mochirii-Website'", "github.ref == 'refs/heads/main'",
    "runs-on: ubuntu-24.04", "timeout-minutes: 1", "persist-credentials: false",
    "ref: ${{ github.sha }}", "node scripts/check-reaper-gateway-status.mjs",
  ]) assert.ok(workflow.includes(expected), expected);
  assert.doesNotMatch(workflow, /secrets\.|self-hosted|pull_request_target|issues:\s*write|contents:\s*write|curl|continue-on-error/u);
});
