import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  completeFrozenDraw,
  type JsonRecord,
  privacySafePublicDrawEvidence,
  publicCycleDto,
  raffleMemberProfileIsVerified,
  readJson,
  requireRaffleMember,
  requireRaffleModerator,
} from "./raffle-edge.ts";
import { requireAuthenticatedRewardMember } from "./reward-edge.ts";
import { verifyAuthenticatedUser } from "./verified-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected promise to reject");
}

Deno.test("raffle JSON reader rejects oversized streams before reading the remainder", async () => {
  let pullCount = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      if (pullCount === 1) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
      } else if (pullCount === 2) {
        controller.enqueue(new TextEncoder().encode('"12345"}'));
      } else {
        controller.enqueue(new Uint8Array(1_024));
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://example.invalid/raffle", {
    method: "POST",
    body,
  });

  assert(
    await rejectionMessage(readJson(request, 8)) === "request_too_large",
    "oversized streamed body did not receive request_too_large",
  );
  assert(cancelled, "oversized streamed body was not cancelled");
  assert(pullCount === 2, "reader consumed data after crossing the byte cap");
});

Deno.test("raffle JSON reader cancels streams that exceed its finite read-operation cap", async () => {
  let pullCount = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      controller.enqueue(new Uint8Array());
    },
    cancel() {
      cancelled = true;
    },
  });

  assert(
    await rejectionMessage(readJson(
      new Request("https://example.invalid/raffle", {
        method: "POST",
        body,
      }),
      8,
    )) === "request_too_large",
    "zero-length stream did not receive request_too_large",
  );
  assert(cancelled, "zero-length stream was not cancelled");
  assert(pullCount <= 9, "zero-length stream exceeded its finite read cap");
});

Deno.test("raffle JSON reader accepts exact JSON fragmented into one-byte chunks", async () => {
  const encoded = new TextEncoder().encode('{"action":"status"}');
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= encoded.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(encoded.subarray(offset, offset + 1));
      offset += 1;
    },
  });

  const value = await readJson(
    new Request("https://example.invalid/raffle", {
      method: "POST",
      body,
    }),
    encoded.byteLength,
  );
  assert(value.action === "status", "one-byte JSON fragments were rejected");
});

Deno.test("raffle JSON reader rejects invalid or oversized declared lengths before body reads", async () => {
  for (
    const [declaredLength, expected] of [
      ["not-a-number", "invalid_json"],
      ["9007199254740992", "invalid_json"],
      ["17", "request_too_large"],
    ] as const
  ) {
    const request = new Request("https://example.invalid/raffle", {
      method: "POST",
      headers: { "content-length": declaredLength },
      body: "{}",
    });
    assert(
      await rejectionMessage(readJson(request, 16)) === expected,
      `declared length ${declaredLength} did not fail closed`,
    );
  }
});

Deno.test("raffle JSON reader normalizes locked-body and allocation failures", async () => {
  const lockedRequest = new Request("https://example.invalid/raffle", {
    method: "POST",
    body: "{}",
  });
  const lock = lockedRequest.body!.getReader();
  try {
    assert(
      await rejectionMessage(readJson(lockedRequest, 2)) === "invalid_json",
      "locked request body leaked an unnormalized stream error",
    );
  } finally {
    await lock.cancel();
    lock.releaseLock();
  }

  assert(
    await rejectionMessage(readJson(
      new Request("https://example.invalid/raffle", {
        method: "POST",
        body: "{}",
      }),
      Number.MAX_SAFE_INTEGER,
    )) === "invalid_json",
    "bounded-buffer allocation failure was not normalized",
  );
});

Deno.test("raffle JSON reader accepts exact bounded objects and rejects malformed UTF-8", async () => {
  const encoded = new TextEncoder().encode('{"action":"status"}');
  const value = await readJson(
    new Request("https://example.invalid/raffle", {
      method: "POST",
      headers: { "content-length": String(encoded.byteLength) },
      body: encoded,
    }),
    encoded.byteLength,
  );
  assert(value.action === "status", "exact bounded JSON object was rejected");

  const malformed = new Uint8Array([
    0x7b,
    0x22,
    0x61,
    0x22,
    0x3a,
    0xc3,
    0x28,
    0x7d,
  ]);
  assert(
    await rejectionMessage(readJson(
      new Request("https://example.invalid/raffle", {
        method: "POST",
        body: malformed,
      }),
      malformed.byteLength,
    )) === "invalid_json",
    "malformed UTF-8 was accepted as JSON",
  );
});

