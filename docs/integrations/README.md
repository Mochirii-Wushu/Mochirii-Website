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

See [Hosted runtime ownership](hosted-runtime.json) and
[the host-independence runbook](../operations/HOST-INDEPENDENCE.md) for the
machine-checked offline-workstation boundary and its remaining readbacks.

See [Mochirii Social delivery](mochirii-social-delivery.md) for the private
container, protected environment, deployment, and recovery contract.

See [Gallery public media delivery](gallery-public-media-delivery.md) for the
versioned thumbnail-only list, opaque-ID original resolution, keyset snapshot,
and private Storage boundary.
