import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OFFICIAL_GUILD_CHANNELS,
  SITE_DISPLAY_NAME,
  SOCIAL_HOST,
} from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];
const expectedOfficialGuildChannels = [
  { label: "Facebook Page", href: "https://www.facebook.com/mochiriiguildpage" },
  { label: "Facebook Group", href: "https://www.facebook.com/groups/mochiriiguild" },
  { label: "Instagram", href: "https://www.instagram.com/mochirii_guild/" },
  { label: "TikTok", href: "https://www.tiktok.com/@mochirii_guild" },
  { label: "Twitch", href: "https://www.twitch.tv/mochiriiguild" },
];

const header = read("apps/web/components/SiteHeader.tsx");
const headerAuthState = read("apps/web/components/site-header/use-header-auth-state.ts");
const headerAuthRuntime = read("apps/web/components/site-header/header-auth-runtime.ts");
const headerNavigation = read("apps/web/components/site-header/header-navigation.tsx");
const spinnerViewerNavLink = read("apps/web/components/site-header/spinner-viewer-nav-link.tsx");
const navSource = read("apps/web/lib/site-navigation.ts");
const footer = read("apps/web/components/SiteFooter.tsx");
const socialPanel = read("apps/web/components/member-workflow/SocialHubPanel.tsx");
const socialPage = read("apps/web/app/social/page.tsx");
const accountPanel = read("apps/web/components/member-workflow/AccountPanel.tsx");
const facebookPagePublishQueue = read("apps/web/components/member-workflow/FacebookPagePublishQueue.tsx");
const currentState = read("docs/current-live-state.md");
const runbook = read("docs/operations/integration-operations-runbook.md");

const navGroups = between(navSource, "export const navGroups", "export const publicUtilityLinks");
const publicUtilityLinks = between(navSource, "export const publicUtilityLinks", "export const accountWorkflowLinks");
const accountWorkflowLinks = between(navSource, "export const accountWorkflowLinks", "");
const retiredMembersRouteFiles = [
  "apps/web/app/members/page.tsx",
  "apps/web/app/members/[slug]/page.tsx",
  "apps/web/components/member-workflow/MemberDirectory.tsx",
];

const publicItems = [...extractItems(navGroups), ...extractItems(publicUtilityLinks)];
const accountItems = extractItems(accountWorkflowLinks);
const footerItems = extractItems(footer);

const forbiddenGroupHrefs = ["/members", "/social", "/gallery-submit", "/leader-dashboard", "/spinner"];

for (const href of forbiddenGroupHrefs) {
  if (navGroups.includes(`href: "${href}"`)) {
    failures.push(`SiteHeader navGroups must not expose workflow href ${href}; keep it under Account.`);
  }
}

assertIncludes("site navigation public URL config", navSource, `"@/lib/public-urls"`);
assertIncludes("site navigation dropdown Social", navGroups, `href: SOCIAL_HOST, label: "Social", nav: "social-host", external: true`);
assertIncludes("site navigation dropdown Mochi Pets", navGroups, `href: "/games/mochi-pets", label: "Mochi Pets", nav: "games/mochi-pets"`);
assertIncludes("SiteHeader group auth filtering", header, ".filter((item) => !navItemHidden(item, authState))");
assertIncludes("SiteHeader deferred auth import", headerAuthState, 'import("./header-auth-runtime")');
assertIncludes("SiteHeader moderator probe", headerAuthRuntime, "checkLeaderGalleryModerationAccess");
assertIncludes("SiteHeader lazy moderator trigger", header, `void ensureModeratorAccess();`);
assertIncludes("SiteHeader mobile moderator trigger", header, "setMobileOpen(true)");
assertIncludes("SiteHeader account controls", header, `aria-controls="nav-menu-account"`);
assertIncludes("SiteHeader account controls", header, `aria-haspopup="true"`);
assertIncludes("SiteHeader account controls", header, `aria-expanded={openGroup === "account"}`);
assertIncludes("SiteHeader moderator auth marker", headerNavigation, `"data-auth-moderator"`);
assertIncludes("SiteHeader spinner viewer auth marker", headerNavigation, `"data-auth-spinner-viewer"`);
assertIncludes("SiteHeader spinner viewer gate", header, `item.auth === "spinner-viewer"`);
assertIncludes("SiteHeader spinner viewer launcher", header, "<SpinnerViewerNavLink");
assertIncludes("deferred header exact spinner eligibility", headerAuthRuntime, "verifyMemberAccess");
assertIncludes("deferred header exact spinner eligibility", headerAuthRuntime, "memberAccess?.galleryEligible === true");
assertIncludes("deferred header exact spinner eligibility", headerAuthRuntime, 'memberAccess.memberStatus === "active"');
assertIncludes("spinner viewer link fail-closed render", spinnerViewerNavLink, "if (hidden) return null;");
assertIncludes("spinner viewer link session-first navigation", spinnerViewerNavLink, "const opened = await launchSpinnerViewer();");
assertIncludes("spinner viewer link session-first navigation", spinnerViewerNavLink, "if (opened) {");
assertIncludes("spinner viewer link session-first navigation", spinnerViewerNavLink, "window.location.assign(item.href);");

