# Mōchirīī Organization Reconciliation Ledger

This public-safe mutable ledger records the canonical GitHub organization,
repository, pull-request, issue, branch, worktree, and production-ownership
baseline. It contains no secrets, host addresses, private provider exports,
member data, or credential values. Mutable values were read back on
2026-07-28 and must be rechecked at every release gate.

Sealed evidence, merged pull requests, historical check output, and provider
audit metadata are immutable records. Old repository URLs that occur only in
those records are retained; GitHub redirects them to the canonical repository.
Active source, documentation, configuration, and new pull-request prose use the
canonical names below.

## Canonical Repository Inventory

| Repository | Visibility/state | Default branch and verified SHA | Current classification | Production ownership |
| --- | --- | --- | --- | --- |
| `Mochirii-Wushu/Mochirii-Website` | Public, active | `main` at `2eec9e467b4679fd77648ef61e77cf246ec9589b` | PR #536 is the only open organization PR. Issues #443 and #475 are classified trackers. | Owns the Vercel Website, Shopify theme source, Social source, and Supabase source. A protected-`main` merge invokes the connected Vercel and Supabase integrations; Social-source merges can also publish a GHCR image. Provider effects remain release-gated. |
| `Mochirii-Wushu/Mochirii-Social-Mobile` | Private, dormant | `main` at `7e840fe337a425b659b065abf7e04e5256614cba` | No open PRs. Issue #9 is a classified dependency/toolchain tracker. | Source validation only; no Apple build, submission, or provider mutation is implied. |
| `Mochirii-Wushu/Mochirii-Pets` | Private, dormant | `main` at `09357c0432bf6aeb55742a27699110f0a0cb76ac` | No open PRs. Issue #3 is classified future Unity work. | Fresh Unity source only; no hosted runtime, deployment, Apple submission, or recurring provider cost. |
| `Mochirii-Wushu/Reaper-Discord-Bot` | Private, active source | `main` at `79023914ee5c6502520b88aebe861904af9c2472` | PR #7 is merged; no open PRs or issues; only `main` remains. | Source and rollback reference only. The merge ran repository CI and did not deploy Reaper or send Discord messages. |
| `Mochirii-Wushu/Mochirii-Raffle-Spinner` | Private, archived | `main` at `95e917357517faeb43be9e2da6551baec213aed8` | No open PRs or issues. Two orphaned Dependabot branches are exact cleanup candidates, but deletion remains approval-gated. | Historical source only; no current deployment or schedule depends on it. |
| `Mochirii-Wushu/Mochirii-Forums` | Private, empty placeholder | No branch refs | No PRs, issues, or active source. | No production dependency or provider effect. |
| `Mochirii-Wushu/Mochirii-Social` | Private, empty placeholder | No branch refs | No PRs, issues, or active source. The hosted Social source remains under `Mochirii-Website/services/social`. | No production dependency or provider effect. |

GitHub reports exactly these seven repositories. The configured default branch
for each empty placeholder does not create a branch ref. Private-repository plan
limits leave procedural review and CI gates where enforceable rulesets are not
available. Website releases must use protected `main`, current exact-head
checks, accountable review, and no owner bypass.

## Pull Requests, Issues, and Remote Branches

