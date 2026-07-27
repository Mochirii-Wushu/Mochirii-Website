import "server-only";

import {
  parseRafflePageModel,
  rafflePublicModel,
  type RaffleCycleStatus,
  type RafflePageModel,
  type RafflePublicResult,
  type RaffleViewerResultNames,
} from "./public-view";

export type RaffleRenderFixture = {
  model: RafflePageModel;
  viewerResultNames?: RaffleViewerResultNames;
};

const cycleDates = {
  opensAt: "2026-08-01T00:00:00.000Z",
  closesAt: "2026-08-08T12:00:00.000Z",
  drawAt: "2026-08-08T13:30:00.000Z",
  claimEndsAt: "2026-08-15T13:30:00.000Z",
};

export function getRaffleRenderFixture(scenario: string): RaffleRenderFixture | null {
  if (scenario === "missing-data") return null;
  if (scenario === "previous-only") return { model: previousOnlyModel() };

  const state = scenario.startsWith("results-") ? "results" : scenario;
  if (!isCycleStatus(state)) return null;

  const model = buildModel(
    state,
    state === "open" || state === "open-standard" ? "open" : "closed",
    state === "open" ? "open" : "closed",
  );

  if (scenario === "results-verified-a") {
    return { model, viewerResultNames: verifiedNames("Aster Vale", "Mochi Star", "Jade Lantern") };
  }
  if (scenario === "results-verified-b") {
    return { model, viewerResultNames: verifiedNames("Briar Moon", "Cloud Ribbon", "Pearl Bell") };
  }
  if (["results", "results-signed-out", "results-unverified"].includes(scenario)) return { model };
  if (scenario === state || (scenario === "open-standard" && state === "open-standard")) return { model };
  return null;
}

function buildModel(
  state: RaffleCycleStatus | "open-standard",
  standardEntryStatus: "open" | "closed",
  bonusEntryStatus: "open" | "closed",
) {
  const model = structuredClone(rafflePublicModel);
  if (state === "inactive") return parseRafflePageModel(model);

  const cycleStatus = state === "open-standard" ? "open" : state;
  model.publicView = {
    ...model.publicView,
    ...cycleDates,
    cycleStatus,
    standardEntryStatus,
    bonusEntryStatus,
    publicReward: "A choice described in the current drawing rules",
    rulesUrl: "/raffle/rules/rendered-fixture",
  };
  model.meta.intro = "Mochirii holds monthly drawings for eligible guild members. Current details appear below.";
  model.meta.badges = [cycleStatus, "No purchase necessary"];
  model.rules.currentRulesState = "active";
  model.rules.currentRulesLabel = "Current drawing rules";
  model.rules.versions = [{
    slug: "rendered-fixture",
    rulesUrl: "/raffle/rules/rendered-fixture",
    cycleLabel: "Rendered fixture drawing",
    state: "active",
    title: "Rendered fixture official rules",
    publishedAt: "2026-07-31T00:00:00.000Z",
    sections: [{
      heading: "Drawing terms",
      paragraphs: ["No purchase necessary."],
      items: ["Published dates and eligible locations govern this drawing."],
    }],
  }];

  if (cycleStatus === "results") {
    model.publicView.entrantCount = 24;
    model.publicView.totalEntryCount = 173;
    model.publicView.publicResult = "winner_confirmed";
    model.results.current = [
      result("fixture-winner", "winner", "Winner confirmed", "Primary reward"),
      result("fixture-honor-one", "community-honor", "Community honor confirmed", "Guild commendation"),
      result("fixture-honor-two", "community-honor", "Community honor confirmed", "Hall record"),
    ];
    model.results.previous = [
      result("previous-winner", "winner", "Winner confirmed", "Electronic gift", "Previous fixture drawing"),
      result("previous-honor-one", "community-honor", "Community honor confirmed", "Guild commendation", "Previous fixture drawing"),
      result("previous-honor-two", "community-honor", "Community honor confirmed", "Hall record", "Previous fixture drawing"),
    ];
    model.results.publicEvidence = {
      drawingAt: cycleDates.drawAt,
      methodVersion: "raffle-draw-v1",
      ledgerCommitment: "a".repeat(64),
      resultCommitment: "b".repeat(64),
    };
  }

  return parseRafflePageModel(model);
}

function previousOnlyModel() {
  const model = structuredClone(rafflePublicModel);
  model.results.previous = [
    result("previous-winner", "winner", "Winner confirmed", "Electronic gift", "Previous fixture drawing"),
    result("previous-honor-one", "community-honor", "Community honor confirmed", "Guild commendation", "Previous fixture drawing"),
    result("previous-honor-two", "community-honor", "Community honor confirmed", "Hall record", "Previous fixture drawing"),
  ];
  return parseRafflePageModel(model);
}

function verifiedNames(winner: string, honorOne: string, honorTwo: string): RaffleViewerResultNames {
  return {
    "fixture-winner": winner,
    "fixture-honor-one": honorOne,
    "fixture-honor-two": honorTwo,
  };
}

function result(
  resultKey: string,
  outcome: RafflePublicResult["outcome"],
  publicLabel: RafflePublicResult["publicLabel"],
  rewardLabel: string,
  cycleLabel = "Rendered fixture drawing",
): RafflePublicResult {
  return {
    resultKey,
    cycleLabel,
    outcome,
    publicLabel,
    rewardLabel,
  };
}

function isCycleStatus(value: string): value is RaffleCycleStatus | "open-standard" {
  return ["inactive", "scheduled", "open", "open-standard", "closed", "drawing", "results", "paused"].includes(value);
}
