import assert from "node:assert/strict";
import test from "node:test";
import {
  getRaffleRuleVersion,
  parseRafflePageModel,
  parseRafflePublicView,
  raffleEntryHeadingForView,
  rafflePublicModel,
  rafflePublicView,
  raffleStatusForView,
  resultLabelForViewer,
  type RaffleCycleStatus,
  type RafflePageModel,
  type RafflePublicResult,
  type RafflePublicView,
  type RaffleRuleVersion,
} from "./public-view.ts";
import { formatRaffleTime, formatRaffleTimeForZone, parseRaffleInstant } from "./time.ts";

const cycleDates = {
  opensAt: "2026-08-01T00:00:00.000Z",
  closesAt: "2026-08-08T12:00:00.000Z",
  drawAt: "2026-08-08T13:30:00.000Z",
  claimEndsAt: "2026-08-15T13:30:00.000Z",
};

test("the reviewed inactive contract fails closed", () => {
  assert.equal(rafflePublicView.cycleStatus, "inactive");
  assert.equal(rafflePublicView.standardEntryStatus, "closed");
  assert.equal(rafflePublicView.bonusEntryStatus, "closed");
  assert.deepEqual(
    [rafflePublicView.baseEntries, rafflePublicView.maximumBonusEntries, rafflePublicView.maximumEntries],
    [1, 9, 10],
  );
  assert.equal(rafflePublicView.publicReward, null);
  assert.equal(rafflePublicView.rulesUrl, null);
  assert.deepEqual(rafflePublicModel.rules.versions, []);
});

test("all seven cycle states have complete, mutually consistent contracts", () => {
  const fixtures: Record<RaffleCycleStatus, RafflePageModel> = {
    inactive: structuredClone(rafflePublicModel),
    scheduled: modelFor("scheduled"),
    open: modelFor("open", "open", "open"),
    closed: modelFor("closed"),
    drawing: modelFor("drawing"),
    results: modelFor("results"),
    paused: modelFor("paused"),
  };

  for (const [status, fixture] of Object.entries(fixtures)) {
    const parsed = parseRafflePageModel(fixture);
    assert.equal(parsed.publicView.cycleStatus, status);
    const display = raffleStatusForView(parsed.publicView);
    assert(display.drawing.length > 0);
    assert(display.submissions.length > 0);
    assert.equal(display.standardEntries, parsed.publicView.standardEntryStatus === "open" ? "Open" : "Closed");
    assert.equal(display.bonusEntries, parsed.publicView.bonusEntryStatus === "open" ? "Open" : "Closed");
  }
});

test("entry headings derive from both independent public statuses", () => {
  assert.equal(raffleEntryHeadingForView(activeFixture("open", "open", "open")), "Entries open");
  assert.equal(raffleEntryHeadingForView(activeFixture("open", "open", "closed")), "Standard entries open");
  assert.equal(raffleEntryHeadingForView({ ...activeFixture("open", "open", "closed"), standardEntryStatus: "closed", bonusEntryStatus: "open" }), "Bonus entries open");
  assert.equal(raffleEntryHeadingForView(rafflePublicView), "Entries closed");
});

test("only the open state may accept entries and standard entry must be open", () => {
  assert.equal(parseRafflePublicView(activeFixture("open", "open", "closed")).bonusEntryStatus, "closed");
  assert.equal(parseRafflePublicView(activeFixture("open", "open", "open")).bonusEntryStatus, "open");
  assert.throws(() => parseRafflePublicView(activeFixture("open")), /accept standard entries/);
  assert.throws(
    () => parseRafflePublicView({ ...activeFixture("scheduled"), bonusEntryStatus: "open" }),
    /must keep entries closed/,
  );
});

