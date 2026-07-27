# Monthly Raffle Core Foundation

Status: source-only, disabled, unmerged, and undeployed. This document is not
authorization to apply the migration, deploy functions, configure secrets,
schedule work, fund rewards, or activate submissions.

## Fixed program contract

- Program timezone: `Asia/Singapore` (UTC+8). A client may localize an active
  cycle's stored timestamps for display without changing the authoritative
  instants.
- Eligibility baseline: verified guild member, age 18 or older, and resident
  of an approved country. A reviewed country matrix supplies the exact list for
  each cycle.
- Entry model: one eligible monthly opt-in grants five standard entries. Five
  permanent bonus categories can each add one entry through either the named
  activity or an equivalent free alternative. The hard maximum is ten entries
  per person.
- Drawing safety: a cycle cannot freeze with fewer than three eligible
  entrants. Selection is weighted without replacement from an immutable salted
  ledger. The complete order includes the winner, community honors, and ranked
  alternates.
- Time windows: claim defaults to seven days and award completion defaults to
  thirty days. A reviewed cycle may set claim from 1 through 30 days and award
  completion from 7 through 90 days. An alternate is promoted only when the
  full configured claim window remains.
- Result privacy: anonymous readers receive only `Winner confirmed` or
  `Community honor confirmed`. A currently verified authenticated member may
  request the matching guild display names through the separate member action.
- Reward retrieval: a selected member uses the authenticated Mochirii claim
  boundary. This core foundation deliberately cannot retrieve or redirect to an
  electronic reward link. A separately reviewed activation track must provide
  an encrypted, one-use, same-origin handoff. Electronic reward links are
  short-lived bearer secrets and never enter public JSON, analytics, logs,
  database rows, email, browser storage, or repository artifacts.

## Data and authorization boundary

The forward migration
`supabase/migrations/20260727050100_add_disabled_monthly_raffle_foundation.sql`
adds nine service-owned tables:

1. `raffle_cycles`
2. `raffle_entries`
3. `raffle_bonus_awards`
4. `raffle_draws`
5. `raffle_draw_results`
6. `raffle_audit_events`
7. `raffle_provider_configs`
8. `raffle_fulfillment_jobs`
9. `raffle_provider_events`

Every table has RLS enabled, a restrictive default-deny policy for `anon` and
`authenticated`, no browser-role table privileges, and explicit service-role
grants. The privileged database routines use `SECURITY DEFINER` only for the
service-owned workflow. Each has an empty `search_path`, schema-qualified
relations, an in-body service-caller assertion, revoked public/browser execute
access, and an explicit service-role grant.

The migration does not contain a sponsor identity. A cycle remains in draft or
blocked state until all seven reviewed approvals are true: sponsor, official
rules, country matrix, reward, privacy, tax, and operations. It also requires
the exact reviewed sponsor, public reward label, immutable rules/privacy/country
hashes, and a nonempty approved-country list before a ready or active state is
valid.

## Edge Function inventory

This source expands the declared inventory from 33 to 40 functions. The exact
source expectation is 23 with `verify_jwt = true` and 17 with it false. Recount
the final reviewed head before requesting any deployment authorization.

| Function | JWT | Purpose |
| --- | --- | --- |
| `get-current-raffle` | false | Public-safe current cycle and generic result evidence; authenticated verified-member result-name action |
| `manage-raffle-entry` | true | Member opt-in, withdrawal, status, and free-alternative submission |
| `moderate-raffle` | true | Moderator cycle, review, drawing, and manual-award commands |
| `run-raffle-schedule` | false | Secret-authenticated scheduler worker |
| `manage-raffle-claim` | true | Winner claim status, reward choice, and decline boundary; no reward-link response |
| `run-raffle-fulfillment` | false | Secret-authenticated reward queue worker |
| `reward-provider-webhook` | false | Raw-body verified, replay-safe provider event intake |

Each function owns a `deno.json` with exact direct pins to
`@supabase/supabase-js` and `@supabase/functions-js` `2.110.8` plus a
function-local `deno.lock`. The seven locks use the same reviewed resolution
graph and immutable package integrities. Refresh and verify those locks only
with the approved Deno `2.9.4` toolchain; do not regenerate them with another
version or prune unrelated entries from the repository root lock.

## Operational gates

All runtime switches fail closed. Missing values, malformed values, and every
value other than case-insensitive `true` are closed:

```text
RAFFLE_SUBMISSIONS_ENABLED=false
RAFFLE_BONUS_SUBMISSIONS_ENABLED=false
RAFFLE_CLAIMS_ENABLED=false
RAFFLE_SCHEDULING_ENABLED=false
RAFFLE_REWARD_ORDERS_ENABLED=false
RAFFLE_RELAY_ENABLED=false
```

Database provider records also default to disabled ordering. No scheduler,
reward relay, webhook configuration, secret, production reward account, funding
source, or paid infrastructure is created by this source work.

## Activation gates

Before any production activation, obtain a new exact release authorization and
complete all of the following outside public Git:

- verified legal sponsor identity;
- counsel-approved official rules, privacy terms, no-purchase structure, age
  rule, country matrix, and promotion disclosures;
- qualified tax and withholding review for every approved country;
- production reward-account approval, KYB, campaign/product/country approval,
  recipient-less electronic-link confirmation, funding controls, and MFA;
- isolated fixed-egress relay approval, ownership, monitoring, key rotation,
  request signing, replay storage, egress allowlist, and cost approval;
- separately approved minimum-value canary and end-to-end winner claim test;
- scheduled-worker ownership, alerting, incident/complaint/recall procedures,
  rollback, and immutable evidence retention;
- exact migration, function-inventory, JWT-parity, secret, schedule, provider,
  and Vercel/Supabase deployment approval.

## Verification

Source-only checks:

```text
npm run check:raffle-core-foundation
npm run test:raffle-core-foundation
git diff --check
```

The static contract requires nine RLS tables, 22 caller-checked service RPCs,
seven function-local manifests and locks, exact `40 / 23 / 17` source parity,
fail-closed switch wiring, a privacy-safe public/member result split, and
exactly 56 pgTAP assertions.

When the approved local Supabase CLI and disposable database are available,
discover the current command syntax with `supabase --help` and then require a
clean local reset, all 56 pgTAP assertions, database lint, and security and
performance advisors. Never point these preparation commands at the hosted
production project.
