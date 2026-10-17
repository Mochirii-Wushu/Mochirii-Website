# Gallery processed-media release candidate

Status: Free-plan source revision authorized on 16 October 2026 (UTC+8), not deployed.
Production and this candidate both retain the existing 50 MiB original/bucket
limit. The corrected static shot-44 image is a separate completed
release and is not processed by this pipeline.

## Limits and rationale

| Boundary | Limit |
| --- | --- |
| Website original | 50 MiB (52,428,800 bytes) |
| Discord original in Edge | 50 MiB (52,428,800 bytes) |
| Decoded still image | 40,000,000 pixels; longest edge 16,384 |
| Published full view | WebP; 3 MiB; longest edge 2,560 |
| Published thumbnail | WebP; 80 KiB; longest edge 720 |
| Node processing | 20-second deadline; 768 MiB sampled RSS rejection |
| Node concurrent admission | One shared project lease plus an instance guard; no buffered queue or automatic stale takeover |

The existing 50 MiB cap is retained to stay on Free. It is an application/provider
boundary, not a Where Winds Meet or social-platform rule. The superseded 100 MiB
proposal is not part of this release. The independent pixel cap admits 7680 × 4320
(33,177,600 pixels) and rejects decompression bombs with much larger dimensions.
Byte limits alone do not bound decoded memory. The RSS check is a sampled
application rejection threshold, not an OS-level hard memory allocation limit.
Native per-operation timeouts and dimension limits additionally bound decoding.

JPEG, PNG and WebP are supported. Animated WebP/APNG, multi-picture JPEG,
GIF, HEIC, SVG and other formats are rejected. Original names/claimed MIME are
not decode authority. Originals remain private quarantine material until the
trusted Node decoder and moderation succeed. Browser previews are convenience,
not the server security boundary.

The full view is auto-oriented, sRGB-normalized, metadata-stripped, proportionally
resized without upscaling and adaptively encoded. Alpha is preserved where
present. Thumbnails are derived from that selected full image. The unchanged
24-thumbnail aggregate remains below 2 MiB; opening a viewer still triggers the
full-image download rather than initial grid rendering.

## Existing architecture, not a second service

The Website uploads originals directly to private Storage using TUS with 6 MiB
chunks. Authentication and existing member/RLS limits still apply. The TUS
library loads only when uploading. Credentials are refreshed before requests;
upload destinations are validated before attaching a bearer. Retry URLs stay
only in memory and are scoped to the same File, endpoint and object name.
Progress, local preview, cancellation and same-ID retries are accessible.
An upload attempt is paused after ten minutes; its in-memory URL permits a
bounded retry without deleting a possibly completed original.

The existing Leader Dashboard invokes a Node Server Action with only a bearer
and submission ID, never a large original-image request body. The existing review-queue
function freshly verifies moderator access and issues a short-lived private
original URL. The Node processor disables redirects, validates that exact URL,
stream-bounds the original, safely decodes it, and signs the exact derivative
envelope with a purpose-specific server-only HMAC key.

The existing moderation Edge Function freshly verifies the moderator again,
stream-bounds the proof envelope, binds actor/source/ETag/time/revision, verifies
the HMAC and fully decodes the bounded thumbnail using the existing pinned
libwebp validator. Full content is guaranteed by the authenticated Node decoder,
not by trusting a browser's dimensions or a structural WebP parser alone.
Private full/thumb objects use one immutable revision. A short service-only DB
transaction locks the source metadata and row, checks object closure, selects
both derivatives and writes the moderation audit. Instagram opt-in queue/audit
creation joins that transaction; it does not publish externally.

## Preservation and failures

Recorded originals are immutable even while pending. The admission revision
denies member original updates and deletes, including uncertain orphans; retirement
requires a separate proof-based operator action. No historical original is rewritten or
automatically removed. Legacy approved rows retain their existing original URL
until an explicitly authorized moderator preparation.

A failed pre-commit partial write may remove only this attempt's known newly
written unselected objects. A known DB rollback may do the same. An unknown RPC
completion retains all objects because the commit may have succeeded. Refresh
and same-ID/revision reconciliation prevent duplicate publication and audit/jobs.
Private operator cleanup must prove an orphan is unselected before deletion;
this candidate does not add automatic broad orphan deletion or backfill.

Instagram keeps its existing explicit opt-in, confirmation and JPEG-original
delivery path, separate from Gallery WebP. This work does not claim every
accepted original is Instagram-publishable. Instagram's separate media
eligibility and current API requirements must pass Preview acceptance before
release; no live post is part of verification.

## Required approvals and release order

