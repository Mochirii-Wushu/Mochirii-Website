import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkSupabaseEdgeFunctions } from "./smoke-supabase-edge-functions.mjs";

const config = { url: "https://supabase-smoke.example.test", publishableKey: "sb_publishable_synthetic_test_only" };
const origin = "https://mochirii.com";
const protectedNames = new Set([
  "verify-discord-member", "verify-member-access", "review-member-verification", "list-gallery-review-queue",
  "spinner-live-session", "moderate-gallery-submission", "delete-rejected-gallery-submission",
  "list-instagram-publish-queue", "publish-instagram-gallery-submission", "mark-instagram-gallery-submission-shared",
  "check-instagram-api-status", "list-member-profiles", "get-member-profile", "submit-member-profile-media",
  "list-member-profile-media-queue", "moderate-member-profile-media",
]);
const secretNames = new Set([
  "reaper-discord-interactions", "submit-discord-gallery-image", "reaper-discord-member-sync", "reaper-spinner-dispatch",
  "send-vote-reminder", "send-member-spotlight-poll", "publish-member-spotlight-winner", "sync-pixelfed-social-account",
]);
const corsSecrets = new Set(["submit-discord-gallery-image", "send-vote-reminder", "send-member-spotlight-poll", "publish-member-spotlight-winner"]);
const publicNames = new Set(["list-approved-gallery-submissions", "list-visible-profile-cards", "get-current-spotlight-winner"]);
const checkpointId = "00000000-0000-4000-8000-000000000000";

function json(body, status = 401, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function spinnerDenial() {
  return new Response(null, { status: 404, headers: {
    "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive", "Access-Control-Allow-Origin": origin,
  } });
}

function installMock(t, alter = (response) => response) {
  const calls = [];
  let profileAuthChecks = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, config.url, "Unexpected network origin");
    assert.equal(parsed.search, "", "Unexpected query");
    assert.ok(parsed.pathname.startsWith("/functions/v1/"));
    assert.equal(init.headers.apikey, config.publishableKey);
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok([undefined, "Bearer malformed.jwt.token", `Bearer ${config.publishableKey}`].includes(init.headers.Authorization), "Unexpected credential");
    const name = parsed.pathname.slice("/functions/v1/".length);
    const call = { name, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    let response;
    if (name.startsWith("reaper-gateway-operations/")) {
      const suffix = name.slice("reaper-gateway-operations".length);
      const method = suffix === `/receipts/${checkpointId}` ? "GET" : "POST";
      assert.ok(["/heartbeat", `/checkpoints/${checkpointId}`, `/receipts/${checkpointId}`, "/maintenance"].includes(suffix), "Unexpected operations route");
      assert.equal(init.method, method);
      assert.equal(init.body, method === "POST" ? "{}" : undefined);
      assert.deepEqual(Object.keys(init.headers).filter((key) => key.startsWith("x-reaper-")), []);
      response = json({ version: 1, state: "rejected" }, 401, { "Cache-Control": "no-store" });
    } else {
      assert.ok(protectedNames.has(name) || secretNames.has(name) || publicNames.has(name), "Unexpected function route");
      if (init.method === "OPTIONS") {
        assert.ok(protectedNames.has(name) || publicNames.has(name) || corsSecrets.has(name), "Unexpected OPTIONS request");
        response = name === "send-vote-reminder"
          ? json({ ok: false, message: "Method not allowed." }, 405, { "Access-Control-Allow-Origin": origin })
          : new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin } });
      } else if (init.method === "DELETE") {
        assert.ok(secretNames.has(name) || publicNames.has(name), "Unexpected DELETE request");
        response = name === "reaper-discord-member-sync"
          ? json({ ok: false, error: "Not found." }, 404, { "Cache-Control": "no-store" })
          : name === "reaper-spinner-dispatch" ? spinnerDenial() : json({ ok: false }, 405);
      } else if (protectedNames.has(name)) {
        assert.equal(init.method, "POST");
        if (name === "get-member-profile") {
          // The canonical handler validates a slug before checking membership.
          const body = JSON.parse(init.body);
          if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(body.slug || "")) return json({ ok: false, error: "invalid_slug" }, 400);
          profileAuthChecks++;
        }
        response = json({ ok: false }, 401);
      } else if (secretNames.has(name)) {
        assert.equal(init.method, "POST");
        response = name === "reaper-spinner-dispatch" ? spinnerDenial() : json({ ok: false }, 401);
      } else if (name === "list-approved-gallery-submissions") {
        assert.equal(init.method, "GET");
        response = json({ ok: true, data: { count: 1, signedUrlSeconds: 3600, submissions: [{
          id: "synthetic", thumbnail_signed_url: "https://media.example.test/thumb", full_signed_url: "https://media.example.test/full", thumbnail_size_bytes: 1024,
        }] } }, 200);
      } else if (name === "list-visible-profile-cards") {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), { slugs: [] });
        response = json({ ok: true, data: { profiles: [], count: 0, signedUrlSeconds: 600 } }, 200);
      } else {
        assert.equal(name, "get-current-spotlight-winner");
        assert.equal(init.method, "GET");
        response = json({ ok: true, data: { monthKey: "2026-10-01", winnerName: null } }, 200);
      }
    }
    return alter(response, call);
  });
  return { calls, profileAuthChecks: () => profileAuthChecks };
}