Deno.test("public draw evidence exposes commitments without reversible identity material", async () => {
  const evidence = await privacySafePublicDrawEvidence(
    {
      status: "drawn",
      drawn_at: "2026-08-08T13:30:00.000Z",
      algorithm_version: "mochirii-weighted-without-replacement-v1",
      ledger_hash: "aa".repeat(32),
      ledger_salt: "private-salt-must-not-escape",
      seed_hex: "bb".repeat(32),
    },
    [
      {
        result_kind: "paid_winner",
        selection_order: 1,
        entry_ordinal: 8,
        pseudonymous_member_id: "11".repeat(32),
      },
      {
        result_kind: "honor",
        selection_order: 2,
        entry_ordinal: 14,
        pseudonymous_member_id: "22".repeat(32),
      },
      {
        result_kind: "honor",
        selection_order: 3,
        entry_ordinal: 20,
        pseudonymous_member_id: "33".repeat(32),
      },
    ],
  );
  assert(evidence !== null, "valid privacy-safe evidence was rejected");
  assert(
    JSON.stringify(Object.keys(evidence).sort()) === JSON.stringify([
      "drawingAt",
      "ledgerCommitment",
      "methodVersion",
      "resultCommitment",
    ]),
    "public draw evidence returned an unexpected field set",
  );
  const serialized = JSON.stringify(evidence);
  for (
    const secret of [
      "private-salt",
      "seed",
      "pseudonymous",
      "entryOrdinal",
      "11".repeat(32),
    ]
  ) {
    assert(
      !serialized.includes(secret),
      `public draw evidence leaked ${secret}`,
    );
  }
  assert(
    /^[0-9a-f]{64}$/.test(String(evidence.resultCommitment)),
    "result commitment was not a SHA-256 digest",
  );
});

Deno.test("public draw evidence fails closed on incomplete or malformed commitments", async () => {
  const invalid = await privacySafePublicDrawEvidence(
    {
      status: "drawn",
      drawn_at: "2026-08-08T13:30:00.000Z",
      algorithm_version: "mochirii-weighted-without-replacement-v1",
      ledger_hash: "not-a-commitment",
    },
    [],
  );
  assert(invalid === null, "incomplete public evidence did not fail closed");
});

function frozenDraw(): JsonRecord {
  return {
    drawId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    cycleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    drawStatus: "frozen",
    ledgerSalt: "11".repeat(32),
    entrantCount: 4,
    totalEntryCount: 26,
    ledger: [
      {
        memberId: "00000000-0000-4000-8000-000000000001",
        entryCount: 5,
      },
      {
        memberId: "00000000-0000-4000-8000-000000000002",
        entryCount: 6,
      },
      {
        memberId: "00000000-0000-4000-8000-000000000003",
        entryCount: 7,
      },
      {
        memberId: "00000000-0000-4000-8000-000000000004",
        entryCount: 8,
      },
    ],
  };
}

const MEMBER_ID = "00000000-0000-4000-8000-000000000001";
const VERIFIED_AT = "2026-07-31T13:30:00.000Z";

