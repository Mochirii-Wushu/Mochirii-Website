# Pixelfed Staging Ops Runbook

> **Historical and superseded - do not execute.** This document is retained
> only as migration history. Current Social operations are owned exclusively by
> `Mochirii-Wushu/Mochirii-Social`.

Status: staging operations packet. Provider mutations remain approval-gated.

This runbook captures the no-secret operational shape for `social.mochirii.com`
until the social runtime has a Mochirii-owned private fork or ops repository. Do
not add OAuth secrets, `.env` files, database dumps, Redis state, media files,
backup archives, host IPs, raw logs, cookies, or private account identifiers to
this public website repo.

## Current Staging State

- Staging target: `social.mochirii.com`.
- Runtime host: DigitalOcean Droplet in the Mochirii Social project.
- Runtime stack: Pixelfed PHP/Laravel app, MariaDB, Redis, Horizon queue worker,
  scheduler, and Docker Compose.
- Media target before broad uploads: a dedicated DigitalOcean Space with
  exact-origin CORS for `https://social.mochirii.com`, separate backup storage,
  and credentials stored only on the host and local credential vault.
- Public launch posture: closed registration, SSO-only, admin-first testing,
  federation disabled, public discovery minimized.
- Website production host: Vercel `apps/web`; Pixelfed stays outside Vercel.
- Durable source status: a Mochirii branding commit exists on the staging host,
  but the visible Git remote still points at upstream `pixelfed/pixelfed`.

The next source-control gate is to create or connect a Mochirii-owned private
Pixelfed fork or ops repo, then push the staging branding commit there before
any further runtime edits.

## Required Approval

Use this exact prompt before creating the private repo or pushing the staged
runtime source to GitHub:

```text
Approve creating a private GitHub repository under Mochirii-Wushu named mochirii-pixelfed-ops for the Mochirii-controlled Pixelfed staging source and no-secret ops docs, then pushing the existing Droplet-local branding branch to it. No secrets, .env files, DB files, Redis data, media, backups, cache files, or host-private notes will be committed.
```

If the owner prefers a different repository name, use the exact owner-approved
name in the mutation prompt and PR notes.

## Git Hygiene

Before pushing staged runtime source:

- Confirm `git status --short --branch` on the Droplet.
- Confirm the target commit and remote URL.
- Review `.gitignore` and do not stage runtime-generated state.
- Exclude `.env`, OAuth client secrets, DB files, Redis data, media files,
  backups, cache files, logs, and host-private notes.
- Keep the private repo private.
- Pin the upstream Pixelfed commit or release used for staging.
- Document any local patch as a small, reviewable commit.

Tracked runtime files that are generated or host-specific should be reset or
excluded in the private fork only after confirming they are not part of the
Mochirii branding patch.

## Deploy And Rebuild

Run these from the staging host after source control is stable. Commands are
examples; inspect the actual private ops repo before use.

```bash
cd /opt/pixelfed-staging/pixelfed
git status --short --branch
git fetch --all --prune
git checkout <approved-branch-or-tag>
docker compose pull
docker compose build pixelfed horizon scheduler
docker compose up -d
docker compose ps
```

Do not run migrations, rotate secrets, change OAuth client values, or alter
federation settings unless that exact mutation was approved.

## Cache Clear

Use after theme/config-only changes when the containers are healthy:

```bash
cd /opt/pixelfed-staging/pixelfed
docker compose exec pixelfed php artisan config:clear
docker compose exec pixelfed php artisan route:clear
docker compose exec pixelfed php artisan view:clear
docker compose exec pixelfed php artisan cache:clear
docker compose exec pixelfed php artisan config:cache
```

If a command exposes secrets in output, stop and redact the private packet
outside this repo.

## Health Checks

Minimum no-secret checks before first admin login:

- `docker compose ps` reports app, database, Redis, Horizon, and scheduler
  healthy or running as expected.
- Public root and login pages show only Mochirii-approved public branding.
- OIDC start redirects to Supabase OAuth with exact redirect URI and scopes.
- Supabase consent page returns to the social callback after approval.
- Successful OIDC callback calls the Supabase
  `sync-pixelfed-social-account` Edge Function and creates or updates one
  active `social_accounts` row.
- Queue worker and scheduler containers stay healthy after login.
- Disk usage leaves operational headroom.
- Backups are enabled and a restore note exists.

## Rollback

Rollback should be small and reversible:

1. Revert the private runtime commit or switch back to the last known-good tag.
2. Rebuild/restart containers.
3. Clear Pixelfed/Laravel caches.
4. Re-run the health checks.
5. If login is unsafe, disable the OAuth client or DNS only after explicit
   owner approval.

Do not delete accounts, media, database rows, object storage, or backups as part
of rollback unless a separate retention and backup decision is approved.

## Backup And Restore

Before broad member upload testing:

- Verify DigitalOcean Droplet backups are enabled.
- Move media to object storage such as DigitalOcean Spaces or Cloudflare R2 with
  least-privilege access keys and exact-origin CORS.
- DigitalOcean Spaces is the preferred media target for this project because
  the Droplet and Space live under the same DigitalOcean operational boundary.
  Use a dedicated media Space, not the backup Space, and do not commit Spaces
  keys or bucket names that are not already public.
- Keep media outside the public webroot when possible.
- Retain a private restore drill note covering database restore, media restore,
  app rebuild, and DNS/OAuth rollback.
- Keep object storage credentials only in the host secret store and local
  `C:\Github Repo's\Mochirii Website\Mochi Creds`, never in Git.

## Federation Gate

ActivityPub federation remains disabled until a separate moderation/federation
approval packet passes. That packet must cover server rules, report flow,
moderator roles, deletion-copy warnings, defederation/blocklist policy,
WebFinger/NodeInfo, remote follow/post delivery, and rollback.
