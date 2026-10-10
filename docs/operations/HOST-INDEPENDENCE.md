# Hosted Runtime Independence

The customer Website, password-protected storefront, hosted backend, and public
Social and Forums Coming Soon shells are hosted independently of the development
workstation. The Social and Forums origins currently serve reviewed immutable
static artifacts on Vercel. Their availability does not establish the health of
either underlying application, authenticated flow, or recovery system. Those
applications retain their separate repository ownership.
The Mochi Pets tester doorway and waiting room are served by the Vercel-hosted
Website and have no game runtime dependency. Its password and independent
session secret are the only two doorway-specific values and remain server-only
in the Vercel runtime environment; missing values fail closed, and production
route/config source rejects loopback, private-network, file, or workstation
destinations. Codex, Chrome, local worktrees, Docker
Desktop, local CLIs, and the private credential boundary are development or
administration tools only.

The machine-readable contract is
[`docs/integrations/hosted-runtime.json`](../integrations/hosted-runtime.json).
`npm run check:host-independence` rejects self-hosted Actions runners,
workstation paths, credential-boundary names, file URLs, and unreviewed
loopback destinations in production surfaces. The stricter
`npm run gate:host-independence` also requires every operational readback to be
verified.

The GitHub-hosted weekly production check runs
`npm run check:hosted-public-boundaries` without private credentials. Public
checks must match the current surface contract. A passing public check proves
only the declared reachability and fail-closed behavior; it does not replace
provider backups, restore drills, internal process health, or an offline
workstation observation.

## Remaining readbacks

- Record the Reaper Gateway worker's hosted provider class, source revision,
  supervisor, boot policy, and health signal. Do not record a host address,
  token, private ID, or process output.
- Verify the Social backup timer, newest encrypted recovery object, and one
  isolated `validate-only` restore through the protected recovery workflow.
- The Supabase readback on 2026-07-24 is historical evidence of two spotlight
  schedules and their then-successful latest executions. Preserve that record;
  use the dated inventory in [Reaper hosted maintenance](reaper-hosted-maintenance.md)
  for the current observed schedules. The vote reminder remains inactive.

The two operational readbacks remain pending, and complete auxiliary continuity
is not certified. The active local Facebook maintenance heartbeat is an
additional workstation dependency described in the maintenance runbook; it must
also be resolved before making a blanket maintenance-independence claim. The
Gateway source-only release status does not prove that an older workstation
process is absent. If one is found, move it to an approved supervised hosted
runtime or intentionally retire the welcome-DM feature before setting the
contract to complete.

## Primary operational guidance

- [GitHub-hosted Actions runners](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
- [Vercel Git deployments](https://vercel.com/docs/git)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions) and [Cron](https://supabase.com/docs/guides/cron)
- [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/)
- [DigitalOcean Droplet backups](https://docs.digitalocean.com/products/backups/) and [Spaces](https://docs.digitalocean.com/products/spaces/)
- [Fly.io autostop and autostart](https://fly.io/docs/launch/autostop-autostart/)
- [Shopify platform performance](https://shopify.dev/docs/storefronts/themes/best-practices/performance/platform)
- [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding)
