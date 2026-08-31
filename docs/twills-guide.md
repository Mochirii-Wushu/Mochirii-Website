# Twills / Profile Maintenance Guide

## 1. Purpose

The Twills page is for personal or leader voice, profile presence, contact or signature details where the current renderer supports them, and giving members a clearer sense of the person behind the role.

Twills should not duplicate:

- Leaders stewardship/contact structure in full
- Join onboarding
- Recruitment philosophy
- Tome rules
- Events schedule details
- Gallery memories
- Ranks hierarchy

Keep the page focused on one profile. It can support warmth and contact clarity, but it should not become a second Leaders page or a second recruitment essay.

## 2. Data Source

- Twills data lives in `apps/web/public/data/twills.json`.
- Keep JSON valid.
- Preserve the current schema unless `twills.js` changes in the same scoped task.
- Add only fields that `twills.js` actually supports.
- Keep profile copy concise.
- Keep functional labels plain.

Current data shape:

- `hero`: `kicker`, `image`
- `profile`: `name`, `timezone`, `avatar`, `badges`, `cardTitle`, `bioTitle`, `bio`
- `profile.badges`: array of text-only badge strings, capped at 10 rendered badges
- `profile.bio`: array of paragraph strings rendered as the protected Twills body text

Renderer notes:

- `twills.js` loads `apps/web/public/data/twills.json` through `MochiriiUtils.fetchJson`.
- Text renders with `textContent`; inline HTML and Markdown are not supported.
- Badge strings render as plain spans, not links.
- Hero and avatar alt text are fixed in `twills.js`; there are no data-driven alt fields.
- Missing bio content renders a muted dash.

## 3. Protected Body Text

The protected Twills body text lives at:

- File: `apps/web/public/data/twills.json`
- JSON key: `profile.bio`
- Renderer: `twills.js` calls `renderBio($("#twillsBio"), data?.profile?.bio)`

The Twills body text is protected. Do not alter wording, punctuation, paragraph breaks, capitalization, diacritics, or structure. Future edits may revise other non-body fields only if needed and intentionally scoped. Any body-text change requires explicit user approval.

## 4. Profile Copy Rules

- Profile copy should sound personal, clear, and steady.
- Xianxia tone may appear lightly through voice, note, cup, contact, care, road, and hall.
- Cupcake tone may appear lightly if it is already part of the page voice.
- Do not make profile copy too poetic or vague.
- Avoid generic AI-like language.
- Avoid `Where Winds Meet` in visible Twills body copy.
- Keep public contact details intentional.
- Do not revise protected body text.

## 5. Links and Contact Details

Current link/contact behavior:

- `twills.html` does not define page-local content links.
- Contact details currently render as plain text badge strings in `profile.badges`.
- Email, Discord, and UID values are not parsed or converted into links.
- `twills.js` has no data-driven link renderer.

Maintenance rules:

- Internal links must resolve.
- External links must follow existing safe-link conventions.
- Discord or contact details should be public only if intentional.
- UID/contact strings should remain accurate if they are public.
- Unsupported link/contact fields should not be added without renderer changes.

## 6. Images and Assets

Current image behavior:

- Hero image path: `./assets/img/profiles/twills/hero.webp`
- Avatar image path: `./assets/img/profiles/twills/avatar.webp`
- Hero alt text is fixed as `Twills profile banner artwork`.
- Avatar alt text is fixed as `Twills profile picture`.
- If a JSON image field is empty, the static image already in `twills.html` remains in place.
- There is no image load-error fallback and no data-driven image alt field.

Maintenance rules:

- Image paths must resolve.
- Alt text should describe the image, avatar, or profile clearly.
- Do not add large unoptimized images.
- Follow existing asset conventions.

## 7. Accessibility

- Preserve a sensible heading order: one profile `h1`, then section `h2` headings.
- Keep profile card and bio content readable in the existing card/list structure.
- Keep image alt text accurate when image purpose changes.
- Focus states must remain visible if links or buttons are added in a future scoped task.
- Touch targets must be usable if interactive elements are added.
- Maintain mobile readability and avoid horizontal overflow.
- Keep screen reader output clear; avoid duplicate or noisy announcements.
- Supabase page shell loading should not cause signed-out runtime errors.

## 8. Validation

Run these checks before opening or merging Twills work:

```sh
npm run check
git diff --check
node scripts/check-json.mjs
node scripts/check-js.mjs
node scripts/check-refs.mjs
node scripts/check-assets.mjs
npm run check:production
```

Use `npm run smoke:gallery` as a general regression check when shared behavior could affect the gallery baseline. It expects a local static server on port `8765`.

## 9. Manual Twills Smoke Checklist

- `/twills.html` loads.
- Hero/profile content renders.
- Protected body text renders unchanged.
- Cards/lists render if present.
- Images/avatars render if present.
- Links/contact details work if present.
- Mobile widths `360px`, `390px`, and `768px` have no horizontal overflow.
- Text remains readable.
- Focus states are visible if links/buttons exist.
- No console-breaking errors occur.
- Supabase page shell does not cause signed-out runtime errors.
- Protected recruitment body remains unchanged.
- Guild seal poem remains unchanged.

## 10. Protected Content

Twills work must not alter:

- Twills protected body text: `apps/web/public/data/twills.json` `profile.bio`
- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`
- `apps/web/public/data/home.json` `seal.verse`
