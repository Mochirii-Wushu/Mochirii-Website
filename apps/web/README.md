# Mochirii Next.js App

This app is the only live and editable `mochirii.com` website source. The retired
root static site is preserved in GitHub release `legacy-static-final-2026-07-18`.

For the current production, fallback, Vercel dashboard checklist, and rollback guardrails, see [`../../docs/operations/deployment.md`](../../docs/operations/deployment.md).

## Local Development

```sh
cd apps/web
npm install
npm run dev
```

Open the local URL printed by Next.js.

## Build and Lint

```sh
cd apps/web
npm run lint
npm run build
```

Optional local cleanup scripts:

```sh
cd apps/web
npm run clean
npm run build:clean
npm run vercel:build:local
```

`npm run clean` removes only `.next` and `.vercel/output`; it does not remove `.vercel/project.json` or local env files. `npm run vercel:build:local` runs the same root command documented below: `vercel build --prod --cwd apps/web`.

## Vercel Setup

Set the Vercel project Root Directory to:

```text
apps/web
```

Dashboard settings remain manual. The website GitHub repository is currently public, so release decisions should use fresh Vercel/GitHub required checks rather than stale private-organization plan-limit statuses. If the owner later approves making the repository private again and Vercel Git checks are blocked, use owner-approved manual Vercel CLI production deploys after protected/admin merges. Run production deploys from the repository root while reading project IDs from `apps/web/.vercel/project.json`; the Vercel project already has `apps/web` configured as Root Directory, and running `vercel deploy` from inside `apps/web` can double-apply that path on current CLI versions.

The safest local workflow is to pull settings for the linked app, clean generated output, then run the Vercel build from the repository root with `--cwd apps/web`:

```sh
cd apps/web
vercel pull --environment=preview --yes
npm run clean
cd ../..
vercel build --prod --cwd apps/web
```

Root-level `vercel link --repo` was tested as a reversible monorepo-link cleanup path, but it prompts for confirmation before linking the repository to Vercel projects. Do not answer that prompt or relink the project without an operator present. Dashboard Root Directory remains the authoritative production/preview setting.

Do not commit `.vercel/`.

## Security Headers

`next.config.ts` owns app-level security headers for the Vercel surface. Keep Cloudflare DNS-only for Vercel web records; use Vercel's platform firewall/DDoS layer as the active edge protection.

Production CSP is enforced with `Content-Security-Policy`. It was promoted after a production browser pass found no report-only violations across Discord widgets, Spotify embeds, Supabase signed URLs, Vercel observability, auth, gallery, social handoff, and moderator surfaces. Any future third-party script, embed, image host, or API origin needs a scoped CSP review before launch. Keep nonce-based CSP tightening in a dedicated compatibility PR because Next.js nonce middleware makes pages dynamically rendered instead of static/prerendered.

The RFC 9116 security contact file is served from `public/.well-known/security.txt`.

## Vercel Observability

The app is wired for Vercel Web Analytics and Speed Insights from the root layout with the official Next.js packages:

- `@vercel/analytics`
- `@vercel/speed-insights`

These integrations do not require app secrets or `NEXT_PUBLIC_*` values. Keep Web Analytics and Speed Insights enabled in the canonical `mochirii/mochirii` Vercel project dashboard, then verify the deployed browser page loads the Vercel observability scripts after hydration.

```text
script[data-sdkn="@vercel/analytics/next"]
script[data-sdkn="@vercel/speed-insights/next"]
```

Vercel can serve those scripts from project-specific unique paths rather than the plain `/_vercel/...` endpoints.

Analytics and Core Web Vitals data can take a few minutes, and enough real production visits, to appear in the Vercel dashboard.

The account, OAuth consent, and leader-dashboard clients also record a local User Timing measure when Supabase Auth emits the initial session event and on later auth-state loads. The components do not start a second eager load before that event. Measure names contain only the fixed route, `load` phase, completion state, and one of five bounded duration buckets. The helper sends no network request, has no production collector, and records no member identifier; developers inspect it manually in browser performance tooling before changing those authenticated routes.

