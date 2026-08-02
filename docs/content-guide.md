# Mōchirīī Website Content Guide

## 1. Site Structure

This is a static HTML/CSS/vanilla JavaScript site.

- Page shells live in root `.html` files.
- Page content lives mostly in `apps/web/public/data/*.json`.
- Shared header and footer markup live in `header.html` and `footer.html`, then load through `site.js`.
- Shared browser helpers live in `utils.js`; keep it loaded before `site.js` and page scripts.
- For Home and shared shell conventions, see [`docs/home-shell-guide.md`](home-shell-guide.md).
- Images, audio, icons, and Lottie placeholders live under `apps/web/public/assets/`.

Keep the static architecture unless a future task explicitly calls for a larger change.

## 2. Editing JSON Content

- Keep JSON valid: no trailing commas, comments, or unquoted keys.
- Preserve existing keys and array shapes unless you also update the matching page script.
- Keep public copy concise enough for cards, hero sections, and mobile layouts.
- Avoid inline HTML inside JSON; page scripts render text safely.
- Prefer existing content patterns from nearby entries before inventing a new structure.
- Run `npm run check` after editing.

## 3. Dates

- For Events-specific date and filter conventions, see [`docs/events-guide.md`](events-guide.md).
- Use `YYYY-MM-DD` for date-only values.
- Date rendering is UTC-safe, so date-only values should not shift backward in US time zones.
- Avoid natural-language dates in structured date fields.
- After editing events or announcements, spot-check rendered dates locally.

## 4. Images and Assets

- Use optimized WebP where practical.
- Preserve PNG only when transparency or source quality requires it.
- Do not commit huge originals unless they are intentionally needed for deployment.
- Keep alt text useful for public images.
- Run `node scripts/check-assets.mjs` and `node scripts/check-refs.mjs` after asset edits.
- Do not delete assets without confirming they are unused or safely replaced.

### Recruitment Audio Exception

`apps/web/public/assets/audio/mochiriiiiii.mp3` is intentionally above the normal large-asset warning threshold because the original Recruitment audio quality was restored at the user's request.

Validation may warn that this file is over the large-asset threshold. Treat that warning as accepted unless the user explicitly reopens audio optimization. Do not re-encode, downsample, replace, or remove this MP3 in unrelated branches.

The restoration source of truth is [`reports/audio-original-restore.md`](../reports/audio-original-restore.md).

## 5. Gallery Rules

- For detailed Gallery maintenance conventions, see [`docs/gallery-guide.md`](gallery-guide.md).
- Gallery grid images should use `apps/web/public/assets/img/gallery/thumbs/`.
- Lightbox/full images should use the optimized full gallery path, not `/thumbs/`.
- Preserve `data-full` or the equivalent full-image field when editing gallery cards.
- Regression check: opening a gallery item must not load a `/thumbs/` image in the lightbox.
- When Gallery CSS or JS changes affect visible behavior, update the Gallery page's small `?v=` query on its CSS/JS references so production edges fetch the new files after `gallery.html` refreshes.
- Run `npm run smoke:gallery` when gallery behavior changes, with a local server running on port `8765`.

## 6. Links

- Keep local links relative and stable unless fixing a confirmed broken reference.
- External links in HTML should use `target="_blank"` with `rel="noopener noreferrer"` when they open new tabs.
- Keep the Discord CTA consistent unless the invite URL intentionally changes.
- Ignore external third-party previews during local reference validation, but verify local assets with `node scripts/check-refs.mjs`.

## 7. Tone and Copy