function changed(response, { status = response.status, body, headers = {} } = {}) {
  const copy = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) value === null ? copy.delete(name) : copy.set(name, value);
  return new Response(body ?? response.body, { status, headers: copy });
}

async function rejectsMutation(t, select, mutate) {
  let altered = 0;
  installMock(t, async (response, call) => {
    if (!select(call)) return response;
    altered++;
    return mutate(response, call);
  });
  await assert.rejects(checkSupabaseEdgeFunctions(config));
  assert.ok(altered > 0, "Mutation must reach its intended request");
}

test("complete smoke flow uses synthetic auth fixtures and preserves all 117 requests", async (t) => {
  const mock = installMock(t);
  await checkSupabaseEdgeFunctions(config);
  assert.equal(mock.calls.length, 117);
  assert.equal(mock.profileAuthChecks(), 3);
  assert.deepEqual(mock.calls.filter((c) => c.name === "get-member-profile" && c.method === "POST").map((c) => JSON.parse(c.body)), Array(3).fill({ slug: "mochirii-smoke-probe" }));
  assert.equal(mock.calls.filter((c) => c.name.startsWith("reaper-gateway-operations/")).length, 8);
  assert.equal(mock.calls.filter((c) => c.name === "reaper-spinner-dispatch").length, 4);
});

test("existing 403 auth denials and spinner-session 404 remain accepted", async (t) => {
  installMock(t, (response, call) => call.method === "POST" && protectedNames.has(call.name)
    ? changed(response, { status: call.name === "spinner-live-session" ? 404 : 403 }) : response);
  await checkSupabaseEdgeFunctions(config);
});

test("CLI still exits one for missing public configuration without a request", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./smoke-supabase-edge-functions.mjs", import.meta.url))], {
    encoding: "utf8", timeout: 5000, env: { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
});

test("spinner denial rejects every noncanonical status, body, privacy header and CORS on all four probes", async (t) => {
  const mutations = [
    (r) => changed(r, { status: 401 }), (r) => changed(r, { status: 405 }), (r) => changed(r, { status: 200 }),
    (r) => changed(r, { body: " " }), (r) => changed(r, { body: '{"ok":false}' }),
    ...["Cache-Control", "Referrer-Policy", "X-Content-Type-Options", "X-Robots-Tag", "Access-Control-Allow-Origin"].map((name) => (r) => changed(r, { headers: { [name]: null } })),
    (r) => changed(r, { headers: { "Cache-Control": "no-store" } }),
    (r) => changed(r, { headers: { "Access-Control-Allow-Origin": "*" } }),
  ];
  for (let probe = 0; probe < 4; probe++) for (let i = 0; i < mutations.length; i++) await t.test(`probe ${probe}, mutation ${i}`, async (child) => {
    let seen = 0;
    await rejectsMutation(child, (c) => c.name === "reaper-spinner-dispatch" && seen++ === probe, mutations[i]);
  });
});

