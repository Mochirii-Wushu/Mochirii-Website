export type RaffleOperationalGates = {
  submissions: boolean;
  bonusSubmissions: boolean;
  claims: boolean;
  scheduling: boolean;
  rewardOrders: boolean;
  relay: boolean;
};

export type RaffleOperationalGate = keyof RaffleOperationalGates;

export const RAFFLE_MODERATOR_ACTION_REQUIREMENTS = {
  readiness: [],
  create_draft: [],
  open_cycle: ["submissions"],
  freeze_cycle: ["scheduling"],
  draw_cycle: ["scheduling"],
  review_eligibility: ["submissions"],
  award_bonus: ["submissions", "bonusSubmissions"],
  revoke_bonus: ["submissions", "bonusSubmissions"],
  review_claim_tax: ["claims"],
  record_private_notice: ["claims"],
  review_claim_clearance: ["claims"],
  release_digital_fulfillment: ["claims", "rewardOrders", "relay"],
  complete_in_game_fulfillment: ["claims"],
  unlock_reward_link: ["claims", "rewardOrders", "relay"],
} as const satisfies Record<string, readonly RaffleOperationalGate[]>;

export type RaffleModeratorAction =
  keyof typeof RAFFLE_MODERATOR_ACTION_REQUIREMENTS;

export type RaffleModeratorActionDecision = {
  known: boolean;
  allowed: boolean;
  missing: RaffleOperationalGate[];
};

export function raffleModeratorActionDecision(
  action: string,
  gates: RaffleOperationalGates,
): RaffleModeratorActionDecision {
  if (!Object.hasOwn(RAFFLE_MODERATOR_ACTION_REQUIREMENTS, action)) {
    return { known: false, allowed: false, missing: [] };
  }
  const requirements = RAFFLE_MODERATOR_ACTION_REQUIREMENTS[
    action as RaffleModeratorAction
  ];
  const missing = requirements.filter((gate) => gates[gate] !== true);
  return { known: true, allowed: missing.length === 0, missing: [...missing] };
}

export function raffleOperationalGates(): RaffleOperationalGates {
  return raffleOperationalGatesFrom((name) => Deno.env.get(name));
}

export function raffleOperationalGatesFrom(
  readEnvironment: (name: string) => string | undefined,
): RaffleOperationalGates {
  return {
    submissions: enabled(readEnvironment("RAFFLE_SUBMISSIONS_ENABLED")),
    bonusSubmissions: enabled(
      readEnvironment("RAFFLE_BONUS_SUBMISSIONS_ENABLED"),
    ),
    claims: enabled(readEnvironment("RAFFLE_CLAIMS_ENABLED")),
    scheduling: enabled(readEnvironment("RAFFLE_SCHEDULING_ENABLED")),
    rewardOrders: enabled(readEnvironment("RAFFLE_REWARD_ORDERS_ENABLED")),
    relay: enabled(readEnvironment("RAFFLE_RELAY_ENABLED")),
  };
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
