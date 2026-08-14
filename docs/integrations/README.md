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
- Social delivery is owned exclusively by `Mochirii-Wushu/Mochirii-Social`;
  Website retains only its doorway, OAuth, shared identity, and authorization
  integration contracts.
- Edge and DNS: Cloudflare settings remain provider-managed and evidence-gated.
- Community automation: Discord interactions are served by hosted Edge
  Functions, never a workstation process.

Operational steps and dated evidence belong in `docs/operations`.

See [Hosted runtime ownership](hosted-runtime.json) and
[the host-independence runbook](../operations/HOST-INDEPENDENCE.md) for the
machine-checked offline-workstation boundary and its remaining readbacks.
