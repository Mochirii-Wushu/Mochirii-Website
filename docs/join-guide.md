# Join Maintenance Guide

## 1. Purpose

The Join page is for onboarding: first steps, the Discord path, Tome and Events readiness, and the newcomer checklist.

Join should not duplicate:

- Recruitment philosophy
- Tome rules in full
- Events schedule details
- Gallery memories
- Leaders page contact structure beyond what the Join flow needs

Keep this page practical. A visitor should understand how to enter Discord, what to prepare, what to read next, and how to step toward a first run.

## 2. Data Source

- Join data lives in `apps/web/public/data/join.json`.
- Keep JSON valid.
- Preserve the current schema unless `JoinPage.tsx` changes in the same scoped task.
- Add only fields that `JoinPage.tsx` actually supports.
- Keep onboarding copy concise.
- Keep functional labels plain.

Current data shape:

- `hero`: `kicker`, `title`, `updated`, `timezone`, `intro`, `image`, `imageAlt`, `atmosphereImage`, `badges`
- `steps`: `title`, `intro`, `items`
- `quickStart`: `title`, `body`, `links`
- `checklist`: `eyebrow`, `title`, `intro`, `items`
- `culture`: `title`, `intro`, `cards`
- `notes`: `title`, `body`, `links`

Current item shapes:

- `steps.items[]`: `number`, `title`, `description`
- `quickStart.links[]`: `label`, `href`
- `checklist.items[]`: `title`, `text`, optional `href`, optional `label`
- `culture.cards[]`: `title`, `description`
- `notes.links[]`: `label`, `href`

## 3. Rendering and Shared Helpers

`JoinPage.tsx` renders:

- hero image, title, updated date, timezone, intro, and badges
- joining path title, intro, and ordered steps
- quick-start body and links
- newcomer checklist
- expectations/culture cards
- notes and helpful links
- a polite error message if JSON fails to load

Shared helper usage:

- Join uses the shared public-page text, record, route, link, image, date, and badge helpers.
- Join copy renders through `textContent`; inline HTML and Markdown are not supported in JSON.
- `hero.updated` uses the shared UTC-safe date formatter and renders as `Updated D MMM YYYY`.
- The shared Next shell mounts the header/footer and owns active nav, dropdowns, mobile menu behavior, and footer year.

## 4. Newcomer Checklist

The checklist lives in `apps/web/public/data/join.json` under `checklist`.

Current checklist item shape:

- `title`
- `text`
- optional `href`
- optional `label`

Each item should describe one concrete preparation step. Current checklist topics cover kindness, real-life availability, UTC+8 event timing, Discord, and questions.

Checklist links render only when both `href` and `label` are present. Current checklist links point to Discord, Tome, and Events.

Checklist copy should remain clear, not overly poetic. Do not add interactive completion behavior, checkbox state, local storage, or unsupported fields without updating `JoinPage.tsx` in a separate scoped task.

## 5. Tone Rules

- Join should sound welcoming and practical.
- Xianxia and Cupcake tone may appear lightly.
- Serious onboarding instructions should remain clear.
- Avoid forced rhyme.
- Avoid generic AI-like language.
- Avoid "Where Winds Meet" in visible Join body copy.
- Keep labels plain: See Events, Read the Tome, View Ranks, Join on Discord, Meet the Leaders.

## 6. Links and CTAs

Current link behavior:

- `quickStart.links` render as badge-row links.
- `checklist.items` render an item link only when both `href` and `label` are present.
- `notes.links` render as badge-row links.
- Discord links are external and open in a new tab with `rel="noopener noreferrer"`.
- The optional Discord server preview is user activated. Its iframe must not exist or make a Discord request until the visitor selects `Show server preview`; the ordinary `Open Discord` link remains available without loading the preview.
- Internal links currently point to Events, Tome, Ranks, and Leaders.
- Shared header/footer links are mounted by the Next layout, not `JoinPage.tsx`.

Link rules:

- Discord links must remain clear.
- Internal links must resolve.
- External links must follow the existing safe-link convention.
- Unsupported link fields should not be added without renderer changes.

The current Join renderer does not support link icons, descriptions, aria-label overrides, categories, button variants, per-step links, or dynamic event previews.

## 7. Accessibility

- Keep the page to one `h1`.
- Use `h2` for main Join sections.
- Side-panel headings and rendered card/checklist titles may use `h3`.
- Preserve ordered-list structure for joining steps.
- Preserve unordered-list structure for the newcomer checklist.
- Keep checklist marker numbers decorative with `aria-hidden="true"`.
- Keep CTA and checklist link focus states visible.
- Keep touch targets usable on mobile.
- Keep the server-preview disclosure button keyboard operable with accurate `aria-expanded` and `aria-controls` state.
- Avoid horizontal overflow at mobile widths.
- Keep onboarding copy readable by screen readers.
- Keep `#joinError` available as a polite status message for load failures.

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

Use `npm run smoke:gallery` as a general regression check when relevant to the repo baseline.

## 9. Manual Join Smoke Checklist

- Open `/join.html`.
- Confirm hero and intro render.
- Confirm joining path steps render.
- Confirm quick-start links render.
- Confirm newcomer checklist renders.
- Confirm Discord link works.
- Confirm Tome link works.
- Confirm Events link works.
- Confirm Ranks, Leaders, and Home links work where present.
- Check mobile widths at 360px, 390px, and 768px for horizontal overflow.
- Confirm text remains readable.
- Confirm focus states are visible.
- Confirm there are no console-breaking errors.
- Confirm protected recruitment body remains unchanged.
- Confirm guild seal poem remains unchanged.

## 10. Protected Content

Join work must not alter:

- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`
- `apps/web/public/data/home.json` `seal.verse`
