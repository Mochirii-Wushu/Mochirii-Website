import type { SupabaseClient, User } from "@supabase/supabase-js";
import { handleRaffleClaimRequest } from "../manage-raffle-claim/index.ts";
import type { MemberAccess } from "./raffle-edge.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function statusRequest() {
  return new Request("https://functions.example.invalid/manage-raffle-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status" }),
  });
}

function claimRequest() {
  return new Request("https://functions.example.invalid/manage-raffle-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "claim",
      claim_id: "00000000-0000-4000-8000-000000000002",
      reward_choice: "digital_choice",
    }),
  });
}

function emptyClaimClient(): SupabaseClient {
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    not() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return Promise.resolve({ data: [], error: null });
    },
  };
  return { from: () => query } as unknown as SupabaseClient;
}

function memberAccess(
  profile: Extract<MemberAccess, { ok: true }>["profile"],
): Extract<MemberAccess, { ok: true }> {
  return {
    ok: true,
    adminClient: emptyClaimClient(),
    user: { id: "00000000-0000-4000-8000-000000000001" } as User,
    userId: "00000000-0000-4000-8000-000000000001",
    profile,
  };
}

const NOW = Date.parse("2026-07-27T05:00:00.000Z");

for (
  const [label, profile] of [
    ["inactive", {
      member_status: "inactive",
      has_required_discord_roles: true,
      discord_verified_at: new Date(NOW).toISOString(),
    }],
    ["missing-role", {
      member_status: "active",
      has_required_discord_roles: false,
      discord_verified_at: new Date(NOW).toISOString(),
    }],
    ["stale", {
      member_status: "active",
      has_required_discord_roles: true,
      discord_verified_at: new Date(NOW - 8 * 24 * 60 * 60 * 1000)
        .toISOString(),
    }],
  ] as const
) {
  Deno.test(`claim Edge boundary rejects ${label} guild standing before reading claim data`, async () => {
    let dataReads = 0;
    const access = memberAccess(profile);
    access.adminClient = {
      from() {
        dataReads += 1;
        throw new Error("claim data must not be read");
      },
    } as unknown as SupabaseClient;
    const response = await handleRaffleClaimRequest(statusRequest(), {
      requireMember: () => Promise.resolve(access),
      now: () => NOW,
    });
    assert(
      response.status === 403,
      `${label} member reached claim status data`,
    );
    assert(dataReads === 0, `${label} member triggered a claim data read`);
    const payload = await response.json();
    assert(
      payload.error === "member_access_required",
      `${label} denial was not opaque`,
    );
  });
}

Deno.test("claim status reports the trusted operational gate and stays closed by default", async () => {
  const response = await handleRaffleClaimRequest(statusRequest(), {
    requireMember: () =>
      Promise.resolve(memberAccess({
        member_status: "active",
        has_required_discord_roles: true,
        discord_verified_at: new Date(NOW).toISOString(),
      })),
    now: () => NOW,
    gates: () => ({
      submissions: false,
      bonusSubmissions: false,
      claims: false,
      scheduling: false,
      rewardOrders: false,
      relay: false,
    }),
  });
  assert(response.status === 200, "active member could not read claim status");
  const payload = await response.json();
  assert(
    payload.data.claimsEnabled === false,
    "closed claim gate was not returned",
  );
  assert(
    payload.data.claimState === "not_available",
    "missing claim did not fail closed",
  );
});

Deno.test("closed claim gate rejects a valid mutation before reading claim data", async () => {
  let dataReads = 0;
  const access = memberAccess({
    member_status: "active",
    has_required_discord_roles: true,
    discord_verified_at: new Date(NOW).toISOString(),
  });
  access.adminClient = {
    from() {
      dataReads += 1;
      throw new Error("closed mutation must not read claim data");
    },
  } as unknown as SupabaseClient;
  const response = await handleRaffleClaimRequest(claimRequest(), {
    requireMember: () => Promise.resolve(access),
    gates: () => ({
      submissions: false,
      bonusSubmissions: false,
      claims: false,
      scheduling: false,
      rewardOrders: false,
      relay: false,
    }),
    now: () => NOW,
  });
  assert(response.status === 409, "closed claim mutation was not rejected");
  assert(dataReads === 0, "closed claim mutation read claim data");
  const payload = await response.json();
  assert(payload.error === "claims_closed", "closed claim denial drifted");
});