- The only open pull request is Website PR #536, `chore(social): harden
  private-media bootstrap controls`, at remote head
  `bf62698fd390e9e60453beee1809f605791b8190`. Its next update must be rebased
  onto the release sequence's current `main`, reviewed, and rerun at the exact
  resulting head before any merge request.
- Provider-generated CodeQL output for the current PR still contains a former
  Website URL. That immutable output redirects correctly and is not source
  drift. Recheck newly generated output after the PR head changes.
- The four open issues are Website #443 and #475, Social Mobile #9, and Mochi
  Pets #3. Each is intentionally classified; zero open issues is not the
  acceptance criterion.
- All nonempty repositories have only `main`, except the Website PR #536 branch
  and two orphaned Dependabot branches in the archived spinner repository:
  - `dependabot/github_actions/main/github-actions-901392d03b` at
    `46fe90ceeea592888eec49b9135ef8f43dcd9f0e`.
  - `dependabot/npm_and_yarn/main/npm-dependencies-7fdb227275` at
    `29372056a6e75966694664ea120ea14a36242c45`.
- Those two archived branches may be deleted only after an exact target
  recheck and explicit destructive-action approval. The archived repository
  itself must remain archived.

## Local Website Worktrees

The current Website checkout has nine worktrees. The canonical `Website`
checkout is clean on `main` at the exact upstream SHA. The remaining worktrees
are active, superseded, or integration lanes and must not be removed until
their unique patches and ownership are proved:

| Worktree | Exact head | Classification |
| --- | --- | --- |
| `Website` | `2eec9e467b4679fd77648ef61e77cf246ec9589b` | Canonical clean `main`. |
| `Website-repository-name-reconciliation-20260728` | This branch's exact final head is the commit that contains this mutable ledger; re-read it with `git rev-parse HEAD` at the release gate. | Active canonical-name reconciliation. |
| `Website-gallery-data-v2-20260728` | `24b8bc8bbddbd6382663e2ad6180cb5e8f1c11b1` | Active Gallery data/media release source. |
| `Website-gallery-raffle-integration-20260728` | Mutable verification composition; re-read its exact head with `git rev-parse HEAD` before using its evidence. | Ordered Gallery/raffle verification composition; not a production branch. |
| `Website-raffle-integrated-20260728` | `4d91a4846043abc737dc69ccd2f0f13d1fb7bd42` | Active disabled raffle-foundation source. |
| `Website-social-private-media-bootstrap-20260728` | `7f19b9cbf51a4cc2ec3a3d680cc99e02a2bb704a` | Active PR #536 replacement/hardening lane. |
| `Website-gallery-full-stack-p0-20260728` | `9d0303250fdbc99d99b87af8ff2ddf8ccbf127ad` | Superseded candidate; retain until Gallery replacement parity is proved. |
| `Website-raffle-consolidation-utc8-20260728` | `313ef528f73cbf1f629d703aa0eb8a2f0fc8bf21` | Superseded candidate; retain until integrated raffle parity is proved. |
| `Website-raffle-leaderboard-foundation-20260728` | `9f68986d3ad8bca5940f6a0f74a9329e9ac97210` | Superseded candidate; retain until integrated raffle parity is proved. |

Final cleanup requires exact patch/tree comparison, clean status, recorded head,
and proof that no unique source, asset, test, or documentation would be lost.
Destructive worktree or branch removal is separately approval-gated.

## Provider Connection Readback

- Vercel's active production project is labeled as connected to
  `Mochirii-Wushu/Mochirii-Website`. A provider-generated hyperlink still uses
  the former GitHub path and follows GitHub's redirect; no source or provider
  mutation is required for repository naming.
- Supabase's GitHub integration is visibly connected to
  `Mochirii-Wushu/Mochirii-Website`, working directory `.`, production branch
  `main`, and production deployment enabled.
- The separate Vercel project named `web` is not Git-connected. It is only a
  cleanup candidate until domains, deployments, environment dependencies, and
  rollback impact are proved. Do not delete it without a separate exact packet.
- Reaper, DigitalOcean, Cloudflare, DNS, Spaces, Shopify, Apple, Unity, Discord,
  payments, and ActivityPub are not changed by this documentation release.

## Public Brand and Technical Identity

- Public guild name: `Mōchirīī`.
- Public short name: `Mōchī`.
- Public Social product: `Mōchirīī Social`.
- Cosmetics commerce: `Mochirii Cosmetics`.
- Repositories, domains, code symbols, migrations, environment variables,
  logs, containers, OAuth identifiers, and other technical surfaces: ASCII
  `Mochirii` and the canonical repository names in this ledger.
- Game product: `Mochi Pets`.

Do not perform blind global replacement. Required upstream names remain in
licenses, dependencies, source-compatibility notes, and internal provider
documentation. Public/customer surfaces remain Mōchirīī-branded.

## Release and Rollback Boundaries

- Re-read repository names, base/head SHAs, required checks, open PRs, function
  inventory/JWT parity, migration list, provider previews, and rollback target
  immediately before every merge.
- A Website protected-`main` merge can publish through Vercel and invoke the
  Supabase Git integration even when its patch has no Supabase source changes.
  Exact authorization must name those effects.
- Social source publication to GHCR and any DigitalOcean deployment are
  distinct approvals. Shopify publication, payment activation, Discord sends,
  Apple/Unity work, Cloudflare/DNS changes, ActivityPub, and paid resources are
  not implied.
- Credentials stay in provider secret stores and the private `Mochi Creds`
  recovery boundary. Never print, hash, summarize, commit, relocate, or inspect
  those values.
- Stop on head drift, unexpected provider effects, changed migration or
  function inventory, JWT-parity drift, failed required checks, missing
  rollback evidence, or cleanup-target mismatch.

## Completion Standard

- Zero unclassified repositories, pull requests, issues, branches, worktrees,
  provider connections, or production effects.
- Zero open scoped implementation PRs after every approved release completes;
  classified future-risk issues may remain open.
- Canonical Website and Social Mobile checkouts are clean.
- Final Vercel production metadata equals final Website `main`; Supabase source,
  migrations, function inventory, enablement, and JWT parity equal final source.
- README, architecture, integration, current-state, and release records match
  the verified live state without rewriting immutable history.
- No credential exposure and no unapproved provider or paid-resource change.
