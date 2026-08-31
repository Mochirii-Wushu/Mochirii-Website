import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const expected = {
  title: "Mōchirīī | Asia Pacific Where Winds Meet Guild",
  ogTitle: "Mōchirīī | Where Winds Meet Guild",
  subtitle: "Asia Pacific • Where Winds Meet Guild",
  description: "Mōchirīī is an Asia Pacific Where Winds Meet guild for casual players, group runs, events, raffles, guides, and member projects.",
  ogDescription: "Join an Asia Pacific guild for group runs, events, raffles, guides, and member projects.",
  spotlight: "Each month, members recognize one person for a specific contribution.",
  gatheringTitle: "Monthly Guild Gathering",
  gatheringDescription: "A monthly gathering where every member can discuss anything they'd like with the guild.",
  footer: "Mōchirīī is an Asia Pacific Where Winds Meet guild for casual players, guild events, and member projects.",
  heroIntro: "Mōchirīī is an Asia Pacific guild for casual Where Winds Meet players. We organize group runs, events, raffles, guides, and member projects.",
  heroFollowup: "Discord handles onboarding and event planning. The website keeps guild rules, ranks, leaders, updates, screenshots, social posts, and forums in one place.",
  join: "There is room in the guild for pretty Wanderers. We gather in Asia Pacific & players farther away are welcome when the ping works for them.",
  displayTimezone: "UTC+8",
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

function assertJsonEqual(label, actual, expectedValue) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expectedValue),
    `${label}: expected ${JSON.stringify(expectedValue)}, found ${JSON.stringify(actual)}.`,
  );
}

function assertInOrder(label, source, snippets) {
  let offset = -1;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, offset + 1);
    if (next < 0) {
      fail(`${label}: missing or out-of-order ${JSON.stringify(snippet)}.`);
      return;
    }
    offset = next;
  }
}

const home = readJson("apps/web/public/data/home.json");
const schedule = readJson("apps/web/public/data/guild-schedule.json");
const join = readJson("apps/web/public/data/join.json");
const events = readJson("apps/web/public/data/events.json");
const raffles = readJson("apps/web/public/data/raffles.json");
const recruitment = readJson("apps/web/public/data/recruitment.json");
const twills = readJson("apps/web/public/data/twills.json");

assert(home.hero?.subtitle === expected.subtitle, "home.hero.subtitle must match the approved APAC subtitle.");
assert(home.hero?.descriptor?.[0] === expected.heroIntro, "home.hero.descriptor[0] must match the approved APAC introduction.");
assert(home.hero?.descriptor?.[1] === expected.heroFollowup, "home.hero.descriptor[1] must match the approved Home introduction.");
assertJsonEqual("Home hero badges", home.hero?.badges, ["Cross-Platform", "Casual Play", "UTC+8 Events"]);
assert(home.copy?.spotlightIntro === expected.spotlight, "home Spotlight text must match the approved copy.");
assertJsonEqual("Home section introductions", home.copy, {
  bulletinIntro: "Check the next event, current raffle, and latest announcement.",
  doorsIntro: "Use these pages to join the guild, review ranks, find leaders, and read the rules.",
  spotlightIntro: expected.spotlight,
  galleryIntro: "Recent screenshots from combat, exploration, events, and member gatherings.",
});
assert(home.seal?.title === "Guild Standards", "Home seal title must be Guild Standards.");
assert(home.seal?.imageAlt === "Mōchirīī guild seal", "Home seal alt text must identify the guild seal.");
assertJsonEqual("Home Guild Standards", home.seal?.verse, [
  "Keep commitments.",
  "Share useful information.",
  "Offer help without pressure.",
  "Address problems directly.",
]);
assertJsonEqual("Home Guild Guide cards", home.tiles?.map(({ label, title, href }) => ({ label, title, href })), [
  { label: "Join Mōchirīī", title: "Read the joining steps and open the guild Discord.", href: "./join.html" },
  { label: "Guild Ranks", title: "See each rank and how recognition works.", href: "./ranks.html" },
  { label: "Guild Leaders", title: "Find the right leader for questions or concerns.", href: "./leaders.html" },
  { label: "Guild Tome", title: "Read the rules for conduct, events, and recognition.", href: "./tome.html" },
]);
assert(home.spotlight?.tag === "Current Spotlight", "Home Spotlight tag must match the approved copy.");
assert(["open", "limited", "paused"].includes(recruitment.meta?.status), "the canonical recruitment state must be open, limited, or paused.");
const currentRecognition = home.spotlight?.recognitions?.find((item) => item.monthKey === "2026-08-01");
assert(currentRecognition?.summary === "Recognized for helping members and contributing to guild activities.", "the current Home recognition must bind the approved contribution copy.");
assert(!Object.hasOwn(currentRecognition || {}, "memberName"), "Home recognition data must not persist a member display name.");
assert(schedule.timezone?.label === "UTC+8", "the Discord-facing schedule label must remain UTC+8.");
assert(schedule.timezone?.offsetMinutes === 480, "the schedule offset must remain 480 minutes.");
assert(schedule.timezone?.ianaZone === "Asia/Singapore", "the schedule IANA zone must be Asia/Singapore.");
assert(schedule.timezone?.displayLabel === expected.displayTimezone, "the website timezone label must remain UTC+8.");
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
assert(raffles.publicView?.timezone === "Asia/Singapore", "the Raffle page must retain Asia/Singapore as its internal IANA calculation zone.");
assert(raffles.publicView?.standardEntryStatus === "closed", "the Raffle page must keep standard entries closed while inactive.");
assert(raffles.publicView?.bonusEntryStatus === "closed", "the Raffle page must keep bonus entries closed while inactive.");
assert(raffles.standingPrinciples?.includes("UTC+8 governs each drawing."), "the Raffle page must use the public UTC+8 label.");
assert(twills.profile?.timezone === expected.displayTimezone, "the public Twills profile must use the UTC+8 label.");

