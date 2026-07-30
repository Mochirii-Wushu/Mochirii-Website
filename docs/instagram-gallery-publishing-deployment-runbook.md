# Meta Gallery Publishing Deployment Runbook

This compatibility-path runbook governs the Facebook Page and Instagram Gallery publisher. It replaces the retired June manual-share procedure. The release flow is:

```text
member upload -> Gallery moderation -> destination queue -> second moderator confirmation -> provider -> audited result
```

The source release does not authorize a hosted migration, Edge Function deployment, Website production deployment, credential change, feature-flag change, or public post. Obtain the action-specific owner approval described below immediately before each mutation.

## Current release posture

- Both destination opt-ins default to `false` and are independent.
- New submissions use the server-attested website consent v3 contract; earlier consent and legacy jobs are not silently upgraded.
- Initial upload and Gallery approval never call Meta.
- Public publication is a separate, moderator-confirmed action.
- Facebook targets the official Mochirii Page. Sharing a verified Page post into the Guild group is manual; no Groups API path exists.
- Instagram uses the professional-account container, one immediate bounded status read, and the `media_publish` sequence only when that read is already `FINISHED`. `IN_PROGRESS` stops in reconciliation; the Edge invocation never runs a rapid polling loop.
- Graph requests are pinned to `v26.0`; no request may float to Meta's default version.
- Both publishing flags remain `false` through migration, function, Website, and credential validation.
- The legacy Instagram manual-completion endpoint remains only as an authenticated `409` compatibility stub. Legacy jobs are never silently upgraded for API publication.
- Facebook and Instagram public profile link fields remain empty. Automated publication copy for either destination must not contain a URL. `support@mochirii.com` remains the public contact where an email is relevant.

No credential, private provider identifier, signed media URL, member object path, raw Graph response, or private image evidence belongs in source, logs, screenshots, pull requests, or deployment records.

## Authoritative release artifacts

- Migration allowlist: [`META-GALLERY-PUBLISHING-RELEASE-MANIFEST-2026-07-29.json`](operations/META-GALLERY-PUBLISHING-RELEASE-MANIFEST-2026-07-29.json)
- Facebook contract: [`facebook-page-gallery-publishing.md`](integrations/facebook-page-gallery-publishing.md)
- Instagram contract: [`instagram-gallery-publishing.md`](integrations/instagram-gallery-publishing.md)
- Public privacy notice: `https://mochirii.com/privacy`
- Public deletion instructions: `https://mochirii.com/meta-data-deletion`

Validate the migration artifact before any database action:

```sh
npm run check:meta-gallery-release-manifest
```

The manifest contains exactly 13 ordered migrations. Never use `--include-all`, migration-history repair, or a broad production push to conceal an ordering mismatch. If hosted history does not end at the expected base migration, stop and reconcile the release branch without modifying hosted history.

## Required approvals

Record separate, current approval for each action:

1. publishing the privacy and deletion pages;
2. applying the exact migration manifest;
3. deploying the named Edge Functions;
4. deploying the reviewed Website commit;
5. installing fresh Meta credentials in Supabase secrets;
6. enabling Facebook Page publication;
7. enabling Instagram publication;
8. the first genuine Facebook Page publication; and
9. the first genuine Instagram publication.

Approval for one item does not authorize another. Never use a synthetic production upload or legacy job as a publication canary.

## Pre-deployment evidence

Capture read-only, redacted evidence immediately before the release window:

- exact production Website commit and rollback deployment;
- hosted migration names and ordering;
- active Edge Function names, versions, and JWT settings;
- aggregate Gallery and legacy-job counts only;
- secret names only;
- both current publishing-flag values; and
- current backup and point-in-time-recovery status.

Do not retain raw provider responses, debugger screenshots, member rows, provider numeric identifiers, tokens, or signed URLs.

Require all three ordered pull requests and immutable preview heads:

1. public legal/readiness pages;
2. Gallery/Meta database and Edge backend; and
3. Website member and moderator UI.

