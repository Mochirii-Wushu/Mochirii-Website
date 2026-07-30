# Member Gallery Moderation Runbook

This runbook covers the website Leader Dashboard workflow for member Gallery submissions and the separate Facebook Page and Instagram publication queues. It contains no credentials, private provider identifiers, signed URLs, or private Storage paths.

## Control boundaries

The workflow is intentionally split into three audited decisions:

1. A member submits an image for the website Gallery.
2. A moderator prepares and inspects a private preview, then approves or rejects the Gallery submission.
3. For each destination the member selected, a moderator reviews the final copy and performs a second confirmation before one public provider request.

Upload and initial Gallery approval never publish to Meta. Facebook Page and Instagram publishing activate independently and remain blocked while their server-side flags are false. The Facebook Groups API is not used; after a verified Page publication, a moderator may share that Page post to the official Guild group manually.

Normal moderation does not:

- make the private `member-gallery` bucket public;
- edit the static Gallery JSON;
- expose source paths, signed capabilities, provider tokens, or private pins;
- deploy functions, apply migrations, change secrets, or enable publication flags;
- retry an ambiguous provider request;
- create an Instagram media object or Facebook Page post during diagnostics.

## Access requirements

Moderators must sign in through the website, remain active Guild members, complete onboarding, and hold the configured Discord moderator role. The server performs a bounded live role lookup and fails closed on timeout, rate limiting, missing role, or configuration drift.

If access is denied, do not bypass the check in browser tools. Reauthenticate once, confirm the account and role through the normal owner process, and escalate if the result remains incorrect.

## Member submission and consent

The member form accepts static JPEG, PNG, or WebP files up to 8 MiB. Selecting either public destination requires JPEG. The member must attest that they own or may submit the image and have permission involving identifiable people.

Instagram and Facebook Page choices are independent and unchecked by default. Selecting neither creates no social job. Consent text identifies the destination, moderator caption and Instagram alt-text editing, possible manual Page-to-Group sharing, persistence of third-party copies, and withdrawal or deletion instructions at `mochirii.com`.

The server records the current consent contract, destination, member, submission, timestamp, source-object evidence, and derivative evidence. Browser timestamps are not authoritative.

## Review queue

The dashboard has Pending, Approved, Rejected, and Archived Gallery views. Queue entries expose only the reviewed browser DTO. They do not contain a raw Storage path, signed preview URL, member provider identifier, or source hash.

Refresh before acting when another moderator may have changed an item. Every mutation carries the item’s current `updated_at`; a stale revision fails closed.

### Prepare and inspect the private preview

For a Pending item, or an Approved item that needs new public media:

1. Choose `Prepare private preview`.
2. Wait for the prepared image to decode in the browser.
3. Confirm the image, title, caption, and one canonical Gallery category match.
4. Check the reported decoded width and height.
5. Approve, decline, or prepare a replacement thumbnail only after inspection.

The same-origin website route obtains one metered source reservation, validates the exact private source object, fully decodes it, and re-renders a metadata-free WebP preview. The browser receives no private source URL. Canceling the browser request aborts the bounded upstream work. A prepared preview is discarded when the queue, item revision, authorization state, or selected item changes.

Accepted sources are at most 8 MiB, 4096 pixels on either edge, and 12.6 megapixels. If preview validation fails, leave the item pending; never approve from the filename or text alone.

### Approve or decline

Approval reuses the inspected preview Blob. The browser creates a metadata-stripped display WebP and thumbnail without downloading the private original again. The backend verifies the media, commits the Gallery decision and immutable publication revision atomically, and creates at most one queued job for each currently consented destination.

Approval and category selection are not a bulk backfill. For historical approved rows, use a separate authorized operation to prepare a current immutable publication revision. Do not infer missing categories or social consent from old data.

Decline requires a concise member-facing reason. Rejected cleanup is destructive and remains limited to disposable test artifacts or a separately owner-approved item.

## Destination publication queues

Both queues are moderator-only. Each public action has a prepare step followed by a separate confirmation button. The confirmation fingerprint binds:

- destination;
- job ID and current state;
- attempt count and `updated_at` revision;
- final caption and Instagram alt text;
- current moderator.

Editing copy, refreshing the queue, changing the job, or receiving a stale revision invalidates the prepared confirmation. Each destination requires a non-empty final caption. URL-like text is rejected for both destinations, so automated publication copy cannot add a website or external link.

### Instagram

Instagram requires a non-empty moderator-reviewed alt text. The Edge publisher uses the pinned Graph version, creates one media container from the private sanitized JPEG derivative, performs one bounded status read, and publishes only when the container is ready. Nonterminal or ambiguous results enter `reconcile_required`; they are never retried automatically.

The legacy manual-completion path is an authenticated `409` compatibility stub. Historical jobs remain visible but cannot be silently upgraded or API-published. No automated Instagram copy or profile field should contain `mochirii.com` or another external link.

### Facebook Page

Facebook publication sends the sanitized JPEG to the pinned official Page. Success requires returned identity and canonical-permalink verification against the server-side Page pin.

The manual Guild-group handoff appears only on a verified Published card. It opens the official group for a human moderator to share the Page post. Do not add a Group API request or describe group sharing as automatic.

## Consent withdrawal

Members withdraw one destination at a time:

- Queued, failed, or ineligible jobs are canceled atomically.
- Publishing or uncertain jobs are quarantined for moderator inspection.
- Published jobs create a removal request; the interface never claims the external copy was removed automatically.

The original consent and immutable withdrawal event remain in the audit trail. External shares may persist after Mōchirīī removes its own copy.

## Reconciliation and incidents

Use reconciliation only after inspecting the pinned official account when a provider request may have succeeded but the response was uncertain. Record either a verified provider identity/permalink or a confirmed no-publication result. Never guess and never retry first.

For an incident:

1. Disable only the affected destination flag.
2. Preserve jobs, consent, and audit evidence.
3. Inspect the official provider account.
4. Reconcile the ambiguous job.
5. Rotate credentials if exposure is possible.
6. Reactivate only after a separate owner approval and read-only diagnostic.

Do not include tokens, private IDs, raw provider responses, signed URLs, source paths, member media, or access-token debugger screenshots in issues or public reports.

## Deployment and provider boundary

Routine moderation must not run:

```text
supabase db push
supabase functions deploy
supabase secrets set
vercel deploy --prod
```

Migrations, named Edge deployments, Website production deployment, credential installation, destination activation, and each first genuine canary are separate owner-approved actions. Both publication flags stay false during source, Preview, and read-only provider validation.

## Focused local validation

Use mocked browser state and loopback-only requests. No validation should contact Meta, the hosted database, or shared Supabase ports.

```text
npm run check:gallery-approved-feed
npm run check:instagram-gallery-publishing
npm run check:facebook-page-gallery-publishing
npm run test:gallery-approved-feed-client
npm run test:gallery-browser-state
npm run test:gallery-safe-preview
npm run test:gallery-moderation-preview
npm run test:instagram-action-confirmation
npm run test:facebook-page-action-confirmation
npm run test:social-publication-confirmation
npm run test:social-publication-request
npm run test:social-publication-copy
npm run test:social-consent-withdrawal
npm run smoke:meta-gallery-workflow
npm --prefix apps/web run lint
npm --prefix apps/web run build
git diff --check
```

Production smoke tests, genuine submissions, provider posts, Page-to-Group shares, and removal actions require their own explicit approvals.
