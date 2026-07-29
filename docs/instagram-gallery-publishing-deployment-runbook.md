# Instagram Gallery Publishing Deployment Runbook

This runbook deploys the moderator-controlled Instagram publishing workflow for approved member Gallery images. Current launch mode is queue review only. Manual completion is disabled, and direct API publishing remains disabled by the server activation flag until the current provider restriction, human review, Graph identity, credentials, diagnostic, deployment, and action-time approval gates all pass.

Canonical provider identity and current gates are recorded in [the Instagram Gallery publishing integration contract](integrations/instagram-gallery-publishing.md).

Tracking PR: <https://github.com/Mochirii-Wushu/Mochirii-Website/pull/198>

Do not paste secrets, access tokens, signed Storage URLs, private payloads, or dashboard screenshots with sensitive values into GitHub, Discord, public docs, or reports. No real Instagram post may be created without explicit action-time owner approval.

## Historical Deployment Baseline - 2026-06-08

Completed:

- PR #198 merged to `main`.
- Vercel production deployed the Next app changes.
- Supabase production migration `add_instagram_gallery_publishing` is applied.
- The historical production packet included `list-instagram-publish-queue`,
  `mark-instagram-gallery-submission-shared`, `check-instagram-api-status`, and
  `publish-instagram-gallery-submission`. Their current hosted source and
  configuration require fresh readback before a future release.
- The private Reaper bot source repository exists at <https://github.com/Mochirii-Wushu/Reaper-Discord-Bot>.
- Reaper has an initial Node/TypeScript Discord command scaffold that matches the Supabase ingest contract.
- Reaper CI is green on `main` for typecheck, tests, and build.
- Production Reaper is now implemented as a Supabase-hosted Discord Interactions webhook at:

```text
https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/reaper-discord-interactions
```
- Supabase production has active `reaper-discord-interactions` function with JWT verification disabled and Discord signature verification in the function body.
- Supabase secret names now include `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `DISCORD_BOT_TOKEN`.
- Discord Developer Portal accepted the Interactions Endpoint URL after a signed PING.
- The guild-scoped `/submit` command is registered with optional boolean `share_to_instagram`.

## Provider Readiness - 2026-07-29

Confirmed provider inventory:

- Official account: `@mochirii_guild`, Instagram Professional Business account.
- Linked Facebook Page: `https://www.facebook.com/mochiriiguildpage`.
- Meta app identifier: `4210347289109364`.
- Owner checkpoint and two-factor authentication: complete.
- Instagram bio contains no website text and its disabled Website field is
  empty; desktop web settings expose no public-contact email control.

The app identifier is part of the executable public contract. Accounts Center,
Business Settings, and private Graph identifiers remain outside this document.
The Page-linked `instagram_business_account.id` returned by Graph is the
authoritative runtime identity.

Read-only Graph discovery completed on 2026-07-29 with the replacement employee
system-user authorization. It verified the exact Page, `CREATE_CONTENT` task,
linked Instagram username `mochirii_guild`, `BUSINESS` account type, and
required scopes through Graph API v25. The first token appeared in an automation
snapshot and was revoked immediately without being stored or used. The
replacement stayed opaque. The returned Graph user ID and all credential values
are private and must not be written to source, documentation, logs, or PR text.

Still pending:

- This hardened Facebook/Instagram release has not been deployed to the hosted
  Website or Supabase project. Both publishing flags remain `false`, no live
  post was created, and no Meta credential is stored in this source tree.
- Hosted Supabase secrets hold the exact Page and Instagram Graph IDs, opaque
  replacement access token, and Meta app secret. Keep the verified private
  Instagram Graph ID independently in both `INSTAGRAM_ACCOUNT_ID` and
  `INSTAGRAM_EXPECTED_ACCOUNT_ID`; publishing fails closed unless they are
  present, valid, and equal.
