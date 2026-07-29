import { existsSync, readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { SITE_ORIGIN, SOCIAL_HOST, SUPABASE_PROJECT_REF } from "./lib/public-urls.mjs";

const root = process.cwd();
const failures = [];
const warnings = [];
const notes = [];

const projectRef = process.env.SUPABASE_PROJECT_REF || SUPABASE_PROJECT_REF;
const expectedSiteUrl = process.env.PIXELFED_SUPABASE_SITE_URL || SITE_ORIGIN;
const expectedAuthorizationPath = "/oauth/consent";
const providerReady = process.env.PIXELFED_FIRST_LOGIN_PROVIDER_READY === "1";
const stagingReady = process.env.PIXELFED_FIRST_LOGIN_STAGING_READY === "1";

const requiredFiles = [
  "docs/pixelfed-guild-social-adr.md",
  "docs/pixelfed-first-login-testing.md",
  "docs/pixelfed-staging-ops.md",
  "apps/web/app/social/page.tsx",
  "apps/web/app/oauth/consent/page.tsx",
  "apps/web/app/api/oauth/decision/route.ts",
  "apps/web/components/member-workflow/SocialHubPanel.tsx",
  "apps/web/components/member-workflow/OAuthConsentPanel.tsx",
  "apps/web/lib/oauth/authorization-details-error.ts",
  "apps/web/lib/oauth/authorization-load-queue.ts",
  "apps/web/lib/oauth/authorization-load-queue.test.mts",
  "apps/web/lib/oauth/consent-login-url.ts",
  "apps/web/lib/oauth/consent-login-url.test.mts",
  "apps/web/lib/oauth/prior-consent-redirect.ts",
  "apps/web/lib/oauth/prior-consent-redirect.test.mts",
  "apps/web/lib/supabase/client.ts",
  "apps/web/lib/supabase/social.ts",
  "supabase/migrations/20260702080720_add_pixelfed_social_accounts.sql",
  "supabase/functions/sync-pixelfed-social-account/index.ts",
  "supabase/functions/_shared/pixelfed-social-sync.ts",
  "supabase/functions/_shared/pixelfed-social-sync_test.ts",
  "supabase/functions/_shared/member-access-policy.ts",
  "supabase/functions/_shared/member-access-policy_test.ts",
];

const snippetChecks = [
  {
    label: "Pixelfed ADR",
    file: "docs/pixelfed-guild-social-adr.md",
    snippets: [
      "social.mochirii.com",
      "Supabase OAuth 2.1 Server",
      "Authorization Path is `/oauth/consent`",
      "provider mutations",
      "federation disabled",
      "Superseded on 2026-07-29",
      "integrations/mochirii-social-delivery.md",
    ],
  },
  {
    label: "first login runbook",
    file: "docs/pixelfed-first-login-testing.md",
    snippets: [
      `Approve Supabase db push for project ${SUPABASE_PROJECT_REF} migration 20260702080720.`,
      `Approve enabling Supabase OAuth 2.1 Server for project ${SUPABASE_PROJECT_REF} and setting Authorization Path /oauth/consent.`,
      "PIXELFED_FIRST_LOGIN_PROVIDER_READY",
      "PIXELFED_FIRST_LOGIN_STAGING_READY",
      "Closed registration.",
      "Federation disabled.",
      "Negative Smokes",
      "Never paste OAuth client secrets",
      "Superseded on 2026-07-29",
      "integrations/mochirii-social-delivery.md",
    ],
  },
  {
    label: "historical staging operations packet",
    file: "docs/pixelfed-staging-ops.md",
    snippets: [
      "Superseded on 2026-07-29",
      "historical evidence",
      "integrations/mochirii-social-delivery.md",
    ],
  },
  {
    label: "OAuth consent component",
    file: "apps/web/components/member-workflow/OAuthConsentPanel.tsx",
    snippets: [
      "getAuthorizationDetails",
      "authorization_id",
      "verifyMemberAccess",
      "profileIsActive",
      "activeMember",
      "createAuthorizationLoadQueue",
      "classifyAuthorizationDetailsFailure",
      "oauthConsentLoginHref",
      "priorConsentRedirect",
      "isApprovedSocialOAuthReturnDestination",
      "const SOCIAL_CLIENT_DISPLAY_NAME = \"Mōchirīī Social\"",
      "Guild Social Access",
      "Return destination",
      "Requested access",
      "Return to Mōchirīī Social and start again.",
      "/api/oauth/decision",
    ],
  },
  {
    label: "OAuth consent page",
    file: "apps/web/app/oauth/consent/page.tsx",
    snippets: [
      'title: "Mōchirīī Social Access"',
      'description: "Review access to Mōchirīī Social."',
      'ariaLabel="Guild social access"',
      'title="Connect Mōchirīī Social"',
      "Review the requested guild social access before continuing.",
    ],
  },
  {
    label: "OAuth authorization id round trip",
    file: "apps/web/lib/oauth/consent-login-url.test.mts",
    snippets: [
      "preserves the exact OAuth authorization id",
      "authorization ids cannot inject another redirect parameter",
    ],
  },
  {
    label: "OAuth browser client",
    file: "apps/web/lib/supabase/client.ts",
    snippets: [
      "createBrowserClient",
      'flowType: "pkce"',
      "detectSessionInUrl: false",
    ],
  },
  {
    label: "OAuth PKCE callback",
    file: "apps/web/app/auth/callback/route.ts",
    snippets: [
      "exchangeAuthCodeForCookieSession(supabase.auth, code)",
      "resolveAuthReturnPath",
      'getAll("code")',
    ],
  },
  {
    label: "OAuth authorization request queue",
    file: "apps/web/lib/oauth/authorization-load-queue.ts",
    snippets: [
      "createAuthorizationLoadQueue",
      "queued",
      "tail",
      "stop",
    ],
  },
  {
    label: "OAuth decision route",
    file: "apps/web/app/api/oauth/decision/route.ts",
    snippets: [
      "verify-member-access",
      "galleryEligible",
      "member_status",
      "submitAuthorizationDecision",
      "/oauth/authorizations/",
      "Authorization: `Bearer ${token}`",
      "action: decision",
      "private, no-store",
    ],
  },
  {
    label: "social doorway",
    file: "apps/web/components/member-workflow/SocialHubPanel.tsx",
    snippets: [
      "requireAuth",
      "window.location.assign(SOCIAL_HOST)",
      "Sign in to Mōchirīī before opening the guild social platform.",
      "Open Mōchirīī Social",
    ],
  },
  {
    label: "social account helper",
    file: "apps/web/lib/supabase/social.ts",
    snippets: [
      ".from(\"social_accounts\")",
      "profile_link_visible",
      "listMySocialAccounts",
    ],
  },
  {
    label: "social account migration",
    file: "supabase/migrations/20260702080720_add_pixelfed_social_accounts.sql",
    snippets: [
      "create table if not exists public.social_accounts",
      "alter table public.social_accounts enable row level security",
      "grant select on table public.social_accounts to authenticated",
      "grant update (profile_link_visible) on table public.social_accounts to authenticated",
      "grant all on table public.social_accounts to service_role",
      "using ((select auth.uid()) = user_id)",
      "with check ((select auth.uid()) = user_id)",
    ],
  },
  {
    label: "Pixelfed social sync Edge Function",
    file: "supabase/functions/sync-pixelfed-social-account/index.ts",
    snippets: [
      "PIXELFED_SOCIAL_SYNC_SECRET",
      "auth.admin.getUserById",
      "Promise.all([",
      ".from(\"member_profiles\")",
      ".from(\"social_accounts\")",
      "provider: \"pixelfed\"",
      "federation_enabled: false",
    ],
  },
  {
    label: "Pixelfed social sync validator",
    file: "supabase/functions/_shared/pixelfed-social-sync.ts",
    snippets: [
      "import { SOCIAL_ORIGIN } from \"./public-origins.ts\"",
      "`${SOCIAL_ORIGIN}/`",
      "PIXELFED_SOCIAL_SYNC_MAX_SKEW_MS",
      "constantTimeEquals",
      "parsePixelfedSocialSyncPayload",
    ],
  },
  {
    label: "package script",
    file: "package.json",
    snippets: [
      "\"check:pixelfed-first-login-readiness\": \"node scripts/check-pixelfed-first-login-readiness.mjs\"",
      "\"test:pixelfed-social-sync\"",
    ],
  },
  {
    label: "check-all coverage",
    file: "scripts/check-all.mjs",
    snippets: [
      "check:pixelfed-first-login-readiness",
      "scripts/check-pixelfed-first-login-readiness.mjs",
      "test:pixelfed-social-sync",
    ],
  },
];

const secretPatterns = [
  { label: "GitHub token", pattern: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { label: "Supabase PAT", pattern: /\bsbp_[A-Za-z0-9_-]{20,}\b/ },
  { label: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{12,}\b/ },
  { label: "JWT-like token", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
  { label: "database URL", pattern: /\bpostgres(?:ql)?:\/\/[^\s<>)]+/i },
  { label: "Discord webhook URL", pattern: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/ },
  { label: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/ },
  { label: "client secret assignment", pattern: /\bclient[_-]?secret\s*[:=]\s*\S{8,}/i },
  { label: "password assignment", pattern: /\bpassword\s*[:=]\s*\S{8,}/i },
];

const oauthDecisionRoute = read("apps/web/app/api/oauth/decision/route.ts");
if (!oauthDecisionRoute.includes("if (!response.ok || !redirectUrl)")) {
  if (!oauthDecisionRoute.includes("if (response.ok && redirectUrl)")) {
    failures.push("OAuth decision route must accept every successful HTTP 2xx response through Response.ok.");
  }
}
if (/response\.status\s*={2,3}\s*201/.test(oauthDecisionRoute)) {
  failures.push("OAuth decision route must not require the legacy HTTP 201 success status.");
}
for (const snippet of [
  'from "@/lib/supabase/server-fetch"',
  "fetch: supabaseServerFetch",
  "await supabaseServerFetch(endpoint",
]) {
  if (!oauthDecisionRoute.includes(snippet)) {
    failures.push(`OAuth decision route must use the bounded server transport: ${snippet}`);
  }
}

function read(file) {
  const full = path.join(root, file);
  if (!existsSync(full)) {
    failures.push(`${file}: missing required Pixelfed first-login file.`);
    return "";
  }

  return readFileSync(full, "utf8");
}

function assertIncludes(label, text, snippet) {
  if (!text.includes(snippet)) failures.push(`${label}: expected snippet not found: ${snippet}`);
}

function scanNoSecrets(file, text) {
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { label, pattern } of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) failures.push(`${file}:${index + 1}: possible secret pattern: ${label}`);
    }
  });
}

