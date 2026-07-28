# Home and Site Shell Maintenance Guide

## 1. Purpose

Home/Shell covers the site's first impression, guild identity, entry paths to Join, Events, Gallery, Tome, Recruitment, Ranks, Leaders, and Twills/Profile, plus the shared App Router layout, header/footer/nav behavior, and public site foundation.

Home should route visitors onward without duplicating:

- Join onboarding in full.
- Recruitment long-form philosophy.
- Tome rules in full.
- Events schedule details.
- Gallery memory archive.
- Ranks hierarchy.
- Leaders contact structure.
- Twills personal profile.

## 2. Data Source

- Home data lives in `apps/web/public/data/home.json`.
- Keep JSON valid.
- Preserve the current schema unless `apps/web/app/page.tsx` changes in the same scoped task.
- Add only fields that the canonical Next Home route actually supports.
- Keep Home copy concise and directional.
- Keep functional labels plain.

Current Home data shape:

- `copy`: `bulletinIntro`, `doorsIntro`, `spotlightIntro`, `galleryIntro`
- `celebrationSplash`: `enabled`, `startsAt`, `endsAt`, `title`, `message`, `storageKey`
- `hero`: `image`, `atmosphereImage`, `descriptor`, `badges`
- `seal`: `title`, `image`, `imageAlt`, `verse`
- `bulletins[]`: `pinned`, `type`, `title`, `date`, `image`, `imageAlt`, `href`, optional `summary`
- `tiles[]`: `label`, `title`, `image`, `alt`, `href`, optional `subtitle`
- `spotlight`: `tag`, `title`, `summary`, `image`, `imageAlt`, `href`
- `gallery[]`: `image`, `full`, `alt`, optional `caption`

Renderer notes:

- `apps/web/app/page.tsx` imports `home.json`, `gallery.json`, and `guild-schedule.json` at build time and renders the canonical `/` route.
- Monthly gathering and raffle dates come from `guild-schedule.json` when a bulletin has `scheduleId`.
- `SpotlightWinnerTitle` may replace the configured fallback title with the finalized monthly Discord poll winner name from `get-current-spotlight-winner`; the path is name-only and must not expose Discord handles, profile links, avatars, vote counts, or candidate lists.
- The Home server route selects exactly four stable Screenshot Spotlight items, and `HomeGalleryLightbox` opens them through the same shared viewer used by `/gallery`.
- Home descriptor strings render as paragraphs, badges render as plain spans, and bulletin dates use the UTC formatter in `page.tsx`.
- Door, bulletin, spotlight, and gallery media render from controlled data fields through owned image components or elements.
- Inline HTML and Markdown are not supported in Home JSON copy.
- Home kicker, `h1`, primary CTA labels, section headings, metadata, header, footer, and navigation are component-owned rather than data-driven.

## 3. Protected Guild Seal Poem

The protected guild seal poem lives at:

- `apps/web/public/data/home.json` `seal.verse`

The guild seal poem is protected. Do not alter wording, punctuation, line breaks, spelling, capitalization, diacritics, order, or structure. Future edits may revise other non-seal Home fields only if needed, supported by the canonical Next Home route, and intentionally scoped. Any seal poem change requires explicit user approval.

## 4. Header / Navigation

Header behavior comes from `apps/web/components/SiteHeader.tsx`, its focused helpers under `apps/web/components/site-header`, and controlled navigation data in `apps/web/lib/site-navigation.ts`.

The header and footer brand blocks match: the prominent `Mōchirīī` guild name sits above the concise `Asia Pacific Guild` regional label. Keep the game name in metadata and approved supporting contexts instead of the brand subtitle.

Current desktop navigation:

- Guild: Home, Spotlight, Gallery, Social, Mochi Pets.
- Culture: Join, Ranks, Leaders, Tome, Playlists.
- Updates: Announcements, Events, Raffle.
- Recruitment as a top-level link.

Current mobile navigation:

- The mobile button is `#menu-btn`.
- The mobile menu is `#mobile-menu`, a dialog-style shell with grouped links.
- Opening the menu sets `aria-expanded="true"`, locks body scrolling, and moves focus into the menu.
- Escape closes the menu.
- Close button, scrim click, and mobile link click close the menu.
- Closing by Escape or close button returns focus to the trigger.
- Tab is trapped inside the open menu.

Current dropdown behavior:

- Desktop dropdown buttons toggle on click, Enter, or Space.
- ArrowDown opens a dropdown and focuses the first item.
- Escape and outside click close open dropdowns.
- Active desktop nav uses `[data-nav]`, `is-active`, and `aria-current="page"`.

The live Next header keeps its signed-out shell lightweight. It loads the Supabase-backed auth state once during browser idle time, with a 1500ms deadline and timer fallback, or immediately when a pointer or keyboard user interacts with the header. Keep the loader deduplicated, fail closed to signed-out navigation, and reserve stable desktop space for the Login/Account control.

