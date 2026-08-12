# Member Entitlement State Foundation v1

Status: local source candidate only. The migration has not been applied to a
hosted database, and every runtime capability remains disabled.

Base Website source: `d5e55abfb5e5d6fbecaf7da1cec762ba9bc9cdab`.

## Purpose

This Website-owned database foundation provides one durable, service-neutral
place to record the core member entitlement decision that future Social and
Forums integrations may consume. It does not define either consumer's wire
protocol and is not bound to a draft SSO, acknowledgement, HMAC, HTTP, provider,
or Discourse contract.

The historical decision stored for an event is:

```text
active && discord_verified
```

That generated value describes the decision at `effective_at`. A future live
authorization path must also require that its accepted evidence has not expired
at the time of use. This migration deliberately does not evaluate member
profiles or Discord identities; an accepted producer must supply a complete
validated snapshot through a later transaction boundary.

## Private State

The migration adds exactly six relations under `private`:

- `member_entitlement_runtime_control` contains one row and six independent
  activation flags. All six default to `false`.
- `member_entitlement_subject_locks` supplies one stable lock row per
  pseudonymous Website subject so first writes, changes, and expiry processing
  share one serialization order.
- `member_entitlement_events` is the append-only sequence of complete core
  snapshots. Each subject revision is a positive signed `bigint` and cannot
  wrap.
- `member_entitlement_state` points to the exact immutable event that represents
  the current snapshot and retains an immediate restrictive foreign key to its
  stable subject-lock row.
- `member_entitlement_event_targets` creates exactly one `social` and one
  `forums` delivery obligation for every new event. These rows are not delivery
  acknowledgements, retry state, or consumer high-watermarks.
- `member_entitlement_expiry_due` records the expected revision, verification
  timestamp, and due time needed for compare-and-swap expiry.

No relation stores an email address, Discord identifier, role list, username,
profile content, provider payload, HTTP header, signature, credential, token,
or consumer-specific binding.

The subject UUID intentionally has no cascading `auth.users` foreign key.
State, lock rows, and immutable events would therefore survive account deletion
as pseudonymous evidence. Retention, tombstoning, and deletion policy must be
approved before activation; this source candidate does not claim that decision.

## Atomic Operations

`public.commit_member_entitlement_snapshot_core_v1` is the only function granted
to `service_role`. It is still inert because `producer_enabled` is false. The
function:

1. accepts only a current service-role request context;
2. locks the subject before re-sampling the mutation clock, validating positive
   evidence is still current, and reading current state;
3. requires the caller's exact expected revision, with zero reserved for the
   absent state;
4. returns an identical current snapshot without creating an event;
5. otherwise increments once, appends one immutable event, updates current
   state, creates both delivery obligations, and updates or removes due work in
   one transaction; and
6. fails without mutation on stale revision or signed-bigint exhaustion.

The private expiry processor takes the same subject lock, then re-reads and
locks the current due row before current state. That post-lock read prevents an
expiry statement from deleting a newer refresh's future due work. It
uses the due row's revision and verification timestamp as a compare-and-swap
fence. Exact due work creates one denial event and both delivery obligations;
stale work is removed without creating an event. The private wrapper is not
executable by Data API roles and no cron schedule calls it.

The two-session regression suite separately exercises competing first writes,
competing transitions, both commit-versus-expiry orders, a grant expiring while
waiting for its subject lock, and two expiry workers with bounded lock and
statement timeouts.

## Security Boundary

- RLS is enabled on all six relations.
- Client policies are restrictive denials for `anon` and `authenticated`.
- `PUBLIC`, `anon`, `authenticated`, and `service_role` have no direct table or
  column privileges, including PostgreSQL 17 `MAINTAIN`.
- The commit RPC revokes default execution and grants only `service_role`.
- The expiry processor, expiry wrapper, and append-only trigger helper retain
  owner-only execution.
- All functions use an empty fixed search path.
- Events reject update and delete operations.
- The migration does not alter default privileges for future private objects.
- Exact catalog tests freeze all relation, column, constraint, foreign-key,
  index, policy, trigger, function, and ACL metadata.

The service-role grant is a capability, not an activation. There is no source
caller in an application, Edge Function, service, workflow, scheduler, or
existing migration.

## Deliberately Absent Runtime Behavior

This foundation adds none of the following:

- member or Discord evidence evaluation;
- a producer, backfill, dispatcher, queue claimant, or consumer receiver;
- delivery acknowledgement, retry, lease, phase, or high-watermark semantics;
- Social OAuth token-issuance or refresh-token enforcement;
- Pixelfed session termination;
- Forums DiscourseConnect production or user binding;
- HTTP, HMAC, webhook, API-key, provider, or secret configuration;
- login enablement, hosted cron, provider deployment, or data migration.

All six runtime flags remain false. Future changes must use separately reviewed
migrations and source; changing application code alone cannot activate this
foundation.

## Rollout and Recovery

The safe source and deployment order is:

1. merge the reviewed inert foundation;
2. apply its migration only under a separately approved production database
   packet and verify the exact catalog with every flag still false;
3. deploy accepted producers, consumer receivers, and recovery behavior while
   activation remains false;
4. prove clean-host, workstation-off, authorization, expiry, retry, revocation,
   and rollback behavior; and
5. enable each capability only through a reviewed forward migration in the
   accepted order.

Before activation and before any rows exist, an approved database rollback may
remove the isolated objects. Once any event exists, do not drop or rewrite the
ledger to roll back application code. Disable the relevant capability, preserve
the evidence, and use a reviewed forward-fix migration. Reverting an application
deployment does not reverse this database migration.

## Local Evidence Required Before Source Acceptance

- a clean isolated Supabase reset through every repository migration;
- the complete root pgTAP suite, including exact catalog and behavioral checks;
- the real two-session concurrency suite;
- migration history, database lint, Supabase security/performance, function
  inventory, Edge type, and local Preview checks;
- the root repository baseline and `git diff --check`; and
- a fresh independent review bound to the exact staged tree.

None of those local results constitutes hosted migration, provider activation,
live member verification, Social/Forums launch, or deployment evidence.
