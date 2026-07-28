# Side Pages Maintenance Guide

## 1. Purpose

This guide covers the side pages:

- Announcements
- Raffle (`/raffle`)
- Spotify
- Spotlight

Current page roles:

- Announcements: updates, notices, timing, and short public bulletins.
- Raffle: a complete public closed-state page and static rules status while no drawing or promotion is active.
- Spotify: listening-room mood, music/embed presentation, and atmosphere through sound.
- Spotlight: member appreciation, short human story, and featured moment or person where supported.

Side pages should stay page-specific and should not duplicate:

- Join onboarding.
- Recruitment philosophy.
- Tome rules.
- Events schedule.
- Gallery archive.
- Leaders contact structure.
- Twills personal profile.

## 2. Data Sources

Current data sources:

- Announcements: `apps/web/public/data/announcements.json`
- Raffle: `apps/web/public/data/raffles.json`
- Spotify: `apps/web/public/data/spotify.json`
- Spotlight: `apps/web/public/data/spotlight.json`
- Rolling dates and weekly schedule timing: `apps/web/public/data/guild-schedule.json`

For each file:

- Keep JSON valid.
- Preserve the current schema unless the matching page renderer changes in the same scoped task.
- Add only fields the page renderer actually supports.
- Keep copy concise.
- Keep functional labels plain.
- Avoid inline HTML inside JSON unless a renderer explicitly supports it. Current side-page renderers treat JSON copy as text.

Current data shape summary:

- Announcements: `meta` plus `items[]`.
- Raffle: the versioned `RafflePublicView` contract parsed from `raffles.json`; see the raffle section below for its controlled fields and state rules.
- Spotify: `intro` plus `items[]`.
- Spotlight: `hero` plus `spotlight`.

## 3. Announcements Rules

Current supported fields:

- `meta.title`
- `meta.tagline`
- `meta.intro`
- `meta.updated`
- `meta.badges[]`
- `meta.hero.image`
- `meta.hero.atmosphere`
- `items[].id`
- `items[].pinned`
- `items[].date`
- `items[].title`
- `items[].summary`
- `items[].details[]`
- `items[].tags[]`

How to add or update an announcement safely:

- Edit `apps/web/public/data/announcements.json`.
- Use `YYYY-MM-DD` for date-only values.
- Use `pinned: true` only for notices that should sort above regular notices.
- Keep summaries brief.
- Use `details[]` for short supporting bullets.
- The live Next Announcements page derives `weekly-schedule` details from `apps/web/public/data/guild-schedule.json`; keep fallback JSON details aligned with that schedule.
- Use `tags[]` for short labels.
- Do not add item-level links or images unless `announcements.js` is intentionally updated and validated.

Observed rendering rules:

- Pinned items sort first.
- Within pinned/non-pinned groups, newer date strings sort first.
- Dates render through UTC-safe formatting.
- Empty announcements render `No announcements yet.`
- Load failures render an unable-to-load message.

Tone lane: word, notice, bulletin, update, timing, news.

Do not turn Announcements into long Recruitment copy, an Events schedule replacement, Tome rules, or Gallery memories.

## 4. Raffle Program Rules

### Public data contract

`apps/web/lib/raffle/public-view.ts` owns the provider-neutral `RafflePublicView`
contract. `apps/web/public/data/raffles.json` is reviewed public input and must
pass `parseRafflePageModel` before rendering; its nested `publicView` must pass
`parseRafflePublicView`. Keep `schemaVersion` at `1` until
the parser, renderer, tests, and this guide change together.

Supported top-level fields:

- `schemaVersion`
- `programName`
- `meta`
- `publicView`
- `entryModel`
- `rewards`
- `eligibility`
- `standingPrinciples[]`
- `results`
- `rules`

`publicView` is the provider-neutral cycle interface and contains only:

- `cycleStatus`: `inactive`, `scheduled`, `open`, `closed`, `drawing`,
  `results`, or `paused`.
