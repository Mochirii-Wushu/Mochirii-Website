import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DISCORD_INVITE_URL, FORUMS_HOST, OFFICIAL_GUILD_PROFILES, SITE_ORIGIN, SOCIAL_HOST } from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];
const expectedOfficialGuildProfileUrls = [
  "https://www.facebook.com/mochiriiguild/",
  "https://www.instagram.com/mochirii_guild/",
  "https://www.tiktok.com/@mochiriiguild",
  "https://www.twitch.tv/mochiriiguild",
  "https://www.youtube.com/@MochiriiGuild",
];

const header = read("apps/web/components/SiteHeader.tsx");
const headerAuthState = read("apps/web/components/site-header/use-header-auth-state.ts");
const headerAuthRuntime = read("apps/web/components/site-header/header-auth-runtime.ts");
const headerNavigation = read("apps/web/components/site-header/header-navigation.tsx");
const spinnerViewerNavLink = read("apps/web/components/site-header/spinner-viewer-nav-link.tsx");
const homePage = read("apps/web/app/page.tsx");
const publicUrlsAdapter = read("apps/web/lib/public-urls.ts");
const publicUrlsScriptAdapter = read("scripts/lib/public-urls.mjs");
const navSource = read("apps/web/lib/site-navigation.ts");
const footer = read("apps/web/components/SiteFooter.tsx");
const ranksPage = read("apps/web/components/public-pages/route-pages/RanksPage.tsx");
const footerStyles = read("apps/web/app/styles/shell-footer.css");
const officialGuildProfiles = read("apps/web/components/OfficialGuildProfiles.tsx");
const discordServerPreview = read("apps/web/components/public-pages/DiscordServerPreview.tsx");
const eventsBoard = read("apps/web/components/public-pages/EventsBoard.tsx");
const eventsPage = read("apps/web/components/public-pages/route-pages/EventsPage.tsx");
const socialPanel = read("apps/web/components/member-workflow/SocialHubPanel.tsx");
const socialPage = read("apps/web/app/social/page.tsx");
const accountPanel = read("apps/web/components/member-workflow/AccountPanel.tsx");
const currentState = read("docs/current-live-state.md");
const runbook = read("docs/operations/integration-operations-runbook.md");
const privacyRoute = read("apps/web/app/privacy/page.tsx");
const deletionRoute = read("apps/web/app/meta-data-deletion/page.tsx");
const privacyPage = read("apps/web/components/public-pages/route-pages/PrivacyPage.tsx");
const deletionPage = read("apps/web/components/public-pages/route-pages/MetaDataDeletionPage.tsx");
const publicMetadata = read("apps/web/components/public-pages/metadata.ts");
const sitemap = read("apps/web/public/sitemap.xml");
const legalStyles = read("apps/web/app/styles/public-legal.css");
const discordInviteDataSources = [
  ["Join data", read("apps/web/public/data/join.json")],
  ["Events data", read("apps/web/public/data/events.json")],
  ["Guild schedule data", read("apps/web/public/data/guild-schedule.json")],
];

const navGroups = between(navSource, "export const navGroups", "export const publicUtilityLinks");
const publicUtilityLinks = between(navSource, "export const publicUtilityLinks", "export const accountWorkflowLinks");
const accountWorkflowLinks = between(navSource, "export const accountWorkflowLinks", "");
const retiredMembersRouteFiles = [
  "apps/web/app/members/page.tsx",
  "apps/web/app/members/[slug]/page.tsx",
  "apps/web/components/member-workflow/MemberDirectory.tsx",
];

const navGroupItems = extractItems(navGroups);
const publicItems = [...navGroupItems, ...extractItems(publicUtilityLinks)];
const accountItems = extractItems(accountWorkflowLinks);
const footerItems = extractItems(footer);

assertAdjacentLink("site navigation Guild order", navGroupItems, SOCIAL_HOST, "Social", FORUMS_HOST, "Forums");
assertAdjacentLink("SiteFooter Guild order", footerItems, SOCIAL_HOST, "Social", FORUMS_HOST, "Forums");

const forbiddenGroupHrefs = ["/members", "/social", "/gallery-submit", "/leader-dashboard", "/spinner"];

for (const href of forbiddenGroupHrefs) {
  if (navGroups.includes(`href: "${href}"`)) {
    failures.push(`SiteHeader navGroups must not expose workflow href ${href}; keep it under Account.`);
  }
}

