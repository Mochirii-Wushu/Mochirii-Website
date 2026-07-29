# Repository Source Ownership Matrix

Date: 2026-07-29

Status: target architecture. Current ownership remains unchanged until each
approved cutover and rollback window completes.

| Source or capability | Current owner | Target owner | Retirement rule |
| --- | --- | --- | --- |
| `apps/web/**` and public Website data/assets | Website | Website | Never move as part of repository separation. |
| `apps/shopify-theme/**` | Website | Website | Shopify publication remains separately gated. |
| `supabase/migrations/**`, database tests, RLS, schedules, shared tables/RPCs, generated shared types | Website | Website | One schema authority; consumers use versioned contracts. |
| Guild membership and shared authorization functions | Website | Website | Provider login never replaces server-side guild authorization. |
| Gallery ingest and approved-media contracts | Website | Website | Reaper and Social consume the contract; neither owns the schema. |
| Spinner draw, live-session, media-producer, and Website read contracts | Website | Website | Dispatcher behavior may move; immutable draw evidence never moves or rewrites. |
| `services/social/**` | Website | Social | Remove from Website only after filtered history, target CI, runtime cutover, and rollback observation pass. |
| Social validation, image publication, production/recovery/host-verification workflows | Website | Social | Adapt to target root; retire Website copies after target workflow parity. |
| Social npm/composer/Docker/Compose Dependabot entries | Website | Social | Replace with target-root entries; remove Website entries after target activation. |
| Website `/social`, OAuth consent/decision routes, membership and `social_accounts` integration | Website | Website | Retain as the first-party identity doorway and shared contract owner. |
| `reaper-discord-interactions` | Website | Reaper | Keep Website rollback bundle until the observation window ends. |
| `reaper-discord-member-sync` | Website | Reaper | Preserve endpoint and `verify_jwt=false`; move execution only. |
| `reaper-spinner-dispatch` | Website | Reaper | Consume the versioned Website spinner contract. |
| `send-vote-reminder` | Website | Reaper | Preserve manual confirmation and idempotency boundaries. |
| `send-member-spotlight-poll` | Website | Reaper | Preserve Website-owned tables and schedules. |
| `publish-member-spotlight-winner` | Website | Reaper | Keep `get-current-spotlight-winner` in Website. |
| Bot-only Discord helpers, command registration, bot tests and runbooks | Website and Reaper | Reaper | Split mixed helpers; do not duplicate active implementations. |
| Reaper Gateway-worker source | Reaper | Reaper | Hosted worker/supervisor state remains unverified; remove any accepted obsolete fallback only after the Edge rollback window. |
| Mobile client source and app configuration | Mobile | Mobile | No Social server, Website, Unity source, or provider secrets. |
| Unity `Assets`, `Packages`, `ProjectSettings`, `.meta` files and build definitions | Pets | Pets | Website/Mobile consume immutable artifacts only; no copied source or submodule. |
| Forum governance, supported upstream locks, no-secret templates, theme/plugin adapters and runbooks | None | Forums | Clean initialization; never import Website history or vendor upstream core. |
| Archived raffle-spinner source | Archived spinner | Archived spinner | Historical only; never restore as a production owner. |

## Operational ownership by repository

`Current` describes the production authority before a reviewed cutover. A
target repository is not a second deployment owner merely because candidate
source exists there. Provider fields marked `unverified` require a fresh,
read-only provider readback at the exact release head.