Supabase Auth uses cookie-based PKCE through `@supabase/ssr`. The allowlisted
`/auth/callback` exchanges OAuth codes server-side, and Proxy refreshes sessions
only for `/raffle/claim` and `/leader-dashboard/raffle`. Both private routes
authorize again in their request-scoped data-access boundary, return no-store
and noindex responses, and render no claim or administration controls while the
raffle foundation is disabled. `/raffle` remains cacheable and uses its existing
lazy authenticated APIs; it does not enter the cookie-refresh matcher.

Essential Account and leader-dashboard access reads run together. Optional submission,
Gallery, Instagram, and Social status reads settle afterward; the moderator spinner card
renders before its independent moderation queues complete. The live-spinner proxy
streams upstream responses through a 256 KiB byte ceiling, classifies expected access
denial separately from actual upstream failure, and exposes no member or draw identifier
in its bounded diagnostic record. Clients pause polling while hidden or offline and use
bounded jittered backoff after real synchronization failures.

Public guild wording comes from `lib/brand.ts`: `Mōchirīī` and `Mōchī` are the NFC
display forms. ASCII `Mochirii` is reserved for reviewed technical and commerce
boundaries and is enforced by the root `check:public-guild-brand` contract.

Production bundle validation reads each public route's client-reference manifest after `next build`. Every public entry is limited to 225 KiB Brotli, Gallery-only code must stay out of unrelated public entries, and Supabase Auth, PostgREST, and Realtime SDK markers must stay out of every public entry. Public routes import their route component directly so an unrelated page cannot pull the full public-page barrel into its client graph.

## Public Assets And Data

`public/assets/` and `public/data/` are the canonical tracked media and content
sources. Do not create root mirrors or reverse-sync scripts.

## Supabase Environment Variables

Phase 3 member workflows use only browser-safe public Supabase values in the Next app:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL
```

Do not print or commit secret values. Do not add service-role keys, Discord bot tokens, Instagram access tokens, OAuth client secrets, or other privileged credentials to browser code. Privileged verification, moderation, Instagram publishing, signed preview URLs, and audit behavior stay inside Supabase Edge Functions.

## Migrated Routes

Current Next routes:

- `/`
- `/join`
- `/ranks`
- `/leaders`
- `/tome`
- `/events`
- `/announcements`
- `/raffle`
- `/gallery`
- `/spotlight`
- `/spotify`
- `/recruitment`
- `/twills`
- `/auth`
- `/account`
- `/social`
- `/oauth/consent`
- `/gallery-submit`
- `/leader-dashboard`
- `/games/mochi-pets`
- `/spinner` (private, dynamic, and excluded from the ordinary site shell)

Legacy `.html` redirects for migrated pages are configured in `next.config.ts`.

## Mochi Pets Tester Doorway

`/games/mochi-pets` is a public, indexable Mochirii concept page. The protected
inner tester doorway is included only in builds that receive both complete
server-only tester settings; otherwise the page contains only its public
concept. When included, the doorway requires a freshly server-verified active
Website member plus the current passcode and uses one signed, member-bound,
server-only session cookie. It has no iframe, browser token bridge, game-data
call, or hosted game-runtime dependency. Keep `MOCHI_PETS_TESTER_PASSWORD` and
`MOCHI_PETS_TESTER_SESSION_SECRET` server-only.

## Private Live Spinner

`/spinner` is a dynamically authorized, no-store route. Signed-out, inactive,
unverified, expired, or otherwise ineligible requests receive the opaque local
404 before the authorized client stage is loaded. Active currently verified
guild members may enter an exact viewer session; the viewer has no roster or
draw controls and loads a separate lazy client bundle. Existing moderators may
enter an exact controller session from the authorized Leader Dashboard and
receive the roster, draw, receipt, import, export, replay, removal, and motion
controls.

The route intentionally omits the normal header, footer, background layer,
analytics, and performance telemetry. Eligible viewers instead receive a
session-first `Watch Spinner` link in the ordinary authenticated Account menu
and footer. The page uses only Mōchirīī product wording and same-origin network
destinations. See `../../docs/operations/private-spinner.md` for the live data,
delivery, privacy, release, and recovery contract.

## Current Visual Shell Standard

Shared `PageHero` routes should show their hero artwork as full-frame images in a stable `3 / 2` layout. The current standard is `object-fit: contain`, no crop, no tint/scrim/filter, and no intro-card overlap. Intro cards sit below the image with positive spacing while each page keeps its existing palette, glass styling, copy, image paths, metadata, and route behavior.

Visual-only shell releases should verify Home and all shared routes at `360`, `390`, `768`, `1024`, and `1440` pixel widths before PR approval.

## Migrated in Phase 1

- Next.js TypeScript App Router scaffold under `apps/web`.
- Existing `assets/` copied to `public/assets/`.
- Existing `data/` copied to `public/data/`.
- Existing `styles.css` copied into the Next app CSS surface; `app/mochirii.css` is now a compatibility aggregator while ordered global partials live under `app/styles/`.
- Mochi Pets project-page styles load from `app/games/mochi-pets/layout.tsx`; keep them out of the root layout so other routes do not receive route-only CSS.
- Shared header and footer converted to React components.
- Homepage converted from `index.html` and `home.js` DOM mutation to React rendering.
- Legacy `.html` redirects configured in `next.config.ts`.

## Migrated in Phase 2

- Public/static routes migrated into App Router pages:
  `/join`, `/ranks`, `/leaders`, `/tome`, `/events`, `/announcements`,
  `/raffle`, `/gallery`, `/spotlight`, `/spotify`, `/recruitment`, and `/twills`.
- `/raffle` is the sole canonical raffle page; retired rule URLs no longer exist.
- Route content continues to render from the copied JSON files in `public/data/`.
- Public client-side interactions migrated where needed: gallery filters/query links/lightbox, event filters, and Spotify filtering.
- Legacy `.html` redirects for migrated pages are verified in `next.config.ts`.

Phase 2 validation:

```sh
cd ../..
npm run check
npm run check:json
npm run check:refs
npm run check:production
git diff --check

