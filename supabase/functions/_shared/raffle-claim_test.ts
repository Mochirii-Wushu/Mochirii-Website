import {
  parseClaimCommand,
  privateClaimOption,
  privateClaimStatus,
  selectPrivateClaimForAction,
} from "./raffle-claim.ts";

const drawResultId = "12345678-1234-4234-9234-1234567890ab";

Deno.test("claim commands resolve server-side and require exact provider-neutral fields", () => {
  assertEquals(parseClaimCommand({ action: "status" }), { action: "status" });
  assertEquals(
    parseClaimCommand({
      action: "claim",
      reward_choice: "digital_choice",
    }),
    { action: "claim", rewardRoute: "digital" },
  );
  assertEquals(
    parseClaimCommand({ action: "claim", reward_choice: "in_game" }),
    {
      action: "claim",
      rewardRoute: "in_game",
    },
  );
  assertEquals(parseClaimCommand({ action: "decline", reward_choice: null }), {
    action: "decline",
  });
  assertThrows(() => parseClaimCommand({ action: "open_reward" }));
  assertEquals(
    parseClaimCommand({
      action: "claim",
      claim_id: drawResultId,
      reward_choice: "digital_choice",
    }),
    { action: "claim", rewardRoute: "digital", claimId: drawResultId },
  );
  assertThrows(() =>
    parseClaimCommand({
      action: "open_reward",
      claim_id: drawResultId,
    })
  );
  assertThrows(() =>
    parseClaimCommand({
      action: "claim",
      claim_id: "not-a-uuid",
      reward_choice: "digital_choice",
    })
  );
  assertThrows(() =>
    parseClaimCommand({
      action: "claim",
      drawResultId,
      reward_choice: "digital_choice",
    })
  );
  assertThrows(() =>
    parseClaimCommand({ action: "claim", reward_choice: "cash" })
  );
  assertThrows(() =>
    parseClaimCommand({ action: "decline", reward_choice: "digital_choice" })
  );
});

Deno.test("private claim status and selector expose only the authenticated opaque claim ID", () => {
  const row = {
    id: drawResultId,
    cycle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "selected",
    claim_opened_at: "2026-07-19T00:00:00Z",
    claim_deadline: "2026-07-26T00:00:00Z",
    claimed_at: null,
    reward_route: null,
    fulfillment_status: "not_requested",
    created_at: "2026-07-19T00:00:00Z",
    in_game_reward_available: false,
    gross_prize_cents: 2_500,
    all_in_cost_cap_cents: 5_000,
  };
  const status = privateClaimStatus(row, Date.parse("2026-07-20T00:00:00Z"));
  assertEquals(status.claimState, "claimable");
  assertEquals(status.fulfillmentState, "not_started");
  assertEquals(status.claimDeadline, "2026-07-26T00:00:00Z");
  assertEquals(status.inGameRewardAvailable, false);
  assertEquals(status.grossPrizeCents, 2_500);
  assertEquals(status.allInCostCapCents, 5_000);
  assert(
    !JSON.stringify(status).includes(drawResultId),
    "default claim status must not expose an identifier",
  );
  const option = privateClaimOption(row, Date.parse("2026-07-20T00:00:00Z"));
  assertEquals(option.claimId, drawResultId);
  assertEquals(option.grossPrizeCents, 2_500);
  assertEquals(option.allInCostCapCents, 5_000);
  const serialized = JSON.stringify(option);
  assert(
    !serialized.includes("provider"),
    "provider fields must not be returned",
  );
  assert(!serialized.includes("member"), "member fields must not be returned");
});

Deno.test("a claimed reward remains claimed after the original response deadline", () => {
  const status = privateClaimStatus({
    id: drawResultId,
    cycle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "claimed",
    claim_opened_at: "2026-07-19T00:00:00Z",
    claim_deadline: "2026-07-26T00:00:00Z",
    claimed_at: "2026-07-20T00:00:00Z",
    reward_route: "digital",
    fulfillment_status: "pending",
    created_at: "2026-07-19T00:00:00Z",
  }, Date.parse("2026-07-27T00:00:00Z"));
  assertEquals(status.claimState, "claimed");
});

Deno.test("overlapping private claims are deterministic and explicitly selectable", () => {
  const olderReady = {
    id: drawResultId,
    cycle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "fulfilled",
    claim_opened_at: "2026-07-01T00:00:00Z",
    claim_deadline: "2026-07-08T00:00:00Z",
    claimed_at: "2026-07-02T00:00:00Z",
    reward_route: "digital",
    fulfillment_status: "delivered",
    created_at: "2026-07-01T00:00:00Z",
    cycle_expires_at: "2026-07-31T00:00:00Z",
  };
  const newerClaimable = {
    id: "87654321-4321-4321-8321-ba0987654321",
    cycle_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "contacted",
    claim_opened_at: "2026-07-28T00:00:00Z",
    claim_deadline: "2026-08-04T00:00:00Z",
    claimed_at: null,
    reward_route: null,
    fulfillment_status: "not_requested",
    created_at: "2026-07-28T00:00:00Z",
    cycle_expires_at: "2026-08-27T00:00:00Z",
  };
  const now = Date.parse("2026-07-29T00:00:00Z");
  const rows = [newerClaimable, olderReady];
  assertEquals(
    selectPrivateClaimForAction(rows, "status", undefined, now).row?.id,
    newerClaimable.id,
  );
  assertEquals(
    selectPrivateClaimForAction(rows, "claim", olderReady.id, now).row?.id,
    olderReady.id,
  );
  assertEquals(
    selectPrivateClaimForAction(rows, "claim", newerClaimable.id, now).row?.id,
    newerClaimable.id,
  );
  const claimedAfterDeadline = {
    ...newerClaimable,
    status: "claimed",
    claimed_at: "2026-07-29T00:00:00Z",
    reward_route: "digital",
    fulfillment_status: "pending",
    claim_deadline: "2026-07-29T00:00:00Z",
  };
  assertEquals(
    selectPrivateClaimForAction(
      [claimedAfterDeadline],
      "claim",
      claimedAfterDeadline.id,
      Date.parse("2026-07-30T00:00:00Z"),
    ).row?.id,
    claimedAfterDeadline.id,
  );
});

Deno.test("fulfilled electronic reward stays fail closed in the core foundation", () => {
  const status = privateClaimStatus({
    id: drawResultId,
    cycle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "fulfilled",
    claim_opened_at: "2026-07-01T00:00:00Z",
    claim_deadline: "2026-07-08T00:00:00Z",
    claimed_at: "2026-07-02T00:00:00Z",
    reward_route: "digital",
    fulfillment_status: "delivered",
    created_at: "2026-07-01T00:00:00Z",
    cycle_expires_at: "2026-07-31T00:00:00Z",
  });
  assertEquals(status.openRewardAvailable, false);
  const serialized = JSON.stringify(status);
  assert(!serialized.includes("http"), "core claim status exposed a URL");
  assert(
    !serialized.includes("provider"),
    "core claim status exposed provider data",
  );
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertThrows(callback: () => unknown): void {
  let threw = false;
  try {
    callback();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Expected callback to throw.");
}
