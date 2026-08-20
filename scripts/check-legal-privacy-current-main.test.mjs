import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DECISION_PATH,
  INVENTORY_PATH,
  ROOT,
  scanPublicPacket,
  validatePacket,
} from "./check-legal-privacy-current-main.mjs";

const rawInventory = readFileSync(INVENTORY_PATH, "utf8");
const inventory = JSON.parse(rawInventory);
const decisionText = readFileSync(DECISION_PATH, "utf8");

function clone(value = inventory) {
  return structuredClone(value);
}

function failuresFor(candidate, options = {}) {
  const candidateRaw = options.rawInventory ?? JSON.stringify(candidate);
  return validatePacket({
    inventory: candidate,
    rawInventory: candidateRaw,
    decisionText: options.decisionText ?? decisionText,
    rootDir: ROOT,
    verifyRepository: options.verifyRepository ?? false,
  });
}

function expectRejected(name, mutate, options = {}) {
  test(name, () => {
    const candidate = clone();
    mutate(candidate);
    const failures = failuresFor(candidate, options);
    assert.ok(failures.length > 0, `${name} unexpectedly passed`);
  });
}

test("sealed packet validates against Git objects and working source", () => {
  const failures = validatePacket({ inventory, rawInventory, decisionText, rootDir: ROOT, verifyRepository: true });
  assert.deepEqual(failures, []);
});

expectRejected("missing inherited reference is rejected", (candidate) => {
  candidate.inheritedSourceRefs.pop();
});

expectRejected("changed inherited reference cannot be mislabeled same", (candidate) => {
  candidate.inheritedSourceRefs.find((row) => row.id === "root-security-policy").deltaState = "same";
});

expectRejected("absent inherited reference cannot fabricate a current blob", (candidate) => {
  candidate.inheritedSourceRefs.find((row) => row.id === "website-privacy-page").currentBlob = "0".repeat(40);
});

expectRejected("current reference blob drift is rejected", (candidate) => {
  candidate.currentSourceRefs.find((row) => row.id === "website-footer").blob = "0".repeat(40);
}, { verifyRepository: true });

expectRejected("current source path traversal is rejected", (candidate) => {
  candidate.currentSourceRefs.find((row) => row.id === "website-footer").path = "../SiteFooter.tsx";
});

expectRejected("missing current reference is rejected", (candidate) => {
  candidate.currentSourceRefs = candidate.currentSourceRefs.filter((row) => row.id !== "gallery-discord-ingress");
});

expectRejected("missing route finding is rejected", (candidate) => {
  candidate.routeFindings = candidate.routeFindings.filter((row) => row.id !== "website-contact-route-absent");
});

expectRejected("missing Discord Gallery source binding is rejected", (candidate) => {
  const row = candidate.dataFlows.find((entry) => entry.id === "gallery-submission-moderation-publication");
  row.sourceRefs = row.sourceRefs.filter((id) => id !== "gallery-discord-schema");
});

expectRejected("fabricated READY record is rejected", (candidate) => {
  candidate.record.status = "READY";
});

expectRejected("fabricated COMPLETE row is rejected", (candidate) => {
  candidate.approvalGates[0].status = "COMPLETE";
});

expectRejected("completeness cannot become true", (candidate) => {
  candidate.record.completeness = true;
});

expectRejected("activation cannot be authorized", (candidate) => {
  candidate.record.activationAuthorized = true;
});

expectRejected("activation effect cannot change", (candidate) => {
  candidate.record.activationEffect = "deploy";
});

expectRejected("public legal copy cannot be authorized", (candidate) => {
  candidate.record.publicLegalCopyAuthorized = true;
});

expectRejected("provider readback cannot be fabricated", (candidate) => {
  candidate.record.providerReadbackPerformed = true;
});

expectRejected("counsel review cannot be fabricated", (candidate) => {
  candidate.record.counselReviewed = true;
});

expectRejected("blocked value cannot be fabricated", (candidate) => {
  candidate.providers.find((row) => row.id === "vercel").value = "confirmed";
});

expectRejected("provider contract fact must remain null", (candidate) => {
  candidate.providers.find((row) => row.id === "supabase").contractDpa = "current";
});

expectRejected("provider region fact must remain null", (candidate) => {
  candidate.providers.find((row) => row.id === "shopify").regions = ["region-one"];
});

expectRejected("legal basis must remain null", (candidate) => {
  candidate.dataFlows.find((row) => row.id === "account-auth-membership").legalBasis = "consent";
});

expectRejected("external embed categories must remain null", (candidate) => {
  candidate.dataFlows.find((row) => row.id === "external-embeds-and-links").dataCategories = ["cookies"];
});

expectRejected("future architecture fields must remain null", (candidate) => {
  candidate.dataFlows.find((row) => row.id === "future-mobile-and-game").destinations = ["future provider"];
});

expectRejected("rights deadline must remain null", (candidate) => {
  candidate.rightsFindings.find((row) => row.id === "access").deadline = "30 days";
});

expectRejected("runtime retention claim cannot be fabricated", (candidate) => {
  candidate.retentionDeletion.find((row) => row.id === "spinner-thirty-day-source-rule").runtimeVerified = true;
});

expectRejected("unresolved row requires owner", (candidate) => {
  candidate.publicClaims.find((row) => row.id === "social-contact-link").owner = null;
});

expectRejected("unresolved row requires question", (candidate) => {
  candidate.publicClaims.find((row) => row.id === "social-contact-link").question = null;
});

expectRejected("unresolved row requires evidence", (candidate) => {
  candidate.publicClaims.find((row) => row.id === "social-contact-link").evidenceNeeded = [];
});

expectRejected("SOURCE_OBSERVED cannot carry blocker ownership", (candidate) => {
  candidate.routeFindings.find((row) => row.id === "website-gallery-routes").owner = "privacy-owner";
});

test("private paths and secret-like evidence are rejected", () => {
  const samples = [
    "C:\\Private\\evidence.json",
    "file:///private/evidence.json",
    "localhost:54321",
    "person@example.test",
    "123456789012345678",
    ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
    "https://host.invalid/callback?token=secret-value",
    "{\"clientSecret\":\"not-allowed\"}",
  ];
  for (const sample of samples) assert.ok(scanPublicPacket(sample).length > 0, `scanner accepted ${sample}`);
});

test("raw inventory with a candidate-redline field is rejected", () => {
  const candidate = clone();
  const injected = `${JSON.stringify(candidate).slice(0, -1)},\"candidateRedline\":\"draft\"}`;
  assert.ok(failuresFor(candidate, { rawInventory: injected }).length > 0);
});

test("decision document must retain exact anchor and fail-closed boundaries", () => {
  const changed = decisionText.replace("7112abe8872b255e5c8231728ebda893b0064fed", "0".repeat(40));
  assert.ok(failuresFor(clone(), { decisionText: changed }).length > 0);
});
