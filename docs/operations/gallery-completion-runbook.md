# Gallery Completion Runbook

## Purpose

This runbook is the operational gate for publishing reviewed member Gallery
media without exposing private originals, uploader identity, Storage paths, or
provider credentials. It complements the customer/content rules in
[`../gallery-guide.md`](../gallery-guide.md), the delivery decision in
[`../integrations/gallery-public-media-delivery.md`](../integrations/gallery-public-media-delivery.md),
and the migration packet in
[`GALLERY-THUMBNAIL-ROLLOUT.md`](GALLERY-THUMBNAIL-ROLLOUT.md).

Source review, provider preview, production publication, and historical media
republication are separate authorization boundaries. Passing local tests never
authorizes a provider write.

## Invariants

- The source bucket and approved originals remain private and immutable.
- Public media is a metadata-stripped WebP derivative bound to one immutable
  publication revision and opaque publication ID.
- List delivery is atomic. A malformed or incomplete publication returns no
  runtime page and never advances its cursor.
- The grid requests only thumbnails. A full display image is requested only
  after the visitor opens the shared Home/Gallery viewer.
- Closing, retrying, changing the selected item, or unmounting aborts obsolete
  work and disposes any browser object URL.
- Runtime cards retain the shared 16:10 card geometry while their intrinsic
  thumbnail width and height reserve truthful browser layout space.
- Public list, thumbnail, and full-image delivery share the database-enforced
  64 MiB UTC-day budget. Capacity is defense in depth and cost control, not
  authentication.
- The public media URL is intentionally credential-free and public-CORS. It
  contains only an opaque publication ID; it must never be described as a
  private or authenticated URL.
- A historical row is not publishable until a human has reviewed the exact
  approved unit, derivative, category, crop, and description. Do not infer or
  bulk-promote historical rows.

## Phase 1: exact source review

1. Rebase or replay the focused Gallery commits onto the then-current protected
   `main`; never merge the preserved mixed or dirty worktrees.
2. Record the exact base, head, tree, changed paths, migrations, Edge Function
   inventory, and `verify_jwt` split.
3. Require a clean diff and prove no unrelated provider, secret, schedule,
   bucket, Auth, Data API, Social, Discord, Shopify, Unity, iOS, or payment
   change is present.
4. Confirm the client parser, Edge response, publication ledger, and approved
   source row agree on schema version, dimensions, byte limits, immutable
   revision identity, and source-to-publication counts.

## Phase 2: isolated local database evidence

Never reuse a local Supabase stack whose project ID, ports, or migration state
belongs to another worktree. Use a fresh temporary project and an exclusive
port set, stage only the exact reviewed `supabase` directory, and capture the
CLI/runtime versions before starting it.

Require:

1. a clean database reset applying every migration once in timestamp order;
2. all top-level pgTAP suites, including publication-ledger parity;
3. database lint with zero warnings;
4. security and performance advisor review against the disposable database;
5. the read-only Gallery reconciliation SQL proving source, private ledger,
   public traversal, facets, cursor boundaries, and object-evidence parity; and
6. a clean shutdown/removal of only the exact disposable project after its
   evidence is captured.

Do not use a hosted project to compensate for incomplete local evidence.

## Phase 3: application verification

Use the repository-pinned Node, npm, Deno, Supabase CLI, and browser versions.
Require:

```text
npm ci
npm run toolchain:check
npm run check
npm run check:production
npm run check:media-performance
npm run check:next-route-delivery
npm run check:gallery-approved-feed
npm run check:universal-lightbox
npm run check:supabase-edge-types
npm run test:gallery-browser-state
npm run test:gallery-approved-feed-client
npm run test:gallery-public-feed
npm --prefix apps/web run lint
npm --prefix apps/web run build
npm run smoke:gallery-approved-feed
npm run smoke:gallery
git diff --check
```

The browser suite must cover 320 CSS-pixel reflow through ultrawide desktop,
portrait/landscape/square media, 200% text, touch, reduced motion, asymmetric
safe areas, keyboard/focus, Share/Copy fallback, Back/Forward state, errors,
request cancellation, retries, and no unexpected console, page, request, or
HTTP failures. Physical Safari remains a release gate for dynamic browser
chrome and real safe-area behavior when that gate is required by the owning
release packet.

## Phase 4: preview authorization

After exact approval only:

1. push one focused branch and open one reviewed pull request;
2. require exact-head repository checks, Vercel Preview, and non-skipped
   Supabase Preview when the diff contains Supabase changes;
3. prove Preview applied only the reviewed migrations and preserved the exact
   function inventory/JWT split;
4. verify the Preview route matrix and Gallery matrix without publishing
   production data; and
5. stop for a separate production authorization if the approval did not
   explicitly cover protected-main merge effects.

## Phase 5: production release

The production packet must name the exact commit, migrations, function count,
JWT split, Vercel deployment effect, rollback deployment, and historical-data
scope. Do not deploy Supabase manually when the protected-main integration is
the approved writer.

Use this safe order:

1. capture current migration, function-version/JWT, Vercel, Gallery row, and
   private-object baselines;
2. merge through protected `main` only while the exact head and checks remain
   unchanged;
3. allow the reviewed migration and Edge deployment to complete;
4. verify migration presence, function versions, inventory/JWT parity, and the
   atomic empty-safe public feed before accepting the Website deployment;
5. verify exact Vercel source binding and the complete browser/route matrix;
6. only under a separate data-write approval, republish historical units one
   at a time; and
7. prove private-ledger, approved-source, publication-ready, object, public DTO,
   and public-media readback parity after every unit.

## Historical republishing stop conditions

Stop on the first changed approval, mismatched original, unexpected row count,
wrong category, failed decode, byte/dimension overflow, digest drift,
publication-ledger mismatch, public data leak, quota anomaly, or write outside
the exact allowlist. Preserve approved originals, immutable revisions,
moderation evidence, and unrelated rows. Any derivative rollback must target
only objects and revisions created by the approved packet.

## Rollback

- Restore the prior reviewed Website deployment only when the current Edge and
  additive database remain in place; that combination preserves safe legacy
  DTO compatibility.
- Do not roll back by deleting additive migrations, immutable publication
  rows, moderation evidence, approved originals, or Storage objects.
- If the Edge Function or database contract is unavailable, the runtime feed
  fails closed and the static Gallery remains available.
- Record the incident, exact failing invariant, rollback source binding, and
  post-rollback readbacks before resuming publication.

## Primary references

- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase private file delivery](https://supabase.com/docs/guides/storage/serving/downloads)
- [Supabase egress usage](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [Next.js Image component](https://nextjs.org/docs/app/api-reference/components/image)
- [WCAG 2.2 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [MDN Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- [MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
