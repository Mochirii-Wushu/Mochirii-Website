import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import {
  canonicalizeProductionFlightResourceEnvelopeStream as canonicalize,
  productionDocumentPolicyMatches,
  productionDocumentProfileMatches,
} from "./check-production.mjs";

// Expose private pure functions in memory only; production exports stay unchanged.
const checkerUrl = new URL("./check-production.mjs", import.meta.url);
const privateTestSource = readFileSync(checkerUrl, "utf8")
  .replaceAll("import.meta.url", JSON.stringify(checkerUrl.href))
  + "\nexport {canonicalizeProductionFlightResourceEnvelopeStreamWithProfile, productionDocumentPolicyForFlight, PRODUCTION_DOCUMENT_POLICIES, productionDocumentDigestMatches, PREVIEW4_DOCUMENT_SEALS, PREVIEW4_VISUAL_REVISION_SEALS, PREVIEW4_NATIVE_DELIVERY_SEALS, PREVIEW4_NATIVE_DELIVERY_SCHEDULE_SHA256, canonicalizeSealedPresentationDocument};\n";
const {
  canonicalizeProductionFlightResourceEnvelopeStreamWithProfile: normalizeWithProfile,
  productionDocumentPolicyForFlight: selectPolicy,
  PRODUCTION_DOCUMENT_POLICIES: productionPolicies,
  productionDocumentDigestMatches: digestMatches,
  PREVIEW4_DOCUMENT_SEALS: preview4OriginalSeals,
  PREVIEW4_VISUAL_REVISION_SEALS: preview4VisualRevisionSeals,
  PREVIEW4_NATIVE_DELIVERY_SEALS: preview4NativeDeliverySeals,
  PREVIEW4_NATIVE_DELIVERY_SCHEDULE_SHA256: nativeScheduleSha256,
  canonicalizeSealedPresentationDocument,
} = await import("data:text/javascript;base64," + Buffer.from(privateTestSource).toString("base64"));

// Typed synthetic fixtures model the exact graphs independently observed in clean
// source SSR oracles. They are validator tests, not retained hosted evidence.
const profiles = {
  "base-slow": { main: "15", spotlight: "1c", title: "1e", gallery: "1d", galleryImport: "1f", cta: "20", event: null, icon: "11", terminal: ["20", "1e"] },
  base: { main: "14", spotlight: "1b", title: "1d", gallery: "1c", galleryImport: "1e", cta: "1f", event: null, icon: "20", terminal: ["d", "1f", "1d", "20", "b", "f"] },
  candidate: { main: "14", spotlight: "1a", title: "1c", gallery: "1b", galleryImport: "1d", cta: "1e", event: "15", icon: "1f", terminal: ["d", "1e", "1c", "1f", "b", "f"] },
  "candidate-slow": { main: "15", spotlight: "1b", title: "1d", gallery: "1c", galleryImport: "1e", cta: "1f", event: "16", icon: "11", terminal: ["1f", "1d"] },
};
const chunks = ["/_next/static/chunks/1coumcuouv5-a.js", "/_next/static/chunks/2_e1g0xtmhyam.js", "/_next/static/chunks/1s804miy6ex6j.js"];
const schedule = JSON.parse(readFileSync(new URL("../apps/web/public/data/guild-schedule.json", import.meta.url)));
const home = JSON.parse(readFileSync(new URL("../apps/web/public/data/home.json", import.meta.url)));
const cover = (value) => `${value}?v=${encodeURIComponent(schedule.discordCoverVersion)}`;
const publicSchedule = {
  timezone: schedule.timezone,
  monthly: Object.fromEntries(Object.entries(schedule.monthly).filter(([, item]) => item.id !== "monthly-raffle").map(([key, item]) => [key, {
    id: item.id, title: item.title, rule: item.rule, startDayOffset: item.startDayOffset ?? 0,
    startTime: item.startTime, endTime: item.endTime, location: item.location,
    description: item.description, discordCoverImage: cover(item.discordCoverImage),
  }])),
  weekly: schedule.weekly.filter((item) => item.discord === true).map((item) => ({
    id: item.id, title: item.title, days: item.days, dayText: item.dayText,
    startTime: item.startTime, endTime: item.endTime, location: item.location,
    summary: item.summary ?? "$undefined", href: item.href ?? "$undefined",
    discordCoverImage: cover(item.discordCoverImage), discord: true,
  })),
};
const element = (name, properties) => ["$", name, null, properties];
const contextFor = (clock) => ({ requestStartedAtMs: Date.parse(clock), responseReceivedAtMs: Date.parse(clock) });

