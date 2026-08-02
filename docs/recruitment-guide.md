# Recruitment Maintenance Guide

## 1. Purpose

The Recruitment page is for recruitment philosophy, guild growth, member participation, retention mindset, and long-form recruiting guidance.

Recruitment should not duplicate:

- Join onboarding/checklist
- Tome rules in full
- Events schedule details
- Gallery memories
- Leaders contact structure
- Ranks hierarchy

Keep the page focused on recruiting philosophy and participation. The protected long-form body already carries the core message, so supporting fields should help frame it without becoming a second Join page or a rules manual.

## 2. Data Source

- Recruitment data lives in `apps/web/public/data/recruitment.json`.
- Keep JSON valid.
- Preserve the current schema unless `recruitment.js` changes in the same scoped task.
- Add only fields that `recruitment.js` actually supports.
- Keep non-body supporting copy concise.
- Keep functional labels plain.

Current data shape:

- `hero`: `image`, `alt`, `atmosphere`
- `meta`: `kicker`, `heading`, `author`, `updated`, `intro`, `badges`
- `audio`: `title`, `description`, `sources`
- `audio.sources[]`: `src`, optional `type`
- `content`: `title`, `paragraphs`, `conclusion`

Renderer notes:

- `recruitment.js` loads `apps/web/public/data/recruitment.json` through `MochiriiUtils.fetchJson`.
- `meta.updated` renders as month and year through `MochiriiUtils.formatDateUTC`.
- Text renders with `textContent`; inline HTML and Markdown are not supported.
- Badges render as plain spans, not links.
- Audio sources render as native `<source>` elements under a hidden `#recruitmentAudio`, while visitors use the custom themed audio player.
- There is no data-driven CTA or link renderer.

## 3. Protected Long-Form Body and Conclusion

The protected Recruitment fields are:

- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`

`recruitment.js` renders them with:

- `addProseBlocks($("#recruitmentBody"), safeArray(data?.content?.paragraphs))`
- `addProseBlocks($("#recruitmentConclusion"), safeArray(data?.content?.conclusion))`

These fields are protected. Do not alter wording, punctuation, paragraph breaks, apostrophes, capitalization, diacritics, or structure. Future edits may revise other non-body fields only if needed, supported by `recruitment.js`, and intentionally scoped. Any body or conclusion change requires explicit user approval.

The body and conclusion are also exempt from later general editorial-lint rules. Existing wording or rhythms that a newer style guide would avoid must remain unchanged unless the user explicitly approves a dedicated protected-copy revision.

## 4. Non-Body Recruitment Fields

The following current fields are non-body fields rendered by `recruitment.js` and may be revised in future scoped work when needed:

- `hero.image`
- `hero.alt`
- `hero.atmosphere`
- `meta.kicker`
- `meta.heading`
- `meta.author`
- `meta.updated`
- `meta.intro`
- `meta.badges`
- `audio.title`
- `audio.description`
- `audio.sources`
- `audio.sources[].src`
- `audio.sources[].type`
- `content.title`

Do not add unsupported fields such as `cta`, `links`, `cards`, `items`, `profileHref`, or `discord` without renderer changes in the same scoped task.

## 5. Tone Rules

- Recruitment should sound clear, grounded, and guild-minded.
- The protected long-form body already carries the core message.
- Do not make supporting copy compete with or summarize the protected body.
- Xianxia tone may appear lightly, but recruiting guidance should stay direct.
- Cupcake tone may appear sparingly only in supporting fields.
- Avoid forced rhyme.
- Avoid generic AI-like language.
- Avoid `Where Winds Meet` in visible Recruitment body copy.
- Do not revise protected body or conclusion.

## 6. Links, Audio, and Media

Current link/audio/media behavior:

- The current Recruitment content area has no page-local internal or external links.
- Shared header/footer links come from `site.js`.
- The current audio source is `./assets/audio/mochiriiiiii.mp3` with type `audio/mpeg`.
- Audio format badges are derived from source MIME types.
- The Recruitment page uses a custom themed audio player instead of visible native browser controls. It must not render native browser controls, a three-dot menu, a download option, or a playback-speed option.
- The MP3 remains public because public playback is required. The custom player removes page-level download affordances, but a public MP3 can still be fetched by determined users through network tools.
- If `audio.sources` is empty, `recruitment.js` disables the custom player and reports audio as unavailable through the description text.
- The current hero image is `./assets/img/recruitment/hero.webp`.
- `hero.atmosphere` remains a reserved data field. The current design does not render it, so hidden decorative media is not downloaded.

Maintenance rules:

- Internal links must resolve.
- External links must follow existing safe-link conventions.
- Audio paths must resolve if audio is used.
- Audio labels/descriptions should remain clear.
- Custom audio player controls must remain keyboard-operable and visibly focused.
- Unsupported link/audio/media fields should not be added without renderer changes.

## 7. Accessibility

- Preserve a sensible heading order: one Recruitment `h1`, then section `h2` headings.
- Keep long-form paragraphs readable in `#recruitmentBody` and `#recruitmentConclusion`.
- Keep line length, paragraph spacing, and mobile readability clear.
- Keep custom audio player controls usable when audio sources are present.
- Keep audio labels and descriptions clear.
- Focus states must remain visible if links or buttons are added in a future scoped task.
- Touch targets must be usable if interactive elements are added.
- Avoid horizontal overflow.
- Keep screen reader output clear; avoid duplicate or noisy announcements.
- Supabase page shell loading should not cause signed-out runtime errors.

## 8. Validation

Run these checks before opening or merging Recruitment work:

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

## 9. Manual Recruitment Smoke Checklist

- `/recruitment.html` loads.
- Hero/supporting content renders.
- Protected body renders unchanged.
- Protected conclusion renders unchanged.
- Audio/media renders if present.
- Links work if present.
- Mobile widths `360px`, `390px`, and `768px` have no horizontal overflow.
- Long-form text remains readable.
- Focus states are visible if links/buttons exist.
- No console-breaking errors occur.
- Supabase page shell does not cause signed-out runtime errors.
- Twills protected body remains unchanged.
- Guild seal poem remains unchanged.

## 10. Protected Content

Recruitment work must not alter:

- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`
- `apps/web/public/data/twills.json` `profile.bio`
- `apps/web/public/data/home.json` `seal.verse`
