import raffleData from "../../public/data/raffles.json" with { type: "json" };

export type RaffleCycleStatus =
  | "inactive"
  | "scheduled"
  | "open"
  | "closed"
  | "drawing"
  | "results"
  | "paused";

export type RaffleEntryStatus = "closed" | "open";

export type RafflePublicView = {
  cycleStatus: RaffleCycleStatus;
  standardEntryStatus: RaffleEntryStatus;
  bonusEntryStatus: RaffleEntryStatus;
  timezone: "Asia/Singapore";
  opensAt: string | null;
  closesAt: string | null;
  drawAt: string | null;
  claimEndsAt: string | null;
  publicReward: string | null;
  baseEntries: 5;
  maximumBonusEntries: 5;
  maximumEntries: 10;
  rulesUrl: string | null;
  entrantCount: number | null;
  totalEntryCount: number | null;
  publicResult: "none" | "winner_confirmed";
};

export type RafflePublicResult = {
  resultKey: string;
  cycleLabel: string;
  outcome: "winner" | "community-honor";
  publicLabel: "Winner confirmed" | "Community honor confirmed";
  rewardLabel: string;
};

export type RaffleViewerResultNames = Readonly<Record<string, string>>;

export type RafflePublicEvidence = {
  drawingAt: string;
  methodVersion: string;
  ledgerCommitment: string;
  resultCommitment: string;
};

export type RaffleRuleSection = {
  heading: string;
  paragraphs: string[];
  items: string[];
};

export type RaffleRuleVersion = {
  slug: string;
  rulesUrl: string;
  cycleLabel: string;
  state: "active" | "archived";
  title: string;
  publishedAt: string;
  sections: RaffleRuleSection[];
};

export type RaffleStatusDisplay = {
  drawing: string;
  standardEntries: "Open" | "Closed";
  bonusEntries: "Open" | "Closed";
  submissions: string;
  detail: string;
};

export type RafflePageModel = {
  schemaVersion: 1;
  programName: string;
  meta: {
    kicker: string;
    title: string;
    intro: string;
    frequency: string;
    badges: string[];
    hero: {
      image: string;
      atmosphere: string;
    };
  };
  publicView: RafflePublicView;
  entryModel: {
    standardEntrySummary: string;
    bonusEntrySummary: string;
    permanentBonusMethods: Array<{
      title: string;
      primaryPath: string;
      equivalentFreePath: string;
      maximumEntries: 1;
    }>;
    noAdvantageRules: string[];
    oddsFormula: string;
  };
  rewards: {
    summary: string;
    activeDrawingNotice: string;
    categories: Array<{
      title: string;
      description: string;
    }>;
  };
  eligibility: string;
  standingPrinciples: string[];
  results: {
    current: RafflePublicResult[] | null;
    previous: RafflePublicResult[];
    emptyMessage: string;
    publicEvidence: RafflePublicEvidence | null;
  };
  rules: {
    standingRulesUrl: "/raffle/rules";
    currentRulesState: "inactive" | "active";
    currentRulesLabel: string;
    archive: Array<{
      cycleLabel: string;
      rulesUrl: string;
    }>;
    versions: RaffleRuleVersion[];
  };
};

export const rafflePublicModel = parseRafflePageModel(raffleData);
export const rafflePublicView = rafflePublicModel.publicView;

export function getRaffleRuleVersion(
  slug: string,
  model: RafflePageModel = rafflePublicModel,
) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) return null;
  return model.rules.versions.find((version) => version.slug === slug) ?? null;
}

export function resultLabelForViewer(
  result: RafflePublicResult,
  viewerResultNames?: RaffleViewerResultNames,
) {
  const memberDisplayName = viewerResultNames?.[result.resultKey]?.trim();
  if (
    memberDisplayName
    && memberDisplayName.length <= 64
    && !/[\u0000-\u001f\u007f]/.test(memberDisplayName)
  ) {
    return memberDisplayName;
  }
  return result.publicLabel;
}