Supabase Preview and Vercel Preview may use mocks or read-only diagnostics only. Both publication flags remain false.

## Meta asset and permission prerequisites

Confirm read-only that the business portfolio owns the app and Facebook Page, the new Instagram professional account is linked to that exact Page, and the dedicated employee system user and app are in the same portfolio. The employee identity must have Content-only asset access and the Page content-creation task. The retired admin publisher must have no publishing asset or usable token.

Begin with only these permissions:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
instagram_basic
instagram_content_publish
```

Do not add business-wide management, advertising, full Page management, or unrelated permissions. Meta's current publishing documentation says a Page role granted through Business Manager also requires `ads_read` or `ads_management`. Because this release uses that assignment model, stop for explicit permission-expansion approval before requesting the least-privilege `ads_read` scope, and assign no ad account assets. Never add `ads_management` pre-emptively.

Do not bypass an unusual-activity or account-confirmation checkpoint. Complete human review from a stable non-VPN owner session and use Meta support if offered. Facebook source work may continue while Instagram stays disabled.

## Server-only configuration

Install values only as Supabase Edge Function secrets and in the approved private recovery boundary. Do not place them in Vercel, browser variables, repositories, documentation, terminal transcripts, or pull-request comments.

```text
GALLERY_PREVIEW_VERCEL_OWNER
GALLERY_PREVIEW_VERCEL_OWNER_ID
GALLERY_PREVIEW_VERCEL_PROJECT
GALLERY_PREVIEW_VERCEL_PROJECT_ID

META_APP_ID
META_EXPECTED_APP_ID
META_APP_SECRET

FACEBOOK_PAGE_ID
FACEBOOK_EXPECTED_PAGE_ID
FACEBOOK_PAGE_ACCESS_TOKEN
FACEBOOK_API_VERSION=v26.0
FACEBOOK_PAGE_PUBLISH_ENABLED=false

