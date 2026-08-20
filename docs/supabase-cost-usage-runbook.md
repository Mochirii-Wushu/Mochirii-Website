# Supabase Cost Usage Runbook

Source contract checked: 2026-08-01
Provider usage snapshot: 2026-07-28

This runbook gives leaders a safe way to monitor Supabase usage for the member Gallery, Discord verification, approved Gallery feed, and moderation workflows. It is operational guidance, not a billing quote. Before making billing or quota decisions, check the current Supabase dashboard and the live Supabase pricing/docs pages.

Do not paste secrets, tokens, private Storage paths, signed URLs, member identifiers, or invoice screenshots into public issues, Discord channels, reports, or docs.

## Current References

Official Supabase references checked for this runbook:

- Pricing: <https://supabase.com/pricing>
- Cost controls and Spend Cap behavior: <https://supabase.com/docs/guides/platform/cost-control>
- Storage size usage: <https://supabase.com/docs/guides/platform/manage-your-usage/storage-size>
- Egress usage: <https://supabase.com/docs/guides/platform/manage-your-usage/egress>
- Monthly Active Users usage: <https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users>
- Storage file limits: <https://supabase.com/docs/guides/storage/uploads/file-limits>
- Storage bandwidth and request attribution: <https://supabase.com/docs/guides/storage/serving/bandwidth>
- Storage CDN behavior: <https://supabase.com/docs/guides/storage/cdn/fundamentals>
- Supabase changelog index: <https://supabase.com/changelog.md>

The 2026-08-01 changelog scan did not show a Storage egress breaking change
that alters this response. Cached and origin Storage egress remain separately
metered, and the current repository already uses Node.js 22.

## July 2026 Egress Incident Snapshot

The read-only dashboard snapshot on 2026-07-28 showed:

- current-cycle egress: `9.623 GB` used from `5 GB` included in the Free plan;
- current-cycle overage: approximately `4.623 GB`;
- 2026-07-06: `2.483 GB` Storage egress, `99.8%` of that day's displayed service breakdown;
- 2026-07-27: `2.75 GB` Storage egress, `98.1%` of that day's displayed service breakdown;
- cached egress remained much smaller than origin egress; and
- Database, Auth, Edge Functions, and Realtime did not account for the two large days.

This proves that Storage delivery, not database traffic or function count, is
the immediate cost driver. It does not identify a member, object, requestor, or
single automation job. Free-plan log retention did not provide object-level
results for the full incident window, so do not guess an object path or delete
data as a response. Usage already accrued in the billing cycle cannot be
reversed; containment protects the remaining cycle and future cycles.

## What Can Drive Usage

Mochirii's live public site is served by the Vercel/Next.js app in `apps/web`.
Static page views, public assets, CSS, JavaScript, and audio files are served by
the site host, not Supabase.

Supabase usage comes from the member workflows:

- Auth: Discord OAuth sign-ins and active member sessions.
- Database: `member_profiles`, `gallery_submissions`, `gallery_moderation_events`, `discord_resources`, and `discord_sync_log`.
- Storage: private `member-gallery` image objects for pending, approved, rejected, and archived submissions.
- Edge Functions: `verify-discord-member`, `list-gallery-review-queue`, `moderate-gallery-submission`, `list-approved-gallery-submissions`, `submit-discord-gallery-image`, `list-instagram-publish-queue`, `mark-instagram-gallery-submission-shared`, and `publish-instagram-gallery-submission`.
- Egress: Auth/API responses and Edge Function responses, including bounded Gallery media proxied from private Storage.
- Logs: function logs, moderation troubleshooting, and dashboard observability.

Expected normal use is small, human-paced, and tied to guild activity. Runaway use usually looks like sudden public approved-feed traffic, repeated verification attempts, automated upload attempts, Instagram queue retries, unexpected Storage growth, or repeated function errors.

## Current Delivery Protections

The current approved Gallery delivery path limits the byte multiplier before
an original is requested:

- approved member images have bounded thumbnail derivatives of at most `80 KB`;
- the browser displays at most `24` new Gallery cards per batch, so a full
  member-thumbnail batch is bounded to `1.92 MB` before page/static overhead;
- the browser does not request an approved original until a visitor opens its
  viewer;
- pending, rejected, and archived objects remain outside the public feed;
- both modern and legacy list JSON pass through one serializer capped at the
  same `65,536` bytes reserved for the request;
- the private bucket remains unchanged, while public delivery uses stable Edge
  URLs with exact object-size/hash verification and no signed bearer URL;