function fixture({ profileName = "candidate-slow", clock = "2026-10-09T06:00:00.000Z", name = null,
  date = "4 Nov 2026 • UTC+8", recognition = false } = {}) {
  const profile = profiles[profileName];
  const title = name ?? "Member Spotlight";
  const summary = recognition ? home.spotlight.recognitions[0].summary : home.spotlight.summary;
  const intro = recognition ? home.copy.spotlightIntro : home.spotlight.fallbackIntro;
  const open = name === null ? "Open the Member Spotlight" : `Open ${name}’s Member Spotlight`;
  const spotlight = element("section", {
    className: "glass-card glass-card--primary glass-pad u-mt-24", "aria-label": "Member spotlight", children: [
      element("h2", { className: "section-title", children: "Member Spotlight" }),
      element("p", { className: "muted", id: "spotlightIntro", children: intro }),
      element("div", { id: "spotlightCard", className: "home-spotlight", role: "group",
        "aria-label": `Member spotlight - ${title} - ${summary}`, children: [
          element("$L6", { id: "spotlightImage", src: "/assets/img/featured/spotlight.webp",
            alt: name === null ? "Member Spotlight cover" : `Member Spotlight cover for ${name}`,
            className: "home-spotlight__img", width: 1536, height: 1024,
            sizes: "(max-width: 1232px) calc(100vw - 68px), 1120px", style: "$undefined", loading: "lazy", fetchPriority: "$undefined" }),
          element("div", { className: "home-spotlight__scrim", "aria-hidden": "true" }),
          element("$L7", { className: "home-spotlight__surface-link", href: "/spotlight", "aria-label": open,
            children: element("span", { className: "sr-only", children: open }) }),
          element("div", { className: "home-spotlight__plate", children: [
            element("span", { id: "spotlightTag", className: "home-pill", children: "Current Spotlight" }),
            element("h3", { id: "spotlightTitle", className: "home-title", children: "$L" + profile.title }),
            element("p", { id: "spotlightSummary", className: "home-summary", children: summary }),
            element("span", { className: "home-link", "aria-hidden": "true",
              children: name === null ? "Read the Member Spotlight" : `Read ${name}’s Spotlight` }),
          ] }),
        ] }),
    ],
  });
  const event = profile.event === null ? null : element("$L" + profile.event, {
    referenceTime: clock, scheduleData: publicSchedule,
    children: element("span", { className: "home-link", children: "View All Events" }),
  });
  const featured = profile.event === null
    ? element("a", { id: "featuredBulletin", className: "home-featured", href: "/events", "aria-label": "View Monthly Guild Gathering details", children: [
      element("img", { src: "/assets/img/bulletins/featured.webp", alt: "Guild meeting bulletin cover" }),
      element("div", { className: "home-featured__scrim" }),
      element("div", { className: "home-featured__meta", children: [
        element("span", { id: "featuredBulletinType", className: "home-pill", children: "Next Event" }),
        element("span", { id: "featuredBulletinDate", className: "home-date", children: date }),
      ] }), element("div", { className: "home-featured__plate" }),
    ] })
    : element("$L7", { id: "featuredBulletin", className: "home-featured", href: "/events", children: [
      element("img", { src: "/assets/img/bulletins/featured.webp", alt: "Guild meeting bulletin cover" }),
      element("div", { className: "home-featured__scrim" }), event,
    ] });
  const root = { P: null, c: [], q: "", i: false, f: ["$L8", "$Ld", "$Lf", "$@b"], m: "",
    G: [], S: false, h: null, r: "", s: "", a: "", l: "", p: "", d: "", b: "0123456789abcdefghijk" };
  const rows = new Map([
    ["6", "I" + JSON.stringify([57153, chunks, "Image"])],
    ["7", "I" + JSON.stringify([7575, chunks, ""])],
    ["0", JSON.stringify(root)], ["d", "[]"], ["b", "null"],
    ["f", JSON.stringify([["$", "$L" + profile.icon, "19", {}]])],
    [profile.icon, "I" + JSON.stringify([60329, chunks.slice(0, 2), "IconMark"])],
    ["8", JSON.stringify(element("div", { children: "$L" + profile.main }))],
    [profile.main, JSON.stringify(element("main", { id: "main", children: [featured, "$L" + profile.spotlight, "$L" + profile.gallery] }))],
    [profile.galleryImport, "I" + JSON.stringify([24555, chunks, "HomeGallerySpotlight"])],
    [profile.spotlight, JSON.stringify(spotlight)],
    [profile.gallery, JSON.stringify(element("section", { children: ["$L" + profile.galleryImport, "$L" + profile.cta] }))],
    [profile.cta, JSON.stringify(element("$L7", { className: "hero-cta home-section-cta", href: "/gallery", children: "View Guild Gallery" }))],
    [profile.title, JSON.stringify(title.startsWith("$") ? "$" + title : title)],
  ]);
  if (profile.event !== null) rows.set(profile.event, "I" + JSON.stringify([94654, chunks, "HomeNextEvent"]));
  const prefix = ["6", "7", "0", ...(profile.icon === "11" ? ["d", profile.icon, "b", "f"] : []),
    "8", ...(profile.event === null ? [] : [profile.event]), profile.main, profile.galleryImport, profile.spotlight, profile.gallery];
  return [...prefix, ...profile.terminal].map((id) => `${id}:${rows.get(id)}\n`).join("");
}

