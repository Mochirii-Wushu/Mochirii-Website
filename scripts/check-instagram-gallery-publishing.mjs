import { existsSync, readFileSync } from "node:fs";

const failures = [];
const required = [
  "docs/integrations/instagram-gallery-publishing.md",
  "docs/instagram-gallery-publishing-deployment-runbook.md",
  "supabase/functions/_shared/instagram-publishing.ts",
  "supabase/functions/_shared/meta-graph-security.ts",
  "supabase/functions/_shared/meta-provider-diagnostic.ts",
  "supabase/functions/_shared/social-publication-copy.ts",
  "supabase/functions/_shared/social-publication-confirmation.ts",
  "supabase/functions/check-instagram-api-status/index.ts",
  "supabase/functions/list-instagram-publish-queue/index.ts",
  "supabase/functions/publish-instagram-gallery-submission/index.ts",
  "supabase/functions/resolve-instagram-publish-reconciliation/index.ts",
  "supabase/functions/mark-instagram-gallery-submission-shared/index.ts",
  "supabase/functions/withdraw-gallery-publication-consent/index.ts",
];
for (const file of required) {
  if (!existsSync(file)) failures.push(`Missing ${file}`);
}

const read = (file) => existsSync(file) ? readFileSync(file, "utf8") : "";
const publisher = read("supabase/functions/_shared/instagram-publishing.ts");
const security = read("supabase/functions/_shared/meta-graph-security.ts");
const copyPolicy = read(
  "supabase/functions/_shared/social-publication-copy.ts",
);
const diagnostic = read(
  "supabase/functions/_shared/meta-provider-diagnostic.ts",
);
const publishEndpoint = read(
  "supabase/functions/publish-instagram-gallery-submission/index.ts",
);
const reconcile = read(
  "supabase/functions/resolve-instagram-publish-reconciliation/index.ts",
);
const status = read("supabase/functions/check-instagram-api-status/index.ts");
const stub = read(
  "supabase/functions/mark-instagram-gallery-submission-shared/index.ts",
);
const withdrawal = read(
  "supabase/functions/withdraw-gallery-publication-consent/index.ts",
);
const docs = read("docs/integrations/instagram-gallery-publishing.md");
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
  stub,
  withdrawal,
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
requireText(security, "AbortSignal.any", "non-bypassable timeout");
requireText(
  security,
  "meta_token_debug_query_transport_not_approved",
  "debugger blocker",
);
requireText(
  publisher,
  'Deno.env.get("INSTAGRAM_EXPECTED_ACCOUNT_ID")',
  "account id pin",
);
requireText(
  status,
  "readInstagramPageLinkageOnce",
  "Facebook Page to Instagram linkage read",
);
requireText(
  status,
  "pageConfig.expectedPageId",
  "independently pinned Facebook Page linkage",
);
requireText(
  diagnostic,
  'fields: "id,instagram_business_account"',
  "official Page linkage field",
);
requireText(
  publisher,
  'Deno.env.get("INSTAGRAM_PUBLISH_ENABLED")',
  "activation flag",
);
requireText(
  publisher,
  "content_publishing_limit",
  "dynamic quota query",
);
requireText(
  publisher,
  "normalizeInstagramContainerStatusCode",
  "closed container-status normalizer",
);
requireText(
  publisher,
  'statusCode: "UNKNOWN"',
  "unknown container-status redaction",
);
requireText(
  publisher,
  'action: "reconcile_required"',
  "unknown container-status reconciliation",
);
requireText(
  publisher,
  'error: "container_in_progress"',
  "in-progress container reconciliation",
);
requireText(
  publisher,
  "readContainerStatusOnce",
  "single container-status read",
);
requireText(
  copyPolicy,
  "social_publication_url_reference_forbidden",
  "destination-wide no-URL policy",
);
requireText(publisher, "/media_publish", "container publish endpoint");
requireText(
  publisher,
  "id,owner,username,permalink,media_type",
  "official media ownership readback",
);
requireText(
  publishEndpoint,
  "confirm_instagram_publish === true",
  "correct Instagram wire flag",
);
requireText(
  publishEndpoint,
  "instagram_alt_text_required",
  "required alt text",
);
requireText(publishEndpoint, "expected_updated_at", "revision binding");
requireText(
  publishEndpoint,
  "confirmation_fingerprint",
  "fingerprint request",
);
requireText(
  publisher,
  "p_confirmation_fingerprint",
  "atomic RPC confirmation binding",
);
requireText(
  reconcile,
  "instagramMediaObjectEvidence",
  "provider-owned reconciliation",
);
requireText(
  diagnostic,
  'businessAccountSubtypeVerification: values.provider === "instagram"',
  "manual Business subtype prerequisite",
);
requireText(stub, "instagram_manual_share_disabled", "legacy 409 stub");
requireText(
  withdrawal,
  "gallery_withdraw_social_publication_consent",
  "withdrawal RPC",
);
requireText(docs, "v26.0", "documented API version");
requireText(docs, "website field empty", "Instagram website policy");
requireText(docs, "website/link field stays empty", "empty profile link");
requireText(docs, "support@mochirii.com", "public support contact");
requireText(runbook, "website consent v3", "current consent contract");
requireText(runbook, "pinned to `v26.0`", "runbook API pin");
requireText(
  runbook,
  "Both publishing flags remain `false`",
  "runbook disabled-by-default posture",
);
requireText(
  runbook,
  "authenticated `409` compatibility stub",
  "runbook legacy endpoint posture",
);
requireText(
  runbook,
  "public profile link fields remain empty",
  "link-free Meta profiles",
);

forbidText(production, "graph.instagram.com", "legacy Graph host");
forbidText(production, "instagramAppSecretProof", "legacy untimed proof");
forbidText(production, "v25.0", "old API version");
forbidText(status, "debug_token", "token debugger call");
forbidText(publisher, "account_type", "undocumented subtype query");
forbidText(status, "account_type", "undocumented subtype diagnostic");
forbidText(publisher, "CONTAINER_POLL_INTERVAL_MS", "rapid container polling");
forbidText(publisher, "CONTAINER_POLL_ATTEMPTS", "container polling loop");
forbidText(publisher, "sleepImpl", "in-request container polling sleep");
forbidText(production, "console.error", "unsafe raw error logging");
forbidText(production, "console.warn", "unsafe raw warning logging");
forbidText(runbook, "v25.0", "stale runbook API version");
forbidText(runbook, "shared_manually", "retired manual-completion state");
if (/\b\d{8,}\b/u.test(runbook)) {
  failures.push("Forbidden runbook numeric provider or platform identifier");
}

if (failures.length) {
  console.error("Instagram gallery publishing validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    "Instagram gallery publishing validation passed (v26 pin, quota, confirmation, ownership reconciliation, withdrawal, and safe diagnostics).",
  );
}
