# Hosted Integrations

This directory documents the no-secret contracts that connect the canonical
repository to hosted providers. It may record project names, regions, expected
environment-variable names, callback paths, deployment ownership, and rollback
procedures. It must never contain credential values, cookies, signed URLs,
private keys, customer data, supplier costs, or private formula evidence.

## Ownership

- Website delivery: Vercel Git integration from protected `main`.
- Backend delivery: Supabase migrations and Edge Functions from protected
  `main`.
- Storefront delivery: Shopify theme source under `apps/shopify-theme`; theme
  publishing remains an explicit release action.
- Social delivery: GitHub Actions publishes a private immutable GHCR image;
  the restricted production workflow deploys that digest to the Droplet.
- Edge and DNS: Cloudflare settings remain provider-managed and evidence-gated.
- Community automation: Discord interactions are served by hosted Edge
  Functions, never a workstation process.

Operational steps and dated evidence belong in `docs/operations`.

## Exposure Catalog

[`integration-exposure-catalog.v1.json`](integration-exposure-catalog.v1.json)
is the machine-readable, no-secret source catalog for active or
activation-gated integrations and every Edge Function declared in
`supabase/config.toml`. Each record names its destinations, data classes,
authorization boundary, accountable operating role, disable control, runbook,
verification profile, and source evidence.

The catalog records repository declarations only. Provider deployment state,
versions, settings, schedules, credentials, health, and usage always remain
`runtime_readback_required`; a green repository check must never be described
as a provider readback. Validate the catalog after any integration, function,
JWT, destination, or runbook change:

```powershell
npm run check:integration-exposure-catalog
```

The check fails unless the catalog matches all 33 configured functions and the
reviewed `20 verify_jwt=true / 13 false` split. A false gateway setting is not
synonymous with anonymous access: the catalog must resolve it to either a
bounded public projection or an explicit in-handler caller boundary.

See [Hosted runtime ownership](hosted-runtime.json) and
[the host-independence runbook](../operations/HOST-INDEPENDENCE.md) for the
machine-checked offline-workstation boundary and its remaining readbacks.

See [Mochirii Social delivery](mochirii-social-delivery.md) for the private
container, protected environment, deployment, and recovery contract.
