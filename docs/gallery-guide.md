# Gallery Maintenance Guide

## 1. Purpose

The Gallery is Mōchirīī's visual memory: screenshots of scenes, members, gatherings, action, scenery, and small guild moments worth keeping. It should feel image-led, concise, and easy to browse.

## 2. Data Source

- Gallery data lives in `apps/web/public/data/gallery.json`.
- The current static Gallery source has 73 images in the `general` album.
- Approved member and Discord submissions are added at runtime through separate short-lived thumbnail and full-image URLs and are not written into `apps/web/public/data/gallery.json`.
- The public approved-feed request lives in `apps/web/lib/gallery/approved-feed.ts`. That module uses plain `fetch` and browser-safe public configuration only; it must not import the Supabase SDK, authentication, moderation, upload, or private account modules.
- Do not change image paths unless assets are actually added, replaced, or removed in the same scoped task.
- Captions and alt text should match visible image content.
- Do not invent player identities, events, locations, or actions that are not visible or otherwise confirmed.

## 3. Image Paths

- Thumbnail paths must use `apps/web/public/assets/img/gallery/thumbs/`.
- Full image paths must use the optimized full-size Gallery path, such as `apps/web/public/assets/img/gallery/shot-01.webp`.
- The grid uses thumbnails for page speed.
- The lightbox opens full images.
- Never let the lightbox open `/thumbs/` images.
- Every approved runtime submission needs a private WebP derivative no larger than 720 pixels on its longest edge and 80 KiB. The moderator browser prepares it during approval; the Edge Function verifies both the WebP structure and a complete pixel decode before storage.
- Do not use managed on-the-fly image transformations for this path. They are an optional provider feature with a separate cost/configuration boundary, while the stored derivative has no per-view transform requirement.
- The worst-case first 24 member derivatives and the representative first 24 static thumbnails must each remain below 2 MiB. Browser tests also require no original request before the viewer opens and CLS no greater than 0.1.
- When a viewer opens, it keeps the already-loaded thumbnail visible while the full image transfers and decodes. The shared loading status is accessible, a decode failure retains the thumbnail with a plain error message, and Close must work immediately without waiting for the image request.
- The canonical Next Gallery renders static items in bounded batches of 24; keep the `Show more images` control as the only expansion action unless a later scoped performance pass replaces the pattern. The immutable legacy release remains rollback-only.
- Approved member and Discord submissions may render with time-limited signed URLs only. Derivatives live below the service-owned `_approved/thumbs/{submission}/{revision}.webp` prefix; members cannot insert, update, read, or delete that prefix. Do not expose raw storage buckets, storage paths, service-role keys, or private media references to browser code.
- Home Gallery Spotlight must keep using thumbnail paths in its grid and full-size Gallery images in its lightbox.

### Shared grid-media contract

- Home Screenshot Spotlight and `/gallery` render thumbnails through `apps/web/components/ResponsiveGalleryMedia.tsx` and the neutral geometry in `apps/web/app/styles/shell-gallery-media.css`.
- The shared media wrapper fills the stable 16:10 card and uses `object-fit: cover`; page-specific styles may add borders, scrims, hover treatment, or color without redefining the image geometry.
- A member-photo request failure must never masquerade as an empty Gallery. Keep the static Gallery available, distinguish loading, successful-empty, and temporary-unavailability states, and provide the bounded `Try again` action without exposing provider or internal-system language.

### Universal lightbox contract

- Home Screenshot Spotlight and `/gallery` use the shared geometry in `apps/web/app/styles/shell-lightbox.css`.
- `apps/web/app/styles/public-gallery.css` may customize Gallery colors, borders, blur, shadows, and interaction styling, but it must not redefine lightbox dimensions or layout.
- The viewer uses a fluid safe-area-aware shell, a `1160px` maximum card width, `100vh`/`100dvh` height bounds, and `object-fit: contain` so images keep their natural proportions without crop.
- If enlarged text or a long caption exceeds the available height, the keyboard-focusable card scrolls vertically while the image remains visible. The viewer must never introduce horizontal scrolling.
- Keep the existing dialog semantics, 44px close target, Escape handling, focus containment and return, backdrop close, and body-scroll restoration.
- The current private-original contract permits uploads up to 50 MiB. If measured production opens remain slow after the thumbnail/loading release, review a second service-owned viewer derivative sized for the `1160px` viewer and high-density displays. That requires a separate migration, decoded-image policy, atomic selection, cleanup, and rollout review; do not fold it into the thumbnail contract informally.

## 4. Categories

Current categories:

- `portraits`
- `gatherings`
- `action`
- `scenery`
- `companions`

Category rules:

- Categories power the visible Gallery filters.
- Every image needs a valid `category`.
- Category labels and counts are generated from `apps/web/public/data/gallery.json`.
- Do not hardcode category totals in HTML or JavaScript.
- Keep category slugs lowercase and kebab-case if new categories are ever approved.

## 5. Tags

- Tags are currently non-rendered.
- Tags support future search or filtering work.
- Tags should be short, lowercase, and kebab-case.
- Use 1-4 useful tags per image.
- Avoid vague tags like `misc`, `nice`, `pretty`, `cool`, `memory`, or `moment`.
- Tags should support finding an image; they should not repeat the caption word for word.

