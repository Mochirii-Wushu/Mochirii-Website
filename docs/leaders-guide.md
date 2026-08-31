# Leaders Maintenance Guide

## 1. Purpose

The Leaders page explains leadership presence, stewardship and support, role clarity, contact or escalation guidance where the current data supports it, and who helps guide the guild's work.

Leaders should not duplicate:

- Ranks hierarchy in full
- Join onboarding
- Recruitment philosophy
- Tome rules in full
- Events schedule details
- Gallery memories

Keep the page focused on contact clarity, calm support, and the people who help members find the next step.

## 2. Data Source

- Leaders data lives in `apps/web/public/data/leaders.json`.
- Keep JSON valid.
- Preserve the current schema unless `leaders.js` changes in the same scoped task.
- Add only fields that `leaders.js` actually supports.
- Preserve leader order unless leadership intentionally changes it.
- Keep leader copy concise.
- Keep functional labels plain.

Current data shape:

- `hero`: `kicker`, `title`, `image`, `introBody`, `pills`
- `panel`: `title`, `badge`, `image`, `body`, `note`
- `council`: `title`, `description`
- `leaders`: array of leader objects
- `responsibilities`: `title`, `description`, `items`

Current item shapes:

- `hero.introBody`: paragraph strings
- `hero.pills`: plain strings
- `panel.body`: paragraph strings
- `leaders[]`: `role`, `name`, `availability`, `image`, `alt`, `summary`, optional `profileHref`, optional `profileLabel`
- `responsibilities.items[]`: `title`, `description`, `image`, `alt`

Renderer notes:

- The current page has one roster section, `The Council`.
- `leaders.js` renders up to 12 leader cards.
- `leaders.js` renders up to 6 responsibility cards.
- Leader profile links render only when `profileHref` is present and non-empty.
- `profileLabel` is only used when `profileHref` exists.
- Hero pills render as text-only spans and are capped at 10.
- Leaders copy renders as text only; inline HTML and Markdown are not supported.

## 3. Leader Order and Grouping

Current page section order:

1. Hero
2. Guild Leadership panel
3. The Council
4. Responsibilities

Current leader order:

1. Twills - Leader
2. Vice Leader - Vice Leader
3. Hall Leader - Hall Leader
4. Isawisima - Dharmapala
5. Sinbell - Lotus Warden
6. Meenari - Petal Keeper

Current responsibility order:

1. Direction & strategy
2. Ops & coordination
3. Culture & people

Ordering behavior:

- Leader display order is controlled by the order of objects in the `leaders` array.
- Responsibility display order is controlled by the order of objects in `responsibilities.items`.
- There are no explicit sort fields, priority fields, or automatic sorting.
- Additional roster groups do not render without HTML and JS changes.

Safe leader edits:

- Edit one existing leader object at a time when possible.
- Preserve the existing `role`, `name`, `availability`, `image`, `alt`, and `summary` shape.
- Add a leader only inside the existing `leaders` array.
- Place the new leader exactly where leadership wants that card to appear.
- Avoid duplicate leader names.
- Avoid role or summary copy that conflicts with neighboring leaders or the Ranks page.
- Keep `profileHref` relative and stable when linking to an internal profile page.

## 4. Images and Assets

Current image behavior:

- `hero.image` updates `#leadersHeroImage` when non-empty.
- `panel.image` updates `#leadersPanelImage` when non-empty.
- `leaders[].image` renders each leader card image and falls back to `./assets/img/leaders/leader-silhouette.webp` when empty.
- `responsibilities.items[].image` renders each responsibility card image.
- There is no image load-error handler.

Current image paths:

- `./assets/img/leaders/hero.webp`
- `./assets/img/leaders/panel.webp`
- `./assets/img/leaders/leader.webp`
- `./assets/img/leaders/leader-silhouette.webp`
- `./assets/img/leaders/dharmapala.webp`
- `./assets/img/leaders/lotus_warden.webp`
- `./assets/img/leaders/petal_keeper.webp`
- `./assets/img/leaders/responsibilities-01.webp`
- `./assets/img/leaders/responsibilities-02.webp`
- `./assets/img/leaders/responsibilities-03.webp`

Observed extra Leaders asset:

- `./assets/img/leaders/twills.webp` exists but is not currently referenced by the Leaders page or Twills profile page.

Alt text behavior:

- Hero alt text is fixed as `Leaders Hall banner artwork`.
- Panel image alt text is fixed as `Leadership hall artwork`.
- Leader card alt text comes from `leaders[].alt`.
- Responsibility card alt text comes from `responsibilities.items[].alt`.
- `hero.atmosphereImage` targets an image with empty alt text and `aria-hidden="true"`; that image is hidden by CSS.

Image rules:

- Image paths must resolve.
- Alt text should describe the leader, avatar, role, or visual panel clearly.
- Existing images should stay optimized WebP unless there is a clear scoped reason.
- Do not add large unoptimized images.
- Follow existing Leaders asset conventions under `apps/web/public/assets/img/leaders/`.
- Do not add hero or panel alt text fields without renderer changes.

## 5. Tone Rules

- Leaders should sound like stewardship, guidance, support, and care.
- Xianxia tone may appear lightly through guide, steward, watch, hand, support, and calm.
- Keep leadership responsibilities clear before poetic.
- Do not make leadership responsibilities too poetic.
- Avoid generic AI-like language.
- Avoid forced rhyme.
- Avoid "Where Winds Meet" in visible Leaders body copy.
- Do not overuse Cupcake language in leadership guidance.
- Keep functional labels plain.
- Preserve leader names, order, and role conventions unless leadership intentionally changes them.

## 6. Links and Unsupported Fields

Current link behavior:

- `leaders[].profileHref` renders a profile link inside a leader card when non-empty.
- The current data has one profile link: `./twills.html`.
- `leaders[].profileLabel` controls that link text and falls back to `Open profile`.
- The static `Return to Home` link in `leaders.html` points to `./index.html`.
- Shared header and footer navigation include links to `./leaders.html`.
- Leaders JSON does not currently contain external links.

Link rules:

- Internal links must resolve.
- External links must follow existing safe-link conventions.
- Unsupported link fields should not be added without renderer changes.
- Do not add personal contact details unless the data shape and privacy expectations are intentionally updated.

Currently unsupported fields and behaviors:

- Multiple leadership roster groups
- Sort/order fields
- Contact fields beyond `profileHref` and `profileLabel`
- Multiple profile links per leader
- External-link safety handling in `leaders.js`
- Data-driven hero or panel alt text
- Per-leader body paragraphs, extra badges, IDs, slugs, anchors, Discord role IDs, or permission fields
- Filters, tabs, accordions, URL query state, or interactive leader cards
- Inline HTML or Markdown in JSON copy

## 7. Accessibility

- Keep the page to one `h1`.
- Use `h2` for Guild Leadership, The Council, and Responsibilities.
- Side-panel headings, leader names, and responsibility titles may use `h3`.
- Preserve `<main id="main">` so the shared skip link works.
- Keep `#leadersError` available as a polite status message for load failures.
- Keep leader card/list readability clear in source order.
- Current leader and responsibility cards are `article` elements inside grid columns, not list items.
- Keep image alt text descriptive for public leader and responsibility images.
- Do not add JSON alt text fields for hero or panel images unless `leaders.js` is updated to use them.
- Keep focus states visible for profile links, the static `Return to Home` link, and shared header/footer controls.
- Keep touch targets usable when adding any new interactive element.
- Preserve mobile readability at narrow widths.
- Avoid horizontal overflow.
- Keep leader names concise so screen reader heading navigation remains useful.

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

## 9. Manual Leaders Smoke Checklist

- Open `/leaders.html`.
- Confirm hero and intro render.
- Confirm leadership groups render.
- Confirm leader cards/list render.
- Confirm images/avatars render if present.
- Confirm alt text exists where relevant.
- Confirm leader order is correct.
- Check mobile widths at 360px, 390px, and 768px for horizontal overflow.
- Confirm text remains readable.
- Confirm focus states are visible if links/buttons exist.
- Confirm there are no console-breaking errors.
- Confirm protected recruitment body remains unchanged.
- Confirm guild seal poem remains unchanged.

## 10. Protected Content

Leaders work must not alter:

- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`
- `apps/web/public/data/home.json` `seal.verse`