const normalize = (stream, clock = "2026-10-09T06:00:00.000Z", context = contextFor(clock)) =>
  canonicalize(stream, new Set(), null, null, true, context);
const change = (stream, before, after) => {
  assert(stream.includes(before), "mutant target exists");
  return stream.replace(before, after);
};

for (const profileName of Object.keys(profiles)) {
  test(`${profileName}: ordinary dates, names and year rollover keep the exact canonical envelope`, () => {
    const expected = normalize(fixture({ profileName }));
    assert.equal(typeof expected, "string");
    for (const name of [null, "Oracle Blossom", "心 星", "Member Spotlight", "$Mochi", "$$Mochi", "$L1c"]) {
      assert.equal(normalize(fixture({ profileName, name })), expected);
      const clock = "2026-12-31T16:00:00.123Z";
      assert.equal(normalize(fixture({ profileName, name, clock, date: "6 Jan 2027 • UTC+8" }), clock), expected);
    }
    const clock = "2026-08-20T06:00:00.000Z";
    assert.equal(normalize(fixture({ profileName, name: "August Lantern", clock,
      date: "2 Sep 2026 • UTC+8", recognition: true }), clock), expected);
  });

  test(`${profileName}: only consistent exact source fields are normalized`, () => {
    const stream = fixture({ profileName, name: "Oracle Blossom" });
    const expected = normalize(stream);
    const mutants = [
      ["Member Spotlight cover for Oracle Blossom", "Member Spotlight cover for Someone Else"],
      ["Open Oracle Blossom’s Member Spotlight", "Open Someone Else’s Member Spotlight"],
      ["Read Oracle Blossom’s Spotlight", "Read Someone Else’s Spotlight"],
      ["Member spotlight - Oracle Blossom - ", "Member spotlight - Someone Else - "],
      ["\"id\":\"spotlightImage\"", "\"id\":\"otherImage\""],
      ["\"className\":\"home-spotlight__surface-link\"", "\"className\":\"other-link\""],
      ["\"href\":\"/spotlight\"", "\"href\":\"/join\""],
      ["/assets/img/featured/spotlight.webp", "/assets/img/hero/hero.webp"],
      ["View Guild Gallery", "Changed unrelated text"],
      ["/_next/static/chunks/1coumcuouv5-a.js", "https://foreign.invalid/active.js"],
      ["[57153,", "[57154,"],
      ["\"Current Spotlight\"", "\"Changed tag\""],
      [JSON.stringify(home.spotlight.fallbackIntro), JSON.stringify(home.copy.spotlightIntro)],
      [JSON.stringify(home.spotlight.summary), JSON.stringify(home.spotlight.recognitions[0].summary)],
    ];
    for (const [before, after] of mutants) assert.notEqual(normalize(change(stream, before, after)), expected, before);
    for (const name of ["", " A", "A  B", "A\nB", "A\u202eB", "\ud800", "A".repeat(121)]) {
      assert.equal(normalize(fixture({ profileName, name })), null, JSON.stringify(name));
    }
    assert.equal(normalize(fixture({ profileName, name: "Oracle Blossom", recognition: true })), null);
    for (const name of ["$Mochi", "$$Mochi", "$L1c"]) {
      const escaped = fixture({ profileName, name });
      const rawTitle = `${profiles[profileName].title}:${JSON.stringify(name)}`;
      const escapedTitle = `${profiles[profileName].title}:${JSON.stringify("$" + name)}`;
      // Remove React's literal escape; raw marker/reference forms must fail closed.
      assert.equal(normalize(change(escaped, escapedTitle, rawTitle)), null, name);
    }
  });
}

