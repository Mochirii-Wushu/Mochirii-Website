import { handleModerateRaffleRequest } from "../moderate-raffle/index.ts";
import {
  RAFFLE_MODERATOR_ACTION_REQUIREMENTS,
  type RaffleModeratorAction,
  raffleModeratorActionDecision,
  type RaffleOperationalGate,
  type RaffleOperationalGates,
  raffleOperationalGatesFrom,
} from "./raffle-flags.ts";

const allClosed: RaffleOperationalGates = {
  submissions: false,
  bonusSubmissions: false,
  claims: false,
  scheduling: false,
  rewardOrders: false,
  relay: false,
};

const actionEntries = Object.entries(RAFFLE_MODERATOR_ACTION_REQUIREMENTS) as [
  RaffleModeratorAction,
  readonly RaffleOperationalGate[],
][];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function gatesFor(
  requirements: readonly RaffleOperationalGate[],
): RaffleOperationalGates {
  const gates = { ...allClosed };
  for (const requirement of requirements) gates[requirement] = true;
  return gates;
}

function requestFor(action: string): Request {
  return new Request("https://mochirii.com/functions/v1/moderate-raffle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

Deno.test("moderator action policy closes every operation when configuration is missing", () => {
  const missing = raffleOperationalGatesFrom(() => undefined);
  for (const [action, requirements] of actionEntries) {
    const decision = raffleModeratorActionDecision(action, missing);
    assert(decision.known, `${action} was not recognized`);
    assert(
      decision.allowed === (requirements.length === 0),
      `${action} did not follow its preparation-only policy`,
    );
  }
});

Deno.test("moderator action policy requires each action's exact gate combination", () => {
  for (const [action, requirements] of actionEntries) {
    const exact = gatesFor(requirements);
    const allowed = raffleModeratorActionDecision(action, exact);
    assert(allowed.known && allowed.allowed, `${action} rejected exact gates`);
    assert(allowed.missing.length === 0, `${action} reported missing gates`);

    for (const missingGate of requirements) {
      const incomplete = { ...exact, [missingGate]: false };
      const denied = raffleModeratorActionDecision(action, incomplete);
      assert(!denied.allowed, `${action} ignored missing ${missingGate}`);
      assert(
        denied.missing.length === 1 && denied.missing[0] === missingGate,
        `${action} did not report missing ${missingGate}`,
      );
    }
  }
});

Deno.test("unknown moderator actions are denied", () => {
  const decision = raffleModeratorActionDecision("unknown_action", {
    submissions: true,
    bonusSubmissions: true,
    claims: true,
    scheduling: true,
    rewardOrders: true,
    relay: true,
  });
  assert(!decision.known, "unknown action was classified as known");
  assert(!decision.allowed, "unknown action was allowed");
});

Deno.test("unauthenticated moderator responses remain authoritative", async () => {
  let accessCalls = 0;
  const requireModerator = () => {
    accessCalls += 1;
    return Promise.resolve({
      ok: false as const,
      response: new Response(null, { status: 401 }),
    });
  };

  const invalidJson = new Request(
    "https://mochirii.com/functions/v1/moderate-raffle",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    },
  );
  const invalidResponse = await handleModerateRaffleRequest(invalidJson, {
    gates: () => ({ ...allClosed }),
    requireModerator,
  });
  assert(
    invalidResponse.status === 401,
    "invalid JSON bypassed authentication",
  );

  const unknownResponse = await handleModerateRaffleRequest(
    requestFor("unknown_action"),
    {
      gates: () => ({ ...allClosed }),
      requireModerator,
    },
  );
  assert(
    unknownResponse.status === 401,
    "unknown action bypassed authentication",
  );
  assert(accessCalls === 2, "authentication was not authoritative");
});

Deno.test("closed and unknown actions cannot reach moderator data access", async () => {
  let accessCalls = 0;
  let dataAccesses = 0;
  const adminClient = new Proxy({}, {
    get() {
      dataAccesses += 1;
      throw new Error("denied action reached moderator data access");
    },
  });
  const requireModerator = () => {
    accessCalls += 1;
    return Promise.resolve({
      ok: true as const,
      adminClient: adminClient as never,
      userId: "00000000-0000-4000-8000-000000000001",
      discordUserId: "1234567890123456",
    });
  };

  for (const [action, requirements] of actionEntries) {
    if (requirements.length === 0) continue;
    const response = await handleModerateRaffleRequest(requestFor(action), {
      gates: () => ({ ...allClosed }),
      requireModerator,
    });
    assert(response.status === 409, `${action} did not fail closed`);
  }

  const unknown = await handleModerateRaffleRequest(
    requestFor("unknown_action"),
    {
      gates: () => ({ ...allClosed }),
      requireModerator,
    },
  );
  assert(unknown.status === 400, "unknown action did not fail closed");
  assert(
    accessCalls ===
      actionEntries.filter(([, gates]) => gates.length > 0).length +
        1,
    "denied actions did not authenticate exactly once",
  );
  assert(dataAccesses === 0, "denied action reached moderator data access");
});

Deno.test("exact operational gates pass policy before action validation", async () => {
  for (const [action, requirements] of actionEntries) {
    if (requirements.length === 0) continue;
    let accessCalls = 0;
    let dataAccesses = 0;
    const adminClient = new Proxy({}, {
      get() {
        dataAccesses += 1;
        throw new Error("incomplete action reached moderator data access");
      },
    });
    const response = await handleModerateRaffleRequest(requestFor(action), {
      gates: () => gatesFor(requirements),
      requireModerator: () => {
        accessCalls += 1;
        return Promise.resolve({
          ok: true as const,
          adminClient: adminClient as never,
          userId: "00000000-0000-4000-8000-000000000001",
          discordUserId: "1234567890123456",
        });
      },
    });
    assert(response.status === 400, `${action} did not pass its exact gates`);
    assert(
      accessCalls === 1,
      `${action} called authorization ${accessCalls} times`,
    );
    assert(dataAccesses === 0, `${action} accessed data before validation`);
  }
});
