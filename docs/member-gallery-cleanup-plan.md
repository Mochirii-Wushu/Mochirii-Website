# Member Gallery Cleanup Plan

Date checked: 2026-07-06

This plan defines how to think about cleanup of private member Gallery uploads. It does not authorize data deletion, change retention, alter migrations, deploy Edge Functions, or mutate Supabase.

Cleanup work must stay evidence-led because the public Gallery feed, private Storage objects, database rows, moderation events, signed URLs, and member expectations are connected.

## References

Official Supabase references checked for this plan:

- Delete Storage objects: <https://supabase.com/docs/guides/storage/management/delete-objects>
- Storage schema design: <https://supabase.com/docs/guides/storage/schema/design>
- Storage access control: <https://supabase.com/docs/guides/storage/security/access-control>
- Storage size usage: <https://supabase.com/docs/guides/platform/manage-your-usage/storage-size>
- Supabase cost usage runbook: [`docs/supabase-cost-usage-runbook.md`](./supabase-cost-usage-runbook.md)
- Moderation runbook: [`docs/member-gallery-moderation-runbook.md`](./member-gallery-moderation-runbook.md)

Supabase's Storage docs distinguish object deletion from SQL metadata edits. Future cleanup should use the Storage API through a trusted admin path, not direct SQL edits against `storage.objects`.

## Current Facts

Current member Gallery behavior:

- Storage bucket: `member-gallery`
- Bucket visibility: private
- Upload cap: `8 MiB` / `8388608` bytes
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`
- Submission statuses: `pending`, `approved`, `rejected`, `archived`
- Review previews: prepared one at a time through a private same-origin sanitizer; no signed Storage URL reaches the browser
- Public approved-feed media: bounded Edge delivery by opaque publication ID; no signed Storage URL reaches the browser
- Public Gallery reads approved member submissions through `list-approved-gallery-submissions`
- Leader Dashboard reads queue states through `list-gallery-review-queue`
- Moderation actions are expected to create `gallery_moderation_events`
- Rejected smoke-test cleanup is implemented through `delete-rejected-gallery-submission` and the Leader Dashboard rejected queue. It remains deploy-gated until the Edge Function is explicitly deployed.

The current website does not expose a retention scheduler or broad owner-facing permanent delete workflow. The focused rejected-cleanup path is for rejected smoke-test artifacts or explicitly owner-approved rejected items only.

## Cleanup Principles

- Prefer moderation status changes before permanent deletion.
- Keep the `member-gallery` bucket private.
- Keep static Gallery data separate from member submissions.
- Never edit `apps/web/public/data/gallery.json` to hide or remove member uploads.
- Never delete Storage objects directly from routine moderation.
- Never delete Storage metadata with SQL.
- Do not treat rejected cleanup as a durable moderation audit event; related rows use cascading foreign keys and may be removed with the submission row.
- Never paste signed URLs, Storage paths, user IDs, or private screenshots into public places.
- Require explicit owner approval before permanent deletion.
- Use a dry-run inventory before any future destructive action.

## Proposed Retention Policy

These are planning targets, not active automation.

| State | Proposed retention posture | Cleanup trigger | Notes |
| --- | --- | --- | --- |
| Pending | Keep until reviewed. Review weekly when active. | Escalate if pending longer than a review cycle or preview cannot load. | Do not delete while a member reasonably expects review. |
| Approved | Keep while public Gallery display is desired. | Archive first if removal is needed. Delete only after a separate owner-approved cleanup task. | Approved images may be visible through signed URLs until status/feed refresh. |
| Rejected | Keep short-term for member context and audit. | Consider cleanup after the appeal/resubmit window expires, or immediately for smoke-test artifacts. | Focused admin cleanup deletes the private object and rejected row; do not use it for unresolved member disputes. |
| Archived | Keep as non-public retained material until an owner-approved cleanup window. | Candidate for future cleanup after inventory confirms no public dependency. | Archive is the safest pre-delete state. |
| Orphaned object | Investigate before any action. | Candidate only when Storage object has no matching valid submission row and owner approves. | Confirm object owner/path/date before deletion. |
| Orphaned row | Investigate before any action. | Candidate only when DB row points to a missing object and cannot be repaired. | Do not approve rows whose preview/object cannot load. |

Recommended first human policy decision for a later branch:

- rejected retention window
- archived retention window
- whether members may request permanent removal
- whether approved removals should become `archived` first
- who can authorize permanent deletion

## Cleanup Inventory

A future cleanup branch should begin with a read-only inventory.

Minimum inventory fields:

- submission ID
- user ID
- status
- storage bucket
- storage path
- file size
- MIME type
- created date
- reviewed date
- reviewer
- rejection reason presence
- latest moderation event
- Storage object exists?
- row/object mismatch?
- public-feed eligible?

Do not publish raw inventory if it contains private identifiers, Storage paths, or member details. Public reports should summarize counts and decisions only.

Suggested inventory buckets:

- pending older than the agreed review window
- rejected older than the agreed retention window
- archived older than the agreed retention window
- approved but intended for removal
- Storage objects without `gallery_submissions` rows
- `gallery_submissions` rows whose Storage object is missing
- oversized or invalid-MIME historical rows, if any exist

## Approval Gates

Permanent cleanup requires all of these:

1. A scoped branch or admin ticket exists.
2. Owner approval identifies the exact retention rule.
3. A dry-run inventory lists candidate counts.
4. Candidates are grouped by status and risk.
5. No protected content or static Gallery data is in scope.
6. The bucket remains private.
7. A rollback/restore expectation is documented, even if restore is "not available."
8. A trusted admin path is selected.
9. Final validation includes Gallery, Leader Dashboard, approved feed, and protected-data diffs.

Stop if any candidate cannot be explained by the agreed policy.

## Future Implementation Shape

Recommended future branches, in order:

1. `qa/member-gallery-cleanup-inventory`
   - Read-only inventory report.
   - No deletion.
   - Redacted counts only in public PR text.

2. `docs/member-gallery-retention-policy`
   - Owner-approved retention windows.
   - Moderator-facing wording.
   - No deletion.

3. `admin/member-gallery-cleanup-dry-run`
   - Dry-run tool or report that lists candidates without deletion.
   - Must not expose secrets or private paths in public logs.

4. `admin/member-gallery-cleanup-execute`
   - Only after approval of the dry-run output.
   - Use a trusted backend/admin context.
   - Delete objects through the Storage API, not SQL metadata edits.
   - Update or preserve database rows according to the approved policy.
   - For rejected smoke-test artifacts, use the Leader Dashboard rejected cleanup action once `delete-rejected-gallery-submission` is deployed.

5. `qa/member-gallery-cleanup-regression`
   - Verify public Gallery, approved feed, moderation queue, member submission history, and signed-out browsing after cleanup.

Do not combine dry-run and destructive execution in one unreviewed branch.

## Manual Admin Responsibilities

An approved admin operator should:

- confirm the active branch and scope
- confirm credentials are local and not committed
- confirm the exact project ref
- run only read-only inventory first
- export only redacted summaries
- avoid screenshots with private paths or signed URLs
- request owner approval before deleting anything
- record what was deleted by count/status, not by public private path
- rerun validation and browser smoke after cleanup

Moderators should:

- use the Leader Dashboard for normal approve/decline work
- archive or escalate questionable approved items instead of asking for ad hoc deletion
- avoid sharing signed preview URLs
- report stale pending or rejected queues during monthly review

## Signed URL Expectations

Signed URLs are temporary access links, not permanent public assets.

- Review queue previews should be treated as private operational links.
- Public approved-feed signed URLs should expire and be refreshed by the feed function.
- Cleanup reports should not include signed URL values.
- If a preview fails, refresh once. If it still fails, leave the item unapproved and escalate.
- After archiving or deleting an approved item, verify the public Gallery feed no longer renders it after normal refresh.

## Risks

Primary risks:

- deleting Storage metadata with SQL and leaving billable orphaned objects
- deleting an object while the approved feed still references its row
- removing audit evidence needed to explain moderation decisions
- leaking private Storage paths or signed URLs in reports
- using service-role credentials in a public browser or public log
- creating a cleanup script that can run against the wrong Supabase project
- hiding a production issue by deleting evidence before review

Risk reducers:

- dry-run first
- redacted summaries
- exact project confirmation
- status-based grouping
- owner approval for retention windows
- one branch per cleanup stage
- no destructive commands in routine moderation

## Validation For Future Cleanup

Any future cleanup implementation should run:

```sh
npm run check
git diff --check
node scripts/check-json.mjs
node scripts/check-js.mjs
node scripts/check-refs.mjs
node scripts/check-assets.mjs
npm run check:production
npm run smoke:gallery
```

Additional checks after any approved cleanup execution:

- Home loads.
- Gallery loads.
- Approved member submissions render only when still approved and present.
- Static Gallery count and lightbox behavior remain stable.
- Leader Dashboard queues load for signed-in moderators.
- Account submission summaries do not expose private Storage paths.
- Signed-out Auth, Account, Gallery Submit, and Leader Dashboard fail safely.
- `git diff -- data/` is empty unless a future task explicitly authorizes data changes.
- Protected content is unchanged.

## Current Recommendation

Do not perform cleanup yet.

The next safe step is a read-only inventory branch after leadership chooses retention windows. Until then, keep routine moderation in the Leader Dashboard and monitor Storage growth through the Supabase cost usage runbook.
