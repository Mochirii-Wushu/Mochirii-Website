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

  const unsupported = await handleCurrentRaffleRequest(
    request("POST", "https://mochirii.com", { action: "unknown" }),
  );
  assert(
    unsupported.status === 400,
    "unsupported member request changed status",
  );
  expectProtectedCors(unsupported);
});
