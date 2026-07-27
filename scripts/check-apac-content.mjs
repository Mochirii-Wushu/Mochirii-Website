import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const expected = {
  subtitle: "Asia Pacific • Where Winds Meet Guild",
  description: "Join Mōchirīī, an Asia Pacific Where Winds Meet guild full of yummy cupcakes for everyone & pretty people to share them all with.",
  spotlight: "Pretty guild member who's always so lovely, beautiful & keeping the guild a wonderful place for everyone.",
  gatheringTitle: "Monthly Guild Gathering",
  gatheringDescription: "A monthly gathering where every member can discuss anything they'd like with the guild.",
  footer: "An Asia Pacific Where Winds Meet guild, with events scheduled in Singapore Time (UTC+8).",
  join: "Mōchirīī welcomes all pretty new members across Asia Pacific or anywhere else in the world if you don't mind the ping.",
  displayTimezone: "Singapore Time (UTC+8)",
  brandSubtitle: "Asia Pacific Guild",
};

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertIncludes(label, source, snippet) {
  assert(source.includes(snippet), `${label}: missing ${JSON.stringify(snippet)}.`);
}

function assertCompactOccurrenceCount(label, source, snippet, expectedCount) {
  const compactSource = source.replace(/\s+/g, " ");
  const actualCount = compactSource.split(snippet).length - 1;
  assert(
    actualCount === expectedCount,
    `${label}: expected ${expectedCount} occurrences of ${JSON.stringify(snippet)}, found ${actualCount}.`,
  );
}

const home = readJson("apps/web/public/data/home.json");
const schedule = readJson("apps/web/public/data/guild-schedule.json");
const join = readJson("apps/web/public/data/join.json");
const events = readJson("apps/web/public/data/events.json");
const raffles = readJson("apps/web/public/data/raffles.json");

assert(home.hero?.subtitle === expected.subtitle, "home.hero.subtitle must match the approved APAC subtitle.");
assert(home.copy?.spotlightIntro === expected.spotlight, "home Spotlight text must match the approved copy.");
assert(schedule.timezone?.label === "UTC+8", "the Discord-facing schedule label must remain UTC+8.");
assert(schedule.timezone?.offsetMinutes === 480, "the schedule offset must remain 480 minutes.");
assert(schedule.timezone?.ianaZone === "Asia/Singapore", "the schedule IANA zone must be Asia/Singapore.");
assert(schedule.timezone?.displayLabel === expected.displayTimezone, "the website timezone label must remain Singapore Time (UTC+8).");
assert(schedule.monthly?.gathering?.title === expected.gatheringTitle, "the gathering title must match the approved copy.");
assert(schedule.monthly?.gathering?.description === expected.gatheringDescription, "the gathering description must match the approved copy.");

const homeGathering = home.bulletins?.find((item) => item.scheduleId === "monthly-gathering");
assert(homeGathering?.title === schedule.monthly?.gathering?.title, "the Home gathering fallback must exactly match the canonical schedule title.");
assert(join.hero?.intro === expected.join, "the Join line must match the approved copy.");
assert(join.hero?.timezone === expected.displayTimezone, "the Join page must use the website timezone label.");
assert(events.meta?.timezoneLabel === expected.displayTimezone, "the Events page must use the website timezone label.");
for (const item of events.upcoming || []) {
  assert(item.timezone === expected.displayTimezone, `events.${item.scheduleId || "unknown"}.timezone must use the website label.`);
}
assert(raffles.publicView?.cycleStatus === "inactive", "the Raffle page must remain inactive when no drawing is active.");
assert(raffles.publicView?.timezone === "Asia/Singapore", "the Raffle page must use Singapore as its authoritative time zone.");
assert(raffles.publicView?.standardEntryStatus === "closed", "the Raffle page must keep standard entries closed while inactive.");
assert(raffles.publicView?.bonusEntryStatus === "closed", "the Raffle page must keep bonus entries closed while inactive.");

const siteMetadata = read("apps/web/lib/site-metadata.ts");
assertIncludes("site metadata", siteMetadata, `SITE_DESCRIPTION =\n  ${JSON.stringify(expected.description)}`);
assertIncludes("site metadata", siteMetadata, 'SITE_LANGUAGE = "en-SG"');
assertIncludes("site metadata", siteMetadata, 'SITE_OG_LOCALE = "en_SG"');

const layout = read("apps/web/app/layout.tsx");
assertIncludes("Next layout", layout, "description: SITE_DESCRIPTION");
assertIncludes("Next layout", layout, "locale: SITE_OG_LOCALE");
assertIncludes("Next layout", layout, "<html lang={SITE_LANGUAGE}");

const pageMetadata = read("apps/web/components/public-pages/metadata.ts");
assertIncludes("page metadata", pageMetadata, "locale: SITE_OG_LOCALE");

const directMetadataFiles = [
  "apps/web/app/account/page.tsx",
  "apps/web/app/auth/page.tsx",
  "apps/web/app/gallery-submit/page.tsx",
  "apps/web/app/leader-dashboard/page.tsx",
];
for (const file of directMetadataFiles) {
  const source = read(file);
  assertIncludes(file, source, 'import { SITE_OG_LOCALE } from "@/lib/site-metadata"');
  assertIncludes(file, source, "locale: SITE_OG_LOCALE");
}

const homePage = read("apps/web/app/page.tsx");
assertIncludes("Next Home", homePage, "homeData.hero.subtitle");
assertIncludes("Next Home", homePage, 'id="home-structured-data"');
assertIncludes("Next Home", homePage, '"@type": "WebSite"');
assertIncludes("Next Home", homePage, '"@type": "Organization"');
assertIncludes("Next Home", homePage, 'sameAs: [SOCIAL_HOST]');
assertIncludes("Next Home", homePage, 'replace(/</g, "\\\\u003c")');

const footerComponent = read("apps/web/components/SiteFooter.tsx");
assertIncludes("Next footer", footerComponent, expected.footer);

const headerComponent = read("apps/web/components/SiteHeader.tsx");
const nextBrandLockup = `<span className="brand-text"> <span className="brand-name">Mōchirīī</span> <span className="brand-sub">${expected.brandSubtitle}</span>`;
assertCompactOccurrenceCount("Next header brand lockups", headerComponent, nextBrandLockup, 2);
assertCompactOccurrenceCount("Next footer brand lockup", footerComponent, nextBrandLockup, 1);
assert(!headerComponent.includes("Where Winds Meet Guild"), "the Next header brand must use the concise regional label.");

const scheduleHelper = read("apps/web/lib/guild-schedule.ts");
assertIncludes("schedule helper", scheduleHelper, 'new Intl.DateTimeFormat("en-SG"');
assertIncludes("schedule helper", scheduleHelper, "timeZone: scheduleIanaZone(schedule)");
assertIncludes("schedule helper", scheduleHelper, "schedule.timezone?.displayLabel || schedule.timezone?.label");
assertIncludes("schedule helper", scheduleHelper, "timezone,");

if (failures.length) {
  console.error("APAC content contract failed:\n");
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log("APAC content contract passed for the canonical Next surface.");
