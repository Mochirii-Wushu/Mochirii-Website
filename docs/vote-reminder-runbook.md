# Discord Vote Reminder Runbook

## Purpose

The vote reminder feature posts daily manual vote links in Discord, records member-clicked `Done voting` confirmations, and reports track-only streaks/status. It must never automate third-party upvotes, vote submissions, CAPTCHA bypasses, browser clicks, vote-site sessions, or rewards that imply a vote was externally accepted.

Source baseline:

- Codex implementation guidance: <https://developers.openai.com/codex/codex-manual.md>
- Discord Interactions: <https://docs.discord.com/developers/interactions/overview>
- Discord responses/components: <https://docs.discord.com/developers/interactions/receiving-and-responding>
- Discord component reference: <https://docs.discord.com/developers/components/reference>
- Supabase scheduled Edge Functions: <https://supabase.com/docs/guides/functions/schedule-functions>
- Supabase Edge Function secrets: <https://supabase.com/docs/guides/functions/secrets>

## Fixed Configuration

```text
Guild: 1078630751077142608
Vote channel: 1082802012095266866
Reminder time: 9 AM America/Los_Angeles
Notification style: no pings
Reward model: track only
Confirmation button custom ID: vote_done:<YYYY-MM-DD>
```

Required Supabase secrets:

```sh
supabase secrets set DISCORD_GUILD_ID=1078630751077142608
supabase secrets set DISCORD_VOTE_CHANNEL_ID=1082802012095266866
supabase secrets set DISCORD_BOT_TOKEN=<set manually, never commit>
supabase secrets set DISCORD_PUBLIC_KEY=<set manually, never commit>
supabase secrets set DISCORD_APPLICATION_ID=1156448856565887066
supabase secrets set DISCORD_MODERATOR_ROLE_IDS=1078630751165222984
supabase secrets set VOTE_REMINDER_TIME_ZONE=America/Los_Angeles
supabase secrets set VOTE_REMINDER_CRON_SECRET=<set manually, never commit>
```

Optional configured links secret:

```sh
supabase secrets set DISCORD_VOTE_LINKS_JSON='{"links":[{"label":"Vote site","url":"https://example.com/server-vote"}]}'
```

Set real vote links only through a secure local shell or the Supabase dashboard. Do not paste real vote links into chat, PR text, screenshots, logs, or committed files. In PowerShell, paste the JSON into a no-echo prompt, then pass it directly to Supabase:

```powershell
$SecureVoteLinksJson = Read-Host "Paste DISCORD_VOTE_LINKS_JSON" -AsSecureString
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureVoteLinksJson)
try {
  $VoteLinksJson = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
}
supabase secrets set "DISCORD_VOTE_LINKS_JSON=$VoteLinksJson" --project-ref deyvmtncimmcinldjyqe
Remove-Variable SecureVoteLinksJson, VoteLinksJson, Bstr
```

If you need to generate a local cron secret on older Windows PowerShell/.NET builds, do not use `RandomNumberGenerator.Fill`. Use one of these compatible forms instead:

```powershell
$Bytes = New-Object byte[] 32
$Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$Rng.GetBytes($Bytes)
[Convert]::ToBase64String($Bytes)
$Rng.Dispose()
```

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

If `DISCORD_VOTE_LINKS_JSON` is not set, Reaper reads pinned messages in the vote channel and parses the first message containing:

```text
[vote-links]
[Vote site](https://example.com/server-vote)
Second vote site - https://second.example.com/server
```

Only HTTPS links are accepted. Duplicate links are ignored. At most 20 link buttons are rendered so the final component row is reserved for `Done voting`.

## Discord Commands

Register or update these guild-scoped commands on the same Discord application:

```text
/vote-status
/vote-leaderboard
/vote-reminder-preview
```

Behavior:

- `/vote-status` returns the caller's current manual confirmation state and streak.
- `/vote-leaderboard` returns the top 10 manual confirmations over the last 30 days.
- `/vote-reminder-preview` requires the configured Moderator role and returns an ephemeral preview without posting to the vote channel.
- The `Done voting` button inserts one confirmation per Discord user per vote date. Duplicate clicks are idempotent.

## Supabase Schedule

Deploying, secret changes, and schedule creation are remote mutations and require owner approval before running.

Local serve:

```sh
supabase functions serve send-vote-reminder --env-file supabase/functions/.env.local
supabase functions serve reaper-discord-interactions --env-file supabase/functions/.env.local
```

Deployment:

```sh
supabase db push --dry-run
supabase db push
supabase functions deploy send-vote-reminder
supabase functions deploy reaper-discord-interactions
```

