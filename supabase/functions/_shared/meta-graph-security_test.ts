import {
  buildAuthenticatedMetaGraphRequest,
  createTimedMetaAppSecretProof,
  fetchMetaGraphOnce,
  META_GRAPH_API_VERSION,
  META_GRAPH_ORIGIN,
  META_TOKEN_DEBUG_QUERY_TRANSPORT_NOT_APPROVED,
  metaBearerRequestInit,
  metaGraphApiVersionIsPinned,
  metaGraphUrl,
  metaMutatingResponseOutcome,
  metaTimedProofIsFresh,
  metaTokenDebuggerTransportApproved,
  readBoundedMetaGraphJson,
} from "./meta-graph-security.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Meta Graph stays on graph.facebook.com v26.0", () => {
  assert(META_GRAPH_API_VERSION === "v26.0", "version drifted");
  assert(metaGraphApiVersionIsPinned("v26.0"), "v26 rejected");
  assert(!metaGraphApiVersionIsPinned("v25.0"), "v25 accepted");
  assert(!metaGraphApiVersionIsPinned("latest"), "floating version accepted");
  const url = new URL(metaGraphUrl("123/photos", { fields: "id,from" }));
  assert(url.origin === META_GRAPH_ORIGIN, "origin drifted");
  assert(url.pathname === "/v26.0/123/photos", "path was not pinned");
  assert(metaGraphUrl("https://evil.example/x") === "", "origin escaped");
  assert(
    metaGraphUrl("123", { access_token: "secret" }) === "",
    "token entered URL",
  );
  assert(
    metaGraphUrl("debug_token", { input_token: "secret" }) === "",
    "debugger query transport was enabled",
  );
});

Deno.test("timed proof matches the v26 release vector and expires", async () => {
  const proof = await createTimedMetaAppSecretProof(
    "The quick brown fox jumps over the lazy dog",
    "key",
    1_700_000_000,
  );
  assert(proof.appsecretTime === "1700000000", "time changed");
  assert(
    proof.appsecretProof ===
      "8394e4fdf516395d93dc7512893d969c643306da0d7128004ef1ec7d5452cef1",
    "timed HMAC vector changed",
  );
  assert(
    metaTimedProofIsFresh(proof.appsecretTime, 1_700_000_300),
    "fresh rejected",
  );
  assert(
    !metaTimedProofIsFresh(proof.appsecretTime, 1_700_000_301),
    "stale accepted",
  );
});

Deno.test("each request gets a fresh proof and bearer-only token", async () => {
  let now = 1_700_000_000;
  const one = await buildAuthenticatedMetaGraphRequest({
    accessToken: "token-one",
    appSecret: "secret",
    path: "123",
    nowUnixSeconds: () => now,
  });
  now += 1;
  const two = await buildAuthenticatedMetaGraphRequest({
    accessToken: "token-one",
    appSecret: "secret",
    path: "123",
    nowUnixSeconds: () => now,
  });
  assert(!one.url.includes("token-one"), "token leaked into URL");
  assert(
    new Headers(one.init.headers).get("Authorization") === "Bearer token-one",
    "Authorization bearer missing",
  );
  assert(one.init.redirect === "error", "redirects allowed");
  assert(
    new URL(one.url).searchParams.get("appsecret_proof") !==
      new URL(two.url).searchParams.get("appsecret_proof"),
    "proof reused",
  );
});

Deno.test("Meta wrapper performs exactly one attempt", async () => {
  let calls = 0;
  const response = await fetchMetaGraphOnce({
    accessToken: "token",
    appSecret: "secret",
    path: "123",
    nowUnixSeconds: () => 1_700_000_000,
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(new Response("{}", { status: 503 }));
    },
  });
  assert(response.status === 503, "response changed");
  assert(calls === 1, "request retried");
});

Deno.test("bounded request and ambiguous server outcome stay fail closed", () => {
  const callerSignal = new AbortController().signal;
  const init = metaBearerRequestInit(
    "token",
    { method: "POST", signal: callerSignal },
    5_000,
  );
  assert(init.signal instanceof AbortSignal, "timeout omitted");
  assert(
    init.signal !== callerSignal,
    "caller signal bypassed mandatory timeout",
  );
  assert(metaMutatingResponseOutcome(400) === "failed", "400 ambiguous");
  assert(metaMutatingResponseOutcome(429) === "failed", "429 ambiguous");
  assert(
    metaMutatingResponseOutcome(500) === "reconcile_required",
    "500 retryable",
  );
  let threw = false;
  try {
    metaBearerRequestInit("token", {}, 90_001);
  } catch {
    threw = true;
  }
  assert(threw, "unbounded timeout accepted");
});

Deno.test("Meta Graph JSON reads enforce a byte bound before parsing", async () => {
  const valid = await readBoundedMetaGraphJson(
    new Response('{"id":"123"}', {
      headers: { "content-type": "application/json" },
    }),
  );
  assert(valid.id === "123", "bounded JSON was rejected");

  const oversized = await readBoundedMetaGraphJson(
    new Response(`{"padding":"${"x".repeat(70 * 1024)}"}`, {
      headers: { "content-type": "application/json" },
    }),
  );
  assert(Object.keys(oversized).length === 0, "oversized JSON was parsed");
});

Deno.test("token debugger is a stable blocked prerequisite", () => {
  assert(!metaTokenDebuggerTransportApproved(), "debugger enabled");
  assert(
    META_TOKEN_DEBUG_QUERY_TRANSPORT_NOT_APPROVED ===
      "meta_token_debug_query_transport_not_approved",
    "blocker changed",
  );
});