- For Join-specific onboarding, checklist, link, and accessibility conventions, see [`docs/join-guide.md`](join-guide.md).
- For Tome-specific conduct, values, and protected-content conventions, see [`docs/codex-guide.md`](codex-guide.md).
- For Ranks-specific progression, hierarchy, image, tone, and accessibility conventions, see [`docs/ranks-guide.md`](ranks-guide.md).
- For Leaders-specific roster, profile-link, image, tone, and accessibility conventions, see [`docs/leaders-guide.md`](leaders-guide.md).
- For Twills/Profile-specific protected body text, contact detail, image, tone, and accessibility conventions, see [`docs/twills-guide.md`](twills-guide.md).
- For Recruitment-specific protected body/conclusion, audio, tone, and accessibility conventions, see [`docs/recruitment-guide.md`](recruitment-guide.md).
- For Announcements, Raffles, Spotify, and Spotlight data, embed, link, tone, accessibility, and smoke-test conventions, see [`docs/side-pages-guide.md`](side-pages-guide.md).
- Tone should stay clear, wuxia-inspired, and recognizably Mōchirīī.
- New visitors should understand the guild, the game, and the join path quickly.
- Keep the Cupcake identity readable rather than cryptic.
- Do not claim official affiliation with Where Winds Meet unless that is verified and intentionally approved.
- Avoid generic MMO boilerplate; write like Mōchirīī has a real home and rhythm.
- Prefer nouns and verbs over adjective stacks; remove descriptors that repeat, decorate, or slow the line.
- Favor concrete guild images: scheduled runs, first greetings, hall details, event preparation, and an occasional cupcake motif.
- Use rhyme, repeated sounds, and soft cadence only when they feel natural. Do not turn public guidance into verse.
- Use cupcake motifs sparingly; do not make every section dessert-themed or unclear.
- Keep functional labels plain, such as Join Discord, Read the Tome, View Events, Upcoming, Past, and All.
- Do not change public-facing copy without explicit approval for the exact surface and wording.
- Avoid antithetical contrast pairs, formulaic parallelism or juxtaposition, generic AI-like phrasing, corporate language, forced rhyme, and direct references from source poems.
- Avoid mood-filler vocabulary such as `kind`, `patience`, `presence`, and close generic substitutes in newly approved copy. Prefer concrete actions, roles, events, places, or outcomes.
- Use `pretty`, `wonderful`, `cupcake`/`cupcakes`, and `Wushu land` only as sparse house accents where the page context supports them.
- Do not alter the protected long-form recruitment body or the guild seal poem.

## 8. Xianxia House Style, Page Purpose, and Vocabulary

- Mōchirīī copy should read like a lived-in xianxia guild hall: clear, lightly rhythmic, and rooted in specific shared activity.
- Each page should have a distinct job. Home invites, Join orients, Events schedules, Gallery remembers, Ranks explains progression, Leaders directs contact, Tome defines conduct, Recruitment preserves philosophy, and side pages keep their own focus.
- Use cultivation, path, hall, lantern, jade, lotus, bamboo, moon, frost, and qi imagery sparingly. Clear meaning comes first.
- Keep cupcake references as a playful thread, not a repeated motif.
- The exact phrase “Where Winds Meet” may remain in the approved Home subtitle `Asia Pacific • Where Winds Meet Guild`, titles, metadata, JSON-LD, validation scripts, docs, reports, header, and footer. Avoid it elsewhere in regular visible body copy when a clear phrase like the game, the Jianghu, the guild road, or the path works better.
- Do not imitate named authors, copy poem/article phrases, force rhyme, blur functional labels, or repeat the same vocabulary across pages without purpose.
- The protected Recruitment body/conclusion and guild seal poem remain exact historical exceptions to newer editorial preferences. Do not rewrite them to satisfy a later tone rule.

## 9. Validation Before PR

Run these for most changes:

```sh
npm run check
git diff --check
```

Run these when relevant:

```sh
npm run check:production
npm run smoke:gallery
node scripts/check-assets.mjs
node scripts/check-refs.mjs
node scripts/check-json.mjs
node scripts/check-js.mjs
```

Keep `npm run check:production` separate from local validation. It depends on the live site and network access.

## 10. Branching

- Use one scoped branch per change.
- Open a PR into `main`.
- Do not make direct feature edits on `main`.
- Use merge commits unless project policy changes.
- Merge only after validation passes and any relevant smoke test is documented.
