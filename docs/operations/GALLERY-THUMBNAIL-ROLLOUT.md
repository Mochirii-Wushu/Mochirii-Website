# Gallery Thumbnail Rollout Packet

Current state: the later Gallery feed v2 release supersedes this packet's 50 MiB and signed-URL delivery assumptions. Active source uploads are capped at 8 MiB, and immutable display/thumbnail revisions are delivered through bounded Edge responses by opaque publication ID.

## Scope

This packet adds one stored, bounded WebP derivative for each approved member Gallery submission. It does not use Supabase Image Transformations, create a paid resource, make the private bucket public, or change the static Gallery assets.

## Source changes

- Migration `20260727145241_add_gallery_submission_thumbnails.sql` adds private derivative metadata and fail-closed constraints.
- `moderate-gallery-submission` validates and stores a maximum-720px, maximum-80-KiB WebP before a new approval can complete.
- The validation path uses official libwebp 1.6.0 compiled with the digest-pinned `emscripten/emsdk:4.0.12` builder. The release archive and generated module are SHA-256 pinned, and corrupt VP8/VP8L fixtures must fail full decode.
- Each moderation attempt writes a unique revision under `_approved/thumbs/{submission}/{revision}.webp`; the database selects the winning revision and writes its moderation audit in one transaction.
- `list-approved-gallery-submissions` returns distinct short-lived thumbnail and full-image URLs and skips historical rows that have not been backfilled.
- The Leader Dashboard can prepare the same derivative for a historical approved row.

The public feed never returns a raw bucket or Storage path. The Gallery grid loads only the derivative; the private original is requested only after the visitor opens the viewer. The shared Home/Gallery image surface keeps the cached thumbnail visible while the full image transfers and decodes, exposes an accessible loading or error state, and never blocks viewer dismissal on that request.

This packet originally retained the older 50 MiB member-original limit. Gallery feed v2 now enforces 8 MiB sources and includes the bounded viewer derivative described above; treat the remainder of this document as historical rollout evidence.

## Deployment boundary

This branch must stay unmerged and undeployed until an exact release approval covers the migration, the changed Edge Functions, Supabase Preview, the protected-main Supabase deployment, and the normal Vercel publication. No manual provider write is part of this packet.

Before deployment, capture the current migration inventory, configured function inventory, `verify_jwt` parity, and provider backups. Recalculate those values at the exact reviewed head instead of copying an older release count.

## Backfill and stop conditions

After an approved deployment, an authorized moderator can open the paginated Approved queue, select `Needs thumbnail`, and choose `Prepare gallery thumbnail` for each historical row. Each action uses the existing signed private preview and creates one immutable object under the service-owned derivative prefix. A conflicting attempt deletes only its own unselected revision.

Stop if the preview does not match the approved image, WebP generation fails, the stored byte limit cannot be met, the audit event fails, or the public feed returns equal thumbnail and full-image URLs. Do not infer or fabricate a thumbnail.

Backfill is not complete until the reviewed closeout query reports zero incomplete approved rows, zero missing or mismatched original/derivative objects, and the approved-thumbnail constraint has been validated in a separately authorized schema change. Do not validate that constraint early or treat a successful application deployment as backfill evidence.

## Reproducible decoder evidence

- libwebp release: `1.6.0`
- official release archive: <https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz>
- official archive SHA-256: `e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564`
- source commit: `4fa21912338357f89e4fd51cf2368325b59e9bd9`
- upstream source: <https://chromium.googlesource.com/webm/libwebp/+/4fa21912338357f89e4fd51cf2368325b59e9bd9>
- builder: `emscripten/emsdk:4.0.12@sha256:744fb6a68941970951bacf9d6632041a0398260492232691ef22bbf54b0585c6`
- generated module SHA-256: recorded beside `validator.generated.js`; `scripts/build-gallery-webp-validator.sh` must reproduce it exactly before release.

## Rollback

Application rollback may restore the prior Vercel deployment and prior function source. The new nullable columns are additive and should remain in place during application rollback. Do not drop columns or delete thumbnail objects during an incident; those destructive steps require a separately reviewed data-retirement packet.