test("cycle terms are all-or-nothing and strictly chronological UTC instants", () => {
  for (const key of ["opensAt", "closesAt", "drawAt", "claimEndsAt", "publicReward", "rulesUrl"] as const) {
    const fixture = activeFixture("scheduled") as RafflePublicView & Record<string, unknown>;
    fixture[key] = null;
    assert.throws(() => parseRafflePublicView(fixture), /requires all cycle dates|requires a public reward/);
  }

  assert.throws(
    () => parseRafflePublicView({ ...activeFixture("open", "open"), opensAt: cycleDates.closesAt }),
    /opensAt < closesAt < drawAt < claimEndsAt/,
  );
  assert.throws(
    () => parseRafflePublicView({ ...activeFixture("closed"), drawAt: "2026-02-30T13:30:00.000Z" }),
    /valid UTC instant/,
  );
  assert.throws(
    () => parseRafflePublicView({ ...structuredClone(rafflePublicView), cycleStatus: "paused" }),
    /requires all cycle dates/,
  );
});

test("current results, aggregate counts, and evidence exist only in results state", () => {
  const resultModel = modelFor("results");
  assert.equal(parseRafflePageModel(resultModel).results.current?.length, 3);

  const inactiveWithResult = structuredClone(rafflePublicModel);
  inactiveWithResult.results.current = structuredClone(resultModel.results.current);
  inactiveWithResult.results.publicEvidence = structuredClone(resultModel.results.publicEvidence);
  assert.throws(() => parseRafflePageModel(inactiveWithResult), /only in results state/);

  assert.throws(
    () => parseRafflePublicView({ ...activeFixture("closed"), entrantCount: 1, totalEntryCount: 1 }),
    /aggregate counts may appear only in results state/,
  );
  assert.throws(
    () => parseRafflePublicView({ ...resultModel.publicView, entrantCount: 0 }),
    /nonzero aggregate/,
  );
  assert.throws(
    () => parseRafflePublicView({ ...resultModel.publicView, entrantCount: 24, totalEntryCount: 23 }),
    /one to ten entries per entrant/,
  );
  assert.throws(
    () => parseRafflePublicView({ ...resultModel.publicView, entrantCount: 24, totalEntryCount: 241 }),
    /one to ten entries per entrant/,
  );
});

test("drawing evidence is non-null, strict, and equal to the cycle drawing instant", () => {
  const missingEvidence = modelFor("results");
  missingEvidence.results.publicEvidence = null;
  assert.throws(() => parseRafflePageModel(missingEvidence), /requires privacy-safe result rows/);

  const nullDrawing = modelFor("results") as unknown as { results: { publicEvidence: { drawingAt: null } } };
  nullDrawing.results.publicEvidence.drawingAt = null;
  assert.throws(() => parseRafflePageModel(nullDrawing), /drawingAt must be a non-empty string/);

  const mismatchedEvidence = modelFor("results");
  if (!mismatchedEvidence.results.publicEvidence) assert.fail("fixture evidence missing");
  mismatchedEvidence.results.publicEvidence.drawingAt = cycleDates.closesAt;
  assert.throws(() => parseRafflePageModel(mismatchedEvidence), /must equal the current drawing time/);
});

test("completed drawings require one winner, two honors, and unique public result keys", () => {
  const missingHonor = modelFor("results");
  missingHonor.results.current?.pop();
  assert.throws(() => parseRafflePageModel(missingHonor), /one winner and two community honors/);

  const duplicateKey = modelFor("results");
  if (!duplicateKey.results.current) assert.fail("fixture results missing");
  duplicateKey.results.current[1].resultKey = duplicateKey.results.current[0].resultKey;
  assert.throws(() => parseRafflePageModel(duplicateKey), /result keys must be unique/);
});