cd apps/web
npm run lint
npm run build

cd ../..
vercel build --prod --cwd apps/web
```

## Migrated in Phase 3

- Deferred member workflow routes migrated into App Router pages: `/auth`, `/account`, `/gallery-submit`, and `/leader-dashboard`.
- Browser-safe Supabase helpers added under `lib/supabase/` for Auth session state, Discord OAuth, profile reads/updates, member upload submission, approved feed reads, moderation Edge Function invocations, the moderator-controlled Instagram publishing queue, and the public-safe monthly spotlight winner name.
- Member workflow React components added under `components/member-workflow/`.
- The header now shows member workflow links based on browser auth state, while protected pages still enforce access themselves.
- Root GitHub Pages auth/member/upload/moderation files remain untouched as rollback/reference material.
- Vercel settings, Discord settings, dashboard settings, and DNS remain unchanged by the Next UI. The Instagram queue migration and Supabase Edge Functions are deployed in production. The private Reaper source repo is `Mochirii-Wushu/Reaper-Discord-Bot`; direct Meta API secrets and any real Instagram API post remain external owner-approved steps. Current Instagram launch mode is moderator-controlled manual sharing from the Leader Dashboard.

What stays in Supabase:

- Identity, Postgres, RLS, Storage, Edge Functions, Discord verification, gallery moderation authority, signed preview URLs, and audit records.
- `verify-discord-member`, `list-approved-gallery-submissions`, `list-gallery-review-queue`, `moderate-gallery-submission`, `list-instagram-publish-queue`, `mark-instagram-gallery-submission-shared`, `check-instagram-api-status`, `publish-instagram-gallery-submission`, `send-member-spotlight-poll`, `publish-member-spotlight-winner`, and `get-current-spotlight-winner`.

## Monthly Spotlight Polls

Reaper posts one native Discord poll each month after `send-member-spotlight-poll` runs from Supabase Cron. Because Discord native polls allow up to 10 answers, the function snapshots up to 10 random active, recently verified, Discord-linked website members for that cycle. `publish-member-spotlight-winner` waits for finalized Discord poll results after 7 days and publishes the winner into Supabase. The public site calls `get-current-spotlight-winner` and may show only the winner name on Home and Spotlight; Discord handles, profile links, avatars, candidate lists, and vote counts stay private.

## Instagram Gallery Publishing

Website uploads include an optional Instagram opt-in checkbox. Reaper's Discord submissions send the matching `instagramOptIn` payload from the optional `share_to_instagram` command parameter.

Approval for the public Gallery never posts to Instagram automatically. If an approved submission has explicit opt-in consent, Supabase creates an Instagram publishing job. The Leader Dashboard shows that separate Instagram Queue, allows moderator caption and alt-text review, provides download/copy tools for manual posting, and requires a visible in-card confirmation before marking the job shared manually. The direct Meta API publish function remains disabled until the moderator-only Meta diagnostic passes after secure Supabase secret setup.

Instagram account IDs, tokens, API versions, and API base URLs stay in Supabase secrets only. They do not belong in Vercel env vars or any `NEXT_PUBLIC_*` value.

## Retired Member Profiles And Mōchirīī Social

The website `/members` and `/members/[slug]` product surface is retired. Those URLs should resolve through the normal missing-route behavior, with no redirect, while member social/profile activity moves to Mōchirīī Social at `https://social.mochirii.com`.

