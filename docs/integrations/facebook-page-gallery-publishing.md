# Facebook Page Gallery Publishing

## Status

This is the no-secret provider and source contract for publishing a
moderator-approved member Gallery image to the official Mōchirīī Facebook
Page. It does not authorize a deployment, a Supabase secret change, a live
post, or a Facebook Group mutation.

Provider state observed on 2026-07-29:

- Page: `Mōchirīī`
- Page ID: `1222888660907862`
- current Page URL: `https://www.facebook.com/mochiriiguildpage`
- official private Group: `https://www.facebook.com/groups/mochiriiguild`
- Business portfolio: `Mochirii`
- Meta app: `Mochirii Gallery Publishing` (`4210347289109364`)
- Page use case: `Manage everything on your Page`
- Page permissions added for testing: `pages_show_list`,
  `pages_read_engagement`, and `pages_manage_posts`
- Instagram content permissions added for the linked professional account:
  `instagram_basic` and `instagram_content_publish`
- app mode: unpublished
- Page-to-portfolio attachment: confirmed; Business Settings shows Page
  `1222888660907862` owned by `Mochirii`
- current owner access: Twills Lui has full Page access
- owner checkpoint and two-factor authentication: complete
- Page/System User authorization: the first token appeared in an automation
  snapshot and was revoked immediately without being stored or used; its
  replacement stayed opaque and verified the exact Page, `CREATE_CONTENT` Page
  task, linked Instagram username, and required scopes through Graph API v25
- hosted Supabase secrets hold the exact Page ID, replacement access token, and
  Meta app secret; no secret value is stored in this source tree or documentation
- hosted activation: `FACEBOOK_PAGE_PUBLISH_ENABLED=false`; the source packet,
  migrations, Edge Functions, and Website have not been deployed, and no live
  Page post was created
- public Page profile: Instagram `mochirii_guild` is listed alongside the
  existing TikTok and Twitch links; the website link label is exactly
  `mochirii.com`, and the public email is `support@mochirii.com`

The app is intentionally not published yet. Meta requires a real privacy-policy
URL, user-data-deletion instructions, and the remaining release requirements;
do not substitute a placeholder URL or publish the app until those owner/legal
and release gates are satisfied.

The Page website field and any public Facebook copy that displays the website
must use exactly `mochirii.com`, without `www`, a scheme, or alternate display
text. Where Facebook exposes a public contact-email field, use
`support@mochirii.com`. These display rules do not change full technical OAuth,
callback, API, or privacy-policy URLs.

## Supported destination

Meta removed the Facebook Groups API, including `publish_to_groups`, in Graph
API v19.0 and removed all versions on 2024-04-22. The website therefore cannot
publish directly to `https://www.facebook.com/groups/mochiriiguild` through an
official API.

The supported flow publishes to the Mōchirīī Facebook Page through the Page
Photos endpoint. After a successful Page post, the Leader Dashboard may offer
the official guild Group as a manual handoff. It must never label that handoff
as automatic Group publishing.

Official references:

- [Graph API v19.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0)
- [Create a Pages API app](https://developers.facebook.com/documentation/pages-api/create-an-app)
- [Page Photos endpoint](https://developers.facebook.com/docs/graph-api/reference/page/photos/)
- [Page access tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens)
- [App modes](https://developers.facebook.com/documentation/development/build-and-test/app-modes)
- [Instagram API with Facebook Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started)

## Consent and approval contract

Member upload consent is destination-specific and unchecked by default:

```text
I authorize Mōchirīī moderators to publish this image and its moderator-approved
caption on the public official Mōchirīī Facebook Page after gallery approval,
and optionally share that Page post manually to the private official Mōchirīī
Guild group.
```

Instagram and Facebook Page consent remain independent. The website submits
the unchecked-by-default boolean together with the exact non-secret contract
version shown to the member. The database treats both values as an untrusted
claim, verifies the website source and exact current version, then
server-attests the time, source, and visible-copy version. A missing, stale, or
arbitrary contract claim is recorded as unverified and is never silently
upgraded into publishable consent. Members cannot add or alter consent after
submission.

The current server-attested Facebook consent copy version is
`2026-07-website-public-facebook-page-group-v2`. Existing consent under another
version must never be silently upgraded or reused.

Gallery moderation and public Page publishing are separate decisions. The
moderator first reviews the safely decoded consented source, then may
choose `Approve for Gallery only`. That action commits the Gallery approval
and exact-once Facebook Page outbox record, but never sends a public post. In
the separate Page queue, a moderator edits the exact Page caption, arms the
unchanged caption, reviews the rendered image and caption, and confirms the
public action a second time. Editing the caption disarms confirmation.

The Page queue uses a bounded, status-bound opaque keyset cursor ordered by
`updated_at` and job ID. Previous/next navigation keeps every job reachable
without unstable offset pages, including queues larger than 50 records. Only
one external publish or reconciliation action can be active in the browser at
a time.

The moderation commit is fail-closed across Storage and Postgres. If the
moderation RPC returns a definite non-commit, the provisional derivative is
removed. If the RPC transport fails and commit outcome is unknown, the Edge
boundary returns `moderation_commit_outcome_unknown`, does not guess whether
the transaction committed, and does not delete the provisional object. The
moderator must reload/reconcile current database state; unbound objects remain
eligible for a separate evidence-driven cleanup rather than request-time
deletion.

Meta does not document an idempotency key for Page photo publishing. A timeout
or unknown provider outcome therefore enters `reconcile_required`; it is never
automatically retried because the post may already exist.
An attempt still marked `publishing` after its 15-minute server lease is also
quarantined to `reconcile_required` when a moderator loads the queue. The
automatic quarantine event is attributed to the system, not the viewing
moderator. The moderator must inspect the Page before any recovery. An explicit
two-step reconciliation form requires the moderator to choose the inspected
outcome and record a note before arming and confirming it. Confirming publication
uses retained provider evidence or requires a Facebook photo or post id; confirming
that no post exists moves the job to retryable `failed`, where publishing still
requires a separate approval. Neither outcome is automatic.

## Media integrity

New website social opt-ins accept only a JPEG already 320–1440 pixels wide,
no more than 1800 pixels high, and within the 4:5 through 1.91:1 feed ratio.
PNG and WebP remain valid for Gallery-only submissions. This is also enforced
by a database constraint for new opted-in rows; historical or unsupported
sources may still be approved for the Gallery but receive an explicit
`ineligible` social job.

The moderation browser never supplies social publication bytes. During
approval, the Edge boundary downloads the exact validated consented source,
checks its size and SHA-256, retains at most one strict first-segment minimal
JFIF APP0 marker, and derives a private JPEG by removing comment segments
without changing the JPEG frame or entropy-coded image data. Every APP1–APP15
segment is rejected, including EXIF (even orientation 1), ICC, SPIFF,
JUMBF/HDR, Photoshop, Adobe transforms, and vendor semantics. Arbitrary APP0
or JFXX, conversion, resizing, padding, and cropping also fail closed as
socially ineligible. This is exact JPEG
codestream/frame binding, not a claim that every decoder renders identical
pixels.

The private derivative evidence binds both immutable Storage objects, their
versions and timestamps, the consented-source digest, the derivative digest,
derivation method, destination, and current consent version in the same
transaction as Gallery approval and outbox creation. Each approval attempt
uses an unpredictable immutable revision path of the form
`_social/submissions/{submission-uuid}/{revision-uuid}.jpg`; a deterministic
`v1.jpg` path is invalid. That prevents retries or concurrent attempts from
overwriting evidence belonging to another attempt. Browser roles cannot read
the reserved derivative prefix. Immediately before posting, the Edge boundary
rechecks the frozen derivative object and exact bytes and uploads them as
multipart `source` to:

```text
POST https://graph.facebook.com/{version}/{page-id}/photos
```

The request includes the confirmed caption in Graph's `message` field and
`published=true`. The durable
result records the returned photo/post IDs, provider state, moderator actor,
timestamps, and a safe error classification. Before a result can become
`published`, the publisher re-reads the returned Graph object and requires its
`from.id` to equal the pinned Page ID. The stored link must normalize to an
HTTPS Facebook post/photo permalink; profile, homepage, credential-bearing,
fragmented, alternate-port, encoded-path, and arbitrary-query URLs fail
closed. Confirmed-published reconciliation performs the same read-only Graph
ownership check for every supplied photo/post ID and therefore requires the
configured Page credentials. Confirming not-published rejects any supplied
provider ID or permalink instead of accepting contradictory evidence.

Direct `service_role` access to the Page jobs and events tables is read-only.
All state changes go through the reviewed security-definer RPCs after the Edge
boundary verifies the moderator. Tokens, raw provider payloads, provider error
messages, member Storage paths, and signed URLs must never enter logs or
browser DTOs; provider failures use fixed operator-safe messages plus a small
allowlist of non-secret code/type/status fields.

## Runtime credentials

Use a least-privilege Employee System User assigned only the Meta app and the
Mōchirīī Page. Store the resulting Page token only in Supabase Edge Function
secrets:

- `META_APP_ID` pinned to the Mochirii Meta app (`4210347289109364`)
- `META_APP_SECRET`
- `FACEBOOK_PAGE_ID` pinned to the official Mōchirīī Page
  (`1222888660907862`)
- `FACEBOOK_PAGE_ACCESS_TOKEN`
- `FACEBOOK_API_VERSION`
- `FACEBOOK_PAGE_PUBLISH_ENABLED` (strictly `true` to activate; absent or any
  other value keeps publishing disabled)

The app and Page IDs are identifiers, not credentials. The app secret and Page
access token are secrets. Every authenticated Graph request includes a derived
`appsecret_proof`; neither underlying secret may enter a browser response or
log. Read-only diagnostics must reject a Page identity unless both the pinned
ID and exact `Mōchirīī` Page name match.
The activation flag is a server-only kill switch and must start as `false`.
Never place it in Git, local reports, screenshots, browser variables,
`NEXT_PUBLIC_*`, Vercel public variables, PR text, or this document.

Before production enablement, a separately approved provider packet must:

1. create the least-privilege System User and assign only Page content access;
2. generate the Page token without exposing it in logs or chat;
3. set the provider values in Supabase secrets, keep
   `FACEBOOK_PAGE_PUBLISH_ENABLED=false`, and deploy the reviewed
   migration/functions;
4. satisfy the app's privacy, data-deletion, icon/category, and Live-mode gates;
5. run the read-only Page identity diagnostic, approve activation, and set
   `FACEBOOK_PAGE_PUBLISH_ENABLED=true`; a non-blocking task probe may report
   `CREATE_CONTENT` or `PROFILE_PLUS_CREATE_CONTENT`, but Meta documents Page
   tasks on `/me/accounts` with a User token rather than on the Page-token
   identity request; and
6. use the first genuine moderator-approved member image as the publishing
   canary instead of creating a synthetic or throwaway public post.

## Linked Instagram account

The same app has the Facebook-login Instagram permissions for the current
[`@mochirii_guild`](https://www.instagram.com/mochirii_guild/) Professional
Business account. Instagram activation remains a separate fail-closed release:
the linked Graph identity, permissions, app-secret proof, provider restriction,
human review, runtime secrets, and explicit activation approval must all pass
the [Instagram publishing contract](instagram-gallery-publishing.md). Facebook
Page readiness does not enable Instagram publishing.