The Next root layout uses two tracked Latin WOFF2 files through `next/font/local`. `apps/web/scripts/check-font-bundle.mjs` prevents Unicode-range expansion, fallback-metric drift, and font-bearing CSS above 12 KiB Brotli.

The exact game name may remain in header brand text and shared shell metadata contexts.

## 5. Footer

Footer presentation and links come from `apps/web/components/SiteFooter.tsx`; `apps/web/components/SiteRouteShell.tsx` owns the ordinary shared shell and omits it only for the isolated Spinner route family.

Current footer content:

- Brand link to Home.
- Emblem image.
- Compact identity description.
- Discord Join CTA with `target="_blank"` and `rel="noopener noreferrer"`.
- Recruitment Tips link.
- Guild, Culture, and Updates navigation columns.
- Copyright year rendered by the Footer component.
- Footer metadata line with the game name.

Keep the footer compact. It should remain a shared navigation and identity surface, not a full mission statement or duplicate Recruitment/Join content.

## 6. App Router Ownership

- `apps/web/app/layout.tsx` owns root metadata, viewport settings, local fonts, shared shell styles, and the `SiteRouteShell` boundary.
- `apps/web/components/SiteRouteShell.tsx` owns the ordinary `SiteHeader` and `SiteFooter` composition and the isolated Spinner exception.
- Route `page.tsx` files import only the styles and server/client components their route needs.
- Interactive behavior stays in focused client components; do not make the entire layout or a route client-side for one control.
- Next emits content-hashed application bundles. There is no editable `index.html`, shared `site.js`, or manual public-script ordering in the live application.
- Legacy `.html` URLs are redirect compatibility only. The immutable `legacy-static-final-2026-07-18` release is the rollback artifact; do not recreate or edit a parallel static surface.
- Preserve signed-out fail-closed behavior when changing shell authentication or Supabase-backed components.

## 7. Home Copy and Tone Rules

- Home should establish identity and route visitors onward.
- Home should feel clear, human, xianxia-inspired, and Mōchirīī-specific.
- Cupcake warmth may appear lightly.
- Do not overuse Cupcake language.
- Keep the approved `apps/web/public/data/home.json` `hero.subtitle` exactly `Asia Pacific • Where Winds Meet Guild`; this is the sole Home body-copy exception for the exact game name.
- Do not use `Where Winds Meet` elsewhere in regular visible Home body copy.
- Keep functional labels clear.
- Avoid generic AI-like language.
- Avoid forced rhyme.
- Do not duplicate page-specific content from other sections.

The exact game name may remain in the approved Home subtitle, header/footer, titles, metadata, SEO, JSON-LD, internal code, docs, reports, and validation scripts.

## 8. Metadata and Social Preview

Root Home metadata is owned by the typed `metadata` and `viewport` exports in `apps/web/app/layout.tsx`. Home JSON-LD is rendered by `apps/web/app/page.tsx`.

Current conventions:

- Title: `Mōchirīī • Where Winds Meet Guild`
- Description: `Join Mōchirīī, an Asia Pacific Where Winds Meet guild full of yummy cupcakes for everyone & pretty people to share them all with.`
- Canonical: `https://mochirii.com/`
- Open Graph tags for type, locale `en_SG`, site name, title, description, URL, and image.
- Twitter summary-large-image tags for title, description, and image.
- A home-only JSON-LD graph containing `WebSite` and `Organization`, with canonical IDs, `en-SG`, Asia Pacific service area, and only verified identity links.
- Favicon and Apple touch icon references.
- Home hero preload.

`Where Winds Meet` may remain in metadata and SEO. Do not remove metadata terms just to satisfy body-copy rules. Metadata should stay search-friendly and accurate.

## 9. Images and Assets

Home image behavior:

- Hero image: `./assets/img/hero/hero.webp`
- Background image: `./assets/bg/wuxia-bg.webp`
- Seal image: `./assets/img/brand/emblem.webp`
- Bulletin, door, and spotlight images render from `apps/web/public/data/home.json`; Home Gallery candidates come from `apps/web/public/data/gallery.json`, with `home.json` gallery entries retained only as fallback. The server selects one stable, deduplicated set of four so hydration never reorders visible images.
- Home gallery thumbnails should use thumbnail paths where intended, and `full` should point to the full image used by the lightbox.
- Home Screenshot Spotlight uses the same fluid, proportional lightbox geometry as `/gallery`; shared sizing belongs in `apps/web/app/styles/shell-lightbox.css`, not Home- or Gallery-only CSS.

Birthday splash toggle:

