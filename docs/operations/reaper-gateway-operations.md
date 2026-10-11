# Reaper Gateway operations and recovery

Website owns this disabled control plane and its private Storage bucket. Reaper
Gateway owns local queue capture, validation, encryption, host service hardening
and restore. The protocol is
[`reaper-gateway-operations.v1.json`](../integrations/reaper-gateway-operations.v1.json).
It does not change guild scheduling, containment receipts, welcome-message
behavior or the inactive raffle. The workstation administers services; production
heartbeats, checkpoint capture and retention run on hosted services.

This source is not evidence of deployment, activation, a recoverable backup or a
successful restore. Publication, additive migration, secrets, paid hosting,
activation and recovery writes require separate exact authorization. All three
policy flags (`enabled`, `backup_required`, `retention_enabled`) default false.
The installed 15-minute hosted cron returns without network access while its
policy is disabled. No existing runtime credentials belong in this runbook,
source, command arguments, logs or evidence.

## Authentication and health

The only public result is `GET /status`: HTTP 200 `ok` or 503 `unavailable`, plain
text with `Cache-Control: no-store`. It reveals no member data, identifiers,
counts, checkpoint metadata or diagnostics. A healthy result requires enabled
policy, a healthy heartbeat received by the server within 180 seconds, the exact
private bucket configuration, no unknown objects or unresolved writer, and no
incident hold. When backup is required, the accepted checkpoint must still have
matching Storage size metadata and its independently validated `checked_at`
must be no more than 900 seconds old.

The hosted bridge alone receives `REAPER_GATEWAY_OPERATIONS_HMAC_KEY` (32–256
UTF-8 bytes). It signs method, fixed external pathname, Unix timestamp,
single-use UUIDv4 nonce, SHA256 of raw body and immutable capture header using
the versioned LF framing in the contract. The Edge handler accepts only the
gateway-stripped function pathname and derives that exact external pathname.
Verify this mapping on the deployed gateway before activation. Queries,
redirects, encoded bodies, wrong media types, duplicate JSON keys, noncanonical
timestamps and unexpected fields fail closed. Signed timestamps have a
120-second tolerance; a private atomic nonce cache retains identities for ten
minutes and refuses requests when its 1,000-entry capacity is reached. Receipt
lookups also consume fresh nonces.

The heartbeat is a flat exact schema with no member payload. Its checkpoint
UUID, immutable capture time and fresh live-validation time are either all null
or all valid. A stable, unchanged queue keeps its original UUID/capture time;
fresh validation updates only `checkpoint_checked_at`. The accepted receipt's
capture time must match, and checked time cannot precede capture or exceed
server time. Server receipt time controls heartbeat age, so replaying an old
observation cannot extend health. A missing or stale required backup fails
health closed even if the network heartbeat arrives.

## Checkpoint writes and acknowledgement loss

The bridge validates the complete queue before invoking the pinned encryption
tool. It persists one UUID, immutable capture time and the exact age ciphertext
before its first request. Ciphertext is raw binary, 64 bytes through 16 MiB,
including encryption overhead. The server checks the age v1 prefix, size and
digest; that prefix alone is not proof of encryption or recoverability. Only a
separately verified decrypt/restore drill proves recipient correctness and
complete queue preservation. An oversized or invalid checkpoint is held;
never truncate it to fit.

Only a `missing` receipt permits a create-only POST. Storage uses the fixed
private `reaper-gateway-recovery` bucket and `v1/<UUIDv4>.age` key, with
`upsert:false`. A database advisory lock and durable unique writer fence reserve
capacity before the provider write. UUID, capture time, SHA256 and byte length
are immutable. Browser roles have no private table or RPC access and receive no
new Storage policy. The worker never receives a service key or any list,
ciphertext-read, overwrite, delete, signed-URL or policy-change capability.

After a lost acknowledgement, fetch the same receipt with a fresh nonce. The
server may resolve a pending upload by bounded download and exact length/hash
verification. An absent object after reservation is still ambiguous: the first
write might remain in flight. Keep `pending`; do not upload again, re-encrypt,
allocate a new UUID, expire the reservation or clear its fence. A mismatch
becomes `blocked` and records an incident hold. If a provider read or DB result
is unavailable, the endpoint returns only fixed failure output. Permanent
private UUID tombstones contain no member payload and prevent retired
identities from ever becoming create permission again.

## Hosted retention and incident holds

The approved retention union is the latest eight captured snapshots and the
latest snapshot for each of today and the preceding six calendar days in
`Asia/Singapore` (UTC+8). Ties use UUID order. At most fifteen live objects and
240 MiB are admitted, counting pending, deleting and blocked reservations.
Unknown bucket objects or mismatching size metadata fail closed rather than
being ignored or deleted. Partial indexes keep live capacity/retention work
separate from permanent retired tombstones.