assertIncludes("site navigation public URL config", navSource, `"@/lib/public-urls"`);
assertCount("Website Forums URL adapter", publicUrlsAdapter, "export const FORUMS_HOST = publicUrls.forumsHost;", 1);
assertCount("Website Forums URL export", publicUrlsAdapter, "export const FORUMS_HOST", 1);
assertCount("script Forums URL adapter", publicUrlsScriptAdapter, "export const FORUMS_HOST = publicUrls.forumsHost;", 1);
assertCount("script Forums URL export", publicUrlsScriptAdapter, "export const FORUMS_HOST", 1);
assertIncludes("site navigation dropdown Social", navGroups, `href: SOCIAL_HOST, label: "Social", nav: "social-host", external: true`);
assertIncludes("site navigation dropdown Forums", navGroups, `href: FORUMS_HOST, label: "Forums", nav: "forums-host", external: true`);
assertIncludes("site navigation dropdown Mochi Pets", navGroups, `href: "/games/mochi-pets", label: "Mochi Pets", nav: "games/mochi-pets"`);
assertIncludes("SiteHeader group auth filtering", header, ".filter((item) => !navItemHidden(item, authState))");
assertIncludes("SiteHeader deferred auth import", headerAuthState, 'import("./header-auth-runtime")');
assertIncludes("SiteHeader moderator probe", headerAuthRuntime, "checkLeaderGalleryModerationAccess");
assertIncludes("SiteHeader lazy moderator trigger", header, `void ensureModeratorAccess();`);
assertIncludes("SiteHeader mobile moderator trigger", header, "setMobileOpen(true)");
assertIncludes("SiteHeader official profiles", header, 'placement="header"');
assertIncludes("SiteHeader mobile official profiles", header, 'placement="mobile"');
assertIncludes("SiteHeader account controls", header, `aria-controls="nav-menu-account"`);
assertIncludes("SiteHeader account controls", header, `aria-haspopup="true"`);
assertIncludes("SiteHeader account controls", header, `aria-expanded={openGroup === "account"}`);
assertIncludes("SiteHeader moderator auth marker", headerNavigation, `"data-auth-moderator"`);
assertIncludes("SiteHeader spinner viewer auth marker", headerNavigation, `"data-auth-spinner-viewer"`);
assertIncludes("SiteHeader spinner viewer gate", header, `item.auth === "spinner-viewer"`);
assertIncludes("SiteHeader spinner viewer launcher", header, "<SpinnerViewerNavLink");
assertIncludes("SiteHeader Join CTA", header, `Join Mōchirīī <span className="cta-glint" aria-hidden="true" />`);
assertIncludes("SiteHeader Discord destination", header, "href={DISCORD_INVITE_URL}");
assertIncludes("deferred header exact spinner eligibility", headerAuthRuntime, "verifyMemberAccess");
assertIncludes("deferred header exact spinner eligibility", headerAuthRuntime, "memberAccess?.galleryEligible === true");
assertIncludes("deferred header exact spinner eligibility", headerAuthRuntime, 'memberAccess.memberStatus === "active"');
assertIncludes("spinner viewer link fail-closed render", spinnerViewerNavLink, "if (hidden) return null;");
assertIncludes("spinner viewer link session-first navigation", spinnerViewerNavLink, "const opened = await launchSpinnerViewer();");
assertIncludes("spinner viewer link session-first navigation", spinnerViewerNavLink, "if (opened) {");
assertIncludes("spinner viewer link session-first navigation", spinnerViewerNavLink, "window.location.assign(item.href);");

assertNotIncludes("SiteHeader public nav", publicUtilityLinks, `href: "/social", label: "Social"`);
assertNotIncludes("SiteHeader public utility Social", publicUtilityLinks, `href: SOCIAL_HOST, label: "Social"`);
assertNotIncludes("SiteHeader public utility Forums", publicUtilityLinks, `href: FORUMS_HOST, label: "Forums"`);
assertNotIncludes("SiteHeader account Members", accountWorkflowLinks, `href: "/members"`);
assertNotIncludes("SiteHeader account Social Status", accountWorkflowLinks, `href: "/social", label: "Social Status"`);
assertNotIncludes("SiteHeader account Mochi Pets", accountWorkflowLinks, `href: "/games/mochi-pets"`);
assertIncludes("SiteHeader account Spinner", accountWorkflowLinks, `href: "/spinner", label: "Watch Spinner", nav: "spinner", auth: "spinner-viewer"`);
assertNotIncludes("SiteHeader public Spinner", navGroups, `href: "/spinner"`);
assertNotIncludes("SiteHeader public utility Spinner", publicUtilityLinks, `href: "/spinner"`);

