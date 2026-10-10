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
- Each activity has one stable key and one scheduled event. Legacy weekday mappings are consolidated only by their managed IDs: preserve the live daily Guild Party `1558076114486698016`, keep the unambiguous upcoming Breaking Army entry, remove only the reviewed owned duplicate, and retire superseded registry rows without deleting history. Unregistered same-title events require explicit adoption.
- A matching title, time and location does not establish ownership. An existing event must have an explicit canonical ID or an enabled Reaper-managed registry mapping; otherwise preview requires separate adoption approval.
- Preview validates the complete schedule, event identities and every distinct cover before apply. Schedule and cover fetches accept only bounded responses from the canonical HTTPS website paths, without redirects. Verify any runtime `GUILD_SCHEDULE_URL` override resolves to the approved source without exposing other environment values.
- Apply reserves the guild through `private.reaper_event_sync_runs` before reading the plan. Interaction IDs remain deduplicated, and each provider or registry write checks the reservation owner. Reservations never expire or transfer automatically.
- When a completed or missing Discord event is replaced, Reaper records the replacement first and then disables only the superseded managed registry row for the same key.
- Reaper compares the actual Discord fields and validated cover bytes before writing. A cover is unchanged only when its SHA256 and the returned Discord image hash match a recorded receipt and the current event. An old cover URL alone is insufficient; the first apply after this repair may upload that cover once. Registry-only drift is repaired without a Discord PATCH when the provider fields and cover receipt already agree.
- Event sync uses its own bounded transport. It does not automatically retry a rate-limited request. A valid Discord cooldown, or an invocation deadline reached before sending a request, may pause a run only at a confirmed boundary where earlier acknowledgements and registry writes are durable. The full cooldown is stored; it is never shortened to fit an Edge worker.
- Successful-response cooldowns belong to the observed HTTP method, normalized route and guild resource. Reaper learns shared bucket identities from bounded `X-RateLimit-Bucket` headers; an exhausted list-request bucket must not block an unrelated write route. A route with no valid learned bucket remains route scoped; missing or malformed later headers do not erase a known shared identity. Before another request in a known exhausted bucket, Reaper may wait the complete remaining reset interval only when that interval and a full request slot fit the existing invocation deadline. It checks the deadline and reservation owner again before sending. A cooldown that cannot fit causes a terminal pause with the full retry time; an actual HTTP429 still stops without automatic replay.
- A paused interaction is terminal and remains permanently deduplicated. Another apply requires a new interaction, fresh complete preview and current owner approval after the cooldown. This is an operator-controlled continuation with a newly reviewed plan, not automatic replay of the previous plan.

## Schedule Rules

- Monthly gathering: first Sunday monthly, 24:00–25:00 UTC+8, represented as the following Monday 00:00–01:00 with `next-first-sunday` and `startDayOffset: 1`. Its UTC start/end are Sunday 16:00–17:00, so Discord's first-Sunday recurrence (`n: 1`, `day: 6`) matches this rule. This is not always the first Monday of the month.
- Monthly raffle: first Saturday monthly, 9:30 PM - 10 PM UTC+8, synced as the recurring Discord event `1479507429598302268` with location `Guild Base Pool`.
- Guild Party: every day, 9:30 PM - 10 PM UTC+8.
- Breaking Army: Mondays and Wednesdays, 10 PM - 12 AM UTC+8.
- Showdown: Tuesdays and Thursdays, 10 PM - 12 AM UTC+8.
- Guild Wars: Saturdays and Sundays, 8:30 PM - 11:00 PM UTC+8.
- Skyward Bond: Fridays, 10:00 PM - 11:00 PM UTC+8. The existing internal `united-resolve` key stays stable for managed-event identity.
- Guild Hero's Realm: Fridays, 11:00 PM - 12:00 AM UTC+8, ending on Saturday.

Reaper manages 8 event types and 8 scheduled events, one per activity. Party uses native daily recurrence; Wars uses the supported Saturday/Sunday pair; Skyward Bond and Hero's Realm use native Friday recurrence. Monthly events retain their native rules and canonical identities. Valid native anchors remain unchanged after later occurrences pass; their UTC clock, duration and complete recurrence selectors must still agree with the authority.

Discord cannot represent Monday/Wednesday or Tuesday/Thursday as one native series. Breaking Army and Showdown therefore each have one upcoming nonrecurring event. Hosted Reaper upkeep advances only these two activities after their prior occurrence ends. Twitch streams are Website display content, not guild scheduled events.

## Hosted Rolling Advancement

The additive `20261010160737_reaper_event_advancement.sql` migration installs a disabled policy and a minute cron tick. Disabled ticks perform no network request. Activation is a separate approved provider operation after the release, manual consolidation and eight-key registry/provider readback pass. `reaper_set_event_advancement(true)` requires the exact guild, eight unique managed activities, the preserved Party/gathering/raffle IDs, valid UTC metadata, and no unresolved dispatch, active writer or cooldown. Disabling uses the same RPC with `false`.

