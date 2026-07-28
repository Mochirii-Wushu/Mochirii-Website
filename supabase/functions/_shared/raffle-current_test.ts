import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  type CurrentRaffleDependencies,
  handleCurrentRaffleRequest,
} from "../get-current-raffle/index.ts";
import type { MemberAccess } from "./raffle-edge.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const MEMBER_ID = "00000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-08-01T13:30:00.000Z");
const client = {} as SupabaseClient;

function request(
  method: string,
  origin = "https://mochirii.com",
  body?: Record<string, unknown>,
  requestedMethod?: string,
): Request {
  const headers = new Headers({ Origin: origin });
  if (body) headers.set("Content-Type", "application/json");
  if (requestedMethod) {
    headers.set("Access-Control-Request-Method", requestedMethod);
  }
  return new Request("https://functions.example.invalid/get-current-raffle", {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function memberAccess(
  profile: Record<string, unknown>,
): Extract<MemberAccess, { ok: true }> {
  return {
    ok: true,
    adminClient: client,
    user: { id: MEMBER_ID } as User,
    userId: MEMBER_ID,
    profile,
  };
}

function expectProtectedCors(
  response: Response,
  expectedOrigin = "https://mochirii.com",
): void {
  assert(
    response.headers.get("access-control-allow-origin") === expectedOrigin,
    "member response did not use the protected origin",
  );
  assert(
    response.headers.get("access-control-allow-origin") !== "*",
    "member response exposed wildcard CORS",
  );
  assert(
    response.headers.get("vary")?.toLowerCase().includes("origin"),
    "member response did not vary by origin",
  );
}

function expectLeaderboardSecurityHeaders(response: Response): void {
  assert(
    response.headers.get("content-security-policy") ===
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "private leaderboard response lost its content security policy",
  );
  assert(
    response.headers.get("referrer-policy") === "no-referrer" &&
      response.headers.get("x-content-type-options") === "nosniff" &&
      response.headers.get("x-robots-tag") ===
        "noindex, nofollow, noarchive, nosnippet, noimageindex",
    "private leaderboard response lost security or indexing headers",
  );
}

Deno.test("public raffle GET and GET preflight retain wildcard CORS", async () => {
  const dependencies: CurrentRaffleDependencies = {
    createAdminClient: () => client,
    loadCurrent: () => Promise.resolve(null),
    loadResults: () => Promise.resolve(null),
  };
  const response = await handleCurrentRaffleRequest(
    request("GET"),
    dependencies,
  );
  assert(response.status === 200, "public GET failed");
  assert(
    response.headers.get("access-control-allow-origin") === "*",
    "public GET lost wildcard CORS",
  );

  const preflight = await handleCurrentRaffleRequest(
    request("OPTIONS", "https://untrusted.example", undefined, "GET"),
    dependencies,
  );
  assert(
    preflight.headers.get("access-control-allow-origin") === "*",
    "public GET preflight lost wildcard CORS",
  );
});

Deno.test("member-result preflight never returns wildcard CORS", async () => {
  const approved = await handleCurrentRaffleRequest(
    request("OPTIONS", "https://mochirii.com", undefined, "POST"),
  );
  expectProtectedCors(approved);
  assert(
    approved.headers.get("access-control-allow-methods") === "POST, OPTIONS",
    "member preflight allowed an unexpected method",
  );

  const hostile = await handleCurrentRaffleRequest(
    request("OPTIONS", "https://attacker.example", undefined, "POST"),
  );
  expectProtectedCors(hostile);
  assert(
    hostile.headers.get("access-control-allow-origin") !==
      "https://attacker.example",
    "hostile member preflight reflected its origin",
  );
});

Deno.test("unauthenticated and stale member-result responses use protected CORS", async () => {
  const unauthenticated = await handleCurrentRaffleRequest(
    request("POST", "https://mochirii.com", { action: "member_results" }),
    {
      requireMember: () =>
        Promise.resolve({
          ok: false,
          response: Response.json({ ok: false }, { status: 401 }),
        }),
    },
  );
  assert(
    unauthenticated.status === 401,
    "unauthenticated request changed status",
  );
  expectProtectedCors(unauthenticated);

  let namesCalls = 0;
  const stale = await handleCurrentRaffleRequest(
    request("POST", "https://attacker.example", { action: "member_results" }),
    {
      requireMember: () =>
        Promise.resolve(memberAccess({
          member_status: "active",
          has_required_discord_roles: true,
          discord_verified_at: "2026-07-20T00:00:00.000Z",
        })),
      loadMemberNames: () => {
        namesCalls += 1;
        return Promise.resolve({});
      },
      now: () => NOW,
    },
  );
  assert(stale.status === 403, "stale member request changed status");
  expectProtectedCors(stale);
  assert(namesCalls === 0, "stale member reached private result names");
});

Deno.test("verified member names are returned only through protected CORS", async () => {
  const response = await handleCurrentRaffleRequest(
    request("POST", "https://mochirii.com", { action: "member_results" }),
    {
      requireMember: () =>
        Promise.resolve(memberAccess({
          member_status: "active",
          has_required_discord_roles: true,
          discord_verified_at: "2026-07-31T13:30:00.000Z",
        })),
      loadResults: () => Promise.resolve({ id: "cycle-id" }),
      loadMemberNames: () =>
        Promise.resolve({
          "monthly-2026-08:1": "Guild Member",
        }),
      now: () => NOW,
    },
  );
  assert(response.status === 200, "verified member request failed");
  expectProtectedCors(response);
  const payload = await response.json();
  assert(
    payload.data.resultNames["monthly-2026-08:1"] === "Guild Member",
    "verified member name was omitted",
  );
});

Deno.test("website member leaderboard stays private and uses the bounded points contract", async () => {
  const response = await handleCurrentRaffleRequest(
    request("POST", "https://mochirii.com", {
      action: "member_leaderboard",
    }),
    {
      requireMember: () =>
        Promise.resolve(memberAccess({
          member_status: "active",
          has_required_discord_roles: true,
          discord_verified_at: "2026-07-31T13:30:00.000Z",
        })),
      loadLeaderboard: () =>
        Promise.resolve({
          cyclePublicId: "mpd-2026-08",
          cycleStatus: "open",
          closesAt: "2026-08-01T13:15:00.000Z",
          drawAt: "2026-08-01T13:30:00.000Z",
          maximumEntries: 10,
          participantCount: 1,
          entries: [{
            rank: 1,
            displayName: "Sya",
            entryCount: 10,
            isViewer: true,
          }],
        }),
      now: () => NOW,
    },
  );
  assert(response.status === 200, "member leaderboard request failed");
  expectProtectedCors(response);
  assert(
    response.headers.get("cache-control") ===
      "private, no-store, max-age=0",
    "member leaderboard response must use the exact private cache policy",
  );
  assert(
    response.headers.get("vary")?.toLowerCase().includes("authorization"),
    "member leaderboard response must vary by authorization",
  );
  expectLeaderboardSecurityHeaders(response);
  const payload = await response.json();
  assert(payload.data.entries[0].entryCount === 10, "points were omitted");
  assert(
    payload.data.entries[0].isViewer === true,
    "viewer marker was omitted",
  );
});

Deno.test("website leaderboard rejects stale membership before loading private data", async () => {
  let loadCalls = 0;
  const response = await handleCurrentRaffleRequest(
    request("POST", "https://mochirii.com", {
      action: "member_leaderboard",
    }),
    {
      requireMember: () =>
        Promise.resolve(memberAccess({
          member_status: "active",
          has_required_discord_roles: true,
          discord_verified_at: "2026-07-20T00:00:00.000Z",
        })),
      loadLeaderboard: () => {
        loadCalls += 1;
        return Promise.resolve(null);
      },
      now: () => NOW,
    },
  );
  assert(response.status === 403, "stale leaderboard request changed status");
  assert(loadCalls === 0, "stale member reached private leaderboard data");
  expectProtectedCors(response);
  expectLeaderboardSecurityHeaders(response);
});

Deno.test("server-signed Social leaderboard returns the smaller shared contract", async () => {
  const response = await handleCurrentRaffleRequest(
    request("POST", "https://social.mochirii.com", { sub: MEMBER_ID }),
    {
      createAdminClient: () => client,
      verifySocialRequest: () =>
        Promise.resolve({ ok: true, subject: MEMBER_ID }),
      loadLeaderboard: () =>
        Promise.resolve({
          cyclePublicId: "mpd-2026-08",
          cycleStatus: "open",
          closesAt: "2026-08-01T13:15:00.000Z",
          drawAt: "2026-08-01T13:30:00.000Z",
          maximumEntries: 10,
          participantCount: 1,
          entries: [{
            rank: 1,
            displayName: "Sya",
            entryCount: 10,
            isViewer: false,
          }],
        }),
      now: () => NOW,
    },
  );
  assert(response.status === 200, "Social leaderboard request failed");
  assert(
    response.headers.get("cache-control") ===
      "private, no-store, max-age=0",
    "Social leaderboard response must use the exact private cache policy",
  );
  assert(
    response.headers.get("vary")?.toLowerCase().includes("authorization"),
    "Social leaderboard response must vary by authorization",
  );
  expectLeaderboardSecurityHeaders(response);
  const payload = await response.json();
  assert(payload.cycleLabel === "August 2026", "cycle label was not localized");
  assert(payload.entries[0].displayName === "Sya", "display name was omitted");
  assert(
    !Object.prototype.hasOwnProperty.call(payload.entries[0], "isViewer"),
    "Social response exposed Website-only viewer state",
  );
});

Deno.test("verified Social member receives the exact private empty contract when no drawing exists", async () => {
  const response = await handleCurrentRaffleRequest(
    request("POST", "https://social.mochirii.com", { sub: MEMBER_ID }),
    {
      createAdminClient: () => client,
      verifySocialRequest: () =>
        Promise.resolve({ ok: true, subject: MEMBER_ID }),
      loadLeaderboard: () => Promise.resolve(null),
      now: () => NOW,
    },
  );
  assert(response.status === 200, "verified empty state changed status");
  assert(
    response.headers.get("cache-control") ===
      "private, no-store, max-age=0",
    "verified empty state must use the exact private cache policy",
  );
  assert(
    response.headers.get("vary")?.toLowerCase().includes("authorization"),
    "verified empty state must vary by authorization",
  );
  const payload = await response.json();
  assert(
    JSON.stringify(Object.keys(payload).sort()) ===
      JSON.stringify(["asOf", "cycleLabel", "entries"]),
    "verified empty state exposed unexpected fields",
  );
  assert(
    payload.cycleLabel === "No active drawing" &&
      payload.asOf === new Date(NOW).toISOString() &&
      Array.isArray(payload.entries) && payload.entries.length === 0,
    "verified empty state drifted from the Social contract",
  );
});

Deno.test("server-signed Social leaderboard fails closed before data access", async () => {
  let loadCalls = 0;
  const response = await handleCurrentRaffleRequest(
    request("POST", "https://social.mochirii.com", { sub: MEMBER_ID }),
    {
      createAdminClient: () => client,
      verifySocialRequest: () =>
        Promise.resolve({
          ok: false,
          status: 401,
          error: "replayed_request",
        }),
      loadLeaderboard: () => {
        loadCalls += 1;
        return Promise.resolve(null);
      },
    },
  );
  assert(response.status === 401, "replayed request changed status");
  assert(loadCalls === 0, "replayed request reached leaderboard data");
});

Deno.test("server-signed Social verifier failures return an opaque private response", async () => {
  let loadCalls = 0;
  const response = await handleCurrentRaffleRequest(
    request("POST", "https://social.mochirii.com", { sub: MEMBER_ID }),
    {
      createAdminClient: () => client,
      verifySocialRequest: () => Promise.reject(new Error("hidden failure")),
      loadLeaderboard: () => {
        loadCalls += 1;
        return Promise.resolve(null);
      },
    },
  );
  assert(response.status === 503, "verifier failure changed status");
  assert(loadCalls === 0, "verifier failure reached leaderboard data");
  assert(
    response.headers.get("cache-control") ===
        "private, no-store, max-age=0" &&
      response.headers.get("vary")?.toLowerCase().includes("authorization"),
    "verifier failure lost private response headers",
  );
  expectLeaderboardSecurityHeaders(response);
  const payload = await response.json();
  assert(
    JSON.stringify(Object.keys(payload).sort()) ===
      JSON.stringify(["message", "ok"]),
    "verifier failure exposed diagnostic fields",
  );
});

Deno.test("malformed and unsupported member posts use protected CORS", async () => {
  const malformed = await handleCurrentRaffleRequest(
    new Request("https://functions.example.invalid/get-current-raffle", {
      method: "POST",
      headers: { Origin: "https://mochirii.com" },
      body: "{",
    }),
  );
  assert(malformed.status === 400, "malformed member request changed status");
  expectProtectedCors(malformed);
  assert(
    malformed.headers.get("cache-control") ===
        "private, no-store, max-age=0" &&
      malformed.headers.get("vary")?.toLowerCase().includes("authorization"),
    "malformed private POST did not receive private cache headers",
  );

  const unsupported = await handleCurrentRaffleRequest(
    request("POST", "https://mochirii.com", { action: "unknown" }),
  );
  assert(
    unsupported.status === 400,
    "unsupported member request changed status",
  );
  expectProtectedCors(unsupported);
  assert(
    unsupported.headers.get("cache-control") ===
        "private, no-store, max-age=0" &&
      unsupported.headers.get("vary")?.toLowerCase().includes("authorization"),
    "unsupported private POST did not receive private cache headers",
  );
});