for (const file of retiredMembersRouteFiles) {
  if (existsSync(resolve(root, file))) failures.push(`${file}: retired members route surface must stay removed.`);
}

assertIncludes("SiteFooter public URL config", footer, `"@/lib/public-urls"`);
assertIncludes("SiteFooter Social", footer, `href: SOCIAL_HOST, label: "Social", external: true`);
assertIncludes("SiteFooter Forums", footer, `href: FORUMS_HOST, label: "Forums", external: true`);
assertIncludes("SiteFooter Mochi Pets", footer, `href: "/games/mochi-pets", label: "Mochi Pets"`);
assertIncludes("SiteFooter Join CTA", footer, `Join Mōchirīī<span className="footer-cta-glint" aria-hidden="true" />`);
assertIncludes("SiteFooter Discord destination", footer, "href={DISCORD_INVITE_URL}");
assertCount("SiteFooter Join CTA", footer, `Join Mōchirīī<span className="footer-cta-glint" aria-hidden="true" />`, 1);
assertIncludes("SiteFooter recruitment link", footer, [
  `                <Link className="footer-link" href="/recruitment">`,
  "                  Recruitment Note",
  "                </Link>",
].join("\n"));
assertCount("SiteFooter recruitment link", footer, `href="/recruitment"`, 1);
assertNotIncludes("SiteFooter retired recruitment label", footer, "Recruitment Tips");
assertIncludes("Home Discord destination", homePage, "href={DISCORD_INVITE_URL}");
assertIncludes("Account Discord destination", accountPanel, "href={DISCORD_INVITE_URL}");
assertIncludes("Join Discord destination", discordServerPreview, "href={DISCORD_INVITE_URL}");
assertIncludes("Events board Discord fallback", eventsBoard, "DISCORD_INVITE_URL");
assertIncludes("Events page Discord destination", eventsPage, "href={DISCORD_INVITE_URL}");
assertNotIncludes("SiteFooter", footer, "hidden:");
assertNotIncludes("SiteFooter", footer, "data-auth-");
assertNotIncludes("SiteFooter public Social", footer, `href: "/social", label: "Social"`);
assertNotIncludes("SiteFooter signed-out HTML", footer, `href="/spinner"`);
assertIncludes("SiteFooter authenticated Spinner", footer, "<SpinnerViewerNavLink");
assertIncludes("SiteFooter authenticated Spinner", footer, "hidden={!authState.spinnerViewer}");
assertIncludes("SiteFooter official profiles", footer, '<OfficialGuildProfiles placement="footer" />');
assertIncludes("SiteFooter legal navigation", footer, 'aria-label="Privacy and support"');
assertIncludes("SiteFooter Privacy", footer, '<Link href="/privacy">Privacy</Link>');
assertIncludes("SiteFooter Data Deletion", footer, '<Link href="/meta-data-deletion">Data Deletion</Link>');
assertIncludes("SiteFooter support", footer, '<a href="mailto:support@mochirii.com">support@mochirii.com</a>');
assertIncludes("SiteFooter legal target sizing", footerStyles, "min-height:48px");
assertIncludes("SiteFooter legal target width", footerStyles, "min-width:48px");
assertIncludes("SiteFooter legal keyboard focus", footerStyles, ".footer-legal a:focus-visible");
assertIncludes("Privacy route component", privacyRoute, 'import { PrivacyPage } from "@/components/public-pages/route-pages/PrivacyPage";');
assertIncludes("Privacy route metadata", privacyRoute, 'metadataFor("privacy")');
assertIncludes("Data Deletion route component", deletionRoute, 'import { MetaDataDeletionPage } from "@/components/public-pages/route-pages/MetaDataDeletionPage";');
assertIncludes("Data Deletion route metadata", deletionRoute, 'metadataFor("metaDataDeletion")');
assertIncludes("Privacy page scope", privacyPage, "This page summarizes information handled by the Mōchirīī website");
assertIncludes("Privacy page provider boundary", privacyPage, "does not describe every Mōchirīī service");
assertIncludes("Privacy page Gallery delivery fact", privacyPage, "delivered through bounded");
assertIncludes("Privacy page Gallery delivery fact", privacyPage, "public media URLs");
assertIncludes("Privacy page incomplete retention boundary", privacyPage, "does not establish one complete retention schedule");
assertIncludes("Privacy page support contact", privacyPage, 'const SUPPORT_EMAIL = "support@mochirii.com";');
assertIncludes("Data Deletion request scope", deletionPage, "review deletion of eligible website data it controls");
assertIncludes("Data Deletion provider boundary", deletionPage, "does not delete Facebook, Instagram, Discord, or other provider accounts");
assertIncludes("Data Deletion secret boundary", deletionPage, "Do not send a password, access token, recovery code, signed media URL, or identity document");
assertIncludes("Data Deletion operational boundary", deletionPage, "No automatic site-wide deletion, complete provider propagation, or response deadline is represented");
assertIncludes("Data Deletion request subject", deletionPage, 'const REQUEST_SUBJECT = "Mōchirīī data deletion request";');
assertIncludes("Privacy metadata canonical", publicMetadata, 'path: "/privacy"');
assertIncludes("Data Deletion metadata canonical", publicMetadata, 'path: "/meta-data-deletion"');
assertIncludes("Privacy sitemap entry", sitemap, `<loc>${SITE_ORIGIN}/privacy</loc>`);
assertIncludes("Data Deletion sitemap entry", sitemap, `<loc>${SITE_ORIGIN}/meta-data-deletion</loc>`);
assertIncludes("legal page responsive layout", legalStyles, "@media (max-width:760px)");
assertIncludes("Ranks leaders link", ranksPage, [
  `                      <Link href="/leaders" className="footer-link">`,
  "                        Meet the Leaders",
  "                      </Link>",
].join("\n"));
assertCount("Ranks leaders link", ranksPage, `<Link href="/leaders" className="footer-link">`, 1);
assertNotIncludes("Ranks retired home link", ranksPage, "<ReturnHomeLink");