function authenticatedUser(): User {
  return {
    id: MEMBER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.invalid",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  } as User;
}

function verifiedAuth(options: {
  claims?: Record<string, unknown>;
  claimsError?: Error | null;
  user?: User | null;
  userError?: Error | null;
  calls?: string[];
} = {}): SupabaseClient["auth"] {
  const calls = options.calls || [];
  return {
    getClaims: () => {
      calls.push("getClaims");
      return Promise.resolve({
        data: {
          claims: options.claims || {
            sub: MEMBER_ID,
            aud: "authenticated",
            role: "authenticated",
            is_anonymous: false,
          },
        },
        error: options.claimsError || null,
      });
    },
    getUser: () => {
      calls.push("getUser");
      return Promise.resolve({
        data: {
          user: options.user === undefined ? authenticatedUser() : options.user,
        },
        error: options.userError || null,
      });
    },
  } as unknown as SupabaseClient["auth"];
}

function memberAdminClient(
  auth: SupabaseClient["auth"] = verifiedAuth(),
): SupabaseClient {
  const profile = {
    id: MEMBER_ID,
    member_status: "active",
    has_required_discord_roles: true,
    discord_verified_at: VERIFIED_AT,
    discord_user_id: "123456789012345678",
    discord_roles: ["1078630751165222984"],
  };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: profile, error: null }),
  };
  return {
    auth,
    from: () => query,
  } as unknown as SupabaseClient;
}

Deno.test("member result identity requires current verified guild standing", () => {
  const now = Date.parse("2026-08-01T13:30:00.000Z");
  const verified = {
    member_status: "active",
    has_required_discord_roles: true,
    discord_verified_at: "2026-07-31T13:30:00.000Z",
  };
  assert(
    raffleMemberProfileIsVerified(verified, now),
    "fresh verified member was rejected",
  );
  assert(
    !raffleMemberProfileIsVerified(
      { ...verified, member_status: "suspended" },
      now,
    ),
    "suspended member received result identity access",
  );
  assert(
    !raffleMemberProfileIsVerified({
      ...verified,
      discord_verified_at: "2026-07-25T13:29:59.999Z",
    }, now),
    "stale guild verification received result identity access",
  );
  assert(
    !raffleMemberProfileIsVerified({
      ...verified,
      discord_verified_at: "2026-08-01T13:35:00.001Z",
    }, now),
    "future-dated guild verification received result identity access",
  );
});

Deno.test("verified auth validates claims before the current Auth user", async () => {
  const calls: string[] = [];
  const identity = await verifyAuthenticatedUser(
    verifiedAuth({ calls }),
    "header.payload.signature",
  );
  assert(identity?.userId === MEMBER_ID, "verified identity was rejected");
  assert(
    JSON.stringify(calls) === JSON.stringify(["getClaims", "getUser"]),
    "Auth verification did not validate claims before the user lookup",
  );
});

Deno.test("verified auth rejects unsafe claims before reading the user or user metadata", async () => {
  const unsafeClaims = [
    { sub: "not-a-uuid", aud: "authenticated", role: "authenticated" },
    { sub: MEMBER_ID, aud: "anon", role: "authenticated" },
    { sub: MEMBER_ID, aud: "authenticated", role: "anon" },
    {
      sub: MEMBER_ID,
      aud: "authenticated",
      role: "authenticated",
      is_anonymous: true,
    },
  ];
  for (const claims of unsafeClaims) {
    const calls: string[] = [];
    const identity = await verifyAuthenticatedUser(
      verifiedAuth({ claims, calls }),
      "header.payload.signature",
    );
    assert(identity === null, "unsafe claims established an identity");
    assert(
      JSON.stringify(calls) === JSON.stringify(["getClaims"]),
      "unsafe claims reached the Auth user lookup",
    );
  }
  const expiredCalls: string[] = [];
  const expired = await verifyAuthenticatedUser(
    verifiedAuth({ claimsError: new Error("expired"), calls: expiredCalls }),
    "header.payload.signature",
  );
  assert(expired === null, "expired claims established an identity");
  assert(
    JSON.stringify(expiredCalls) === JSON.stringify(["getClaims"]),
    "expired claims reached the Auth user lookup",
  );

  const user = authenticatedUser() as User & { user_metadata: unknown };
  Object.defineProperty(user, "user_metadata", {
    get: () => {
      throw new Error("user metadata must not be authorization authority");
    },
  });
  const identity = await verifyAuthenticatedUser(
    verifiedAuth({ user }),
    "header.payload.signature",
  );
  assert(
    identity?.userId === MEMBER_ID,
    "user metadata was read for authority",
  );
});

