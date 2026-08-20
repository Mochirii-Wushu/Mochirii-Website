import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const INVENTORY_PATH = resolve(ROOT, "docs/operations/legal-privacy-current-main.v2.json");
export const DECISION_PATH = resolve(ROOT, "docs/operations/LEGAL-PRIVACY-CURRENT-MAIN-2026-08-13.md");

const ANCHOR_COMMIT = "d5e55abfb5e5d6fbecaf7da1cec762ba9bc9cdab";
const ANCHOR_TREE = "7112abe8872b255e5c8231728ebda893b0064fed";
const INHERITED_COMMIT = "c4b1da6e3d40879f6b0ba590b6f87fd93404aa9c";
const INHERITED_TREE = "3670d0b420323323c48b6fbb06867f3840d70b38";

const ALLOWED_STATUSES = [
  "SOURCE_OBSERVED",
  "SOURCE_ABSENT_BLOCKER",
  "RUNTIME_READBACK_REQUIRED",
  "BLOCKED_APPROVAL",
  "BLOCKED_EXTERNAL",
  "DEFERRED_BY_EXPLICIT_POLICY",
  "NOT_APPLICABLE_REVIEWED",
];

const EXPECTED_REQUIREMENT_IDS = [
  "P5A-SOURCE-001",
  "P5A-FACT-001",
  "P5A-FACT-002",
  "P5A-FACT-003",
  "P5A-FACT-004",
  "P5A-FACT-005",
  "P5A-FACT-006",
  "P5A-FACT-007",
  "P5A-PRIV-001",
  "P5A-PRIV-002",
  "P5A-PRIV-003",
  "P5A-ASSENT-001",
  "P5A-BRAND-001",
  "P5A-COUNSEL-001",
  "P16-ARCH-001",
  "P16-LEGAL-001",
];

