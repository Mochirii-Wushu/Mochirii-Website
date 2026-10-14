# Member Gallery Moderation Runbook

This runbook is for leaders reviewing member Gallery submissions through the website Leader Dashboard.

It does not contain secrets, tokens, private URLs, or deployment credentials.

Tracking PR: <https://github.com/Mochirii-Wushu/Mochirii/pull/123>

Instagram deployment and Reaper rollout steps are separate from routine moderation and are tracked in [`instagram-gallery-publishing-deployment-runbook.md`](./instagram-gallery-publishing-deployment-runbook.md).

## 1. What Moderation Controls

Member Gallery moderation decides whether uploaded member images move from the private review queue into the approved public Gallery feed.

Moderation does not:

- edit `apps/web/public/data/gallery.json`
- publish static Gallery images
- automatically publish images to Instagram
- make the `member-gallery` Storage bucket public
- assign Discord roles
- bypass Supabase RLS or Storage policies
- require `supabase db push`
- require Edge Function deployment during normal review

Approved submissions are served to the public Gallery by the approved-feed Edge Function through distinct short-lived thumbnail and full-image URLs. Pending, rejected, archived, and historical approved rows without a validated thumbnail stay out of the public Gallery.

If a member opted in to Instagram sharing, approving the website Gallery submission creates an Instagram Queue job. It does not publish to Instagram. A moderator must review that separate queue and use a final confirmation before any external public post is sent.

## 2. Access Requirements

Moderators need:

- a website account signed in through Discord
- Discord membership in guild `1078630751077142608`
- the configured Discord Moderator role `1078630751165222984`
- a working server-side moderation function check

The Account page shows the Leader Dashboard link only after server-side moderator verification succeeds. A direct visit to `leader-dashboard.html` is also protected by the same checks.

If the dashboard shows access denied, do not try to work around it in browser tools. Confirm the Discord role, ask leadership to check server-side configuration, or defer to a Supabase/admin operator.

## 3. Review Queue Overview

Open the Leader Dashboard from Account.

The dashboard has four queue tabs:

- Pending
- Approved
- Rejected
- Archived

Use Refresh Queue after a moderation action or when coordinating with another moderator.

Each submission may show:

- preview image from a short-lived signed URL
- title
- caption
- uploader display details
- status
- category
- MIME type
- file size
- prepared Gallery thumbnail size or `Not prepared`
- submitted date
- reviewed date
- Instagram opt-in state
- Storage reference
- moderation history

Treat Storage references and signed preview URLs as operational details. Do not paste them into public Discord channels, public docs, issue comments, or screenshots.

## 4. Pending Review Checklist

Before approving a submission, check:

- the preview loads and matches the submitted title/caption
- the image is appropriate for the guild website
- the title is clear enough for public display
- the caption does not contain private information, harassment, slurs, spam, or unrelated promotion
- the category is reasonable for Gallery browsing
- the image does not reveal sensitive account, server, or personal information
- any Instagram opt-in is intentional and shown on the submission

If the preview is unavailable, do not approve by title alone. Refresh the queue once. If it remains unavailable, leave it pending and escalate.

## 5. Approving A Submission

Use Approve only when the submission is safe for the public Gallery.

After approval:

- the release-gated processed-media candidate uses the trusted Node decoder to prepare a bounded full-view WebP and its thumbnail from the private original; the browser does not attest published pixels
- the Edge Function verifies that the derivative is static WebP, no larger than 720 pixels on either edge, no larger than 80 KiB, and fully decodable by the pinned libwebp validator
- the function uploads a unique immutable revision under the service-only derivative prefix
- the row status, same-revision full/thumbnail references, review metadata, moderation event and opted-in Instagram queue/audit commit atomically
- the approved public Gallery feed may include the item
- an opted-in image may create an Instagram Queue job for later review

The candidate limits and provider approvals are recorded in
[`operations/GALLERY-PROCESSED-MEDIA.md`](operations/GALLERY-PROCESSED-MEDIA.md).
It is not deployed by editing this runbook. Unknown publication completion must
retain all potentially selected objects and be reconciled by refreshing the queue.
- no static Gallery JSON is edited
- no automatic Instagram publishing happens

If an older approved item says `Not prepared`, use the Approved queue's `Needs thumbnail` filter and paginated controls. Choose `Prepare gallery thumbnail` only after confirming the signed preview still matches the approved unit. The item remains absent from the public feed until that backfill succeeds and records a `thumbnail_refreshed` audit event.

If an approved item needs later removal from the public feed, do not edit `apps/web/public/data/gallery.json`. Use the moderation/admin path for changing the submission status, or escalate if that path is unavailable.

## 6. Instagram Queue

The Instagram Queue is a moderator-only second step for approved images where the member explicitly opted in. It is separate from website Gallery approval.

The queue may show:

- preview image from signed preview URLs
- title
- caption/subtitle
- uploader and submission source
- consent state
- eligibility
- job state
- last error
- Instagram permalink after publish or manual share

JPEG images are eligible for the v1 single-image feed workflow. PNG and WebP submissions are marked ineligible instead of being converted or posted.

