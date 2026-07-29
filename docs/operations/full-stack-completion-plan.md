# Mōchirīī Full-Stack Completion Plan

Status: Active reconstructed plan

This is a new durable plan derived from the current repository, approved task
decisions, and verified provider boundaries. It does not claim to be a
byte-for-byte recovery of the unavailable earlier attachment. Exact commits,
function inventories, migration lists, provider states, and prices are mutable
evidence and must be read back at each release gate.

## Completion standard

The program is complete only when:

- every active repository has one documented owner, clean protected/default
  branch, classified issues, and no unclassified or superseded pull request;
- every production route, handler, redirect, integration, data boundary, and
  deployment writer is represented in a versioned contract and deterministic
  validation;
- production is bound to reviewed source and passes route, accessibility,
  responsive, security, runtime, rollback, and provider readbacks;
- private features reject unauthorized requests before rendering sensitive
  application state and revalidate authority at every data/write boundary;
- provider changes are performed only by the named approved writer and never
  inferred from local success;
- no production service depends on this workstation, a local credential copy,
  a developer process, or an untracked file; and
- every remaining nonlaunch feature is explicitly `Deferred`, with an owner,
  activation trigger, cost/security boundary, and next review condition.

`Complete` never means closing valid risk-tracking issues, deleting immutable
evidence, rewriting history, weakening a check, or silently treating a skipped
provider preview as a successful changed-source preview.

## Scope and ownership

| Surface | Source owner | Production writer | Completion boundary |
| --- | --- | --- | --- |
| Public/member Website | `apps/web` | Protected-main Vercel Git integration | Exact source binding, full route/browser matrix, runtime health, rollback deployment |
| Hosted backend | `supabase` | Protected-main Supabase Git integration | Exact migrations/functions, RLS/advisors, function versions and JWT parity, fail-closed smoke |
| Storefront | `apps/shopify-theme` | Separately approved Shopify operator packet | Twenty evidence-complete SKUs, exact pricing, nonpayment operations, unpublished candidate acceptance |
| Mōchirīī Social | `services/social` | Reviewed GHCR image plus separately approved DigitalOcean deployment | Private access, OAuth, media, backup/restore, branding, readiness, rollback |
| Discord/Reaper | `Reaper-Discord-Bot` plus declared Edge boundaries | Repository CI; deployment/send only by separate approval | Event parity, signatures, idempotency, hosted supervisor and recovery evidence |
| iOS Social client | `Mochirii-Social-Mobile` | Future Apple/Xcode release packet | First-party Social-only client, no embedded provider secrets, no release until separately approved |
| Mochi Pets | `Mochirii-Pets` Unity repository; Website owns public concept/doorway | Future immutable Web/iOS artifact packets | Fresh source only; no restored prototype, no paid runtime, fail-closed tester access |
| Forums | `Mochirii-Forums` | None until a future reviewed hosting decision | Governance bootstrap only; no implied deployment |

The exact repository basenames and public branding conventions are controlled
by the organization naming decision and repository ownership documentation.
Public guild surfaces use `Mōchirīī` and `Mōchī`; commerce and technical
boundaries retain their approved ASCII names where required.

## Phase 0: evidence and approval discipline

1. Start each repository and worktree with `git status --short --branch`.
2. Preserve user work and credential boundaries; never inspect or copy secret
   values into source, commands, logs, reports, pull requests, or chat.
3. Record current base/head/tree, remote PR head, changed paths, required
   checks, provider effects, rollback target, and stop conditions before every
   remote write.
4. Keep generated logs/readbacks in ignored `.artifacts/operations`; durable
   public-safe contracts live under `docs/operations` or `docs/integrations`.
5. Treat read-only source, GitHub, Vercel, Supabase, Shopify, Cloudflare,
   DigitalOcean, Spaces, Discord, Apple, and other dashboard evidence as
   separate truth levels. Never substitute one for another.

## Phase 1: organization and repository reconciliation

1. Merge the canonical Website naming/governance prerequisite only after its
   corrected exact head passes every strict required context and accountable
   review. Its protected-main merge may publish Website, redeploy the then
   current declared functions, and publish a Social image; those exact effects
   require approval and readback.
2. Change Mochi Pets Unity CI so ordinary pull requests use repository-contract
   checks and do not require unavailable licensed/editor execution. Keep exact
   Unity editor validation manual and fail closed without explicit licensing.