const EXPECTED_INHERITED = [
  ["repository-guidance", "AGENTS.md", "d1efc93bba0c3da2c78dc9e03bf2215750a3bbd1", "d1efc93bba0c3da2c78dc9e03bf2215750a3bbd1", "same", "SAME_BYTES_REVIEWED"],
  ["root-security-policy", "SECURITY.md", "87a69a31a8b3acfafac27f61acf1c7407dd9f8ec", "1eb4ace5d987aca7fee4f528b7564c32714d154c", "changed", "CHANGED_BYTES_REVIEWED"],
  ["website-security-txt", "apps/web/public/.well-known/security.txt", "5f9f3862c351d40cdad79e043461a8c169aa944d", "7a0fd4b5dc6c3999c331214b2973a166b910a2a8", "changed", "CHANGED_BYTES_REVIEWED"],
  ["social-security-txt", "services/social/public/.well-known/security.txt", "247db0dbdade4c861f25020bee236cb06014d311", null, "absent", "ABSENT_AT_ANCHOR"],
  ["website-privacy-page", "apps/web/components/public-pages/route-pages/PrivacyPage.tsx", "92df38a1726c57df2de769b1087f7ea2c6a0422a", null, "absent", "ABSENT_AT_ANCHOR"],
  ["meta-deletion-page", "apps/web/components/public-pages/route-pages/MetaDataDeletionPage.tsx", "cc2028b784a10614d53c69413d66fa1468d8f691", null, "absent", "ABSENT_AT_ANCHOR"],
  ["website-footer", "apps/web/components/SiteFooter.tsx", "2b0fd0b0659316cd75312d122d1cf124db38b43c", "c782c466910d390cf26fc952d1745ffd43a17297", "changed", "CHANGED_BYTES_REVIEWED"],
  ["integration-catalog", "docs/integrations/integration-exposure-catalog.v1.json", "f5fc493b668cb09f410a77267756d340e99ee13e", null, "absent", "ABSENT_AT_ANCHOR"],
  ["architecture", "docs/architecture.md", "4de740e0671bff94f2c0f67aae9f43837cb52b26", "f745cff4f97453f372f0d0840907d4b49389a627", "changed", "CHANGED_BYTES_REVIEWED"],
  ["operations-readme", "docs/operations/README.md", "673f10270c191cf7a34cf76a9cf155341ef993b5", "cf156b4b785adaa9b73cee32009087449fb9abf1", "changed", "CHANGED_BYTES_REVIEWED"],
  ["current-state", "docs/operations/CURRENT-STATE.md", "6cd58b2ac5113ef1dfb03d3cec47dbc62a1b30a3", "2dca3a4e4910fdb09a7a6a71a05e02d4d7ded956", "changed", "CHANGED_BYTES_REVIEWED"],
  ["social-privacy-contract", "services/social/resources/views/site/partial/privacy-contract.blade.php", "7e45a030be9d79af5444b4c907deea1597a19c36", "7e45a030be9d79af5444b4c907deea1597a19c36", "same", "SAME_BYTES_REVIEWED"],
  ["social-site-terms", "services/social/resources/views/site/terms.blade.php", "08625c06bb56c1cc7744c7797563a290b139944b", "08625c06bb56c1cc7744c7797563a290b139944b", "same", "SAME_BYTES_REVIEWED"],
  ["social-mobile-terms", "services/social/resources/views/mobile/terms.blade.php", "6931bb5dc3fcc60fc048aa589fb58e1b4c07a1fe", "6931bb5dc3fcc60fc048aa589fb58e1b4c07a1fe", "same", "SAME_BYTES_REVIEWED"],
  ["social-legal-notice", "services/social/resources/views/site/legal-notice.blade.php", "18e7d92cdba3cc95b5095d3af69d89b7588b953e", "18e7d92cdba3cc95b5095d3af69d89b7588b953e", "same", "SAME_BYTES_REVIEWED"],
  ["social-site-controller", "services/social/app/Http/Controllers/SiteController.php", "b1a5ec3db0df07d37391a4ab2a6e0664d1b5e44e", "b1a5ec3db0df07d37391a4ab2a6e0664d1b5e44e", "same", "SAME_BYTES_REVIEWED"],
  ["social-community-guidelines", "services/social/resources/views/site/help/community-guidelines.blade.php", "e7875e1f94efdfc1dd8a0357e60030bb37c6f4b6", "e7875e1f94efdfc1dd8a0357e60030bb37c6f4b6", "same", "SAME_BYTES_REVIEWED"],
  ["social-data-policy", "services/social/resources/views/site/help/data-policy.blade.php", "ab4740c016e29bd6c39987f0b6ff7bfee02dc793", "ab4740c016e29bd6c39987f0b6ff7bfee02dc793", "same", "SAME_BYTES_REVIEWED"],
  ["social-platform-page", "services/social/resources/views/site/platform.blade.php", "1972f83e203bdce22e4a14f41972a40882136226", "1972f83e203bdce22e4a14f41972a40882136226", "same", "SAME_BYTES_REVIEWED"],
  ["social-branding-config", "services/social/config/mochirii-branding.php", "c3a406df0ffbf495427659c27a901e184877be42", "c3a406df0ffbf495427659c27a901e184877be42", "same", "SAME_BYTES_REVIEWED"],
  ["social-app-config", "services/social/config/app.php", "b6ccef97d28d3edf2f06f66f7f0a1925fed63f33", "b6ccef97d28d3edf2f06f66f7f0a1925fed63f33", "same", "SAME_BYTES_REVIEWED"],
  ["social-instance-config", "services/social/config/instance.php", "2db3afcaa69889e946a076b268e8c120c494c3c8", "2db3afcaa69889e946a076b268e8c120c494c3c8", "same", "SAME_BYTES_REVIEWED"],
  ["social-manifest", "services/social/public/manifest.json", "7b27ae2039db6cdfb1e294055dd5759c2385de57", "7b27ae2039db6cdfb1e294055dd5759c2385de57", "same", "SAME_BYTES_REVIEWED"],
  ["social-deletion-help", "services/social/resources/views/site/help/your-profile.blade.php", "39103957901dd443ea5e88836175aa2aad6cdd45", "39103957901dd443ea5e88836175aa2aad6cdd45", "same", "SAME_BYTES_REVIEWED"],
  ["social-pixelfed-config", "services/social/config/pixelfed.php", "3a508cb4b446d00d7b15ddf687ff45b9e9b1ed8e", "3a508cb4b446d00d7b15ddf687ff45b9e9b1ed8e", "same", "SAME_BYTES_REVIEWED"],
  ["social-parental-controls", "services/social/resources/views/site/help/parental-controls.blade.php", "d7b9710dd99b09a7079369f7933220d677be8bc4", "d7b9710dd99b09a7079369f7933220d677be8bc4", "same", "SAME_BYTES_REVIEWED"],
  ["gallery-media-delivery", "docs/integrations/gallery-public-media-delivery.md", "a53c0c82cd071dbc33fae5e4249f453cc82496ea", null, "absent", "ABSENT_AT_ANCHOR"],
  ["gallery-thumbnail-rollout", "docs/operations/GALLERY-THUMBNAIL-ROLLOUT.md", "6fa2f06840d33abba9e882414efc7195491d8434", "bede5251fbdc7eb7fcf647eb2df146bbe5a463e0", "changed", "CHANGED_BYTES_REVIEWED"],
  ["facebook-publishing-contract", "docs/integrations/facebook-page-gallery-publishing.md", "60b4defac190c9a9093bfe03d8ee5da4fd04ddf4", null, "absent", "ABSENT_AT_ANCHOR"],
  ["instagram-publishing-contract", "docs/integrations/instagram-gallery-publishing.md", "4592173afb654ae5449254e0f69d8e9946031ba3", null, "absent", "ABSENT_AT_ANCHOR"],
  ["raffle-leaderboard", "docs/operations/MONTHLY-RAFFLE-LEADERBOARD.md", "bac8ded2e0134417e0e2f0ddbbd0a41359b1f180", null, "absent", "ABSENT_AT_ANCHOR"],
  ["reward-relay", "docs/integrations/reward-relay.md", "0f562723fca541e5af261b977bc00392cc65c87c", null, "absent", "ABSENT_AT_ANCHOR"],
  ["spinner-publication", "docs/operations/SPINNER-RAFFLE-WINNER-PUBLICATION.md", "1a22259094b4bec4347e421b4621f042862b338e", "6281ecf2a7d8d09dc499dc576495950f1da4e394", "changed", "CHANGED_BYTES_REVIEWED"],
  ["shopify-readiness", "docs/operations/SHOPIFY-LAUNCH-READINESS.md", "bfce083b84b963af8c323dce8b5b01a8285ad8bf", "25597206d23a7e3da3efd43c0a3a981c3d4c7b94", "changed", "CHANGED_BYTES_REVIEWED"],
  ["storefront-lifecycle", "docs/operations/STOREFRONT-SURFACE-LIFECYCLE-2026-07-29.md", "fcea5ac8af2bf49502bff481c365c0cf9ef28f23", null, "absent", "ABSENT_AT_ANCHOR"],
  ["mochi-pets-contract", "docs/integrations/mochi-pets-website-contract.md", "c9518a2b78022722afda8015e6cb7151e120744e", "c9518a2b78022722afda8015e6cb7151e120744e", "same", "SAME_BYTES_REVIEWED"],
];

