# Ranks Maintenance Guide

## 1. Purpose

The Ranks page explains guild rank structure, member progression, trust and service expectations, leadership/member tier clarity, and the meaning of each role.

Ranks should not duplicate:

- Join onboarding
- Recruitment philosophy
- Tome rules in full
- Leaders contact details
- Events schedule details
- Gallery memories

Keep the page focused on progression, service, and role meaning. A visitor should be able to understand how the guild names responsibility and growth without needing a full rules manual.

## 2. Data Source

- Ranks data lives in `apps/web/public/data/ranks.json`.
- Keep JSON valid.
- Preserve the current schema unless `ranks.js` changes in the same scoped task.
- Add only fields that `ranks.js` actually supports.
- Preserve rank order unless leadership intentionally changes it.
- Keep rank copy concise.
- Keep functional labels plain.

Current data shape:

- `hero`: `kicker`, `title`, `intro`, `image`, `atmosphereImage`, `pills`
- `progression`: `title`, `pills`, `body`
- `tiers`: `senior`, `middle`, `members`
- `tiers.senior`: `title`, `description`, `image`, `ranks`
- `tiers.middle`: `title`, `description`, `image`, `pills`, `ranks`
- `tiers.members`: `title`, `description`, `image`, `pills`, `ranks`

Current item shapes:

- `hero.pills`: plain strings
- `progression.pills`: plain strings
- `progression.body`: paragraph strings
- `tiers.middle.pills`: plain strings
- `tiers.members.pills`: plain strings
- `ranks[]`: `name`, `body`
- `ranks[].body`: paragraph strings

Renderer notes:

- `tiers.senior`, `tiers.middle`, and `tiers.members` are hardcoded renderer slots.
- Tier `note` fields are supported by `ranks.js`, but no `note` fields are present in the current JSON.
- `tiers.senior.pills` is not rendered by the current page.
- Pill rows render as text-only spans and are capped at 10.
- Rank arrays are not capped.
- Ranks copy renders as text only; inline HTML and Markdown are not supported.

## 3. Rank Order and Grouping

Current group order:

1. Senior Leadership
2. Middle Leadership
3. Members

Current rank order:

- Senior Leadership: Guild Leader, Vice Leader, Hall Leader
- Middle Leadership: Dharmapala, Lotus Warden, Petal Keeper
- Members: Mochi Blossom, Young Bamboo, Softwind, Rice Sprout

Ordering behavior:

- Group display order is controlled by the fixed section order in `ranks.html` and fixed renderer calls in `ranks.js`.
- Rank display order is controlled by the order of objects in each `ranks` array.
- There are no explicit sort fields, numeric order fields, priority fields, or automatic sorting.
- Additional tier keys under `tiers` do not render without HTML and JS changes.

Safe rank edits:

- Edit one existing rank object at a time when possible.
- Preserve `name` and `body` fields.
- Keep each `body` array as concise paragraph strings.
- Add a rank only inside the intended existing tier array.
- Place the new rank exactly where leadership wants it to appear.
- Avoid duplicate rank names.
- Avoid duty copy that conflicts with neighboring ranks or turns member ranks into leadership rules.

## 4. Emblems and Images

Current image behavior:

- `hero.image` updates `#ranksHeroImage`.
- `tiers.senior.image` updates `#seniorImage`.
- `tiers.middle.image` updates `#middleImage`.
- `tiers.members.image` updates `#membersImage`.
- HTML contains static fallback image paths for these images.
- `ranks.js` only changes an image `src` when the JSON value is non-empty.
- There is no missing-image error handler or replacement placeholder beyond the static HTML source.

Current image paths:

- `./assets/img/ranks/hero.webp`
- `./assets/img/ranks/senior.webp`
- `./assets/img/ranks/middle.webp`
- `./assets/img/ranks/members.webp`

Observed extra Ranks asset:

- `./assets/img/ranks/ladder.webp` exists but is not currently referenced by `apps/web/public/data/ranks.json`, `ranks.html`, or `ranks.js`.

Alt text behavior:

