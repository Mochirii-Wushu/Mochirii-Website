# Gallery Maintenance Guide

## 1. Purpose

The Gallery is Mōchirīī's visual memory: screenshots of scenes, members, gatherings, action, scenery, and small guild moments worth keeping. It should feel image-led, concise, and easy to browse.

## 2. Data Source

- Gallery data lives in `apps/web/public/data/gallery.json`.
- The current static Gallery source has 73 images in the `general` album.
- Approved member and Discord submissions are added at runtime and are not written into `apps/web/public/data/gallery.json`. Public feed schema version 2 lists stable, credential-free thumbnail Edge URLs; one bounded display-image Edge URL is resolved on demand from a stable opaque publication ID after the viewer opens.
- The public approved-feed request lives in `apps/web/lib/gallery/approved-feed.ts`. That module uses plain `fetch` and browser-safe public configuration only; it must not import the Supabase SDK, authentication, moderation, upload, or private account modules.
- Runtime browsing uses a bounded 24-item keyset page and an opaque cursor carrying one stable snapshot. Keep pagination sequential; never replace it with a fixed first-page cap or expose cursor internals in the UI.
- The default Random mix orders the static collection before first paint, then appends asynchronously loaded runtime cards. Runtime arrival must never move a static card the visitor has already seen. Newest and Oldest may combine both sources only through the prefix proven complete by the current runtime keyset boundary; load the next runtime page before exposing the uncertain tail.
- Do not change image paths unless assets are actually added, replaced, or removed in the same scoped task.
- Captions and alt text should match visible image content.
- Do not invent player identities, events, locations, or actions that are not visible or otherwise confirmed.

## 3. Image Paths

- Thumbnail paths must use `apps/web/public/assets/img/gallery/thumbs/`.
- Full image paths must use the optimized full-size Gallery path, such as `apps/web/public/assets/img/gallery/shot-01.webp`.
- The grid uses thumbnails for page speed.
- The lightbox opens full images.
- Never let the lightbox open `/thumbs/` images.
- Every runtime publication needs two private, metadata-stripped WebP assets prepared by the moderator browser: a display image no larger than 2560 pixels on either edge and 2 MiB, and a thumbnail no larger than 720 pixels on either edge and 80 KiB. The Edge Function verifies both WebP structures and fully decodes every pixel before storage.
- Do not use managed on-the-fly image transformations for this path. They are an optional provider feature with a separate cost/configuration boundary, while the stored derivative has no per-view transform requirement.
- The worst-case first 24 member thumbnails and the representative first 24 static thumbnails must each remain below 2 MiB. Browser tests also require no display-image request before the viewer opens and CLS no greater than 0.1.
- When a viewer opens, it keeps the already-loaded thumbnail visible while the full image transfers and decodes. The shared loading status is accessible, a decode failure retains the thumbnail with a plain error message, and Close must work immediately without waiting for the image request.
- If a runtime thumbnail fails, re-resolve the same bounded Edge URL once and update the shared Gallery item state as well as the grid image. The image component increments its attempt key even when the stable URL is unchanged, so the retry actually reloads while a later viewer uses the same refreshed item state.
- The canonical Next Gallery renders static items in bounded batches of 24; keep the `Show more images` control as the only expansion action unless a later scoped performance pass replaces the pattern. The immutable legacy release remains rollback-only.
- Published member and Discord media render only through stable, credential-free Edge media URLs keyed by the opaque publication UUID. The private display path is `_approved/publications/{publication}/display.webp`; each thumbnail revision lives at `_approved/publications/{publication}/revisions/{revision}/thumbnail.webp`. Members cannot insert, update, read, or delete that service-owned prefix. Before returning bytes, the Edge boundary reserves the request and expected bytes in the database-backed global budget, resolves the exact immutable object, and verifies its recorded size and SHA-256. Successful media uses a five-minute private browser cache. Never expose buckets, Storage paths, service-role keys, source originals, uploader identity, object evidence, or display URLs in list responses.
- Every runtime thumbnail DTO includes its validated decoded width and height. Use that evidence to reserve proportional layout before loading; reject absent or out-of-range geometry instead of guessing.
- Home Gallery Spotlight must keep using thumbnail paths in its grid and full-size Gallery images in its lightbox.

### Shared grid-media contract

- Home Screenshot Spotlight and `/gallery` render thumbnails through `apps/web/components/ResponsiveGalleryMedia.tsx` and the neutral geometry in `apps/web/app/styles/shell-gallery-media.css`.
- `/gallery` carries its visual scope in server-rendered markup (`.gallery-page`); route styling must not wait for the client-side body marker, so the same geometry is present before hydration and with JavaScript disabled.
- The shared media wrapper fills the stable 16:10 card and uses `object-fit: cover`; page-specific styles may add borders, scrims, hover treatment, or color without redefining the image geometry.
- A member-photo request failure must never masquerade as an empty Gallery. Keep the static Gallery available, distinguish loading, successful-empty, and temporary-unavailability states, and provide the bounded `Try again` action without exposing provider or internal-system language.

