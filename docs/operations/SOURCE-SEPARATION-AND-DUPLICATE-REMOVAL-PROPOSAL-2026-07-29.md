# Source Separation and Duplicate Removal Proposal

Date: 2026-07-29

Status: proposed exact cleanup order. Nothing is authorized for deletion by
this document.

## Removal prerequisites

An active duplicate may be removed only when:

- the target owner has an accepted reviewed `main`, an exact approved path and
  inventory mapping, behavior/contract parity, and immutable source hashes;
  tree parity remains required for Social's filtered extraction;
- target CI, security scans, artifact identity, and provider readbacks pass;
- old and new consumers pass together before cutover, and an immutable former
  source bundle/commit and verified rollback target remain available throughout
  the rollback window without preserving two active deployment owners;
- no unique patch, asset, test, document, tag, release, issue, PR, or LFS object
  would be lost;
- the exact resolved deletion paths and refs are rechecked immediately before
  action;
- a separate destructive-action approval names every target.

## Social cleanup order

1. Accept filtered Social history and target-root support files.
2. Publish and verify the target-owned immutable image under a separate
   provider approval.
3. Perform the rollback-safe runtime cutover and observation window.
4. In a paired Website PR, remove `services/social`, Social-only workflows,
   Social-only Dependabot entries, root Social check hooks, and implementation
   runbooks that moved to Social.
5. Retain Website OAuth/member contracts and concise versioned pointers.
6. Remove Website package/environment access only after rollback expires.

Do not delete Website Git history. The former Social path remains recoverable
from existing commits and the verified source bundle.

## Reaper cleanup order

1. Merge and validate the additive Reaper six-function source with no deploy.
2. Prove the exact six-name production cutover and total 33-function 20/13
   parity under separate approval.
3. Merge the Website 27-function ownership removal only after proving that its
   deployment neither prunes nor overwrites the six Reaper functions. Use an
   isolated Supabase Preview or disposable project populated with the six
   functions before applying the 27-function Website configuration, or obtain
   authoritative provider evidence; otherwise stop.
4. Preserve former Website function bundles and the Reaper fallback handler
   through the rollback window.
5. Remove the fallback and active duplicate docs only after observation;
   retain historical reports unchanged.

## Local Website worktrees

Preserve these active or future lines until their exact patches are integrated:

- canonical-name reconciliation;
- Social private-media hardening;
- Gallery v2;
- disabled raffle full-stack foundation;
- repository-separation ADRs.

Never remove the canonical Website checkout or these dirty user worktrees:

- `mochi/vendor-mcp-setup`, which contains unrelated untracked work;
- `agent/meta-gallery-publishing-20260728`, which contains substantial tracked
  modifications and untracked work.

The clean superseded Gallery/raffle construction worktrees and old recovery ref
are cleanup candidates only after patch-ID/tree parity with accepted final
branches. Resolve absolute paths under the workspace before any removal.

## Repository branches and empty directories

- Delete a merged feature branch only after the merge SHA, remote branch head,
  and no-unique-commit proof are read back.
- The archived spinner's two orphaned Dependabot branches may be deleted only
  under an exact archived-repository cleanup approval; keep the repository
  archived.
- The empty workspace-level `services` and `supabase` directories are local
  candidates only. Confirm they remain empty, outside every Git worktree, and
  outside credential/recovery boundaries before a separately approved removal.
- Never delete a repository, credentials directory, immutable evidence,
  provider state, runtime data, backup, or path derived from an unresolved
  variable/glob.

## Acceptance evidence

The final cleanup record names every removed branch/worktree/path, its prior
head or emptiness proof, the accepted replacement, the approval, and whether it
is recoverable. Final `git worktree list`, local status, GitHub branch/PR/issue
inventory, and provider source bindings must contain zero unclassified items.
