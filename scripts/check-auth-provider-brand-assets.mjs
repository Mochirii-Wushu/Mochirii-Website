import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalizeCheckoutTextBytes } from "./lib/canonical-checkout-text.mjs";

const assets = new Map([
  ["apple-logo.generated.svg", "46DC761ACEC539EC3CD45779BD3D19846DBBB57E703A0E94BFB630AE865D350C"],
  ["discord-symbol-white.svg", "2123B8A552A13349F8139EA81FA96FE10B84CC6C9B2A1545A62EC1F7B476AE76"],
  ["facebook-login-mark.svg", "316535B6DE46AB29760DD143FDF2A893D7971B166A5FF11D12B19B6ACB53E932"],
  ["google-g.generated.svg", "3A432ACC7C5D85F06F13930798135E955CCC728EFE541290A909B33498B61B43"],
  ["spotify-primary-logo-green.svg", "47A07A15F0DF73699A72621F9E42B4F4A50B035373664A8F6A384310AEF1DE2C"],
  ["twitch-glitch-white.svg", "7FF2942CE7B169CB9175DF2BC2BE8292DA9C6701B5C5039C38EBE61A667ABBE6"],
]);
const failures = [];

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url));
}

function text(path) {
  return read(path).toString("utf8");
}

for (const [filename, expectedHash] of assets) {
  const path = `apps/web/public/assets/auth-providers/${filename}`;
  let canonicalBytes;
  try {
    canonicalBytes = canonicalizeCheckoutTextBytes(read(path));
  } catch (error) {
    failures.push(`${filename}: ${error instanceof Error ? error.message : "invalid checkout bytes"}`);
    continue;
  }
  const actualHash = createHash("sha256").update(canonicalBytes).digest("hex").toUpperCase();
  if (actualHash !== expectedHash) {
    failures.push(`${filename}: expected SHA-256 ${expectedHash}, received ${actualHash}`);
  }
}

const providerLogo = text("apps/web/components/member-workflow/ProviderLogo.tsx");
const providerRegistry = text("apps/web/lib/supabase/auth-providers.ts");
const provenance = text("apps/web/public/assets/auth-providers/README.md");
const memberWorkflowCss = text("apps/web/app/styles/member-workflow.css");
const appleMark = text("apps/web/public/assets/auth-providers/apple-logo.generated.svg");
const googleMark = text("apps/web/public/assets/auth-providers/google-g.generated.svg");
const labels = [
  "Continue with Apple",
  "Continue with Facebook",
  "Continue with Google",
  "Sign in with Discord",
  "Log in with Twitch",
  "Log in with Spotify",
];

for (const filename of assets.keys()) {
  if (!providerLogo.includes(`/assets/auth-providers/${filename}`)) {
    failures.push(`ProviderLogo: missing official asset reference ${filename}`);
  }
  if (!provenance.includes(`\`${filename}\``)) {
    failures.push(`asset provenance: missing ${filename}`);
  }
}

for (const label of labels) {
  if (!providerRegistry.includes(`signInLabel: "${label}"`)) {
    failures.push(`provider registry: missing exact label ${label}`);
  }
}

if (!providerLogo.includes("OFFICIAL_PROVIDER_ASSETS")) {
  failures.push("ProviderLogo: official provider asset registry missing");
}
if (!provenance.includes("not part of Mochirii's project license")) {
  failures.push("asset provenance: project-license exclusion missing");
}
if (!provenance.includes("production-disabled")) {
  failures.push("asset provenance: Facebook and Spotify activation boundary missing");
}

for (const snippet of [
  'fill="#EA4335"',
  'fill="#4285F4"',
  'fill="#FBBC05"',
  'fill="#34A853"',
  'viewBox="0 0 48 48"',
]) {
  if (!googleMark.includes(snippet)) failures.push(`Google mark: missing official configurator geometry ${snippet}`);
}

for (const snippet of [
  'viewBox="0 0 112 112"',
  'width="112" height="112"',
]) {
  if (!appleMark.includes(snippet)) failures.push(`Apple mark: missing official generated-button geometry ${snippet}`);
}

for (const snippet of [
  ".provider-button--google{",
  "gap:10px;",
  "min-height:56px;",
  "padding:0 12px;",
  "border-color:#8e918f;",
  "border-radius:28px;",
  "background:#131314;",
  "font-family:Roboto, Arial, sans-serif;",
  "font-size:14px;",
  "letter-spacing:.25px;",
  ".provider-button--google .provider-button__label{",
  "color:#e3e3e3;",
  "font-weight:500;",
  "line-height:20px;",
  ".provider-button--apple{",
  "justify-content:center;",
  "min-height:56px;",
  "border-color:#000;",
  "border-radius:15px;",
  "background:#fff;",
  ".provider-button--apple .provider-button__label{",
  "color:#000;",
  "font-size:24px;",
  ".provider-button--apple .provider-logo--apple{",
]) {
  if (!memberWorkflowCss.includes(snippet)) failures.push(`provider controls: missing reviewed brand treatment ${snippet}`);
}
if (memberWorkflowCss.includes("provider-button--primary")) {
  failures.push("provider controls: provider-specific primary emphasis is not allowed");
}
if (/^\.provider-logo--apple\{[^}]*position:absolute/m.test(memberWorkflowCss)) {
  failures.push("provider controls: Apple positioning escaped the sign-in-button scope");
}

if (failures.length) {
  console.error("Authentication provider brand asset validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Authentication provider brand asset validation OK.");