- Separate `standardEntryStatus` and `bonusEntryStatus` values.
- `timezone`, which must remain `Asia/Singapore`.
- Nullable UTC `opensAt`, `closesAt`, `drawAt`, and `claimEndsAt` instants.
- Nullable `publicReward`, immutable active-cycle `rulesUrl`, aggregate
  `entrantCount`, and aggregate `totalEntryCount`.
- Literal entry limits of one standard, nine maximum bonus, and ten total.
- A privacy-safe `publicResult` of `none` or `winner_confirmed`.

The parser uses an exact-key allowlist. Do not add supplier, platform, payment,
internal-system, account, secret, or operational fields to this public
contract. Public copy, metadata, accessibility text, errors, and serialized
data remain Mochirii-only and provider-neutral.

### Standing program model

The standing model is fixed unless a separately reviewed program change updates
the contract, copy, rules, and tests together:

- One eligible monthly opt-in provides one standard entry.
- A member may earn up to nine optional bonus entries.
- Each permanent bonus method provides at most one entry per drawing and has an
  equivalent free participation path.
- The maximum is ten entries per person in one drawing.
- Purchases, payments, donations, subscriptions, follows, daily logins, and
  early entry never improve entry counts or odds.
- One activity or submission may satisfy only one bonus method. Completing both
  paths within a method never earns two entries.
- A public social contribution must disclose its connection to the monthly
  drawing, while an equivalent private contribution earns the same entry.
- Recruitment credit requires a newly verified member to identify the referring
  member voluntarily; unsolicited or repeated invitations do not qualify.
- Alternative-response text is reduced to non-reversible completion evidence
  and then discarded.
- Potential winners use the authenticated Mochirii claim page within the
  standing seven-day claim window unless an active rules version lawfully
  states another period. Private reminders may be sent with approximately 72
  and 24 hours remaining.
- Electronic rewards expire 30 days after issue unless an active rules version
  lawfully states another term.

`entryModel.permanentBonusMethods` contains exactly these nine standing method
pairs:

1. Attend one guild activity such as Breaking Army or Showdown, or complete the
   monthly activity check-in.
2. Join the monthly gathering, or submit one agenda response.
3. Join or host one help session such as PvP training or build support, or
   submit one written PvP or build-support tip.
4. Share one original photo or video on a social account with the required
   monthly-drawing disclosure, or submit the same work privately to the guild.
5. Complete the end-of-cycle feedback prompt, or suggest one practical guild
   improvement.
6. Welcome one new or returning member in a guild community channel, or send
   one private welcome note for leaders to share.
7. Recruit one new verified guild member who voluntarily identifies the
   referrer, or submit one practical recruitment idea.
8. Share one original artwork or real-life hobby moment on Mōchirīī Social, or
   submit the same original work privately to the guild.
9. Recognize another member's contribution, or nominate one member for the
   monthly spotlight.

Standing eligibility remains: verified Mochirii guild membership in good
standing, age 18 or older, residence in a country approved for the drawing, and
one account and one opt-in per person per cycle. Keep `No purchase necessary`
conspicuous on `/raffle`.

### Reward and result presentation

Standing reward copy may describe only the approved provider-neutral
categories:

- Digital gift cards stated in an active drawing's rules.
- Virtual prepaid rewards where the approved locations and terms allow them.
- Community membership upgrades stated in an active drawing's rules.
- Approved in-game items, game credit, or other digital game choices stated in
  an active drawing's rules.
- Guild commendation as a community honor.
- Hall record as a community honor retained with a completed drawing.

Each active drawing must identify its exact reward, value, eligible locations,
delivery method, redemption terms, and claim deadline in immutable official
rules. Do not expose provider names or imply that any standing category is
offered in a cycle that has not been approved.

Result records use stable `resultKey` values and privacy-safe labels. Signed-out
visitors see `Winner confirmed` or `Community honor confirmed`. Only a freshly
server-verified guild member may receive a server-supplied guild display-name
map for those result keys. Do not place member display names in static JSON,
metadata, shared caches, unauthenticated responses, or client-accessible private
data. Missing or invalid membership evidence must fall back to the generic
label. The official rules and opt-in acknowledgement disclose this
verified-member display-name visibility before participation.