test("every advertised immutable rules URL resolves to reviewed local content", () => {
  const active = modelFor("open", "open", "open");
  const parsed = parseRafflePageModel(active);
  assert.equal(getRaffleRuleVersion("example-cycle", parsed)?.rulesUrl, "/raffle#drawing-rules-example-cycle");
  assert.equal(getRaffleRuleVersion("missing-cycle", parsed), null);
  assert.equal(getRaffleRuleVersion("../unsafe", parsed), null);

  const unavailable = modelFor("open", "open", "open");
  unavailable.rules.versions = [];
  assert.throws(() => parseRafflePageModel(unavailable), /exactly one reviewed active rule version/);

  const wrongState = modelFor("open", "open", "open");
  wrongState.rules.currentRulesState = "inactive";
  assert.throws(() => parseRafflePageModel(wrongState), /exactly one reviewed active rule version/);

  const unknownArchive = structuredClone(rafflePublicModel);
  unknownArchive.rules.archive = [{ cycleLabel: "Past drawing", rulesUrl: "/raffle#drawing-rules-past-drawing" }];
  assert.throws(() => parseRafflePageModel(unknownArchive), /matching reviewed archived content/);

  const archived = structuredClone(rafflePublicModel);
  const pastVersion = ruleVersion("past-drawing", "archived");
  pastVersion.cycleLabel = "Past drawing";
  archived.rules.versions = [pastVersion];
  archived.rules.archive = [{ cycleLabel: pastVersion.cycleLabel, rulesUrl: pastVersion.rulesUrl }];
  assert.equal(parseRafflePageModel(archived).rules.archive.length, 1);
});

test("unknown, missing, and leaked fields are rejected", () => {
  const invalidState = structuredClone(rafflePublicView) as unknown as Record<string, unknown>;
  invalidState.cycleStatus = "unknown";
  assert.throws(() => parseRafflePublicView(invalidState), /cycleStatus/);

  const missingField = structuredClone(rafflePublicView) as unknown as Record<string, unknown>;
  delete missingField.timezone;
  assert.throws(() => parseRafflePublicView(missingField), /unexpected or missing fields/);

  const leakedField = structuredClone(rafflePublicModel) as unknown as Record<string, unknown>;
  leakedField.provider = "example";
  assert.throws(() => parseRafflePageModel(leakedField), /unexpected or missing fields/);

  const nestedLeak = structuredClone(rafflePublicModel) as unknown as { meta: Record<string, unknown> };
  nestedLeak.meta.internalId = "not-public";
  assert.throws(() => parseRafflePageModel(nestedLeak), /raffle\.meta contains unexpected or missing fields/);
});

test("the standing model contains every selected fairness, privacy, claim, and expiration disclosure", () => {
  const standingText = [
    rafflePublicModel.eligibility,
    rafflePublicModel.entryModel.noPurchaseNotice,
    ...rafflePublicModel.standingPrinciples,
    ...rafflePublicModel.entryModel.noAdvantageRules,
  ].join(" ");
  for (const phrase of [
    "No purchase necessary",
    "seven days",
    "72 hours",
    "24 hours",
    "30 days",
    "current point totals",
    "Signed-out and unverified visitors cannot access the standings",
    "selected guild display name",
    "non-reversible evidence",
    "predetermined alternates",
    "Void where prohibited",
  ]) {
    assert.match(standingText, new RegExp(phrase, "i"));
  }
});

test("all nine permanent methods are unique and capped at one entry", () => {
  const methods = rafflePublicModel.entryModel.permanentBonusMethods;
  assert.equal(methods.length, 9);
  assert.equal(new Set(methods.map((method) => method.title)).size, 9);
  assert(methods.every((method) => method.maximumEntries === 1));
});

test("result names remain generic unless the current verified-member DTO supplies them", () => {
  const winner = result("cycle-winner", "winner", "Winner confirmed", "Primary reward");
  const honor = result("cycle-honor", "community-honor", "Community honor confirmed", "Guild commendation");

  assert.equal(resultLabelForViewer(winner), "Winner confirmed");
  assert.equal(resultLabelForViewer(honor), "Community honor confirmed");
  assert.equal(resultLabelForViewer(winner, { "cycle-winner": "Guild Member" }), "Guild Member");
  assert.equal(resultLabelForViewer(honor, { "other-result": "Another Member" }), "Community honor confirmed");

  assert.equal(resultLabelForViewer(winner, { "cycle-winner": "First Viewer" }), "First Viewer");
  assert.equal(resultLabelForViewer(winner), "Winner confirmed", "a signed-out render must not reuse a prior viewer name");
  assert.equal(resultLabelForViewer(winner, { "cycle-winner": "Second Viewer" }), "Second Viewer");
  assert.equal(resultLabelForViewer(winner), "Winner confirmed", "alternating viewer DTO renders must remain isolated");
  assert.equal(resultLabelForViewer(winner, { "cycle-winner": "x".repeat(65) }), "Winner confirmed");
  assert.equal(resultLabelForViewer(winner, { "cycle-winner": "unsafe\u0000name" }), "Winner confirmed");
});