3. Replay the focused Mochi Pets naming change after that CI policy is merged;
   do not force-update a divergent reviewed branch.
4. Reconcile Reaper under its canonical repository name with CI only. Runtime
   deployment and Discord sends remain separate approvals.
5. Bootstrap the genuinely empty Forums repository with governance files only.
6. Replace—not force-rewrite—divergent Website private-media work, and classify
   every remaining branch/worktree as merged, replacement source, preserved
   evidence, deferred, or safely removable.
7. Delete only branches/worktrees whose exact replacement or patch parity has
   been proven and whose target path has been revalidated immediately before
   removal.

## Phase 2: Website route and authorization foundation

1. Generate the route inventory from App Router source and require every page,
   handler, redirect, dynamic route, noindex boundary, access class, browser
   scenario, and rollback behavior to appear in the route matrix.
2. Consolidate raffle public information on `/raffle`; remove `/raffle/rules`
   and its dynamic versions rather than leaving duplicate or misleading
   surfaces. Retain one standard entry plus nine reviewed bonus methods and the
   visitor-local timestamp contract with an internal UTC+8 calendar basis.
3. Introduce a server-readable Supabase cookie session and verified-claims data
   access layer. Reject signed-out `/oauth/consent` and `/leader-dashboard`
   requests before protected content renders; return an opaque denial to
   authenticated nonmoderators; revalidate at route/action/data boundaries.
4. Keep phone sign-up fail closed until CAPTCHA, resend cooldown, provider
   limits, abuse telemetry, and a complete recovery flow are proven.
5. Bound every request and upstream response while streaming. Do not buffer an
   untrusted request before applying its byte ceiling.
6. Continue CSP nonce/hash hardening, per-identity/IP throttles, timestamped
   body-bound HMAC with replay prevention for server-to-server intake, and
   browser/native-aware Social MFA for private media.

## Phase 3: Gallery v2

1. Replay only the eight reviewed Gallery feature commits and their focused
   finalization commits onto the final prerequisite `main`; never replay mixed
   or dirty branches wholesale.
2. Keep private originals private. Publish only human-reviewed,
   metadata-stripped immutable WebP display and thumbnail derivatives bound to
   source approval and publication-ledger evidence.
3. Preserve a fixed 16:10 grid with truthful intrinsic dimensions and one
   shared Home/Gallery viewer. Full media loads only after opening, uses an
   abortable bounded credential-free GET, and disposes stale object URLs.
4. Preserve server-rendered deep links, Back/Forward state, native Share with
   Copy Link fallback, keyboard/focus/scroll restoration, safe areas, 200%
   text, reduced motion, and zero horizontal reflow at 320 CSS pixels.
5. Require source-approved, private-ledger, and publication-ready counts to be
   exactly equal before the runtime feed returns any page.
6. Run database reset, pgTAP, lint, advisors, and reconciliation only in a
   disposable uniquely named Supabase project and exclusive ports. Never use a
   shared stack whose migrations belong to another worktree.
7. Republish historical approved units one at a time only under an exact
   allowlisted data-write packet with human derivative/category review and
   per-item readback. Do not auto-classify or bulk-promote.
8. Keep the shared 64 MiB UTC-day public media budget and verify current egress
   before and after release. Recalculate capacity if usage or plan terms change.

See [`GALLERY-THUMBNAIL-ROLLOUT.md`](./GALLERY-THUMBNAIL-ROLLOUT.md) on the
current baseline. The focused Gallery candidate adds the final completion
runbook when it is replayed into the reviewed source.

## Phase 4: raffle and rewards foundation

1. Release the unified inactive public page independently from the disabled
   operational backend. Never show dead entry, claim, admin, or reward controls.
2. Preserve standing eligibility: verified guild member, age 18+, approved
   country, no purchase necessary; active-cycle dates/rewards/rules are exact
   cycle data rather than evergreen promises.
3. Signed-out visitors see only `Winner confirmed`; verified members may see
   the guild display name. Store and publish the authoritative spinner result
   once, while test spins remain isolated from official evidence.
4. Reconstruct the disabled raffle migration/functions/server auth/leaderboard
   from focused source, then rerun migration reset, pgTAP, advisors, Edge,
   relay, Discord, SSR, idempotency, replay, browser, and failure scenarios.
5. Keep entries, bonus entries, claims, scheduling, reward orders, and relay
   closed by default. Missing/invalid configuration always fails closed.