Deno.test("verified auth rejects revoked, anonymous, or mismatched current users", async () => {
  const mismatched = {
    ...authenticatedUser(),
    id: crypto.randomUUID(),
  } as User;
  const anonymous = { ...authenticatedUser(), is_anonymous: true } as User;
  for (
    const options of [
      { user: mismatched },
      { user: anonymous },
      { user: null },
      { userError: new Error("revoked") },
    ]
  ) {
    const identity = await verifyAuthenticatedUser(
      verifiedAuth(options),
      "header.payload.signature",
    );
    assert(identity === null, "invalid current user established an identity");
  }
});

Deno.test("raffle and reward member boundaries share verified claim-first identity", async () => {
  const raffleCalls: string[] = [];
  const raffle = await requireRaffleMember(
    new Request("https://example.invalid", {
      headers: { Authorization: "Bearer header.payload.signature" },
    }),
    {
      createAdminClient: () =>
        memberAdminClient(verifiedAuth({ calls: raffleCalls })),
    },
  );
  assert(
    raffle.ok && raffle.userId === MEMBER_ID,
    "raffle member was rejected",
  );
  assert(
    JSON.stringify(raffleCalls) === JSON.stringify(["getClaims", "getUser"]),
    "raffle member boundary bypassed verified claims",
  );

  const rewardCalls: string[] = [];
  const reward = await requireAuthenticatedRewardMember(
    new Request("https://example.invalid", {
      headers: { Authorization: "Bearer header.payload.signature" },
    }),
    {
      createAdminClient: () =>
        memberAdminClient(verifiedAuth({ calls: rewardCalls })),
    },
  );
  assert(
    reward.ok && reward.access.memberId === MEMBER_ID,
    "reward member was rejected",
  );
  assert(
    JSON.stringify(rewardCalls) === JSON.stringify(["getClaims", "getUser"]),
    "reward member boundary bypassed verified claims",
  );
});

Deno.test("moderator access checks local standing before a live Discord role", async () => {
  const now = Date.parse("2026-08-01T13:30:00.000Z");
  const client = memberAdminClient();
  const baseMember = {
    ok: true as const,
    adminClient: client,
    user: authenticatedUser(),
    userId: MEMBER_ID,
    profile: {
      member_status: "active",
      has_required_discord_roles: true,
      discord_verified_at: VERIFIED_AT,
      discord_user_id: "123456789012345678",
    },
  };
  const configuration = {
    guildId: "1078630751077142608",
    botToken: "test-only-token",
    moderatorRoleIds: ["1078630751165222984"],
  };
  let fetchCalls = 0;
  const fetcher = () => {
    fetchCalls += 1;
    return Promise.resolve(Response.json({
      pending: false,
      roles: ["1078630751165222984"],
    }));
  };

  const approved = await requireRaffleModerator(
    new Request("https://example.invalid"),
    {
      requireMember: () => Promise.resolve(baseMember),
      fetcher,
      configuration,
      now: () => now,
    },
  );
  assert(approved.ok, "current moderator role was rejected");
  assert(fetchCalls === 1, "current Discord standing was not checked once");

  const stale = await requireRaffleModerator(
    new Request("https://example.invalid"),
    {
      requireMember: () =>
        Promise.resolve({
          ...baseMember,
          profile: {
            ...baseMember.profile,
            discord_verified_at: "2026-07-20T00:00:00.000Z",
          },
        }),
      fetcher,
      configuration,
      now: () => now,
    },
  );
  assert(!stale.ok && stale.response.status === 403, "stale profile passed");
  assert(fetchCalls === 1, "stale profile triggered a Discord request");

  const suspended = await requireRaffleModerator(
    new Request("https://example.invalid"),
    {
      requireMember: () =>
        Promise.resolve({
          ...baseMember,
          profile: { ...baseMember.profile, member_status: "suspended" },
        }),
      fetcher,
      configuration,
      now: () => now,
    },
  );
  assert(
    !suspended.ok && suspended.response.status === 403,
    "suspended profile passed",
  );
  assert(fetchCalls === 1, "suspended profile triggered a Discord request");

  const missingRole = await requireRaffleModerator(
    new Request("https://example.invalid"),
    {
      requireMember: () => Promise.resolve(baseMember),
      fetcher: () =>
        Promise.resolve(Response.json({ pending: false, roles: [] })),
      configuration,
      now: () => now,
    },
  );
  assert(
    !missingRole.ok && missingRole.response.status === 403,
    "missing live moderator role passed",
  );
});

