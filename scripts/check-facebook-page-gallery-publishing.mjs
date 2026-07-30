import { existsSync, readFileSync } from "node:fs";

const failures = [];
const required = [
  "docs/integrations/facebook-page-gallery-publishing.md",
  "docs/instagram-gallery-publishing-deployment-runbook.md",
  "supabase/functions/_shared/facebook-page-publishing.ts",
  "supabase/functions/_shared/meta-graph-security.ts",
  "supabase/functions/_shared/meta-provider-diagnostic.ts",
  "supabase/functions/_shared/safe-telemetry.ts",
  "supabase/functions/_shared/social-publication-copy.ts",
  "supabase/functions/_shared/social-publication-confirmation.ts",
  "supabase/functions/check-facebook-page-api-status/index.ts",
  "supabase/functions/list-facebook-page-publish-queue/index.ts",
  "supabase/functions/publish-facebook-page-gallery-submission/index.ts",
  "supabase/functions/resolve-facebook-page-publish-reconciliation/index.ts",
];

for (const file of required) {
  if (!existsSync(file)) failures.push(`Missing ${file}`);
}

const read = (file) => existsSync(file) ? readFileSync(file, "utf8") : "";
const publisher = read(
  "supabase/functions/_shared/facebook-page-publishing.ts",
);
const security = read("supabase/functions/_shared/meta-graph-security.ts");
const copyPolicy = read(
  "supabase/functions/_shared/social-publication-copy.ts",
);
const diagnostic = read(
  "supabase/functions/_shared/meta-provider-diagnostic.ts",
);
const publishEndpoint = read(
  "supabase/functions/publish-facebook-page-gallery-submission/index.ts",
);
const reconcile = read(
  "supabase/functions/resolve-facebook-page-publish-reconciliation/index.ts",
);
const status = read(
  "supabase/functions/check-facebook-page-api-status/index.ts",
);
const docs = read("docs/integrations/facebook-page-gallery-publishing.md");
const runbook = read(
  "docs/instagram-gallery-publishing-deployment-runbook.md",
);
const production = [
  publisher,
  security,
  diagnostic,
  publishEndpoint,
  reconcile,
  status,
].join("\n");

function requireText(text, needle, label) {
  if (!text.includes(needle)) failures.push(`Missing ${label}: ${needle}`);
}
function forbidText(text, needle, label) {
  if (text.includes(needle)) failures.push(`Forbidden ${label}: ${needle}`);
}

requireText(security, 'META_GRAPH_API_VERSION = "v26.0"', "Graph v26 pin");
requireText(security, "accessToken}|${appsecretTime}", "timed proof payload");
requireText(security, 'headers.set("Authorization"', "bearer transport");
requireText(security, 'redirect: "error"', "redirect rejection");
requireText(security, "AbortSignal.any", "non-bypassable timeout");
requireText(security, "fetchMetaGraphOnce", "single-attempt wrapper");
requireText(
  security,
  "meta_token_debug_query_transport_not_approved",
  "debugger blocker",
);
requireText(publisher, 'Deno.env.get("META_EXPECTED_APP_ID")', "app id pin");
requireText(
  publisher,
  'Deno.env.get("FACEBOOK_EXPECTED_PAGE_ID")',
  "Page id pin",
);
requireText(
  publisher,
  'Deno.env.get("FACEBOOK_PAGE_PUBLISH_ENABLED")',
  "activation flag",
);
requireText(publisher, "/photos", "Page Photos endpoint");
requireText(
  copyPolicy,
  "social_publication_url_reference_forbidden",
  "destination-wide no-URL policy",
);
requireText(
  publisher,
  "id,from{id},permalink_url,link",
  "ownership readback",
);
requireText(
  publishEndpoint,
  "confirm_facebook_publish === true",
  "explicit publish confirmation",
);
requireText(
  publishEndpoint,
  "expected_updated_at",
  "revision binding",
);
requireText(
  publishEndpoint,
  "confirmation_fingerprint",
  "fingerprint request",
);
requireText(
  publishEndpoint,
  "socialPublicationConfirmationFingerprint",
  "server fingerprint recomputation",
);
requireText(
  publisher,
  "p_confirmation_fingerprint",
  "atomic RPC confirmation binding",
);
requireText(
  reconcile,
  "facebookPageObjectEvidence",
  "provider ownership reconciliation",
);
requireText(
  diagnostic,
  "tokenDebuggerCalled: false",
  "zero debugger calls",
);
requireText(docs, "manual Page-to-Group", "manual Group handoff");
requireText(docs, "website/link field stays empty", "empty profile link");
requireText(docs, "support@mochirii.com", "public support contact");
requireText(docs, "v26.0", "documented API version");
requireText(runbook, "website consent v3", "current consent contract");
requireText(runbook, "pinned to `v26.0`", "runbook API pin");
requireText(
  runbook,
  "Sharing a verified Page post into the Guild group is manual",
  "runbook manual Group handoff",
);
requireText(
  runbook,
  "Facebook and Instagram public profile link fields remain empty",
  "link-free Meta profiles",
);

forbidText(production, "FACEBOOK_CANONICAL_PAGE_ID", "tracked Page id");
forbidText(production, "META_CANONICAL_APP_ID", "tracked app id");
forbidText(production, "v25.0", "old API version");
forbidText(status, "debug_token", "token debugger call");
forbidText(production, "console.error", "unsafe raw error logging");
forbidText(production, "console.warn", "unsafe raw warning logging");
forbidText(publisher, "mochirii-gallery-${jobId}", "private id in filename");
forbidText(production, "/groups/", "Groups API path");
forbidText(runbook, "v25.0", "stale runbook API version");
forbidText(runbook, "shared_manually", "retired manual-completion state");
if (/\b\d{8,}\b/u.test(runbook)) {
  failures.push("Forbidden runbook numeric provider or platform identifier");
}

if (failures.length) {
  console.error("Facebook Page gallery publishing validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    "Facebook Page gallery publishing validation passed (v26 pin, runtime ids, timed proof, confirmation, reconciliation, and manual Group handoff).",
  );
}
