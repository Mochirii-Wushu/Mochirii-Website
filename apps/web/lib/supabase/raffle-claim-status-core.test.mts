import assert from "node:assert/strict";
import test from "node:test";
import { parseRaffleClaimStatus } from "./raffle-claim-status.ts";

const claimable = {
  claimsEnabled: true,
  selectedClaimId: "00000000-0000-4000-8000-000000000001",
  claimState: "claimable",
  fulfillmentState: "not_started",
  rewardChoice: null,
  inGameRewardAvailable: true,
  claimDeadline: "2026-08-15T13:30:00.000Z",
};

test("trusted claim status accepts the exact activation fields", () => {
  assert.deepEqual(parseRaffleClaimStatus(claimable), claimable);
});

test("claim status fails closed on malformed gates, identifiers, deadlines, and states", () => {
  assert.equal(parseRaffleClaimStatus({ ...claimable, claimsEnabled: "true" }), null);
  assert.equal(parseRaffleClaimStatus({ ...claimable, selectedClaimId: "winner" }), null);
  assert.equal(parseRaffleClaimStatus({ ...claimable, claimDeadline: "tomorrow" }), null);
  assert.equal(parseRaffleClaimStatus({ ...claimable, claimState: "open" }), null);
  assert.equal(parseRaffleClaimStatus({ ...claimable, inGameRewardAvailable: "yes" }), null);
});

test("an unavailable claim may omit its identifier and deadline", () => {
  const unavailable = {
    ...claimable,
    claimsEnabled: false,
    selectedClaimId: null,
    claimState: "not_available",
    fulfillmentState: "unavailable",
    inGameRewardAvailable: false,
    claimDeadline: null,
  };
  assert.deepEqual(parseRaffleClaimStatus(unavailable), unavailable);
});