checkForumsHost();
checkDiscordInvite();

const legalPageSource = `${privacyPage}\n${deletionPage}`;
for (const unsupportedClaim of [
  "Publishing currently disabled",
  "Automated Facebook and Instagram publishing",
  "will be cancelled atomically",
  "will be quarantined for moderator inspection",
  "metadata-stripped JPEG",
  "Supabase provides database",
  "Vercel delivers and measures",
  "private storage and temporary, time-limited URLs",
  "permanently deleted",
  "guaranteed reply",
  "monitored mailbox",
]) {
  assertNotIncludes("scoped privacy and deletion copy", legalPageSource, unsupportedClaim);
}
assertIncludes("official profile semantics", officialGuildProfiles, 'role="group"');
assertIncludes("official profile semantics", officialGuildProfiles, "Official Mōchirīī profiles in the Guild menu");
assertIncludes("official profile semantics", officialGuildProfiles, "Official Mōchirīī profiles in the mobile menu");
assertIncludes("official profile semantics", officialGuildProfiles, "Official Mōchirīī profiles in the footer");

if (JSON.stringify(OFFICIAL_GUILD_PROFILES.map((profile) => profile.href)) !== JSON.stringify(expectedOfficialGuildProfileUrls)) {
  failures.push("official guild channel URLs or handle choices do not match the reviewed candidate set.");
}
if (OFFICIAL_GUILD_PROFILES.some((profile) => /(?:^|\.)mochirii\.com\b/iu.test(new URL(profile.href).hostname))) {
  failures.push("official channel entries must stay provider-profile URLs.");
}
for (const staleDestination of [
  "https://www.facebook.com/mochiriiguildpage",
  "https://www.facebook.com/groups/mochiriiguild",
]) {
  if (OFFICIAL_GUILD_PROFILES.some((profile) => profile.href === staleDestination)) {
    failures.push(`retired profile destination remains configured: ${staleDestination}`);
  }
}

assertIncludes("SocialHubPanel public URL config", socialPanel, `"@/lib/public-urls"`);
assertIncludes("SocialHubPanel", socialPanel, `href={SOCIAL_HOST}`);
assertIncludes("SocialHubPanel", socialPanel, "Mōchirīī Social Access");
assertIncludes("SocialHubPanel redirect", socialPanel, "window.location.assign(SOCIAL_HOST)");
assertIncludes("SocialHubPanel signed-out copy", socialPanel, "Sign in to Mōchirīī before opening the guild social platform.");
assertNotIncludes("SocialHubPanel", socialPanel, "target=\"_blank\"");
assertNotIncludes("SocialHubPanel", socialPanel, "href={text(account?.profile_url)}");
assertNotIncludes("SocialHubPanel stale status query", socialPanel, "listMySocialAccounts");
assertIncludes("AccountPanel public URL config", accountPanel, `"@/lib/public-urls"`);
assertIncludes("AccountPanel", accountPanel, `href={SOCIAL_HOST}`);
assertNotIncludes("AccountPanel stale Social Status link", accountPanel, `href="/social">Social Status`);
assertNotIncludes("AccountPanel stale copy", accountPanel, "SSO compatibility gate passes");
assertNotIncludes("AccountPanel retired members link", accountPanel, `href={\`/members/`);
assertNotIncludes("AccountPanel retired publish title", accountPanel, "Published Page");
assertNotIncludes("AccountPanel retired profile media upload", accountPanel, "profile-media-upload");