test("member-sync DELETE accepts only exact private Not found JSON", async (t) => {
  const mutations = [
    (r) => changed(r, { status: 405 }), (r) => changed(r, { status: 401 }), (r) => changed(r, { status: 200 }),
    (r) => changed(r, { body: '{"ok":false,"error":"Not found.","extra":true}' }),
    (r) => changed(r, { body: '{"ok":false,"error":"Unauthorized."}' }),
    (r) => changed(r, { headers: { "Content-Type": "application/jsonp" } }),
    (r) => changed(r, { headers: { "Cache-Control": "public" } }),
    (r) => changed(r, { headers: { "Access-Control-Allow-Origin": origin } }),
  ];
  for (let i = 0; i < mutations.length; i++) await t.test(`mutation ${i}`, (child) => rejectsMutation(child, (c) => c.name === "reaper-discord-member-sync" && c.method === "DELETE", mutations[i]));
});

test("vote OPTIONS accepts only exact method denial JSON and canonical CORS", async (t) => {
  const mutations = [
    (r) => changed(r, { status: 200 }), (r) => changed(r, { status: 401 }), (r) => changed(r, { status: 404 }),
    (r) => changed(r, { body: '{"ok":false,"message":"Method not allowed.","extra":true}' }),
    (r) => changed(r, { headers: { "Content-Type": "text/html" } }),
    (r) => changed(r, { headers: { "Content-Type": "application/jsonp" } }),
    (r) => changed(r, { headers: { "Access-Control-Allow-Origin": null } }),
    (r) => changed(r, { headers: { "Access-Control-Allow-Origin": "*" } }),
  ];
  for (let i = 0; i < mutations.length; i++) await t.test(`mutation ${i}`, (child) => rejectsMutation(child, (c) => c.name === "send-vote-reminder" && c.method === "OPTIONS", mutations[i]));
});

test("ordinary auth and method rejections retain strict statuses", async (t) => {
  for (const [name, method, statuses] of [["get-member-profile", "POST", [400, 404, 200]], ["submit-discord-gallery-image", "POST", [400, 404, 200]], ["send-member-spotlight-poll", "DELETE", [401, 404, 200]]]) {
    for (const status of statuses) await t.test(`${name} ${method} ${status}`, (child) => rejectsMutation(child, (c) => c.name === name && c.method === method, (r) => changed(r, { status })));
  }
});

test("Gateway operations and public DTO assertions remain mandatory", async (t) => {
  const mutations = [
    ["reaper-gateway-operations/heartbeat", "POST", (r) => changed(r, { status: 403 })],
    ["reaper-gateway-operations/heartbeat", "POST", (r) => changed(r, { body: '{"version":1,"state":"rejected","extra":true}' })],
    ["reaper-gateway-operations/heartbeat", "POST", (r) => changed(r, { headers: { "Content-Type": "application/jsonp" } })],
    ["reaper-gateway-operations/heartbeat", "POST", (r) => changed(r, { headers: { "Cache-Control": "public" } })],
    ["reaper-gateway-operations/heartbeat", "POST", (r) => changed(r, { headers: { "Access-Control-Allow-Origin": origin } })],
    ["list-approved-gallery-submissions", "GET", async (r) => { const body = await r.json(); body.data.submissions[0].user_id = "synthetic"; return changed(r, { body: JSON.stringify(body) }); }],
    ["list-approved-gallery-submissions", "GET", async (r) => { const body = await r.json(); body.data.submissions[0].thumbnail_signed_url = body.data.submissions[0].full_signed_url; return changed(r, { body: JSON.stringify(body) }); }],
    ["list-visible-profile-cards", "POST", async (r) => { const body = await r.json(); body.data.profiles.push({}); return changed(r, { body: JSON.stringify(body) }); }],
    ["get-current-spotlight-winner", "GET", async (r) => { const body = await r.json(); body.data.privateField = true; return changed(r, { body: JSON.stringify(body) }); }],
  ];
  for (let i = 0; i < mutations.length; i++) {
    const [name, method, mutate] = mutations[i];
    await t.test(`mutation ${i}`, (child) => rejectsMutation(child, (c) => c.name === name && c.method === method, mutate));
  }
});
