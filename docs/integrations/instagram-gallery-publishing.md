# Instagram Gallery Publishing

## Release boundary

This integration publishes a moderator-approved private JPEG derivative to
`@mochirii_guild`. The account must be a Professional Business account linked
to the exact Mochirii Facebook Page. Business subtype is verified manually in
Meta owner UI; this code does not query an undocumented `account_type` field.

Gallery approval and publication are separate audited actions. Publication
requires `job_id`, final `caption`, required moderator-reviewed `alt_text`,
exact `expected_updated_at`, a confirmation fingerprint, and
`confirm_instagram_publish: true`. The fingerprint binds destination, current
job state and attempt, caption, alt text, and authenticated moderator. Edge
recomputes it and the begin RPC atomically rechecks the revision.

## Runtime configuration

All values are Supabase Edge Function secrets and must never enter Git, Vercel,
browser variables, logs, screenshots, artifacts, or PR text.

```text
META_APP_ID
META_EXPECTED_APP_ID
META_APP_SECRET
INSTAGRAM_ACCOUNT_ID
INSTAGRAM_EXPECTED_ACCOUNT_ID
INSTAGRAM_ACCESS_TOKEN
INSTAGRAM_API_VERSION=v26.0
INSTAGRAM_PUBLISH_ENABLED=false
```

Configured and independently expected identifiers must be numeric and match
exactly. Facebook and Instagram flags are independent.

The public Instagram website/link field stays empty. Public contact may use
`support@mochirii.com`, while Mochirii's own legal pages remain on
`mochirii.com`. Moderator-approved caption and alt text may not contain or
share any URL.

## Provider request contract

- Origin is fixed to `https://graph.facebook.com`.
- Every Graph path is pinned to `/v26.0/`.
- Tokens travel only through `Authorization: Bearer`.
- Every request gets a fresh five-minute `appsecret_time` and HMAC-SHA256
  `appsecret_proof`.
- Redirects are rejected, timeouts and responses are bounded, and no provider
  request is automatically retried.
- Caption and alt text reject schemes, `www`, bare domains, link shorteners,
  and other URL-like text, including common obfuscations.

Before a write, the publisher reads the exact account id and username and
queries `content_publishing_limit`. Usage and total come from Meta; no quota is
hard-coded. Missing, malformed, or exhausted quota evidence fails closed. The
read-only diagnostic first queries the independently pinned Facebook Page for
its `instagram_business_account`, requires the returned Page id and linked
Instagram id to match the runtime and independent server-side pins exactly,
and returns only safe linkage booleans. It never returns either provider id or
the raw Graph response.

The source is a randomized, metadata-stripped, database-attested JPEG exposed
to Meta only by a temporary bearer-free signed URL. The URL must be HTTPS,
origin-bound to the configured Supabase project, and scoped to the private
Gallery social-derivative path:

1. `POST /{ig-user-id}/media`
2. one immediate bounded read of container `status_code`, with the closed
   allowlist `FINISHED`, `IN_PROGRESS`, `ERROR`, `EXPIRED`, and `PUBLISHED`;
   only `FINISHED` may continue in the same invocation. `IN_PROGRESS`, every
   terminal failure, and every unknown or oversized value enter
   reconciliation without an in-request polling loop or retention of the raw
   provider value
3. `POST /{ig-user-id}/media_publish`
4. read media `id,owner,username,permalink,media_type`

Success requires the returned id, independently pinned owner, exact username,
image type, and canonical permalink. Network loss, timeout, 5xx, missing id,
non-terminal container, or missing ownership evidence enters
`reconcile_required`.

## Endpoints, diagnostics, and withdrawal

Authenticated moderator `POST` endpoints, all with `verify_jwt=true`:

- `check-instagram-api-status`
- `list-instagram-publish-queue`
- `publish-instagram-gallery-submission`
- `resolve-instagram-publish-reconciliation`
- `mark-instagram-gallery-submission-shared` is an authenticated `409`
  compatibility stub and cannot upgrade or publish legacy jobs

Status returns safe booleans for the pinned Page-to-Instagram linkage, direct
identity, version, timestamp, quota availability, and stable error categories
only. The Page linkage uses the Facebook Page access token, bearer
authorization, a fresh timed app-secret proof, one network attempt, and a
bounded response. The token debugger requires `input_token` in the URL; no
exception is approved. The route makes zero debugger calls and reports
`meta_token_debug_query_transport_not_approved`. Token binding, type, scopes,
expiry, and data-access expiry remain activation blockers. Business subtype is
also a manual owner prerequisite.

A `confirmed_published` reconciliation uses the media id only as a Graph lookup
key and independently verifies owner, username, type, and permalink.

Members use `withdraw-gallery-publication-consent`. Pending jobs cancel
atomically, publishing or ambiguous jobs quarantine, and published jobs create
a removal request. Original consent and an immutable withdrawal event remain.
No response pretends Meta removed an external copy.

Keep Instagram's website field empty and omit `mochirii.com` from profile,
caption, alt text, and generated copy.

Official references:

- [Graph API v26 changelog](https://developers.facebook.com/docs/graph-api/changelog/version26.0/)
- [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/)
- [Official Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Facebook Login security](https://developers.facebook.com/documentation/facebook-login/security)