The Account page still lets a signed-in member edit safe profile fields, verify Discord membership, review gallery submission history, and open Mōchirīī Social. Discord handle is read-only and refreshed from Discord verification, not typed by the member. Bios allow up to 1,000 characters.

Shared backend identity data remains in Supabase until a separate Supabase dependency audit/migration is approved. Keep `member_profiles`, Discord verification, gallery/rank dependencies, and `social_accounts` intact during website cleanup work.

Discord guild titles come from fresh verified Discord role snapshots matched against vanity rank role IDs stored in `discord_resources` after Reaper `/sync-ranks` creates or adopts safe zero-permission roles. Vercel/Next never mutates Discord roles and never stores Discord bot tokens.

What Next/Vercel handles:

- Routing, React UI, metadata/noindex, legacy `.html` redirects, form state, client-side validation, file selection, and thin browser-safe Supabase integration.

Manual Supabase redirect URL checklist before authenticated preview testing:

```text
http://localhost:3000/**
https://mochirii.com/**
https://mochirii.vercel.app/**
Vercel preview URL pattern for the project/team
```

Route targets to verify:

```text
/auth
/account
/social
/oauth/consent
/gallery-submit
/leader-dashboard
```

Discord OAuth callback should remain:

```text
https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/callback
```

Phase 3 validation:

```sh
cd ../..
npm run check
npm run check:json
npm run check:refs
npm run check:production
git diff --check

cd apps/web
npm run lint
npm run build

cd ../..
vercel build --prod --cwd apps/web
```

Rollback uses the prior ready Vercel deployment. The archived static release is a
restorable historical artifact, not a live hosting or authentication fallback.

## Accepted or Deferred Warnings

- `assets/audio/mochiriiiiii.mp3` is intentionally over the static asset warning threshold. It is preserved exactly as-is because audio quality is preferred over file-size optimization. This is not a Vercel blocker. Do not compress, re-encode, replace, delete, externalize, or otherwise optimize this audio without explicit user approval.
- A local `vercel build --prod` can warn if `.next` exists. Run `npm run vercel:build:local` to clean local generated output first.
- The previous local `outputFileTracingRoot` / `turbopack.root` mismatch is fixed by matching `turbopack.root` to the `apps/web` project root used by `vercel build --prod --cwd apps/web`.
- Vercel Development env is intentionally skipped for now. Production and Preview envs are what matter for current deployed and PR-preview builds.

## Vercel Verification

```sh
cd apps/web
vercel whoami
vercel env ls production
vercel env ls preview
vercel env ls development
vercel pull --environment=preview --yes
```

Report env names only as present or missing. Do not print values.

## Live Domain And Fallback

The canonical production URL is:

```text
https://mochirii.com
```

`www` redirects to the apex:

```text
https://www.mochirii.com -> https://mochirii.com
```

The Vercel fallback/debug URL is:

```text
https://mochirii.vercel.app
```

Rollback/provider changes require explicit approval and the current deployment runbook. The former cutover packet is retained at [`../../docs/operations/history/dns-cutover-readiness-and-rollback.md`](../../docs/operations/history/dns-cutover-readiness-and-rollback.md) as historical evidence.

## Deferred

- Server-side Supabase SSR/cookie behavior unless a route proves it needs server-side auth.
- Backend/schema/RLS/Edge Function changes.
- Vercel dashboard automation.
- Restoring the archived static release as a live hosting surface.

The completed Phase 3 migration plan is archived at `docs/operations/history/next-phase-3-auth-member-workflow.md`.