const EXPECTED_CURRENT_PATHS = {
  "repository-guidance": "AGENTS.md",
  "root-security-policy": "SECURITY.md",
  "website-security-txt": "apps/web/public/.well-known/security.txt",
  "website-footer": "apps/web/components/SiteFooter.tsx",
  "website-route-matrix": "scripts/check-accessibility-route-matrix.mjs",
  "website-shell-observability": "apps/web/components/SiteRouteShell.tsx",
  "website-csp": "apps/web/next.config.ts",
  "website-public-destinations": "apps/web/config/public-urls.json",
  "website-auth-config": "apps/web/lib/supabase/config.ts",
  "website-auth-client": "apps/web/lib/supabase/auth.ts",
  "website-oauth-decision": "apps/web/app/api/oauth/decision/route.ts",
  "website-account-panel": "apps/web/components/member-workflow/AccountPanel.tsx",
  "website-gallery-submit": "apps/web/components/member-workflow/GallerySubmitForm.tsx",
  "website-gallery-client": "apps/web/lib/supabase/gallery-submissions.ts",
  "website-gallery-feed": "apps/web/lib/gallery/approved-feed.ts",
  "gallery-feed-function": "supabase/functions/list-approved-gallery-submissions/index.ts",
  "gallery-delete-function": "supabase/functions/delete-rejected-gallery-submission/index.ts",
  "gallery-schema": "supabase/migrations/20260513081523_create_discord_role_gated_gallery_uploads.sql",
  "gallery-instagram-consent": "supabase/migrations/20260607125027_add_instagram_gallery_publishing.sql",
  "gallery-discord-ingress": "supabase/functions/submit-discord-gallery-image/index.ts",
  "gallery-discord-schema": "supabase/migrations/20260524114802_add_discord_gallery_submission_source.sql",
  "spinner-retention": "supabase/migrations/20260726180052_add_private_live_spinner.sql",
  "spinner-media-retention": "supabase/migrations/20260727033342_add_spinner_media_jobs.sql",
  "spinner-page-auth": "apps/web/app/spinner/page.tsx",
  "spinner-session-route": "apps/web/app/spinner/session/route.ts",
  "spinner-live-route": "apps/web/app/spinner/live/route.ts",
  "spinner-media-route": "apps/web/app/spinner/media/render/route.ts",
  "spinner-session-policy": "apps/web/lib/spinner/session-policy.ts",
  "social-routes": "services/social/routes/web.php",
  "social-site-controller": "services/social/app/Http/Controllers/SiteController.php",
  "social-mobile-controller": "services/social/app/Http/Controllers/MobileController.php",
  "social-privacy-contract": "services/social/resources/views/site/partial/privacy-contract.blade.php",
  "social-site-terms": "services/social/resources/views/site/terms.blade.php",
  "social-mobile-terms": "services/social/resources/views/mobile/terms.blade.php",
  "social-legal-notice": "services/social/resources/views/site/legal-notice.blade.php",
  "social-community-guidelines": "services/social/resources/views/site/help/community-guidelines.blade.php",
  "social-data-policy": "services/social/resources/views/site/help/data-policy.blade.php",
  "social-platform-page": "services/social/resources/views/site/platform.blade.php",
  "social-deletion-help": "services/social/resources/views/site/help/your-profile.blade.php",
  "social-pixelfed-config": "services/social/config/pixelfed.php",
  "social-instance-config": "services/social/config/instance.php",
  "social-parental-controls": "services/social/resources/views/site/help/parental-controls.blade.php",
  "hosted-runtime-source": "docs/integrations/hosted-runtime.json",
  "social-delivery-contract": "docs/integrations/mochirii-social-delivery.md",
  "social-entitlement-contract": "docs/integrations/social-service-entitlement.v1.md",
  "shopify-readiness": "docs/operations/SHOPIFY-LAUNCH-READINESS.md",
  "mochi-pets-contract": "docs/integrations/mochi-pets-website-contract.md",
  "website-spotify-embed": "apps/web/components/public-pages/SpotifyBrowser.tsx",
  "website-discord-embed": "apps/web/components/public-pages/DiscordServerPreview.tsx",
  "raffle-source": "apps/web/public/data/raffles.json",
  "website-current-state": "docs/operations/CURRENT-STATE.md",
  "website-architecture": "docs/architecture.md",
};

const COLLECTIONS = {
  routeFindings: {
    keys: ["id", "surface", "route", "sourceState", "observedFact", "status", "value", "owner", "question", "evidenceNeeded", "sourceRefs"],
    ids: ["website-privacy-route-absent", "website-contact-route-absent", "website-data-deletion-route-absent", "website-footer-legal-links-absent", "website-gallery-routes", "website-account-auth-consent-routes", "website-social-route", "website-raffle-routes", "website-spinner-route", "website-mochi-pets-route", "website-external-embed-routes", "social-privacy-routes", "social-terms-routes", "social-legal-notice-route", "social-help-legal-routes", "storefront-policy-routes"],
  },
  integrationFindings: {
    keys: ["id", "sourceState", "observedFact", "status", "value", "owner", "question", "evidenceNeeded", "sourceRefs"],
    ids: ["website-hosting-observability", "website-auth-membership", "website-social-sso", "gallery-storage-moderation-public-feed", "optional-instagram-publication", "social-host-storage-delivery", "discord-community-integration", "storefront-hosting-commerce", "raffle-spinner-backend", "external-navigation-and-embeds", "future-game-mobile-services"],
  },
  dataFlows: {
    keys: ["id", "surface", "subjects", "dataCategories", "sources", "destinations", "purpose", "legalBasis", "retention", "deletion", "backup", "transfer", "status", "owner", "question", "evidenceNeeded", "sourceRefs"],
    ids: ["public-website-and-observability", "account-auth-membership", "social-oauth-entitlement", "gallery-submission-moderation-publication", "private-guild-social", "external-embeds-and-links", "raffle-and-spinner", "storefront-commerce", "future-mobile-and-game"],
  },
  publicClaims: {
    keys: ["id", "claim", "sourceObservation", "conflict", "status", "value", "owner", "question", "evidenceNeeded", "sourceRefs"],
    ids: ["website-global-privacy-notice", "website-security-contact-change", "social-contact-link", "social-absolute-private", "social-no-sale-provider-limits", "social-terms-current-and-unified", "social-guidelines-current", "social-legal-notice-current", "social-data-policy-complete", "social-platform-terms-complete", "social-permanent-deletion", "gallery-public-attribution-and-media", "raffle-source-eligibility", "social-age-parental-policy"],
  },
  retentionDeletion: {
    keys: ["id", "surface", "sourceRule", "runtimeVerified", "legalHoldRule", "backupRule", "status", "value", "owner", "question", "evidenceNeeded", "sourceRefs"],
    ids: ["website-account-lifecycle", "gallery-account-cascade", "gallery-rejected-cleanup", "gallery-general-retention", "spinner-thirty-day-source-rule", "social-account-deletion", "website-telemetry-security-logs", "storefront-record-lifecycle"],
  },
  rightsFindings: {
    keys: ["id", "right", "surfaces", "intake", "identityVerification", "deadline", "appeal", "authorizedAgent", "providerPropagation", "evidenceTest", "status", "value", "owner", "question", "evidenceNeeded", "sourceRefs"],
    ids: ["access", "correction", "deletion", "portability", "restriction-and-objection", "consent-withdrawal", "appeal", "authorized-agent", "non-retaliation"],
  },
  providers: {
    keys: ["id", "provider", "sourceRole", "state", "contractDpa", "currentSubprocessorList", "regions", "transferMechanism", "deletionReturnTerms", "securityEvidence", "status", "value", "owner", "question", "evidenceNeeded", "sourceRefs"],
    ids: ["vercel", "supabase", "digitalocean-spaces", "cloudflare", "github-ghcr", "discord", "shopify", "meta-publication", "spotify", "identity-providers", "apple-future", "unity-future"],
  },
  approvalGates: {
    keys: ["id", "category", "requirements", "status", "value", "owner", "question", "evidenceNeeded", "sourceRefs"],
    ids: ["operator-jurisdiction-age", "processing-retention-rights", "provider-contract-transfer", "public-legal-copy-and-routes", "gallery-product-privacy", "raffle-activation", "storefront-activation", "future-mobile-game", "counsel-cost-release"],
  },
};