- the database-serialized global budget caps combined Gallery delivery at 64
  MiB per UTC day, with per-kind minute and daily request ceilings; and
- broad local gallery/browser matrices intercept the approved feed with
  deterministic fixtures.

The database-backed public-delivery window is a shared `64 MiB` source budget
for list, thumbnail, and display reservations. Each list request conservatively
reserves `64 KiB`, so list traffic alone has an effective ceiling of `1,024`
requests per UTC day. Thumbnail and display reservations consume the same
window and can make the actual list ceiling lower. This is a fail-closed
application budget, not a promise that Supabase bills every reservation as
exactly that many bytes; provider egress is measured from bytes actually sent
by Supabase services.

Broad gallery and browser matrices now refuse the canonical production Website
origin by default. A deliberately approved bounded production canary requires
the exact process-scoped variable
`MOCHIRII_ALLOW_LIVE_GALLERY_MEDIA_SMOKE_ONCE=true`. Do not save that variable
in a shell profile, `.env` file, CI configuration, or provider setting. Normal
development and broad browser verification should use the local fixture-backed
origin. Manual Gallery Lighthouse builds the same production client used for
release, then places a test-only loopback audit proxy in front of it. The proxy
intercepts the exact public Gallery request at audit time; no fixture mode or
loopback origin is compiled through a `NEXT_PUBLIC_*` value. A
Vercel Preview or Production Lighthouse run is live provider traffic and
requires the same exact one-shot opt-in plus separate source-binding evidence
for the reviewed deployment.

## Current Member Gallery Policy

The active upload policy from the repo and production review is:

