# Reaper spinner delivery

`reaper-spinner-dispatch` is the server-only outbox consumer for live Mōchirīī
raffles. It posts the live-page message once, stores the returned message ID,
and edits that same message with the result after the authoritative reveal
time. Optional replay media is a separate, best-effort job and can never block
or change those two primary transitions. Protected browser-to-live command
requests necessarily carry roster data. Scheduled dispatcher invocation
requests and the start-message payload carry no roster or winner data. A
job-scoped capability can disclose only the immutable animation manifest to
the renderer after the winner message is complete; its participant list has
numbered, wheel-truncated labels and no participant UUIDs or draw RNG values.
All bot, dispatcher, and service credentials remain server-only.

## Release prerequisites

Provider changes remain approval-gated. During an approved Supabase release:

1. Apply `20260726180052_add_private_live_spinner.sql`, the additive
   `20260726213000_add_spinner_foreign_key_indexes.sql` follow-up, and
   `20260727033342_add_spinner_media_jobs.sql`, followed by
   `20260727054717_enforce_three_minute_spinner_countdown.sql`, from validated
   protected commits. Keep `spinner-live-session` and
   `reaper-spinner-dispatch` on the matching protected source. The connected
   production integration redeploys all 34 functions declared in
   `supabase/config.toml`, not only these two; require the exact-head Preview,
   full inventory readback, and serialized release described in
   `docs/operations/private-spinner.md`.
2. Configure the Edge environment with `DISCORD_RAFFLE_CHANNEL_ID` set to
   `1468667003366674721`, the existing server-only `DISCORD_BOT_TOKEN`, and a
   new high-entropy `REAPER_SPINNER_DISPATCH_SECRET`. Never copy any of those
   values into the website, repository, logs, or a command transcript.
3. Store the canonical Supabase project URL in Vault as `project_url`. Store
   the exact same high-entropy dispatcher secret in Vault as
   `reaper_spinner_dispatch_secret`; the Edge environment and Vault values must
   be rotated together. The migration
   installs a five-second maintenance job using `pg_cron`, `pg_net`, and those
   Vault values. It also queues an asynchronous dispatcher call in the same
   transaction that creates an outbox row; network delivery begins only after
   commit and never delays the authoritative spin response. Do not put either
   value in migration SQL.
4. Prove `spinner_discord_outbox` has zero rows, then invoke the dispatcher once
   with `{ "limit": 1 }`. Require HTTP 200 with zero claimed, completed,
   retried, and failed rows plus an empty results array; query the table again
   and require zero. This empty claim must not make a Discord request. Then
   use the first genuine moderator draw as the production canary; do not send a
   synthetic guild result. Verify that one message links to
   `https://mochirii.com/account?open=live-draw`, displays the authoritative
   start time, and that the same message ID is edited after
   reveal. Confirm no users, roles, `@here`, or `@everyone` were mentioned.

## Optional replay media

`spinner_media_jobs` is service-only, protected by RLS plus explicit grants,
and retains immutable manifest metadata for 30 days. It stores no media bytes.
Row-lock claims use `SKIP LOCKED`; dispatch claims wait until the primary
winner edit is complete, and a delayed native fallback becomes eligible 60
seconds after reveal. Pre-render failures, attachment failures, manifest
authorizations, and capability lifetime are independently bounded. A malformed
or missing optional manifest is caught by the additive trigger and cannot roll
back a draw or its message outbox.

The existing `REAPER_SPINNER_DISPATCH_SECRET` signs opaque, high-entropy job
capabilities. Only the SHA-256 capability hash is stored. The raw value is sent
in the bounded `x-mochirii-spinner-media-capability` header, never a URL, body,
database row, or log. The native `/spinner/media/render` route forwards that
header with the small `{ "action": "manifest" }` request and existing public
project configuration; it does not require a new website secret or renderer
service. The Edge function validates the signature, expiry, stored hash, job
status, and authorization budget before returning the immutable manifest.

After binding the capability, the dispatcher schedules the same-site render
through the Edge runtime's background task lifecycle, so the five-second
database caller is not held open. If that immediate attempt fails, the existing
maintenance tick starts independently bounded retries after the 60-second
fallback boundary. The render destination is pinned to the same-site
`https://mochirii.com/spinner/media/render` route; it cannot be redirected by
environment configuration. The background render has a 55-second request
ceiling to accommodate cold starts and encoding while staying bounded. MP4 is capped at
4,250,000 bytes and PNG at 3,000,000 bytes. The preferred replay remains the
full 10.6 seconds at 1280x720/24 fps; a renderer may retry at 960x540/20 fps to
fit the unchanged byte ceiling. MIME type, file signature, digest, exact
draw-derived filename, allowlisted channel, completed message ID, and reveal
time are all revalidated before attachment.

Attachment uses a read-before-write reconciliation check and a deterministic
filename. A lost database response therefore adopts the existing exact file
instead of posting it twice. The multipart edit omits message content, so it
cannot replace the winner result, and disables all mentions. Media failures
remain visible only as service metadata and never reopen or fail the completed
primary outbox.

Claims use a 60-second lease and row locks with `SKIP LOCKED`. Start messages
use Discord's enforced nonce with a stable draw-derived value, limiting
duplicates if a successful HTTP response is lost. Rate limits and transient
server errors retry with a bounded delay; invalid payloads, denied channels,
missing message IDs, and exhausted attempts fail closed for operator review.
The nonce is best-effort idempotency across the external message service and
database, not an atomic exactly-once guarantee. If a post succeeds but its
message ID cannot be recorded through a prolonged outage, reconcile that draw
before retrying. Pause delivery, inspect only the affected outbox metadata and
target-channel time window, require one unambiguous Reaper-authored start
message, and adopt that exact message ID through the guarded transaction in
`docs/operations/private-spinner.md`. Never retry blindly or edit/delete an
ambiguous candidate.

Attempts interrupted after reservation but before the selected result is
durably staged fail closed. An unstaged spin command is terminalized as
`spin_result_not_durable`, and a moderator must initiate a new command ID;
reusing that command ID can never invoke the random source again. If staging
committed but its response was lost, the frozen payload is retained and
replayed without resampling.

The ordinary viewer response withholds the selected index and winner until the
authoritative reveal time. This is presentation control, not cryptographic
secrecy: the frozen roster and deterministic final wheel rotation allow a
technically skilled observer to infer the target before the visible reveal.
Receipts make the selection arithmetic replayable but are not independently
tamper-proof.

No function deployment, Vault or function-secret mutation, database push, or
Discord request is performed by adding these source files. Applying the
migration during an approved release creates the scheduler source described
above.

For an emergency delivery pause, first unset the Edge
`REAPER_SPINNER_DISPATCH_SECRET` and then remove the Vault
`reaper_spinner_dispatch_secret` entry. This makes already queued requests fail
closed before stopping new scheduled requests, without touching the shared bot
token or outbox evidence. Database changes remain forward-only; use a reviewed
forward-fix migration instead of deleting tables, jobs, receipts, or migration
history.