| Repository | Source and consumers | Hosted runtime | Delivery authority | Data and migration authority | Secret destination | Contracts | Release, rollback, retention, and backup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Website | Produces the Website, storefront, shared backend, identity, Gallery, schedule, spinner, Spotlight, and vote contracts; consumed by every other active repository. | Vercel Website and shared Supabase project; Shopify remains unpublished. | Protected Website `main` through the existing Vercel and Supabase Git integrations; Shopify publication is a separate approval. | Sole owner of shared Supabase migrations, RLS, schedules, tables, RPCs, generated types, and database tests. | Vercel server-only or public-safe variables as classified; Supabase Edge secrets/Vault for privileged values; Shopify/provider stores for their own credentials. | Website session/entitlement, Gallery, schedule, spinner, Spotlight, vote, Pets launch ticket, and future forum identity. | Bind every release to reviewed Git SHA and provider artifact; restore the recorded Vercel deployment or forward-fix migrations. Retain immutable raffle/Gallery/member evidence and provider backups under their runbooks. Current provider state is `unverified` unless a dated readback says otherwise. |
| Social | Current source owner: Website `services/social`; target source owner and future workflow owner: Social. Website and Mobile consume its OAuth/API/media behavior. | Current DigitalOcean host, private GHCR image, and Spaces media. | Current Website workflows; target Social workflows only after history, CI, image parity, protected-environment or accepted compensating controls, and runtime cutover pass. | Social-owned MariaDB migrations and runtime data; no shared-Supabase migration ownership. | GitHub protected environment and root-owned host environment files; never Mobile, Website browser code, or repository files. | Social OAuth callback/account sync, private API/media behavior, health, backup, and recovery contracts. | Restore the previous immutable image on application failure. Encrypted application-consistent backups and an isolated restore proof are required before ownership cutover. Current provider/backup state is `unverified` without exact readback. |
| Reaper | Owns Gateway-worker and bot-helper source; target also owns exactly six bot-only Edge Function implementations. Consumes Website data and event contracts. | Website-owned Supabase Edge Functions are current production authority; whether a separate Gateway worker is hosted and supervised is `unverified`. | Repository CI only for the additive candidate. Future deployment must be allowlisted to six exact function names and must prove the Website integration cannot prune them. | No schema or migration authority; shared Supabase remains Website-owned. | Supabase Edge secrets/Vault and a protected Reaper runtime environment; never repository, browser, or Discord message content. | Discord command manifest, member synchronization, schedule, Gallery submission, spinner dispatch, Spotlight, and vote workflows. | Keep the Website rollback bundle through observation; restore only the six allowlisted functions if cutover fails. Preserve immutable draw and audit evidence. Runtime/provider state is `unverified` without exact readback. |
| Mobile | Owns only the first-party iOS client and direct support files; consumes Social OAuth/API and future Pets iOS artifacts. | Installed iOS application; no Mochirii server runtime. | Repository CI now; future signed archive/TestFlight/App Store delivery requires a separate Apple/EAS packet and physical-device evidence. | No database or migration authority and no direct Supabase access. | Device Keychain/SecureStore for member tokens; Apple/provider secrets only in approved provider stores and protected CI environments. | Authorization Code with PKCE, exact Social origin/redirect, private-media behavior, account deletion, and future Pets host contract. | Roll back to the last accepted signed build. Retain source, lockfiles, privacy manifest, archive checksums, signing/notarization evidence, and App Store records under the mobile release packet. Provider state is `unverified` pending approved readback. |
| Pets | Owns Unity source, settings, packages, tests, and deterministic build definitions; Website and Mobile consume immutable artifacts only. | No active game runtime. Future Web and Unity-as-a-Library iOS artifacts remain approval-gated. | Repository CI only until exact-editor, license, artifact, Website, iOS, and provider release packets pass. | No shared database authority. Any future persistence uses versioned Website-owned contracts rather than direct schema ownership. | No production secret in Unity source or artifacts; provider/signing values stay in approved secret stores. | Artifact manifest, dependency manifest/SBOM, Website launch ticket, iOS host bridge, and local-host-independence contract. | Roll back by selecting the prior immutable artifact manifest. Retain commit, Unity version, dependency lock, build report, checksums, provenance, and compatibility results. No artifact is currently accepted for production. |
| Forums | Target owner of forum governance, supported upstream locks, adapters, and runbooks; consumes future Website central identity. | None. A supported Discourse runtime, host, mail, storage, and DNS remain separately gated. | Governance validation only. No deployment workflow or provider authority exists. | No active database. A future supported Discourse deployment owns only its application data and never shared Supabase migrations. | Future host/provider secret store only; source contains names/templates, never values. | Signed nonce-bound central identity, current guild entitlement, moderation separation, health, backup, and restore. | Source commits are the only current rollback. Before access, require immutable upstream/plugin/theme locks, application-consistent backup, isolated restore proof, retention policy, monitoring, incident response, and approved recurring cost. |

## Reaper shared-helper split

- Keep Website read-side logic from `_shared/spotlight-polls.ts` and
  `_shared/vote-reminders.ts`; move Discord/provider execution to Reaper.
- Keep `_shared/spinner-live.ts`, `_shared/spinner-media.ts`, and Website
  producer/render tests. Move dispatcher-only validation to Reaper and consume
  a versioned contract fixture or generated definition.
- Keep generic CORS, project configuration, service-role boundaries, and
  schema tests in Website. Reaper may depend on a small versioned package or
  generated contract but must not copy shared source silently.

## Repository relationship updates

Relationship documents change only after the corresponding target has a real
accepted `main`:

- Website points to Social for Social runtime source and to Reaper for bot
  execution while retaining shared backend ownership.
- Social, Mobile, Reaper, Pets, and Forums point to Website for shared identity
  and backend contracts.
- Mobile points to Social for member social APIs and to Pets only for reviewed
  immutable Unity-as-a-Library artifacts.
- Forums remains source-only until its identity, cost, provider, backup,
  restore, moderation, and public-copy gates pass.
