# Repository Ownership

This matrix is the durable boundary for Mochirii source, hosted integrations,
credentials, and operational evidence.

| Capability | Source owner | Hosted owner | Notes |
| --- | --- | --- | --- |
| Public website and routes | `Mochirii-Wushu/Mochirii-Website` `apps/web` | Vercel | `apps/web/public` is the only tracked website asset/data source. |
| Storefront theme | `Mochirii-Wushu/Mochirii-Website` `apps/shopify-theme` | Shopify | Theme publication and shared store-record writes remain separately gated. |
| Shared backend | `Mochirii-Wushu/Mochirii-Website` `supabase` | Supabase | Secrets remain runtime-only; schema changes are migration based. |
| Guild social | `Mochirii-Wushu/Mochirii-Social` | DigitalOcean and Spaces | The Social repository exclusively owns application source, image publication, deployment, verification, backup validation, and recovery. Website owns only its doorway, OAuth, shared identity, and authorization contracts. Federation remains disabled. Runtime state is never committed. |
| Mochi Pets concept and tester doorway | `Mochirii-Wushu/Mochirii-Website` `apps/web` | Vercel | Owns the public `/games/mochi-pets` concept page and its protected member-plus-passcode doorway. The member-bound Website cookie never authorizes a game runtime; the disconnected connection contract stays internal. |
| Mochi Pets game source | `Mochirii-Wushu/Mochirii-Pets` | None; source only | Fresh Unity owner for future Web and iOS artifacts. No prototype history, runtime, backend, or playable build is connected. |
| Mochi Pets mobile host and chat | `Mochirii-Wushu/Mochirii-Social-Mobile` | Future iOS app | Owns Social OAuth, native chat, navigation, and the future full-screen Unity host; consumes an immutable iOS export rather than Unity source. |
| Local credentials and supplier evidence | No Git repository | `Mochi Creds` and protected provider secret stores | Never committed, logged, copied into artifacts, or exposed to browser code. |
| Durable runbooks | `docs/operations` | GitHub | Markdown only; no secret values or signed URLs. |
| Generated evidence | `.artifacts/operations` | Local ignored storage | Screenshots, logs, JSON readbacks, and rollback exports stay untracked. |

## Public Branding Boundary

Customer and guild-leader surfaces use Mochirii branding and product language.
Infrastructure and supplier names belong only in dependencies, internal code,
CI, required license attribution, and no-secret integration or operations
documentation. Supplier identities, costs, formula evidence, design identifiers,
and mockup source records stay under `Mochi Creds/Shopify`.

Required upstream framework names and license notices remain unchanged. A brand
boundary is not permission to remove open-source attribution.

## Change Rules

1. Start each repository phase with `git status --short --branch` and preserve
   existing work.
2. Use one focused branch and protected pull request per independently
   deployable change.
3. Keep hosted deployments immutable and traceable to a reviewed commit and,
   for Social, an exact image digest and SBOM.
4. Store provider values in protected environments and runtime secret stores;
   docs list names and destinations only.
5. Keep game-source and provider changes in their owning repositories and
   approval packets; Website may consume only reviewed immutable game artifacts.
