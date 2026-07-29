# Gallery Publication Media And Public Feed Rollout Packet

## Scope

This packet adds an immutable public-delivery contract for reviewed member
Gallery submissions. It keeps `member-gallery` private, does not add a paid
resource or managed image transformation, and does not change static Gallery
assets.

Every publication uses two metadata-stripped WebP assets prepared once during
moderation:

- a display derivative no larger than 2560 pixels on either edge or 2 MiB
- a thumbnail no larger than 720 pixels on either edge or 80 KiB

The member-owned source original remains private and is never a public viewer
asset.

## Source changes

- Migration `20260727145241_add_gallery_submission_thumbnails.sql` adds the
  transitional source-row thumbnail metadata.
- Migration `20260728130000_add_gallery_public_feed_v2.sql` adds decoded
  geometry and the schema-v2 feed foundation while deliberately leaving
  incomplete legacy rows private.
- Migration `20260728132000_add_gallery_publication_revisions.sql` creates the
  service-only immutable `private.gallery_publication_revisions` ledger,
  exact object/version/hash bindings, stable publication identities,
  per-revision thumbnails, snapshot-safe feed lookups, and the serialized
  global delivery budget.
- `moderate-gallery-submission` validates and fully decodes both bounded assets
  with pinned libwebp 1.6.0 before the database transition can commit.
- The stable display path is
  `_approved/publications/{publication}/display.webp`.
- Every thumbnail refresh creates a new revision at
  `_approved/publications/{publication}/revisions/{revision}/thumbnail.webp`
  without changing the public publication ID.
- The moderation event, source-row state, retirement of the prior revision,
  new immutable revision, and opted-in social-publishing outbox record commit
  atomically.
- Referenced source objects are member-immutable, and the moderation commit
  compares the reviewed source-row timestamp. A stale queue item fails closed
  and must be reviewed again before publication.
- `list-approved-gallery-submissions` returns schema-v2 pages with at most 24
  stable, credential-free thumbnail Edge URLs. It delivers one bounded display
  derivative only after the viewer requests the stable opaque publication ID.
- The service-role-only v1 compatibility RPC remains available for the bounded
  application rollback window. It caps the old request at 24 rows and maps the
  old response shape to the same immutable display and thumbnail derivatives,
  with source paths and member/moderator identity removed.

The list contract is all-or-nothing. If any publication selected for a page is
missing, mismatched, malformed, or outside the delivery budget, the function returns a redacted
temporary-unavailability response with no items or cursor. It never skips an
item, advances past an undelivered item, leaks an object path, or returns a
partial page.

The first page records a stable ten-minute snapshot and sorts by the frozen
reviewed/created/publication keyset. Every opaque cursor preserves that
snapshot, so concurrent publications or thumbnail revisions wait for a fresh
traversal. Runtime totals and all six facets describe the complete filtered
snapshot, not only the current page.

## Security and retention contract

- `private.gallery_publication_revisions` has RLS enabled and no direct client
  or `service_role` table privileges.
- Only explicitly granted service-only functions may create or query revisions.
- A revision freezes reviewed copy, canonical category, internal attribution,
  source dates, exact Storage object identities/versions/timestamps, display
  and thumbnail metadata, and SHA-256 digests. Anonymous DTOs omit attribution.
- Revision rows cannot be deleted or rewritten. Only `visible_until` may move
  once from null to a retirement timestamp.
- Archiving or removing approval retires the active revision immediately.
- Retired publication objects remain available for at least one hour, covering
  the ten-minute cursor and bounded in-flight delivery window. Do not delete
  them earlier.
- Legacy approved rows with no complete publication revision remain private.
  Never infer, bulk-promote, or expose them from source-row fields.

Supabase documents that private-bucket assets require authorized access and
that service credentials bypass Storage RLS. The Edge delivery boundary keeps
that credential server-only and never returns it or a signed bearer URL:

- <https://supabase.com/docs/guides/storage/serving/downloads>
- <https://supabase.com/docs/guides/storage/security/access-control>

## Deployment boundary

This branch stays unmerged and undeployed until exact release approval covers
the migrations, changed Edge Functions, Supabase Preview, protected-main
Supabase deployment, and normal Vercel publication. No manual provider write is
part of this packet.

Before deployment, capture the current migration inventory, configured
function inventory, `verify_jwt` parity, and provider backups. Recalculate
those values at the exact reviewed head instead of copying an older release
count.

## Explicit historical republication

After an approved deployment, a moderator may work through historical approved
rows that are intentionally selected for public Gallery publication. Each unit
requires a fresh visual review, one canonical category, and confirmation that
the signed private preview matches the reviewed source. The same moderation
action prepares both bounded assets and writes one immutable publication
revision.

This is not an automatic backfill. Rows that are incomplete, null-category,
noncanonical, or not deliberately selected remain private even if their source
status says approved. Never map categories from provenance, filenames,
captions, or provider metadata.

Stop if:

- the preview does not match the reviewed image
- either bounded WebP cannot be generated or fully decoded
- an asset exceeds its byte or dimension bound
- Storage metadata does not match the proposed revision
- the audit or immutable revision transaction fails
- a list response exposes a display URL or returns a partial page
- an on-demand display response resolves to a thumbnail or source-original URL

Run `supabase/operations/validate_gallery_submission_thumbnails.sql` and
`supabase/operations/validate_gallery_submission_categories.sql` only as
reviewed, read-only closeouts. They verify active publication evidence; they do
not require every legacy approved source row to become public and do not alter
constraints or data.

## Reproducible decoder evidence

- libwebp release: `1.6.0`
- official release archive:
  <https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz>
- official archive SHA-256:
  `e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564`
- source commit: `4fa21912338357f89e4fd51cf2368325b59e9bd9`
- upstream source:
  <https://chromium.googlesource.com/webm/libwebp/+/4fa21912338357f89e4fd51cf2368325b59e9bd9>
- builder:
  `emscripten/emsdk:4.0.12@sha256:744fb6a68941970951bacf9d6632041a0398260492232691ef22bbf54b0585c6`
- generated module SHA-256: recorded beside `validator.generated.js`;
  `scripts/build-gallery-webp-validator.sh` must reproduce it before release

## Rollback

Application rollback may restore the prior Vercel deployment and prior Edge
Function source. The temporary
`gallery_publishable_submissions(integer, integer)` RPC is retained so that
combination remains functional: it is service-role-only, charges the list
budget, caps results at 24, requires exact active revision/object evidence, and
returns only the bounded service-owned display and thumbnail derivatives in
the legacy shape. It never returns the member-owned source original or member,
filename, moderator, or rejection identity fields.

Additive columns, the immutable publication ledger, and its evidence remain in
place. Do not remove the compatibility RPC until the rollback window has
closed and retained rollback source is no longer usable; retire it only in a
separate reviewed migration. Do not drop columns, delete revision rows, delete
publication objects, or rewrite moderation evidence during an incident; those
destructive actions require a separately reviewed retirement packet.

## Release inventory

This source reuses the existing public Gallery Edge Function. At this branch
baseline, `supabase/config.toml` remains exactly 33 functions with 20
`verify_jwt=true` and 13 false. Recalculate both counts from the final exact
head before requesting production approval. A future count is not authorized
by this packet.

See
[`../integrations/gallery-public-media-delivery.md`](../integrations/gallery-public-media-delivery.md)
for the public DTO, bounded Edge delivery, global quota, pagination, retry, and
security decision.
