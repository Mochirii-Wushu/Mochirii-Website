# Spinner To Monthly Raffle Winner Publication

This runbook defines the source-only bridge from an authoritative official spinner receipt to the public monthly-winner feature on `/raffle`. It introduces no Edge Function, schedule, relay, secret, paid resource, or workstation dependency. Deployment remains separately approval-gated.

## Public Experience

The raffle route is server-rendered with the latest reviewed result and refreshes the same minimal same-origin contract after authentication changes, focus/visibility return, and at a bounded interval.

- Signed-out and unverified visitors receive exactly `Winner Confirmed`, the Singapore selection time, and their localized visitor time.
- A signed-in member who currently satisfies the existing active-member verification rule may also receive the stored guild display name.
- The public RPC and same-origin API return only `publicLabel`, `cycleMonth`, `selectedAt`, and nullable `displayName`. Draw IDs, member IDs, rosters, hashes, receipts, moderation data, and delivery records are rejected by the exact client parser and never enter public JSON.
- The colorful winner card uses the canonical Mochirii emblem, remains within the content container at 320 CSS pixels and 200% text, and disables decorative animation under `prefers-reduced-motion`.

This follows the [Next.js server/client composition guidance](https://nextjs.org/docs/app/getting-started/server-and-client-components), [Supabase database-function security guidance](https://supabase.com/docs/guides/database/functions), and [WCAG reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Official And Test Draws

The controller begins in official mode. **Test spin** is an explicit switch and each spin requires a mode-specific confirmation. The server normalizes `drawMode` and includes it in the command input hash, immutable receipt, persisted live state, viewer snapshot, and recovery key.

An official draw atomically reserves one result for the Singapore calendar month when its outbox row is created. The result's effective publication time is the authoritative `reveal_at`; the public RPC independently gates on `reveal_at <= now()`. Public visibility therefore does not depend on external guild-message delivery. A unique month constraint rejects a second official result for the same Singapore month.

A test receipt is durable for private review, but its outbox insert is suppressed before insertion. The dispatcher trigger is row-level and accepts only a surviving official outbox row, so a suppressed test insert cannot wake delivery for unrelated pending work. Consequently a test spin creates no guild announcement, rendered media, public result, reward side effect, or official-month reservation. The publication validator independently rejects any attempt to insert a result for a test receipt.

## Privacy And Immutability

The publication and revocation tables are service-only, RLS-enabled, and have no browser-role table grants. Result rows cannot be updated or deleted. A reviewed suppression is an append-only revocation rather than a rewrite. The one-shot historical backfill helper is dropped inside its migration after execution, so it does not remain as a callable privileged interface.

Winner labels use the spinner's normalized 1–40-character contract at roster admission, publication, and response parsing. Control and bidirectional-format characters are rejected before a draw and again at the publication boundary so a stored result cannot become misleading or unreadable.

The result RPC is `SECURITY DEFINER` with an empty search path and a fixed, no-argument return shape. It reveals a display name only after calling the existing verified-member predicate with the authenticated user ID. Anonymous responses remain generic even when the browser later transitions between sessions; an exact empty response clears any previously member-visible name.

## Reviewed July 2026 Backfill

The pre-classification production draw is handled inside migration `20260727160000_add_official_spinner_raffle_publications.sql`. The migration:

1. skips only a fresh database with no completed historical raffle outbox;
2. matches the exact reviewed selection, reveal, and completed-delivery timestamps plus the reviewed winner label;
3. requires an unclassified receipt and outbox, completed raffle delivery, a non-null authoritative actor, and exactly one match;
4. derives the draw ID, approver, and Singapore cycle month from that matched receipt;
5. inserts one `legacy-reviewed` immutable publication; and
6. drops the temporary backfill function.

Zero or multiple matches abort the populated-database migration. IDs are never hardcoded or guessed. No manual production data statement is part of the release procedure.

The original backfill predates the later official/test classification fields. Migration
`20260727211442_classify_reviewed_sya_spinner_draw.sql` repairs only that already-reviewed
draw by deriving its identifier from the immutable publication and requiring the exact
publication, receipt, completed guild delivery, and revealed live-state evidence. It
accepts either the wholly unclassified state or the already-complete official state;
partial, missing, duplicated, changed, or revoked evidence aborts the migration. A fresh
Preview database has no historical publication and is left unchanged.

This classification does not publish, announce, redraw, or create a reward. It only makes
the existing reviewed receipt readable through the same official live-state contract as
future official draws. The release readback is the aggregate-only, read-only operation
`supabase/operations/validate_reviewed_sya_spinner_classification.sql`; it returns no draw,
member, receipt, roster, command, or delivery identifiers. Before merge it must return
`migration_ready=true`, which accepts only an exact wholly-unclassified state or an already
complete wholly-official state. After deployment it must additionally return
`all_checks_pass=true`.

## Release And Readback Gate

The migration adds tables and therefore needs an exact schema-change approval. A protected-main merge also invokes the existing Supabase Git integration, which applies migrations and redeploys every function in `supabase/config.toml`; the current source has a 34-function inventory with 20 `verify_jwt=true` and 14 false. Never deploy this migration manually.

Before merge, require the exact-head Vercel and non-skipped Supabase Preview checks plus repository, Web, database-reset, pgTAP, browser, and accessibility gates. After the authorized integration completes, read back:

- exactly the expected publication and revocation tables, RLS, grants, constraints, triggers, and RPC;
- exactly one reviewed July publication and no duplicate month;
- official classification parity across that publication's receipt, completed delivery,
  and current revealed live state;
- anonymous RPC output with a null display name;
- verified-member output with the reviewed guild display name;
- current 34-function inventory and 20/14 JWT parity; and
- exact Vercel production binding plus the `/raffle` responsive/runtime matrix.

Stop on any source-binding mismatch, migration ambiguity, extra public field, wrong name-visibility state, changed function inventory, or layout/runtime regression. Rollback is a reviewed forward fix or append-only revocation; do not delete or rewrite the result ledger.

## Local Verification

From the repository root:

```powershell
npm run check:private-spinner
npm run check:live-spinner-backend
npm run check:raffle-public
npm run test:spinner
npm run test:live-spinner-backend
npm run test:raffle-latest-winner
npx supabase db reset --local
npm run test:official-raffle-publication-db
npm run test:live-spinner-backend-db
npm run test:spinner-media-backend-db
npx supabase db lint --local --level warning
npm run smoke:raffle-public:fixtures
git diff --check
```

From `apps/web`, run `npm run lint` and `npm run build` after a clean install.
