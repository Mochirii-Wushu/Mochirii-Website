import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalizeCheckoutTextBytes } from "./lib/canonical-checkout-text.mjs";

const assets = new Map([
  ["apple-logo.generated.svg", "7D3C135C938C999A57D258CD4D12F55F34D3575FE79F95A83DA023A0BAEA62A2"],
  ["discord-symbol-white.svg", "2123B8A552A13349F8139EA81FA96FE10B84CC6C9B2A1545A62EC1F7B476AE76"],
  ["facebook-login-mark.svg", "316535B6DE46AB29760DD143FDF2A893D7971B166A5FF11D12B19B6ACB53E932"],
  ["google-sign-in-dark-square.generated.svg", "CF080920BE4C35B64D7F06CE67B333361045CD3DCC2F02E1233BFAFDDDB92E8A"],
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

if (failures.length) {
  console.error("Authentication provider brand asset validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Authentication provider brand asset validation OK.");
