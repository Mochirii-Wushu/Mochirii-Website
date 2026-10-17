# Mōchirīī raffle delivery

`reaper-spinner-dispatch` delivers live-draw announcements from a server-side
outbox. It posts the start message and edits that same message with the stored
result after the scheduled reveal. Optional replay media is independent and
cannot change or block the primary result.

## Safety guarantees

- Bot, dispatch, and service credentials stay server-only.
- Scheduled requests and start messages contain no roster or winner data.
- Draw results are selected and durably staged before delivery. Lost responses
  reuse the stored result rather than drawing again.
- Discord mentions are disabled.
- Delivery uses bounded claims, retries, and duplicate reconciliation.
  The database and message service do not share an atomic transaction, so
  exactly-once delivery is not guaranteed. Never retry blindly after an
  ambiguous successful send.
- Replay rendering receives a short-lived, job-scoped capability only after
  the winner message completes. Its manifest contains bounded display labels,
  not participant UUIDs or random draw values.

## Release prerequisites

Follow the [live-spinner release guide](../../../docs/operations/private-spinner.md)
and [shared backend guide](../../README.md). Deploy only reviewed, matching
function and migration revisions.

The connected production integration redeploys all 34 functions declared in
`supabase/config.toml`. A spinner-only source change therefore still requires
the exact-head preview, complete function inventory, and serialized release
checks.

Before enabling delivery, verify an empty outbox and make the documented
empty-claim check. Require zero claimed, completed, retried, and failed rows,
an empty result list, and no Discord request. Use the first genuine approved
draw for live acceptance; do not create a synthetic guild result.

Configuration must use the reviewed channel and server-only
`DISCORD_BOT_TOKEN` and `REAPER_SPINNER_DISPATCH_SECRET` values.
The matching Vault value is `reaper_spinner_dispatch_secret`; rotate both
copies together. Never put secret values in SQL, source, browser configuration,
URLs, or logs.

## Replay media

Replay jobs retain metadata for 30 days and store no media bytes. Rendering is
bounded independently from primary delivery, with a 55-second request ceiling,
an MP4 limit of 4,250,000 bytes, and a PNG limit of 3,000,000 bytes.

Capabilities travel only in the bounded
`x-mochirii-spinner-media-capability` header. Only their hashes are stored.
The same-site renderer and dispatcher revalidate expiry, job state, media
signature, digest, filename, channel, message identity, and reveal time.

Attachments use read-before-write reconciliation and deterministic filenames.
The edit preserves winner text and disables mentions. Failed replay media
cannot reopen or fail a completed result.

## Recovery and fairness

If a start message may have succeeded without its ID being recorded, pause
delivery and reconcile the exact draw using the release guide. Do not edit or
delete an ambiguous message.

A command whose result was not durably staged fails closed as
`spin_result_not_durable`. A new draw needs a new command ID; retrying the
failed ID must not call randomness again.

Viewer responses hide the top-level winner until reveal, but the frozen
elimination plan can reveal future outcomes to someone inspecting it.
Animation timing is not cryptographic secrecy. Receipts permit arithmetic
replay; they are not independent tamper-proof evidence.

For an approved emergency pause, disable the Edge dispatch secret before
removing its Vault counterpart. Preserve outbox evidence and the shared bot
token. Database recovery uses a reviewed forward-fix migration, not deletion
of tables, receipts, schedules, or migration history.