Current launch mode is manual sharing:

- review the image and consent state
- review or edit the Instagram caption
- review or edit the alt text
- download the image from the signed preview URL
- copy the caption and alt text
- post manually from the official Instagram account or Meta Business Suite
- paste the Instagram permalink if available
- click `Mark shared manually`
- review the in-card confirmation prompt and click `Confirm manual share`

Meta API publishing should remain disabled until Meta developer registration is complete, `INSTAGRAM_*` Supabase secrets are set, and the moderator-only `Check Meta API` diagnostic passes. The diagnostic does not create media containers or publish posts.

Do not publish test images, live images, or retry failed jobs unless the owner has approved the live Instagram action. Do not paste signed preview URLs into Discord, GitHub, public docs, screenshots, or Meta setup notes.

## 7. Declining A Submission

Decline requires a reason.

Good decline reasons are concise, specific, and kind:

- `Caption includes private account details.`
- `Image is unrelated to the guild Gallery.`
- `Preview is unclear; please resubmit a cleaner image.`
- `Duplicate submission.`

Avoid:

- private moderator notes
- internal policy debate
- personal criticism
- Discord-only context that the member cannot understand
- secrets, private URLs, or admin details

Rejected submissions remain private and should not appear in the public Gallery.

## 8. Moderation History And Audit Trail

Moderation actions are expected to update:

- `gallery_submissions.status`
- `gallery_submissions.reviewed_by`
- `gallery_submissions.reviewed_at`
- `gallery_submissions.rejection_reason` when declined
- `gallery_moderation_events`

Instagram publishing actions are expected to update:

- `gallery_instagram_publish_jobs`
- `gallery_instagram_publish_events`

The audit trail is for operational accountability. Do not manually edit audit rows from the browser. Direct database repair should be handled only in a separate approved admin task.

## 9. Common States And Responses

| State | What it means | Response |
| --- | --- | --- |
| Signed out | Browser has no active website session. | Choose a sign-in method again. |
| Access denied | The signed-in account does not pass moderator verification. | Confirm Discord Moderator role and server-side config. |
| No pending submissions | The pending queue is empty. | No action needed. |
| Preview unavailable | Signed preview URL could not be created or object is missing. | Refresh once; if still missing, leave pending and escalate. |
| Decline reason required | Decline was clicked without enough reason text. | Add a short reason and try again. |
| Function request failed | Edge Function returned an error or network failed. | Refresh once, avoid repeated clicking, then escalate with time and visible message. |
| Counts look stale | Another moderator may have acted or the queue changed. | Refresh Queue. |
| Instagram job ineligible | Opted-in image cannot be posted by the v1 workflow. | Leave it unposted unless a later approved conversion workflow exists. |
| Instagram publish failed | Meta or Supabase rejected the publish attempt. | Do not repeatedly click. Record the visible message and escalate. |

## 10. Escalation Checklist

When escalating, include:

- page URL
- queue tab
- approximate time
- visible error message
- whether the moderator is signed in
- whether the Moderator role was recently changed
- submission title or ID if visible

Do not include:

- Supabase service-role keys
- Discord bot tokens
- database passwords
- JWTs
- signed preview URLs
- private Storage URLs
- screenshots showing private Storage references unless the recipient is an approved admin channel
- Instagram access tokens, account IDs with secret context, or Meta access-token URLs

## 11. Safe Operations Boundary

Normal moderation should only use the website dashboard.

Do not run these commands as part of routine moderation:

```sh
supabase db push
supabase functions deploy
supabase secrets set
```

Those are deployment/admin operations and require a separate approved branch or explicit operator instruction.

If a fix appears to require database mutation, Edge Function deployment, a secret change, direct Storage repair, Reaper slash-command registration, or a live Instagram post, stop moderation and open a scoped admin task.

## 12. Local QA Checklist

For a local dashboard smoke, use mocked states unless approved live credentials are available:

- signed out
- access denied
- moderator with pending queue
- approve success
- opted-in approval creates Instagram Queue item
- Instagram Queue requires final confirmation
- decline reason required
- decline success
- function failure
- no pending submissions

Run the standard repository checks after docs or workflow changes:

```sh
npm run check
git diff --check
node scripts/check-json.mjs
node scripts/check-js.mjs
node scripts/check-refs.mjs
node scripts/check-assets.mjs
npm run check:production
npm run smoke:gallery
```

The known large MP3 asset warning is expected unless the audio asset policy changes in a separate branch.

## 13. Related Files

- `account.html`
- `leader-dashboard.html`
- `leader-dashboard.js`
- `gallery-submit.html`
- `gallery-submit.js`
- `gallery.js`
- `supabase.js`
- `supabase/functions/list-instagram-publish-queue`
- `supabase/functions/mark-instagram-gallery-submission-shared`
- `supabase/functions/publish-instagram-gallery-submission`
- `supabase/README.md`
- `reports/member-gallery-end-to-end-review.md`
- `reports/account-member-dashboard-review.md`
- `reports/gallery-approved-feed-integration-review.md`