- Provider UI currently restricts `@mochirii_guild` from sharing links until 2026-08-28. Recheck the restriction after that date.
- Provider review requires the account owner to complete a human reCAPTCHA step. Do not automate or bypass it.
- Retain least-privilege owned-account authorization and keep runtime values only in Supabase secrets.
- Keep `INSTAGRAM_PUBLISH_ENABLED=false` while the restriction, review, identity, diagnostic, and release gates remain incomplete.
- Manual completion is unavailable. The compatibility endpoint is a
  moderator-gated `409` stub, no database mutation RPC exists, and
  `shared_manually` is retained only for historical reads.
- Publish only the first genuine approved member image after explicit action-time owner approval; do not create a synthetic post for validation.

## Public Interface

Website uploads add an optional Instagram consent checkbox:

```text
I authorize Mōchirīī moderators to publish this image and its moderator-approved caption on the public official Mōchirīī Instagram account after gallery approval.
```

Reaper's Gallery command must match this interface:

```text
/submit image:<file> [title:<title>] [subtitle:<subtitle>] [share_to_instagram:<true|false>]
```

`image` is required. `title`, `subtitle`, and `share_to_instagram` are optional. `share_to_instagram` defaults to `false` and maps to the Supabase ingest payload field:

```json
{
  "instagramOptIn": false
}
```

`subtitle` continues to map to the website Gallery `caption` field. Approval for the public website Gallery does not publish to Instagram; it only creates an Instagram Queue item when the member opted in.

Current disabled-delivery flow:

1. Moderator approves an opted-in eligible JPEG submission.
2. The Leader Dashboard creates and shows a queued Instagram job with a
   credential-free approved Gallery thumbnail.
3. Moderator may review the queue copy, but leaves the job queued while Graph
   publishing is unavailable.
4. The browser never receives the private frozen social JPEG, `_social` path,
   signed URL, or token. Do not substitute the thumbnail, WebP display asset,
   or original upload for a separate manual post.
5. Reconciliation appears only after an ambiguous Graph API attempt changes a
   job to `reconcile_required`.

## Preconditions

Complete these checks before any production mutation or future redeployment:

1. The scoped code PR is approved for deployment and merged to `main`. For the first release, this was PR #198.
2. GitHub checks are green: `validate`, `validate-next`, CodeQL, Vercel, and Supabase Preview when present.
3. Vercel production for `mochirii/mochirii` is Ready after the merge.
4. Supabase project is confirmed as `deyvmtncimmcinldjyqe`.
5. The official Instagram account is the `@mochirii_guild` Professional Business account controlled by Mōchirīī and linked to `https://www.facebook.com/mochiriiguildpage`.
6. Reaper's code repository is available at <https://github.com/Mochirii-Wushu/Reaper-Discord-Bot>; production command handling is hosted by Supabase Edge Function `reaper-discord-interactions`, while the repo remains the command/contract helper and rollback reference.
7. The Discord submission channel remains `1508077313965817856`.

## Deployment Sequence

### 1. Capture Baseline Evidence

Run read-only checks:

```sh
git status --short --branch
gh pr view 198 --json number,state,isDraft,mergeStateStatus,headRefName,baseRefName,url,statusCheckRollup
gh pr checks 198
supabase migration list --project-ref deyvmtncimmcinldjyqe
supabase functions list --project-ref deyvmtncimmcinldjyqe
supabase secrets list --project-ref deyvmtncimmcinldjyqe
```

Record only secret names and presence. Do not record secret values.

### 2. Apply Supabase Database Migrations Before The Website Cutover

Apply the migration that adds Instagram consent fields, publish jobs, and publish events:

```sh
supabase db push --project-ref deyvmtncimmcinldjyqe
```

Confirm tables and columns exist without exposing row data:

```sh
supabase db diff --project-ref deyvmtncimmcinldjyqe
```

If the migration fails, stop. Do not manually edit rows or constraints during the deployment window.