test("legacy gathering normalization validates the exact source calendar and UTC+8 suffix", () => {
  const expected = normalize(fixture({ profileName: "base-slow" }));
  for (const [clock, date] of [
    ["2026-11-04T13:29:00.000Z", "4 Nov 2026 • UTC+8"],
    ["2026-11-04T13:30:00.000Z", "4 Nov 2026 • UTC+8"],
    ["2026-11-04T13:59:59.999Z", "4 Nov 2026 • UTC+8"],
    ["2026-11-04T14:00:00.000Z", "4 Nov 2026 • UTC+8"],
    ["2026-11-04T14:00:00.001Z", "4 Nov 2026 • UTC+8"],
    ["2026-11-05T06:00:00.000Z", "2 Dec 2026 • UTC+8"],
  ]) assert.equal(normalize(fixture({ profileName: "base-slow", clock, date }), clock), expected);
  // Preserve the deployed legacy helper's date-only behavior; scheduling fixes
  // have separate end-exclusive tests and are not redefined by this validator.
  for (const date of ["31 Nov 2026 • UTC+8", "5 Nov 2026 • UTC+8", "2 Dec 2026 • UTC+8", "4 Nov 2026 • UTC", "04 Nov 2026 • UTC+8"]) {
    assert.equal(normalize(fixture({ profileName: "base-slow", date })), null, date);
  }
});

test("candidate timestamps require exact component identity, freshness and unchanged source schedule", () => {
  const stream = fixture();
  const expected = normalize(stream);
  for (const [before, after] of [
    ["2026-10-09T06:00:00.000Z", "2026-10-09T06:00:00Z"],
    ["2026-10-09T06:00:00.000Z", "2026-10-09T14:00:00.000+08:00"],
    ["2026-10-09T06:00:00.000Z", "2026-02-30T06:00:00.000Z"],
    ["2026-10-09T06:00:00.000Z", "2026-10-09T05:54:59.999Z"],
    ["2026-10-09T06:00:00.000Z", "2026-10-09T06:05:00.001Z"],
    ["[94654,", "[94655,"], ["\"HomeNextEvent\"", "\"OtherComponent\""],
    ["\"startTime\":\"00:00\"", "\"startTime\":\"00:01\""],
    ["2026-10-09-uniform-covers", "unreviewed-cover-version"],
    ["\"title\":\"Monthly Guild Gathering\"", "\"title\":\"Changed Gathering\""],
    ["\"offsetMinutes\":480", "\"offsetMinutes\":0"],
    ["View All Events", "Changed CTA"],
    ["\"referenceTime\":", "\"otherTime\":"],
    ["\"referenceTime\":", "\"onClick\":\"attack\",\"referenceTime\":"],
  ]) assert.notEqual(normalize(change(stream, before, after)), expected, before);
  for (const context of [{}, null, [], { ...contextFor("2026-10-09T06:00:00.000Z"), extra: true },
    { requestStartedAtMs: NaN, responseReceivedAtMs: 0 }, { requestStartedAtMs: 5, responseReceivedAtMs: 4 },
    { requestStartedAtMs: 0, responseReceivedAtMs: 94_000 },
    { requestStartedAtMs: 8_640_000_000_000_000 - 300_000,
      responseReceivedAtMs: 8_640_000_000_000_000 - 300_000 }]) {
    assert.equal(normalize(stream, undefined, context), null);
  }
});

