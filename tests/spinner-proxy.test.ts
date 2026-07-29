import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  encodeSpinnerSessionCookie,
  // @ts-expect-error Node's type-stripping runner needs the explicit source extension.
} from "../apps/web/lib/spinner/session-policy.ts";

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(expiresAtSeconds: number) {
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    sub: "00000000-0000-4000-8000-000000000001",
    exp: expiresAtSeconds,
  })}.signature`;
}

function authorityResponse(status = 200, body: unknown = {
  ok: true,
  hasAccess: true,
  data: { hasAccess: true },
}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("the exact page proxy rejects every failed preflight before App Router rendering", async () => {
  Object.assign(globalThis, { AsyncLocalStorage });
  const nextConfigSource = readFileSync(
    new URL("../apps/web/next.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(nextConfigSource, /skipTrailingSlashRedirect:\s*true/u);
  const [
    { NextRequest },
    { unstable_doesMiddlewareMatch: doesProxyMatch },
    { config, proxy },
  ] = await Promise.all([
    import("../apps/web/node_modules/next/server.js"),
    import("../apps/web/node_modules/next/experimental/testing/server.js"),
    // @ts-expect-error Node's type-stripping runner needs the explicit source extension.
    import("../apps/web/proxy.ts"),
  ]);
  assert.deepEqual(config, { matcher: ["/spinner", "/leader-dashboard", "/oauth/consent"] });
  const nextConfig = { skipTrailingSlashRedirect: true };
  assert.equal(doesProxyMatch({ config, nextConfig, url: "/spinner" }), true);
  assert.equal(doesProxyMatch({ config, nextConfig, url: "/spinner/" }), true);
  assert.equal(doesProxyMatch({ config, nextConfig, url: "/leader-dashboard" }), true);
  assert.equal(doesProxyMatch({ config, nextConfig, url: "/oauth/consent" }), true);
  for (const path of ["/spinner/session", "/spinner/live", "/spinner/media/render", "/spinnerish"]) {
    assert.equal(doesProxyMatch({ config, nextConfig, url: path }), false);
  }

  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-key";

  const request = (
    path: string,
    cookie = "",
    method = "GET",
    requestHeaders: Record<string, string> = {},
  ) => new NextRequest(
    `https://mochirii.com${path}`,
    {
      method,
      headers: {
        ...requestHeaders,
        ...(cookie ? { Cookie: `mochirii_spinner_access_v1=${encodeURIComponent(cookie)}` } : {}),
      },
    },
  );
  const assertOpaqueDenied = async (response: Response) => {
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
    assert.match(response.headers.get("cache-control") || "", /\bprivate\b/iu);
    assert.match(response.headers.get("cache-control") || "", /\bno-store\b/iu);
    assert.match(response.headers.get("vary") || "", /\bCookie\b/iu);
    assert.match(response.headers.get("x-robots-tag") || "", /\bnoindex\b/iu);
    assert.equal(response.headers.get("link"), null);
    const setCookie = response.headers.get("set-cookie") || "";
    assert.match(setCookie, /mochirii_spinner_access_v1=/iu);
    assert.match(setCookie, /Path=\/spinner(?:;|$)/iu);
    assert.match(setCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu);
    assert.match(setCookie, /Max-Age=0(?:;|$)/iu);
    assert.match(setCookie, /Secure/iu);
    assert.match(setCookie, /HttpOnly/iu);
    assert.match(setCookie, /SameSite=strict/iu);
  };

  try {
    let calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return authorityResponse(200, {
        ok: true,
        data: { galleryEligible: true, memberStatus: "active" },
      });
    };

    for (const candidate of [
      request("/spinner"),
      request("/spinner", "", "HEAD"),
      request("/spinner/"),
      request("/spinner/", "", "HEAD"),
      request("/spinner?boundary=1"),
      request("/spinner?_rsc=boundary", "", "GET", {
        Accept: "text/x-component",
        RSC: "1",
      }),
    ]) {
      await assertOpaqueDenied(await proxy(candidate));
    }
    await assertOpaqueDenied(await proxy(request("/spinner", "not-a-session")));
    await assertOpaqueDenied(await proxy(request(
      "/spinner",
      encodeSpinnerSessionCookie(jwt(Math.floor(Date.now() / 1000) - 1), "viewer") || "",
    )));
    await assertOpaqueDenied(await proxy(request(
      "/spinner",
      encodeSpinnerSessionCookie(jwt(Math.floor(Date.now() / 1000) + 3_600), "viewer") || "",
      "POST",
    )));
    assert.deepEqual(calls, []);

    const viewerCookie = encodeSpinnerSessionCookie(
      jwt(Math.floor(Date.now() / 1000) + 3_600),
      "viewer",
    );
    assert.ok(viewerCookie);
    const viewerResponse = await proxy(request("/spinner", viewerCookie));
    assert.equal(viewerResponse.status, 200);
    assert.equal(viewerResponse.headers.get("x-middleware-next"), "1");
    assert.equal(viewerResponse.headers.get("set-cookie"), null);
    assert.deepEqual(calls, ["https://project.supabase.co/functions/v1/verify-member-access"]);

    calls = [];
    const controllerCookie = encodeSpinnerSessionCookie(
      jwt(Math.floor(Date.now() / 1000) + 3_600),
      "controller",
    );
    assert.ok(controllerCookie);
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return authorityResponse();
    };
    const controllerResponse = await proxy(request("/spinner", controllerCookie));
    assert.equal(controllerResponse.headers.get("x-middleware-next"), "1");
    assert.deepEqual(calls, ["https://project.supabase.co/functions/v1/list-gallery-review-queue"]);

    calls = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return authorityResponse(403, { ok: false });
    };
    await assertOpaqueDenied(await proxy(request("/spinner", controllerCookie)));
    assert.equal(calls.length, 1);

    globalThis.fetch = async () => {
      throw new Error("upstream unavailable");
    };
    await assertOpaqueDenied(await proxy(request("/spinner", viewerCookie)));

    calls = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return authorityResponse();
    };
    for (const path of ["/spinner/session", "/spinner/live", "/spinner/media/render"]) {
      const response = await proxy(request(path));
      assert.equal(response.headers.get("x-middleware-next"), "1");
    }
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  }
});
