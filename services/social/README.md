# Mochirii Social Ops

No-secret source and operations notes for `social.mochirii.com`.

Mochirii Social is the guild social platform. It runs outside the public
website runtime because it needs persistent application services, database,
cache/queue workers, scheduler, media storage, backups, and monitoring.

## Repository Workspace

The canonical source is `services/social` in `Mochirii-Wushu/Mochirii-Website`.
Production deploys use protected GitHub workflows and the existing private GHCR
package; the workstation is not a runtime dependency.

## Boundaries

- `mochirii.com`: public guild website on Vercel.
- `social.mochirii.com`: guild social platform on the DigitalOcean Droplet.
- DigitalOcean Spaces: required primary media storage before broad member
  uploads.
- Supabase: identity, OAuth, membership, and `social_accounts` authority.
- Discord: guild verification source, not the social account authority.
- Cloudflare: DNS/TLS/proxy rules only unless a separate rule change is
  approved.

## Current Launch Posture

- Admin-first staging on the final hostname.
- Closed registration.
- SSO-only login through Supabase OAuth.
- Federation disabled until a separate fediverse activation packet passes.
- Broad member uploads wait for Spaces media storage, exact-origin CORS,
  image-safety validation, backup/restore evidence, and moderation gates.

## Source Control Rules

- Keep operational secrets out of the public source repository.
- Do not commit host `.env` files, OAuth secrets, database dumps, Redis data,
  uploaded media, backups, cache files, host-private notes, or credential
  digests.
- Review upstream software in an isolated temporary clone. Pushes go only to
  the canonical Mochirii origin.
- Track Mochirii-owned branding/theme/source changes here before editing the
  Droplet runtime.

## Local Checks

```sh
npm run check:mochirii-ops
```

This verifies the repository posture, required ops docs, upstream snapshot
policy, sync documentation, media readiness notes, and federation gate docs.

## Required Runbooks

- [`docs/mochirii-social-sync.md`](docs/mochirii-social-sync.md)
- [`docs/upstream-sync-policy.md`](docs/upstream-sync-policy.md)
- [`docs/media-spaces-readiness.md`](docs/media-spaces-readiness.md)
- [`docs/private-media-authentication.md`](docs/private-media-authentication.md)
- [`docs/fediverse-activation-runbook.md`](docs/fediverse-activation-runbook.md)

## First-Admin Login Gate

First-admin login is complete only when:

1. Supabase OAuth consent returns to the social callback.
2. The local social user is created or linked.
3. The trusted sync bridge writes one active `social_accounts` row.
4. The account has admin access where approved.
5. Public root/login pages remain Mochirii-branded.
6. Registration remains closed and federation remains disabled.

## License

This repository contains Mochirii operations work plus upstream application
source under its original license. Preserve upstream license notices and keep
Mochirii operational secrets out of Git.
