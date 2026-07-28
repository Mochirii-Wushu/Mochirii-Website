# Private Live Spinner Operations

The Mōchirīī raffle spinner is a native Website route at `/spinner`. The Website is its only production source: do not iframe, redirect, proxy to, or link to the retired standalone deployment.

## Access Modes

Both modes use the same URL and are authorized on the server before the stage is imported.

- **Controller:** a moderator enters through the authorized Leader Dashboard. The dashboard requests the exact `controller` intent, and the server delegates the role decision to the existing moderator authority. A viewer session can never promote itself by changing a cookie, header, URL, or client state.
- **Viewer:** an active, currently verified guild member enters through Account in exact `viewer` mode. The one-shot `/account?open=live-draw` handoff removes its query parameter, preserves an existing viewer or controller session, and otherwise requests viewer-only access before navigating to `/spinner`. A direct `/spinner` link works only while that short-lived private session remains valid; after it expires, the member re-enters through Account. Everyone else keeps the generic 404 surface with no private client or stylesheet preload.
- **Unauthorized:** the response is HTTP 404, `private, no-store`, and unbranded. It contains no spinner title, artwork, controls, stage stylesheet, analytics destination, or controller/viewer bundle.

Approval creates a rolling cookie whose lifetime is at most ten minutes and never exceeds the access-token expiry. It is `HttpOnly`, `Secure`, `SameSite=Strict`, and limited to `Path=/spinner`. The page and live proxy read that cookie on the server. Session authorization runs immediately, every five minutes, and when focus or visibility returns. Sign-out and session failure clear access; an expired controller returns to Leader Dashboard and an expired viewer returns to Account.

The route is dynamically rendered, `noindex`, `nofollow`, `noarchive`, excluded from the sitemap, and disallowed in `robots.txt`. The ordinary site header, footer, background layer, analytics, and performance telemetry are omitted. Its content-security policy permits only same-origin runtime connections.

## Controller And Viewer Surfaces

The controller can add, edit, delete, reorder, bulk-paste, clear, import, and export a 0–100-name live roster. Numbering and equal wheel segments always derive from current order. A draw requires 2–100 unique names and locks roster mutation until the stored result is revealed.

The viewer receives a separate lazy client bundle with the shared wheel, numbered roster, status, winner, and celebration. It has no button, input, select, form, link, mutation request, click handler, or editable control. Its Full, Reduced, or Off preference is saved from Account. First use is Full unless the operating system requests reduced motion; an explicit stored choice remains authoritative, while the operating-system reduced-motion preference still overrides Full. Reduced motion ends at the same authoritative reveal boundary, while Off holds the pre-draw angle and snaps only at reveal.

The moderator's **Test spin** switch is off by default. Starting either mode requires a mode-specific confirmation. Official and test modes are frozen into the command hash, durable receipt, and shared live snapshot before the draw is applied. A test draw remains visible on the private controller and viewer stages, but creates no guild-delivery outbox, rendered media job, public monthly result, or official-month reservation. It cannot be promoted later. See [`SPINNER-RAFFLE-WINNER-PUBLICATION.md`](./SPINNER-RAFFLE-WINNER-PUBLICATION.md) for the public-result boundary.

Full-screen mode is scoped to the controller's spinner container. Decorative canvases are hidden from assistive technology; roster, status, and winner remain persistent DOM text. Every effect run is bounded below five seconds, particle counts and device-pixel ratio are capped, and no production animation dependency is used.

## Live State, Privacy, And Retention

The browser speaks only to same-origin `/spinner/session` and `/spinner/live`. The live proxy forwards the short-lived user token and exact access intent to the protected backend; no service-role or bot credential reaches the browser.

Live synchronization necessarily sends the ordered participant roster from an authorized controller to protected server state. The active roster remains there until a moderator explicitly clears or replaces it. Frozen receipts and idempotency/recovery records also contain the relevant roster snapshot and may retain those names for up to 30 days after the active roster changes. Authentication requests and dispatcher invocations contain no roster or winner data, and outbound message payloads never contain the roster.

The backend keeps service-only, default-deny state for:

- the current ordered roster and wheel state, retained until explicit clear or replacement;
- immutable draw receipts, retained for exactly the bounded 30-day window even if the stage still displays that draw;
- immutable, service-only official monthly result records retained independently of expiring operational receipts, with append-only suppression records for reviewed incidents;
- idempotent command and delivery records, which may contain protected roster or winner recovery copies and are also removed after 30 days;
- a moderator authorization cache valid for no more than five minutes.

The controller also keeps a local roster backup, motion setting, pending idempotency key, and latest 100 receipts on the `mochirii.com` browser origin. Export anything that must outlive the 30-day server window or browser storage. Account deletion may null an operational actor reference, but must not rewrite a receipt's frozen draw data.

