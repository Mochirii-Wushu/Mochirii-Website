import { raffleOperationalGatesFrom } from "./raffle-flags.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("raffle operational gates default closed and accept only exact true values", () => {
  const closed = raffleOperationalGatesFrom(() => undefined);
  assert(
    Object.values(closed).every((value) => value === false),
    "missing configuration opened an operational gate",
  );

  const values = new Map<string, string>([
    ["RAFFLE_SUBMISSIONS_ENABLED", " true "],
    ["RAFFLE_BONUS_SUBMISSIONS_ENABLED", "TRUE"],
    ["RAFFLE_CLAIMS_ENABLED", "1"],
    ["RAFFLE_SCHEDULING_ENABLED", "yes"],
    ["RAFFLE_REWARD_ORDERS_ENABLED", "false"],
    ["RAFFLE_RELAY_ENABLED", ""],
  ]);
  const configured = raffleOperationalGatesFrom((name) => values.get(name));
  assert(configured.submissions, "trimmed true was rejected");
  assert(configured.bonusSubmissions, "case-insensitive true was rejected");
  assert(!configured.claims, "numeric truthy value opened claims");
  assert(!configured.scheduling, "word truthy value opened scheduling");
  assert(!configured.rewardOrders, "false opened reward orders");
  assert(!configured.relay, "empty value opened the relay");
});