Maintenance uses its own 32–256-byte
`REAPER_GATEWAY_OPERATIONS_MAINTENANCE_SECRET`, distinct from the worker HMAC
key. The hosted dispatcher reads the matching Vault entry
`reaper_gateway_operations_maintenance_secret` and sends only exact `{}` JSON
to the fixed production maintenance endpoint. It exposes no arbitrary URL,
headers or object key. Each invocation processes at most one eligible object.
The hosted request timeout is 90 seconds, allowing the four bounded provider
operations (15 seconds each) plus processing overhead to acknowledge. Concurrent
maintenance and upload admission share the durable fence.
Pre-admission can retire one safe obsolete snapshot before reserving a
sixteenth slot; if no safe slot exists, admission stops.

Cleanup first commits a `deleting` claim for one receipt-owned key, verifies its
bounded ciphertext hash/length, calls Storage API `remove`, then verifies
metadata absence before recording `retired`. It never deletes Storage object
rows with SQL. Unknown keys, absent/mismatching claimed ciphertext, failed
removal or uncertain acknowledgement stop the run. A deleting fence never
expires, and subsequent automated calls do not retry that delete. A public
status request is read-only and cannot clear an incident. Disable policy for
containment without erasing receipts or objects; source rollback also does not
reverse data changes.

An operator must separately review and approve reconciliation of pending,
deleting or blocked states and any incident-hold clearing. Preserve the exact
receipt and provider observations first. Do not change UUIDs, delete unknown
objects, reset tables, mark uncertain writes complete or re-enable over an
unresolved fence. After approved reconciliation, repeat the recovery drill and
fresh status checks before considering activation again.

## Release and verification order

1. Review both repositories' exact source trees, protocol compatibility and
   disabled defaults. Run required source/type/test checks and the additive
   migration/pgTAP suite on an isolated local database. Do not reset another
   phase's database or use production credentials for tests.
2. Obtain exact authorization for protected source publication, migration,
   deployed function configuration and secure one-time credential delivery.
   The function's `verify_jwt` setting is false because each private route uses
   its own fail-closed HMAC or maintenance authentication. No JWT setting may
   bypass those checks. Read back the exact deployed source and grants.
3. Verify signed route framing on the deployed gateway and public disabled
   status. Confirm the bucket is private, has the exact 16 MiB/MIME limits, and
   browser/worker reads, lists, overwrite and delete are denied. Verify
   anonymous/user RPC access is denied. Install only the matching separate
   maintenance secret in Edge runtime and Vault via the approved secret path.
4. With separate activation approval, enable hosted capture/admission, obtain
   one exact accepted ciphertext receipt, and perform an isolated validate-only
   decrypt/restore drill. Verify all original member request IDs, immutable
   payloads, ordering, retry state and conservative holds survive. No Discord
   resend or hold clearing is part of a restore validation.
5. Only after that proof, enable backup-required health and hosted retention.
   Verify a fresh accepted checkpoint plus matching checked time yields 200,
   stale heartbeat/check time and any incident yield 503, and cron successfully
   performs only receipt-owned retention with hard limits preserved. Confirm
   the hosted services continue while the local workstation is offline.

Local source tests exercise malformed requests, signature replay and tampering,
body deadlines/bounds, lost upload/DB acknowledgements, indefinite fences and
cleanup ordering. pgTAP covers disabled state, grants, RLS, immutable receipts,
nonce bounds, Singapore calendar retention and admission limits. They do not
replace deployed Storage permission tests, cryptographic recovery drills or
hosted/offline behavior verification.

## Hosted monitor and owner notification receipt

The owner selected GitHub notifications for Gateway alerts.
`.github/workflows/reaper-gateway-monitor.yml` performs one public status GET
from protected `main`, with `contents: read` and no runtime credentials. The
repository variable `REAPER_GATEWAY_MONITOR_ENABLED` must equal `true`; an
absent variable leaves monitoring disabled. Enable it only after exact provider
approval and publication verification.

With separate action approval, dispatch the protected-main workflow with
`notification_test:true`. Its deliberate failure occurs before the status GET
and creates no Gateway outage. Configure the authenticated owner's GitHub
Actions failed-run notification preference and record actual receipt through
the chosen notification channel in ignored redacted evidence. Workflow failure
alone proves no notification delivery. Then dispatch with
`notification_test:false` and verify the normal status check passes. Verify
intentional stale/held 503 behavior in the approved host acceptance tests. Keep
welcome-message activation gated until the owner notification receipt and
normal healthy check are proven.

The schedule is every five minutes at minute offset two. GitHub may delay or
drop scheduled runs; public-repository schedules can disable after 60 days
without repository activity. Scheduled notifications go to the account that
last changed the cron syntax, so verify owner identity and notification settings
when publishing schedule changes. This monitor supplies no hard availability
SLA. GitHub documents these constraints in
[scheduled workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
and [notification configuration](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications).

Primary references reviewed October 11, 2026: Supabase
[bucket creation and limits](https://supabase.com/docs/guides/storage/buckets/creating-buckets),
[create-only upload](https://supabase.com/docs/reference/javascript/file-buckets-upload),
[Storage schema](https://supabase.com/docs/guides/storage/schema/design),
[API object deletion](https://supabase.com/docs/guides/storage/management/delete-objects),
[hosted Edge scheduling and Vault](https://supabase.com/docs/guides/functions/schedule-functions),
and PostgreSQL [partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html).
Implementation retains pinned Supabase CLI 2.109.1, SDK 2.110.8 and Deno 2.9.4.