The database selects only due Breaking Army/Showdown mappings, allowing two minutes after the exclusive end for Discord to finish the external event. It dispatches to the fixed production `/reaper-discord-interactions/advance` route with a short-lived random capability. Only its hash persists in the capability ledger; the bounded request carries no schedule, event ID or arbitrary destination. The Edge route rejects a different runtime project or guild before any provider request. Ordinary Discord interactions still require their Ed25519 signatures.

Capability consumption and the existing guild reservation are atomic. One-use capabilities cannot replay, transfer ownership or bypass a manual apply. Synthetic upkeep identities are disjoint from real Discord snowflakes. The worker loads the published canonical schedule and confirms the previous owned occurrence is completed, nonrecurring, and matches its recorded UTC start/end. If absent from the list, it reads that exact owned ID; a 404 or uncertain response stops for reconciliation rather than inferring completion. It then creates and records only the next occurrence. Completed provider events and superseded registry history remain retained. It never changes Party, Wars, Friday series, monthlies or unrelated events.

A timeout, expired capability, paused/blocked/rejected run, registry drift or uncertain acknowledgement disables further upkeep. No automatic replay, retry, reservation takeover or cooldown bypass is allowed. Reconcile the exact dispatch, worker, Discord event, registry receipt and reservation before separately approved reactivation. Historical terminal pauses predating activation remain evidence and are never resumed. Source rollback does not reverse registry or provider changes; disable the policy before an approved rollback or forward fix.

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

The preview should show eight activities, including exactly one recurring `Monthly Guild Gathering` on the Monday after the first Sunday from 00:00 to 01:00 UTC+8 (for example, 2 Nov 2026 or 8 Feb 2027). The regular 21:30 Guild Party remains because its slot no longer overlaps. Verify Skyward Bond Friday 22:00–23:00 followed by Hero's Realm 23:00–00:00, retain the canonical raffle pending a separate decision, and create no duplicates. Only an exactly overlapping monthly start, end and Website location suppresses that weekly occurrence; choose the activity's next nonconflicting occurrence. Potentially colliding activities remain rolling because native recurrence cannot exclude one date. If the explicit duplicate one-off raffle event `1513742240760070144` still exists, preview reports it as a duplicate removal. Every legacy consolidation removal must identify its owned event and keeper. Only after the preview output is clean and owner approval is current, run:

Do not run `apply` if preview shows duplicate creates, ambiguous registry mappings, multiple exact matches, unexpected missing managed events, unexpected title/time/recurrence drift, or any unmanaged Discord event that would be touched.

```text
/sync-events mode:apply confirm:true
```

## Rollback

If the apply step creates incorrect Discord events, first disable hosted advancement, then cancel or edit only the Reaper-managed events shown in the approved preview/apply output. Correct the source through the normal reviewed release. Do not delete unrelated Discord events. Duplicate removal is limited to explicit `discordDuplicateEventIds` and unambiguous owned legacy activity mappings in the reviewed plan.

## Interrupted or Uncertain Apply

An unconfirmed Discord request, registry update or reservation transition stops the run. A writing or blocked reservation prevents another apply; do not retry with a new interaction, expire the lock, or assume a timeout means Discord rejected the request. A preflight failure may release a reservation as rejected only before writing starts.

For recovery, first establish that the prior function worker has terminated. Read back the guild's Discord events, managed registry rows and exact reservation identity, then reconcile every attempted mutation. Prepare a reviewed, separately approved forward migration for that exact guild, interaction and owner if the reservation needs a terminal state. Record the reconciled outcome and finish time without deleting the deduplication record. Ordinary sync RPCs intentionally cannot clear a blocked reservation. Run a fresh clean preview after recovery before another approved apply. A source revert does not undo either provider writes or the migration.

## Rate-Limited or Deadline Pause

A paused response is incomplete. Review its acknowledged actions and stored retry time; do not report a completed sync. The guild reservation RPC rejects a new apply during the stored cooldown. The paused interaction itself can never be resumed or replayed.

After the cooldown, confirm the prior worker has terminated and reconcile Discord, registry receipts and run states. Run a new preview against the currently published schedule and covers. If the dates, source, ownership or proposed actions changed, review the new plan before requesting another exact apply approval. Previously verified events should appear unchanged; URL-only historical rows may still need one controlled cover upload. Preserve unrelated events and the inactive website raffle policy.

Network failures, request/body timeouts, malformed successful responses, lost acknowledgements, registry failures and failed reservation transitions remain uncertain and require reconciliation. Unconfirmed writes retain a writing or blocked reservation. If a pause or completion committed but its acknowledgement was lost, the actual row may already be terminal; verify it rather than assuming either success or a blocked state. The failed worker must issue no further writes. A local invocation deadline and `waitUntil` do not prove worker termination or extend platform limits.

Primary references: [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits), [Discord scheduled event objects](https://docs.discord.com/developers/resources/guild-scheduled-event), [Supabase background task limits](https://supabase.com/docs/guides/functions/background-tasks).
