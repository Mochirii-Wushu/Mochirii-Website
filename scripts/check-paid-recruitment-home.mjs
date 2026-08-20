import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const cupcakePath = "apps/web/public/assets/img/brand/cupcake-mark.svg";
const attributesPath = ".gitattributes";
const pagePath = "apps/web/app/page.tsx";
const componentPath = "apps/web/components/HomeRecruitmentCtas.tsx";
const cssPath = "apps/web/app/styles/public-home-seal.css";
const expectedCupcakeHash = "d6a53e8f5f01d0136e4847175c4426b447be9e9cb8f265bf6e88c12a87bbdb3d";
const expectedValueProposition = "An English-friendly APAC guild with Discord, UTC+8 events, and room for casual cross-platform players.";
const expectedBadges = ["Recruitment Open", "SEA Server", "Cross-Platform", "UTC+8 Events"];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function expectIncludes(label, source, snippet) {
  if (!source.includes(snippet)) fail(`${label} is missing: ${snippet}`);
}

const cupcakeHash = createHash("sha256").update(readFileSync(cupcakePath)).digest("hex");
if (cupcakeHash !== expectedCupcakeHash) {
  fail(`Canonical Cupcake hash is ${cupcakeHash}; expected ${expectedCupcakeHash}.`);
}

const attributes = readFileSync(attributesPath, "utf8").replace(/\r\n/g, "\n");
expectIncludes(
  "Git attributes",
  attributes,
  "/apps/web/public/assets/img/brand/cupcake-mark.svg text eol=lf",
);

const home = JSON.parse(readFileSync("apps/web/public/data/home.json", "utf8"));
if (home.hero?.valueProposition !== expectedValueProposition) {
  fail("Home value proposition does not match the approved v3 copy.");
}
if (JSON.stringify(home.hero?.badges) !== JSON.stringify(expectedBadges)) {
  fail("Home recruitment badges do not match the approved v3 set and order.");
}

const page = readFileSync(pagePath, "utf8");
expectIncludes("Home page", page, "Where Winds Meet • SEA Server");
expectIncludes("Home page", page, "{homeData.hero.valueProposition}");
expectIncludes("Home page", page, "<HomeRecruitmentCtas discordUrl={DISCORD_INVITE_URL} />");
expectIncludes("Home page", page, "home-community-intro");

const recruitmentCardIndex = page.indexOf("home-recruitment-card");
const heroImageIndex = page.indexOf('id="heroImage"');
const communityCopyIndex = page.indexOf("home-community-intro");
if (
  recruitmentCardIndex === -1
  || heroImageIndex <= recruitmentCardIndex
  || communityCopyIndex <= heroImageIndex
) {
  fail("Home source order must keep the compact recruitment card before the hero artwork and the longer community copy after it.");
}

const ctas = readFileSync(componentPath, "utf8");
expectIncludes("Home recruitment CTAs", ctas, "paidRecruitmentJoinHref(window.location.search)");
if (ctas.includes("@vercel/analytics") || ctas.includes("track(")) {
  fail("Hobby-tier v3 must not emit unsupported Vercel custom events.");
}

const css = readFileSync(cssPath, "utf8").replace(/\r\n/g, "\n");
expectIncludes("Home responsive layout", css, ".home-recruitment-stage{");
expectIncludes(
  "Home responsive layout",
  css,
  "@media (max-width:820px){\n  .home-recruitment-stage{\n    grid-template-columns:1fr;",
);

if (process.exitCode) process.exit(process.exitCode);

console.log("Paid recruitment Home validation OK.");