const raffleDateTime = read("apps/web/components/public-pages/RaffleDateTime.tsx");
const rafflePage = read("apps/web/components/public-pages/route-pages/RafflePage.tsx");
assertIncludes("Raffle date/time", raffleDateTime, "{singaporeTime} UTC+8");
assert(!raffleDateTime.includes("Singapore time"), "the Raffle date/time component must not render a location-specific timezone label.");
assertIncludes("Raffle page", rafflePage, 'items={[model.meta.frequency, "UTC+8"]}');

const siteMetadata = read("apps/web/lib/site-metadata.ts");
assertIncludes("site metadata", siteMetadata, "SITE_TITLE = `${BRAND_NAMES.publicGuild} | Asia Pacific Where Winds Meet Guild`");
assertIncludes("site metadata", siteMetadata, `SITE_DESCRIPTION =\n  ${JSON.stringify(expected.description)}`);
assertIncludes("site metadata", siteMetadata, "SITE_OG_TITLE = `${BRAND_NAMES.publicGuild} | Where Winds Meet Guild`");
assertIncludes("site metadata", siteMetadata, `SITE_OG_DESCRIPTION =\n  ${JSON.stringify(expected.ogDescription)}`);
assertIncludes("site metadata", siteMetadata, 'SITE_LANGUAGE = "en-SG"');
assertIncludes("site metadata", siteMetadata, 'SITE_OG_LOCALE = "en_SG"');

const layout = read("apps/web/app/layout.tsx");
assertIncludes("Next layout", layout, "description: SITE_DESCRIPTION");
assertIncludes("Next layout", layout, "title: SITE_OG_TITLE");
assertIncludes("Next layout", layout, "description: SITE_OG_DESCRIPTION");
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
assertIncludes("Next Home recruitment state", homePage, "recruitmentPresentation(recruitmentData.meta.status)");
assertIncludes("Next Home recognition", homePage, "spotlightRecognition(spotlight, winner)");
for (const snippet of [
  'if (state === "open") return { badge: "Recruitment Open", paused: false };',
  'if (state === "limited") return { badge: "Limited Recruitment", paused: false };',
  'return { badge: "Recruitment Paused", paused: true };',
  "View Recruitment Status",
  'href="/recruitment"',
  "Join on Discord",
  "Read the Joining Guide",
  'alt=""',
  'label: "Next Event"',
  'cta: "View All Events"',
  'label: "Raffle Status"',
  'title: "No raffle is open."',
  'cta: "View Raffle History"',
  'label: "Latest Announcement"',
  'cta: "View All Announcements"',
  "View Guild Gallery",
]) assertIncludes("Next Home exact presentation", homePage, snippet);
assertInOrder("Next Home section order", homePage, [
  'aria-label="Guild bulletin"',
  'aria-label="Guild guide"',
  'aria-label="Guild standards"',
  'aria-label="Member spotlight"',
  'aria-label="Guild gallery"',
]);

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

const publicDateHelper = read("apps/web/lib/public-date.ts");
assertIncludes("public date helper", publicDateHelper, '"Jul", "Aug", "Sep", "Oct"');
assertIncludes("public date helper", publicDateHelper, "formatToParts(date)");
assertIncludes("public date helper", publicDateHelper, "`${day} ${PUBLIC_MONTH_ABBREVIATIONS[month - 1]} ${year}`");
const privacyPage = read("apps/web/components/public-pages/route-pages/PrivacyPage.tsx");
const deletionPage = read("apps/web/components/public-pages/route-pages/MetaDataDeletionPage.tsx");
assertIncludes("Privacy public date", privacyPage, '>30 Aug 2026</time>');
assertIncludes("Data Deletion public date", deletionPage, '>13 Aug 2026</time>');
const memberFormat = read("apps/web/components/member-workflow/format.ts");
assertIncludes("member public date", memberFormat, "formatPublicDate(date, timeZone)");
assertIncludes("member public date-time", memberFormat, "formatPublicDateTime(date, timeZone)");
assert(!memberFormat.includes("toLocaleDateString") && !memberFormat.includes("toLocaleString"),
  "member-visible dates must use the exact public date formatter.");

if (failures.length) {
  console.error("APAC content contract failed:\n");
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log("APAC content contract passed for the canonical Next surface.");
