# Mōchirīī Source and Evidence Ledger

## Purpose

This public-safe ledger identifies the authoritative source, runtime writer,
credential boundary, and evidence required for every current Mōchirīī surface.
It contains no credential values, provider exports, member data, signed URLs,
supplier evidence, or mutable access details.

Repository source describes intended behavior. A clean branch or green check
does not prove a hosted release. Provider dashboards/API readbacks, direct
domain behavior, and immutable deployment metadata are separate evidence.

## Truth levels

| Level | Proves | Does not prove |
| --- | --- | --- |
| Source | Intended code/configuration at one commit | CI, preview, deployment, or current provider settings |
| Local verification | Reproducible behavior in an isolated environment | Hosted data, secrets, network edge, or publication |
| GitHub/CI | Reviewed exact head and required checks | Final provider source binding or runtime health |
| Provider preview | Provider build/configuration against a PR head | Protected-main production acceptance |
| Production metadata | Deployment identity, status, version, migration/function inventory | Customer-path behavior by itself |
| Direct-domain/runtime | Actual routes, headers, accessibility, requests, and service health | Source provenance unless bound to deployment metadata |
| Human/legal review | Physical media, copy, compliance, policy, or business approval | Automated implementation correctness |

## Source and writer matrix

| System | Authoritative source | Approved writer | Runtime evidence | Credential/recovery boundary | Disabled or rollback control |
| --- | --- | --- | --- | --- | --- |
| Website | `apps/web` | Vercel Git integration from protected `main` | Exact deployment/Git SHA, route/browser/runtime checks, logs and Speed Insights | Vercel server variables; private recovery copy outside Git | Restore recorded prior deployment; protected routes fail closed |
| Supabase database | Timestamped `supabase/migrations` | Connected protected-main integration | Applied migration list, pgTAP/lint/advisors, aggregate readbacks | Supabase secrets/Vault; never browser or docs | Additive rollback/fix migration; never rewrite/delete immutable evidence |
| Supabase functions | `supabase/config.toml` plus function-local source/locks | Connected protected-main integration | Exact name/version/status inventory, JWT split, CORS/auth/fail-closed smoke | Function secrets/Vault | Function-local feature switches and prior reviewed source; no manual deploy unless explicitly approved |
| Gallery public media | Gallery migrations/functions plus Website client | Same protected-main integrations; historical rows need separate human/operator packet | Private-ledger/source/publication/object parity, browser request order, egress | Private Supabase bucket/service boundary | Atomic feed failure; static Gallery remains; preserve originals/revisions |
| Shopify theme | `apps/shopify-theme` | Separately approved Shopify theme operator | Package commit/tree/digest, draft theme readback, route/commerce/accessibility matrix | Shopify provider; private product/pricing ledgers | Unpublished candidate, password, disabled checkout, theme backup |
| Social application | `services/social` | GitHub publishes immutable GHCR; separately approved DigitalOcean workflow deploys digest | Image digest/SBOM/provenance, host/container/Caddy/OAuth/media/backup checks | Host/provider secrets and private recovery boundary | Restore prior immutable digest/config backup; registration and ActivityPub remain disabled |
| Social media | Private Spaces-backed objects through Social policy | Social server only | Anonymous denial, authorized short-lived application delivery, lifecycle/backup readback | DigitalOcean Spaces and encrypted recovery | Deny at application, private bucket, prior object backup |
| Cloudflare/DNS | Provider configuration plus documented expected boundary | Separately approved provider packet | DNS/proxy/TLS/cache/WAF readback and origin behavior | Provider account with MFA | Exact before-state and rollback packet; never authorization dependency |
| Discord functions | Declared Edge functions and Reaper source | Supabase integration and separately approved Reaper deployment | Signature/HMAC/replay tests, event preview/apply diff, hosted worker health | Discord application/provider secrets | Feature modes, preview/confirm gates, no send during ordinary smoke |
| Reaper | `Reaper-Discord-Bot` repository | Repository CI; separate runtime workflow | Exact main/CI, immutable runtime artifact, supervisor/recovery evidence | Runtime secret store/private recovery | Prior artifact; stop worker under exact runtime packet |
| Social Mobile | `Mochirii-Social-Mobile` | Future Apple/Xcode packet | Repository CI, signed build/TestFlight/App Store metadata, Social API scenarios | Apple developer/provider secrets outside source | No current release; revoke build/profile through Apple packet |
| Mochi Pets | `Mochirii-Pets` Unity repository; Website owns public page/doorway | Future Unity artifact and Apple/Web packets | CI, immutable artifact digests, server authority, browser/iOS scenarios | Project-specific private recovery/provider stores | Disconnected contract, fail-closed tester doorway, no restored prototype |
| Forums | `Mochirii-Forums` | None yet | Repository governance/CI when bootstrapped | Project-specific private boundary only when needed | Empty/governance-only state; no hosted surface |
| Electronic rewards | Disabled raffle source plus future isolated relay | No current production writer | Legal/country/tax/provider/KYB/MFA/funding/canary and idempotent order evidence | Dedicated provider/relay secret store | All switches off; no paid relay or order endpoint active |
| Fly.io | No active source integration | None | Explicit inventory absence | None active | New exact architecture/cost approval required before use |
| Local workstation | Development/admin tooling only | Human operator | Worktree status, local tool versions, reproducible checks | Private recovery folders; never runtime source | May be offline without affecting production |

## Data classification and browser boundary

| Data class | Browser allowance | Server/provider rule |
| --- | --- | --- |
| Public content/config | Reviewed copy, public URLs, opaque public IDs, publishable Supabase key | Keep minimal, cache intentionally, scan for provider/internal leakage |
| Member-private | Short-lived member session and authorized response only | Verify current user/membership/role at server and data boundary; no public cache |
| Moderator/admin | No privileged shell or data before server authorization | Revalidate claims/role per action; audit and rate limit |
| Credential/secret | Never | Secret manager/Vault/provider only; private recovery copy, MFA and least privilege |
| Immutable evidence | Never public unless explicitly redacted/aggregated | Append-only or additive correction; no destructive rollback |
| Supplier/product evidence | Never public Git | Private SKU dossier/pricing/compliance boundary; expose approved customer-safe facts only |
| Reward link | Authorized winner only, one-time claim context | Treat as bearer secret; never logs, analytics, public response, or ordinary email content |

## Release readback minimum

Every production release records:

1. protected/default branch SHA and tree;
2. reviewed PR head, required checks, and preview identities;
3. provider deployment/build identity and exact source binding;
4. migration/function/image/theme/artifact inventory actually changed;
5. security/accessibility/responsive/runtime acceptance;
6. rollback target and stop conditions;
7. aggregate no-secret data/readback evidence; and
8. explicit confirmation that no out-of-scope provider, secret, schedule, data,
   payment, publication, or paid-resource change occurred.

Mutable provider facts belong in dated ignored evidence and the current-state
summary, not hard-coded into this ledger as timeless truth.