function env(name) {
  return (process.env[name] || "").trim();
}

function assertMarker(name, description) {
  if (env(name) !== "1") {
    failures.push(`${name}: set to 1 only after private verification of ${description}.`);
  }
}

function assertHttpsUrl(label, value, requiredPath) {
  if (!value) {
    failures.push(`${label}: required when staging readiness is asserted.`);
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") failures.push(`${label}: must use https.`);
    if (requiredPath && parsed.pathname !== requiredPath) {
      failures.push(`${label}: expected path ${requiredPath}, got ${parsed.pathname}.`);
    }
    return parsed;
  } catch {
    failures.push(`${label}: must be a valid URL.`);
    return null;
  }
}

async function fetchJson(label, url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      failures.push(`${label}: HTTP ${response.status}.`);
      return null;
    }
    return await response.json();
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : "request failed"}.`);
    return null;
  }
}

async function checkSupabaseProviderReadiness() {
  const token = env("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    failures.push("SUPABASE_ACCESS_TOKEN: required in child-process env when PIXELFED_FIRST_LOGIN_PROVIDER_READY=1.");
    return;
  }

  const config = await fetchJson(
    "Supabase auth config",
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (config) {
    if (config.oauth_server_enabled !== true) failures.push("Supabase auth config: oauth_server_enabled must be true.");
    if (config.oauth_server_authorization_path !== expectedAuthorizationPath) {
      failures.push(`Supabase auth config: oauth_server_authorization_path must be ${expectedAuthorizationPath}.`);
    }
    if (config.oauth_server_allow_dynamic_registration !== false) {
      failures.push("Supabase auth config: dynamic OAuth client registration must remain disabled unless separately approved.");
    }
    if (config.site_url !== expectedSiteUrl) {
      failures.push(`Supabase auth config: site_url must be ${expectedSiteUrl}, got ${config.site_url || "<missing>"}.`);
    }
  }

  const authBase = `https://${projectRef}.supabase.co/auth/v1`;
  const oauthDiscovery = await fetchJson(
    "Supabase OAuth authorization server discovery",
    `https://${projectRef}.supabase.co/.well-known/oauth-authorization-server/auth/v1`,
  );
  const oidcDiscovery = await fetchJson(
    "Supabase OIDC discovery",
    `${authBase}/.well-known/openid-configuration`,
  );

  if (oauthDiscovery) {
    if (oauthDiscovery.issuer !== authBase) failures.push("OAuth discovery: issuer mismatch.");
    if (oauthDiscovery.authorization_endpoint !== `${authBase}/oauth/authorize`) failures.push("OAuth discovery: authorization endpoint mismatch.");
    if (oauthDiscovery.token_endpoint !== `${authBase}/oauth/token`) failures.push("OAuth discovery: token endpoint mismatch.");
    if (oauthDiscovery.registration_endpoint) {
      failures.push("OAuth discovery: registration_endpoint should be absent while dynamic registration is disabled.");
    }
  }

  if (oidcDiscovery) {
    const expected = {
      issuer: authBase,
      authorization_endpoint: `${authBase}/oauth/authorize`,
      token_endpoint: `${authBase}/oauth/token`,
      userinfo_endpoint: `${authBase}/oauth/userinfo`,
      jwks_uri: `${authBase}/.well-known/jwks.json`,
    };

    for (const [key, value] of Object.entries(expected)) {
      if (oidcDiscovery[key] !== value) failures.push(`OIDC discovery: ${key} mismatch.`);
    }

    const scopes = Array.isArray(oidcDiscovery.scopes_supported) ? oidcDiscovery.scopes_supported : [];
    for (const scope of ["openid", "profile", "email"]) {
      if (!scopes.includes(scope)) failures.push(`OIDC discovery: missing ${scope} scope.`);
    }

    const methods = Array.isArray(oidcDiscovery.code_challenge_methods_supported)
      ? oidcDiscovery.code_challenge_methods_supported
      : [];
    if (!methods.includes("S256")) failures.push("OIDC discovery: missing S256 PKCE support.");
  }

  notes.push("Supabase OAuth provider readiness asserted from live read-only checks.");
}