test("source normalization does not remove duplicate keys, scripts or hidden extra references", () => {
  const stream = fixture({ name: "Oracle Blossom" });
  const expected = normalize(stream);
  for (const [before, after] of [
    ["\"referenceTime\":", "\"referenceTime\":\"2026-10-09T06:00:00.000Z\",\"referenceTime\":"],
    ["\"id\":\"spotlightTitle\"", "\"id\":\"spotlightTitle\",\"id\":\"other\""],
    ["\"c\":[]", "\"c\":[\"$L1d\"]"],
    ["\"children\":\"Current Spotlight\"", "\"children\":[\"$\",\"script\",null,{\"src\":\"https://foreign.invalid/active.js\"}]"],
    ["\"href\":\"/gallery\"", "\"href\":\"javascript:attack()\""],
  ]) assert.notEqual(normalize(change(stream, before, after)), expected, before);
});

test("only completed exact source graphs select their named policy and never another group", () => {
  const policies = { home: { tag: "legacy" }, homeSourceBase: { tag: "base" },
    homeSourceCandidate: { tag: "candidate" }, privacy: { tag: "privacy" } };
  const context = contextFor("2026-10-09T06:00:00.000Z");
  for (const profileName of Object.keys(profiles)) {
    const stream = fixture({ profileName });
    const result = normalizeWithProfile(stream, new Set(), null, null, true, context);
    const tag = profileName.startsWith("base") ? "base" : "candidate";
    assert(Object.isFrozen(result));
    assert.deepEqual(Object.keys(result), ["stream", "homeSourceProfile"]);
    assert.equal(result.stream, normalize(stream));
    assert.equal(result.homeSourceProfile, tag);
    assert.equal(selectPolicy(policies, "home", result, context), policies[tag === "base" ? "homeSourceBase" : "homeSourceCandidate"]);
    assert.equal(selectPolicy({ home: policies.home }, "home", result, context), null);
    assert.equal(selectPolicy(tag === "base" ? { homeSourceCandidate: policies.homeSourceCandidate }
      : { homeSourceBase: policies.homeSourceBase }, "home", result, context), null);
    assert.equal(selectPolicy(policies, "privacy", result, context), null);
    assert.equal(selectPolicy(policies, "home", result, null), null);
    assert.equal(normalizeWithProfile(change(stream, "View Guild Gallery", "Changed CTA"), new Set(), null, null, true, context), null);
  }
  const nonHome = normalizeWithProfile(fixture(), new Set());
  assert.equal(nonHome.homeSourceProfile, null);
  assert.equal(selectPolicy(policies, "privacy", nonHome, null), policies.privacy);
  for (const malformed of [null, [], {}, { stream: "", homeSourceProfile: "other" },
    { stream: 1, homeSourceProfile: "base" }, { stream: "", homeSourceProfile: "base", extra: true },
    { stream: "", homeSourceProfile: undefined }, { homeSourceProfile: null }]) {
    assert.equal(selectPolicy(policies, "home", malformed, context), null);
  }
});

test("source-derived policies retain exact header and source-group pairings", () => {
  const header = "411005B83187566BA48384F5D5211FDCA5D4A3932C9F1E1CAE8AE44B7A550B78";
  const groups = {
    homeSourceBase: [
      "4A456AB1D8724B8ACF26D8BF6986D0F99FD2634BAA2572EBAB1F50E326E2ED17",
      "243C5A063D8A5FF748C2F0F0538921A748B2483E242752B2B7B28AA198CFAAF8",
    ],
    homeSourceCandidate: [
      "290C6C1BA3155B0BCB02004041542B4DD902917F67D98CF205A7FDA9EA28DF50",
      "919C798D3CC0111622D550FD2D11DC3A8BDA9F29FF25455C1C655B4C5A471D10",
    ],
  };
  for (const [group, digests] of Object.entries(groups)) {
    for (const digest of digests) {
      assert.equal(productionDocumentPolicyMatches(productionPolicies[group], header, digest), true);
      assert.equal(productionDocumentPolicyMatches(productionPolicies[group], "0".repeat(64), digest), false);
      assert.equal(productionDocumentProfileMatches(group, header, digest), false);
      assert.equal(productionDocumentProfileMatches("home", header, digest), false);
      const other = group === "homeSourceBase" ? "homeSourceCandidate" : "homeSourceBase";
      assert.equal(productionDocumentPolicyMatches(productionPolicies[other], header, digest), false);
    }
  }
  assert.equal(productionDocumentProfileMatches("home", header,
    "B4407357814ABF98CE52EDA66D0A472824DFBCBCD50FCFC902405D6262281761"), true);
  assert.equal(productionDocumentProfileMatches("home",
    "675E803BB871598DAD4CE0D1A3A64CB1ED1D30FB7616932CEA63CF25A98530F0",
    "3ED2476C6AE21876EADBE86B73FE0615C8FB8E1350C5E8CD9C8B34EF5B971820"), true);
});