export function raffleStatusForView(view: RafflePublicView): RaffleStatusDisplay {
  const labels: Record<RaffleCycleStatus, Pick<RaffleStatusDisplay, "drawing" | "submissions" | "detail">> = {
    inactive: {
      drawing: "No raffle is active",
      submissions: "No submissions are being accepted.",
      detail: "Drawing dates, eligibility, rewards, and claim deadlines appear here only when official rules are in effect.",
    },
    scheduled: {
      drawing: "A raffle is scheduled",
      submissions: "Submissions are not open yet.",
      detail: "Review the official drawing rules and dates before submissions open.",
    },
    open: {
      drawing: "A raffle is active",
      submissions: "Eligible guild members may submit entries during the published entry period.",
      detail: "The official drawing rules govern eligibility, entry methods, rewards, and deadlines.",
    },
    closed: {
      drawing: "Submissions are closed",
      submissions: "No additional submissions are being accepted.",
      detail: "The drawing will follow the published official rules and schedule.",
    },
    drawing: {
      drawing: "Drawing in progress",
      submissions: "Submissions are closed while the result is prepared.",
      detail: "Results will appear here after the drawing is complete.",
    },
    results: {
      drawing: "Drawing complete",
      submissions: "Submissions are closed for this drawing.",
      detail: "The confirmed result and public drawing evidence appear below.",
    },
    paused: {
      drawing: "Raffle paused",
      submissions: "No submissions are being accepted.",
      detail: "Only the current official rules and notices determine whether this drawing resumes.",
    },
  };

  return {
    ...labels[view.cycleStatus],
    standardEntries: view.standardEntryStatus === "open" ? "Open" : "Closed",
    bonusEntries: view.bonusEntryStatus === "open" ? "Open" : "Closed",
  };
}

export function raffleEntryHeadingForView(view: RafflePublicView) {
  if (view.standardEntryStatus === "open" && view.bonusEntryStatus === "open") return "Entries open";
  if (view.standardEntryStatus === "open") return "Standard entries open";
  if (view.bonusEntryStatus === "open") return "Bonus entries open";
  return "Entries closed";
}