async function checkPixelfedOAuthClientCredentialReadiness({ required = false } = {}) {
  const clientId = env("PIXELFED_OAUTH_CLIENT_ID");
  const oauthClientCredential = env("PIXELFED_OAUTH_CLIENT_SECRET");
  const tokenAuthMethod = env("PIXELFED_OAUTH_TOKEN_AUTH_METHOD") || "client_secret_post";
  const redirectUri = env("PIXELFED_OIDC_CALLBACK_URI") || `${SOCIAL_HOST}/auth/oidc/callback`;

  if (!clientId || !oauthClientCredential) {
    const message = "PIXELFED_OAUTH_CLIENT_ID and PIXELFED_OAUTH_CLIENT_SECRET env vars are required in child-process env for live OAuth client credential readiness.";
    if (required) failures.push(message);
    else warnings.push(message);
    return;
  }

  if (!["client_secret_post", "client_secret_basic"].includes(tokenAuthMethod)) {
    failures.push("PIXELFED_OAUTH_TOKEN_AUTH_METHOD: expected client_secret_post or client_secret_basic.");
    return;
  }

  const authBase = `https://${projectRef}.supabase.co/auth/v1`;
  const authorizeParams = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile email",
    state: "codex-redacted-state-check",
    code_challenge: "e9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
  });

  try {
    const authorizeResponse = await fetch(`${authBase}/oauth/authorize?${authorizeParams.toString()}`, {
      redirect: "manual",
    });
    const location = authorizeResponse.headers.get("location") || "";
    if (authorizeResponse.status !== 302) {
      failures.push(`Pixelfed OAuth client authorize smoke: expected HTTP 302, got ${authorizeResponse.status}.`);
    } else if (!location.startsWith(`${expectedSiteUrl}${expectedAuthorizationPath}?authorization_id=`)) {
      failures.push("Pixelfed OAuth client authorize smoke: redirect did not target the configured consent UI.");
    }
  } catch (error) {
    failures.push(`Pixelfed OAuth client authorize smoke: ${error instanceof Error ? error.message : "request failed"}.`);
    return;
  }

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: "codex-dummy-code",
    redirect_uri: redirectUri,
    code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  });
  const tokenHeaders = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (tokenAuthMethod === "client_secret_post") {
    tokenBody.set("client_id", clientId);
    tokenBody.set("client_secret", oauthClientCredential);
  } else {
    tokenHeaders.Authorization = `Basic ${Buffer.from(`${clientId}:${oauthClientCredential}`, "utf8").toString("base64")}`;
  }

  try {
    const tokenResponse = await fetch(`${authBase}/oauth/token`, {
      method: "POST",
      headers: tokenHeaders,
      body: tokenBody,
    });
    const tokenJson = await tokenResponse.json().catch(() => ({}));
    const errorCode = tokenJson.error || tokenJson.error_code || "";

    if (tokenResponse.status === 400 && errorCode === "invalid_grant") {
      notes.push(`Pixelfed OAuth client credential readiness asserted with ${tokenAuthMethod}.`);
      return;
    }

    if (errorCode === "invalid_credentials") {
      failures.push(`Pixelfed OAuth client credential smoke: registered token endpoint auth method does not accept ${tokenAuthMethod}.`);
      return;
    }

    failures.push(`Pixelfed OAuth client credential smoke: expected invalid_grant for dummy code, got HTTP ${tokenResponse.status}.`);
  } catch (error) {
    failures.push(`Pixelfed OAuth client credential smoke: ${error instanceof Error ? error.message : "request failed"}.`);
  }
}

