# Secret Name and Destination Inventory

Date: 2026-07-29

Status: source-declared, provider-unverified. This inventory was derived only
from tracked examples, source access sites, and workflow references. It records
names and intended destinations, never values, hashes, lengths, account IDs,
host addresses, or member/provider payloads. Presence here does not prove a
value exists in any provider.

## Classification

- `secret`: credential or signing material; never browser-readable.
- `server configuration`: non-public identifier/configuration retained on the
  server because exposing it is unnecessary or could aid abuse.
- `public configuration`: intentionally shipped to the browser; it must never
  be treated as authorization.
- `provider managed`: injected by the platform and not copied between stores.

## Website and validation

| Name | Class | Intended destination |
| --- | --- | --- |
| `MOCHIRII_SOCIAL_OAUTH_CLIENT_ID` | Server configuration | Existing Vercel Website project, Preview and Production, server-only. |
| `MOCHI_PETS_TESTER_PASSWORD` | Secret | Vercel server-only environment if the separately approved tester doorway is activated. |
| `MOCHI_PETS_TESTER_SESSION_SECRET` | Secret | Vercel server-only environment if the tester doorway is activated. |
| `NEXT_PUBLIC_SUPABASE_URL` | Public configuration | Vercel Website build/runtime and browser bundle. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public configuration | Vercel Website build/runtime and browser bundle; RLS remains mandatory. |
| `NEXT_PUBLIC_SITE_URL` | Public configuration | Vercel Website build/runtime and browser bundle. |
| `SUPABASE_PROJECT_REF` | Server configuration | Ephemeral operator or protected CI environment for readback tools only. |
| `SUPABASE_ACCESS_TOKEN` | Secret | Ephemeral operator or protected CI/provider integration; never Vercel public variables. |
| `SUPABASE_SECRET_KEY` | Secret | Ephemeral operator/protected validation environment only. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Ephemeral operator/protected validation environment only; runtime functions use the Supabase-managed destination below. |

`NEXT_PUBLIC_AUTH_PROVIDER_IDS`, placeholder-provider flags, readiness flags,
and CAPTCHA flags are feature configuration, not credentials. They do not
authorize enabling a provider without its dated release packet.

## Shared Supabase Edge runtime

| Name | Class | Intended destination |
| --- | --- | --- |
| `SUPABASE_URL` | Provider-managed server configuration | Supabase Edge runtime injection. |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS` | Provider-managed secrets | Supabase Edge runtime/Vault; never browser, repository, or consumer repository. |
| `DISCORD_BOT_TOKEN` | Secret | Supabase Edge secret store for current Website-owned Discord execution; future Reaper destination only after cutover. |
| `DISCORD_PUBLIC_KEY` | Server configuration | Supabase Edge secret/config store for signature verification. |
| `DISCORD_GALLERY_INGEST_SECRET` | Secret | Supabase Edge secret store on both verified ends of the ingest contract. |
| `REAPER_PENDING_VERIFICATION_SYNC_SECRET` | Secret | Supabase Edge secret store on both verified ends of member synchronization. |
| `REAPER_SPINNER_DISPATCH_SECRET` | Secret | Supabase Edge secret store/Vault on both verified dispatcher endpoints. |
| `VOTE_REMINDER_CRON_SECRET` | Secret | Supabase Edge secret store/Vault. |
| `SPOTLIGHT_POLL_CRON_SECRET` | Secret | Supabase Edge secret store/Vault. |
| `PIXELFED_SOCIAL_SYNC_SECRET` | Secret | Supabase Edge secret store and Social root-owned runtime environment; rotate atomically. |
| `INSTAGRAM_ACCESS_TOKEN` | Secret | Supabase Edge secret store for the separately governed publishing lane. |
| `INSTAGRAM_ACCOUNT_ID` | Server configuration | Supabase Edge configuration for the publishing lane. |
| `MOCHI_PETS_GAME_SERVER_TOKEN` | Secret | Supabase Edge secret store only if a future game-server contract is approved. |
| `UNITY_SERVICES_SERVICE_ACCOUNT_SECRET` | Secret | Supabase Edge secret store only if the Unity services lane is approved. |
| `UNITY_SERVICES_SERVICE_ACCOUNT_KEY_ID`, `UNITY_SERVICES_PROJECT_ID`, `UNITY_SERVICES_ENVIRONMENT_ID`, `UNITY_SERVICES_ENVIRONMENT_NAME` | Server configuration | Supabase Edge configuration only if the Unity services lane is approved. |

Discord application, guild, channel, role, vote-link, schedule URL, API
version/base URL, time-zone, and terms-version names are server configuration.
They belong with the owning Edge runtime and must not be copied into browser
code. Exact current values require authorized provider readback.

## Social runtime and delivery

| Name | Class | Intended destination |
| --- | --- | --- |
| `APP_KEY` | Secret | Root-owned Social host application environment. |
| `DB_PASSWORD`, `DB_ROOT_PASSWORD` | Secret | Root-owned Social host/container environment. |
| `REDIS_PASSWORD` | Secret when configured | Root-owned Social host/container environment. |
| `MAIL_USERNAME`, `MAIL_PASSWORD` | Secret | Root-owned Social host application environment or approved mail provider store. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Secret | Root-owned Social host environment, scoped to live media only. |
| `MOCHIRII_SOCIAL_SYNC_SECRET` | Secret | Root-owned Social host environment; must match the Supabase-side contract through an atomic rotation. |
| `PF_OIDC_CLIENT_ID` | Server configuration | Root-owned Social host application environment for the existing first-party Website identity client. |
| `PF_OIDC_CLIENT_SECRET` | Secret | Root-owned Social host application environment; never expose it to browser code, Vercel public variables, logs, or source. |
| `SOCIAL_SSH_PRIVATE_KEY`, `SOCIAL_SSH_KNOWN_HOSTS` | Secret/protected trust material | GitHub protected deployment environment for the current Social delivery owner. |
| `SOCIAL_RECOVERY_SSH_PRIVATE_KEY`, `SOCIAL_RECOVERY_SSH_KNOWN_HOSTS` | Secret/protected trust material | Separate GitHub protected recovery environment. |
| `BACKUP_AGE_IDENTITY` | Secret | GitHub protected recovery environment and approved root-owned recovery store. |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | Secret | GitHub protected recovery environment and root-owned backup environment, scoped only to the backup Space. |
| `GITHUB_TOKEN` | Provider managed | Per-workflow GitHub Actions token with explicit least-privilege permissions. |

Social database/cache/mail/media endpoints, buckets, regions, usernames, and
feature flags are host configuration. They stay in the root-owned runtime
environment and are not target-repository secrets.

## Repository-specific disposition

- Mobile stores member access/refresh material only in device
  Keychain/SecureStore. Apple/EAS signing credentials belong only in approved
  Apple/EAS/protected-CI stores and require a Mobile-owned inventory/readback.
- Pets and Forums have no accepted production secrets. Source and artifacts
  must remain secret-free until separate runtime packets define destinations.
- Shopify credentials, private supplier costs, and evidence remain in Shopify
  or ignored/protected operator evidence; they are never theme variables or
  public Git content.
- `Mochi Creds` is a private recovery copy, never a runtime source of truth.

## Maintenance rule

At each approved release, compare source-declared names with a name-only
provider readback. Record `missing`, `unexpected`, `destination mismatch`, or
`confirmed` without retrieving values. An unexpected name or any secret value
in source, logs, artifacts, browser bundles, pull requests, or public evidence
stops the affected release and triggers the incident/rotation process.