export function parseRafflePageModel(value: unknown): RafflePageModel {
  const root = expectRecord(value, "raffle");
  expectExactKeys(root, [
    "eligibility",
    "entryModel",
    "meta",
    "programName",
    "publicView",
    "results",
    "rewards",
    "rules",
    "schemaVersion",
    "standingPrinciples",
  ], "raffle");

  if (root.schemaVersion !== 1) fail("raffle.schemaVersion must be 1");
  expectString(root.programName, "raffle.programName");

  const meta = expectRecord(root.meta, "raffle.meta");
  expectExactKeys(meta, ["badges", "frequency", "hero", "intro", "kicker", "title"], "raffle.meta");
  for (const key of ["kicker", "title", "intro", "frequency"] as const) expectString(meta[key], `raffle.meta.${key}`);
  expectStringArray(meta.badges, "raffle.meta.badges", 1);
  const hero = expectRecord(meta.hero, "raffle.meta.hero");
  expectExactKeys(hero, ["atmosphere", "image"], "raffle.meta.hero");
  expectString(hero.image, "raffle.meta.hero.image");
  expectOptionalString(hero.atmosphere, "raffle.meta.hero.atmosphere");

  const publicView = parseRafflePublicView(root.publicView);

  const entryModel = expectRecord(root.entryModel, "raffle.entryModel");
  expectExactKeys(entryModel, [
    "bonusEntrySummary",
    "noAdvantageRules",
    "oddsFormula",
    "permanentBonusMethods",
    "standardEntrySummary",
  ], "raffle.entryModel");
  expectString(entryModel.standardEntrySummary, "raffle.entryModel.standardEntrySummary");
  expectString(entryModel.bonusEntrySummary, "raffle.entryModel.bonusEntrySummary");
  expectString(entryModel.oddsFormula, "raffle.entryModel.oddsFormula");
  const bonusMethods = expectArray(entryModel.permanentBonusMethods, "raffle.entryModel.permanentBonusMethods");
  if (bonusMethods.length !== 5) fail("raffle must define exactly five permanent bonus methods");
  const methodTitles = new Set<string>();
  for (const [index, item] of bonusMethods.entries()) {
    const method = expectRecord(item, `raffle.entryModel.permanentBonusMethods.${index}`);
    expectExactKeys(method, ["equivalentFreePath", "maximumEntries", "primaryPath", "title"], `raffle.entryModel.permanentBonusMethods.${index}`);
    const title = expectString(method.title, `raffle.entryModel.permanentBonusMethods.${index}.title`);
    if (methodTitles.has(title)) fail("raffle permanent bonus method titles must be unique");
    methodTitles.add(title);
    expectString(method.primaryPath, `raffle.entryModel.permanentBonusMethods.${index}.primaryPath`);
    expectString(method.equivalentFreePath, `raffle.entryModel.permanentBonusMethods.${index}.equivalentFreePath`);
    if (method.maximumEntries !== 1) fail("each raffle bonus method must be capped at one entry");
  }
  expectStringArray(entryModel.noAdvantageRules, "raffle.entryModel.noAdvantageRules", 1);

  const rewards = expectRecord(root.rewards, "raffle.rewards");
  expectExactKeys(rewards, ["activeDrawingNotice", "categories", "summary"], "raffle.rewards");
  expectString(rewards.summary, "raffle.rewards.summary");
  expectString(rewards.activeDrawingNotice, "raffle.rewards.activeDrawingNotice");
  const rewardCategories = expectArray(rewards.categories, "raffle.rewards.categories");
  if (rewardCategories.length < 4) fail("raffle rewards must include electronic, in-game, and two community-honor concepts");
  rewardCategories.forEach((item, index) => {
    const category = expectRecord(item, `raffle.rewards.categories.${index}`);
    expectExactKeys(category, ["description", "title"], `raffle.rewards.categories.${index}`);
    expectString(category.title, `raffle.rewards.categories.${index}.title`);
    expectString(category.description, `raffle.rewards.categories.${index}.description`);
  });

  expectString(root.eligibility, "raffle.eligibility");
  expectStringArray(root.standingPrinciples, "raffle.standingPrinciples", 1);

  const results = expectRecord(root.results, "raffle.results");
  expectExactKeys(results, ["current", "emptyMessage", "previous", "publicEvidence"], "raffle.results");
  const resultKeys = new Set<string>();
  if (results.current !== null) {
    const currentResults = expectArray(results.current, "raffle.results.current");
    if (currentResults.length !== 3) fail("a completed drawing must publish one winner and two community honors");
    currentResults.forEach((item, index) => {
      const result = parseResult(item, `raffle.results.current.${index}`);
      if (resultKeys.has(result.resultKey)) fail("raffle result keys must be unique");
      resultKeys.add(result.resultKey);
    });
    const outcomes = currentResults.map((item) => expectRecord(item, "raffle result").outcome);
    if (outcomes.filter((outcome) => outcome === "winner").length !== 1 || outcomes.filter((outcome) => outcome === "community-honor").length !== 2) {
      fail("a completed drawing must contain exactly one winner and two community honors");
    }
    const cycleLabels = new Set(currentResults.map((item) => expectRecord(item, "raffle result").cycleLabel));
    if (cycleLabels.size !== 1) fail("current raffle results must identify one completed drawing");
  }
  expectArray(results.previous, "raffle.results.previous").forEach((item, index) => {
    const result = parseResult(item, `raffle.results.previous.${index}`);
    if (resultKeys.has(result.resultKey)) fail("raffle result keys must be unique");
    resultKeys.add(result.resultKey);
  });
  expectString(results.emptyMessage, "raffle.results.emptyMessage");
  const publicEvidence = results.publicEvidence === null ? null : parsePublicEvidence(results.publicEvidence);
  if (publicView.cycleStatus === "results") {
    if (results.current === null || publicEvidence === null) {
      fail("results state requires privacy-safe result rows and reproducibility evidence");
    }
    if (publicEvidence.drawingAt !== publicView.drawAt) {
      fail("public drawing evidence time must equal the current drawing time");
    }
  } else if (results.current !== null || publicEvidence !== null) {
    fail("current result rows and drawing evidence may appear only in results state");
  }

  const rules = expectRecord(root.rules, "raffle.rules");
  expectExactKeys(rules, ["archive", "currentRulesLabel", "currentRulesState", "standingRulesUrl", "versions"], "raffle.rules");
  if (rules.standingRulesUrl !== "/raffle/rules") fail("raffle standing rules URL must remain /raffle/rules");
  const currentRulesState = expectOneOf(rules.currentRulesState, ["active", "inactive"], "raffle.rules.currentRulesState");
  expectString(rules.currentRulesLabel, "raffle.rules.currentRulesLabel");
  const archivedRuleUrls = new Set<string>();
  expectArray(rules.archive, "raffle.rules.archive").forEach((item, index) => {
    const archive = expectRecord(item, `raffle.rules.archive.${index}`);
    expectExactKeys(archive, ["cycleLabel", "rulesUrl"], `raffle.rules.archive.${index}`);
    expectString(archive.cycleLabel, `raffle.rules.archive.${index}.cycleLabel`);
    const rulesUrl = expectString(archive.rulesUrl, `raffle.rules.archive.${index}.rulesUrl`);
    expectLocalRulesUrl(rulesUrl, `raffle.rules.archive.${index}.rulesUrl`);
    if (archivedRuleUrls.has(rulesUrl)) fail("archived raffle rule URLs must be unique");
    archivedRuleUrls.add(rulesUrl);
  });

  const versionByUrl = new Map<string, RaffleRuleVersion>();
  const activeRuleVersions: RaffleRuleVersion[] = [];
  expectArray(rules.versions, "raffle.rules.versions").forEach((item, index) => {
    const version = parseRuleVersion(item, `raffle.rules.versions.${index}`);
    if (versionByUrl.has(version.rulesUrl)) fail("raffle rule-version URLs must be unique");
    versionByUrl.set(version.rulesUrl, version);
    if (version.state === "active") activeRuleVersions.push(version);
  });

  for (const [index, item] of expectArray(rules.archive, "raffle.rules.archive").entries()) {
    const archive = expectRecord(item, `raffle.rules.archive.${index}`);
    const version = versionByUrl.get(String(archive.rulesUrl));
    if (!version || version.state !== "archived" || version.cycleLabel !== archive.cycleLabel) {
      fail("each rules archive link must resolve to matching reviewed archived content");
    }
  }
  for (const version of versionByUrl.values()) {
    if (version.state === "archived" && !archivedRuleUrls.has(version.rulesUrl)) {
      fail("each reviewed archived rule version must appear in the rules archive");
    }
  }

  if (publicView.cycleStatus === "inactive") {
    if (currentRulesState !== "inactive" || activeRuleVersions.length !== 0) {
      fail("inactive raffle must not expose active drawing rules");
    }
  } else {
    if (currentRulesState !== "active" || activeRuleVersions.length !== 1) {
      fail("an active raffle cycle requires exactly one reviewed active rule version");
    }
    if (activeRuleVersions[0].rulesUrl !== publicView.rulesUrl) {
      fail("the current rules URL must resolve to the reviewed active rule version");
    }
  }

  return value as RafflePageModel;
}

