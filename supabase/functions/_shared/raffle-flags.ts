export type RaffleOperationalGates = {
  submissions: boolean;
  bonusSubmissions: boolean;
  claims: boolean;
  scheduling: boolean;
  rewardOrders: boolean;
  relay: boolean;
};

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