### Cycle and archive states

All seven cycle states are explicit. Invalid, missing, or inconsistent data
fails the parser rather than guessing. Only `open` may accept standard entries;
scheduled, closed, drawing, results, paused, and inactive states keep entries
closed. An open cycle must accept standard entries and may independently open
or close bonus entries. Results require privacy-safe winner confirmation,
exactly one winner and two community honors, drawing evidence whose instant
equals `drawAt`, and aggregate counts between one and ten entries per entrant.

When no drawing is active:

- Set `publicView.cycleStatus` to `inactive`.
- Set both public entry states to `closed`.
- Set all cycle dates, reward, active rules URL, aggregate counts, and result to
`null` or `none` as defined by the contract.
- Set `rules.currentRulesState` to `inactive` and show `No active drawing rules`.
- State plainly that no raffle is active and no submissions are being accepted.
- Keep standing entry, eligibility, reward-category, fairness, and no-purchase
  information visible.
- Render no submission, claim, sign-in, moderation, reward, disabled, or dead
  controls and make no private request.

An approved active cycle supplies UTC instants for opening, closing, drawing,
and claim deadlines plus cycle-specific eligibility, reward copy, and a local
immutable `/raffle#drawing-rules-...` anchor. `Asia/Singapore` remains the
internal IANA calculation zone. Store instants as ISO 8601 UTC values, show
`UTC+8` as the governing public time, and progressively enhance with the visitor's localized
equivalent without replacing or obscuring the governing time. Invalid or
missing dates fail closed, and every non-inactive cycle must satisfy
`opensAt < closesAt < drawAt < claimEndsAt`.

The consolidated `/raffle` rules section distinguishes three layers:

- Standing program principles, which remain visible between drawings.
- Current official drawing rules, which exist only for an approved active
  cycle and otherwise show `No active drawing rules`.
- Immutable archived rules for completed drawings at local in-page anchors.

`rules.versions[]` is the only source for versioned rule sections. Each entry has a
safe route slug, an exactly matching local anchor, active or archived state,
publication instant, and reviewed public sections. Every current/archive link
must resolve to a matching version. Do not invent archive records or publish
an empty rules shell.

Observed routing and rendering rules:

- `/raffle` is the only public, canonical, indexable raffle Server Component
  and remains useful without JavaScript.
- Retired `/raffle/rules` and version paths return not found; they do not own
  redirects, content, metadata, bundles, or sitemap entries.
- `/raffles` and `/raffles.html` permanently redirect to `/raffle`.
- The website event-card renderer filters the inactive `monthly-raffle`
  schedule item so Events cannot advertise a drawing while the raffle is
  inactive.
- `apps/web/public/data/guild-schedule.json` remains a provider-consumed
  schedule source and is not rewritten by a public raffle-page change. Moving
  its historical raffle record requires a separately reviewed provider-safe
  migration.

Tone lane: drawing, entry, reward, result, rules, eligibility, fairness.

Keep status and rules language plain. The Raffle page should not duplicate
Events, Join, Recruitment, or Announcements.

## 5. Spotify Rules

Current supported fields:

- `intro`
- `items[].title`
- `items[].subtitle`
- `items[].description`
- `items[].type`
- `items[].tags[]`
- `items[].url`
- `items[].embed`
- `items[].height`

Current rendering:

- Spotify content renders as iframe embeds.
- Cards do not render external links.
- Search filters title, subtitle, description, tags, and type.
- Tag filters render as buttons with `aria-pressed`.
- Missing item fields receive safe defaults.

Valid Spotify URL expectations:

- The renderer accepts only `open.spotify.com`.
- It supports Spotify `album`, `artist`, `episode`, `playlist`, `show`, and `track` paths.
- It accepts normal Spotify URLs and existing `/embed/...` URLs.
- It normalizes supported URLs to `https://open.spotify.com/embed/{kind}/{id}?utm_source=generator`.
- Unsupported hosts, unsupported kinds, missing IDs, malformed URLs, and blank URLs do not render an embed card.

Current iframe behavior:

- Spotify iframe embeds are deferred by a player shell and mount only when the card nears the viewport.
- The deferred shell uses `IntersectionObserver`; when that browser API is unavailable, the player loads safely instead of leaving an empty card.
- Iframes use `width="100%"`.
- Height comes from `items[].height` when positive, otherwise the default is `352`.
- Iframes include `loading="lazy"`.
- Iframes include meaningful `title="Spotify embed: {title}"`.
- Iframes include the existing allow list: `autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture`.
- `.spotify-embed` hides overflow and the grid becomes one column below `980px`.

Fallback behavior:

- Invalid or missing item embed data skips that card.
- When no valid cards match the active search/filter state, the empty state appears.
- If playlist JSON fails to load, the page shows an unable-to-load intro and grid error message.

Tone lane: song, room, rhythm, rest, listening, quiet.

Do not add unsafe embeds, unsupported providers, custom iframe behavior, or URL-state behavior without renderer work and validation.

## 6. Spotlight Rules

Current supported fields:

- `hero.image`
- `hero.alt`
- `spotlight.kicker`
- `spotlight.title`
- `spotlight.date`
- `spotlight.tag`
- `spotlight.intro`
- `spotlight.badges[]`
- `spotlight.body[]` or a single body string
- `spotlight.conclusion`
- `spotlight.highlights[]`

How to add or update Spotlight safely:

- Edit `apps/web/public/data/spotlight.json`.
- Keep body text short and specific to the featured person or moment.
- Use `highlights[]` for concise appreciation bullets.
- Keep `spotlight.date` as a date-only value when possible.
- The live Next Spotlight page derives the visible date from the first day of the current UTC+8 month. It may replace the configured fallback title with the finalized monthly Discord poll winner name from `get-current-spotlight-winner`; that public poll path must display the winner name only and must not expose Discord handles, profile links, avatars, vote counts, or candidate lists.
- Keep hero alt text meaningful.
- Do not add profile/contact fields unless `spotlight.js` is intentionally updated and validated.

Observed rendering rules:

- Body renders as paragraphs.
- Badges are capped at 10 and each label is trimmed to 34 characters.
- Highlights are capped at 10.
- Missing body and missing highlights have placeholder fallbacks.
- `hero.atmosphereImage` is present in current JSON but is not read by `spotlight.js`.

Tone lane: name, gesture, thanks, story, moment, appreciation.

Avoid duplicating Leaders/Twills/Gallery roles. Spotlight should not become a contact profile, personal profile, full archive, or Recruitment essay.

## 7. Links, Images, and Embeds

- Internal links must resolve.
- External links must follow existing safe-link conventions.
- Raffle public sources do not contain external links.
- Image paths must resolve.
- Alt text should match visible content.
- Decorative or hidden atmosphere images should remain empty-alt and hidden.
- Spotify/embed URLs must follow current renderer expectations.
- Spotify embeds should not overflow on mobile.
- Spotify embeds use a two-column grid on desktop/tablet and a single column on mobile.
- Spotify iframe titles should remain meaningful.
- Unsupported link, image, or embed fields should not be added without renderer changes.

## 8. Script Load Order and Shared Shell

Current shared script order on side pages:

```text
utils.js -> supabase.js -> site.js -> page-specific script
```

Current side-page script order:

- `announcements.html`: `./utils.js` -> `./supabase.js` -> `./site.js` -> `./announcements.js`
- `/raffle`: a static Next.js Server Component with no page-specific browser script.
- `spotify.html`: `./utils.js` -> `./supabase.js` -> `./site.js` -> `./spotify.js`
- `spotlight.html`: `./utils.js` -> `./supabase.js` -> `./site.js` -> `./spotlight.js`

Do not reorder scripts casually. `utils.js` should remain available before shared and page scripts. `supabase.js` must not break signed-out public browsing. `site.js` owns shared header/footer/nav behavior and currently loads before page-specific scripts.

## 9. Tone Rules

- Side pages should stay concise and page-specific.
- Xianxia/Cupcake tone may appear lightly only where it fits.
- Functional labels stay plain.
- Avoid generic AI-like language.
- Avoid forced rhyme.
- Avoid `Where Winds Meet` in regular visible body copy outside header/footer.

