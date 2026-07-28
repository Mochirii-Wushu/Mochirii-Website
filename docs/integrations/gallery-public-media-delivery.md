# Gallery Public Media Delivery

## Status

The Gallery publishes reviewed, immutable, service-owned WebP derivatives from
the private `member-gallery` bucket. Visitors receive stable, credential-free
Edge media URLs keyed only by an opaque publication UUID. Member upload paths,
member identity, raw originals, provider credentials, and bearer-capability
URLs never cross the public DTO boundary.

This document describes source behavior only. Migration application, function
deployment, historical publication work, and Website release remain separately
approval-gated. Recalculate the exact function inventory and JWT parity from
the final reviewed head before requesting a provider change.

## Decision

Public Gallery delivery uses immutable, service-owned Gallery revisions rather
than public Storage objects or bearer-capability URLs. Each visible item keeps
one opaque publication UUID; each thumbnail refresh creates an opaque revision UUID.
Only metadata-stripped WebP derivatives cross the public media boundary.

## Immutable publication model

Moderation prepares two metadata-stripped derivatives from one validated
source:

- display WebP: at most 2 MiB and 2560 pixels on either edge
- thumbnail WebP: at most 80 KiB and 720 pixels on either edge

The private source validator accepts only static JPEG, PNG, or WebP input no
larger than 8 MiB, 4096 pixels per edge, or 12.6 megapixels. Its evidence is
bound to the submission revision and exact Storage object ID, version,
timestamp, MIME type, size, decoded dimensions, SHA-256, and validator version.
Stale or mismatched evidence fails closed.

The first approval assigns one stable publication UUID and one revision UUID.
A later thumbnail refresh retains the publication UUID and display derivative,
retires the previous revision, and creates a new revision UUID. Paths remain:

```text
_approved/publications/{publication-id}/display.webp
_approved/publications/{publication-id}/revisions/{revision-id}/thumbnail.webp
```

`private.gallery_publication_revisions` freezes reviewed copy, canonical
category, internal attribution evidence, source dates, visibility, both object
identities and versions, decoded media bounds, and both SHA-256 digests. RLS is
enabled and browser roles have no table privileges. The moderation state,
audit event, revision retirement, new revision, and opted-in social publishing
outbox record commit in one database transaction.

Internal attribution remains available for accountable moderation, but the
anonymous list DTO intentionally omits uploader identity.

## Public interface

The credential-free `list-approved-gallery-submissions` Edge Function is the
only public boundary.

### List

`POST` JSON action `list` returns schema version 2 with:

- at most 24 immutable publication records
- one stable thumbnail Edge URL per item
- bounded thumbnail dimensions and byte size
- public title, caption, category, dates, and facets
- one opaque keyset cursor when another page exists
- `partial=false`, `deliveryFailures=0`, and a 15-second client cache hint

The list never returns display bytes, uploader identity, raw originals,
bucket names, Storage paths, object IDs, hashes, member IDs, moderator IDs, or
provider errors. The stable item ID is the publication UUID, not a revision or
submission UUID.

Page delivery is all-or-nothing: one malformed or undeliverable item produces
a customer-safe `503`, returns no runtime page, and never advances the cursor;
failures never advance traversal. Facet evidence must contain all six facets:
`member-submissions` and the five canonical Gallery categories.

### Media URL resolution and delivery

`POST` actions `thumbnail` and `full` return only the matching stable Edge URL.
The URL has the exact shape:

```text
/functions/v1/list-approved-gallery-submissions?asset={thumbnail|full}&id={publication-id}
```

The browser then uses credential-free `GET`. Before returning bytes, the Edge
Function:

1. resolves the current or snapshot-retained immutable publication;
2. reserves the request and expected bytes in the global database budget;
3. downloads the private service-owned object;
4. verifies exact MIME type, size, and SHA-256 against the ledger; and
5. returns WebP with `X-Content-Type-Options: nosniff`.

Successful media uses `Cache-Control: private, max-age=300,
stale-while-revalidate=60`. JSON and errors use `no-store`. The browser may
retry the same bounded URL once; it must never construct a Storage URL or add
an authorization or API-key header.

