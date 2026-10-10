# Reaper Pending Verification Activation Packet

This packet separates pending-verification containment into two owned releases:

1. Supabase slash-command repair path.
2. Private Reaper Gateway member-event forwarding.

Publish and verify the Website backend before activating the Gateway. Each
release and activation requires its exact approved scope. Live provider
mutations stay owner/moderator approved.

## Approval-Required Live Mutations

- Protected Website merge and the normal Vercel/Supabase Git publication, including migrations.
- `reaper_set_pending_containment_enabled(true)` or `false` through the service-role-only RPC.
- `npm run register:reaper-pending-verification-command -- --apply`
- Discord `/sync-pending-verification mode:apply confirm:true`
- `npm run rollback:reaper-pending-verification -- --apply --confirm-guild=1078630751077142608`
- Private Reaper Gateway image publication, paid hosting, credential configuration and deployment.

Dry runs, static validation, local type checks, and PR checks are safe local/repo work.

## Local Validation

Run from the isolated Website checkout being reviewed:

```sh
npm run check:reaper-discord-interactions
npm run check:reaper-pending-verification
npm run test:reaper-member-sync
npm run check:discord-reaper-parity
npm run check:supabase-edge-types
npm run check
git diff --check
```

If website files under `apps/web` changed, also run:

```sh
cd apps/web
npm run lint
npm run build
```

## Release 1: Slash Command Repair Path

1. Hold pending-containment apply, rollback and Gateway forwarding throughout
   publication and verification. Drain every possible legacy writer using
   execution telemetry or the current maximum Edge worker lifetime plus margin.
2. Open the exactly approved scoped PR from the implementation branch.
3. Wait for required GitHub checks, exact Vercel Preview and repository checks.
4. Merge only after exact review and approval through the protected path.
5. Verify the normal Supabase Git integration applies the additive migrations
   and redeploys all 33 declared functions, with 20 JWT-enabled and 13 disabled.
   Verify exact deployed source and active function versions. Never manually
   deploy functions or bypass migration history with a direct database push.
6. Confirm migration state through authenticated read-only provider evidence.
   When the reviewed checkout is already linked, these optional diagnostics
   remain read-only:

```sh
supabase migration list
supabase db push --dry-run
```

7. The `20261010173229_reaper_pending_containment_receipts.sql` migration installs
   a disabled policy and durable request receipts. Keep it disabled until the
   new Gateway contract, credential target, permissions and writer drain are
   verified. Activation is a separately approved provider operation.
8. Dry-run the Discord command registration if current command evidence requires it:

```sh
npm run register:reaper-pending-verification-command
```

9. Only if required and separately approved, upsert `/sync-pending-verification`:

```sh
npm run register:reaper-pending-verification-command -- --apply
```

The registration script must use `default_member_permissions: "268435456"` for Discord `MANAGE_ROLES`, `dm_permission: false`, and POST/PATCH only the named guild command.

## Discord-Native Safety Checklist

Before live apply, confirm:

- Channels `1468658915594997760` and `1480143854014300335` are the only intended chat surfaces for WWM-only, non-Verified members.
- Rules Screening and Community Onboarding are intentionally configured.
- AutoMod mention-spam controls and Raid Protection alerts are configured.
- Verification level and role hierarchy match current moderator expectations.
- Moderator accounts use 2FA.
- Non-admin and non-moderator roles cannot mention `@everyone`, `@here`, or all roles unless explicitly intended.
- Reaper can edit channel permission overwrites and its role position is adequate.

Do not publicly announce contained users. Slash-command responses stay ephemeral and operational logs stay private/redacted.

## Live Preview And Apply

1. Run:

```text
/sync-pending-verification mode:preview confirm:false
```

2. If preview lists manual conflicts, resolve those exact member-specific `VIEW_CHANNEL` conflicts in Discord and rerun preview.
3. After owner/moderator approval, run:

```text
/sync-pending-verification mode:apply confirm:true
```

4. Verify:

- A WWM-only unverified test member can see and chat only in channels `1468658915594997760` and `1480143854014300335`.
- The same test member cannot see WWM gallery, events, guides, announcements, spotlight, voice, supporter, admin, or other private channels.
- A verified member or extra-role member has Reaper-owned overwrites removed.
- `discord_sync_log` contains redacted `role_check` entries.
- Discord audit log entries include `Reaper pending verification containment`.

## Release 2: Gateway Automation

The private Reaper Gateway worker posts member add/update events to:

```text
https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/reaper-discord-member-sync
```

Endpoint contract:

```json
{
  "request_id": "<stable UUIDv4>",
  "event_type": "guildMemberAdd | guildMemberUpdate",
  "guild_id": "1078630751077142608",
  "discord_user_id": "<snowflake>",
  "roles": ["<snowflake>"],
  "gateway_sequence": 123,
  "occurred_at": "2026-06-12T00:00:00.000Z"
}
```

The endpoint has `verify_jwt = false` and requires header `x-mochirii-reaper-member-sync-secret`. It fetches the current Discord member before mutating, uses the shared containment policy, blocks manual conflicts, enforces the same max-mutation guard, logs redacted counts, and writes only tracked member-specific containment overwrites.

The authenticated `GET` route at the same URL plus `/status?request_id=<UUIDv4>`
reads the permanent receipt without writing. A completed acknowledgment has
exact fields `ok`, `request_id`, `status` and `result`, with `status: "completed"`
and bounded integer counts `discordWrites`, `dbWrites`, `staleRecordsCleared`.
A generic 2xx response is insufficient. Redirects, different origins or paths,
oversized responses and malformed receipts are rejected.

Gateway, manual slash apply and rollback share one durable guild fence.
Request namespaces and immutable input hashes prevent replay with a changed
body. A writing or blocked fence never expires or transfers automatically.
Known pre-acquisition busy/disabled responses can retry the same request;
uncertain writes require receipt lookup and reconciliation. Never create a new
request identity to bypass a pending receipt.

Gateway requirements:

- Use only `Guilds` and `GuildMembers` intents.
- Listen to `guildMemberAdd` and role-changing `guildMemberUpdate`.
- Do not request Message Content or Presence intents.
- Do not mutate roles or channel permissions directly.
- Do not store Supabase service-role keys in the Gateway runtime.
- Persist each immutable UUID-bound request in the private host spool before
  sending. Drain sequentially, retain uncertain or blocked work across restart,
  and remove a record only after its exact completed receipt. Queue, disk or
  receipt failures must produce a redacted readiness fault.
- Keep recovery credentials in the existing Proton-synced local Creds boundary;
  protected hosted runtime credentials and queue state must operate without it.

Validation from the isolated `Mochirii-Wushu/Reaper-Discord-Bot` checkout uses
that repository's pinned Bun build/check toolchain and Node runtime:

```sh
bun run check
bun run check:container
```

Deploy the Gateway only after those checks pass and owner approval is given.

## Rollback

Immediate stop:

1. After exact approval, disable the containment policy and Gateway forwarding.
2. Establish that every in-flight worker terminated and reconcile its permanent
   receipt before changing code or resuming a writer. Disabling admission does
   not undo completed Discord writes or stop an already admitted worker.
3. Correct source through normal reviewed Git publication. Do not restore an
   unfenced writer or clear a blocked receipt to force progress.

Permission cleanup dry run:

```sh
npm run rollback:reaper-pending-verification
```

After approval:

```sh
npm run rollback:reaper-pending-verification -- --apply --confirm-guild=1078630751077142608 --request-id=<approved-stable-UUIDv4>
```

Rollback apply also requires separately approved containment admission. Hold
Gateway forwarding and manual applies, drain and reconcile all prior writers,
then enable admission for the approved fenced rollback and disable it again
after verifying its terminal receipt. Retain the same request ID after an
uncertain response; never replay under a new identity.

The rollback script removes only Reaper-owned containment bits tracked in `discord_managed_permission_overwrites`. It preserves manual bits and marks cleared registry rows inactive. Database table removal is not required for emergency stop.

## Evidence Fields

Record these in the PR or private operator note:

- Branch and commit SHA.
- GitHub/Vercel/Supabase check status.
- Supabase migration list result.
- Automatic Supabase publication timestamp, exact deployed source and function-version parity.
- Policy state, request identity and terminal receipt; no raw secret or private payload.
- Gateway immutable image digest, supervisor/reboot/readiness and protected spool recovery evidence.
- Command registration dry-run/apply output.
- Preview target count, conflict count, planned Discord write count, and registry write count.
- Apply result counts.
- Test member visibility result.
- `discord_sync_log` row timestamp.
- Discord audit log timestamp.
- Rollback dry-run output if rollback is needed.

## Source Basis

- [Discord permissions](https://docs.discord.com/developers/topics/permissions)
- [Discord channel permissions API](https://docs.discord.com/developers/resources/channel)
- [Discord rate-limit guidance](https://support-dev.discord.com/hc/en-us/articles/6223003921559-My-Bot-is-Being-Rate-Limited)
- [Discord privileged intents](https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents)
- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Edge Function deploys](https://supabase.com/docs/guides/functions/deploy)
- [Vercel Preview environments](https://vercel.com/docs/deployments/environments)