This order is required for the v2 consent cutover. The database migration first
accepts the new exact contract handshake while continuing to accept the former
browser provenance columns only as untrusted input that the insert trigger
overwrites. Older cached clients therefore remain gallery-capable but receive a
historical, API-ineligible consent version; they are never silently upgraded.

### 3. Merge The Scoped Code PR And Verify The Website

For the first release, PR #198 was merged on 2026-06-07. For future redeployments, merge only the current scoped PR after owner approval for the deployment window, the database-first migration, and current green checks.

After merge, wait for the Vercel production deployment from `main` to be Ready and verify:

```sh
curl -I -L https://mochirii.com/
curl -I -L https://www.mochirii.com/
```

### 4. Deploy Edge Functions

Deploy the new queue and publishing functions plus the updated Gallery workflow functions:

```sh
supabase functions deploy submit-discord-gallery-image --project-ref deyvmtncimmcinldjyqe
supabase functions deploy list-gallery-review-queue --project-ref deyvmtncimmcinldjyqe
supabase functions deploy moderate-gallery-submission --project-ref deyvmtncimmcinldjyqe
supabase functions deploy list-instagram-publish-queue --project-ref deyvmtncimmcinldjyqe
supabase functions deploy mark-instagram-gallery-submission-shared --project-ref deyvmtncimmcinldjyqe
supabase functions deploy check-instagram-api-status --project-ref deyvmtncimmcinldjyqe
supabase functions deploy publish-instagram-gallery-submission --project-ref deyvmtncimmcinldjyqe
supabase functions deploy resolve-instagram-publish-reconciliation --project-ref deyvmtncimmcinldjyqe
supabase functions deploy reaper-discord-interactions --project-ref deyvmtncimmcinldjyqe
```

Verify deployed function names:

```sh
supabase functions list --project-ref deyvmtncimmcinldjyqe
```

### 5. Set Supabase Secrets

Set secrets only inside Supabase. Do not put Instagram credentials in Vercel, browser code, GitHub variables, docs, PR comments, or logs.

Required production secret names:

```text
INSTAGRAM_ACCOUNT_ID
INSTAGRAM_EXPECTED_ACCOUNT_ID
INSTAGRAM_ACCESS_TOKEN
INSTAGRAM_API_VERSION
INSTAGRAM_PUBLISH_ENABLED
META_APP_ID
META_APP_SECRET
DISCORD_PUBLIC_KEY
DISCORD_APPLICATION_ID
DISCORD_BOT_TOKEN
DISCORD_GALLERY_CHANNEL_ID
DISCORD_GALLERY_INGEST_SECRET
```

Use the Graph user id returned as `instagram_business_account.id` for
both `INSTAGRAM_ACCOUNT_ID` and `INSTAGRAM_EXPECTED_ACCOUNT_ID`. Store the two
values independently as Supabase secrets and never print their values. Do not
substitute the Accounts Center identifier or the Meta Business Settings asset
identifier. Use the fixed
`https://graph.facebook.com` origin and the reviewed `v25.0` API baseline.
Confirm `id,username,account_type` at runtime. Publishing fails closed until the
configured account ID matches the independently stored expected account ID and
Meta returns username `mochirii_guild` with account type `BUSINESS`.
Set `META_APP_ID=4210347289109364`. Store `META_APP_SECRET` only as a Supabase
secret. Enable Meta's server API app-secret-proof requirement only after the
status and publisher functions that attach HMAC-SHA256 `appsecret_proof` to
every token-bearing request are deployed together.

Set `INSTAGRAM_PUBLISH_ENABLED=false` during initial configuration. Changing it
to `true` is a separate production secret mutation that requires explicit owner
approval after every current activation gate passes.

Instagram public profile and publication copy must not place or link
`mochirii.com`. If Instagram exposes a public contact-email field, use
`support@mochirii.com`. Facebook public website display must be exactly
`mochirii.com`; technical callback, OAuth, API, and policy URLs remain full URLs.

