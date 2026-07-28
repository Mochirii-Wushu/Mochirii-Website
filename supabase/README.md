# Supabase Integration

Project ref: `deyvmtncimmcinldjyqe`

Project URL: `https://deyvmtncimmcinldjyqe.supabase.co`

This repository serves the live Vercel/Next.js production app from `apps/web`.
Keep browser integration limited to public keys, privileged work in Edge
Functions, and schema changes migration-based. Do not commit real secrets or
`.env` files.

## Rules

- Browser code may only use the Supabase URL and publishable key.
- Secret keys, service-role keys, database passwords, JWT secrets, Discord bot tokens, and private environment values stay outside public files.
- Database schema changes should be created through Supabase migrations.
- Tables exposed to browser clients require explicit grants and RLS policies.
- anon access should be minimal and feature-specific.
- service_role should be reserved for trusted backend/admin workflows.
- GitHub Pages cannot safely hold private server-side secrets.
- Edge Functions or another backend must be used for privileged workflows.
- Do not run `supabase db push` unless a future task explicitly approves remote database mutation.
- Do not deploy Edge Functions unless a future task explicitly approves deployment.
- Protected page text must not be changed for auth/gallery-upload work.

## Edge Function Dependencies

Every deployed function owns a local `deno.json` with exact direct dependency
versions, following [Supabase's function dependency guidance](https://supabase.com/docs/guides/functions/dependencies).
The Supabase CLI uses that file as Deno configuration when bundling a function;
it does not upload the repository root `deno.lock`. Accordingly,
`npm run check:supabase-edge-types` checks all 31 entrypoints with their real
function-local configuration and no deployment lock, records and audits each
entrypoint's current resolution in its own temporary lock, and separately audits
the repository lock used by local tooling. Never describe the root lock as
freezing the deployed transitive graph.

## Pixelfed Guild Social Mapping

Pixelfed is planned as a separate `social.mochirii.com` runtime, not as code inside this website repo. Supabase remains the identity and membership authority for the doorway and OAuth consent flow. The staging runtime exists outside Vercel; first authenticated testing is admin-only until the source-control, OIDC, media, backup, and moderation gates pass.

`social_accounts` maps a signed-in website member to a future Pixelfed account. Trusted server/operator workflows own Pixelfed identity fields such as `provider_subject`, `provider_user_id`, `username`, `profile_url`, `status`, and sync timestamps. Authenticated members may read only their own rows and may update only `profile_link_visible`; that field is retained for backend compatibility while website member profile publishing is retired.

The table intentionally does not grant direct insert/delete access to `authenticated`. The trusted write path is the `sync-pixelfed-social-account` Edge Function, which keeps the service-role key inside Supabase and accepts only a narrow Pixelfed host sync secret. Production SSO, federation enablement, broad member uploads, Spaces media migration, and any remote database/Auth/Function setting changes remain approval-gated provider work. See [`../docs/pixelfed-guild-social-adr.md`](../docs/pixelfed-guild-social-adr.md), [`../docs/pixelfed-first-login-testing.md`](../docs/pixelfed-first-login-testing.md), and [`../docs/pixelfed-staging-ops.md`](../docs/pixelfed-staging-ops.md).

## Member-Owned Profile Links

`member_social_links` is the separate member-owned URL surface for optional
external profiles. It does not extend `social_accounts` and stores no OAuth
identity, access token, password, imported content, or provider metadata. The
browser normalizes direct HTTPS profile URLs without contacting the destination
and the database repeats fail-closed provider/hostname checks.

RLS keeps new rows private, limits all writes to the owner, and allows another
authenticated user to read an explicitly visible row only when both accounts
pass the current verified-member predicate. The table has explicit Data API
grants because new tables are not assumed to be exposed automatically. The
website retains no member directory; Account is the management and self-preview
surface.

## Browser Helper

`supabase.js` attaches `window.MochiriiSupabase` before `site.js` and page scripts run. It preserves:

- `getConfig()`
- `request(path, options)`
- `select(table, query)`
- `insert(table, payload)`
- `probe()`

It also exposes Auth/profile/gallery helpers:

- `getClient()`
- `getSession()`
- `getUser()`
- `onAuthStateChange(callback)`
- `signInWithProvider(provider, options)`
- `signInWithPhoneOtp(options)`
- `verifyPhoneOtp(options)`
- `linkProviderIdentity(provider, options)`
- `getLinkedIdentities()`
- `signInWithDiscord(options)` compatibility wrapper
- `signOut()`
- `getCurrentProfile()`
- `updateCurrentProfile(payload)`
- `verifyDiscordMembership()` compatibility check
- `verifyMemberAccess(options)`
- `requireAuth(options)`
- `requireVerifiedGuildMember(options)`
- `requireActiveMember(options)`
- `renderAuthNavState()`
- `uploadMemberGalleryImage(file, metadata)`
- `listMyGallerySubmissions()`
- `checkLeaderGalleryModerationAccess()`
- `listGalleryReviewQueue()`
- `moderateGallerySubmission(submissionId, action, reason)`
- `listInstagramPublishQueue()`
- `publishInstagramGallerySubmission(options)`
- `listApprovedGallerySubmissions()`

Instagram production migration and Edge Functions are deployed. Reaper rollout, Instagram secret setup, dry-run payloads, and any live Instagram post are tracked in [`../docs/instagram-gallery-publishing-deployment-runbook.md`](../docs/instagram-gallery-publishing-deployment-runbook.md).

Migration history note: keep `supabase/migrations/20260607094500_restore_instagram_gallery_publishing_history.sql` and `supabase/migrations/20260608093407_restore_manual_instagram_share_history.sql` in place. The Instagram publishing schema now lives in `supabase/migrations/20260607125027_add_instagram_gallery_publishing.sql`, and the manual sharing status schema now lives in `supabase/migrations/20260608173000_add_manual_instagram_share_status.sql`, but Supabase Preview compares remote migration versions to local files and needs the original timestamps represented locally.

Production Reaper gallery submission handling is Supabase-hosted through Discord Interactions, not a persistent Discord Gateway process. The Discord Interactions Endpoint URL is:

```text
https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/reaper-discord-interactions
```

The `reaper-discord-interactions` function validates Discord request signatures with `DISCORD_PUBLIC_KEY`, answers Discord PING requests, accepts the guild-scoped `/submit image:<file> [title:<title>] [subtitle:<subtitle>] [share_to_instagram:<true|false>]` command, then calls the existing `submit-discord-gallery-image` ingest function with `instagramOptIn` mapped from the optional boolean. The image option is required; title, subtitle, and Instagram opt-in are optional so the live slash command matches the pinned channel instructions.

The same Interactions endpoint handles the manual Discord vote reminder contract: `Done voting` button clicks, `/vote-status`, `/vote-leaderboard`, and moderator-only `/vote-reminder-preview`. The scheduled sender is the separate `send-vote-reminder` Edge Function. It posts link buttons only; it never automates third-party upvotes, vote submissions, CAPTCHA bypasses, browser clicks, vote-site sessions, or vote-site result checks.

The Interactions endpoint also supports moderator-only `/photo-day-poll`. It posts a no-ping moderator review draft to channel `1468667003366674721` with `Approve & Send`, `Edit Draft`, and `Cancel` controls. Moderators can edit the exact question and answer options through the modal before approval; approving converts that same channel message into the reaction poll and adds starter reactions. The default public poll is the concise Guild Photo Day gathering-hour format: question, UTC+8 instruction, five 2-hour answers from Saturday midnight through 10:00 AM, and the closing line `Let's take pretty things in pretty places!`. Emoji choices are defined with Unicode escapes in the shared helper so Discord messages and starter reactions do not degrade into `??`. Registration uses `npm run register:reaper-photo-day-poll-command` for dry run first; deploying the function or applying the command registration still requires explicit approval.

The Interactions endpoint also supports moderator-only pending-verification containment with `/sync-pending-verification mode:<preview|apply> confirm:<true|false>`. It is preview-first and only manages tracked member-specific containment overwrites for WWM-only, unverified Discord members. See [`../docs/reaper-pending-verification-containment.md`](../docs/reaper-pending-verification-containment.md).

Script order on pages with Auth or upload behavior is:

```html
<script src="./utils.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.8" defer></script>
<script src="./supabase.js" defer></script>
<script src="./site.js" defer></script>
<script src="./page.js" defer></script>
```

## Account Page UX

`account.html` summarizes the signed-in member's profile state, Discord verification state, upload eligibility, profile completeness, optional profile links, and recent gallery submission statuses. It uses existing browser-safe helpers and the signed-in user's own RLS-limited rows. Profile completeness is informational only; it does not block saving, Discord verification, or gallery upload eligibility.

The Account page does not expose private Storage URLs. It shows submission text metadata and moderation status only. Upload permission remains enforced by `verify-member-access`, `verify-discord-member`, `member_profiles`, `member_verifications`, `gallery_submissions` RLS, and private `member-gallery` Storage policies.

## Multi-Provider Auth Setup

The current live sign-in set is Discord, Google, Twitch, and Apple. Apple is active identity evidence only and must keep its generated OAuth client secret on a six-month rotation cadence. Facebook, Kakao, Spotify, and Phone are deferred and should stay disabled in Supabase Auth production until a scoped provider lane is reopened.

| State | Providers | Operational rule |
| --- | --- | --- |
| Active | Discord, Google, Twitch, Apple | Keep enabled in Supabase Auth production and keep the public website allowlist at `NEXT_PUBLIC_AUTH_PROVIDER_IDS=discord,google,twitch,apple`. Apple is active identity evidence and still requires moderator review for member-only privileges. |
| Deferred | Facebook, Kakao, Spotify, Phone | Keep disabled and hidden from public activation until a scoped provider lane is reopened. |

Social or phone sign-in through Supabase Auth proves account control only. It
does not automatically prove guild membership, role ownership, gallery access,
or moderator access. Discord remains the only automatic member verification
path because guild membership and role checks happen server-side through
`verify-discord-member` and `verify-member-access`.

Non-Discord identities are synced as redacted evidence in `member_auth_identities` and become gallery-eligible only after moderator approval in `member_verifications`. See `docs/multi-provider-login-and-verification.md` for the setup packet.

In Supabase Dashboard:

1. Open Authentication Provider settings.
2. Enable only the providers that are ready for live callbacks.
3. Add each provider's Client ID / public app identifier.
4. Add each provider's Client Secret in Supabase only.
5. Enable Supabase Auth Manual Linking so signed-in users can link Discord,
   Google, Twitch, and Apple identities from Account with `linkIdentity`.
6. Set the production Site URL to the public site URL.
7. Add production redirect URLs for Account, Auth, Submit Image, and Leader Dashboard.
8. Add local development redirect URLs for Account, Auth, Submit Image, and Leader Dashboard.
9. Confirm every provider callback URL matches:

```text
https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/callback
```

The browser/provider allowlist is controlled separately with public-safe env only:

```text
NEXT_PUBLIC_AUTH_PROVIDER_IDS=discord,google,twitch,apple
NEXT_PUBLIC_AUTH_PROVIDER_PLACEHOLDER_IDS=
NEXT_PUBLIC_PHONE_AUTH_READY=false
NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED=false
```

Apple activation uses the Supabase Auth callback only:

```text
https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/callback
```

Stable Apple Developer identifiers for this provider lane:

```text
App ID: com.mochirii.web
App ID description: Mochirii Web
Services ID: com.mochirii.web.login
Services ID description: Mochirii Website Login
Domain: deyvmtncimmcinldjyqe.supabase.co
```

Credential artifacts, Apple key metadata, generated client-secret expiry notes,
and six-month rotation notes belong only under
`C:\Github Repo's\Mochirii Website\Mochi Creds\Apple`.
Do not commit or print Apple private key material, generated client secrets,
OAuth payloads, cookies, token values, or digests of those values.
Apple: active identity evidence only. It does not automatically prove guild
membership, gallery eligibility, moderator status, or Mōchirīī Social account
creation. First activation testing should link Apple to the
existing admin account from Account before testing signed-out Apple login.

If Account identity linking shows `Manual linking is disabled`, the website is
already calling Supabase correctly. Enable the production project's Manual
Linking Auth setting after exact owner approval, then retry the provider link
from Account. The equivalent Management API field is
`security_manual_linking_enabled`; never print the bearer token or raw auth
config response while checking it.

Phone must stay disabled until SMS provider, CAPTCHA, rate limits, country/cost expectations, and abuse handling are configured in a separate Phone lane. Kakao must stay disabled until the app is approved as a Kakao Biz App for `account_email` or leadership approves a profile-only manual-review path. Facebook and Spotify must stay disabled until their provider lanes are intentionally reopened.

Preview-only member verification smoke:

```sh
ALLOW_PREVIEW_MEMBER_VERIFICATION_SMOKE=true npm run smoke:member-verification-preview
```

That script refuses project `deyvmtncimmcinldjyqe`, creates and cleans up preview fixtures only, and proves approve/revoke/expired/locked-state behavior without touching production member-verification rows.

Recommended redirect URLs:

```text
https://mochirii.com/auth.html
https://mochirii.com/account.html
https://mochirii.com/gallery-submit.html
https://mochirii.com/leader-dashboard.html
http://127.0.0.1:8765/auth.html
http://127.0.0.1:8765/account.html
http://127.0.0.1:8765/gallery-submit.html
http://127.0.0.1:8765/leader-dashboard.html
```

The browser OAuth login uses the provider registry:

```js
signInWithProvider("discord", { redirectTo: "/account" });
```

## Discord Server And Roles

Discord server ID:

```text
1078630751077142608
```

Required role names and IDs:

```text
Mōchirīī - WWM = 1468659807736299520
✅Verified = 1078630751077142615
```

Moderator role used by gallery moderation:

```text
Moderator = 1078630751165222984
```

Role IDs are enforcement data. Role names are documentation and user-facing explanation only.

## Discord Integration Hub

Discord remains the live community layer: chat, voice, forum conversations, scheduled event notifications, and immediate coordination stay inside Discord. The website remains the structured guild layer for profiles, gallery, records, applications, event archives, approved summaries, public presentation, and leader workflows. Supabase stores identity, permissions, sync/cache tables, moderation state, and audit logs. Reaper and/or Supabase Edge Functions are the secure Discord bridge; browser JavaScript must not hold bot tokens, webhook URLs, client secrets, or service-role keys.

`discord_resources` is the service-managed registry for known Discord resources: the guild, roles, channels, forums, threads, scheduled events, webhooks, bots, and safe external targets. It stores IDs, labels, optional parent IDs, optional public/deep links, descriptions, enabled state, and non-secret metadata so future page scripts and Edge Functions do not hardcode every Discord resource.

`discord_sync_log` records future sync attempts and bridge jobs: scheduled-event imports, forum/thread index updates, webhook notifications, slash-command entry points, role checks, manual tests, and skipped or failed attempts. Log details must stay operational and redacted; never store tokens, webhook URLs, private conversations, or unrestricted message content.

`discord_managed_permission_overwrites` records only Reaper-owned Discord permission overwrite bits by guild, channel, Discord user, and managing service. It is service-role-only and currently backs pending-verification containment for member-specific view, send, and read-history allows in approved channels plus view denies elsewhere. Browser code receives no grants and must not read or write this table.

Known foundation resources:

```text
Guild: 1078630751077142608
Upload role, Mōchirīī - WWM: 1468659807736299520
Upload role, ✅Verified: 1078630751077142615
Moderator role: 1078630751165222984
```

Required secret categories for later branches:

- Discord bot token for Reaper or trusted Edge Functions.
- Discord webhook URLs for approved notification targets.
- Discord client secret in Supabase Auth provider settings only.
- Supabase service-role or secret keys in trusted Edge runtime only.
- Environment-specific channel/forum IDs for sync targets.

Future feature order should stay incremental:

1. Scheduled Event metadata sync.
2. Webhook notification records and sends.
3. Forum/thread metadata index.
4. Slash-command entry points through Reaper.
5. RSVP and participation history after event records exist.

Never mirror:

- full chat logs
- private conversations
- unrestricted Discord message content

Safe to sync when a scoped branch explicitly enables it:

- scheduled event metadata
- forum/thread metadata
- Discord deep links
- approved summaries
- webhook notification records

These require explicit later branches and review:

- webhook notifications
- forum index
- role assignment automation

## Required Edge Function Secrets

Recommended local/production values:

```sh
DISCORD_GUILD_ID=1078630751077142608
DISCORD_REQUIRED_ROLE_IDS=1468659807736299520,1078630751077142615
DISCORD_REQUIRED_ROLE_NAMES="Mōchirīī - WWM,✅Verified"
DISCORD_MODERATOR_ROLE_IDS=1078630751165222984
DISCORD_MODERATOR_ROLE_NAMES=Moderator
DISCORD_PUBLIC_KEY=<from Discord Developer Portal General Information, never commit>
DISCORD_APPLICATION_ID=1156448856565887066
DISCORD_BOT_TOKEN=<set manually, never commit>
DISCORD_GALLERY_CHANNEL_ID=1508077313965817856
DISCORD_GALLERY_INGEST_SECRET=<set manually, never commit>
DISCORD_VOTE_CHANNEL_ID=1082802012095266866
VOTE_REMINDER_TIME_ZONE=America/Los_Angeles
VOTE_REMINDER_CRON_SECRET=<set manually, never commit>
# DISCORD_VOTE_LINKS_JSON=<optional JSON links secret, never commit real private targets if sensitive>
GUILD_SCHEDULE_URL=https://mochirii.com/data/guild-schedule.json
INSTAGRAM_ACCOUNT_ID=<set manually, never commit>
INSTAGRAM_ACCESS_TOKEN=<set manually, never commit>
INSTAGRAM_API_VERSION=<set manually, never commit>
INSTAGRAM_API_BASE_URL=<optional Meta-compatible test base URL>
DISCORD_WEBHOOK_GALLERY_APPROVED=<set manually, never commit>
DISCORD_WEBHOOK_MOD_LOG=<set manually, never commit>
DISCORD_EVENTS_CHANNEL_ID=<set per environment>
DISCORD_FORUM_GUIDES_CHANNEL_ID=<set per environment>
DISCORD_FORUM_ANNOUNCEMENTS_CHANNEL_ID=<set per environment>
```

The Edge Function also needs access to Supabase server credentials in the trusted Edge runtime. Keep service-role or secret keys server-side only.

Local serve example:

```sh
supabase functions serve verify-discord-member --env-file supabase/functions/.env.local
supabase functions serve list-gallery-review-queue --env-file supabase/functions/.env.local
supabase functions serve moderate-gallery-submission --env-file supabase/functions/.env.local
supabase functions serve list-approved-gallery-submissions --env-file supabase/functions/.env.local
supabase functions serve submit-discord-gallery-image --env-file supabase/functions/.env.local
supabase functions serve reaper-discord-interactions --env-file supabase/functions/.env.local
supabase functions serve send-vote-reminder --env-file supabase/functions/.env.local
supabase functions serve list-visible-profile-cards --env-file supabase/functions/.env.local
supabase functions serve list-instagram-publish-queue --env-file supabase/functions/.env.local
supabase functions serve mark-instagram-gallery-submission-shared --env-file supabase/functions/.env.local
supabase functions serve check-instagram-api-status --env-file supabase/functions/.env.local
supabase functions serve publish-instagram-gallery-submission --env-file supabase/functions/.env.local
```

Production secret examples:

```sh
supabase secrets set DISCORD_GUILD_ID=1078630751077142608
supabase secrets set DISCORD_REQUIRED_ROLE_IDS=1468659807736299520,1078630751077142615
supabase secrets set DISCORD_REQUIRED_ROLE_NAMES="Mōchirīī - WWM,✅Verified"
supabase secrets set DISCORD_MODERATOR_ROLE_IDS=1078630751165222984
supabase secrets set DISCORD_MODERATOR_ROLE_NAMES=Moderator
supabase secrets set DISCORD_PUBLIC_KEY=<set manually, never commit>
supabase secrets set DISCORD_APPLICATION_ID=1156448856565887066
supabase secrets set DISCORD_BOT_TOKEN=<set manually, never commit>
supabase secrets set DISCORD_GALLERY_CHANNEL_ID=1508077313965817856
supabase secrets set DISCORD_GALLERY_INGEST_SECRET=<set manually, never commit>
supabase secrets set DISCORD_VOTE_CHANNEL_ID=1082802012095266866
supabase secrets set VOTE_REMINDER_TIME_ZONE=America/Los_Angeles
supabase secrets set VOTE_REMINDER_CRON_SECRET=<set manually, never commit>
supabase secrets set GUILD_SCHEDULE_URL=https://mochirii.com/data/guild-schedule.json
supabase secrets set INSTAGRAM_ACCOUNT_ID=<set manually, never commit>
supabase secrets set INSTAGRAM_ACCESS_TOKEN=<set manually, never commit>
supabase secrets set INSTAGRAM_API_VERSION=<set manually, never commit>
```

`supabase secrets set ...` writes remote project secrets. Run it only from a trusted shell and never paste tokens into tracked files.

Instagram credentials live only in Supabase secrets. Do not place Instagram access tokens, account IDs, API base URLs, or API versions in Vercel, browser code, GitHub Actions logs, issue comments, PR text, or public docs with real values.

Verify remote secrets without printing secret values:

```sh
supabase secrets list
```

## Operational Runbooks

- Cost and usage monitoring: [`docs/supabase-cost-usage-runbook.md`](../docs/supabase-cost-usage-runbook.md)

Do not commit `supabase/functions/.env.local`.

## Deployment Commands

Remote-changing commands require explicit operator approval. Do not run them during local-only audit work.

Dry-run database migration preview:

```sh
supabase db push --dry-run
```

Remote-mutating database deployment:

```sh
supabase db push
```

Remote-mutating Edge Function deployment:

```sh
supabase functions deploy verify-discord-member
supabase functions deploy list-gallery-review-queue
supabase functions deploy moderate-gallery-submission
supabase functions deploy list-approved-gallery-submissions
supabase functions deploy submit-discord-gallery-image
supabase functions deploy reaper-discord-interactions
supabase functions deploy send-vote-reminder
supabase functions deploy list-visible-profile-cards
supabase functions deploy list-instagram-publish-queue
supabase functions deploy mark-instagram-gallery-submission-shared
supabase functions deploy check-instagram-api-status
supabase functions deploy publish-instagram-gallery-submission
```

Recommended production sequence after dashboard setup and secrets are complete:

```sh
supabase secrets list
supabase db push --dry-run
supabase db push
supabase migration list
supabase functions deploy verify-discord-member
supabase functions deploy list-gallery-review-queue
supabase functions deploy moderate-gallery-submission
supabase functions deploy list-approved-gallery-submissions
supabase functions deploy submit-discord-gallery-image
supabase functions deploy reaper-discord-interactions
supabase functions deploy send-vote-reminder
supabase functions deploy list-visible-profile-cards
supabase functions deploy list-instagram-publish-queue
supabase functions deploy mark-instagram-gallery-submission-shared
supabase functions deploy check-instagram-api-status
supabase functions deploy publish-instagram-gallery-submission
```

If the linked project requires a database password in the shell, set it locally without committing it. Fish shell example:

```fish
set -gx SUPABASE_DB_PASSWORD 'PASTE_REMOTE_DATABASE_PASSWORD_HERE'
```

## Discord Developer Portal Setup

1. Create or select the Discord application for the guild website.
2. Add the Supabase callback URL:

```text
https://deyvmtncimmcinldjyqe.supabase.co/auth/v1/callback
```

3. Copy the Discord Client ID and Client Secret into Supabase Auth provider settings.
4. Create a Discord bot token for server-side guild-member checks.
5. Copy the Discord Public Key into Supabase secret `DISCORD_PUBLIC_KEY` for the Supabase-hosted Discord Interactions webhook.
6. Set the Discord Interactions Endpoint URL to:

```text
https://deyvmtncimmcinldjyqe.supabase.co/functions/v1/reaper-discord-interactions
```

7. Register the guild-scoped `/submit` command with optional boolean `share_to_instagram`.
8. Register the guild-scoped `/sync-events` command with string option `mode` (`preview` or `apply`) and optional boolean `confirm`.
9. Register the guild-scoped `/sync-pending-verification` command with string option `mode` (`preview` or `apply`) and optional boolean `confirm`. Use `npm run register:reaper-pending-verification-command` for dry run first; approved apply uses `npm run register:reaper-pending-verification-command -- --apply`.
10. Register the guild-scoped `/audit-modmail` command. Use `npm run register:reaper-modmail-audit-command` for dry run first; approved apply uses `npm run register:reaper-modmail-audit-command -- --apply`.
11. Register the guild-scoped `/vote-status`, `/vote-leaderboard`, and `/vote-reminder-preview` commands. `/vote-reminder-preview` is enforced by the configured Moderator role.
12. Register the guild-scoped `/photo-day-poll` command. Use `npm run register:reaper-photo-day-poll-command` for dry run first; approved apply uses `npm run register:reaper-photo-day-poll-command -- --apply`.
13. Add the bot to guild `1078630751077142608` with permission to read guild member and role data needed by:

```text
GET /guilds/1078630751077142608/members/{discord_user_id}
```

The website does not assign Discord roles in this phase.

## Database Tables

`member_profiles` stores durable website account state:

- Member user ID
- Discord identity fields
- Discord role IDs returned by server-side verification
- `has_required_discord_roles`
- `discord_member_pending`
- `discord_verified_at`
- `discord_checked_at`
- safe editable profile fields
- `member_status`

`member_status` meanings:

- `pending`: signed in or known, but not active for uploads.
- `active`: eligible if Discord roles are verified and recent.
- `suspended`: blocked by leadership/admin state.
- `archived`: historical/inactive account state.

`has_required_discord_roles` means the latest server-side Discord check found both required role IDs. Browser code treats it as UX state; database and Storage RLS enforce access.

`public.handle_new_member_profile()` is the Auth trigger helper that creates or updates the matching `member_profiles` row when a Supabase Auth user appears. It is `security definer`, has its search path fixed by migration, and is revoked from `public`, `anon`, and `authenticated`; browser clients do not call it directly.

`gallery_submissions` stores member-owned pending upload records:

- private Storage bucket/path
- original filename, MIME type, and size
- optional title/caption/category
- upload source (`website` or `discord`)
- Discord guild/channel/message/attachment/user IDs for Discord submissions
- Instagram opt-in boolean, timestamp, source, and copy version
- stable Gallery publication ID plus the currently selected thumbnail-revision metadata
- moderation status
- review fields for moderator approval or decline actions

Uploads stay private while `pending`. Approval alone does not make a legacy row
public: the moderation transaction must also create a complete immutable
publication revision.

`private.gallery_source_validations` stores immutable trusted evidence for the
exact private source selected by a moderator or accepted through the trusted
Discord ingest. Evidence is bound to the submission revision and Storage
object ID, version, timestamp, MIME type, byte size, dimensions, SHA-256, and
`gallery-source-v1` validator. Direct table privileges are revoked, and a
publication commit fails closed unless current matching evidence exists.

`private.gallery_publication_revisions` is the service-only public-delivery
ledger. Each immutable revision freezes the reviewed title, caption, category,
internal attribution, source timestamps, stable publication ID, exact
Storage object identities/versions/timestamps and SHA-256 digests, bounded
metadata-stripped display image, and per-revision thumbnail. Only
`visible_until` may move once from null to a retirement timestamp. Browser roles
receive no table privileges, and anonymous public responses expose neither
attribution nor either Storage path.

`gallery_moderation_events` stores privileged moderation audit records:

- submission id
- moderator id
- action: `approved`, `rejected`, `archived`, or `thumbnail_refreshed`
- optional reason
- event creation time

Browser clients do not receive direct insert, update, or delete privileges for moderation events. Trusted Edge Functions write these rows with service-role credentials after Discord Moderator verification.

`gallery_instagram_publish_jobs` stores the second-stage Instagram publishing queue:

- submission id
- job status: `queued`, `ineligible`, `publishing`, `published`, `failed`, `canceled`, or `shared_manually`
- eligibility reason for unsupported v1 media
- moderator-editable Instagram caption and alt text
- Meta container/media/permalink IDs after an API publish attempt, or a manually pasted permalink after moderator sharing
- attempt count, last error, queued/published actors, and timestamps

`gallery_instagram_publish_events` stores service-role audit events for Instagram publishing jobs. Browser clients receive no direct table privileges for either Instagram publishing table.

## Storage Bucket Plan

The migration creates a private bucket:

```text
member-gallery
```

The bucket is restricted to image uploads only:

```text
file_size_limit = 8388608
allowed_mime_types = image/jpeg, image/png, image/webp
```

Upload paths begin with the signed-in user id:

```text
{auth.uid()}/{timestamp-or-random-safe-filename}
```

No public read access is granted.

## RLS And Storage Policy Summary

`member_profiles`:

- anon receives no direct table privileges.
- authenticated users can select only their own profile.
- authenticated users can update only safe editable columns on their own profile.
- browser users cannot update member status, Discord roles, Discord verification timestamps, or IDs.
- service_role can manage rows from trusted backend/admin workflows.

`gallery_submissions`:

- anon receives no direct table privileges.
- authenticated users can select only their own submissions.
- authenticated users can insert only their own submissions when their profile is active, has required Discord roles, and has recent verification.
- authenticated users can update only title, caption, and category on their own pending submissions.
- browser users cannot approve, reject, archive, review, or delete submissions in this phase.
- browser users cannot set Discord source metadata.
- service_role can manage rows from trusted backend/admin workflows.

`gallery_moderation_events`:

- RLS is enabled.
- anon and authenticated browser clients receive no direct table privileges.
- service_role can manage rows from trusted Edge Functions.

`private.gallery_publication_revisions`:

- RLS is enabled as defense in depth.
- `public`, `anon`, `authenticated`, and direct `service_role` table privileges are revoked.
- only reviewed service-only functions may create or query immutable publication revisions.
- approved legacy rows without a publication revision remain private until an explicit moderator republication.

`private.gallery_source_validations`:

- RLS is enabled as defense in depth.
- `public`, `anon`, `authenticated`, and direct `service_role` table privileges are revoked.
- service-only validation functions accept static JPEG, PNG, or WebP sources no larger than 8 MiB, 4096 pixels per edge, or 12.6 megapixels.
- only evidence matching the current submission and Storage object can authorize a preview or publication.

`gallery_instagram_publish_jobs` and `gallery_instagram_publish_events`:

- RLS is enabled.
- anon and authenticated browser clients receive no direct table privileges.
- service_role can manage rows from trusted Edge Functions after moderator verification.

`discord_managed_permission_overwrites`:

- RLS is enabled.
- anon and authenticated browser clients receive no direct table privileges.
- service_role can manage rows from trusted Edge Functions after moderator verification.
- Rows store only owned permission bitfields and Discord IDs for Reaper-managed overwrites.

## Service-Only Default-Deny Tables

The following tables are service-role-only audit, sync, moderation, or poll internals. Migration `20260712164503_service_only_default_deny_policies.sql` reasserts revoked `public`, `anon`, and `authenticated` privileges and adds one restrictive `service_only_default_deny` policy for the client roles. The policy always evaluates to false and exists to make the default-deny intent explicit without granting browser access. Do not add permissive anon or authenticated policies unless a future task explicitly redesigns the table's public data contract.

- `discord_managed_permission_overwrites`
- `discord_resources`
- `discord_sync_log`
- `gallery_instagram_publish_events`
- `gallery_instagram_publish_jobs`
- `gallery_moderation_events`
- `member_auth_identities`
- `member_verifications`
- `spotlight_poll_candidates`
- `spotlight_poll_cycles`
- `spotlight_poll_results`
- `vote_confirmations`
- `vote_reminder_sends`

The migration verifies that RLS remains enabled, the restrictive policy is complete, client roles retain no table privileges, and `service_role` retains the trusted backend privileges. Supabase Preview and production advisor readbacks must report no `rls_enabled_no_policy` finding for these tables after deployment.

These tables should keep RLS enabled, direct browser grants revoked, and `service_role` writes constrained to trusted Edge Functions, Reaper workflows, or scheduled jobs. If a user-facing view is ever needed, expose a narrow Edge Function DTO instead of direct table access.

Storage `member-gallery`:

- authenticated active verified members can upload only into their own first path segment.
- authenticated users can read only their own objects.
- referenced source objects are immutable; authenticated members cannot replace them.
- authenticated members may delete only an orphaned object in their own path before a submission references it.
- anon receives no access.
- bucket remains private.

## Gallery Moderation Architecture

Leader moderation uses two Edge Functions:

- `list-gallery-review-queue`
- `moderate-gallery-submission`

Both functions require a signed-in Supabase user JWT and then verify Discord server membership against guild `1078630751077142608`. The moderator check requires role ID `1078630751165222984` from `DISCORD_MODERATOR_ROLE_IDS`. The role name secret is documentation only; role names are never trusted for enforcement. If moderation secrets are missing or do not match the expected guild or role ID, the functions fail closed.

`list-gallery-review-queue` is moderator-only. It supports `pending`, `approved`, `rejected`, and `archived` queue filters, returns dashboard counts, joins safe uploader/moderator profile display fields, and includes recent `gallery_moderation_events`. It does not bulk-sign raw sources. A moderator explicitly prepares one selected preview; the function downloads that exact object, performs bounded structural validation, commits current service-only evidence, and only then issues a short-lived preview capability. Normal queue responses sign previews only for sources whose object identity still matches trusted evidence. The Storage bucket stays private and no public read policy is added.

`moderate-gallery-submission` accepts `approved` or `rejected` for a pending submission and `thumbnail` for explicit republication of an approved historical submission. Approval re-encodes the signed private review image into two metadata-stripped WebP assets: a display image no larger than 2560 pixels on either edge and 2 MiB, and a thumbnail no larger than 720 pixels on either edge and 80 KiB. The function structurally validates and fully decodes both with pinned libwebp 1.6.0. The display image uses the stable `_approved/publications/{publication}/display.webp` path; each immutable thumbnail revision uses `_approved/publications/{publication}/revisions/{revision}/thumbnail.webp`. The source-row change, moderation event, prior-revision retirement, and new immutable publication revision commit through one service-only database function, so an audit or evidence failure rolls back the database transition. Published submissions are not written into `data/gallery.json`.

`list-gallery-review-queue` paginates and filters historical approved rows by publication-media state. `list-approved-gallery-submissions` asks service-only database functions to read a stable ten-minute snapshot from `private.gallery_publication_revisions`, reconcile exact Storage object evidence, and apply a 24-item keyset page. It returns stable credential-free thumbnail Edge URLs and never a bearer capability. A media `GET` reserves the request and immutable byte count in the serialized global budget, downloads the private derivative, verifies exact size and SHA-256, and then returns WebP with a five-minute private browser cache. The member-owned source original remains private and is never a public viewer asset. Member policies allow updates and deletes only for pending source originals; members cannot access the service-owned publication prefix.

The website Leader Dashboard uses those functions to show queue tabs, submission details, explicitly prepared private previews, source metadata, rejection reasons, and compact moderation history. The browser reuses its single validated preview download when creating the bounded publication derivatives. Regular browser clients still do not receive direct privileges to update review fields or insert moderation events.

For the human moderator workflow, see `docs/member-gallery-moderation-runbook.md`.

Discord `/submit image:` uploads use a separate Edge Function:

```sh
submit-discord-gallery-image
```

The public Discord entrypoint is the Supabase-hosted Discord Interactions function:

```sh
reaper-discord-interactions
```

The private Gateway member-event endpoint for the second pending-verification release is:

```sh
reaper-discord-member-sync
```

That function has `verify_jwt = false` because Discord calls it directly. It validates `x-signature-ed25519` and `x-signature-timestamp` with `DISCORD_PUBLIC_KEY`, answers PING, enforces guild `1078630751077142608`, channel `1508077313965817856`, and required roles, then defers the interaction and calls `submit-discord-gallery-image` in a background task. The ingest function also has `verify_jwt = false` because it is called by the trusted Reaper bridge rather than by a signed-in browser session. It fails closed unless `DISCORD_GALLERY_INGEST_SECRET`, `DISCORD_GALLERY_CHANNEL_ID`, `DISCORD_GUILD_ID`, and `DISCORD_REQUIRED_ROLE_IDS` match the expected server configuration. The ingest function then requires an existing linked `member_profiles.discord_user_id`, active status, stored required roles, and recent website Discord verification before downloading the Discord attachment into the private `member-gallery` bucket and inserting a pending `gallery_submissions` row.

The same Reaper Interactions endpoint also supports:

```text
/sync-events mode:<preview|apply> confirm:<true|false>
/sync-pending-verification mode:<preview|apply> confirm:<true|false>
/audit-modmail
```

`/sync-events` reads the mirrored schedule JSON at `https://mochirii.com/data/guild-schedule.json` by default, computes the next UTC+8 monthly and weekly website events, and creates or updates only external Discord Scheduled Events managed by Reaper. Preview returns the plan without changing Discord. Apply requires `confirm:true`, the configured Moderator role, and Discord Create Events plus Manage Events permissions. Created or updated event IDs are recorded in `discord_resources` with `managedBy: "reaper-event-sync"` and a stable website event key. Schedule items may include `discordCoverImage`, `discordLocation`, `discordEventId`, `discordDuplicateEventIds`, and `discordRecurrenceRule`; the monthly raffle uses these fields to adopt the canonical recurring event, upload the approved cover image, set the Discord location to `Guild Base Pool`, and retire only the explicit duplicate one-off raffle ID listed in the schedule.

`/sync-pending-verification` targets only Discord members whose roles array is exactly `["1468659807736299520"]` and who do not have `1078630751077142615`. Preview fetches the current guild channels and members, allows only channels `1468658915594997760` and `1480143854014300335`, detects manual member-specific containment conflicts, and writes a redacted `discord_sync_log` row. Apply requires `confirm:true`, the configured Moderator role, and Discord Manage Roles permission. It writes only tracked member-specific containment permission overwrites and records Reaper-owned bits in `discord_managed_permission_overwrites`.

`reaper-discord-member-sync` is the second-release Gateway automation endpoint. It has `verify_jwt = false` and requires `x-mochirii-reaper-member-sync-secret`; the private Gateway worker posts `guildMemberAdd` and role-changing `guildMemberUpdate` events, and the function fetches the current Discord member before planning or mutating. It uses the same shared pending-verification containment policy as `/sync-pending-verification`, blocks manual conflicts, enforces the same max-mutation guard, and logs redacted `role_check` counts. The Gateway worker must not mutate roles or channel permissions directly and must not store Supabase service-role keys.

`/audit-modmail` is a moderator-only read-only audit for native ModMail. It checks that ModMail bot `575252669443211264`, Moderator role `1078630751165222984`, and log channel `1165567735871311914` are present and permissioned for metadata-only staff tickets/logging. It does not read ticket message content, send native ModMail commands, enable `=loggingplus`, or replace the third-party ModMail bot. Register it with `npm run register:reaper-modmail-audit-command` first, then approved apply with `npm run register:reaper-modmail-audit-command -- --apply`. See [`../docs/reaper-modmail-audit.md`](../docs/reaper-modmail-audit.md).

## Discord Vote Reminder

Manual vote reminders use two Edge Functions:

- `send-vote-reminder`: scheduled sender for channel `1082802012095266866`.
- `reaper-discord-interactions`: Discord interaction endpoint for `Done voting`, `/vote-status`, `/vote-leaderboard`, `/vote-reminder-preview`, and moderator-approved `/photo-day-poll`.

The feature presents HTTPS vote links and records a member's manual confirmation after they click `Done voting`. It does not automate third-party voting. The reminder uses `allowed_mentions: { parse: [] }` and creates link buttons plus a single `vote_done:<YYYY-MM-DD>` confirmation button.

Vote links come from `DISCORD_VOTE_LINKS_JSON` when set, otherwise from a pinned vote-channel message containing `[vote-links]`. See [`../docs/vote-reminder-runbook.md`](../docs/vote-reminder-runbook.md) for the pin format, Supabase Cron setup, rollout, rollback, and validation checklist.

The database stores:

- `vote_confirmations`: one manual confirmation per Discord user per vote date.
- `vote_reminder_sends`: reminder delivery audit rows with status, message ID, and link count.

Both tables have RLS enabled and service-role-only grants. Browser clients receive no direct vote table access.

## Monthly Member Spotlight Polls

Monthly member spotlight polls use Discord native polls and Supabase-owned winner publication:

- `send-member-spotlight-poll`: scheduled sender that creates one native Discord poll on the 1st of each month at `00:05 UTC+8`.
- `publish-member-spotlight-winner`: scheduled finalizer that waits for Discord finalized poll results after 7 days.
- `get-current-spotlight-winner`: public-safe website lookup that returns only the published winner name and month.

Native Discord polls are limited to 10 answers, so Reaper snapshots up to 10 randomly selected active, recently verified, Discord-linked website members per cycle. If there are 10 or fewer eligible members, all eligible members are included. The poll is single-choice, lasts 168 hours, and uses `allowed_mentions: { parse: [] }`.

The linked Twills account is intentionally excluded from spotlight poll eligibility so owner/admin participation never occupies member poll slots.

Required secrets:

```text
DISCORD_SPOTLIGHT_POLL_CHANNEL_ID
SPOTLIGHT_POLL_CRON_SECRET
```

The database stores:

- `spotlight_poll_cycles`: one monthly Discord poll cycle, Discord message IDs, status, winner, and audit timestamps.
- `spotlight_poll_candidates`: the private candidate snapshot and Discord answer mapping for that cycle.
- `spotlight_poll_results`: private finalized answer counts and verification metadata.

All three tables have RLS enabled and service-role-only grants. Browser clients receive no direct candidate, Discord ID, voter, or vote-count access. The website Home and Spotlight pages may replace the configured fallback title with the finalized winner name only; they do not expose the winner's Discord handle, profile link, avatar, raw vote totals, or candidate list.

Discord uploads are idempotent by message/attachment ID. They go through the same moderator approval queue as website uploads and do not appear publicly until approved. Discord attachment `content_type` is advisory because Discord may omit or mislabel it; `submit-discord-gallery-image` streams the approved Discord CDN URL through an 8 MiB hard ceiling, structurally validates a static JPEG, PNG, or WebP within the 4096-edge and 12.6-megapixel limits, stores the sniffed MIME type, and commits matching trusted source evidence. A missing or conflicting evidence commit removes the inserted row and object and fails closed.

The private Reaper source repo is `Mochirii-Wushu/Reaper-Discord-Bot`, which remains the command/contract helper and rollback runtime reference. Production Reaper is Supabase-hosted Discord Interactions. Its gallery slash command requires only `image`; `title`, `subtitle`, and the Discord boolean opt-in stay optional:

```text
/submit image:<file> [title:<title>] [subtitle:<subtitle>] [share_to_instagram:<true|false>]
```

`share_to_instagram` defaults to `false`. Reaper maps `subtitle` to the existing website `caption` field when supplied and sends `instagramOptIn` in the `submit-discord-gallery-image` JSON payload. The user-facing Discord copy should say whether Instagram sharing was enabled. Duplicate Discord message/attachment submissions stay idempotent and do not mutate existing stored consent.

There is no automatic Instagram publishing. Website gallery approval creates an Instagram publishing job only when the submission has explicit opt-in consent. Moderators then review the separate Instagram Queue before any external post is sent.

## Pending Verification Containment

Pending-verification containment is a moderator-only Discord repair path for members who only have role `1468659807736299520` and have not received role `1078630751077142615`.

```text
/sync-pending-verification mode:<preview|apply> confirm:<true|false>
```

Reaper allows WWM-only, non-Verified members to see and chat only in channels `1468658915594997760` and `1480143854014300335`. It plans member-specific `VIEW_CHANNEL`, `SEND_MESSAGES`, and `READ_MESSAGE_HISTORY` allows inside those channels, and member-specific `VIEW_CHANNEL` denies outside those channels. It preserves unrelated overwrite bits and removes only Reaper-owned bits when a member no longer matches the target predicate. Manual member-specific `VIEW_CHANNEL` allows outside the allowed channels or denies for the managed allow bits inside the allowed channels block apply.

Preview is the safe first command. Apply requires `confirm:true`, Moderator role `1078630751165222984`, and Discord Manage Roles permission. See [`../docs/reaper-pending-verification-containment.md`](../docs/reaper-pending-verification-containment.md) for the conflict policy and [`../docs/reaper-pending-verification-activation-packet.md`](../docs/reaper-pending-verification-activation-packet.md) for live activation, Gateway release, and rollback steps.

## Retired Member Profile Surface And Vanity Rank Roles

Website member profile publishing is retired. `/members` and `/members/[slug]` should stay absent from the Next app and resolve through normal 404 behavior with no redirect. Mōchirīī Social is now the member social/profile destination.

The Supabase profile/media objects remain shared backend identity data until a separate Supabase dependency audit/migration is approved. Do not remove `member_profiles`, `member_profile_media`, profile Edge Functions, Storage buckets, or grants from this website cleanup alone.

Profile media uses a separate private Storage bucket:

```text
member-profile-media
```

The legacy browser avatar/banner upload path is no longer exposed in the website UI. Historical profile media remains private in Storage. Approved media is returned only through short-lived signed URLs from Edge Functions if a retained backend function still serves it.

Discord identity fields are service-managed. `verify-discord-member` refreshes `discord_handle` from Discord user data; browser clients may edit only display name, game UID, region, timezone, and bio from the current Account surface. Bios are capped at 1,000 characters.

Member profile Edge Functions:

- `list-member-profiles`
- `get-member-profile`
- `submit-member-profile-media`
- `list-member-profile-media-queue`
- `moderate-member-profile-media`

`list-member-profiles` and `get-member-profile` remain legacy configured functions and require an active signed-in member. `list-member-profile-media-queue` and `moderate-member-profile-media` remain legacy configured functions and require the same server-side Moderator role verification as the gallery Leader Dashboard.

The `reaper-discord-interactions` function also supports the moderator-only rank sync command:

```text
/sync-ranks mode:<preview|apply> confirm:<true|false>
```

Rank roles are display-only vanity roles. Reaper creates or adopts only the configured rank list with zero permissions, no hoist, no mentionable state, and no channel overwrites. Created/adopted role IDs are stored in `discord_resources` with metadata for member profile title mapping. Member profile titles render only from fresh verified Discord roles matched to enabled Reaper-managed rank records. Leaders still assign rank roles manually in Discord for v1.

See [`../docs/member-profiles-and-rank-roles.md`](../docs/member-profiles-and-rank-roles.md) for the retired website surface boundary and verification checklist.

## Instagram Publishing Queue

Instagram publishing uses three moderator-only Edge Functions:

- `list-instagram-publish-queue`
- `check-instagram-api-status`
- `publish-instagram-gallery-submission`
- `mark-instagram-gallery-submission-shared`

All four require a signed-in Supabase user JWT and server-side Discord Moderator verification. They use service-role credentials only inside the Edge runtime. The `member-gallery` bucket remains private. Current launch mode is manual sharing: moderators download the signed preview, copy caption and alt text, post through the official Instagram account or Meta Business Suite, optionally paste the permalink, and mark the job `shared_manually`. The Meta API status function is diagnostic-only and must not create media containers or publish posts. The API publishing function remains available only after the diagnostic passes; it creates a short-lived signed URL only when sending the image URL to Meta.

Approval behavior:

- Non-opted-in approved images do not create an Instagram job.
- Opted-in JPEG images create a `queued` Instagram job.
- Opted-in PNG or WebP images create an `ineligible` job with a clear reason.
- Existing submissions are not retroactively opted in.

The Leader Dashboard shows the Instagram Queue with preview, title, caption/subtitle, uploader, consent, eligibility, job state, last error, and permalink after publish or manual share. Moderators can edit caption and alt text, download the image, copy caption and alt text, enter a manual permalink/note, and mark a job shared manually. The dashboard must show a visible in-card confirmation before calling `mark-instagram-gallery-submission-shared` or future `publish-instagram-gallery-submission` because both record an external publishing decision.

V1 supports single-image Instagram feed posts only. Reels, Stories, carousels, hashtags automation, scheduling, and image conversion are out of scope. Any future live Meta setup, Supabase secret change, Edge Function redeployment, slash-command registration, or real Instagram post requires explicit owner approval.

## Approved Public Gallery Feed

Approved member submissions appear on canonical `/gallery` through the public Edge Function:

- `list-approved-gallery-submissions`

This Gallery Edge Function has the reviewed `verify_jwt = false` classification because `/gallery` loads without sign-in. It uses service credentials only inside the Edge runtime and exposes a public-safe, read-only DTO. The migration revokes the two `security definer` helper functions from `public`, `anon`, and `authenticated`, then grants them only to `service_role`; PostgreSQL function execution must never rely on default `PUBLIC` privileges.

Schema version 2 returns public-safe text, decoded thumbnail geometry, totals/facets, and one stable credential-free thumbnail Edge URL per item. It deliberately omits uploader identity. The item identity is the stable opaque publication ID; refreshing a thumbnail creates a new immutable revision without changing that public identity. A list response never contains a display URL. When a visitor opens one runtime item, the function rechecks that publication and delivers only its bounded metadata-stripped display derivative through the same Edge boundary. The member-owned source original is never delivered for public viewing. The Storage bucket remains private; no public bucket or anonymous Storage read policy is added.

Pending, rejected, archived, and historical approved submissions without an active immutable publication revision are not returned by the feed. Legacy null, noncanonical, incomplete, or source-only rows remain private until a moderator explicitly reviews and republishes them. A publishable revision requires complete display/thumbnail geometry plus exact object identity, version, timestamp, size, MIME, and digest evidence. Malformed database evidence and delivery-budget denial fail closed. The function never partially delivers a page, skips an item, advances a cursor past a failed item, or exposes object paths or provider errors.

The Next Gallery browser normalizes published member submissions into the same item model as the static `data/gallery.json` Gallery before rendering. It traverses sequential opaque cursors instead of applying a fixed 80-row cap. The first page establishes a stable snapshot over immutable revisions; later publications and revisions wait for the next traversal. Retired revisions remain available for at least the cursor delivery overlap so an in-flight snapshot does not drift. Server totals and facets represent the complete filtered snapshot. Every runtime item belongs to Member Submissions and one moderator-reviewed canonical visual category. Historical null or noncanonical source categories never create a public category or item; source fields are not fallbacks.

The default Random mix keeps its server-rendered static order stable and appends runtime submissions, preventing a late feed response from reshuffling cards already on screen. Newest and Oldest combine sources only through the runtime keyset prefix proven complete. Member submissions use their reviewed title and/or caption in the existing lightbox without public uploader attribution. Existing static Gallery captions remain owned by `data/gallery.json` and should not be edited to publish member submissions.

If an older approved `gallery_submissions` row has blank `title` and `caption` values, the public lightbox will use the `Member submission` fallback until a Moderator or operator updates that row in Supabase. Future uploads preserve non-empty title and caption values from `gallery-submit.html` into `gallery_submissions`.

Public Gallery ordering uses one normalized timestamp model. Static curated images use `galleryAddedAt` in `data/gallery.json`; published member items use their frozen reviewed and created timestamps with the stable publication ID as the final key. The default Gallery order is computed before first paint and runtime cards append without moving rendered static cards. Visitors may choose `Newest first` or `Oldest first`; cross-source results are exposed only through the proven keyset boundary. Runtime thumbnails and display derivatives use stable credential-free Edge URLs backed by private, immutable media evidence; source originals and unpublished submissions remain private.

The source contract keeps the existing inventory at exactly 33 configured Edge Functions with 20 `verify_jwt=true` and 13 false. It reuses `list-approved-gallery-submissions`; no 34th function is introduced. Recalculate that parity at the final exact release head before provider approval.

Before release, run `operations/reconcile_gallery_public_feed_v2.sql` from a
trusted read-only session. It reports only public-safe counts and verifies that
eligible totals, category facets, and complete keyset traversal reconcile; it
does not expose object paths or mutate data.

See [`../docs/integrations/gallery-public-media-delivery.md`](../docs/integrations/gallery-public-media-delivery.md) for the versioned DTO, keyset cursor, bounded Edge media, global quota, retry, and rollout boundaries.

## Local Testing Flow

## Private Live Spinner

`20260726180052_add_private_live_spinner.sql` adds five service-only tables for
the shared roster, idempotent moderator commands, immutable 30-day receipts,
bounded delivery state, and five-minute moderator authorization cache. Every
table has RLS enabled; browser roles have no direct table privileges. The
migration also installs the bounded maintenance and daily retention schedules.
`20260727033342_add_spinner_media_jobs.sql` adds a sixth service-only table for
best-effort replay media metadata. It stores no media bytes, waits for the
winner message before rendering, and cannot roll back or alter the primary
draw/result flow.

The two spinner functions are:

- `spinner-live-session`: validates exact viewer or controller authority,
  serves viewer-safe snapshots, and applies idempotent moderator commands after
  the result is selected and durably staged.
- `reaper-spinner-dispatch`: claims only the semantic raffle outbox, posts the
  same-origin live-page link to the exact allowlisted channel, and edits that
  same message with the stored result. Mentions are disabled. It then handles
  independently bounded, capability-scoped replay rendering and idempotent
  attachment to that completed message.

The Website session endpoints send only the signed-in access token and requested
mode for authorization. Participant names and winner information are not part
of authentication requests. Browser clients cannot read service credentials or
the dispatch authorization value. Configuration, empty-outbox validation,
single-draw acceptance, duplicate reconciliation, and forward-fix recovery are
documented in `../docs/operations/private-spinner.md`.

## Local Testing Flow

Recommended local checks:

```sh
npm run check
git diff --check
node --check supabase.js
node --check auth.js
node --check account.js
node --check gallery-submit.js
node --check leader-dashboard.js
supabase db reset
supabase migration list
```

For Gallery regression:

```sh
python3 -m http.server 8765
npm run smoke:gallery
```

For production smoke:

```sh
npm run check:production
```

For Edge Function loading checks without deployment:

```sh
npm run check:supabase-edge-types
```

## Manual Discord Role-Granting Flow

1. A visitor joins the Discord server from existing website Join links.
2. The member completes Discord server onboarding/verification.
3. Leadership grants both required roles inside Discord:
   - `1468659807736299520`
   - `1078630751077142615`
4. The member signs into the website with Discord.
5. The member opens Account or Submit Image and checks Discord verification.
6. The website calls `verify-discord-member`.
7. If both roles are present and the member is not pending, the website profile becomes active for uploads.

For moderators, leadership grants the Discord Moderator role:

```text
1078630751165222984
```

The Leader Dashboard appears from the Account page only after server-side moderator verification succeeds.

## Deferred Plans

Deferred role-assignment automation:

- Design a separate Discord bot or backend job.
- Keep bot tokens server-side only.
- Require explicit leadership/security approval before assigning roles from website actions.

Deferred public gallery publishing:

- Add an optional curated static-publishing workflow if approved member submissions ever need permanent static Gallery records.
- Keep pending, rejected, and archived private submissions out of `data/gallery.json`.
- Preserve current public Gallery captions and image paths unless a later scoped task changes them.