assertIncludes("social page metadata", socialPage, "Mōchirīī Social Access");
assertIncludes("social page intro", socialPage, "Verified guild members can continue to the private guild social platform.");
assertIncludes("current live state", currentState, "public website information surface");
assertIncludes("integration runbook", runbook, "public information site");
assertIncludes("integration runbook Forums handoff", runbook, "Header and footer Forums links hand off directly to `https://forums.mochirii.com`");
assertIncludes("integration runbook Forums ownership", runbook, "the separate Forums repository and runtime remain the sole owners");

checkScenario("signed-out", { signedIn: false, activeMember: false, moderator: false, spinnerViewer: false });
checkScenario("signed-in", { signedIn: true, activeMember: false, moderator: false, spinnerViewer: false });
checkScenario("active-unverified", { signedIn: true, activeMember: true, moderator: false, spinnerViewer: false });
checkScenario("manual-approved-viewer", { signedIn: true, activeMember: false, moderator: false, spinnerViewer: true });
checkScenario("active-verified-viewer", { signedIn: true, activeMember: true, moderator: false, spinnerViewer: true });
checkScenario("moderator", { signedIn: true, activeMember: true, moderator: true, spinnerViewer: true });
checkFooter();

if (failures.length) {
  console.error("Site navigation check failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Site navigation OK.");
console.log("- Header Social, Forums, and the public Mochi Pets page live in the Guild dropdown.");
console.log("- Footer Social, Forums, and Mochi Pets links are public.");
console.log("- Ranks links to Leaders; Join and Recruitment labels match the approved copy.");
console.log("- All live Website Discord links use the canonical owner-approved invite.");
console.log("- Official profile surfaces pin the approved Facebook, Instagram, TikTok, Twitch, and YouTube URLs.");
console.log("- Watch Spinner appears only after exact active verified viewer authorization.");
console.log("- /social redirects signed-in members and keeps signed-out help.");

function read(file) {
  const full = resolve(root, file);
  if (!existsSync(full)) {
    failures.push(`${file}: missing required file.`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : text.length;
  if (start < 0 || end < 0) {
    failures.push(`Could not extract section ${startMarker} -> ${endMarker}.`);
    return "";
  }
  return text.slice(start, end);
}

function extractItems(source) {
  const items = [];
  const pattern = /\{\s*href:\s*(?:"([^"]+)"|([A-Z_]+)),\s*label:\s*"([^"]+)"(?<rest>[^}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    const href = match[1] || resolveConfiguredHref(match[2]);
    const rest = match.groups?.rest || "";
    items.push({
      href,
      label: match[3],
      nav: rest.match(/nav:\s*"([^"]+)"/)?.[1] || match[3].toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      auth: rest.match(/auth:\s*"([^"]+)"/)?.[1] || "",
      external: /external:\s*true/.test(rest),
    });
  }
  return items;
}

function resolveConfiguredHref(name) {
  if (name === "SOCIAL_HOST") return SOCIAL_HOST;
  if (name === "FORUMS_HOST") return FORUMS_HOST;
  return name;
}

function checkForumsHost() {
  if (FORUMS_HOST !== "https://forums.mochirii.com") {
    failures.push("Forums host must remain the exact approved service root.");
    return;
  }

  try {
    const url = new URL(FORUMS_HOST);
    if (url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash) {
      failures.push("Forums host must be a credential-free HTTPS origin with no path, query, or fragment.");
    }
  } catch {
    failures.push("Forums host must be a valid absolute HTTPS URL.");
  }
}

function checkDiscordInvite() {
  if (DISCORD_INVITE_URL !== "https://discord.com/invite/9HQKz6rqF4") {
    failures.push("Discord invite must remain the exact owner-approved destination.");
    return;
  }

  try {
    const url = new URL(DISCORD_INVITE_URL);
    if (url.protocol !== "https:"
      || url.hostname !== "discord.com"
      || url.pathname !== "/invite/9HQKz6rqF4"
      || url.username
      || url.password
      || url.search
      || url.hash) {
      failures.push("Discord invite must be the credential-free approved HTTPS invite URL.");
    }
  } catch {
    failures.push("Discord invite must be a valid absolute HTTPS URL.");
  }

  const invitePattern = /https:\/\/discord\.com\/invite\/[A-Za-z0-9]+/g;
  for (const [label, source] of discordInviteDataSources) {
    const links = source.match(invitePattern) || [];
    if (links.length === 0 || links.some((link) => link !== DISCORD_INVITE_URL)) {
      failures.push(`${label}: every Discord invite must use the canonical Website destination.`);
    }
  }
}

function visible(item, state) {
  if (item.auth === "signed-out") return !state.signedIn;
  if (item.auth === "signed-in") return state.signedIn;
  if (item.auth === "verified") return state.activeMember;
  if (item.auth === "moderator") return state.moderator;
  if (item.auth === "spinner-viewer") return state.spinnerViewer;
  return true;
}

function checkScenario(label, state) {
  const items = [...publicItems, ...(state.signedIn ? accountItems : [])].filter((item) => visible(item, state));
  checkDuplicates(`header ${label}`, items);

  const spinnerLinks = items.filter((item) => item.href === "/spinner");
  const expectedSpinnerLinks = state.signedIn && state.spinnerViewer ? 1 : 0;
  if (spinnerLinks.length !== expectedSpinnerLinks) {
    failures.push(`header ${label}: expected ${expectedSpinnerLinks} Spinner link, found ${spinnerLinks.length}.`);
  }

  if (state.signedIn && items.some((item) => item.href === "/social" && item.label === "Social")) {
    failures.push(`header ${label}: /social must be labelled Social Status, not Social.`);
  }

  if (!items.some((item) => item.href === SOCIAL_HOST && item.label === "Social" && item.external)) {
    failures.push(`header ${label}: expected public Social link to ${SOCIAL_HOST}.`);
  }
  if (!items.some((item) => item.href === FORUMS_HOST && item.label === "Forums" && item.external)) {
    failures.push(`header ${label}: expected public Forums link to the configured Forums host.`);
  }
}

function checkFooter() {
  checkDuplicates("footer", footerItems);
  if (!footerItems.some((item) => item.href === SOCIAL_HOST && item.label === "Social" && item.external)) {
    failures.push(`footer: expected visible Social link to ${SOCIAL_HOST}.`);
  }
  if (!footerItems.some((item) => item.href === FORUMS_HOST && item.label === "Forums" && item.external)) {
    failures.push("footer: expected visible Forums link to the configured Forums host.");
  }
}

function checkDuplicates(label, items) {
  const hrefs = new Map();
  const labels = new Map();
  for (const item of items) {
    const hrefKey = item.href.toLowerCase();
    const labelKey = item.label.toLowerCase();
    hrefs.set(hrefKey, [...(hrefs.get(hrefKey) || []), item.label]);
    labels.set(labelKey, [...(labels.get(labelKey) || []), item.href]);
  }

  for (const [href, labelsForHref] of hrefs) {
    if (labelsForHref.length > 1) failures.push(`${label}: duplicate visible href ${href} (${labelsForHref.join(", ")}).`);
  }

  for (const [itemLabel, hrefsForLabel] of labels) {
    if (hrefsForLabel.length > 1) failures.push(`${label}: duplicate visible label ${itemLabel} (${hrefsForLabel.join(", ")}).`);
  }
}

function assertAdjacentLink(label, items, firstHref, firstLabel, secondHref, secondLabel) {
  const firstIndex = items.findIndex((item) => item.href === firstHref && item.label === firstLabel && item.external);
  const second = items[firstIndex + 1];
  if (firstIndex < 0
    || !second
    || second.href !== secondHref
    || second.label !== secondLabel
    || !second.external) {
    failures.push(`${label}: Forums must be the immediate visible item after Social.`);
  }
}

function assertIncludes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

function assertNotIncludes(label, text, snippet) {
  if (text.includes(snippet)) failures.push(`${label}: unexpected snippet found: ${snippet}`);
}

function assertCount(label, text, snippet, expected) {
  const count = text.split(snippet).length - 1;
  if (count !== expected) failures.push(`${label}: expected ${expected} exact occurrence, found ${count}.`);
}
