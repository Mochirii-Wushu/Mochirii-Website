# Reaper Event Sync Runbook

## Purpose

Reaper syncs the website schedule into Discord Scheduled Events after the website release is live. The source of truth is `apps/web/public/data/guild-schedule.json`, served at:

```text
https://mochirii.com/data/guild-schedule.json
```

## Command

```text
/sync-events mode:<preview|apply> confirm:<true|false>
```

Rules:

- Preview first; provider mutation is never the first sync action.
- `preview` never changes Discord.
- `apply` requires `confirm:true`.
- The caller must have the configured Moderator role.
- `apply` also requires Discord Create Events and Manage Events permissions.
- Events are external scheduled events. Most Discord event locations point to `https://mochirii.com/events`, but schedule items may provide a Discord-specific location such as `Guild Base Pool`.
- Event cover images come from `discordCoverImage` paths in `apps/web/public/data/guild-schedule.json` under `apps/web/public/assets/`. Keep complete 1600×640 artwork at 5:2, with matching frame/text margins and no adjacent contact-sheet panels or blurred letterboxing. Bump `discordCoverVersion` whenever bytes change at the existing paths; Reaper caches images by the versioned URL, and Website uses the same version in its public image URLs.
- Reaper records managed Discord event IDs in `discord_resources` with `managedBy: "reaper-event-sync"`.
- Exactly one enabled managed registry row may exist for each `siteEventKey`. Preview fails closed if a key has ambiguous enabled mappings or multiple exact Discord matches.
- A matching title, time and location does not establish ownership. An existing event must have an explicit canonical ID or an enabled Reaper-managed registry mapping; otherwise preview requires separate adoption approval.
- Preview validates the complete schedule, event identities and every distinct cover before apply. Schedule and cover fetches accept only bounded responses from the canonical HTTPS website paths, without redirects. Verify any runtime `GUILD_SCHEDULE_URL` override resolves to the approved source without exposing other environment values.
- Apply reserves the guild through `private.reaper_event_sync_runs` before reading the plan. Interaction IDs remain deduplicated, and each provider or registry write checks the reservation owner. Reservations never expire or transfer automatically.
- When a completed or missing Discord event is replaced, Reaper records the replacement first and then disables only the superseded managed registry row for the same key.

## Schedule Rules

- Monthly gathering: first Sunday monthly, 24:00–25:00 UTC+8, represented as the following Monday 00:00–01:00 with `next-first-sunday` and `startDayOffset: 1`. Its UTC start/end are Sunday 16:00–17:00, so Discord's first-Sunday recurrence (`n: 1`, `day: 6`) matches this rule. This is not always the first Monday of the month.
- Monthly raffle: first Saturday monthly, 9:30 PM - 10 PM UTC+8, synced as the recurring Discord event `1479507429598302268` with location `Guild Base Pool`.
- Guild Party: every day, 9:30 PM - 10 PM UTC+8.
- Breaking Army: Mondays and Wednesdays, 10 PM - 12 AM UTC+8.
- Showdown: Tuesdays and Thursdays, 10 PM - 12 AM UTC+8.
- Guild Wars: Saturdays and Sundays, 8:30 PM - 11:00 PM UTC+8.
- Skyward Bond: Fridays, 10:00 PM - 11:00 PM UTC+8. The existing internal `united-resolve` key stays stable for managed-event identity.
- Guild Hero's Realm: Fridays, 11:00 PM - 12:00 AM UTC+8, ending on Saturday.

## Release and Provider Gate

- Merge only after exact release approval names the reviewed head, normal Vercel publication, and the protected-main Supabase Git integration deployment.
- Establish an approved cutover window that holds all `/sync-events` apply invocations before migration/deployment and through verification. Legacy workers do not use the new reservation table. Record the last possible legacy acceptance time and establish that every legacy apply worker has terminated before allowing a new apply. Use execution telemetry or a conservative drain based on the current platform worker lifetime plus margin while the invocation hold remains effective; a returned response, request timeout or new function version alone does not prove termination. [Supabase's current limits](https://supabase.com/docs/guides/functions/limits) document worker lifetimes up to 150 seconds on Free and 400 seconds on paid plans. If the hold or drain cannot be established, keep apply blocked.
- The reservation migration must pass the isolated local database suite and be applied through the normal integration before the new function code handles apply requests.
- Never deploy these functions manually. The existing integration redeploys the 33 functions declared in `supabase/config.toml`; post-merge readback must show every function advancing exactly once, all active, with 20 `verify_jwt=true` and 13 false.
- Before any Discord preview, verify that Vercel production is exactly bound to the merged Website commit and that the automatic Supabase deployment and 20/13 parity readback passed.
- After the legacy-worker drain and deployment, read back Discord events, managed registry rows and reservation state before a fresh preview. Reconcile any unexpected legacy writes before releasing the apply hold.
- The existing guild-scoped `/sync-events` command retains its `mode` (`preview` or `apply`) and `confirm` options; this schedule change does not require command re-registration.

Run:

```text
/sync-events mode:preview confirm:false
```

The preview should show exactly one recurring `Monthly Guild Gathering` on the Monday after the first Sunday from 00:00 to 01:00 UTC+8 (for example, 2 Nov 2026 or 8 Feb 2027). The regular 21:30 Guild Party remains because its slot no longer overlaps. Verify Skyward Bond Friday 22:00–23:00 followed by Hero's Realm 23:00–00:00, retain the canonical raffle pending a separate decision, and create no duplicates. Only an exact monthly/weekly start, end, and Website-location collision advances the stable weekly key by seven days. If the explicit duplicate one-off raffle event `1513742240760070144` still exists, preview reports it as a duplicate removal. Only after the preview output is clean and owner approval is current, run:

Do not run `apply` if preview shows duplicate creates, ambiguous registry mappings, multiple exact matches, unexpected missing managed events, unexpected title/time/recurrence drift, or any unmanaged Discord event that would be touched.

```text
/sync-events mode:apply confirm:true
```

## Rollback

If the apply step creates incorrect Discord events, cancel or edit only the Reaper-managed events shown in the preview/apply output, then revert the website schedule branch or correct `apps/web/public/data/guild-schedule.json` and redeploy. Do not delete unrelated Discord events. Duplicate removal is intentionally limited to IDs listed in `discordDuplicateEventIds`.

## Interrupted or Uncertain Apply

An unconfirmed Discord request, registry update or reservation transition stops the run. A writing or blocked reservation prevents another apply; do not retry with a new interaction, expire the lock, or assume a timeout means Discord rejected the request. A preflight failure may release a reservation as rejected only before writing starts.

For recovery, first establish that the prior function worker has terminated. Read back the guild's Discord events, managed registry rows and exact reservation identity, then reconcile every attempted mutation. Prepare a reviewed, separately approved forward migration for that exact guild, interaction and owner if the reservation needs a terminal state. Record the reconciled outcome and finish time without deleting the deduplication record. Ordinary sync RPCs intentionally cannot clear a blocked reservation. Run a fresh clean preview after recovery before another approved apply. A source revert does not undo either provider writes or the migration.
