# Member Gallery Moderation Runbook

This runbook is for leaders reviewing member Gallery submissions through the website Leader Dashboard.

It does not contain secrets, tokens, private URLs, or deployment credentials.

Tracking PR: <https://github.com/Mochirii-Wushu/Mochirii-Website/pull/123>

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

Published submissions are served to the public Gallery by the approved-feed Edge Function. Its list returns only short-lived bounded thumbnails; the viewer resolves one bounded display derivative on demand from a stable opaque publication ID. The member-owned source original remains private. Pending, rejected, archived, and historical approved rows without a complete immutable publication revision stay out of the public Gallery.

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
The queue entry is a reviewed snapshot. A referenced source object cannot be replaced or deleted by the member, and the final moderation transaction compares the row revision shown to the moderator. If any descriptive field changes before commit, the action fails closed; refresh and review the current item again.

Each submission may show:

- a `Prepare private preview` action until that one source is structurally and fully decoded
- a preview image only after current validation evidence exists
- title
- caption
- uploader display details
- status
- category
- MIME type
- file size
- prepared Gallery thumbnail size or `Not prepared`
- prepared Gallery thumbnail decoded width and height
- submitted date
- reviewed date
- Instagram opt-in state
- Storage reference
- moderation history

Treat Storage references and private preview evidence as operational details. Do not paste them into public Discord channels, public docs, issue comments, or screenshots.

## 4. Pending Review Checklist

Before approving a submission, check:

- `Prepare private preview` completes for the selected item before any prepared image is loaded
- the preview loads and matches the submitted title/caption
- the image is appropriate for the guild website
- the title is clear enough for public display
- the caption does not contain private information, harassment, slurs, spam, or unrelated promotion
- the category is reasonable for Gallery browsing
- the category is one canonical Gallery category: Portraits, Gatherings, Action, Scenery, or Companions
- the image does not reveal sensitive account, server, or personal information
- any Instagram opt-in is intentional and shown on the submission

Preparing a preview reserves the exact source bytes, validates and fully decodes the exact current Storage object, and binds its MIME type, encoded byte size, dimensions, SHA-256, object identity, and durable validation timestamp to the submission revision. Accepted sources are static JPEG, PNG, or WebP no larger than 8 MiB, 4096 pixels on either edge, or 12.6 megapixels. The same-origin website route independently decodes and re-renders a metadata-free WebP no larger than 2560 pixels per edge or 2 MiB. Only that derivative reaches the browser; no source URL or signed Storage capability does. Validation evidence is service-only and becomes stale if the object identity or row revision changes. The ordinary queue does not bulk-download or bulk-validate private originals.

The private source-byte step also requires a verified, short-lived Website
workload identity in addition to the moderator session. A moderator bearer sent
directly to the Edge endpoint receives no bytes. If the workload identity is
missing, expired, has the wrong project/environment claims, or cannot be
verified, the preview stays unavailable and the response remains opaque. Do
not bypass that gate or copy identity headers into a browser, log, ticket, or
manual request.

If validation fails or the preview is unavailable, do not approve by title alone. Refresh the queue once. If it remains unavailable, leave it pending and escalate. Never bypass validation by opening a raw Storage path.

## 5. Approving A Submission

Use Approve only when the submission is safe for the public Gallery.

After approval:

- the moderation browser reuses the one validated preview download to create a metadata-stripped WebP display image and thumbnail; it must not fetch the private original a second time
- the display image is no larger than 2560 pixels on either edge or 2 MiB
- the thumbnail is no larger than 720 pixels on either edge or 80 KiB
- the Edge Function verifies that both assets are static WebP and fully decodable by the pinned libwebp validator
- the stable publication ID owns one service-only display path, while each thumbnail refresh receives a new immutable revision ID and path
- reviewed copy, category, display name, timestamps, media metadata, and the per-revision thumbnail are frozen in the private publication ledger
- the row status, moderation event, prior-revision retirement, and new publication revision commit atomically
- a stale queue snapshot cannot commit; the moderator must refresh and review the current text and image again
- the approved public Gallery feed may include the item
- an opted-in image may create an Instagram Queue job for later review
- no static Gallery JSON is edited
- no automatic Instagram publishing happens

If an older approved item says `Not prepared`, use the Approved queue's `Needs thumbnail` filter and paginated controls. Treat that label as an explicit publication-media review, not a mechanical thumbnail backfill. Republish only after confirming the prepared private preview still matches the reviewed unit and selecting one canonical category. The workflow creates both bounded assets and an immutable publication revision. The legacy row remains private until that transaction succeeds and records its moderation audit event; approval status or old thumbnail fields alone are never publication evidence.

Historical approved rows with a null or noncanonical visual category require a separate human review. Do not infer a category from the upload source, filename, caption, or old provider metadata. They remain private until explicit republication with a canonical category. Category review and publication-media preparation may be coordinated for the same unit, but neither is a bulk backfill; each remains a separate authorized operation with its own exact provider-data approval.

If an approved item needs later removal from the public feed, do not edit `apps/web/public/data/gallery.json`. Use the moderation/admin path for changing the submission status, or escalate if that path is unavailable.

Archiving or otherwise removing approval retires the active revision immediately.
Retired revision records remain immutable, and their service-owned objects must
be retained for at least one hour so in-flight snapshot delivery can finish.
Do not delete or rewrite them during routine moderation.

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
| Private preview required | This exact source has no current trusted validation evidence. | Choose `Prepare private preview` for that one item before reviewing it. |
| Source validation failed | The file is malformed, animated, mismatched, or outside the reviewed limits. | Leave it pending and ask the member for a static JPEG, PNG, or WebP within the stated limits. |
| Preview unavailable | The metered validation or prepared same-origin preview failed. | Refresh once; if still missing, leave pending and escalate. |
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