test("raffle instants use the UTC+8 authority and strict visitor-local formatting", () => {
  const instant = "2026-08-01T13:30:00.000Z";
  assert.equal(parseRaffleInstant(instant).toISOString(), instant);
  assert.match(formatRaffleTime(instant), /9:30\s*PM/i);
  assert.match(formatRaffleTimeForZone(instant, "America/Los_Angeles"), /6:30\s*AM/i);
  assert.match(formatRaffleTimeForZone(instant, "Europe/London"), /2:30\s*PM/i);
  assert.match(formatRaffleTimeForZone(instant, "Asia/Tokyo"), /10:30\s*PM/i);
  assert.throws(() => parseRaffleInstant("2026-08-01 13:30"), /UTC instant/);
  assert.throws(() => parseRaffleInstant("2026-02-30T13:30:00.000Z"), /valid UTC instant/);
});

function modelFor(
  cycleStatus: RaffleCycleStatus,
  standardEntryStatus: "open" | "closed" = "closed",
  bonusEntryStatus: "open" | "closed" = "closed",
): RafflePageModel {
  const model = structuredClone(rafflePublicModel);
  if (cycleStatus === "inactive") return model;

  model.publicView = activeFixture(cycleStatus, standardEntryStatus, bonusEntryStatus);
  model.rules.currentRulesState = "active";
  model.rules.currentRulesLabel = "Current drawing rules";
  model.rules.versions = [ruleVersion("example-cycle", "active")];

  if (cycleStatus === "results") {
    model.publicView.entrantCount = 24;
    model.publicView.totalEntryCount = 173;
    model.publicView.publicResult = "winner_confirmed";
    model.results.current = [
      result("winner-result", "winner", "Winner confirmed", "Primary reward"),
      result("honor-one", "community-honor", "Community honor confirmed", "Guild commendation"),
      result("honor-two", "community-honor", "Community honor confirmed", "Hall record"),
    ];
    model.results.publicEvidence = {
      drawingAt: cycleDates.drawAt,
      methodVersion: "raffle-draw-v1",
      ledgerCommitment: "a".repeat(64),
      resultCommitment: "b".repeat(64),
    };
  }

  return model;
}

function activeFixture(
  cycleStatus: Exclude<RaffleCycleStatus, "inactive">,
  standardEntryStatus: "open" | "closed" = "closed",
  bonusEntryStatus: "open" | "closed" = "closed",
): RafflePublicView {
  return {
    ...structuredClone(rafflePublicView),
    ...cycleDates,
    cycleStatus,
    standardEntryStatus,
    bonusEntryStatus,
    publicReward: "Approved drawing reward",
    rulesUrl: "/raffle#drawing-rules-example-cycle",
  };
}

function ruleVersion(slug: string, state: RaffleRuleVersion["state"]): RaffleRuleVersion {
  return {
    slug,
    rulesUrl: `/raffle#drawing-rules-${slug}`,
    cycleLabel: "Example drawing",
    state,
    title: "Example drawing official rules",
    publishedAt: "2026-07-31T00:00:00.000Z",
    sections: [{
      heading: "Drawing terms",
      paragraphs: ["No purchase necessary."],
      items: ["The published dates and eligible locations govern this drawing."],
    }],
  };
}

function result(
  resultKey: string,
  outcome: RafflePublicResult["outcome"],
  publicLabel: RafflePublicResult["publicLabel"],
  rewardLabel: string,
): RafflePublicResult {
  return {
    resultKey,
    cycleLabel: "Completed drawing",
    outcome,
    publicLabel,
    rewardLabel,
  };
}
