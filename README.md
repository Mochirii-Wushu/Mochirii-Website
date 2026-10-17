# Mōchirīī

The website and member tools for Mōchirīī, an Asia-Pacific guild for casual
Where Winds Meet players. It brings together guild information, events,
screenshots, member accounts, and the Mochirii Cosmetics storefront theme.

[Visit Mōchirīī](https://mochirii.com)

## What’s here

- Guild information, recruitment, ranks, leaders, the Tome, announcements,
  events, music, and member spotlights.
- A public gallery with curated images and approved member submissions.
- Member sign-in, account settings, guild verification, and image submissions.
- Leader tools for moderation, consent-based Instagram sharing, and private
  live raffle draws.
- The Mochirii Cosmetics storefront theme and its reviewed customer copy.
- Shared identity, permissions, database migrations, and community automation.

Mochi Pets currently has a concept page and an optional protected tester
doorway; no playable game is connected. Its game source belongs to
[Mochirii Pets](https://github.com/Mochirii-Wushu/Mochirii-Pets).
[Mochirii Social](https://github.com/Mochirii-Wushu/Mochirii-Social) owns the
social application; this repository keeps the website’s sign-in and account
connections to it.

## Start here

New to the guild? Read the [joining guide](https://mochirii.com/join).
To contribute, choose the relevant guide below.

- [Website app](apps/web/README.md): pages, member features, and development.
- [Storefront theme](apps/shopify-theme/README.md): theme files and checks.
- [Shared backend](supabase/README.md): data, access rules, and integrations.
- [Architecture](docs/architecture.md) and
  [repository ownership](docs/operations/repository-ownership.md).
- [Content guide](docs/content-guide.md): editing guild copy and media.

Website content and media live only in `apps/web/public/data` and
`apps/web/public/assets`. The former static site is retained in the
`legacy-static-final-2026-07-18` release for historical reference.

## Development

Use Node.js 22.23.1 and npm 10, then run from the repository root:

~~~sh
npm ci
npm run toolchain:check
npm run check
~~~

To start the website:

~~~sh
cd apps/web
npm ci
npm run dev
~~~

Follow each component’s README for its build and test commands. Read
[CONTRIBUTING.md](CONTRIBUTING.md) and the applicable
[repository guidance](AGENTS.md) before making a focused change.

## Releases and safety

Website and backend releases follow the protected-branch delivery process.
Storefront publication, database changes, secret changes, and live service
changes require their own approved release steps. See the
[release guide](docs/operations/deployment.md).

Never commit credentials, private member data, supplier records, or generated
release evidence. Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Rights

This repository is public for collaboration and visibility, but is not offered
under an open-source license. See [COPYRIGHT.md](COPYRIGHT.md) and
[NOTICE.md](NOTICE.md). Preserve third-party licenses and attribution.