1. Stay on the existing Free organization. Preserve the 52,428,800-byte global
   and Gallery bucket limits and all smaller unrelated bucket limits. No
   purchase, paid branch, upgrade or global-limit increase is authorized.
2. Approve this source's commit/push/PR and Preview release. Inspect CI first:
   pushing a PR may create a deployment/Preview database automatically.
3. Provision matching, independently generated purpose-specific
   `GALLERY_MEDIA_PROCESSOR_SECRET` values in protected Vercel server and Edge
   environments. Never use a service-role key as this HMAC key; never expose it
   through NEXT_PUBLIC, chat, evidence or logs.
4. Apply `20261014223059_gallery_processed_media.sql` and the subsequent
   `20261015203951_gallery_free_upload_admission.sql` in isolated Free staging and
   run all pgTAP tests, RLS/advisor checks, original overwrite/race controls and
   actual authenticated end-to-end upload/moderation/TUS/Instagram compatibility
   checks. Staging must use separate credentials, synthetic data and private Storage.
5. Only after exact-head review and explicit production approval: capture
   backups/inventory, apply the additive migration, deploy the changed existing
   Edge functions, then publish the Website. Verify signed-out denials, new and
   legacy feeds, thumbnail-first desktop/mobile behavior, cancellations/retries
   and storage closure. Recalculate the function inventory; do not reuse an old
   release's function count.

No paid upgrade, provider setting/secret change, migration application,
backfill, external post, PR or pipeline deployment is authorized by the source
implementation alone. Local Windows tests do not prove hosted runtime behavior.

Rollback requires a reviewed forward-fix: the old public thumbnail-only approval
RPC is deliberately unavailable. Do not restore the old moderation writer by
itself. Disable approvals, preserve originals/derivatives, and deploy a compatible
reviewed writer; additive columns and selected media should remain intact.

## Local validation checkpoint — 15 October 2026 (UTC+8)

Passed: root/app toolchain checks; full root repository checks; app lint (zero
errors, three pre-existing navigation warnings); production build; 19 focused
Node processing/coordinator/upload tests; six actual Edge publication/fault
tests; existing thumbnail decode tests; exact source-inventory guards; strict
UTF-8/LF/NUL/whitespace checks; desktop/mobile Home/Gallery smoke across 18
Chromium viewports, representative Firefox/WebKit views and touch; approved-feed
browser smoke. Local test server was stopped after verification.

Not run: new migration/pgTAP on a database; authenticated hosted TUS/moderation;
Linux-hosted native Sharp; live Instagram publication; Preview or production
pipeline release. Those are release blockers, not implied by local checks.
The candidate is prepared for commit/PR in `mochi/gallery-upload-processing`.
Read-only provider verification still finds Free plan, private JPEG/PNG/WebP
bucket and 52,428,800-byte limit. No provider configuration or secret was changed.

## Historical authorized release checkpoint — 15 October 2026 (UTC+8)

The paid-plan and 100 MiB portions below were superseded on 16 October by the
owner's explicit Free-plan/50 MiB decision. They are history, not standing authority.

The owner explicitly approved Supabase Pro, 100 MiB Website uploads, source
publication, the migration, server-secret setup, Preview validation and guarded
production release. This does not waive any check or authorize historical media
backfill, an Instagram post, unrelated providers, or another repository.

The DB test helper's dollar quoting was repaired before publication. The new
32-case pgTAP suite executes the real service transaction for non-object and
incomplete proofs, ETag drift, missing objects, same-revision replay, original
JPEG preservation, opt-in job/audit idempotence, feed closure and exact 100 MiB
boundaries. These cases still require execution in the isolated CI database.
Original, full and thumbnail metadata are share-locked for the transaction.

Fresh root and production-only app dependency audits pass. The complete app
audit reports the existing development-tooling advisory
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), affecting
`braces` through 3.0.3 with no patched version published. It is not introduced by
the Gallery dependencies. Do not force a breaking framework downgrade, suppress
the audit or treat the production-only audit as a complete audit PASS. The
full-audit release gate remains unresolved pending a reviewed remedy or an
explicit owner decision.

The TUS endpoint is derived from the configured project URL, not the public
production-project constant. The actual upload helper has a regression proving
that separate production/Preview project URLs select separate Storage hosts and
reject non-provider, credentialed, insecure or path-bearing targets. Routine
access-token refresh does not cancel an in-progress transfer; the current token
is fetched before each chunk, while account changes still cancel it.

PR #619 predecessor `f6210b7d937ace2f0aa945e473c2b9e4fefda374` passed every
required GitHub check, including the complete isolated migration/pgTAP suite and
Linux native-image tests. Its exact-head Vercel Preview build is ready. Hosted
Supabase Preview was skipped, not passed; authenticated provider acceptance and
the paid-plan/secret/global-cap steps remain unrun.