async function checkPixelfedStagingReadiness() {
  const baseUrl = assertHttpsUrl("PIXELFED_STAGING_BASE_URL", env("PIXELFED_STAGING_BASE_URL"));
  const callbackUrl = assertHttpsUrl("PIXELFED_OIDC_CALLBACK_URI", env("PIXELFED_OIDC_CALLBACK_URI"), "/auth/oidc/callback");

  if (baseUrl && callbackUrl && baseUrl.origin !== callbackUrl.origin) {
    failures.push("PIXELFED_OIDC_CALLBACK_URI: origin must match PIXELFED_STAGING_BASE_URL.");
  }

  assertMarker("PIXELFED_OAUTH_CLIENT_REGISTERED", "Supabase OAuth client registration with the exact callback URI");
  assertMarker("PIXELFED_OAUTH_CLIENT_CREDENTIAL_READY", "live OAuth client credential and token endpoint auth method compatibility");
  assertMarker("PIXELFED_STAGING_RUNTIME_READY", "Pixelfed web, database, Redis, queue worker, scheduler, HTTPS, and private media configuration");
  assertMarker("PIXELFED_STAGING_SECURITY_READY", "closed registration, federation disabled, upload limits, moderation/report flow, backups, and monitoring");

  await checkPixelfedOAuthClientCredentialReadiness({ required: true });

  if (!baseUrl) return;

  try {
    await lookup(baseUrl.hostname);
  } catch (error) {
    failures.push(`PIXELFED_STAGING_BASE_URL: DNS lookup failed for ${baseUrl.hostname}.`);
  }

  try {
    const response = await fetch(baseUrl, { redirect: "manual" });
    if (response.status < 200 || response.status >= 400) {
      failures.push(`PIXELFED_STAGING_BASE_URL: expected HTTP 2xx/3xx, got ${response.status}.`);
    }
  } catch (error) {
    failures.push(`PIXELFED_STAGING_BASE_URL: ${error instanceof Error ? error.message : "request failed"}.`);
  }

  notes.push("Pixelfed staging readiness asserted from URL, DNS, HTTP, and private operator markers.");
}