## Fairness And Synchronization

On Spin, the backend reserves an idempotent command, freezes the exact ordered roster, hashes it with SHA-256, and samples one unsigned 32-bit word at a time from the secure runtime random source. Rejection sampling discards out-of-range words and prevents modulo bias. The stored result is created once before animation; retries, dropped responses, repeated clicks, reduced/off motion, hidden tabs, animation failures, or Skip never resample it.

If processing is interrupted after command reservation but before the selected result is durably staged, that command ID becomes terminal and cannot be retried or resampled. The controller reports that no winner was retained and requires a new, explicit Spin action with a new command ID.

The server schedules an exact three-minute lead-in and returns its current clock with every snapshot. Both clients derive the visible countdown from the absolute `started_at` value, so refreshes, clock skew, focus changes, and late joins cannot restart it. Full viewers use the same animation start, duration, start angle, and final angle; late joiners use a negative animation offset instead of replaying the path faster. Reduced motion starts later but ends at the common reveal. Off and Skip do not point at the winning segment early.

Ordinary viewer responses withhold the selected index, winner, and receipt until reveal. This is presentation control, not cryptographic secrecy: a technically skilled authorized viewer can infer the target from the frozen roster and deterministic final rotation. Receipts make the selection arithmetic replayable, but they are not independently tamper-proof.

## Reaper Delivery

Every accepted **official** draw creates one service-only outbox item for channel `1468667003366674721`. Test draws create none.

1. Reaper immediately posts one message containing the authoritative start as a localized relative timestamp and the one-shot Account handoff link, with a stable enforced nonce and all mentions disabled.
2. At or after the authoritative reveal time, Reaper edits that same message ID with the sanitized winner, draw ID, and roster hash.
3. Rate limits and transient failures retry with bounded leases and backoff. Invalid channels, unsafe mentions, missing message IDs, or exhausted retries fail closed for operator review.

The stable nonce provides best-effort duplicate suppression during ordinary retries. Because the message service and database cannot share one atomic transaction, a prolonged outage after a successful post but before its message ID is stored can require operator reconciliation and may otherwise produce a duplicate start message.

The dispatcher never receives the participant roster. It receives only prebuilt start/result payloads, and the bot token remains in server-side function secrets. Detailed no-secret release prerequisites are in `supabase/functions/reaper-spinner-dispatch/README.md`.

## Approval-Gated Release

Source, tests, migration, and function code may be reviewed in a PR. The following remain separate owner-approved provider mutations:

- applying `20260727054717_enforce_three_minute_spinner_countdown.sql` after
  the released spinner and media migrations;
- allowing the connected production integration to redeploy all 34 Edge Functions declared in `supabase/config.toml`, including `spinner-live-session`, `reaper-spinner-dispatch`, and the read-only `get-current-raffle` function;
- setting `DISCORD_RAFFLE_CHANNEL_ID`, `REAPER_SPINNER_DISPATCH_SECRET`, or changing any existing bot secret;
- adding the matching Vault values used by scheduled dispatch;
- exercising the target channel or promoting a production deployment.

During an approved release, merge the migration and function source from the same validated commit. Configure the channel allowlist to the exact target, generate a distinct dispatcher secret, and store the project URL and matching dispatcher secret in Vault as documented by the dispatcher runbook. Never paste secret values into source, PR text, logs, or command transcripts.

Pause moderator draws before the three-minute timing migration or matching function and Website code begins deploying. Keep draws paused through the compatibility window, and resume only after the production migration, functions, Website deployment, unauthorized 404, and authorized session handoff are verified at the same merged commit.

## Production Integration Blast Radius

