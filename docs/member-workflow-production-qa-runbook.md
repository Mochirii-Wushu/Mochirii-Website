# Member Workflow Production QA Runbook

This runbook defines the remaining live-account QA gate for Auth, Account, Gallery Submit, Leader Dashboard, approved Gallery feed, and cleanup behavior.

It does not authorize DNS changes, dashboard changes, schema changes, Edge Function deployment, secret changes, or live production mutation by itself.

## Current Status

Non-mutating coverage is already available:

- `npm run check:live-member-workflow-preflight`
- `npm run smoke:supabase-edge-functions`
- `npm run smoke:supabase-auth-boundary`
- `npm run smoke:gallery-approved-feed`
- `npm run smoke:vercel-production`

The remaining confidence gap is credential-gated:

- real Discord OAuth completion
- real account/profile state
- real Discord verification
- real active-member upload
- real moderator queue access
- one controlled approve or reject path
- cleanup or explicit cleanup deferral

## Source Rules

Use the provider rules already captured in the cutover runbook:

- Supabase Auth `redirectTo` URLs must be allow-listed, with exact production paths preferred for the final production state.
- Supabase Storage access must remain governed by RLS policies; the `member-gallery` bucket must remain private.
- Service-role keys, secret keys, Discord bot tokens, OAuth client secrets, cookies, access tokens, refresh tokens, private Storage paths, and signed URLs must never be committed or pasted into public docs, PRs, issues, terminal transcripts, or screenshots.
- Vercel custom-domain DNS instructions must be copied from the production-serving project's Domains dashboard during an approved cutover window.

Primary references:

- Supabase Auth redirect URLs: <https://supabase.com/docs/guides/auth/redirect-urls>
- Supabase Storage access control: <https://supabase.com/docs/guides/storage/security/access-control>
- Supabase Edge Function secrets: <https://supabase.com/docs/guides/functions/secrets>
- Vercel custom domains: <https://vercel.com/docs/domains/set-up-custom-domain>
- Historical DNS cutover runbook: [`docs/operations/history/dns-cutover-readiness-and-rollback.md`](./operations/history/dns-cutover-readiness-and-rollback.md)
- Moderation runbook: [`docs/member-gallery-moderation-runbook.md`](./member-gallery-moderation-runbook.md)
- Cleanup plan: [`docs/member-gallery-cleanup-plan.md`](./member-gallery-cleanup-plan.md)

## Required Test Identities

Use dedicated, operator-approved test accounts. Do not use personal accounts for upload or moderation mutation unless leadership explicitly approves that exact use.

| Identity | Required state | Allowed before mutation approval |
| --- | --- | --- |
| Anonymous visitor | No session. | Signed-out gates and public Gallery checks. |
| Unverified Discord user | Can complete OAuth but lacks required guild/role access. | Sign in, read missing-role guidance, sign out. |
| Verified active member | Guild member with required role state and active website status. | Sign in, read account state, verify upload eligibility. |
| Moderator/leader | Verified active member with moderator access. | Sign in, confirm queue access without changing rows. |

Minimum useful live test set:

1. unverified test user
2. verified active member
3. moderator/leader

## Local QA File

If live testing is approved, create `.env.live-member-qa` locally. This file is ignored by Git and must remain untracked.

Use labels only. Keep real credentials in the operator's password manager.

To create a local placeholder file without printing values:

```sh
npm --silent run prepare:live-member-qa-local
```

This preparation helper verifies `.env.live-member-qa` is ignored, refuses tracked state, keeps `QA_ALLOW_LIVE_MUTATION=false`, writes safe placeholder labels only, and refuses to overwrite an existing local QA file unless `--force` is supplied. It does not authorize D02, D03, upload, moderation, cleanup, or cutover.

To prepare a small disposable PNG outside the repository for D03, use:

```sh
QA_TEST_IMAGE_PATH_LOCAL=/absolute/private/mochirii-qa-test.png npm --silent run prepare:live-member-qa-image
```

This image helper refuses repository-local output, writes only a deterministic disposable PNG, refuses overwrite unless `--force` is supplied, and does not print the absolute path. It does not update `.env.live-member-qa` or authorize upload/moderation by itself.

To prepare a private cleanup-note draft before any D03 upload, use:

```sh
LIVE_MEMBER_CLEANUP_NOTE_PATH=/absolute/private/live-member-cleanup-note.md npm --silent run prepare:live-member-cleanup-note
```

This cleanup-note helper refuses repository-local output, writes only a Markdown draft, refuses overwrite unless `--force` is supplied, and does not print the absolute path. It is private operator working state for submission IDs, Storage paths, cleanup ownership, and status-only public summaries; it does not authorize upload, moderation, cleanup deferral, or cutover.

The cleanup-note field template lives at [`docs/live-member-cleanup-note.md`](./live-member-cleanup-note.md). Review the template publicly, but keep the completed note private and outside the repository.

To validate a completed private cleanup note without printing its submission IDs, Storage paths, or other values:

```sh
npm --silent run check:live-member-cleanup-note -- --note=/absolute/private/live-member-cleanup-note.md
```

This validator permits the expected private D03 artifact identifiers that belong only in the cleanup note, but it rejects obvious secrets, token assignments, database URLs, Discord webhooks, and signed Storage URLs.

```sh
QA_TEST_MEMBER_EMAIL_OR_LABEL=
QA_TEST_UNVERIFIED_DISCORD_LABEL=
QA_TEST_VERIFIED_MEMBER_LABEL=
QA_TEST_MODERATOR_LABEL=
QA_TEST_IMAGE_PATH_LOCAL=
QA_TEST_TITLE_PREFIX=Mochirii QA Test
QA_TEST_CAPTION_MARKER=Mochirii QA Test disposable upload
QA_ALLOW_LIVE_MUTATION=false
```

Strict preflight prints only key names and pass/fail labels. It fails if local labels look like private identifiers, if raw private Storage paths or obvious token/secret values appear, if the image path is missing, relative, inside the repository, empty, over 8 MB, or not JPEG/PNG/WebP, or if `QA_ALLOW_LIVE_MUTATION` is enabled during D02.

Before mutating production test data, set `QA_ALLOW_LIVE_MUTATION=true` locally only after explicit human approval.

## Evidence Rules

Public PRs, docs, and reports may record:

- pass/fail state
- page or route name
- account type, such as unverified, active member, or moderator
- visible non-private status text
- whether cleanup is complete or deferred

Do not record:

- real names, emails, Discord IDs, cookies, tokens, bearer values, dashboard exports, signed URLs, private Storage paths, submission IDs, user IDs, or screenshots showing private operational details

Submission IDs and Storage paths belong only in a private operator note.

## D02: Live OAuth And Account Smoke

Run this gate before any upload or moderation mutation.

Preconditions:

- Vercel production review URL is healthy.
- Supabase Auth redirect URLs include the production review URL and the planned custom-domain URLs needed for the current test.
- Discord application callback remains the Supabase callback.
- Test accounts are approved and disposable.
- `QA_ALLOW_LIVE_MUTATION=false`.

Steps:

1. Run `npm run check:live-member-workflow-preflight -- --strict`.
2. Open `https://mochirii.com/auth`.
3. Complete Discord OAuth with the unverified test account.
4. Confirm return to `/account`.
5. Confirm missing-role or verification guidance is clear.
6. Sign out.
7. Repeat with the verified active member account.
8. Confirm Account loads profile and verification state.
9. Confirm Gallery Submit shows the expected eligibility state.
10. Sign out.
11. Repeat with the moderator account.
12. Confirm Account exposes the Leader Dashboard path.
13. Open Leader Dashboard and confirm queue access or expected empty state without approving, rejecting, deleting, or editing anything.
14. Sign out.

Pass criteria:

- OAuth completes without exposing credentials.
- Every account returns to `/account`.
- Signed-out, missing-role, active-member, and moderator states match the expected role.
- No upload, profile save, approval, rejection, cleanup, dashboard setting, schema, or Edge Function change occurred.

Stop if any account cannot be distinguished from a real member, if credentials appear in output, or if dashboard/provider changes seem necessary.

## D03: Live Upload And Moderation Smoke

Run this gate only after D02 passes and explicit mutation approval exists.

Preconditions:

- `QA_ALLOW_LIVE_MUTATION=true` is set in the local ignored QA file.
- A disposable image exists outside the repo, is JPEG/PNG/WebP, and is under 8 MB.
- `prepare:live-member-qa-image` may be used to create a repo-external disposable PNG before setting `QA_TEST_IMAGE_PATH_LOCAL`.
- `QA_TEST_IMAGE_PATH_LOCAL` is an absolute path to that repo-external image.
- The title and caption use the local QA marker.
- A private cleanup note exists before upload; `prepare:live-member-cleanup-note` may be used to create the repo-external draft.
- The moderator knows the exact marker and expected submission timing.
- Human approval covers one upload and one agreed moderation decision.

Recommended marker:

- title prefix: `Mochirii QA Test`
- caption marker: `Mochirii QA Test disposable upload`
- filename pattern: `mochirii-qa-test-YYYYMMDD`

Steps:

1. Run `npm run check:live-member-workflow-preflight -- --strict --require-mutation-approval`.
2. Sign in as the active member.
3. Open Gallery Submit.
4. Upload one disposable test image with the approved marker.
5. Confirm the page reports a pending submission.
6. Confirm the item does not appear in the public approved Gallery before moderation.
7. Record the created submission ID and Storage path in the private operator note only.
8. Sign out.
9. Sign in as the moderator.
10. Open Leader Dashboard.
11. Find only the disposable test submission by marker and timestamp.
12. Perform the approved decision: approve or reject.
13. Confirm the queue updates and moderation history/audit behavior is visible.
14. If approved, confirm the item appears through the approved Gallery feed and opens through the stable credential-free Edge media URL.
15. If rejected, confirm it remains absent from the public Gallery.
16. Complete the approved cleanup action, or record cleanup as explicitly deferred in the private note.

Pass criteria:

- Only the disposable test artifact was changed.
- Pending content was not public before approval.
- Moderator action updated only the targeted test submission.
- Public Gallery behavior matched the selected approval/rejection path.
- Cleanup is complete or explicitly deferred by an owner with the artifact left in the safest available state.

Stop if the queue contains ambiguous real member content, if the signed preview cannot be trusted, if cleanup is unclear, or if any command or dashboard action outside the approved path appears necessary.

## Cleanup Expectations

Cleanup must not be ad hoc.

Allowed public statement:

```text
Cleanup status: complete.
```

or

```text
Cleanup status: deferred by owner; test artifact left rejected/archived/private.
```

Private operator note should include:

- account label
- upload timestamp
- title/caption marker
- submission ID
- Storage path
- moderation decision
- cleanup decision
- cleanup completion evidence

Do not paste that private note into the repository.

## Final Validation

After D02 or D03, run:

```sh
npm run check
git diff --check
npm run check:production
npm run smoke:vercel-production
npm run smoke:supabase-edge-functions
npm run smoke:supabase-auth-boundary
npm run smoke:gallery-approved-feed
npm run check:live-member-workflow-preflight
npm run check:cutover-validators
```

If Gallery behavior changed or cleanup touched public feed behavior, also run:

```sh
npm run smoke:gallery
```

Known accepted warning:

- `apps/web/public/assets/audio/mochiriiiiii.mp3` is intentionally above the large-asset threshold.

## Result Packet

After D02 or D03, prepare the sanitized private result packet from [`docs/live-member-workflow-result-packet.md`](./live-member-workflow-result-packet.md).

Validate the completed packet before copying its safe status into the DNS cutover approval packet:

```sh
npm --silent run check:live-member-cleanup-note -- --note=/path/to/private/completed-cleanup-note.md
npm --silent run check:live-member-workflow-result-packet -- --packet=/path/to/private/completed-live-member-result.md
```

This helper prints only field labels and pass/fail state. It does not authorize cutover, D03 mutation, cleanup deferral, or provider changes by itself.

The DNS rehearsal helper also fails if tracked filenames look like completed live-member result packets, private D02/D03 evidence bundles, screenshots, cleanup notes, or operator artifacts.

## Cutover Gate

DNS cutover may not proceed from this runbook alone.

Before cutover:

- D02 must pass.
- D03 must pass, or upload/moderation QA must be explicitly deferred with a named rollback owner.
- The live-member workflow result packet must be validated.
- Vercel custom-domain dashboard settings must be confirmed.
- Cloudflare records must be captured and approved for the exact change.
- Supabase Auth URL settings must be confirmed for the final custom-domain plan.
- Discord OAuth callback must remain the Supabase callback.
- Rollback owner and communication path must be named.