- Bucket: `member-gallery`
- Bucket visibility: private
- Browser and bucket Gallery submission cap: `8 MB` / `8388608` bytes
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`
- Public Gallery delivery: approved immutable publications only, through stable credential-free Edge media URLs; the service reserves expected bytes globally before each private-object download
- Pending, rejected, and archived submissions: not listed in the public Gallery

Do not make the bucket public to reduce complexity. That would change the privacy model and must be handled as a separate security-reviewed branch.

## Dashboard Checks

Use read-only dashboard checks unless a separate approved task explicitly authorizes mutation.

Check these at least monthly, and immediately after high-traffic guild events:

- Organization usage page: total usage for the current billing period.
- Billing page: upcoming invoice estimate, quota warnings, and Spend Cap state.
- Storage usage: `member-gallery` size and object growth.
- Egress usage: total egress, cached/uncached egress, and service breakdown where available.
- Edge Function metrics: invocations, errors, latency, and unusually noisy routes.
- Auth usage: Monthly Active Users and OAuth sign-in volume.
- Database size: table growth for member and moderation tables.
- Logs: repeated `401`, `403`, `429`, `5xx`, quota-reservation failures, or media integrity failures.

Safe dashboard actions:

- view usage charts
- filter by project/time period
- inspect function logs with private values redacted
- compare current use to the last monthly review
- export a redacted summary for internal planning

Do not perform these from a routine cost check:

- `supabase db push`
- `supabase functions deploy`
- direct Storage object deletion
- table row deletion or manual status edits
- secret changes
- plan upgrades, add-ons, Spend Cap changes, or billing mutations

Those require explicit owner approval and a scoped branch or admin task.

## Thresholds

Use these internal operating bands to decide whether to keep observing or
escalate. They are deliberately below the provider limit and are not a billing
quote.

Normal:

- Storage grows only when members upload images.
- Approved-feed traffic follows normal public Gallery traffic.
- Function invocations roughly match sign-ins, queue checks, moderation actions, and Gallery approved-feed loads.
- Function errors are rare and tied to expected signed-out or unauthorized states.
- Monthly Active Users resemble the current active Discord/member population.
- Current-cycle egress is below `2.5 GB` (50% of the current Free allowance),
  and the projected cycle total remains below `3.75 GB`.
- The three-day Storage egress average is at or below `100 MB` per day.

Watch:

- Storage grows faster than known member upload activity.
- Many files sit in pending or rejected states for more than a review cycle.
- `list-approved-gallery-submissions` invocations jump after public sharing.
- `publish-instagram-gallery-submission` retries repeat after a Meta or credential failure.
- `verify-discord-member` calls spike without a matching guild event.
- Function `429`, `5xx`, quota-reservation, or media-integrity errors repeat.
- Egress rises without a matching public traffic explanation.
- Billing dashboard shows quota or overage warnings.
- Current-cycle egress reaches `2.5 GB`, projected cycle use reaches `3.75 GB`,
  a single day exceeds `250 MB`, or the three-day Storage average exceeds
  `100 MB` per day.

Stop and escalate:

- A secret, service role key, bot token, private Storage path, or bearer-capability URL appears in a public place.
- Storage grows from unknown prefixes or unknown users.
- The private bucket becomes public.
- Protected functions accept anonymous mutation requests.
- Billing shows unexpected overage risk or runaway usage.
- Fixing the problem appears to require database mutation, Storage deletion, Edge Function deployment, or secret rotation.
- Current-cycle egress reaches `3.75 GB` before the final seven days, the
  projected cycle total reaches the included limit, or an unexplained day
  reaches `500 MB`.

At the stop threshold, stop nonessential live media matrices immediately and
move validation to local fixtures. Do not make the bucket public,
delete objects, rotate URLs, resize infrastructure, or change plans as an
unreviewed containment shortcut.

## Cleanup Implications

Storage cleanup must be planned carefully because database rows, private
objects, immutable publication evidence, moderation events, and bounded Edge
delivery are linked.

- Deleting a `gallery_submissions` row alone does not prove the Storage object was removed.
- Deleting a Storage object alone can leave a row whose preview or approved feed no longer works.
- Rejected and archived submissions remain private but may still consume Storage.
- Approved submissions may be visible in the public Gallery until their status or object state changes through the approved admin path.
- Moderation events are accountability records and should not be rewritten as routine cleanup.

If cleanup is needed, follow the reviewed `docs/member-gallery-cleanup-plan.md` as a separate scoped admin task. Never perform ad hoc production deletion.

## Normal Review Checklist

Monthly:

1. Open the Supabase organization usage page.
2. Check Storage size and egress for the Mochirii project.
3. Check Edge Function invocation and error trends.
4. Check Auth Monthly Active Users.
5. Check database size for member/gallery tables.
6. Review whether pending/rejected/archived submissions are accumulating.
7. Record a redacted summary in the relevant internal tracker.

After a guild event or traffic spike:

1. Check `list-approved-gallery-submissions` invocation volume.
2. Check egress and public Gallery traffic timing.
3. Check function error logs for repeated bounded media-delivery failures.
4. Check whether new uploads match known member activity.
5. If growth is abnormal, stop and open a scoped QA/admin branch.

While a Storage egress incident is active, review the dashboard daily until
the billing cycle resets and three consecutive daily samples return to the
normal band. Record only service totals, dates, percentages, and status; never
record object paths, signed URLs, or member data.

## Incident Response

For unexpected usage:

1. Capture the symptom: affected service, time window, rough magnitude, and dashboard page.
2. Redact all private values before sharing.
3. Stop broad production-origin media matrices and use local fixtures.
4. Confirm whether public site traffic, Discord event activity, moderation work, or a release verification window explains the change.
5. Use the dashboard service breakdown and the Logs Explorer Storage Egress Requests template when retained data is available; aggregate by request count and bytes without copying paths.
6. Inspect function logs without copying tokens or private identifiers into public channels.
7. If a bug is likely, open a scoped QA branch and reproduce locally or with safe mocks.
8. If data mutation or provider configuration is needed, stop and get explicit owner approval.

For suspected credential exposure:

1. Stop routine work.
2. Do not paste the credential into chat, docs, reports, or PRs.
3. Rotate the secret from the trusted provider/dashboard.
4. Review affected logs and function access.
5. Open a security report branch only after the secret is rotated or redacted.

## Safe Command Boundary

Safe read-only commands may include:

```sh
supabase --version
supabase status --help
supabase functions list --project-ref deyvmtncimmcinldjyqe --output json
supabase secrets list
```

Read-only SQL or dashboard checks are acceptable only when credentials are already available and the current task authorizes inspection. Do not include query output containing private member data in public reports.

Do not run without explicit approval:

```sh
supabase db push
supabase functions deploy
supabase migration new
supabase secrets set
```

Do not run Storage deletion or table mutation commands from this runbook.

## Definition Of Healthy

The member Gallery cost posture is healthy when:

- the site remains static and browser-safe
- the `member-gallery` bucket remains private
- Gallery submissions stay capped at 8 MB and image-only MIME types
- approved public images are served through stable, credential-free Edge URLs
  backed by exact immutable media evidence and the global delivery budget
- protected functions fail closed for anonymous users
- usage growth matches member activity
- broad gallery/browser matrices use local fixtures unless a bounded live canary has exact approval
- projected egress remains below the internal watch and stop thresholds
- dashboard checks show no quota, invoice, or error surprises
- cleanup decisions are planned before Storage is deleted