export function parseRafflePublicView(value: unknown): RafflePublicView {
  const view = expectRecord(value, "raffle.publicView");
  expectExactKeys(view, [
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
  ], "raffle.publicView");

  const cycleStatus = expectOneOf(
    view.cycleStatus,
    ["inactive", "scheduled", "open", "closed", "drawing", "results", "paused"],
    "raffle.publicView.cycleStatus",
  );
  const standardEntryStatus = expectOneOf(view.standardEntryStatus, ["closed", "open"], "raffle.publicView.standardEntryStatus");
  const bonusEntryStatus = expectOneOf(view.bonusEntryStatus, ["closed", "open"], "raffle.publicView.bonusEntryStatus");
  if (view.timezone !== "Asia/Singapore") fail("raffle.publicView.timezone must be Asia/Singapore");
  if (view.baseEntries !== 5 || view.maximumBonusEntries !== 5 || view.maximumEntries !== 10) {
    fail("raffle public entry limits must remain 5 standard, 5 bonus, and 10 total");
  }

  const opensAt = expectNullableUtcInstant(view.opensAt, "raffle.publicView.opensAt");
  const closesAt = expectNullableUtcInstant(view.closesAt, "raffle.publicView.closesAt");
  const drawAt = expectNullableUtcInstant(view.drawAt, "raffle.publicView.drawAt");
  const claimEndsAt = expectNullableUtcInstant(view.claimEndsAt, "raffle.publicView.claimEndsAt");
  expectNullableString(view.publicReward, "raffle.publicView.publicReward");
  const rulesUrl = expectNullableString(view.rulesUrl, "raffle.publicView.rulesUrl");
  if (rulesUrl !== null) expectLocalRulesUrl(rulesUrl, "raffle.publicView.rulesUrl");
  const entrantCount = expectNullableNonNegativeInteger(view.entrantCount, "raffle.publicView.entrantCount");
  const totalEntryCount = expectNullableNonNegativeInteger(view.totalEntryCount, "raffle.publicView.totalEntryCount");
  const publicResult = expectOneOf(view.publicResult, ["none", "winner_confirmed"], "raffle.publicView.publicResult");

  const cycleDates = [opensAt, closesAt, drawAt, claimEndsAt];
  const allDatesNull = cycleDates.every((date) => date === null);
  const allEntriesClosed = standardEntryStatus === "closed" && bonusEntryStatus === "closed";
  if (cycleStatus === "inactive") {
    if (!allDatesNull || view.publicReward !== null || rulesUrl !== null) fail("inactive raffle must not publish cycle-specific terms");
    if (!allEntriesClosed || publicResult !== "none") fail("inactive raffle must keep entries closed and publish no result");
    if (entrantCount !== null || totalEntryCount !== null) fail("inactive raffle must not publish aggregate counts");
  }
  if (cycleStatus !== "open" && !allEntriesClosed) {
    fail(`${cycleStatus} raffle must keep entries closed`);
  }
  if (cycleStatus === "open" && standardEntryStatus !== "open") fail("open raffle must accept standard entries");
  if (cycleStatus !== "inactive") {
    if (cycleDates.some((date) => date === null)) fail(`${cycleStatus} raffle requires all cycle dates`);
    if (view.publicReward === null || rulesUrl === null) fail(`${cycleStatus} raffle requires a public reward and immutable rules URL`);
    const [opens, closes, drawing, claimEnd] = cycleDates as [string, string, string, string];
    if (!(Date.parse(opens) < Date.parse(closes) && Date.parse(closes) < Date.parse(drawing) && Date.parse(drawing) < Date.parse(claimEnd))) {
      fail("raffle cycle dates must follow opensAt < closesAt < drawAt < claimEndsAt");
    }
  }
  if (cycleStatus === "results") {
    if (publicResult !== "winner_confirmed") fail("results state must publish the privacy-safe winner confirmation");
    if (entrantCount === null || totalEntryCount === null || entrantCount === 0 || totalEntryCount === 0) {
      fail("results state requires nonzero aggregate entrant and entry counts");
    }
    if (totalEntryCount < entrantCount * view.baseEntries || totalEntryCount > entrantCount * view.maximumEntries) {
      fail("results aggregate counts must respect five to ten entries per entrant");
    }
  } else {
    if (publicResult !== "none") fail("winner confirmation may appear only in results state");
    if (entrantCount !== null || totalEntryCount !== null) fail("aggregate counts may appear only in results state");
  }

  return value as RafflePublicView;
}