## 6. Captions and Alt Text

- Captions should be concise and image-specific.
- Prefer concrete nouns and verbs.
- Use light xianxia flavor only when it fits the image.
- Avoid generic adjectives and filler phrases.
- Avoid "Where Winds Meet" in visible captions.
- Alt text should describe visible content for someone who cannot see the image.
- Keep captions and alt text distinct when possible: captions can carry mood; alt text should identify the visible subject.

## 7. URL State

Gallery category URLs use `?category=`.

Valid examples:

- `/gallery?category=portraits`
- `/gallery?category=gatherings`
- `/gallery?category=action`
- `/gallery?category=scenery`
- `/gallery?category=companions`

Invalid categories fall back to All and clean the URL. Browser Back and Forward should preserve the selected filter, image count, and `aria-pressed` state.

## 8. Copy Link

- Copy link copies the current Gallery URL.
- Category URLs include the selected category.
- All uses the clean `/gallery` URL where possible.
- `/gallery.html` remains redirect compatibility for legacy and rollback links; do not emit it as the canonical Next URL.
- Feedback uses a short `aria-live` status message.
- Keep the control plain: `Copy link`, `Link copied`, and `Copy failed`.

## 9. Counts

Counts appear in filter buttons and are generated from Gallery data.

Expected current static counts:

- All - 73
- Portraits - 23
- Gatherings - 22
- Action - 7
- Scenery - 6
- Companions - 15
- Member Submissions - runtime approved-feed count only

If image data changes, counts should change from data automatically. Do not patch the labels by hand.

## 10. Next and Legacy Rollback Conventions

- The canonical Next `/gallery` route uses hashed application bundles and does not need manual cache-query updates.
- `/gallery.html` is a Next redirect kept for incoming-link compatibility; it is not an editable Gallery implementation.
- The immutable `legacy-static-final-2026-07-18` release is the only static rollback artifact. Restore it only through the separately approved rollback procedure; do not recreate or patch its HTML, CSS, or JavaScript in `main`.
- Do not add duplicate build surfaces, service workers, or runtime cache hacks for this convention.

## 11. Validation

Run:

```sh
npm run check
git diff --check
node scripts/check-json.mjs
node scripts/check-refs.mjs
node scripts/check-assets.mjs
npm run check:media-performance
npm run setup:playwright
npm --prefix apps/web run build
npm run smoke:gallery
npm run smoke:gallery-approved-feed
npm run check:production
```

The Playwright setup command is a one-time local browser-runtime step. After the
Web build completes, run `npm run smoke:gallery:serve` in a separate terminal;
both smoke tests expect that production-mode Next app on `127.0.0.1:8765`.
Production mode keeps React and Vercel analytics behavior aligned with the CSP
that ships, so the strict browser-error gate is not weakened for development
runtime noise.

## 12. Manual Smoke Checklist

- Open `/gallery`.
- Open `/gallery?category=portraits`.
- Open `/gallery?category=gatherings`.
- Open `/gallery?category=action`.
- Open `/gallery?category=scenery`.
- Open `/gallery?category=companions`.
- Confirm `/gallery.html` redirects to canonical `/gallery` compatibility.
- Open an invalid category URL and confirm it falls back to All.
- Run the automated responsive matrix from `320px` reflow through `2560×1440`, including mobile portrait/landscape, tablet portrait/landscape, desktop, true ultrawide, portrait images, square images, enlarged text, and long captions.
- Check a physical iPhone in portrait and both landscape directions, plus an iPad in portrait and landscape, with Safari browser chrome expanded and collapsed. Confirm the header, footer, skip link, mobile menu, both lightboxes, captions, close controls, touch dismissal, and focus return stay inside the nonzero safe area.
- Confirm All shows the current static Gallery image count before approved member submissions load.
- Confirm counts match current data.
- Confirm Copy link works.
- Confirm Browser Back and Forward update the selected filter.
- Confirm the lightbox opens full images, not `/thumbs/`.
- Confirm Escape, backdrop, and close-button dismissal restore focus and page scroll.
- Confirm long captions scroll vertically by keyboard as well as pointer/touch without clipping or collapsing the image.
- Confirm no horizontal overflow.
- Confirm the initial Gallery render is capped at 24 images and `Show more images` expands the next batch.
- Confirm approved runtime submissions use signed URLs and do not display raw Supabase storage references.
- Confirm approved runtime submissions use distinct thumbnail and full-image URLs, and that the full image is not requested before its viewer opens.
- Confirm the random mix is stable through hydration and does not reshuffle after first paint.

## 13. Media Performance

- Only the true page hero or route LCP image should use a priority preload.
- Supporting cards, seals, gallery thumbnails, event board images, and repeated list images should stay lazy.
- Keep explicit image `width`, `height`, and `sizes` values on high-impact media so Next can reserve stable layout space.
- Do not compress, re-encode, replace, delete, externalize, or otherwise optimize `apps/web/public/assets/audio/mochiriiiiii.mp3` without explicit approval.

## 14. Protected Content

Gallery work must not alter:

- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`
- `apps/web/public/data/home.json` `seal.verse`