The connected production integration does not deploy only the two spinner functions. On every push or merge to the configured production branch, it applies new migrations and deploys every Edge Function declared in `supabase/config.toml`. The current reviewed source declares 34 functions, including `spinner-live-session`, `reaper-spinner-dispatch`, and the read-only `get-current-raffle` function. This matches the [production integration contract](https://supabase.com/docs/guides/deployment/branching/github-integration): migrations and all functions declared in `config.toml` are production deployment inputs.

Before merge, record the prior production commit and no-secret version/status inventory for all 34 functions in ignored operations evidence. Require the exact-head Preview and protected checks to pass. After merge, serialize the release: do not merge another provider-affecting change until the production integration reports success for the migration and all 34 function deployments. Verify the two spinner functions from the merged commit and run the existing no-send authentication/boundary smokes for the other 32 functions. A manual two-function deployment is not an equivalent release and is not authorized by this runbook.

The 34 configured functions are:

1. `verify-discord-member`
2. `verify-member-access`
3. `review-member-verification`
4. `list-gallery-review-queue`
5. `spinner-live-session`
6. `moderate-gallery-submission`
7. `delete-rejected-gallery-submission`
8. `list-approved-gallery-submissions`
9. `submit-discord-gallery-image`
10. `reaper-discord-interactions`
11. `reaper-spinner-dispatch`
12. `reaper-discord-member-sync`
13. `send-vote-reminder`
14. `send-member-spotlight-poll`
15. `publish-member-spotlight-winner`
16. `get-current-spotlight-winner`
17. `get-current-raffle`
18. `list-instagram-publish-queue`
19. `publish-instagram-gallery-submission`
20. `mark-instagram-gallery-submission-shared`
21. `check-instagram-api-status`
22. `list-member-profiles`
23. `list-visible-profile-cards`
24. `get-member-profile`
25. `submit-member-profile-media`
26. `list-member-profile-media-queue`
27. `moderate-member-profile-media`
28. `mochi-pets-alpha-session`
29. `mochi-pets-unity-auth`
30. `mochi-pets-alpha-action`
31. `mochi-pets-alpha-progress`
32. `mochi-pets-alpha-admin`
33. `submit-mochi-pets-feedback`
34. `sync-pixelfed-social-account`

## Authenticated Preview Boundary

The Preview database is data-less by design: production users, linked guild identities, member profiles, moderator cache rows, roster state, and receipts are not copied into it. A green Preview therefore proves schema, function, authorization-policy, and browser-flow behavior with controlled fixtures; it does not prove that any particular production account or role mapping is valid.

Create only the minimum synthetic Preview identities needed for one active verified viewer and one moderator. Use non-personal display values, establish the same service-controlled identity and recent-verification conditions required by production, and test inactive, unverified, expired, revoked, and conflicting-identity failures. Never seed production member records, a real roster, receipts, or credentials into Preview. Delete the synthetic Auth and member rows after testing and confirm the Preview spinner tables contain no retained fixture roster or receipt.

The final production acceptance pass must use existing, owner-approved accounts: one moderator and one active verified member. It must not create or elevate a production member merely to make the smoke pass.

## Empty-Outbox Gate

Run this read-only query immediately after the migration and before any production draw:

```sql
select count(*)::integer as total_rows
from public.spinner_discord_outbox;
```

Require `total_rows = 0`. If it is not zero, stop; inspect only identifiers, phases, attempt metadata, and timestamps. Do not print `start_payload`, `result_payload`, participant names, headers, or credentials.

With the exact channel allowlist and server-only configuration already validated, invoke `reaper-spinner-dispatch` once through the approved protected operator path with body `{ "limit": 1 }`. Supply its authorization header from the protected secret store without copying it into a shell history, transcript, log, issue, or PR. Require HTTP 200 and exactly:

```json
{
  "ok": true,
  "data": {
    "channelKey": "raffle_spins",
    "claimed": 0,
    "completed": 0,
    "retried": 0,
    "failed": 0,
    "results": []
  }
}
```

Run the count query again and require zero. This proves configuration and an empty claim without creating, editing, or deleting a channel message. Any nonzero claim, nonempty result, error, or unexpected network action is a stop condition.

## Genuine Live Channel Canary

Do not create a synthetic guild result. Use the first genuine moderator draw after the synchronized Website and database release as the production canary, with one authorized controller and one active verified viewer on a second device. Confirm both pages show the same roster, `03:00` countdown, timing, wheel result, and winner.

For channel `1468667003366674721`, require exactly one start message with the localized authoritative start time and `https://mochirii.com/account?open=live-draw`, followed by exactly one later edit of that same message ID containing the sanitized winner, draw ID, and roster hash. Confirm the message has no user, role, `@here`, or `@everyone` mention. Do not test another channel, alter channel permissions, register commands, send an extra draw, or delete the genuine result. Export the receipt when required, verify the outbox row reaches `completed`, and record only no-secret identifiers/status evidence.

## Emergency Disable And Rollback Boundaries

If access or rendering is unsafe, immediately promote the prior known-good Website deployment. That removes the normal `/spinner` entry surface but does not reverse the database migration, remove deployed functions, or cancel an already queued delivery.

If outbound delivery is unsafe, use the approved provider controls in this order:

1. Unset the Edge Function secret named `REAPER_SPINNER_DISPATCH_SECRET` so any request already queued with the old value fails closed before claiming the outbox.
2. Remove the Vault entry named `reaper_spinner_dispatch_secret` so inserts and maintenance ticks cannot queue new authenticated dispatcher requests.
3. Leave the shared bot token, channel permissions, receipts, and outbox rows unchanged. Do not use another integration's credential or channel configuration as a kill switch.
4. Confirm no pending row's `attempt_count`, `phase`, or `discord_message_id` changes after the pause. Capture only no-secret status evidence.

The migration is forward-only. Promoting an older Website deployment or reverting function source does not undo tables, receipts, scheduled jobs, triggers, grants, or RLS. Do not hand-delete spinner tables, receipts, jobs, functions, or migration history. Correct a released schema defect with a reviewed forward-fix migration. Use a database restore only for an owner-approved integrity incident after the recovery point and data-loss window are explicitly accepted.

A protected revert or forward-fix merge invokes the same 34-function production integration; review and approve that full redeployment blast radius again. Re-enable delivery only after the fix is green and a new high-entropy dispatcher value is stored identically in the Edge environment and Vault. Never reuse or disclose the disabled value.

## Duplicate Start-Message Reconciliation

The external message post and database update cannot be one transaction. If the start message may have succeeded but `discord_message_id` was not retained, disable delivery as above before the 60-second claim lease expires or any retry runs. Do not retry blindly.

Read only the affected delivery metadata:

```sql
select
  id,
  draw_id,
  phase,
  discord_message_id,
  attempt_count,
  last_error_code,
  created_at,
  reveal_after,
  next_attempt_at,
  claim_expires_at
from public.spinner_discord_outbox
where draw_id = '<draw UUID>'::uuid;
```

Inspect the target channel around `created_at`. Consider only a message authored by Reaper with the exact start copy and `https://mochirii.com/account?open=live-draw`. Require one unambiguous candidate; record its message ID and timestamp without copying unrelated channel content. If there is no candidate, keep the row paused until a second operator confirms the channel history before authorizing a retry. If there are multiple candidates or authorship is ambiguous, keep delivery disabled and obtain explicit approval for which message to retain; do not edit or delete any candidate automatically.

After the claim has expired, an approved operator may adopt the one confirmed message with this targeted transaction. Use an interactive transaction-capable database session, not a one-shot query runner. Replace only the three placeholders, require exactly one returned row, inspect it before commit, and roll back on any mismatch:

```sql
begin;

update public.spinner_discord_outbox
set phase = case
      when reveal_after <= now() then 'result_pending'
      else 'result_waiting'
    end,
    discord_message_id = '<confirmed message ID>',
    next_attempt_at = greatest(reveal_after, now()),
    claim_token = null,
    claim_expires_at = null,
    last_error_code = 'operator_reconciled_start',
    updated_at = now()
where id = '<outbox UUID>'::uuid
  and draw_id = '<draw UUID>'::uuid
  and phase = 'start_pending'
  and discord_message_id is null
  and (claim_expires_at is null or claim_expires_at <= now())
  and '<confirmed message ID>' ~ '^[0-9]{16,22}$'
returning id, draw_id, phase, discord_message_id, attempt_count, last_error_code;
```

Stop after the returned row. Run `commit;` only when it is the exact approved outbox/draw/message tuple; otherwise run `rollback;`. Restore delivery with a newly matched dispatcher value. Require the existing message ID to receive one result edit and the row to reach `completed`; a new start message is a failed reconciliation. Keep receipts and outbox evidence until normal retention removes them.

## Validation

From the repository root:

```powershell
npm ci
npm run toolchain:check
npm run check:private-spinner
npm run test:spinner
npm run check:live-spinner-backend
npm run test:live-spinner-backend
npm run check:supabase-edge-types
npm run check
npm audit --audit-level=moderate
git diff --check
```

From `apps/web`:

```powershell
npm ci
npm run toolchain:check
npm run lint
npm run build
npm run check:client-bundle
npm run check:font-bundle
npm run check:route-css-bundle
npm audit --audit-level=moderate
```

Preview validation must cover signed-out direct access, inactive/unverified members, an active verified viewer, an authorized moderator, exact-mode non-promotion, refresh/back navigation, expired or revoked access, focus/visibility recovery, all motion modes, Skip-before-response, late joins, mobile layout, fullscreen, dropped spin responses, and repeated clicks. Inspect the production network trace to prove the unauthorized 404 loads no spinner stage chunks and the viewer loads no controller chunk. Because Preview is data-less, use and remove controlled identities as described above. Exercise the single post/edit lifecycle only after the exact channel action is approved.

## Standalone Cutover

Browser storage is origin-scoped, so standalone data does not migrate automatically.

1. Before retirement, export the existing standalone roster and every receipt that must be retained.
2. After the protected `main` release and provider changes are explicitly approved, import the roster through the controller at `/spinner` and run one disposable preview draw.
3. Verify viewer synchronization, controller receipt export, unauthorized 404 behavior, and the approved Reaper post/edit lifecycle.
4. Only after explicit owner confirmation, archive the standalone private repository read-only and disable or delete its owner-only deployment.

Do not leave redirects, embedded URLs, credentials, or production links to the retired origin. Asset provenance remains in `docs/integrations/spinner-asset-provenance.md`.