export function validatePacket({ inventory, rawInventory, decisionText, rootDir = ROOT, verifyRepository = true }) {
  const failures = [];
  const fail = (message) => failures.push(message);

  assertExactKeys(inventory, ["schemaVersion", "record", "statusDefinitions", "deltaSummary", "inheritedSourceRefs", "currentSourceRefs", ...Object.keys(COLLECTIONS)], "inventory", fail);
  if (inventory?.schemaVersion !== 2) fail("inventory schemaVersion must be 2");

  assertExactKeys(inventory?.record, ["id", "repository", "status", "completeness", "activationEffect", "activationAuthorized", "publicLegalCopyAuthorized", "providerReadbackPerformed", "counselReviewed", "inspectedAt", "sourceAnchor", "inheritedPacket", "operatorRequirementIds", "scopeNote"], "record", fail);
  if (inventory?.record?.id !== "legal-privacy-current-main-2026-08-13") fail("record id is not the sealed packet id");
  if (inventory?.record?.repository !== "Mochirii-Wushu/Mochirii-Website") fail("record repository must be canonical Website");
  if (inventory?.record?.status !== "SOURCE_ONLY_INCOMPLETE") fail("record status must remain SOURCE_ONLY_INCOMPLETE");
  if (inventory?.record?.completeness !== false) fail("record completeness must remain false");
  if (inventory?.record?.activationEffect !== "none") fail("record activationEffect must remain none");
  for (const field of ["activationAuthorized", "publicLegalCopyAuthorized", "providerReadbackPerformed", "counselReviewed"]) {
    if (inventory?.record?.[field] !== false) fail(`record ${field} must remain false`);
  }
  if (inventory?.record?.inspectedAt !== "2026-08-13T06:22:03-07:00") fail("record inspectedAt drifted");
  assertText(inventory?.record?.scopeNote, "record scopeNote", fail);
  assertExactArray(inventory?.record?.operatorRequirementIds, EXPECTED_REQUIREMENT_IDS, "record operatorRequirementIds", fail);

  assertExactKeys(inventory?.record?.sourceAnchor, ["commit", "tree", "committedAt"], "record sourceAnchor", fail);
  if (inventory?.record?.sourceAnchor?.commit !== ANCHOR_COMMIT) fail("source anchor commit drifted");
  if (inventory?.record?.sourceAnchor?.tree !== ANCHOR_TREE) fail("source anchor tree drifted");
  if (inventory?.record?.sourceAnchor?.committedAt !== "2026-08-11T21:12:04-07:00") fail("source anchor committedAt drifted");

  assertExactKeys(inventory?.record?.inheritedPacket, ["commit", "tree", "inventoryPath", "inventoryBlob", "decisionPacketPath", "decisionPacketBlob"], "record inheritedPacket", fail);
  const inheritedPacket = inventory?.record?.inheritedPacket;
  if (inheritedPacket?.commit !== INHERITED_COMMIT) fail("inherited packet commit drifted");
  if (inheritedPacket?.tree !== INHERITED_TREE) fail("inherited packet tree drifted");
  if (inheritedPacket?.inventoryPath !== "docs/operations/legal-privacy-readiness.v1.json") fail("inherited inventory path drifted");
  if (inheritedPacket?.inventoryBlob !== "2647651dd38e4eb4a71aa115a8c80ee9a1d52ff6") fail("inherited inventory blob drifted");
  if (inheritedPacket?.decisionPacketPath !== "docs/operations/LEGAL-PRIVACY-READINESS-2026-07-29.md") fail("inherited decision path drifted");
  if (inheritedPacket?.decisionPacketBlob !== "196bbb4478a25b7acf715014e725909845fc2507") fail("inherited decision blob drifted");

  assertExactKeys(inventory?.statusDefinitions, ALLOWED_STATUSES, "statusDefinitions", fail);
  for (const status of ALLOWED_STATUSES) assertText(inventory?.statusDefinitions?.[status], `statusDefinitions.${status}`, fail);
  assertExactKeys(inventory?.deltaSummary, ["total", "same", "changed", "absent"], "deltaSummary", fail);
  const expectedDelta = { total: 36, same: 17, changed: 9, absent: 10 };
  for (const [key, value] of Object.entries(expectedDelta)) {
    if (inventory?.deltaSummary?.[key] !== value) fail(`deltaSummary.${key} must be ${value}`);
  }

  const inheritedRows = indexById(inventory?.inheritedSourceRefs, "inherited source reference", fail);
  assertExactSet([...inheritedRows.keys()], EXPECTED_INHERITED.map(([id]) => id), "inherited source reference IDs", fail);
  for (const [id, path, inheritedBlob, currentBlob, deltaState, disposition] of EXPECTED_INHERITED) {
    const row = inheritedRows.get(id);
    assertExactKeys(row, ["id", "path", "inheritedBlob", "currentBlob", "deltaState", "currentDisposition"], `inherited source reference ${id}`, fail);
    const expected = { id, path, inheritedBlob, currentBlob, deltaState, currentDisposition: disposition };
    for (const [field, value] of Object.entries(expected)) {
      if (row?.[field] !== value) fail(`inherited source reference ${id} ${field} drifted`);
    }
    assertRepositoryPath(path, `inherited source reference ${id}`, rootDir, fail, false);
  }
  const measuredDelta = { same: 0, changed: 0, absent: 0 };
  for (const row of inheritedRows.values()) {
    if (Object.hasOwn(measuredDelta, row?.deltaState)) measuredDelta[row.deltaState] += 1;
  }
  for (const [key, value] of Object.entries(measuredDelta)) {
    if (value !== expectedDelta[key]) fail(`measured inherited ${key} count must be ${expectedDelta[key]}`);
  }

  const currentRows = indexById(inventory?.currentSourceRefs, "current source reference", fail);
  assertExactSet([...currentRows.keys()], Object.keys(EXPECTED_CURRENT_PATHS), "current source reference IDs", fail);
  for (const [id, expectedPath] of Object.entries(EXPECTED_CURRENT_PATHS)) {
    const row = currentRows.get(id);
    assertExactKeys(row, ["id", "path", "blob", "kind", "description"], `current source reference ${id}`, fail);
    if (row?.path !== expectedPath) fail(`current source reference ${id} path drifted`);
    if (!/^[0-9a-f]{40}$/u.test(String(row?.blob || ""))) fail(`current source reference ${id} blob must be a Git object id`);
    assertText(row?.kind, `current source reference ${id} kind`, fail);
    assertText(row?.description, `current source reference ${id} description`, fail);
    assertRepositoryPath(row?.path, `current source reference ${id}`, rootDir, fail, true);
  }

  const usedSourceRefs = new Set();
  for (const [collectionName, config] of Object.entries(COLLECTIONS)) {
    const rows = indexById(inventory?.[collectionName], collectionName, fail);
    assertExactSet([...rows.keys()], config.ids, `${collectionName} IDs`, fail);
    for (const row of rows.values()) {
      assertExactKeys(row, config.keys, `${collectionName} ${row?.id}`, fail);
      validateDecisionState(row, `${collectionName} ${row?.id}`, fail);
      assertNonEmptyStrings(row?.sourceRefs, `${collectionName} ${row?.id} sourceRefs`, fail);
      for (const sourceRef of row?.sourceRefs || []) {
        if (!currentRows.has(sourceRef)) fail(`${collectionName} ${row?.id} references missing current source ${String(sourceRef)}`);
        usedSourceRefs.add(sourceRef);
      }
    }
  }
  assertExactSet([...usedSourceRefs], Object.keys(EXPECTED_CURRENT_PATHS), "used current source references", fail);

  validateCollectionFields(inventory, fail);
  validateRawPacket(rawInventory, decisionText, fail);
  validateDecisionDocument(decisionText, fail);

  if (verifyRepository) {
    verifyGitBindings(inventory, rootDir, fail);
    verifyAnchoredFacts(rootDir, fail);
  }

  return [...new Set(failures)].sort();
}