The exact game name may remain in titles, metadata, SEO, JSON-LD, validation scripts, docs, reports, internal code, header, and footer.

## 10. Accessibility

Preserve these expectations:

- Side pages keep one sensible `h1`.
- Major sections use sensible `h2`/`h3` headings.
- Cards and lists remain readable.
- Focus states remain visible for links, buttons, and inputs.
- Interactive controls remain usable touch targets.
- Spotify search keeps a visible label.
- Spotify tag filters keep button semantics and `aria-pressed`.
- Spotify embeds keep meaningful iframe titles.
- Header, main, and footer landmarks remain sensible.
- Skip link continues to target `#main`.
- Mobile layouts should not have horizontal overflow.
- Screen reader text should stay clear and not noisy.
- Raffle `8/4` and `7/5` card pairs keep their intended proportions above
  `980px` and every card occupies the usable container width at or below
  `980px`.
- Raffle cards must not collapse, clip text, overlap, or require two-dimensional
  scrolling, including at `320px` CSS width and 200% text sizing.

## 11. Validation

Run these checks before opening or merging side-page work:

```sh
npm run check
git diff --check
node scripts/check-json.mjs
node scripts/check-js.mjs
node scripts/check-refs.mjs
node scripts/check-assets.mjs
npm run check:raffle-public
npm run test:raffle-public
npm run smoke:raffle-public:fixtures
npm run smoke:raffle-public -- --local
npm run check:production
```

Use `npm run smoke:gallery` as a general regression check if shared behavior could affect the gallery baseline. It expects a local static server on port `8765`.

## 12. Manual Side Pages Smoke Checklist

- `/announcements.html` loads.
- `/raffle` loads and says `No raffle is active`, `Entries closed`, `No submissions are being accepted`, and `No purchase necessary`.
- `/raffle` shows the standing one-standard, up-to-nine-bonus, maximum-ten entry model and all nine equivalent-free participation methods.
- `/raffle` describes only the approved provider-neutral digital-gift-card, virtual-prepaid, community-membership, in-game-gift, and community-honor categories.
- `/raffle` distinguishes standing principles, current official drawing rules, and immutable archived rules; it shows `No active drawing rules` while inactive.
- A versioned rules anchor renders only reviewed local `rules.versions[]` content; retired rules paths return not found.
- Signed-out raffle results use only `Winner confirmed` or `Community honor confirmed`; verified-member result-name behavior is tested at the server boundary.
- `UTC+8` remains the governing public time for active-cycle dates and visitor-local equivalents do not replace it.
- Inactive raffle pages render no submission, claim, sign-in, moderation, reward, disabled, or dead controls and make no private request.
- `/raffles` and `/raffles.html` permanently redirect to `/raffle`.
- `/spotify.html` loads.
- `/spotlight.html` loads.
- Header/footer render.
- Mobile nav works.
- Links resolve.
- Images render if present.
- Spotify embeds render if present.
- Spotify embeds do not overflow.
- Raffle cards fill the usable width without collapse at `320px`, `360px`, `390px`, `430px`, and `768px`, including at 200% text sizing.
- Above `980px`, raffle `8/4` and `7/5` card pairs retain their intended proportions.
- The production-disabled rendered-fixture smoke covers all seven cycle states, separate open-entry combinations, missing data, Singapore/no-JavaScript time, visitor localization, and alternating verified/unverified result views in Chromium, Firefox, and WebKit.
- Mobile widths `360px`, `390px`, and `768px` have no horizontal overflow.
- No console-breaking errors occur.
- Supabase page shell does not cause signed-out runtime errors.
- Protected recruitment body remains unchanged.
- Protected recruitment conclusion remains unchanged.
- Twills protected body remains unchanged.
- Guild seal poem remains unchanged.

## 13. Protected Content

Side-page work must not alter:

- `apps/web/public/data/home.json` `seal.verse`
- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`
- `apps/web/public/data/twills.json` `profile.bio`
