# Mōchirīī website

Public guild pages and member tools for [Mōchirīī](https://mochirii.com),
built with Next.js, React, and TypeScript. Members can start with the
[joining guide](https://mochirii.com/join); the instructions below are for
contributors working on the website.

## Features

- Public guild pages: Home, Join, Recruitment, Tome, Ranks, Leaders, Twills,
  Events, Announcements, Gallery, Raffle, Spotlight, and music.
- Member sign-in, account settings, guild verification, and gallery submissions.
- Leader moderation, separate Instagram sharing consent, and private live draws.
- Sign-in handoffs for Mochirii Social and the separately gated Forums connection.
- A public Mochi Pets concept page with an optional protected tester doorway.
  No playable game is connected.

The full page and endpoint inventory is
[app-route-matrix.v1.json](config/app-route-matrix.v1.json).

## Development

Use Node.js 22.23.1 and npm 10. From the repository root:

~~~sh
cd apps/web
npm ci
npm run toolchain:check
npm run dev
~~~

Open the address printed by the development server. Use
[.env.example](.env.example) for configuration names. Public configuration may
include `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
and `NEXT_PUBLIC_SITE_URL`; privileged credentials must remain server-only.

## Validation

Run from this directory:

~~~sh
npm run toolchain:check
npm run lint
npm run build
~~~

Run `npm run check` and `git diff --check` from the repository root, plus
the checks appropriate to the changed feature. `npm run verify:local`
also checks client, font, and route-style bundle budgets.

## Content and access

- `public/assets` and `public/data` are the only editable website media
  and content sources. Do not recreate the retired root static site.
- Preserve protected guild copy and the Mōchirīī/Mōchī display forms. Read the
  [content guide](../../docs/content-guide.md) and route-specific guides.
- Gallery grids use thumbnails; the image viewer opens full images.
- Gallery approval does not publish to Instagram. Sharing requires explicit
  opt-in and a separate moderator decision.
- Website member directories are retired; member social profiles belong to
  Mochirii Social. Shared identity data remains intact.
- Private live draws separate member viewing from moderator controls and
  recheck access on the server.
- The Mochi Pets doorway requires fresh member verification and a separate
  tester passcode when enabled. Its cookie never authorizes a game build.
- Preserve `public/assets/audio/mochiriiiiii.mp3` exactly. Compression,
  replacement, deletion, or other optimization requires explicit approval.

## Security Headers

Production CSP is enforced through `Content-Security-Policy` in
`next.config.ts`. Keep Cloudflare DNS-only for the website’s web records.
New embeds or external origins need a scoped security review. The security
contact is published at `public/.well-known/security.txt`.

## Vercel Observability

The root layout includes `@vercel/analytics` and
`@vercel/speed-insights`. After an approved release, check for
`script[data-sdkn="@vercel/analytics/next"]` and
`script[data-sdkn="@vercel/speed-insights/next"]` after hydration.
The private spinner excludes analytics and performance telemetry.

## Further reading

- [Release and rollback guide](../../docs/operations/deployment.md)
- [Gallery guide](../../docs/gallery-guide.md)
- [Member moderation](../../docs/member-gallery-moderation-runbook.md)
- [Private live spinner](../../docs/operations/private-spinner.md)
- [Mochi Pets plans](../../docs/mochi-pets-future-project.md)
- [Forums sign-in contract](../../docs/integrations/mochirii-forums-discourse-connect.md)
- [Contributing](../../CONTRIBUTING.md) and [security](../../SECURITY.md)

The former static release is historical reference, not a live hosting or
authentication fallback.