export function scanPublicPacket(raw, label = "packet") {
  const failures = [];
  const patterns = [
    [/(?:^|[\s"'`(])[A-Za-z]:[\\/]/mu, "Windows absolute path"],
    [/(?:^|[\s"'`(])\\\\[^\s\\]+\\/mu, "UNC path"],
    [/\bfile:\/\//iu, "file URI"],
    [/\.artifacts[\\/]operations/iu, "private artifact path"],
    [/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\b/iu, "local endpoint"],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu, "email address"],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu, "UUID-like private identifier"],
    [/\b\d{17,20}\b/u, "long numeric provider identifier"],
    [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}\b/u, "Supabase key"],
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/u, "JWT-like token"],
    [/https:\/\/[^\s/:]+:[^\s/@]+@/iu, "credential-bearing URL"],
    [/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/iu, "webhook credential"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, "private key"],
    [/(?:[?&](?:token|sig|signature|key|secret|auth)=)[^&\s"']+/iu, "credential query value"],
  ];
  for (const [pattern, description] of patterns) {
    if (pattern.test(String(raw || ""))) failures.push(`${label} contains forbidden ${description}`);
  }
  if (/"(?:secretValue|accessToken|refreshToken|clientSecret|password|privateAccountId|providerAccountId|projectId|tenantId|subscriptionId)"\s*:/iu.test(String(raw || ""))) {
    failures.push(`${label} contains a forbidden secret or private-identifier field`);
  }
  return failures;
}

function validateCollectionFields(inventory, fail) {
  for (const row of inventory?.routeFindings || []) {
    for (const field of ["surface", "route", "sourceState", "observedFact"]) assertText(row?.[field], `routeFindings ${row?.id} ${field}`, fail);
  }
  for (const row of inventory?.integrationFindings || []) {
    for (const field of ["sourceState", "observedFact"]) assertText(row?.[field], `integrationFindings ${row?.id} ${field}`, fail);
  }
  for (const row of inventory?.dataFlows || []) {
    assertText(row?.surface, `dataFlows ${row?.id} surface`, fail);
    assertNonEmptyStrings(row?.subjects, `dataFlows ${row?.id} subjects`, fail);
    assertNonEmptyStrings(row?.purpose, `dataFlows ${row?.id} purpose`, fail);
    for (const field of ["dataCategories", "sources", "destinations"]) {
      const mustRemainUnknown = row?.id === "future-mobile-and-game" || (row?.id === "external-embeds-and-links" && field === "dataCategories");
      if (mustRemainUnknown) {
        if (row?.[field] !== null) fail(`dataFlows ${row?.id} ${field} must remain null`);
      } else {
        assertNonEmptyStrings(row?.[field], `dataFlows ${row?.id} ${field}`, fail);
      }
    }
    for (const field of ["legalBasis", "deletion", "backup", "transfer"]) {
      if (row?.[field] !== null) fail(`dataFlows ${row?.id} ${field} must remain null pending evidence`);
    }
    if (row?.id === "raffle-and-spinner") assertText(row?.retention, `dataFlows ${row.id} source retention`, fail);
    else if (row?.retention !== null) fail(`dataFlows ${row?.id} retention must remain null pending evidence`);
  }
  for (const row of inventory?.publicClaims || []) {
    for (const field of ["claim", "sourceObservation", "conflict"]) assertText(row?.[field], `publicClaims ${row?.id} ${field}`, fail);
  }
  for (const row of inventory?.retentionDeletion || []) {
    assertText(row?.surface, `retentionDeletion ${row?.id} surface`, fail);
    assertText(row?.sourceRule, `retentionDeletion ${row?.id} sourceRule`, fail);
    if (row?.runtimeVerified !== false) fail(`retentionDeletion ${row?.id} runtimeVerified must remain false`);
    if (row?.legalHoldRule !== null || row?.backupRule !== null) fail(`retentionDeletion ${row?.id} hold and backup rules must remain null`);
  }
  const rightsUnknownFields = ["intake", "identityVerification", "deadline", "appeal", "authorizedAgent", "providerPropagation", "evidenceTest"];
  for (const row of inventory?.rightsFindings || []) {
    assertText(row?.right, `rightsFindings ${row?.id} right`, fail);
    assertNonEmptyStrings(row?.surfaces, `rightsFindings ${row?.id} surfaces`, fail);
    for (const field of rightsUnknownFields) {
      if (row?.[field] !== null) fail(`rightsFindings ${row?.id} ${field} must remain null pending evidence`);
    }
  }
  const providerUnknownFields = ["contractDpa", "currentSubprocessorList", "regions", "transferMechanism", "deletionReturnTerms", "securityEvidence"];
  for (const row of inventory?.providers || []) {
    for (const field of ["provider", "sourceRole", "state"]) assertText(row?.[field], `providers ${row?.id} ${field}`, fail);
    for (const field of providerUnknownFields) {
      if (row?.[field] !== null) fail(`providers ${row?.id} ${field} must remain null without sanitized immutable evidence`);
    }
  }
  for (const row of inventory?.approvalGates || []) {
    assertText(row?.category, `approvalGates ${row?.id} category`, fail);
    assertNonEmptyStrings(row?.requirements, `approvalGates ${row?.id} requirements`, fail);
  }
}

function validateRawPacket(rawInventory, decisionText, fail) {
  for (const issue of scanPublicPacket(rawInventory, "inventory")) fail(issue);
  for (const issue of scanPublicPacket(decisionText, "decision document")) fail(issue);
  if (/"(?:READY|APPROVED|COMPLETE)"/u.test(String(rawInventory || ""))) fail("inventory contains a fabricated terminal status");
  if (/\b(?:TBD|UNKNOWN|TO BE DETERMINED)\b/iu.test(String(rawInventory || ""))) fail("inventory contains a placeholder instead of null plus an explicit blocker");
  if (/"(?:candidateRedline|draftLegalCopy|publicLegalCopy|legalText)"\s*:/iu.test(String(rawInventory || ""))) fail("inventory contains public legal copy or a candidate redline field");
}

function validateDecisionDocument(text, fail) {
  const required = [
    "Status: `SOURCE_ONLY_INCOMPLETE`",
    `Protected-main commit: \`${ANCHOR_COMMIT}\``,
    `Protected-main tree: \`${ANCHOR_TREE}\``,
    "17 byte-identical references",
    "9 changed references",
    "10 references absent",
    "`completeness` is `false`",
    "`activationEffect` is `none`",
    "provider readback is `false`",
    "counsel review is `false`",
    "not legal advice",
  ];
  for (const fragment of required) {
    if (!String(text || "").includes(fragment)) fail(`decision document is missing required boundary: ${fragment}`);
  }
  if (/^##?\s+(?:Draft|Proposed|Candidate)\s+(?:Privacy|Terms|Legal)/imu.test(String(text || ""))) {
    fail("decision document contains candidate public legal copy");
  }
}

function verifyGitBindings(inventory, rootDir, fail) {
  const anchorTreeResult = runGit(rootDir, ["rev-parse", `${ANCHOR_COMMIT}^{tree}`]);
  if (!anchorTreeResult.ok || anchorTreeResult.stdout !== ANCHOR_TREE) fail("protected-main anchor commit/tree is unavailable or changed");

  for (const row of inventory?.currentSourceRefs || []) {
    const anchored = runGit(rootDir, ["rev-parse", `${ANCHOR_COMMIT}:${row?.path}`]);
    if (!anchored.ok || anchored.stdout !== row?.blob) fail(`current source reference ${row?.id} does not match its protected-main blob`);
    const working = runGit(rootDir, ["hash-object", "--", row?.path]);
    if (!working.ok || working.stdout !== row?.blob) fail(`current source reference ${row?.id} working bytes drifted from the anchor`);
  }

  const inheritedAvailable = runGit(rootDir, ["cat-file", "-e", `${INHERITED_COMMIT}^{commit}`]).ok;
  if (inheritedAvailable) {
    const inheritedTree = runGit(rootDir, ["rev-parse", `${INHERITED_COMMIT}^{tree}`]);
    if (!inheritedTree.ok || inheritedTree.stdout !== INHERITED_TREE) fail("available inherited packet commit/tree does not match the sealed identity");
    for (const row of inventory?.inheritedSourceRefs || []) {
      const inheritedBlob = runGit(rootDir, ["rev-parse", `${INHERITED_COMMIT}:${row?.path}`]);
      if (!inheritedBlob.ok || inheritedBlob.stdout !== row?.inheritedBlob) fail(`inherited source reference ${row?.id} does not match its inherited blob`);
    }
  }
}

function verifyAnchoredFacts(rootDir, fail) {
  for (const path of ["apps/web/app/privacy/page.tsx", "apps/web/app/contact/page.tsx", "apps/web/app/data-deletion/page.tsx"]) {
    if (runGit(rootDir, ["cat-file", "-e", `${ANCHOR_COMMIT}:${path}`]).ok) fail(`expected absent Website route exists at anchor: ${path}`);
  }

  const footer = readSource(rootDir, EXPECTED_CURRENT_PATHS["website-footer"], fail);
  for (const route of ["/privacy", "/terms", "/contact", "/data-deletion"]) {
    if (new RegExp(`href=["']${escapeRegex(route)}["']`, "u").test(footer)) fail(`Website footer unexpectedly links ${route}`);
  }

  const shell = readSource(rootDir, EXPECTED_CURRENT_PATHS["website-shell-observability"], fail);
  for (const fragment of ["@vercel/analytics/next", "@vercel/speed-insights/next", "<Analytics />", "<SpeedInsights />"]) {
    if (!shell.includes(fragment)) fail(`Website shell observation drifted: ${fragment}`);
  }

  const privacy = readSource(rootDir, EXPECTED_CURRENT_PATHS["social-privacy-contract"], fail);
  const socialContactHref = ['href="https://mochirii', '.com/contact"'].join("");
  if (!privacy.includes(socialContactHref)) fail("Social privacy source no longer points to the observed Website contact route");

  const galleryFeed = readSource(rootDir, EXPECTED_CURRENT_PATHS["gallery-feed-function"], fail);
  for (const fragment of ["const SIGNED_URL_SECONDS = 60 * 60", "createSignedUrls(paths, SIGNED_URL_SECONDS)", "uploader_display_name", "uploader_discord_name"]) {
    if (!galleryFeed.includes(fragment)) fail(`Gallery feed observation drifted: ${fragment}`);
  }

  const galleryDelete = readSource(rootDir, EXPECTED_CURRENT_PATHS["gallery-delete-function"], fail);
  const objectDeleteIndex = galleryDelete.indexOf(".remove([storagePath])");
  const rowDeleteIndex = galleryDelete.indexOf(".delete()", objectDeleteIndex + 1);
  if (objectDeleteIndex < 0 || rowDeleteIndex <= objectDeleteIndex) fail("Gallery rejected cleanup no longer deletes Storage before the database row");
  if (!galleryDelete.includes("The Storage object was removed, but the rejected submission row could not be deleted.")) fail("Gallery rejected cleanup partial-failure observation drifted");

  const discordIngress = readSource(rootDir, EXPECTED_CURRENT_PATHS["gallery-discord-ingress"], fail);
  for (const fragment of ["discord_guild_id: guildId", "discord_channel_id: channelId", "discord_message_id: messageId", "discord_attachment_id: attachmentId", "discord_user_id: discordUserId", "instagram_opt_in_copy_version"]) {
    if (!discordIngress.includes(fragment)) fail(`Discord Gallery ingress observation drifted: ${fragment}`);
  }
  const discordSchema = readSource(rootDir, EXPECTED_CURRENT_PATHS["gallery-discord-schema"], fail);
  for (const field of ["discord_guild_id", "discord_channel_id", "discord_message_id", "discord_attachment_id", "discord_user_id"]) {
    if (!discordSchema.includes(field)) fail(`Discord Gallery schema observation drifted: ${field}`);
  }

  const pixelfed = readSource(rootDir, EXPECTED_CURRENT_PATHS["social-pixelfed-config"], fail);
  if (!/'account_deletion'\s*=>\s*env\('ACCOUNT_DELETION',\s*true\)/u.test(pixelfed)) fail("Social account-deletion source default is no longer enabled");
  if (!/'account_delete_after'\s*=>\s*env\('ACCOUNT_DELETE_AFTER',\s*false\)/u.test(pixelfed)) fail("Social account-deletion delay source default drifted");

  const siteController = readSource(rootDir, EXPECTED_CURRENT_PATHS["social-site-controller"], fail);
  const mobileController = readSource(rootDir, EXPECTED_CURRENT_PATHS["social-mobile-controller"], fail);
  for (const source of [siteController, mobileController]) {
    if (!source.includes("Page::whereSlug($slug)->whereActive(true)->first()")) fail("Social terms database-page source observation drifted");
    if (!source.includes("$slug = '/site/terms'")) fail("Social terms slug observation drifted");
  }
  if (!siteController.includes("$slug = '/site/legal-notice'")) fail("Social legal-notice database-only route observation drifted");

  const spinnerReceipt = readSource(rootDir, EXPECTED_CURRENT_PATHS["spinner-retention"], fail);
  const spinnerMedia = readSource(rootDir, EXPECTED_CURRENT_PATHS["spinner-media-retention"], fail);
  if (!spinnerReceipt.includes("Spinner draw receipts must be retained for 30 days.")) fail("spinner receipt source retention observation drifted");
  if (!spinnerMedia.includes("Spinner media jobs must be retained for 30 days.")) fail("spinner media source retention observation drifted");

  const spinnerPage = readSource(rootDir, EXPECTED_CURRENT_PATHS["spinner-page-auth"], fail);
  const spinnerSession = readSource(rootDir, EXPECTED_CURRENT_PATHS["spinner-session-route"], fail);
  const spinnerLive = readSource(rootDir, EXPECTED_CURRENT_PATHS["spinner-live-route"], fail);
  const spinnerMediaRoute = readSource(rootDir, EXPECTED_CURRENT_PATHS["spinner-media-route"], fail);
  const spinnerPolicy = readSource(rootDir, EXPECTED_CURRENT_PATHS["spinner-session-policy"], fail);
  if (!spinnerPage.includes("if (!access.ok) notFound()")) fail("spinner page authorization observation drifted");
  if (!spinnerSession.includes("authorizeAndSetCookie")) fail("spinner session authorization observation drifted");
  if (!spinnerLive.includes('session.mode !== "controller"')) fail("spinner controller authorization observation drifted");
  if (!spinnerMediaRoute.includes("mediaCapabilityFromRequest") || !spinnerMediaRoute.includes("authorizedManifest(capability)")) fail("spinner media authorization observation drifted");
  if (!spinnerPolicy.includes("validateSpinnerModeratorToken") || !spinnerPolicy.includes('mode: "controller"')) fail("spinner session policy observation drifted");

  try {
    const raffle = JSON.parse(readSource(rootDir, EXPECTED_CURRENT_PATHS["raffle-source"], fail));
    if (raffle?.publicView?.cycleStatus !== "inactive") fail("raffle cycle is no longer source-inactive");
    if (raffle?.publicView?.standardEntryStatus !== "closed" || raffle?.publicView?.bonusEntryStatus !== "closed") fail("raffle entries are no longer source-closed");
    if (raffle?.publicView?.publicReward !== null) fail("raffle public reward is no longer null");
    if (raffle?.rules?.currentRulesState !== "inactive") fail("raffle current rules are no longer source-inactive");
  } catch (error) {
    fail(`raffle source is not valid JSON: ${error.message}`);
  }
}

function validateDecisionState(row, label, fail) {
  if (!ALLOWED_STATUSES.includes(row?.status)) fail(`${label} has invalid status ${String(row?.status)}`);
  assertStringArray(row?.evidenceNeeded, `${label} evidenceNeeded`, fail);
  const hasValueField = Boolean(row && Object.hasOwn(row, "value"));
  if (row?.status === "SOURCE_OBSERVED" || row?.status === "NOT_APPLICABLE_REVIEWED") {
    if (hasValueField && (row?.value === null || row?.value === undefined)) fail(`${label} observed or reviewed value must be explicit`);
    if (row?.owner !== null || row?.question !== null || row?.evidenceNeeded?.length !== 0) fail(`${label} observed or reviewed state must use null owner/question and empty evidenceNeeded`);
  } else {
    if (hasValueField && row?.value !== null) fail(`${label} unresolved value must remain null`);
    assertText(row?.owner, `${label} owner`, fail);
    assertText(row?.question, `${label} question`, fail);
    assertNonEmptyStrings(row?.evidenceNeeded, `${label} evidenceNeeded`, fail);
  }
}

function indexById(rows, label, fail) {
  const result = new Map();
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(`${label} collection must be a non-empty array`);
    return result;
  }
  for (const row of rows) {
    assertId(row?.id, `${label} id`, fail);
    if (result.has(row?.id)) fail(`${label} id ${String(row?.id)} is duplicated`);
    result.set(row?.id, row);
  }
  return result;
}

function assertExactKeys(value, expectedKeys, label, fail) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
    return;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} keys must be exactly ${expected.join(", ")}; found ${actual.join(", ")}`);
}

function assertExactArray(actual, expected, label, fail) {
  if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} must match the sealed ordered values`);
}

function assertExactSet(actual, expected, label, fail) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) fail(`${label} must match the sealed ID set`);
}

