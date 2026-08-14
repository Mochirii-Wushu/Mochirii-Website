import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { approvedForumsDiscourseConnectRedirect, FORUMS_DISCOURSE_CONNECT_CALLBACK } from "./discourse-connect-callback.ts";
import { handleForumsDiscourseConnect } from "./discourse-connect-handler.ts";

const secret = "a".repeat(64);
const websiteOrigin = "https://mochirii.com";
const nonce = "0123456789abcdef0123456789abcdef";
const member = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "member@example.com",
  displayName: "Moon Pearl",
};

function signedRequestBody() {
  const payload = new URLSearchParams([
    ["nonce", nonce],
    ["return_sso_url", FORUMS_DISCOURSE_CONNECT_CALLBACK],
  ]).toString();
  const sso = Buffer.from(payload).toString("base64");
  const sig = createHmac("sha256", secret).update(sso).digest("hex");
  return { sso, sig };
}

function request(body: unknown = signedRequestBody(), overrides: {
  origin?: string;
  authorization?: string | null;
  contentType?: string;
  url?: string;
} = {}) {
  const headers = new Headers({
    Origin: overrides.origin ?? websiteOrigin,
    "Content-Type": overrides.contentType ?? "application/json",
    "Sec-Fetch-Site": "same-origin",
  });
  if (overrides.authorization !== null) {
    headers.set("Authorization", overrides.authorization ?? "Bearer synthetic.member.token");
  }
  return new Request(overrides.url ?? `${websiteOrigin}/api/forums/discourse-connect`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function dependencies(memberStatus?: 401 | 403 | 503) {
  let calls = 0;
  return {
    value: {
      loadMember: async () => {
        calls += 1;
        return memberStatus
          ? { ok: false as const, status: memberStatus }
          : { ok: true as const, member };
      },
    },
    calls: () => calls,
  };
}

const enabledConfig = { enabled: true, secret, websiteOrigin };

async function payload(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

test("stays disabled unless both the exact flag and secret contract are present", async () => {
  for (const config of [
    { ...enabledConfig, enabled: false },
    { ...enabledConfig, secret: "" },
    { ...enabledConfig, secret: "A".repeat(64) },
    { ...enabledConfig, secret: ` ${secret}` },
    { ...enabledConfig, secret: `${secret}\n` },
  ]) {
    const deps = dependencies();
    const response = await handleForumsDiscourseConnect(request(), config, deps.value);
    assert.equal(response.status, 503);
    assert.equal(deps.calls(), 0);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  }
});

test("the route forwards the runtime secret without normalization", async () => {
  const routeSource = await readFile(
    new URL("../../app/api/forums/discourse-connect/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    routeSource,
    /secret: process\.env\.MOCHIRII_FORUMS_DISCOURSE_CONNECT_SECRET \|\| ""/,
  );
  assert.doesNotMatch(routeSource, /MOCHIRII_FORUMS_DISCOURSE_CONNECT_SECRET[^\n]*\.trim\(/);
});

test("requires the exact Website request origin and API path", async () => {
  const variants = [
    request(undefined, { origin: "https://example.com" }),
    request(undefined, { url: `${websiteOrigin}/api/forums/discourse-connect?next=/admin` }),
    request(undefined, { url: "https://www.mochirii.com/api/forums/discourse-connect" }),
  ];
  for (const variant of variants) {
    const deps = dependencies();
    const response = await handleForumsDiscourseConnect(variant, enabledConfig, deps.value);
    assert.equal(response.status, 400);
    assert.equal(deps.calls(), 0);
  }
});

test("verifies the signature before authentication or payload decoding", async () => {
  const deps = dependencies();
  const response = await handleForumsDiscourseConnect(
    request({ sso: "not base64!", sig: "0".repeat(64) }, { authorization: null }),
    enabledConfig,
    deps.value,
  );
  assert.equal(response.status, 400);
  assert.equal(deps.calls(), 0);
  assert.deepEqual(await payload(response), {
    ok: false,
    code: "invalid_request",
    error: "This Mōchirīī Forums sign-in request is invalid.",
  });
});

test("rejects malformed envelopes and missing bearer sessions", async () => {
  const malformed = [
    request("not-json"),
    request({ ...signedRequestBody(), extra: true }),
    request(signedRequestBody(), { contentType: "text/plain" }),
  ];
  for (const variant of malformed) {
    const response = await handleForumsDiscourseConnect(variant, enabledConfig, dependencies().value);
    assert.equal(response.status, 400);
  }

  const response = await handleForumsDiscourseConnect(
    request(signedRequestBody(), { authorization: null }),
    enabledConfig,
    dependencies().value,
  );
  assert.equal(response.status, 401);
});

test("rejects an oversized request before member lookup", async () => {
  const deps = dependencies();
  const response = await handleForumsDiscourseConnect(
    request(JSON.stringify({ sso: "a".repeat(12 * 1_024), sig: "0".repeat(64) })),
    enabledConfig,
    deps.value,
  );
  assert.equal(response.status, 400);
  assert.equal(deps.calls(), 0);
});

test("fails closed for unauthenticated, inactive, unverified, or unavailable member authority", async () => {
  for (const status of [401, 403, 503] as const) {
    const response = await handleForumsDiscourseConnect(
      request(),
      enabledConfig,
      dependencies(status).value,
    );
    assert.equal(response.status, status);
    const body = JSON.stringify(await payload(response));
    assert.equal(body.includes(member.id), false);
    assert.equal(body.includes(member.email), false);
    assert.equal(body.includes(nonce), false);
  }
});

test("redacts unexpected member-authority failures behind a private unavailable response", async () => {
  const sensitiveFailure = `${member.id}:${member.email}:${nonce}`;
  const response = await handleForumsDiscourseConnect(
    request(),
    enabledConfig,
    {
      loadMember: async () => {
        throw new Error(sensitiveFailure);
      },
    },
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  const serialized = JSON.stringify(await payload(response));
  assert.equal(serialized.includes(member.id), false);
  assert.equal(serialized.includes(member.email), false);
  assert.equal(serialized.includes(nonce), false);
  assert.deepEqual(JSON.parse(serialized), {
    ok: false,
    code: "unavailable",
    error: "Mōchirīī Forums sign-in is unavailable.",
  });
});

test("fails closed when a malformed eligible identity cannot produce a callback", async () => {
  const response = await handleForumsDiscourseConnect(
    request(),
    enabledConfig,
    {
      loadMember: async () => ({
        ok: true as const,
        member: { ...member, id: `invalid-${nonce}` },
      }),
    },
  );

  assert.equal(response.status, 503);
  const serialized = JSON.stringify(await payload(response));
  assert.equal(serialized.includes(nonce), false);
  assert.equal(serialized.includes(member.email), false);
});

test("returns only a signed exact callback for an eligible member", async () => {
  const response = await handleForumsDiscourseConnect(request(), enabledConfig, dependencies().value);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  const body = await payload(response);
  const redirectUrl = approvedForumsDiscourseConnectRedirect(body.redirectUrl);
  assert.equal(typeof redirectUrl, "string");
  assert.equal(new URL(redirectUrl || "").origin, "https://forums.mochirii.com");
  assert.equal(new URL(redirectUrl || "").pathname, "/session/sso_login");
});