function parseResult(value: unknown, path: string): RafflePublicResult {
  const result = expectRecord(value, path);
  expectExactKeys(result, ["cycleLabel", "outcome", "publicLabel", "resultKey", "rewardLabel"], path);
  expectString(result.resultKey, `${path}.resultKey`);
  expectString(result.cycleLabel, `${path}.cycleLabel`);
  const outcome = expectOneOf(result.outcome, ["winner", "community-honor"], `${path}.outcome`);
  const expectedLabel = outcome === "winner" ? "Winner confirmed" : "Community honor confirmed";
  if (result.publicLabel !== expectedLabel) fail(`${path}.publicLabel must match its privacy-safe outcome label`);
  expectString(result.rewardLabel, `${path}.rewardLabel`);
  return value as RafflePublicResult;
}

function parsePublicEvidence(value: unknown): RafflePublicEvidence {
  const evidence = expectRecord(value, "raffle.results.publicEvidence");
  expectExactKeys(evidence, ["drawingAt", "ledgerCommitment", "methodVersion", "resultCommitment"], "raffle.results.publicEvidence");
  expectUtcInstant(evidence.drawingAt, "raffle.results.publicEvidence.drawingAt");
  expectString(evidence.methodVersion, "raffle.results.publicEvidence.methodVersion");
  for (const key of ["ledgerCommitment", "resultCommitment"] as const) {
    const commitment = expectString(evidence[key], `raffle.results.publicEvidence.${key}`);
    if (!/^[a-f0-9]{64}$/i.test(commitment)) fail(`${key} must be a SHA-256 commitment`);
  }
  return value as RafflePublicEvidence;
}