- Deactivate the Home birthday splash by setting `apps/web/public/data/home.json` `celebrationSplash.enabled` to `false`.
- Activate it by setting `celebrationSplash.enabled` to `true`.
- Optional `startsAt` and `endsAt` values may use ISO-compatible date/time strings to limit the active window; leave them empty for no date window.
- Update the canonical source at `apps/web/public/data/home.json`; do not create a root mirror.
- After changing the toggle or copy, run `npm run check:home-celebration-splash`.

Image expectations:

- Keep image paths relative and stable.
- Keep meaningful alt text for meaningful images.
- Keep decorative atmosphere images empty-alt and hidden as currently implemented.
- Avoid large unoptimized assets.
- Run asset and reference validation after asset or path edits.

Next app shared hero presentation:

- Shared `PageHero` routes and Home use the same stable `3 / 2` hero image frame inside the tokenized `--hero-frame-max-width` container.
- The hero image frame renders first, then Home may place the intro card and guild seal together in a slim row below it with positive spacing. Main page content follows below the hero header.
- Hero images should render with `object-fit: contain` and `object-position: center`, with no crop, scrim, tint, CSS filter, transform, or overlay covering the image.
- Do not use negative `--hero-image-to-card-gap` values, page-scoped hero geometry tokens, one-off hero margins, or page-local hero aspect/size overrides.
- Surface tiers should remain explicit: hero shell, primary content card, quiet card, tool panel, and admin/member panel.
- Keep page-specific palette, border, and glass styling scoped by `body[data-page="..."]`; do not change text, alt text, image paths, or route data for visual-only passes.
- Validate Home plus each shared `PageHero` route at `360px`, `390px`, `768px`, `1024px`, and `1440px` before release.

## 10. Asset and Cache Conventions

- Next owns content-hashed CSS and JavaScript bundle URLs; do not add manual cache-query strings to application imports.
- Keep editable public JSON and media under `apps/web/public/data` and `apps/web/public/assets`.
- Treat the immutable legacy release as rollback evidence, not an editable cache-busting surface.
- Do not add service workers, duplicate static builds, or runtime cache hacks without an independently reviewed requirement.

## 11. Accessibility

Preserve these expectations:

- Skip link appears on focus and targets `#main`.
- Pages keep semantic landmarks: header mount, main, and footer mount.
- Home keeps one `h1`, followed by sensible section headings.
- Desktop nav dropdowns keep accessible button state.
- Mobile menu keeps dialog semantics, Escape close, focus trap, and focus return.
- Focus states remain visible.
- Touch targets remain usable, generally 44px where controls are interactive.
- Image alt text stays meaningful or intentionally empty/decorative.
- Reduced-motion preferences remain respected.
- No horizontal overflow at mobile widths.
- Screen reader labels stay clear and not overly noisy.
- Shared lightbox behavior keeps Escape close, focus trap, keyboard access to the scrollable card, and focus return.
- Shared lightbox images remain proportional at narrow, wide, portrait, and landscape viewports; enlarged or long captions scroll vertically without collapsing the image or creating horizontal overflow.

## 12. Validation

Run these checks before opening or merging Home/Shell work:

```sh
npm run check
git diff --check
node scripts/check-json.mjs
node scripts/check-js.mjs
node scripts/check-refs.mjs
node scripts/check-assets.mjs
npm run check:production
npm run setup:playwright
npm --prefix apps/web run build
npm run smoke:gallery
```

The Playwright setup command is a one-time local browser-runtime step. After the
Web build completes, run `npm run smoke:gallery:serve` in a separate terminal.
`npm run smoke:gallery` verifies Home and `/gallery` against the shared
responsive contract on that production-mode Next app at `127.0.0.1:8765`.

## 13. Manual Home/Shell Smoke Checklist

- `/` loads.
- Header renders.
- Footer renders.
- Mobile nav opens and closes.
- Escape closes mobile menu if supported.
- Focus returns correctly if supported.
- Skip link appears and works.
- Home hero renders.
- Shared route heroes render full-frame without crop, tint, scrim, CSS filter, or intro-card overlap.
- Home cards/doors render.
- Home Screenshot Spotlight opens the selected full image in the same bounded proportional viewer as `/gallery`.
- The lightbox passes mobile portrait/landscape, tablet, desktop, reflow, long-caption, keyboard, and touch checks without horizontal overflow.
- Seal poem renders unchanged.
- Key links resolve.
- Mobile widths `360px`, `390px`, and `768px` have no horizontal overflow.
- No console-breaking errors occur.
- Supabase page shell does not cause signed-out runtime errors.
- Protected recruitment body remains unchanged.
- Protected recruitment conclusion remains unchanged.
- Twills protected body remains unchanged.
- Guild seal poem remains unchanged.

## 14. Protected Content

Home/Shell work must not alter:

- `apps/web/public/data/home.json` `seal.verse`
- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`
- `apps/web/public/data/twills.json` `profile.bio`