### Universal lightbox contract

- Home Screenshot Spotlight and `/gallery` use the shared geometry in `apps/web/app/styles/shell-lightbox.css`.
- `apps/web/app/styles/public-gallery.css` may customize Gallery colors, borders, blur, shadows, and interaction styling, but it must not redefine lightbox dimensions or layout.
- The viewer uses a fluid safe-area-aware shell, a `1160px` maximum card width, `100vh`/`100dvh` height bounds, and `object-fit: contain` so images keep their natural proportions without crop.
- If enlarged text or a long caption exceeds the available height, the keyboard-focusable card scrolls vertically while the image remains visible. The viewer must never introduce horizontal scrolling.
- Keep the existing dialog semantics, 44px close target, Escape handling, focus containment and return, backdrop close, and body-scroll restoration.
- The private-original contract accepts static JPEG, PNG, or WebP files up to 8 MiB, 4096 pixels on either edge, and 12.6 megapixels. Client checks provide prompt feedback. For one moderator-selected item, the protected Edge boundary requires both the moderator session and the signed Website workload identity, reserves the exact source bytes, structurally validates and fully decodes the exact Storage object, and records the durable validation timestamp. A same-origin Node route then fully decodes and re-renders a metadata-free WebP no larger than 2560 pixels per edge or 2 MiB. The browser receives only that prepared derivative; it never receives a source URL, workload token, or signed Storage capability, and the queue never bulk-downloads originals.
- The display derivative is already sized for the `1160px` viewer and high-density displays. Do not add another public derivative or on-demand transformation without a separately measured and approved media contract.

## 4. Categories

Current categories:

- `portraits`
- `gatherings`
- `action`
- `scenery`
- `companions`

Category rules:

- Categories power the visible Gallery filters.
- Static images need a valid canonical `category`. Runtime submissions always belong to `member-submissions` and may additionally belong to one canonical visual category.
- A historical runtime row with a null or noncanonical category remains private until a moderator explicitly reviews and republishes it. Never infer a visual category from its source, filename, caption, or provider metadata.
- Category labels and counts are generated from `apps/web/public/data/gallery.json`.
- Runtime totals and facets come from the complete server-side snapshot, not only the currently loaded page. Merge those figures with static counts without counting a runtime item twice.
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

Runtime search uses `?q=` and is limited to 80 Unicode-normalized characters. Clearing search removes that query parameter. Browser Back and Forward must restore category, sort, and query together.

The Next route normalizes `category`, `sort`, and `q` at the server boundary and passes that state into the client browser. A direct or shared deep link must therefore render its selected controls and static results correctly in the first server response, without a post-hydration default-state flash.

Valid examples:

- `/gallery?category=portraits`
- `/gallery?category=gatherings`
- `/gallery?category=action`
- `/gallery?category=scenery`
- `/gallery?category=companions`

Invalid categories fall back to All and clean the URL. Browser Back and Forward should preserve the selected filter, image count, and `aria-pressed` state.

## 8. Share and Copy Links

- Share gallery opens the browser or operating system share sheet when Web Share is available from the user-activated control.
- If Web Share is unavailable or fails, Share gallery uses the same local copy fallback as Copy link. Canceling the share sheet does not copy anything.
- Copy link copies the current Gallery URL.
- Category URLs include the selected category.
- All uses the clean `/gallery` URL where possible.
- `/gallery.html` remains redirect compatibility for legacy and rollback links; do not emit it as the canonical Next URL.
- Feedback uses a short `aria-live` status message.
- Keep feedback plain: `Gallery shared`, `Link copied`, and `Copy failed`.

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
- Confirm Share gallery uses Web Share when available and copies the exact current URL as its fallback.
- Confirm Copy link works independently.
- Confirm Browser Back and Forward update the selected filter.
- Confirm the lightbox opens full images, not `/thumbs/`.
- Confirm Escape, backdrop, and close-button dismissal restore focus and page scroll.
- Confirm long captions scroll vertically by keyboard as well as pointer/touch without clipping or collapsing the image.
- Confirm no horizontal overflow.
- Confirm the initial Gallery render is capped at 24 images and `Show more images` expands the next batch.
- Confirm runtime list pages contain only stable thumbnail Edge URLs and do not display uploader identity, raw Storage references, display URLs, object evidence, or source-original URLs.
- Confirm no runtime display-image request occurs before its viewer opens, opening one item requests only its stable publication ID, and closing/changing the item aborts obsolete work.
- Force one malformed publication or quota-reservation failure and confirm the runtime page fails safely without partial items, a cursor advance, or a skipped publication.
- Traverse more than 80 runtime fixtures through sequential opaque cursors and confirm no duplicates, gaps, or rows approved after the first-page snapshot.
- Confirm every runtime item belongs to Member Submissions and one canonical visual category, while legacy null or noncanonical rows remain private until explicit republication.
- Confirm thumbnail geometry reserves card space and one expired-thumbnail retry cannot become an unbounded request loop.
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
