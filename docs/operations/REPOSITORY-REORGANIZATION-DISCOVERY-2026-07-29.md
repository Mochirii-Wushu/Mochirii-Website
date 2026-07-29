# Repository Reorganization Discovery

Date: 2026-07-29

Status: current public-safe discovery baseline. Mutable GitHub and provider
values must be read again at every release gate.

This report records the source-ownership facts needed before repository
separation. Raw provider exports, account identifiers, host details, secrets,
member data, and private evidence remain outside public Git.

## Canonical repositories

| Repository | State | Current source responsibility |
| --- | --- | --- |
| `Mochirii-Wushu/Mochirii-Website` | Public, active | Website, storefront theme, shared Supabase schema and runtime, and the current Social source pending an approved extraction. |
| `Mochirii-Wushu/Mochirii-Social` | Private, empty | Approved target for the independently owned Social application. It has no branch, release, deployment, or production responsibility yet. |
| `Mochirii-Wushu/Mochirii-Forums` | Private, empty | Approved target name for a future source-only forum operational repository. It has no runtime, hostname, or provider dependency. |
| `Mochirii-Wushu/Mochirii-Social-Mobile` | Private, active source | First-party mobile client only. |
| `Mochirii-Wushu/Reaper-Discord-Bot` | Private, active source | Persistent bot runtime. Six bot-specific Edge Functions remain in Website pending an approved migration. |
| `Mochirii-Wushu/Mochirii-Pets` | Private, active source | Fresh Unity project only. No playable artifact is connected. |
| `Mochirii-Wushu/Mochirii-Raffle-Spinner` | Private, archived | Immutable historical source only. |

The organization contains exactly these seven repositories. The canonical
names are correct. Redirects from former GitHub names point to the same
repository identities and are not duplicate repositories.

## Mutable release state

- Website protected `main` was read at
  `2eec9e467b4679fd77648ef61e77cf246ec9589b`.
- Website has two open pull requests: the canonical-name reconciliation and
  the Social private-media hardening line.
- Mochirii Pets has one open canonical-name pull request.
- Social Mobile has no open pull request; its canonical-name change is merged.
- Reaper, Social, Forums, and the archived spinner have no open pull request.
- Four open issues are classified future or risk-tracking work rather than
  unclassified implementation.
- Two orphaned Dependabot branches remain in the archived spinner repository.
  Their deletion is a separate destructive action.

The current Vercel production deployment is `READY` and bound to the Website
`main` SHA above. The hosted Supabase inventory contains exactly 33 `ACTIVE`
Edge Functions with 20 configured to verify JWTs and 13 configured otherwise.
The production source and these counts must be read again immediately before
any Website merge.

## Source findings

### Social

- The current Social tree is `services/social` in Website: 2,655 files and
  52,980,569 bytes at the audited source tree.
- Twelve protected-main commits touch that path. Eleven also touch files
  outside the path.
- The first commit is an intentionally sanitized import. Earlier superseded
  repository history was deliberately excluded and must not be invented.
- No Git LFS pointers, submodules, symlinks, or file near GitHub's 100 MiB
  object limit were found in the audited tree.
- Open Social work means the extraction cutoff cannot be selected until that
  work has merged and the protected Website `main` is frozen.

### Reaper

The following current Edge Functions are bot-specific and remain Website-owned
until an approved cutover:

1. `reaper-discord-interactions`
2. `reaper-discord-member-sync`
3. `reaper-spinner-dispatch`
4. `send-vote-reminder`
5. `send-member-spotlight-poll`
6. `publish-member-spotlight-winner`

All six currently have `verify_jwt=false`. The audited partition is Website 27
functions at 20/7 and Reaper 6 at 0/6, preserving the total 33 and 20/13
configuration. This is a planning count, not deployment authority.

Database migrations, RLS, shared tables and RPCs, guild authorization, Gallery
ingestion, the current Spotlight read surface, and spinner producer/session
contracts remain Website-owned.

### Forums

No forum application, Discourse source, hostname, runtime, provider setting, or
history exists in Website. The correct start is a clean source-only repository
initialization, not a history extraction.

## Governance findings

- Website `main` has enforced required checks.
- Current private-repository plan limits prevent enforceable branch rulesets in
  Social, Forums, Reaper, Mobile, and Pets. This must be represented honestly.
- Until plan-supported rules are available, private-repository releases need
  exact-SHA owner signoff, a current reviewed head, green CI, resolved
  conversations, and no bypass as procedural compensating controls.
- Social and Forums remain private. Their visibility must be explicitly
  approved before the first history or seed push.
- No repository move authorizes a production deployment, provider secret
  transfer, provider connection, public-copy change, recurring cost, or source
  deletion.

## Local evidence boundary

The shared local Supabase stack is not branch-authoritative as of this report;
another isolated task intentionally exercised later local migrations. Future
database validation must use a coordinated, isolated project ID and port set
whose exact migration inventory is established before testing.
