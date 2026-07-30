# Facebook Page Gallery Publishing

## Release boundary

This integration publishes a moderator-approved private JPEG derivative to the
Mochirii Facebook Page. It never publishes to a Facebook Group. Meta removed
Groups API publishing in Graph API v19; a moderator may share a verified Page
post to the Guild group manually.

Gallery approval and Page publication are separate audited actions. Publication
requires `job_id`, final `message`, exact `expected_updated_at`, a confirmation
fingerprint, and `confirm_facebook_publish: true`. The fingerprint binds the
destination, current job state and attempt, final copy, and authenticated
moderator. Edge recomputes it and the begin RPC locks and rechecks the same
revision. Edited, stale, reused, or mismatched confirmation fails before Meta.

## Runtime configuration

All values are Supabase Edge Function secrets. Values and private identifiers
must not enter Git, Vercel, browser variables, logs, screenshots, artifacts, or
PR text.

```text
META_APP_ID
META_EXPECTED_APP_ID
META_APP_SECRET
FACEBOOK_PAGE_ID
FACEBOOK_EXPECTED_PAGE_ID
FACEBOOK_PAGE_ACCESS_TOKEN
FACEBOOK_API_VERSION=v26.0
FACEBOOK_PAGE_PUBLISH_ENABLED=false
```

Configured and independently expected identifiers must be numeric and match
exactly. Publishing also requires the exact
`FACEBOOK_PAGE_PUBLISH_ENABLED=true` value. The flag remains false through
Preview, credential installation, and read-only diagnostics.

The public Facebook Page website/link field stays empty. Public contact may use
`support@mochirii.com`, while Mochirii's own legal pages remain available on
`mochirii.com`. Moderator-approved Page messages may not contain or share any
URL.

## Provider request contract

- Origin is fixed to `https://graph.facebook.com`.
- Every path is pinned to `/v26.0/`; floating and older versions fail closed.
- Access tokens travel only in the `Authorization: Bearer` header.
- Every normal request receives a fresh `appsecret_time` and
  `appsecret_proof`, HMAC-SHA256 over
  `access_token + "|" + appsecret_time`.
- Proofs are never reused and expire after five minutes.
- Redirects are rejected, requests have bounded timeouts, and no provider
  request is automatically retried.
- Responses are bounded. Only allowlisted status/type/code fields may enter
  audit details.
- Messages reject schemes, `www`, bare domains, link shorteners, and other
  URL-like text before database or provider access.

The publisher verifies the randomized metadata-stripped JPEG against its
database-attested size and SHA-256 before one
`POST /{page-id}/photos` request. Success is not final until a fresh Graph read
verifies the returned object id, `from.id`, and canonical permalink against the
independently pinned Page. Network loss, timeout, 5xx, missing id, or missing
ownership evidence enters `reconcile_required`.

## Endpoints and diagnostics

Authenticated moderator `POST` endpoints, all with `verify_jwt=true`:

- `check-facebook-page-api-status`
- `list-facebook-page-publish-queue`
- `publish-facebook-page-gallery-submission`
- `resolve-facebook-page-publish-reconciliation`

Status returns safe booleans, version, timestamp, and stable error categories
only. Meta's token debugger requires the inspected token in the `input_token`
query parameter. No query-token exception is approved, so the diagnostic makes
zero debugger requests and fails closed with
`meta_token_debug_query_transport_not_approved`. App binding, token type,
scopes, expiry, and data-access expiry remain activation blockers.

A `confirmed_published` reconciliation uses an object id only as a lookup key;
Edge independently requires the official pinned owner and canonical permalink.
`confirmed_not_published` is a separate recorded manual inspection. No retry is
automatic.

After success, the UI may offer a moderator-only manual Page-to-Group handoff.
Source and docs must never claim automatic Group publishing.

Official references:

- [Graph API v26 changelog](https://developers.facebook.com/docs/graph-api/changelog/version26.0/)
- [Graph API v19 changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0/)
- [Facebook Login security](https://developers.facebook.com/documentation/facebook-login/security)