for (const file of requiredFiles) read(file);

for (const { label, file, snippets } of snippetChecks) {
  const text = read(file);
  snippets.forEach((snippet) => assertIncludes(label, text, snippet));
}

const consentPanel = read("apps/web/components/member-workflow/OAuthConsentPanel.tsx");
if (consentPanel.includes("Promise.resolve().then(() => load())")) {
  failures.push("OAuth consent must not race an eager details read with the initial auth-state callback.");
}
if (consentPanel.includes("detailsError?.message")) {
  failures.push("OAuth consent must not render provider/internal authorization errors to members.");
}
if (consentPanel.includes("text(details.redirect_uri")) {
  failures.push("OAuth consent must not render a raw redirect URI to members.");
}
if (consentPanel.indexOf("isApprovedSocialOAuthReturnDestination(nextDetails.redirect_uri)") > consentPanel.indexOf("setDetails(nextDetails)")) {
  failures.push("OAuth consent must validate the registered return destination before rendering request details.");
}
for (const forbiddenConsentCopy of ["OAuth Consent", "Redirect URI", "client request", "client_name", "clientName"]) {
  if (consentPanel.includes(forbiddenConsentCopy)) {
    failures.push(`OAuth consent must use first-party member language rather than: ${forbiddenConsentCopy}.`);
  }
}
if (consentPanel.indexOf("await verifyMemberAccess()") > consentPanel.indexOf("priorConsentRedirect(nextDetails")) {
  failures.push("Prior OAuth consent redirects must follow the current member access check.");
}