6. Do not activate electronic rewards until official rules, country matrix,
   tax/withholding, provider production approval/KYB, funding, MFA, webhook
   ownership, bearer-link handling, fixed-egress relay ownership, and a
   separately approved low-value canary are complete.

## Phase 5: Social, Discord, and hosted continuity

1. Verify Website-to-Social OAuth against the current registered first-party
   client/callback without exposing client identifiers or secrets. Keep public
   Social branding Mōchirīī-only and ActivityPub disabled.
2. Require Social root/login/readiness, private-access, mobile reflow, OAuth
   round trip, container health, Caddy boundary, Redis/MariaDB/Horizon/scheduler,
   Spaces private-media, and backup/restore evidence at the deployed digest.
3. Add private-media MFA and throttling without breaking native bearer clients;
   never apply a browser-session-only middleware indiscriminately.
4. Reconcile Website event definitions with Discord preview first, then apply
   only an exact schedule diff under separate authorization. Do not send test
   messages merely to prove connectivity.
5. Prove Reaper hosted supervision and recovery without requiring this
   workstation. Never guess a backup key or dispatch recovery as a smoke test.

## Phase 6: storefront prepayment completion

1. Preserve password protection, unpublished candidate, and disabled checkout.
2. Complete twenty SKU-specific physical label/box/formula/media dossiers,
   canonical emblem parity, compliance/safety/legal review, and controlled
   public facts with no generic fallbacks.
3. Set every retail price to one round-half-up calculation of authenticated
   current US account cost multiplied by 2.20; keep costs private and compare-at
   blank absent genuine prior sale.
4. Complete inventory sync, fulfillment route, contiguous-US shipping, tax,
   privacy, sender domain, MFA/access, policies, notifications, accessibility,
   responsive, search, and rollback/provider readback gates.
5. Build the candidate only from merged protected `main` and bind commit, tree,
   package digest, uploaded draft, and readback. Payment activation,
   transaction tests, publication, password removal, and soft launch remain a
   final separately approved phase.

## Phase 7: mobile and game readiness

- Keep the Social Mobile app lean and first-party to
  `https://social.mochirii.com`; no provider client secret, Droplet secret, or
  unrelated backend credential belongs in the repository or app bundle.
- Keep Mochi Pets as a fresh Unity project. The Website public concept remains
  available without local infrastructure; tester/game access stays fail closed
  until reviewed immutable Web/iOS artifacts and server authority exist.
- Repository CI may validate source contracts. Apple registration, signing,
  TestFlight/App Store submission, Unity builds, artifact hosting, and any paid
  provider are separate release packets.

## Phase 8: final verification and cleanup

1. Run clean installs, audits, static analysis, secret scanning, dependency and
   action provenance, lint, type/build, database/Edge tests, Theme Check, and
   exact task-specific contracts.
2. Test every route/access class at representative phone portrait/landscape,
   tablet, desktop, ultrawide, 200% text, keyboard, touch, reduced motion,
   Chromium, Firefox, WebKit, and required physical Safari gates.
3. Require zero unexpected console/page/request/HTTP errors; no critical or
   serious accessibility findings; accepted performance and bundle budgets;
   exact production-source binding; provider runtime health; and rollback
   evidence.
4. Regenerate public-safe current state, route/integration matrices, source
   ledger, release record, and classified residual issues from final `main`.
5. Close superseded pull requests with replacement traceability. Leave zero
   unclassified open pull requests. Keep legitimate issue trackers open.
6. Remove only proven-safe local and remote branches/worktrees, preserving
   intentional user changes and immutable evidence. Final canonical worktrees
   must be clean except explicitly classified tool-integration files.

## Stop conditions

Stop before merge or provider write on any base/head drift, required-check
failure, skipped changed-source preview, migration/function/JWT drift,
unexpected provider diff, secret exposure, route/auth regression, source/data
parity mismatch, browser/runtime error, inaccessible rollback, unreviewed
historical media, or missing human/legal/provider decision.

## Primary guidance

- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Vercel Git deployments](https://vercel.com/docs/git)
- [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [Supabase local development](https://supabase.com/docs/guides/local-development)
- [Supabase database testing](https://supabase.com/docs/guides/database/testing)
- [Supabase Auth server-side Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Shopify theme accessibility](https://shopify.dev/docs/storefronts/themes/best-practices/accessibility)
- [Apple platform security](https://support.apple.com/guide/security/welcome/web)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [NIST Secure Software Development Framework](https://csrc.nist.gov/Projects/ssdf)
