# Reaper Pending Verification Containment

Reaper can repair pending-verification Discord visibility with the Supabase-hosted Discord Interactions function:

```text
/sync-pending-verification mode:<preview|apply> confirm:<true|false>
```

This is a containment backstop, not the primary onboarding model. Discord Rules Screening, Community Onboarding, AutoMod, Raid Protection, verification level, role hierarchy, and moderator 2FA stay separate Discord-native controls.

## Scope

The command targets only members whose Discord member `roles` array is exactly:

```text
["1468659807736299520"]
```

Members with role `1078630751077142615`, any extra role, or a bot user are skipped. Reaper manages only member-specific channel overwrites for the target members. In the two allowed text channels it owns `VIEW_CHANNEL`, `SEND_MESSAGES`, and `READ_MESSAGE_HISTORY` allows; outside those channels it owns only `VIEW_CHANNEL` denies. It does not grant or deny voice, moderation, invite, mention, event, or thread permissions.

The allowed channels are:

```text
1468658915594997760
1480143854014300335
```

## Permission Model

Reaper uses member-specific permission overwrites, because Discord applies member overwrites after role overwrites. This avoids helper-role deny collisions when another role has an explicit `VIEW_CHANNEL` allow.

On apply:

- Inside the allowed channels, Reaper adds its tracked member-specific `VIEW_CHANNEL`, `SEND_MESSAGES`, and `READ_MESSAGE_HISTORY` allows and removes only its tracked `VIEW_CHANNEL` deny.
- Outside the allowed channels, Reaper adds its tracked member-specific `VIEW_CHANNEL` deny and removes only its tracked allowed-channel bits.
- All unrelated allow and deny bits are preserved.
- Members that no longer match the target predicate have only Reaper-owned containment bits removed.
- A member overwrite is deleted only when no manual bits remain after Reaper-owned bits are removed.

Manual member-specific conflicts block apply:

- A non-Reaper `VIEW_CHANNEL` allow outside the allowed channels.
- A non-Reaper deny for `VIEW_CHANNEL`, `SEND_MESSAGES`, or `READ_MESSAGE_HISTORY` inside the allowed channels.

Preview lists conflict channels so a moderator can make an intentional Discord-side decision first.

## Storage And Logs

Reaper stores only owned permission bits in service-role-only table `discord_managed_permission_overwrites`. Browser clients receive no direct grants.

Each preview and apply writes a redacted `discord_sync_log` row with `sync_type: "role_check"`. Logs contain counts and IDs only. Do not store tokens, webhook URLs, private message content, raw interaction tokens, or unrestricted Discord message content.

Gateway forwarding, manual apply and rollback share a separate durable guild
fence and permanent request receipts. Every provider or owned-registry write
checks the current owner. Unknown write outcomes block later writers without
expiry or automatic takeover. Completed receipts remain authoritative even
when their HTTP acknowledgment or diagnostic log is lost. The additive policy
starts disabled and needs separate activation after normal Git publication,
legacy-worker drain and exact deployed-contract verification.

## Live Command Rules

Preview is the safe first command:

```text
/sync-pending-verification mode:preview confirm:false
```

Apply requires all of:

- The expected guild `1078630751077142608`.
- The configured Moderator role `1078630751165222984`.
- Discord `MANAGE_ROLES` on the invoking moderator.
- `confirm:true`.
- No manual conflicts.
- Planned Discord overwrite writes at or below the max-mutation guard.

Live apply remains owner/moderator approved:

```text
/sync-pending-verification mode:apply confirm:true
```

Discord audit log reasons on permission writes use:

```text
Reaper pending verification containment
```

Responses are ephemeral. Do not publicly shame or announce contained users.

## Gateway Follow-Up

Full automatic coverage is a second release after the slash-command repair path. The private Reaper Gateway worker posts redacted `guildMemberAdd` and role-changing `guildMemberUpdate` events to:

```text
reaper-discord-member-sync
```

That Edge Function requires header `x-mochirii-reaper-member-sync-secret` and a
stable UUIDv4 `request_id`, fetches the current Discord member before mutating,
and uses the same shared containment policy as `/sync-pending-verification`.
It blocks manual conflicts, enforces the same max-mutation guard, and writes
redacted `discord_sync_log` rows. Its authenticated status route resolves lost
acknowledgments through the permanent receipt; malformed 2xx responses never
establish success. The hosted Gateway retains its private request spool across
restarts and never assigns a new UUID to retry uncertain work.

Gateway requirements:

- Use only `Guilds` and `GuildMembers` intents.
- Do not request Message Content or Presence intents.
- Do not mutate roles or channel permissions directly.
- Do not store Supabase service-role keys in the Gateway runtime.
- Keep Discord bot tokens and server-to-server secrets in private runtime secrets only.

See [`reaper-pending-verification-activation-packet.md`](reaper-pending-verification-activation-packet.md) for the release gate, endpoint contract, and rollback steps.

## Validation

Run before deployment:

```sh
npm run check:reaper-discord-interactions
npm run check:discord-reaper-parity
npm run check:supabase-edge-types
npm run test:reaper-member-sync
npm run check
git diff --check
```

Primary references:

- [Discord permissions](https://docs.discord.com/developers/topics/permissions)
- [Discord channel permissions API](https://docs.discord.com/developers/resources/channel)
- [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits)
- [Discord privileged intents](https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents)
- [Community Onboarding FAQ](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ)
- [Rules Screening FAQ](https://support.discord.com/hc/en-us/articles/1500000466882-Rules-Screening-FAQ)
- [Raid Protection](https://support.discord.com/hc/en-us/articles/10989121220631-How-to-Protect-Your-Server-from-Raids-101)