function parseRuleVersion(value: unknown, path: string): RaffleRuleVersion {
  const version = expectRecord(value, path);
  expectExactKeys(version, ["cycleLabel", "publishedAt", "rulesUrl", "sections", "slug", "state", "title"], path);
  const slug = expectString(version.slug, `${path}.slug`);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) fail(`${path}.slug must be a safe lowercase route segment`);
  const rulesUrl = expectString(version.rulesUrl, `${path}.rulesUrl`);
  if (rulesUrl !== `/raffle/rules/${slug}`) fail(`${path}.rulesUrl must match its reviewed rule-version slug`);
  expectString(version.cycleLabel, `${path}.cycleLabel`);
  expectOneOf(version.state, ["active", "archived"], `${path}.state`);
  expectString(version.title, `${path}.title`);
  expectUtcInstant(version.publishedAt, `${path}.publishedAt`);
  const sections = expectArray(version.sections, `${path}.sections`);
  if (sections.length === 0) fail(`${path}.sections must contain reviewed rule content`);
  sections.forEach((item, index) => {
    const sectionPath = `${path}.sections.${index}`;
    const section = expectRecord(item, sectionPath);
    expectExactKeys(section, ["heading", "items", "paragraphs"], sectionPath);
    expectString(section.heading, `${sectionPath}.heading`);
    const paragraphs = expectStringArray(section.paragraphs, `${sectionPath}.paragraphs`, 0);
    const items = expectStringArray(section.items, `${sectionPath}.items`, 0);
    if (paragraphs.length + items.length === 0) fail(`${sectionPath} must contain public rule text`);
  });
  return value as RaffleRuleVersion;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

function expectStringArray(value: unknown, path: string, minimum: number) {
  const items = expectArray(value, path);
  if (items.length < minimum) fail(`${path} must contain at least ${minimum} item${minimum === 1 ? "" : "s"}`);
  return items.map((item, index) => expectString(item, `${path}.${index}`));
}

function expectString(value: unknown, path: string) {
  if (typeof value !== "string" || !value.trim()) fail(`${path} must be a non-empty string`);
  return value.trim();
}

function expectOptionalString(value: unknown, path: string) {
  if (typeof value !== "string") fail(`${path} must be a string`);
  return value;
}

function expectNullableString(value: unknown, path: string) {
  if (value === null) return null;
  return expectString(value, path);
}

function expectNullableUtcInstant(value: unknown, path: string) {
  if (value === null) return null;
  return expectUtcInstant(value, path);
}

function expectUtcInstant(value: unknown, path: string) {
  const instant = expectString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(instant)) {
    fail(`${path} must be a valid UTC instant`);
  }
  const normalized = instant.endsWith(".000Z") || /\.\d{3}Z$/.test(instant)
    ? instant
    : instant.replace(/Z$/, ".000Z");
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) {
    fail(`${path} must be a valid UTC instant`);
  }
  return instant;
}

function expectLocalRulesUrl(value: string, path: string) {
  if (!/^\/raffle\/rules\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) {
    fail(`${path} must use one safe local /raffle/rules/<version> route`);
  }
  return value;
}

function expectNullableNonNegativeInteger(value: unknown, path: string) {
  if (value === null) return null;
  if (!Number.isInteger(value) || Number(value) < 0) fail(`${path} must be a non-negative integer or null`);
  return Number(value);
}

function expectOneOf<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail(`${path} must be one of ${allowed.join(", ")}`);
  return value as T[number];
}

function expectExactKeys(value: Record<string, unknown>, keys: string[], path: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${path} contains unexpected or missing fields`);
}

function fail(message: string): never {
  throw new Error(`Invalid raffle public model: ${message}`);
}