test("the P4 visual revision has a separate closed seal and retains both original presentation seals", () => {
  const original = [
    "A47C773806F6FCF187AC1B96A2E5C59559B05DF6AF72FCE0AF084E0D9D365A57",
    "A6005D2BED585E619AD6FB54FC8DD3175284B61C75B8B509CE9E21355D7A4851",
  ];
  const revision = "6C3955B2F9C6D178E9A85A2C9B978D819681B568D0747FF1FBEC809CE23678FF";
  assert.deepEqual(preview4OriginalSeals, { home: original });
  assert.deepEqual(preview4VisualRevisionSeals, { home: revision });
  assert.ok(Object.isFrozen(preview4OriginalSeals));
  assert.ok(Object.isFrozen(preview4OriginalSeals.home));
  assert.ok(Object.isFrozen(preview4VisualRevisionSeals));
  for (const digest of original) {
    assert.equal(digestMatches(preview4OriginalSeals.home, digest), true);
    assert.equal(digestMatches(preview4VisualRevisionSeals.home, digest), false);
  }
  assert.equal(digestMatches(preview4VisualRevisionSeals.home, revision), true);
  assert.equal(digestMatches(preview4OriginalSeals.home, revision), false);
  assert.equal(digestMatches(preview4VisualRevisionSeals.home, "0".repeat(64)), false);
});

test("separate P4 profiles do not enlarge the two-digest or two-policy rejection bounds", () => {
  const combined = [...preview4OriginalSeals.home, preview4VisualRevisionSeals.home];
  for (const digest of combined) assert.equal(digestMatches(combined, digest), false);
  assert.equal(digestMatches([], combined[0]), false);
  assert.equal(digestMatches([combined[0], combined[0]], combined[0]), false);
  for (const invalid of [combined[0].toLowerCase(), combined[0].slice(1), combined[0] + " "]) {
    assert.equal(digestMatches(invalid, invalid), false);
  }
  const header = "A".repeat(64), resources = "B".repeat(64);
  const pair = { header, resources };
  assert.equal(productionDocumentPolicyMatches({ variants: [pair, pair] }, header, resources), true);
  assert.equal(productionDocumentPolicyMatches({ variants: [pair, pair, pair] }, header, resources), false);
});