## Pagination, search, and visibility

Schema version 2 uses a ten-minute stable snapshot and keyset order over
`(source_reviewed_at, source_created_at, revision_id)`. Cursors are opaque,
versioned, context-bound, and rejected when malformed, incomplete, expired,
future-dated, or reused with a different sort, category, or search query.

Search is NFKC-normalized and limited to 80 characters. Sort is `newest` or
`oldest`. Every publication belongs to `member-submissions` plus exactly one
of `portraits`, `gatherings`, `action`, `scenery`, or `companions`.

A revision is eligible only while its visibility interval covers the snapshot,
its category is canonical, both exact Storage objects still match the frozen
object identity/version/timestamp and metadata, and the source remains
approved. Recently retired revisions may resolve for up to one hour so an
in-progress snapshot can finish; archiving the source prevents new resolution.

## Egress and abuse boundaries

Every request first passes a per-isolate token bucket: burst 48, refill two per
second, and at most 12 concurrent non-preflight requests. This is not a global rate limit;
a database advisory
lock serializes the authoritative cross-isolate budget:

| Delivery | Requests/minute | Requests/UTC day |
| --- | ---: | ---: |
| List | 120 | 10,000 |
| Thumbnail | 240 | 10,000 |
| Full display | 30 | 500 |

All delivery kinds share a conservative 64 MiB reserved-byte ceiling per UTC
day. A list reserves 64 KiB; media reserves its immutable recorded size.
Denied reservations do not increment counters. Minute saturation returns the
next-minute retry; daily saturation returns the next UTC-day retry. Invalid or
unreadable reservation evidence fails closed with no media download.

These limits are cost containment and defense in depth, not authentication.
Operational review must still use Supabase egress/service breakdowns and
redacted function health evidence.

CORS is also not authorization or abuse prevention. The public function accepts
credential-free browser requests by design; schema validation, immutable object
evidence, bounded delivery, and the global database budget remain the security
and cost boundaries.

## Failure and retry contract

- A malformed database page or one malformed item returns no runtime page.
- Partial pages never advance traversal.
- The static Gallery remains usable when the runtime feed is unavailable.
- One user-activated list retry repeats the same normalized request boundary.
- One thumbnail or display failure may retry the same bounded Edge URL once.
- No original is requested until the viewer opens.
- Closing or changing an item aborts obsolete work and restores focus.
- Logs and customer errors omit paths, credentials, member identity, hashes,
  provider details, and raw response bodies.

## Verification and release gates

Before merge or provider authorization:

1. Run a clean local database reset and the complete pgTAP suite.
2. Pass database lint plus security and performance advisors.
3. Pass Edge helper tests, frozen lock/type checks, repository checks, Web lint
   and build, and the Chromium/Firefox/WebKit Gallery matrix.
4. Prove no anonymous DTO contains uploader identity or Storage references.
5. Prove no display request occurs before viewer activation and the first 24
   thumbnails remain below 2 MiB.
6. Run the reviewed read-only reconciliation SQL and require traversal/facet
   parity.
7. Recalculate migrations, function inventory, JWT parity, and exact source
   head before requesting Vercel or Supabase authorization.

The current reviewed source baseline contains 33 Edge Functions with 20/13 JWT
parity. That count is evidence for this source head, not permission to deploy a
later head. No provider write, preview, migration application, function deploy,
or Website publication follows from this document alone.

Application rollback may restore the prior Vercel deployment and reviewed
function source. It must not delete publication objects, immutable revisions,
moderation evidence, or additive schema. Data cleanup requires a separately
reviewed destructive-action packet.

## Primary references

- [Supabase egress usage](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Supabase Storage production scaling](https://supabase.com/docs/guides/storage/production/scaling)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [PostgreSQL row comparisons](https://www.postgresql.org/docs/current/functions-comparisons.html)
- [PostgreSQL index ordering](https://www.postgresql.org/docs/current/indexes-ordering.html)
