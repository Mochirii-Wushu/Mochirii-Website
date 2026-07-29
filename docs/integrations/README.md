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

The proposed [cross-repository contract registry](cross-repository-contract-registry.v1.json)
and its [JSON schema](cross-repository-contract-registry.v1.schema.json) provide
reviewable, no-secret evidence for future repository boundaries. They do not
activate a cutover or delegate shared Supabase ownership: Website remains the
sole source and deployer for the shared project, while Reaper consumes the
published contracts.
