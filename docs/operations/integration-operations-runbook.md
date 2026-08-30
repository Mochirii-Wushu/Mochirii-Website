# Integration Operations Runbook

This runbook is the no-secret operating checklist for Mochirii website work that touches GitHub, Supabase, Vercel, browser evidence, or provider-adjacent reports. It complements `AGENTS.md`, `docs/operations/deployment.md`, and `supabase/README.md`.

## Source Anchors

Use current official docs before changing provider behavior:

- GitHub protected branches, required reviews, required status checks, and rulesets.
- Supabase Branching GitHub integration, database advisors, RLS, explicit grants, leaked-password protection, and CLI docs.
- Vercel Git integration, Preview/Production environments, env-var docs, Web Analytics, and Speed Insights docs.
- OpenAI Codex manual guidance for `AGENTS.md`, skills, MCP, hooks, plugins, and task instructions.
- MDN CSP, WCAG 2.2, Web Vitals, and Next.js docs for frontend/security/performance work.

## Provider Mutation Gates

Provider reads are allowed when credentials are scoped to child-process environment variables and outputs stay redacted. Provider mutations require an explicit owner approval message naming the exact target and action.

- GitHub: require approval before changing branch protection, rulesets, required checks, repository security settings, Actions secrets, Pages settings, or repository permissions. PR creation, PR body updates, commit pushes, and normal merge/check verification are allowed when the task explicitly asks for GitHub publication.
- Supabase: require approval before changing dashboard Auth settings, Data API exposure, project integrations, secrets, Edge Function deployments, remote database state, branch settings, or production data. Migrations may be committed locally through PRs, but do not run `supabase db push` unless the task explicitly approves remote mutation.
- Vercel: require approval before changing project settings, domains, DNS, env vars, deployment protection, analytics settings, production deployment aliases, or integration settings. Read-only `inspect`, `env ls`, and preview/status reads are allowed with redacted reporting.
- DigitalOcean/Spaces/Cloudflare: require approval before changing Droplets, firewalls, backups, monitoring, Spaces buckets/keys/CORS/CDN/lifecycle, DNS records, TLS mode, HSTS, cache rules, or origin protection.
- Discord/Meta/Enjin/Fly/Pixelfed: require approval before changing portals, secrets, roles, webhooks, funded-chain state, hosted runtimes, federation settings, or quota/cost-bearing operations.

Use exact approval wording in task updates, for example: `Approve enabling Supabase Auth leaked-password protection for project deyvmtncimmcinldjyqe now.` For account-linking releases, use: `Approve enabling Supabase Auth Manual Linking for project deyvmtncimmcinldjyqe so signed-in users can link Discord, Google, Twitch, and Apple identities from Account.`

## Standard Evidence Gates

Run the smallest gate that matches the change, then broaden when provider or user-facing behavior changes:

- Baseline: `npm run toolchain:check`, `npm run check`, `git diff --check`, `npm audit --audit-level=moderate`.
- Next app: `cd apps/web && npm run toolchain:check && npm run lint && npm run build && npm audit --audit-level=moderate`.
- Production-sensitive work: `npm run check:production` and `npm run smoke:dns-cutover-post -- --base-url=https://mochirii.com --www-mode=redirect`.
- Provider evidence: `npm run check:full-stack-release-evidence -- --providers --strict-provider`; add `--write` only after strict mode passes.
- Supabase work: `npm run check:supabase-security-performance`, `npm run check:supabase-edge-types`, relevant Deno tests, migration list, linked advisors, and exact-head `supabase-local-preview` evidence. The provider transition from hosted Preview branches remains approval-gated under `docs/operations/supabase-local-preview-ci.md`.
- Browser/accessibility/performance work: route matrix, accessibility route matrix, Lighthouse Home/Recruitment/Gallery, and focused Playwright smokes for authenticated or media flows.
- CSP work: `npm run check:csp-inline-hardening -- --live --write`; do not remove inline allowances until Preview browser evidence covers Supabase, Spotify, and Vercel telemetry.

## Current Integration Expectations

- Live app surface: Vercel/Next.js under `apps/web` for `https://mochirii.com`.
- Vercel release policy: the GitHub website repository is currently public. Keep that visibility unless the owner separately approves changing it. Vercel Git checks that still point at the old private-organization plan limitation are stale until rerun or refreshed; do not use those stale statuses as current release evidence. If the owner later approves making the repo private again and Vercel Git checks become unavailable, use the documented protected/admin merge plus owner-approved manual Vercel CLI production deploy path with tokens scoped to child-process environment only.
- Website/service navigation split: `https://mochirii.com` is the public information site. Header and footer Social links hand off directly to `https://social.mochirii.com`; the Website `/social` route stays noindex while redirecting signed-in members and offering signed-out login/help copy. Header and footer Forums links hand off directly to `https://forums.mochirii.com`; the separate Forums repository and runtime remain the sole owners of that service's availability, content, data, and operations.
- Game/social split: `/games/mochi-pets` is a Website-hosted tester doorway with a disconnected runtime contract, `Mochirii-Wushu/Mochirii-Pets` is the fresh Unity source owner, and Mochirii Social is the single hosted guild identity and future chat platform. Web/iOS artifacts and game identity remain approval-gated under `docs/mochi-pets-future-project.md`.
- Historical static recovery: GitHub release `legacy-static-final-2026-07-18`; it is not an editable or live rollback surface.
- Supabase project: `deyvmtncimmcinldjyqe`; browser code may only receive public URL and publishable key.
- Vercel project: production-serving `mochirii/mochirii` with root directory `apps/web`.
- Mochirii Social runtime: `social.mochirii.com` is live outside Vercel. `Mochirii-Wushu/Mochirii-Social` exclusively owns the application, image, deployment, verification, backup, recovery, and runtime operations. Website owns only the member doorway, Supabase OAuth consent surface, `social_accounts` mapping, and trusted sync Edge Function; do not add Social application code, host secrets, media credentials, or infrastructure state to this repository. `docs/pixelfed-guild-social-adr.md` is retained as historical evidence only, not operational guidance.
- Mochirii Social continuity: two-account and administrator-continuity verification is complete; this public runbook records no account identifiers. Registration remains closed and federation remains disabled. Any future Social behavior or provider change remains approval-gated.
- GitHub Pages: no repository Pages configuration is active. Website rollback uses a prior ready Vercel deployment; restoring the archived static release would require a separate provider packet.
- Supabase pull-request validation: the source-owned `supabase-local-preview` context always reports and runs the full local database/Edge suite for owned paths. Hosted `Supabase Preview` remains authoritative until the separately approved GitHub/Supabase transition in `docs/operations/supabase-local-preview-ci.md` is completed; do not change either provider setting from source work alone.
- GitHub security alerts: code scanning, Dependabot, and secret scanning should remain at zero before release-sensitive merges.
- Audio: `apps/web/public/assets/audio/mochiriiiiii.mp3` remains an accepted large-asset warning unless the owner explicitly approves optimization.

## Branch And PR Rules

- Start from updated `main` after the readiness baseline.
- Use one scoped branch per task.
- Keep reports no-secret and reviewable.
- Prefer squash/merge through protected-branch policy after checks are green.
- After merge, sync local `main`, run the approved manual Vercel production deploy when the change is production-bound, verify a clean worktree, and only then start the next scoped branch.