- Ranks image alt text is fixed by `ranks.js`, not loaded from JSON.
- Hero alt text becomes `Ranks and progression banner artwork`.
- Senior alt text becomes `Senior Leadership artwork`.
- Middle alt text becomes `Middle Leadership artwork`.
- Members alt text becomes `Members artwork`.
- `hero.atmosphereImage` targets an image with empty alt text and `aria-hidden="true"`; that image is hidden by CSS.

Image rules:

- Image paths must resolve.
- Existing images should stay optimized WebP unless there is a clear scoped reason.
- Do not add large unoptimized images.
- Follow existing Ranks asset conventions under `apps/web/public/assets/img/ranks/`.
- Do not add per-rank emblem, image, or alt text fields without renderer changes.

## 5. Tone Rules

- Ranks should sound like progression, trust, service, and care.
- Xianxia tone may appear lightly through station, duty, practice, service, and path.
- Keep rank duties clear before poetic.
- Do not make rank duties too poetic.
- Avoid generic AI-like language.
- Avoid forced rhyme.
- Avoid "Where Winds Meet" in visible Ranks body copy.
- Do not overuse Cupcake language in rank guidance.
- Keep functional labels plain.
- Preserve rank names and hierarchy unless leadership intentionally changes them.

## 6. Links and Unsupported Fields

Current link behavior:

- Ranks JSON does not render links.
- The only page-local content link is `Meet the Leaders`, which routes from `/ranks` to `/leaders`.
- Header and footer links are rendered by the shared Next.js site shell, not the Ranks data file.
- Shared header and footer navigation include links to `/ranks`.
- Home, Join, and Tome link to `/ranks` from other page data or components.

Link rules:

- Internal links must resolve.
- External links must follow existing safe-link conventions.
- Unsupported link fields should not be added without renderer changes.

Currently unsupported fields and behaviors:

- Per-rank links
- Tier links
- Data-driven link labels
- Per-rank images, emblems, icons, or alt text
- Data-driven image alt text
- Additional tier groups
- Sort/order fields
- Rank IDs, slugs, anchors, permissions, point values, Discord role IDs, or game role mappings
- Filters, tabs, accordions, URL query state, or interactive rank cards
- Inline HTML or Markdown in JSON copy

## 7. Accessibility

- Keep the page to one `h1`.
- Use `h2` for Progression, Senior Leadership, Middle Leadership, and Members.
- Side-panel headings and rendered rank names may use `h3`.
- Preserve `<main id="main">` so the shared skip link works.
- Keep `#ranksError` available as a polite status message for load failures.
- Keep rank card/list readability clear in source order.
- Current rank cards are `div` elements, not list items; if list semantics are introduced later, update the renderer and smoke checklist together.
- Keep image alt text descriptive where images are public.
- Do not add JSON alt text fields unless `ranks.js` is updated to use them.
- Keep focus states visible for the `Meet the Leaders` link and shared header/footer controls.
- Keep touch targets usable when adding any new interactive element.
- Preserve mobile readability at narrow widths.
- Avoid horizontal overflow.
- Keep rank names concise so screen reader heading navigation remains useful.

## 8. Validation

Run:

```sh
npm run check
git diff --check
node scripts/check-json.mjs
node scripts/check-js.mjs
node scripts/check-refs.mjs
node scripts/check-assets.mjs
npm run check:production
```

Use `npm run smoke:gallery` as a general regression check if relevant to the repo baseline.

## 9. Manual Ranks Smoke Checklist

- Open `/ranks.html`.
- Confirm hero and intro render.
- Confirm rank groups render.
- Confirm rank cards/list render.
- Confirm emblems/images render.
- Confirm alt text exists where relevant.
- Confirm rank order is correct.
- Check mobile widths at 360px, 390px, and 768px for horizontal overflow.
- Confirm text remains readable.
- Confirm focus states are visible if links/buttons exist.
- Confirm there are no console-breaking errors.
- Confirm protected recruitment body remains unchanged.
- Confirm guild seal poem remains unchanged.

## 10. Protected Content

Ranks work must not alter:

- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`
- `apps/web/public/data/home.json` `seal.verse`