The additive vote-scheduler migration creates `mochirii-send-vote-reminder`
with schedule `0 16,17 * * *` and immediately marks it **inactive in the same
atomic block**. Publishing or applying the migration does not enable delivery,
create credentials, change the Edge sender, or alter any existing schedule.
An existing matching job or direct sender reference causes a reconciliation
error instead of overwriting it. An indirect scheduler cannot be excluded by
that check and must be reconciled before activation.

The private `dispatch_vote_reminder` routine runs with its caller's privileges.
Browser and service roles cannot execute it. It requires exactly its owned,
active job, unchanged command/schedule/database/role, and GMT or UTC Cron
timezone. Do not change the shared Cron timezone for this feature. It converts
the captured instant to `America/Los_Angeles`, accepting only 09:00 inclusive
through 10:00 exclusive to tolerate delayed Cron execution. Normal ticks target
09:00; a tick delayed past the hour is skipped without automatic catch-up.
During daylight time the valid candidate is 16:00 UTC (00:00 UTC+8 the next
day); during standard time it is 17:00 UTC (01:00 UTC+8 the next day). The
other candidate normally falls outside the target hour. No seasonal schedule
edit or local workstation process is required.

The dispatcher reads exactly one Vault entry named `project_url`, containing
the canonical project origin without a trailing slash, and exactly one named
`VOTE_REMINDER_CRON_SECRET`, matching the Edge secret of that name. The shared
secret must contain 32–256 printable ASCII bytes without whitespace. Missing,
duplicate or invalid configuration queues no request. Store or verify values
only through the approved protected credential channel; never print values or
use this migration to generate, replace or rotate them. Its POST contains only
the Pacific `voteDate`, the existing custom secret header and JSON content
type. The pg_net response deadline is 15 seconds; queued request acceptance
does not prove delivery or cancel an Edge send after a lost acknowledgement.

Before separately approving activation, verify deployed sender/configuration,
secret equality, safe links, exact channel permissions and a successful private
preview. Confirm no direct or indirect competing scheduler. Enable only this
reviewed job after those checks and explicit approval. Observe one natural
09:00 Pacific delivery and its matching `sent` audit row. The existing unique
date/channel index fences `pending` and `sent` rows; it does not promise
exactly-once delivery after a failed or ambiguous send. Preserve pending rows,
reconcile the actual Discord result and obtain approval before any replay.

Preview the payload before enabling Cron:

```sh
curl -X POST "https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/send-vote-reminder?preview=1" \
  -H "Content-Type: application/json" \
  -H "x-mochirii-vote-reminder-secret: <local secret>" \
  -d '{"preview":true}'
```

## Data Model

`vote_confirmations` stores manual confirmations only:

- Discord user ID and optional display name
- vote date
- confirmation timestamp
- Discord guild/channel/interaction IDs
- source fixed to `discord_button` for button clicks

`vote_reminder_sends` stores reminder delivery audit rows:

- vote date
- vote channel and Discord message ID
- link count
- status: `pending`, `sent`, `skipped`, or `failed`
- redacted operational details

Both tables have RLS enabled, no anon/authenticated browser grants, and service-role-only access.

## Validation

Run before finishing implementation work:

```sh
npm run check:vote-reminder
npm run test:vote-reminder
npm run check:reaper-discord-interactions
npm run check:supabase-edge-types
npm run test:supabase-db
git diff --check
```

Run the database suite only against the assigned isolated local project. Its
`vote_reminder_schedule_test.sql` fixtures enable the job and queue synthetic
requests inside one transaction that always rolls back; pg_net sends only
after commit. The test covers both DST transitions, the end-exclusive hour,
session timezone/date-style independence, disabled/configuration drift,
private privileges, destination/secret rejection and the existing send fence.
Never run these fixtures against production or commit their transaction.

Manual production checks:

1. Run `/vote-reminder-preview` in Discord and confirm links, no pings, component rows, and `vote_done:<date>`.
2. Invoke `send-vote-reminder?preview=1` with the cron secret and confirm the payload only.
3. After approved deployment and schedule setup, confirm one message posts in channel `1082802012095266866`.
4. Click `Done voting` once, then again; first click records, second click reports an existing confirmation.
5. Run `/vote-status` and `/vote-leaderboard`.

## Rollback

Disable only `mochirii-send-vote-reminder` first and verify it is inactive.
Keep its definition and delivery audit history for reconciliation; disabling
does not cancel an already queued request or delivered message. A source revert
does not reverse the database migration. If a bad reminder was posted, obtain
approval to delete only that Reaper-created message. Do not delete unrelated
Discord messages, user profiles, gallery data, rank roles or scheduled events.