Final source review additionally replaced the stream reader's retained chunk
array with one growable, maximum-bounded buffer. It snapshots each fragment
before a producer can reuse that fragment's backing memory and avoids metadata
growth proportional to fragment count. The new actual-reader regression passes;
the focused suite is now 21 Node tests plus six Edge publication tests. The
successor must rerun exact-head CI rather than reuse predecessor acceptance.
Shared `packages/gallery-media` changes now explicitly select the heavy
Supabase CI path; focused classifier controls reject unrelated package scope.

The historical billing checkpoint required manual browser sign-in. Do not change plan,
Storage limits or production secrets until target/cost readback and the guarded
release prerequisites are satisfied. The workstation remains Windows-native;
database and native-Linux runtime checks run only on isolated hosted CI/Preview.

## Free-plan continuation — 16 October 2026 (UTC+8)

The owner authorized revision of existing draft PR #619, an isolated Free
staging project in the existing Mōchirīī organization, source-blocker repairs and
validation. Purchases and upgrades are explicitly forbidden. Production merge,
migration, deployment and production secrets are not authorized by this continuation.

The owner separately approved these server-enforced admission limits:

- 20 new uploads per member per Singapore calendar day;
- at most 5 unreviewed rows/reservations per member;
- 250 MiB of unreviewed original capacity per member;
- 750 MiB project Storage admission ceiling, including completed objects in all
  buckets, outstanding original reservations and derivative headroom.

An unfinished original reserves the full 50 MiB slot rather than trusting a
client's declared size. Same-ID retries retain one reservation. Cancellation,
timeout and ambiguous completion retain both reservation capacity and possibly
durable objects. They never automatically erase an original or recycle its path.
Historical media is preserved even when a quota prevents new admission.

The project ceiling is an application admission safeguard, not a hard physical
or billing limit: duplicate in-flight TUS parts and unrelated service writers
must not be represented as covered by Gallery SQL locking. Hosted verification
must test real TUS permission probes and final object metadata.

The processing lease is purpose-HMAC authenticated and shared across instances.
Its 120-second age is diagnostic only; expired leases cannot be taken over.
Release requires the exact owner token after processing actually settles. A lost
release or terminated invocation fails closed. Operator recovery must first
prove the old invocation has stopped; no automatic stale-lease recovery is claimed.
The action page pins a 60-second hosting duration, with a 50-second application
deadline; sampled RSS remains a rejection threshold, not a hard memory limit.

Read-only provider verification finds the organization still Free and separate
healthy `Mochirii Gallery Staging` in Canada Central, PostgreSQL 17.11, initially
zero public tables and the 52,428,800-byte global limit. Production remains on
its separately observed PostgreSQL 17.6 revision. This difference must be recorded
in hosted evidence. Staging is unlinked from production Git deployment. No
production data or runtime credential is copied into it.

The owner separately authorized one staging-only processor secret pair and
branch-specific Vercel Preview URL/key binding. Values stay in protected provider
stores, never source, evidence or chat. Configuration readback now confirms only
those three branch-specific Preview keys, the write-only processor Secret type,
exact staging public URL/key, and unchanged production environment records. The
initial secret operation stopped after creation because its documented void
response was treated as JSON; the owner explicitly authorized one staging-only
replacement, whose paired Preview setup completed. No secret value was retained
in local evidence. A successful signed hosted processing flow is still required
to prove the deployed pair. Historical green CI does not accept this changed
candidate; the final head needs fresh validation.

Reservation-only Storage admission and revoked direct submission INSERT are
intentionally fail-closed for already-open older clients during the ordered
migration → Edge → Website transition. Plan a short upload-admission interruption
and require a page refresh; do not claim backward-compatible zero downtime.

Independent source review additionally binds cancellation after an awaited
session refresh, categorical containment of thrown moderator/configuration
lookups, and ambiguous acquire/release ordering. Only an explicit durable
`released` result proves lease cleanup; `not_owner` after a lost acquisition
response requires recovery because a delayed acquisition may still commit.

## Primary references

- [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Supabase Edge limits](https://supabase.com/docs/guides/functions/limits)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Sharp constructor safety options](https://sharp.pixelplumbing.com/api-constructor/)
- [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

The installed versions are pinned in the app lockfile: Node 22.23.1,
Next 16.3.8, Sharp 0.35.5 and tus-js-client 4.3.1. Release must use those exact
reviewed bytes rather than incidental dependency upgrades.
