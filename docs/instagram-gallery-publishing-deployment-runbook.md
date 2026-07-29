# Instagram Gallery Publishing Deployment Runbook

This runbook deploys the moderator-controlled Instagram publishing workflow for approved member Gallery images. Current launch mode is manual sharing through the Leader Dashboard. Direct API publishing remains diagnostic-gated until Meta credentials are present in Supabase secrets and the moderator-only Meta status check passes.

Tracking PR: <https://github.com/Mochirii-Wushu/Mochirii-Website/pull/198>

Do not paste secrets, access tokens, signed Storage URLs, private payloads, or dashboard screenshots with sensitive values into GitHub, Discord, public docs, or reports. No real Instagram post may be created without explicit action-time owner approval.

## Deployment Status - 2026-06-08

Completed:

- PR #198 merged to `main`.
- Vercel production deployed the Next app changes.
- Supabase production migration `add_instagram_gallery_publishing` is applied.
- Supabase production has active `list-instagram-publish-queue`, `mark-instagram-gallery-submission-shared`, `check-instagram-api-status`, and `publish-instagram-gallery-submission` functions with JWT verification enabled.
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

Still pending:

- Deploy the manual share status migration and `mark-instagram-gallery-submission-shared` function if this packet is not yet live.
- Set real Instagram production secrets in Supabase later, after Meta developer verification is available.
- Complete Meta for Developers SMS verification for the owner account before app/token setup can continue.
- Run Discord command dry-runs through the webhook after Meta setup, or earlier with a non-sensitive test image if the owner approves that upload.
- For now, moderators may post manually from the official Instagram account or Meta Business Suite, then paste the permalink and mark the job `shared_manually`.
- Publish one live Instagram API test post only after explicit action-time owner approval.

## Public Interface

Website uploads add an optional Instagram consent checkbox:

```text
Allow Mōchirīī to share this image on our official Instagram if approved.
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

Current manual flow:

1. Moderator approves an opted-in JPEG submission.
2. The Leader Dashboard creates and shows a queued Instagram job.
3. Moderator downloads the image through the signed preview URL.
4. Moderator copies the caption and alt text.
5. Moderator posts manually from the official Instagram account or Meta Business Suite.
6. Moderator optionally pastes the Instagram permalink and adds a private note.
7. Moderator clicks `Mark shared manually`, reviews the in-card confirmation prompt, then clicks `Confirm manual share`.

## Preconditions

Complete these checks before any production mutation or future redeployment:

1. The scoped code PR is approved for deployment and merged to `main`. For the first release, this was PR #198.
2. GitHub checks are green: `validate`, `validate-next`, CodeQL, Vercel, and Supabase Preview when present.
3. Vercel production for `mochirii/mochirii` is Ready after the merge.
4. Supabase project is confirmed as `deyvmtncimmcinldjyqe`.
5. The official Instagram account is a Professional account controlled by Mōchirīī.
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

### 2. Merge The Scoped Code PR

For the first release, PR #198 was merged on 2026-06-07. For future redeployments, merge only the current scoped PR after owner approval for the deployment window and current green checks.

After merge, wait for the Vercel production deployment from `main` to be Ready and verify:

```sh
curl -I -L https://mochirii.com/
curl -I -L https://www.mochirii.com/
```

### 3. Apply Supabase Database Migration

Apply the migration that adds Instagram consent fields, publish jobs, and publish events:

```sh
supabase db push --project-ref deyvmtncimmcinldjyqe
```

Confirm tables and columns exist without exposing row data:

```sh
supabase db diff --project-ref deyvmtncimmcinldjyqe
```

If the migration fails, stop. Do not manually edit rows or constraints during the deployment window.

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
INSTAGRAM_ACCESS_TOKEN
INSTAGRAM_API_VERSION
DISCORD_PUBLIC_KEY
DISCORD_APPLICATION_ID
DISCORD_BOT_TOKEN
DISCORD_GALLERY_CHANNEL_ID
DISCORD_GALLERY_INGEST_SECRET
```

Optional test-only secret name:

```text
INSTAGRAM_API_BASE_URL
```

Use `INSTAGRAM_API_BASE_URL` only for a Meta-compatible mock during tests. Production should use Meta's real API base.

After setting `INSTAGRAM_*` secrets, run the Leader Dashboard `Check Meta API` diagnostic before enabling or attempting direct publishing. The diagnostic checks account reachability only; it must not call Meta media creation or publish endpoints.

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

Register the guild-scoped `/submit` command with the new optional boolean:

```text
share_to_instagram
```

Description:

```text
Allow Mōchirīī to share this image on our official Instagram if approved.
```

The guild-scoped `/submit` command must:

- reject submissions outside channel `1508077313965817856`
- require only `image`; keep `title`, `subtitle`, and `share_to_instagram` optional so the command matches the pinned channel instructions
- default `share_to_instagram` to `false`
- send `instagramOptIn: true` only when the user explicitly selects true
- preserve Discord message/attachment idempotency
- show the member whether Instagram sharing was enabled for that submission

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
- opted-in JPEG approval creates a queued job
- opted-in PNG/WebP approval creates an ineligible job
- duplicate Discord message/attachment does not change stored consent
- Meta API diagnostic can fail without mutating a job or creating a media container
- Meta API publishing failure records a failed job/event without duplicate publishing
- Leader Dashboard requires visible in-card confirmation before manual sharing or API publishing

Run browser checks:

- website upload checkbox is visible, optional, and unselected by default
- Leader Dashboard shows the Instagram Queue to moderators only
- public Gallery behavior is unchanged
- signed-out users cannot access protected member or moderation surfaces

## Live Test Post

Perform one live Instagram test post only after explicit owner approval in the deployment window.

Before publishing, confirm:

- the member image is approved for public website Gallery display
- the submission has `instagram_opt_in = true`
- the job is `queued`
- image MIME type is `image/jpeg`
- caption and alt text were reviewed by a moderator
- the official Instagram account is selected

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

Rollback options:

- Disable Reaper's `share_to_instagram` option or stop sending `instagramOptIn: true`.
- Leave existing Instagram jobs in place; do not delete queue/event rows during incident response.
- Rotate Instagram access token if a token exposure is suspected.
- Revert the website UI in a scoped follow-up PR if the dashboard blocks normal moderation.
- Restore the previous Supabase function versions only through an approved admin task.

If an accidental live post occurs, remove it from Instagram manually in the official account, preserve the Supabase job/event audit trail, rotate credentials if needed, and write a private incident note without secrets.