function assertId(value, label, fail) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) fail(`${label} must be lowercase kebab-case`);
}

function assertText(value, label, fail) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) fail(`${label} must be non-empty trimmed text`);
}

function assertStringArray(values, label, fail) {
  if (!Array.isArray(values)) {
    fail(`${label} must be an array`);
    return;
  }
  for (const value of values) assertText(value, `${label} item`, fail);
}

function assertNonEmptyStrings(values, label, fail) {
  assertStringArray(values, label, fail);
  if (!Array.isArray(values) || values.length === 0) fail(`${label} must be non-empty`);
}

function assertRepositoryPath(value, label, rootDir, fail, mustExist) {
  assertText(value, `${label} path`, fail);
  if (typeof value !== "string") return;
  if (isAbsolute(value) || value.split(/[\\/]/u).includes("..") || value.includes("\\")) {
    fail(`${label} path must be normalized and repository-relative`);
    return;
  }
  const absolute = resolve(rootDir, value);
  const rel = relative(rootDir, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`)) fail(`${label} path escapes the repository`);
  if (mustExist && (!existsSync(absolute) || !statSync(absolute).isFile())) fail(`${label} path does not identify a file: ${value}`);
}

function runGit(rootDir, args) {
  const result = spawnSync("git", args, { cwd: rootDir, encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, stdout: String(result.stdout || "").trim() };
}

function readSource(rootDir, path, fail) {
  try {
    return readFileSync(resolve(rootDir, path), "utf8");
  } catch (error) {
    fail(`cannot read anchored source ${path}: ${error.message}`);
    return "";
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function readPacket() {
  const rawInventory = readFileSync(INVENTORY_PATH, "utf8");
  return {
    inventory: JSON.parse(rawInventory),
    rawInventory,
    decisionText: readFileSync(DECISION_PATH, "utf8"),
  };
}

function main() {
  let packet;
  try {
    packet = readPacket();
  } catch (error) {
    console.error(`Legal and privacy current-main check failed.\n- Packet read or JSON parse failed: ${error.message}`);
    process.exit(1);
  }
  const failures = validatePacket({ ...packet, rootDir: ROOT, verifyRepository: true });
  if (failures.length) {
    console.error("Legal and privacy current-main check failed.");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  const statusCounts = new Map(ALLOWED_STATUSES.map((status) => [status, 0]));
  for (const collectionName of Object.keys(COLLECTIONS)) {
    for (const row of packet.inventory[collectionName]) statusCounts.set(row.status, statusCounts.get(row.status) + 1);
  }
  console.log("Legal and privacy current-main source inventory OK.");
  console.log(`- Anchor: ${ANCHOR_COMMIT} / ${ANCHOR_TREE}`);
  console.log("- Inherited refs: 36 (17 same, 9 changed, 10 absent)");
  console.log(`- Current exact-blob refs: ${packet.inventory.currentSourceRefs.length}`);
  for (const status of ALLOWED_STATUSES) console.log(`- ${status}: ${statusCounts.get(status)}`);
  console.log("- Completeness: false");
  console.log("- Activation effect: none");
  console.log("- Provider/runtime truth inferred: no");
  console.log("- Legal advice, public copy, or approval inferred: no");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
