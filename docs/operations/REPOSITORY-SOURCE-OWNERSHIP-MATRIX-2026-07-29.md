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
| Reaper persistent Gateway worker | Reaper | Reaper | Remove obsolete fallback handler only after the Edge rollback window. |
| Mobile client source and app configuration | Mobile | Mobile | No Social server, Website, Unity source, or provider secrets. |
| Unity `Assets`, `Packages`, `ProjectSettings`, `.meta` files and build definitions | Pets | Pets | Website/Mobile consume immutable artifacts only; no copied source or submodule. |
| Forum governance, supported upstream locks, no-secret templates, theme/plugin adapters and runbooks | None | Forums | Clean initialization; never import Website history or vendor upstream core. |
| Archived raffle-spinner source | Archived spinner | Archived spinner | Historical only; never restore as a production owner. |

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