assertNotIncludes("SiteHeader public nav", publicUtilityLinks, `href: "/social", label: "Social"`);
assertNotIncludes("SiteHeader public utility Social", publicUtilityLinks, `href: SOCIAL_HOST, label: "Social"`);
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
assertIncludes("SiteFooter Mochi Pets", footer, `href: "/games/mochi-pets", label: "Mochi Pets"`);
assertIncludes("SiteFooter official channels", footer, "OFFICIAL_GUILD_CHANNELS.map");
assertIncludes("SiteFooter official channels", footer, `<FooterColumn title="Channels" links={channelLinks} />`);
assertIncludes("SiteFooter exact website display", footer, "{SITE_DISPLAY_NAME}");
assertNotIncludes("SiteFooter", footer, "hidden:");
assertNotIncludes("SiteFooter", footer, "data-auth-");
assertNotIncludes("SiteFooter public Social", footer, `href: "/social", label: "Social"`);
assertNotIncludes("SiteFooter signed-out HTML", footer, `href="/spinner"`);
assertIncludes("SiteFooter authenticated Spinner", footer, "<SpinnerViewerNavLink");
assertIncludes("SiteFooter authenticated Spinner", footer, "hidden={!authState.spinnerViewer}");

if (SITE_DISPLAY_NAME !== "mochirii.com") {
  failures.push(`public website display must be exactly mochirii.com; found ${JSON.stringify(SITE_DISPLAY_NAME)}.`);
}
if (JSON.stringify(OFFICIAL_GUILD_CHANNELS) !== JSON.stringify(expectedOfficialGuildChannels)) {
  failures.push("official guild channel URLs or handle choices do not match the approved canonical set.");
}
if (OFFICIAL_GUILD_CHANNELS.some((channel) => /(?:^|\.)mochirii\.com\b/iu.test(new URL(channel.href).hostname))) {
  failures.push("official channel entries must stay provider-profile URLs and must not configure a mochirii.com Instagram profile link.");
}
assertIncludes("Facebook Group handoff public URL config", facebookPagePublishQueue, `"@/lib/public-urls"`);
assertIncludes("Facebook Group handoff", facebookPagePublishQueue, "href={FACEBOOK_GROUP_URL}");
assertNotIncludes("Facebook Group handoff duplicate URL", facebookPagePublishQueue, "https://www.facebook.com/groups/mochiriiguild");

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
console.log("- Header Social and the public Mochi Pets page live in the Guild dropdown.");
console.log("- Footer Social and Mochi Pets links are public.");
console.log("- Footer Channels pins the approved Facebook Page, Facebook Group, Instagram, TikTok, and Twitch URLs.");
console.log("- Visible website text is exactly mochirii.com; no Instagram profile website link is configured.");
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
    const href = match[1] || (match[2] === "SOCIAL_HOST" ? SOCIAL_HOST : match[2]);
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
}

function checkFooter() {
  checkDuplicates("footer", footerItems);
  if (!footerItems.some((item) => item.href === SOCIAL_HOST && item.label === "Social" && item.external)) {
    failures.push(`footer: expected visible Social link to ${SOCIAL_HOST}.`);
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

function assertIncludes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

function assertNotIncludes(label, text, snippet) {
  if (text.includes(snippet)) failures.push(`${label}: unexpected snippet found: ${snippet}`);
}