INSTAGRAM_ACCOUNT_ID
INSTAGRAM_EXPECTED_ACCOUNT_ID
INSTAGRAM_ACCESS_TOKEN
INSTAGRAM_API_VERSION=v26.0
INSTAGRAM_PUBLISH_ENABLED=false
```

The four Gallery preview pins must identify the exact Vercel owner and Website
project. The Edge verifier rejects missing or malformed pins and derives the
team-mode issuer, fixed Vercel JWKS URL, audience, and subject from them; do not
store those expected identifiers in tracked source or Vercel browser variables.

Use a dedicated employee-system-user credential with a 60-day maximum lifetime. The raw system-user token is an administrative bootstrap credential, not the assumed runtime Page token: use it to retrieve the access token for the independently pinned Page, then install and validate that derived Page token in the Facebook and Instagram runtime secret slots with both flags false. Rotate by day 45: create the replacement system-user token, derive the replacement Page token, install and validate it read-only, then revoke the prior credential. Send normal Graph tokens only in the `Authorization` header. Normal Graph requests must use a fresh five-minute-bounded `appsecret_time` and HMAC-SHA256 proof.

## Coordinated hosted rollout

### 1. Publish legal readiness

Deploy the first reviewed PR and verify the canonical HTTPS privacy and deletion routes. Confirm that the pages accurately describe Gallery uploads, consent, moderation, provider processing, public copies, withdrawal, removal requests, retention, and the possibility that third-party shares persist.

Configure Meta's User Data Deletion Instructions URL to the deletion page. If the dashboard requires a callback instead, stop until a separately reviewed callback verifies bounded `signed_request` input, expiry, and HMAC-SHA256 in constant time and returns only an opaque confirmation code plus non-sensitive status URL.

### 2. Freeze moderator mutations

Begin a temporary moderator mutation freeze before backend cutover. Do not approve, reject, prepare derivatives, publish, or reconcile during the freeze. Member uploads and public Gallery reads may remain available.

### 3. Apply the database allowlist

One coordinated Supabase operator applies only the manifest-listed migrations from the exact reviewed backend commit. Confirm every migration appears once, in timestamp order. Read back aggregate invariants and explicit RLS/grants; do not inspect production member content as validation.

Database migrations are forward-only. Correct a defect with a reviewed forward-fix migration rather than history repair or rollback SQL.

### 4. Deploy the hardened Edge boundary

Replace the unsafe historical Instagram publisher and manual-completion path before installing a usable credential. Deploy the reviewed Gallery and destination endpoints in this order:

1. Instagram and Facebook status, list, publish, and reconciliation endpoints;
2. the authenticated Instagram compatibility stub;
3. consent withdrawal;
4. Gallery list, public-feed, ingest, cleanup, and derivative preparation; and
5. `moderate-gallery-submission` last.

Read back the exact deployed function versions. All nine Meta endpoints must have `verify_jwt=true`; no exception is permitted. Each moderator endpoint must also perform the live, bounded Discord moderator-role check and fail closed on timeout, rate limiting, incomplete onboarding, missing roles, or configuration drift.

### 5. Deploy the Website UI

Deploy the exact reviewed third-PR commit to the existing Vercel `mochirii` project with root `apps/web`. Require `READY`, exact commit readback, and the expected `mochirii.com` content. Verify authenticated routing, two unchecked destination checkboxes, upload-rights attestation, withdrawal controls, mobile and 200% reflow, and disabled publication diagnostics without creating production test data.

Require moderators to reauthenticate, load all queues read-only, and only then lift the mutation freeze.

### 6. Install credentials with both flags disabled

Only after the hardened functions are active may the approved operator install fresh Meta credentials. Keep both publication flags false. Supabase secrets become available to Edge Functions without a redeployment, so a valid token must never be installed while a historical publisher is still active.

Run the read-only diagnostic. It must verify the pinned app and Page chain, required Page task, resolve `instagram_business_account` from the pinned Page with exactly one bearer-authenticated Graph request and a fresh timed proof, match that identity to the independently pinned Instagram account, verify the exact Instagram username, and read back API version and quota. Professional Business subtype, credential expiry, and data-access expiry remain separate prerequisites until their documented provider surfaces are available. Persist only safe booleans, API version, expiry window, timestamp, and bounded error category; never persist the Page or Instagram identifiers or raw Graph response.

The current diagnostic intentionally remains `ready: false` until an owner-approved token-debugger transport can prove token binding, type, scopes, expiry, and data-access expiry without leaking the credential. Meta's documented debugger requires the inspected `input_token` in its query string, so this is an explicit exception to the normal bearer-only transport rule and requires a separately reviewed redaction boundary. Instagram Business subtype also remains a manual/provider prerequisite. Do not enable either destination while those requirements are unresolved.

Standard Access is sufficient only while the app serves Mochirii-owned and managed assets. Before moving the app to Live, complete the Basic Settings fields, privacy/deletion information, icon, category, contact information, and every requirement the current App Dashboard actually presents. Business Verification, App Review, Data Use Checkup, and Advanced Access are not blanket Standard Access requirements; if the dashboard or a later third-party-account scope requires any of them, stop and satisfy that specific gate before continuing.

## Preserved Reaper interaction boundary

This Meta release does not change or deploy the existing `reaper-discord-interactions` function. Its Discord Interactions Endpoint URL remains:

```text
https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/reaper-discord-interactions
```

`DISCORD_PUBLIC_KEY` remains a server-only secret. Any later, separately approved deployment uses `supabase functions deploy reaper-discord-interactions`; this release does not run that command or alter Discord configuration. The guild-scoped `/submit` command retains its existing contract: `image` is required. `title`, `subtitle`, and `share_to_instagram` are optional.

## Validation contract

Before requesting any activation, require:

- the immutable migration manifest check;
- a fresh isolated 47-migration replay on unique ports, never shared ports `54321-54327`;
- all focused pgTAP suites;
- zero packet-attributable database lint warnings;
- explicit grants and RLS for every new table;
- denial of queue, event, derivative, consent, confirmation, withdrawal, and removal ledgers to `anon` and ordinary authenticated roles;
- all Edge type, authorization, request-bound, provider-fixture, secret-redaction, and DTO tests;
- independent opt-in combinations with no duplicate jobs;
- stale-confirmation and consent-withdrawal races;
- missing/false flag prevention before every Graph call;
- reconciliation on timeout, network loss, 5xx, rate limiting, missing IDs, or unknown container state;
- one immediate container-status read, with `IN_PROGRESS` entering reconciliation before `media_publish` and no in-request sleep or rapid polling loop;
- no automatic retry after an ambiguous provider request;
- provider ownership and canonical permalink verification;
- no Groups API code path; and
- no URL-like Facebook or Instagram publication copy.

No validation step may publish, deploy, modify infrastructure, mutate public content, alter a forum, or change a Unity project.

## Destination activation

### Facebook Page

After explicit flag approval, enable only `FACEBOOK_PAGE_PUBLISH_ENABLED`. Use the first genuine, newly consented submission. A moderator must review the sanitized derivative and final message, perform the second confirmation, and approve exactly one publication attempt. Verify Page ownership, returned identifiers, canonical permalink, job state, and redacted audit evidence. Sharing the verified Page post into the Guild group is a separate manual moderator action.

Observe the destination for 24 hours before normal operation. Any ambiguous result immediately disables the flag and enters reconciliation.

### Instagram

Activate separately after account confirmation, identity, scope, Business subtype, quota, and expiry checks pass. After explicit flag approval, enable only `INSTAGRAM_PUBLISH_ENABLED`. Use a different genuine, newly consented submission. If the one immediate container read is `IN_PROGRESS`, stop before `media_publish`, inspect the official account, and resolve the job without an automatic retry. For a `FINISHED` container, verify one published media object, ownership by the pinned account, moderator-reviewed alt text, canonical permalink, and absence of URLs in publication copy.

Observe for 24 hours. An ambiguous result disables only Instagram and enters reconciliation; never retry automatically.

## Withdrawal and removal handling

- Queued, failed, or ineligible destination jobs cancel atomically when consent is withdrawn.
- Publishing or reconciliation-required jobs are quarantined for moderator inspection.
- Published jobs create a removal request; the system does not claim that an external copy was removed.
- Original consent and withdrawal events remain immutable.
- Removing an external post is a separate, owner-approved public action and must be recorded without sensitive content.

## Incident response and rollback

1. Set the affected destination flag to false.
2. Preserve jobs, consent, confirmation, withdrawal, removal, and audit evidence.
3. Inspect the official account and reconcile before any retry.
4. If credentials may be exposed, disable both flags, revoke the token at Meta, rotate Supabase secrets, inspect redacted logs, and validate the replacement before reactivation.
5. For a Website regression, use the recorded Vercel rollback deployment but keep moderation frozen because the prior UI may not match the hardened backend.
6. Never redeploy the historical Instagram publisher against the hardened schema.

Monitor queue age, leases, reconciliation demand, repeated authorization/rate-limit/server errors, identity drift, quota use, and credentials expiring within 14 days. Re-run compatibility fixtures before any Graph API-version upgrade.

Official references: [Graph API v26 changelog](https://developers.facebook.com/docs/graph-api/changelog/version26.0/), [Graph API v19 Groups removal](https://developers.facebook.com/docs/graph-api/changelog/version19.0/), [Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/), [Instagram publishing limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/), [Facebook Page photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/), [Meta Login security](https://developers.facebook.com/docs/facebook-login/security/), [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels), [App Modes](https://developers.facebook.com/docs/development/build-and-test/app-modes/), [Debug Token](https://developers.facebook.com/docs/graph-api/reference/debug_token/), [system-user Page calls](https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser/api-calls/), [data-deletion callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/), [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations), [Supabase Edge secrets](https://supabase.com/docs/guides/functions/secrets), and [Vercel deployments](https://vercel.com/docs/deployments).
