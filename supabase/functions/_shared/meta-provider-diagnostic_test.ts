import {
  metaProviderDiagnosticPayload,
  readInstagramPageLinkageOnce,
} from "./meta-provider-diagnostic.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("provider diagnostic is safe and blocked without token debugger approval", () => {
  const payload = metaProviderDiagnosticPayload({
    provider: "facebook_page",
    configured: true,
    publishEnabled: false,
    identityReachable: true,
    identityMatches: true,
    createContentTaskVerified: true,
    checkedAt: new Date("2026-07-29T20:00:00.000Z"),
  });
  assert(payload.apiVersion === "v26.0", "version drifted");
  assert(payload.tokenDebuggerCalled === false, "debugger called");
  assert(payload.ready === false, "blocked diagnostic became ready");
  assert(
    payload.errorCategory ===
      "meta_token_debug_query_transport_not_approved",
    "stable blocker changed",
  );
  const serialized = JSON.stringify(payload);
  for (
    const forbidden of ["access_token", "appsecret_proof", "pageId", "tasks"]
  ) {
    assert(
      !serialized.includes(forbidden),
      `unsafe field survived: ${forbidden}`,
    );
  }
});

Deno.test("Instagram diagnostic leaves subtype as a manual prerequisite", () => {
  const payload = metaProviderDiagnosticPayload({
    provider: "instagram",
    configured: true,
    publishEnabled: false,
    identityMatches: true,
    facebookPageReachable: true,
    facebookPageIdentityMatches: true,
    instagramBusinessAccountPresent: true,
    instagramBusinessAccountMatches: true,
    pageToInstagramLinkageVerified: true,
    quotaReadable: true,
    quotaExhausted: false,
  });
  assert(
    payload.businessAccountSubtypeVerification === "manual_required",
    "undocumented subtype query was implied",
  );
  assert(payload.quotaReadable === true, "quota evidence lost");
  assert(
    payload.pageToInstagramLinkageVerified === true,
    "Page linkage evidence lost",
  );
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["11111", "22222", "instagram_business_account"]) {
    assert(
      !serialized.includes(forbidden),
      `private linkage data survived: ${forbidden}`,
    );
  }
});

Deno.test("Instagram Page linkage uses one pinned v26 bearer request", async () => {
  let calls = 0;
  const linkage = await readInstagramPageLinkageOnce({
    accessToken: "page-token",
    appSecret: "app-secret",
    runtimePageId: "11111",
    expectedPageId: "11111",
    runtimeInstagramAccountId: "22222",
    expectedInstagramAccountId: "22222",
    nowUnixSeconds: () => 1_700_000_000,
    fetchImpl: (input, init) => {
      calls += 1;
      const url = new URL(String(input));
      assert(url.origin === "https://graph.facebook.com", "origin drifted");
      assert(url.pathname === "/v26.0/11111", "Page path drifted");
      assert(
        url.searchParams.get("fields") === "id,instagram_business_account",
        "linkage field drifted",
      );
      assert(!url.searchParams.has("access_token"), "token entered URL");
      assert(
        new Headers(init?.headers).get("Authorization") ===
          "Bearer page-token",
        "Page bearer token missing",
      );
      assert(url.searchParams.has("appsecret_time"), "proof time missing");
      assert(url.searchParams.has("appsecret_proof"), "proof missing");
      return Promise.resolve(
        new Response(JSON.stringify({
          id: "11111",
          instagram_business_account: { id: "22222" },
        })),
      );
    },
  });
  assert(calls === 1, "Page linkage request retried");
  assert(linkage.requestAttempted, "Page linkage was not attempted");
  assert(linkage.verified, "exact Page linkage was rejected");
});

Deno.test("Instagram Page linkage fails closed before Graph on local pin drift", async () => {
  let calls = 0;
  const linkage = await readInstagramPageLinkageOnce({
    accessToken: "page-token",
    appSecret: "app-secret",
    runtimePageId: "11111",
    expectedPageId: "33333",
    runtimeInstagramAccountId: "22222",
    expectedInstagramAccountId: "22222",
    fetchImpl: () => {
      calls += 1;
      throw new Error("Graph must not run");
    },
  });
  assert(calls === 0, "local pin drift reached Graph");
  assert(!linkage.requestAttempted, "drifted linkage was attempted");
  assert(!linkage.verified, "drifted linkage was verified");
});

Deno.test("Instagram Page linkage rejects a foreign linked account", async () => {
  const linkage = await readInstagramPageLinkageOnce({
    accessToken: "page-token",
    appSecret: "app-secret",
    runtimePageId: "11111",
    expectedPageId: "11111",
    runtimeInstagramAccountId: "22222",
    expectedInstagramAccountId: "22222",
    fetchImpl: () =>
      Promise.resolve(
        new Response(JSON.stringify({
          id: "11111",
          instagram_business_account: { id: "99999" },
        })),
      ),
  });
  assert(linkage.facebookPageIdentityMatches, "Page identity evidence lost");
  assert(linkage.instagramBusinessAccountPresent, "linked account not seen");
  assert(
    !linkage.instagramBusinessAccountMatches,
    "foreign linked account matched",
  );
  assert(!linkage.verified, "foreign linkage was verified");
});
