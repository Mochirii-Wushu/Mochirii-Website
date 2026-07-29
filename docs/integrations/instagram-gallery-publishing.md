# Instagram Gallery Publishing

This contract tethers the moderator-approved member Gallery queue to the official
Mōchirīī Instagram Business account. It records provider identity without
recording credentials and keeps direct publishing disabled until every release
gate is complete.

## Source Release Status

This publishing packet is source-only and has not been deployed to the hosted
Website or Supabase project. `INSTAGRAM_PUBLISH_ENABLED` remains `false`, the
owner checkpoint and two-factor authentication are complete, and no live
Instagram post was created. The first token appeared in an automation snapshot
and was revoked immediately without being stored or used. Its replacement
stayed opaque and verified the exact linked Page, `CREATE_CONTENT` Page task,
required scopes, and username `mochirii_guild` through Graph API v25. Hosted
Supabase secrets hold the exact Instagram Graph ID, replacement token, and Meta
app secret; no secret or private Graph ID is stored in this source tree or
documentation. Live profile readback confirms that the bio contains no website
text and the disabled Website field is empty.

## Canonical Provider Identity

- Public account: [`@mochirii_guild`](https://www.instagram.com/mochirii_guild/)
- Account type: Instagram Professional, Business
- Linked Facebook Page: [`Mōchirīī`](https://www.facebook.com/mochiriiguildpage)
- Meta app: `Mochirii Gallery Publishing`, app identifier `4210347289109364`

Provider inventory identifiers outside the executable app/Page contract are
kept out of public documentation and are not substitutes for the private
Instagram Graph user id used by `INSTAGRAM_ACCOUNT_ID`.

Read-only Graph discovery has confirmed the Page-linked
`instagram_business_account.id`, username `mochirii_guild`, and account type
`BUSINESS`. Store that same private Graph user ID independently in both
`INSTAGRAM_ACCOUNT_ID` and `INSTAGRAM_EXPECTED_ACCOUNT_ID` Supabase Edge
Function secrets. The publisher fails closed unless those secret values are
valid and exactly equal, and a fresh live identity read returns the expected
username and account type. Never substitute an Accounts Center, Business
Settings, or other non-Graph inventory identifier, and never commit the
discovered Graph user ID.

Do not place or link `mochirii.com` in the Instagram profile, captions, or
publication templates. Where Instagram exposes a public contact-email field,
use `support@mochirii.com`. Keep the account focused on guild recruitment,
events, builds, guides, progression, and approved member showcases; use the
Wushu land, pretty, and cupcake accents sparingly. Desktop web settings
currently expose no public-contact email control, so this document does not
claim that the support email is displayed on Instagram.

## API Boundary

This Page-linked account uses the Instagram API with Facebook Login through the
fixed `https://graph.facebook.com` origin. The reviewed baseline is Graph API
`v25.0`. The app's least-privilege permission set is:

- `pages_show_list`
- `pages_read_engagement`
- `instagram_basic`
- `instagram_content_publish`

The website never receives the access token, configured Graph account id, or
expected Graph account id. Runtime values remain in Supabase Edge Function
secrets. `META_APP_ID` must equal the pinned
app id `4210347289109364`, and `META_APP_SECRET` is required. Every
token-bearing Graph request carries a server-computed HMAC-SHA256
`appsecret_proof`; the token remains in the authorization header, and neither
the token, secret, nor proof may be logged or returned. Enable Meta's server API
app-secret-proof requirement before activation. `INSTAGRAM_PUBLISH_ENABLED` defaults
to `false` and must equal the exact string `true` before the publisher performs
an account check, reads a queue job, creates a media container, or publishes.

## Consent And Media Safety

The unchecked website consent is exact and destination-specific:

```text
I authorize Mōchirīī moderators to publish this image and its moderator-approved caption on the public official Mōchirīī Instagram account after gallery approval.
```

Social publishing is available only when the member source is an already
feed-compatible JPEG that can be made metadata-free without changing its
pixels. PNG and WebP remain valid for the website Gallery when both social
options are off. The browser sends the boolean plus the exact, non-secret
contract handshake
`2026-07-website-public-instagram-publish-v2`. The database accepts only that
exact handshake as current, stamps the timestamp/source/copy provenance itself,
and makes all consent evidence immutable. Missing, stale, or arbitrary browser
versions are normalized to historical evidence and remain API-ineligible. This
lets a database-first rollout accept cached older clients without silently
upgrading the authorization they displayed. Discord attestations likewise stay
accurately labeled but are not eligible for API publishing without new website
consent.

Meta never receives the private member-source object. During approval, the Edge
Function downloads the frozen validated JPEG itself and performs only lossless
metadata stripping; browser-supplied social bytes are ignored. The database
binds the derivative to the source object identity/version/timestamp and source
SHA-256 under `jpeg-metadata-strip-v1`. Before signing a short-lived derivative
URL for Meta, the publisher rechecks both bindings plus the exact MIME, byte
count, dimensions, and SHA-256. The source must already be 320–1440 pixels wide,
within the 4:5 through 1.91:1 feed ratio, and within the 8 MiB provider limit.

## Delivery And Reconciliation

Publishing uses an atomic lease. A network error, Meta 5xx response, missing
media id, failed local success audit, or a lease older than 15 minutes enters
`reconcile_required`; no direct retry is allowed. A moderator must inspect the
official account and use the two-step reconciliation action. Confirming a post
requires a numeric media id, a canonical official Instagram post/reel
permalink, a note, and final confirmation. Confirming no post requires a note and returns the job to
`failed`, where a later publish still needs separate approval. The queue uses
status-bound stable keyset pagination and never exposes storage paths, hashes,
or signed object URLs to the browser.

Manual completion is disabled. The browser receives only a credential-free
approved Gallery thumbnail, never the frozen metadata-stripped JPEG, its
private `_social` path, or a reusable signed URL. A moderator therefore cannot
prove that a separately uploaded file is the exact derivative bound to the
queue job. The compatibility Edge route returns a moderator-gated `409`, and
the database exposes no manual-share mutation RPC. `shared_manually` remains a
read-only historical status for older records only.

Queued jobs remain pending while Graph publishing is disabled. Reconciliation
is available only after an ambiguous API attempt reaches
`reconcile_required`; it is not a substitute manual-post path. Edge functions
retain read-only queue/event table access and cannot directly insert, update,
or delete rows.

Provider error bodies are untrusted. A reflected Meta message is never stored,
returned, or logged because it may contain the short-lived signed derivative
URL. Moderator responses use fixed stage-specific text; audit details retain
only bounded status, type, code, and subcode identifiers.

## Current Activation Gates

Provider UI currently reports that `@mochirii_guild` cannot share links until
2026-08-28. Recheck the provider restriction after that date; elapsed time alone
is not release evidence.

Provider review also requires a human reCAPTCHA step. The account owner must
complete it manually. Do not automate, bypass, relay, or record the challenge.

Keep direct publishing disabled until all of the following are true:

1. The restriction is cleared in current provider UI.
2. The owner completes the human review step.
3. The Page query returns the linked Instagram Graph user id and the identity
   check returns `mochirii_guild` with account type `BUSINESS`.
4. That returned private Graph user id is stored as matching
   `INSTAGRAM_ACCOUNT_ID` and `INSTAGRAM_EXPECTED_ACCOUNT_ID` Supabase secrets;
   neither inventory identifier is substituted without provider evidence.
5. The app has the four permissions above for the owned Page and account.
6. The required runtime values exist only in Supabase secrets.
7. The moderator-only diagnostic passes while the activation flag is still
   false.
8. A separate owner approval explicitly authorizes setting
   `INSTAGRAM_PUBLISH_ENABLED=true` and deploying the reviewed release packet.

Queue review remains available while direct publishing is disabled, but no
manual completion action is available. Do not download a Gallery thumbnail,
WebP display asset, or original member upload for a separate Instagram post.
Do not create a synthetic or live post merely to validate configuration; the
first genuine approved member image is the publication canary after the release
gates pass.

## Official Sources

- [Meta: About professional accounts on Instagram](https://www.facebook.com/help/instagram/138925576505882)
- [Meta: Add or change the Facebook Page connected to an Instagram professional account](https://www.facebook.com/help/570895513091465)
- [Meta: Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Meta: Create an image container](https://www.postman.com/meta/instagram/request/23987686-f4b5a72d-a125-4080-8968-93de1a549e68)
- [Meta: Publish a media container](https://www.postman.com/meta/instagram/request/23987686-299b176b-90aa-4d8a-b6cf-e6028fc69de5)
- [Meta: Secure Graph API requests](https://developers.facebook.com/docs/graph-api/securing-requests/)
- [Supabase: Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