[
  "docs/pixelfed-guild-social-adr.md",
  "docs/pixelfed-first-login-testing.md",
  "docs/pixelfed-staging-ops.md",
  "apps/web/app/api/oauth/decision/route.ts",
  "apps/web/components/member-workflow/OAuthConsentPanel.tsx",
  "apps/web/lib/oauth/authorization-details-error.ts",
  "apps/web/lib/oauth/authorization-load-queue.ts",
  "apps/web/lib/oauth/authorization-load-queue.test.mts",
  "apps/web/lib/oauth/prior-consent-redirect.ts",
  "apps/web/lib/oauth/prior-consent-redirect.test.mts",
  "apps/web/lib/supabase/client.ts",
  "supabase/functions/sync-pixelfed-social-account/index.ts",
  "supabase/functions/_shared/pixelfed-social-sync.ts",
  "supabase/functions/_shared/member-access-policy.ts",
  "supabase/functions/_shared/member-access-policy_test.ts",
  "scripts/check-pixelfed-first-login-readiness.mjs",
].forEach((file) => scanNoSecrets(file, read(file)));

if (providerReady) {
  await checkSupabaseProviderReadiness();
} else {
  warnings.push("Supabase OAuth provider readiness is not asserted. Set PIXELFED_FIRST_LOGIN_PROVIDER_READY=1 with SUPABASE_ACCESS_TOKEN in child-process env after approval.");
}

if (stagingReady) {
  await checkPixelfedStagingReadiness();
} else if (env("PIXELFED_OAUTH_CLIENT_CREDENTIAL_READY") === "1") {
  await checkPixelfedOAuthClientCredentialReadiness();
} else {
  warnings.push("Pixelfed staging readiness is not asserted. OAuth client registration, staging runtime, DNS, and security posture remain approval-gated.");
}

if (failures.length) {
  console.error("Pixelfed first-login readiness failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Pixelfed first-login repo readiness OK.");
notes.forEach((note) => console.log(`OK ${note}`));
warnings.forEach((warning) => console.warn(`WARN ${warning}`));
if (providerReady && stagingReady) {
  console.log("NEXT First admin account creation prompt is appropriate before the first browser login smoke.");
}