Deno.test("public cycle conforms to the provider-neutral 1 plus 9 contract", () => {
  const cycle = {
    public_cycle_id: "monthly-2026-08",
    status: "open",
    opens_at: "2026-08-01T00:00:00.000Z",
    closes_at: "2026-08-20T00:00:00.000Z",
    draw_at: "2026-08-21T13:30:00.000Z",
    claim_window_days: 7,
    sponsor_display_name: "Reviewed Sponsor",
    public_reward_label: "Electronic reward choice",
    reward_value_cents: 2500,
    cycle_cost_ceiling_cents: 5000,
    base_entries: 1,
    max_bonus_entries: 9,
    max_entries: 10,
    rules_version_url: "/raffle#drawing-rules-monthly-2026-08",
    sponsor_approved: true,
    rules_approved: true,
    country_matrix_approved: true,
    reward_approved: true,
    privacy_approved: true,
    tax_approved: true,
    operations_approved: true,
  };
  const view = publicCycleDto(cycle);
  assert(view !== null, "approved public cycle was omitted");
  assert(
    view.baseEntries === 1 && view.maximumBonusEntries === 9 &&
      view.maximumEntries === 10,
    "public entry limits drifted from 1 plus 9",
  );
  assert(
    JSON.stringify(Object.keys(view).sort()) === JSON.stringify([
      "baseEntries",
      "bonusEntryStatus",
      "claimEndsAt",
      "closesAt",
      "cycleStatus",
      "drawAt",
      "entrantCount",
      "maximumBonusEntries",
      "maximumEntries",
      "opensAt",
      "publicResult",
      "publicReward",
      "rulesUrl",
      "standardEntryStatus",
      "timezone",
      "totalEntryCount",
    ].sort()),
    "public cycle returned fields outside RafflePublicView",
  );
  assert(view.cycleStatus === "open", "open cycle status drifted");
  assert(
    view.standardEntryStatus === "open" && view.bonusEntryStatus === "open",
    "open cycle did not open both entry status fields",
  );
  assert(
    view.claimEndsAt === "2026-08-28T13:30:00.000Z",
    "claim deadline was not derived from the approved window",
  );
  assert(view.publicReward === "Electronic reward choice", "reward missing");
  assert(view.rulesUrl === cycle.rules_version_url, "rules URL missing");
  const serialized = JSON.stringify(view);
  for (
    const forbidden of [
      "Reviewed Sponsor",
      "sponsorDisplayName",
      "grossPrize",
      "allInCost",
      "rewardValue",
      "cycleCost",
      "provider",
    ]
  ) {
    assert(
      !serialized.includes(forbidden),
      `public cycle exposed ${forbidden}`,
    );
  }
});

Deno.test("public cycle maps internal states without exposing them", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const statuses: Array<[string, string, string | undefined]> = [
    ["draft", "inactive", undefined],
    ["ready", "scheduled", undefined],
    ["open", "open", undefined],
    ["frozen", "closed", future],
    ["frozen", "drawing", past],
    ["drawn", "results", undefined],
    ["complete", "results", undefined],
    ["blocked", "paused", undefined],
    ["void", "paused", undefined],
  ];
  for (const [internalStatus, expected, drawAt] of statuses) {
    const view = publicCycleDto({
      public_cycle_id: `cycle-${internalStatus}-${expected}`,
      status: internalStatus,
      draw_at: drawAt,
    });
    assert(view?.cycleStatus === expected, `${internalStatus} mapping drifted`);
    assert(
      view?.publicResult ===
        (["drawn", "complete"].includes(internalStatus)
          ? "winner_confirmed"
          : "none"),
      `${internalStatus} result state drifted`,
    );
  }

  const unapproved = publicCycleDto({
    public_cycle_id: "unapproved",
    status: "ready",
    public_reward_label: "Private reward",
    rules_version_url: "/private-rules",
  });
  assert(
    unapproved?.publicReward === null && unapproved.rulesUrl === null,
    "unapproved public facts were exposed",
  );
});