After setting `INSTAGRAM_*` secrets with publishing still disabled, run the Leader Dashboard `Check Meta API` diagnostic before enabling or attempting direct publishing. The diagnostic verifies the configured Graph id, username `mochirii_guild`, and account type `BUSINESS`; it must not call Meta media creation or publish endpoints.

After setting secrets, confirm only names are present:

```sh
supabase secrets list --project-ref deyvmtncimmcinldjyqe
```

### 6. Set Discord Interactions Endpoint

In Discord Developer Portal > Reaper > General Information, set the Discord Interactions Endpoint URL to:

```text
https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/reaper-discord-interactions
```

Discord validates this endpoint with a signed PING. If the save fails, verify `DISCORD_PUBLIC_KEY`, function deployment, and signature handling before retrying.

### 7. Update Reaper Slash Command

Do not treat the existing guild-scoped `/submit` boolean as the broadened API
publishing consent. It remains the historical v1/manual-sharing contract:

```text
share_to_instagram
```

Before a separately reviewed Reaper update can become API-eligible, its visible
copy must be exactly:

```text
I authorize Mōchirīī moderators to publish this image and its moderator-approved caption on the public official Mōchirīī Instagram account after gallery approval.
```

The guild-scoped `/submit` command must remain fail closed:

- reject submissions outside channel `1508077313965817856`
- require only `image`; keep `title`, `subtitle`, and `share_to_instagram` optional so the command matches the pinned channel instructions
- default `share_to_instagram` to `false`
- send `instagramOptIn: true` only when the user explicitly selects true
- preserve Discord message/attachment idempotency
- show the member whether Instagram sharing was enabled for that submission
- keep its current `2026-06-discord-submit-v1` attestation API-ineligible until a
  separately reviewed trusted version handshake proves the exact new copy

## Dry-Run Payloads

Use a dry-run or staging-safe test harness first. Do not call Meta's live publish endpoint during this phase.

Default false:

```json
{
  "guildId": "1078630751077142608",
  "channelId": "1508077313965817856",
  "messageId": "DRY_RUN_MESSAGE_FALSE",
  "attachmentId": "DRY_RUN_ATTACHMENT_FALSE",
  "userId": "DRY_RUN_USER",
  "username": "dry-run-user",
  "attachmentUrl": "https://example.invalid/dry-run.jpg",
  "mimeType": "image/jpeg",
  "size": 12345,
  "filename": "dry-run.jpg",
  "title": "Dry run upload",
  "caption": "Consent omitted.",
  "instagramOptIn": false
}
```

Explicit true:

```json
{
  "guildId": "1078630751077142608",
  "channelId": "1508077313965817856",
  "messageId": "DRY_RUN_MESSAGE_TRUE",
  "attachmentId": "DRY_RUN_ATTACHMENT_TRUE",
  "userId": "DRY_RUN_USER",
  "username": "dry-run-user",
  "attachmentUrl": "https://example.invalid/dry-run.jpg",
  "mimeType": "image/jpeg",
  "size": 12345,
  "filename": "dry-run.jpg",
  "title": "Dry run upload",
  "caption": "Consent enabled.",
  "instagramOptIn": true
}
```

wrong channel fail-closed:

```json
{
  "guildId": "1078630751077142608",
  "channelId": "000000000000000000",
  "messageId": "DRY_RUN_WRONG_CHANNEL",
  "attachmentId": "DRY_RUN_WRONG_CHANNEL_ATTACHMENT",
  "userId": "DRY_RUN_USER",
  "username": "dry-run-user",
  "attachmentUrl": "https://example.invalid/dry-run.jpg",
  "mimeType": "image/jpeg",
  "size": 12345,
  "filename": "dry-run.jpg",
  "title": "Wrong channel dry run",
  "caption": "This must be rejected.",
  "instagramOptIn": true
}
```

## Verification Checklist

Run repository checks after merge and before provider deployment where possible:

```sh
npm run check
git diff --check
cd apps/web && npm run lint && npm run build
```

Run feature checks:

- missing Instagram secrets fail closed
- invalid moderator JWT fails
- non-moderator request fails
- non-opted-in approval creates no Instagram job
- current website-v2 consent plus a valid social derivative creates a queued job
- a stale or missing website contract handshake remains historical and ineligible
- an arbitrary browser contract value cannot create current-v2 consent evidence
- historical Discord-v1 consent creates an ineligible/manual-review job
- duplicate Discord message/attachment does not change stored consent
- Meta API diagnostic can fail without mutating a job or creating a media container
- Meta API publishing failure records a failed job/event without duplicate publishing
- Leader Dashboard contains no manual-share completion control
- the compatibility manual-share Edge route requires moderator access and
  returns `409` without reading a body or calling a database mutation RPC
- both historical and newer manual-share database RPC signatures are absent
- the browser receives no frozen derivative path, signed URL, token, or exact
  derivative download capability
- a missing, replaced, or legacy-unbound social derivative quarantines the job
  as ineligible
- reflected Meta error messages containing a signed URL, object path, or token
  never enter moderator responses or database audit parameters
- confirmed-published reconciliation rejects profile, Story, credentialed,
  fragmented, non-Instagram, and otherwise non-canonical permalinks

Run browser checks:

- website upload checkbox is visible, optional, and unselected by default
- either social opt-in requires an eligible JPEG source; PNG and WebP remain Gallery-only
- Leader Dashboard shows the Instagram Queue to moderators only
- public Gallery behavior is unchanged
- signed-out users cannot access protected member or moderation surfaces

## Live Test Post

Perform one live Instagram test post only after explicit owner approval in the deployment window.

Before publishing, confirm:

- the member image is approved for public website Gallery display
- the submission has `instagram_opt_in = true`
- consent copy version is exactly `2026-07-website-public-instagram-publish-v2`
- consent contract handshake is exactly `2026-07-website-public-instagram-publish-v2`
- the job is `queued`
- image MIME type is `image/jpeg`
- the server-generated, source-bound metadata-stripped JPEG never exceeds
  8 MiB, is 320–1440 pixels wide, and is already within 4:5 through 1.91:1;
  browser-supplied social bytes are not accepted
- caption and alt text were reviewed by a moderator
- the official Instagram account is selected
- the provider link restriction is cleared in current provider UI
- the owner completed the human review step
- the moderator-only diagnostic identifies `@mochirii_guild` as a Business account
- the diagnostic reports that the configured and expected Graph user ID secrets
  match without returning either private value
- a separate approval authorized `INSTAGRAM_PUBLISH_ENABLED=true`

After publishing, record:

- job ID
- submission ID
- published timestamp
- Instagram permalink
- moderator who published
- visible result on Instagram

Do not include access tokens, signed URLs, or private Storage paths in the record.

## Rollback And Stop Conditions

Stop the deployment and do not continue if:

- GitHub checks fail after merge
- Vercel production is not Ready
- Supabase migration fails
- any Edge Function deploy fails
- required secrets are missing
- non-moderator access succeeds
- Reaper sends `instagramOptIn: true` without explicit user selection
- the queue can publish without final confirmation
- Meta returns unexpected authorization or account ownership errors
- any `publishing` or `reconcile_required` job exists without a completed
  official-account inspection and durable moderator resolution

Rollback options:

- Set `INSTAGRAM_PUBLISH_ENABLED=false` through an approved Supabase secret change.
- Disable Reaper's `share_to_instagram` option or stop sending `instagramOptIn: true`.
- Leave existing Instagram jobs in place; do not delete queue/event rows during incident response.
- Rotate Instagram access token if a token exposure is suspected.
- Revert the website UI in a scoped follow-up PR if the dashboard blocks normal moderation.
- Restore the previous Supabase function versions only through an approved admin task.

If an accidental live post occurs, remove it from Instagram manually in the official account, preserve the Supabase job/event audit trail, rotate credentials if needed, and write a private incident note without secrets.
