# Events Maintenance Guide

## 1. Purpose

The Events page is for schedule browsing, participation cues, upcoming and past event visibility, and event history where event data exists.

Events should not duplicate:

- Join onboarding
- Recruitment philosophy
- Tome rules
- Announcements
- Gallery memories

Keep this page focused on times, RSVP notes, runs, and the rhythm of gathering.

## 2. Data Source

- Events shell copy lives in `apps/web/public/data/events.json`.
- Rolling event timing and the live Next Events board live in `apps/web/public/data/guild-schedule.json`.
- The live Next Events board is schedule-first: it renders one card per Discord/Reaper-managed event type from `websiteEventCardsFromSchedule`, using schedule-derived dates, the public `UTC+8` label, and `discordCoverImage` art.
- `apps/web/public/data/guild-schedule.json` keeps `timezone.label` and `timezone.displayLabel` as `UTC+8` and `offsetMinutes` as `480` for public and machine compatibility. `timezone.ianaZone` remains `Asia/Singapore` internally so daylight-saving-independent calculations use a stable IANA zone.
- `apps/web/public/data/events.json` is page-shell copy only for the Next app: meta, hero, featured lead/bullets fallback, recurring intro, participation text, and fallback content.
- Keep JSON valid: no trailing commas, comments, or unquoted keys.
- Preserve the current schema unless the matching renderer is updated in the same scoped task.
- Add only fields that `events.js` actually supports.
- Do not invent fixed schedules.
- Keep event copy concise and page-specific.

Current data shape:

- `meta`: page kicker, title, intro, updated date, timezone label, badges, and hero image paths.
- `featured`: featured-event lead, tag, fallback date, fallback time, fallback timezone, fallback title, fallback image, optional `href`, optional `linkLabel`, and `bullets`.
- `upcoming`: fallback event-board data. It is not the live schedule authority.
- `recurring`: recurring-events intro and an `items` array with `title` and `summary`.
- `participation`: participation blocks with `title` and `body`.

Not currently implemented:

- Event category, type, or status fields.
- Separate `past` archive array.
- Event URL query state.
- RSVP-specific fields beyond existing links and copy.

## 3. Date Rules

- Use `YYYY-MM-DD` for date-only values.
- Date rendering must remain UTC-safe.
- Dates must not shift one day earlier in US time zones.
- `events.js` parses date-only values with a strict UTC pattern before classifying events.
- Invalid or missing event dates are treated as upcoming by the current renderer.
- Event-board dates are rendered with `MochiriiUtils.formatDateUTC`.
- Featured event dates in the Next app derive from the first upcoming schedule card; `featured.date` is fallback shell data only.
- Reaper's `/sync-events` command reads the mirrored guild schedule JSON and must stay aligned with the website schedule helpers.
- The Next `/events` route waits for a real request, generates one ISO reference time on the server, and passes it through the complete Event Board render. This keeps status current without calling `Date.now()` or a no-argument `new Date()` during client hydration.

Current sorting:

- Upcoming sorts soonest first.
- Past sorts newest first.
- All shows upcoming events first, then past events.
- Within All, upcoming dates sort soonest first and past dates sort newest first.
- If dates match, the Next Events board sorts by `startIso` so same-day UTC+8 events, including midnight-crossing events, stay in chronological order.

## 4. Filters

Current filters:

- Upcoming
- Past
- All

Filter behavior:

- The default filter is Upcoming.
- Filtering happens in place and does not reload the page.
- Filters do not currently write to the URL.
- Buttons are real `button` elements.
- Active state uses `aria-pressed`.
- The event count updates in a polite live region.
- The live Next event board renders the eight Discord/Reaper-managed schedule event types from `apps/web/public/data/guild-schedule.json`.
- The live Next event board is a bounded scroll panel: filters and count stay visible, while the event-card results list scrolls internally.

## 5. Empty States

Empty states are short and built into `events.js` for Upcoming, Past, and All.

Keep empty states:

- Short and clear.
- Lightly Mōchirīī in tone.
- Free of forced rhyme.
- Sparse with Cupcake language.
- Free of "Where Winds Meet" in visible Events body copy.

## 6. Copy and Tone

Events copy should use page-specific vocabulary:

- hour
- gathering
- schedule
- run
- return
- RSVP
- notice

Keep labels plain:

- Upcoming
- Past
- All
- View Events
- Join Discord, if used

Avoid duplicating:

- Recruitment philosophy
- Join checklist
- Tome rules
- Gallery memory language

## 7. Links and RSVP

Current link behavior:

- `featured.href` renders as an external featured-event link when present.
- `featured.linkLabel` controls the featured-event link text; if absent, the renderer uses `Open details`.
- Event-board item `href` renders as an external details link when present.
- If an event-board item has no `href`, the renderer falls back to the Discord invite URL.
- Event-board link text is currently `Open details`.
- The Participation card includes static links for Discord RSVP and How to join.
- External rendered links use `target="_blank"` and `rel="noopener noreferrer"`.

Do not add unsupported link fields without updating and validating the renderer in a separate scoped task.

## 8. Accessibility

- Event filters use real buttons.
- Active filter state uses `aria-pressed`.
- Focus states must remain visible.
- Filter controls should remain keyboard reachable.
- Touch targets should remain usable on mobile.
- The event count and event board use polite live regions.
- The event-card results list is keyboard focusable so keyboard users can scroll the bounded panel without a trap.
- Empty states should be readable.
- Mobile layouts should not create horizontal overflow.

## 9. Validation

Run:

```sh
npm run check
npm run check:events-page-schedule-sync
npm run check:guild-schedule
npm run check:discord-event-covers
git diff --check
node scripts/check-json.mjs
node scripts/check-js.mjs
node scripts/check-refs.mjs
node scripts/check-assets.mjs
npm run check:production
```

Use `npm run smoke:gallery` only as a general regression check when relevant to the repo baseline.

## 10. Manual Events Smoke Checklist

- Open `/events.html`.
- Confirm the Upcoming filter works.
- Confirm the Past filter works.
- Confirm the All filter works.
- Confirm empty states render when applicable.
- Confirm date order is correct.
- Confirm no date shifts one day earlier in US time zones.
- Confirm links work.
- Confirm filters are keyboard reachable.
- Confirm `aria-pressed` updates.
- Check mobile widths at 360px, 390px, and 768px for horizontal overflow.
- Confirm there are no console-breaking errors.

## 11. Protected Content

Events work must not alter:

- `apps/web/public/data/recruitment.json` `content.paragraphs`
- `apps/web/public/data/recruitment.json` `content.conclusion`
- `apps/web/public/data/home.json` `seal.verse`