Deno.test("ledger hash is durably recorded before seed-backed draw completion", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ data: unknown; error: null }> => {
      calls.push({ name, args });
      if (name === "record_raffle_ledger_hash") {
        return Promise.resolve({
          data: {
            ledgerHash: args.p_ledger_hash,
            seedHex: "11".repeat(32),
            seedHash: "22".repeat(32),
            duplicate: false,
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: { drawId: args.p_draw_id, duplicate: false },
        error: null,
      });
    },
  } as unknown as SupabaseClient;

  await completeFrozenDraw(
    client,
    frozenDraw(),
    null,
    new Date("2026-08-01T13:30:00.000Z"),
  );

  assert(calls.length === 2, "unexpected draw RPC count");
  assert(
    calls[0].name === "record_raffle_ledger_hash",
    "seed-backed completion ran before ledger commitment",
  );
  assert(
    calls[1].name === "complete_raffle_draw",
    "draw completion RPC was not called",
  );
  assert(
    calls[0].args.p_ledger_hash === calls[1].args.p_ledger_hash,
    "completion did not use the committed ledger hash",
  );
  assert(
    typeof calls[1].args.p_seed_hex === "string" &&
      String(calls[1].args.p_seed_hex).length === 64,
    "completion did not receive the database-committed CSPRNG seed",
  );
});

Deno.test("ledger commitment failure prevents draw completion", async () => {
  const calls: string[] = [];
  const client = {
    rpc: (name: string): Promise<{ data: null; error: Error }> => {
      calls.push(name);
      return Promise.resolve({
        data: null,
        error: new Error("commitment_failed"),
      });
    },
  } as unknown as SupabaseClient;

  let failed = false;
  try {
    await completeFrozenDraw(
      client,
      frozenDraw(),
      null,
      new Date("2026-08-01T13:30:00.000Z"),
    );
  } catch {
    failed = true;
  }
  assert(failed, "commitment failure was ignored");
  assert(
    JSON.stringify(calls) === JSON.stringify(["record_raffle_ledger_hash"]),
    "draw completion ran after commitment failure",
  );
});

Deno.test("concurrent completion returns the committed recorded draw without redrawing", async () => {
  const calls: string[] = [];
  const recorded = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    cycle_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "drawn",
    ledger_hash: "",
    seed_hash: "22".repeat(32),
    entrant_count: 4,
  };
  const query = {
    select: () => query,
    eq: (_column: string, value: unknown) => {
      if (_column === "ledger_hash") recorded.ledger_hash = String(value);
      return query;
    },
    maybeSingle: () => Promise.resolve({ data: recorded, error: null }),
  };
  const client = {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ data: unknown; error: Error | null }> => {
      calls.push(name);
      if (name === "record_raffle_ledger_hash") {
        return Promise.resolve({
          data: {
            ledgerHash: args.p_ledger_hash,
            seedHex: "11".repeat(32),
            seedHash: "22".repeat(32),
            duplicate: false,
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: null,
        error: new Error("concurrent_completion"),
      });
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      return query;
    },
  } as unknown as SupabaseClient;

  const result = await completeFrozenDraw(
    client,
    frozenDraw(),
    null,
    new Date("2026-08-01T13:30:00.000Z"),
  );

  assert(
    result.duplicate === true,
    "concurrent result was not reconciled as a duplicate",
  );
  assert(
    result.seedHash === recorded.seed_hash,
    "generated losing-worker seed evidence leaked into the result",
  );
  assert(
    result.ledgerHash === recorded.ledger_hash,
    "recorded ledger commitment was not preserved",
  );
  assert(
    JSON.stringify(calls) === JSON.stringify([
      "record_raffle_ledger_hash",
      "complete_raffle_draw",
      "from:raffle_draws",
    ]),
    "concurrent completion did not use the expected reconciliation path",
  );
});