// These small synthetic documents exercise the canonicalizer independently of
// the complete captured-source seal. They never qualify as a sealed document.
const rootRelativePublicSchedule = structuredClone(publicSchedule);
for (const item of [...Object.values(rootRelativePublicSchedule.monthly), ...rootRelativePublicSchedule.weekly]) {
  item.discordCoverImage = item.discordCoverImage.replace(/^\.\//, "/");
}
const nativeClock = "2026-10-27T03:25:39.292Z";
const hash = value => createHash("sha256").update(value).digest("hex").toUpperCase();
const htmlEscape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const backgroundCandidates = [640, 828, 1080, 1200, 1536]
  .map(width => `/assets/home/background/wuxia-bg-${width}.webp ${width}w`).join(", ");
const scheduleHelpers = createRequire(import.meta.url)("../apps/web/lib/guild-schedule.ts");
const {formatPublicDate} = createRequire(import.meta.url)("../apps/web/lib/public-date.ts");

function sealedHomeFixture({scheduleData = rootRelativePublicSchedule, clock = nativeClock} = {}) {
  const now = new Date(clock);
  const event = scheduleHelpers.currentOrUpcomingEvent(scheduleHelpers.websiteEventCardsFromSchedule(scheduleData, now), now);
  assert.ok(event);
  const summary = "Each month, one active website member is selected for the guild Spotlight.";
  const spotlight = element("div", {id: "spotlightCard", children: [
    element("h3", {id: "spotlightTitle", children: "Member Spotlight"}),
    element("p", {id: "spotlightSummary", children: summary}),
    element("a", {href: "/spotlight", "aria-label": "Open the Member Spotlight", children: "View Spotlight"}),
  ]});
  const root = {P: null, c: [], q: "", i: false, f: [element("$L1", {
    referenceTime: clock, scheduleData, imageSizes: "740px", emptyState: null,
    children: element("span", {className: "home-link", children: "View event"}),
  }), "$2"], m: "", G: [], S: false, h: null, r: "", s: "", a: "", l: "", p: "", d: "", b: "0123456789abcdefghijk"};
  const flight = `1:I${JSON.stringify([94654, chunks, "HomeNextEvent"])}\n0:${JSON.stringify(root)}\n2:${JSON.stringify(spotlight)}\n`;
  const cover = event.image.replace(/^\.\//, "/");
  const image = `/_next/image?url=${encodeURIComponent(cover)}&amp;w=640&amp;q=75`;
  const date = [formatPublicDate(new Date(event.date)), event.timeText, event.timezone].join(" • ");
  return '<!doctype html><html><head></head><body><div class="site-shell"><header class="site-header"></header>'
    + '<main id="main"><img class="bg-photo__image" srcset="' + backgroundCandidates + '" sizes="100vw" loading="eager" decoding="async" fetchpriority="low" src="/assets/bg/wuxia-bg.webp">'
    + '<img src="/assets/home/icons/arrow-right.svg" alt=""><a id="featuredBulletin" href="/events">'
    + '<span id="featuredBulletinType">' + (Date.parse(event.startIso) <= now.getTime() ? "Current Event" : "Next Event") + '</span>'
    + '<h3 id="featuredBulletinTitle">' + htmlEscape(event.title) + '</h3><p id="featuredBulletinDate">' + htmlEscape(date) + '</p>'
    + '<img id="featuredBulletinImage" src="' + image + '" srcset="' + image + ' 640w"></a>'
    + '<div id="spotlightCard"><h3 id="spotlightTitle">Member Spotlight</h3><p id="spotlightSummary">' + summary + '</p>'
    + '<a href="/spotlight" aria-label="Open the Member Spotlight">View Spotlight</a></div></main><footer></footer></div>'
    + '<script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push('
    + JSON.stringify([1, flight]).replaceAll("<", "\\u003c") + ')</script></body></html>';
}

const canonicalNative = (html, clock = nativeClock, seals = preview4NativeDeliverySeals) =>
  canonicalizeSealedPresentationDocument(html, "home", contextFor(clock), seals)?.canonical ?? null;

test("native Home delivery has one independent exact seal and identity-bound public projection", () => {
  const digest = "FAB5D9739AA93F30C29168DA8983556DB032CD1B211D0CA9AD4C3E78B902BEB8";
  assert.deepEqual(preview4NativeDeliverySeals, {home: digest});
  assert.ok(Object.isFrozen(preview4NativeDeliverySeals));
  assert.equal(hash(JSON.stringify(publicSchedule)), "F21C2A3EEE0AFC73327537CF36E8DFBE7F3A36176730D3889C2ABFBBD8F61EFD");
  assert.equal(hash(JSON.stringify(rootRelativePublicSchedule)), nativeScheduleSha256);
  assert.equal(nativeScheduleSha256, "63B52BE701306E728EEEDD729DDBAE60A5E2CA860B370F03582847B8FC3F8C60");
  assert.equal(rootRelativePublicSchedule.weekly[0].summary, "$undefined");
  assert.equal(rootRelativePublicSchedule.weekly[0].href, "$undefined");
  assert.equal(digestMatches(preview4NativeDeliverySeals.home, digest), true);
  for (const legacy of [...preview4OriginalSeals.home, preview4VisualRevisionSeals.home]) {
    assert.equal(digestMatches(preview4NativeDeliverySeals.home, legacy), false);
    assert.equal(digestMatches(legacy, digest), false);
  }
  const fixture = sealedHomeFixture();
  const canonical = canonicalNative(fixture);
  assert.equal(typeof canonical, "string");
  assert.equal(digestMatches(digest, hash(canonical)), false, "a synthetic document cannot claim the captured source seal");
  assert.equal(canonicalNative(fixture, nativeClock, preview4OriginalSeals), null);
  assert.equal(canonicalNative(fixture, nativeClock, {...preview4NativeDeliverySeals}), null);
  const legacyFixture = sealedHomeFixture({scheduleData: publicSchedule});
  assert.equal(typeof canonicalNative(legacyFixture, nativeClock, preview4OriginalSeals), "string");
  assert.equal(canonicalNative(legacyFixture), null);
  assert.equal(canonicalizeSealedPresentationDocument(fixture, "recruitment", contextFor(nativeClock), preview4NativeDeliverySeals), null);
  const combined = [...preview4OriginalSeals.home, preview4VisualRevisionSeals.home, digest];
  for (const candidate of combined) assert.equal(digestMatches(combined, candidate), false);
});

test("native Home schedule rejects version, private fields, sentinels and coherent schedule substitution", () => {
  const fixture = sealedHomeFixture();
  for (const mutate of [
    value => { value.monthly.gathering.discordCoverImage += "-other"; },
    value => { value.monthly.gathering.discordCoverImage = "." + value.monthly.gathering.discordCoverImage; },
    value => { value.monthly.gathering.discordCoverImage = "https://example.invalid/cover.png"; },
    value => { value.monthly.gathering.discordChannelId = "private-field"; },
    value => { value.weekly[0].summary = null; },
    value => { delete value.weekly[0].href; },
    value => { value.weekly[0].startTime = "20:00"; },
    value => { value.weekly[0].title = "Different event"; },
    value => { value.timezone.offsetMinutes = 0; },
  ]) {
    const scheduleData = structuredClone(rootRelativePublicSchedule);
    mutate(scheduleData);
    const changed = sealedHomeFixture({scheduleData});
    assert.notEqual(changed, fixture);
    assert.equal(canonicalNative(changed), null);
  }
});

test("native Home clock and calculated current/upcoming presentation remain bounded and consistent", () => {
  const fixture = sealedHomeFixture(), canonical = canonicalNative(fixture);
  for (const clock of ["2026-10-27T13:35:00.000Z", "2027-01-05T03:25:39.292Z"]) {
    assert.equal(canonicalNative(sealedHomeFixture({clock}), clock), canonical);
  }
  assert.equal(canonicalNative(fixture, "2000-01-01T00:00:00.000Z"), null);
  for (const [before, after] of [
    ['id="featuredBulletinTitle">Guild Party', 'id="featuredBulletinTitle">Different event'],
    ['id="featuredBulletinDate">27 Oct 2026', 'id="featuredBulletinDate">28 Oct 2026'],
    ['id="featuredBulletinType">Next Event', 'id="featuredBulletinType">Current Event'],
    [encodeURIComponent("/assets/img/discord-events/guild-party.png?v=2026-10-09-uniform-covers"), encodeURIComponent("/assets/img/discord-events/guild-wars.png?v=2026-10-09-uniform-covers")],
  ]) assert.equal(canonicalNative(change(fixture, before, after)), null);
});

test("native Home resource and unrelated graph changes never normalize into the same complete seal", () => {
  const fixture = sealedHomeFixture(), canonical = canonicalNative(fixture);
  for (const [before, after] of [
    ["wuxia-bg-640.webp 640w", "wuxia-bg-640.webp 641w"],
    ["wuxia-bg-828.webp", "wuxia-bg-other.webp"],
    ["wuxia-bg-1080.webp", "wuxia-bg-1080.webp?foreign=1"],
    ['sizes="100vw"', 'sizes="80vw"'],
    ['src="/assets/bg/wuxia-bg.webp"', 'src="/assets/bg/other.webp"'],
    ['loading="eager"', 'loading="lazy"'],
    ['fetchpriority="low"', 'fetchpriority="high"'],
    ['<header class="site-header">', '<header class="site-header" data-foreign="yes">'],
    ["View Spotlight", "Different destination text"],
    ["HomeNextEvent", "DifferentEvent"],
    ["1coumcuouv5-a.js", "different-source.js"],
  ]) {
    const changed = canonicalNative(change(fixture, before, after));
    assert.notEqual(changed, canonical, before);
    if (changed !== null) assert.equal(digestMatches(preview4NativeDeliverySeals.home, hash(changed)), false);
  }
});
