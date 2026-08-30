# Mochirii Website System Consolidation Audit

Date: 2026-07-12 PDT

This report is intentionally no-secret. Credential contents were not read,
printed, hashed, or copied during the filesystem inventory.

## Canonical Layout

```text
C:\Github Repo's\Mochirii Website\
  .ignore
  website\         Git repository: Mochirii-Wushu/Mochirii
  pixelfed-ops\    Git repository: Mochirii-Wushu/mochirii-pixelfed-ops
  operations\      Local no-secret checkpoints and runbooks
  Mochi Creds\     Private Proton Drive synchronized credential boundary
```

The project root is not a Git repository. Each source repository owns its own
`.git` directory, and the private credential directory is outside both Git
worktrees. The root `.ignore` prevents recursive ripgrep searches from entering
the private directory.

## Audit Coverage

- Enumerated 1,360,268 entries across fixed drives `C:` and `D:` without
  following reparse points.
- Treated the project and unrelated credential roots as opaque private
  boundaries.
- Inventoried all detected Git roots and compared remotes.
- Scanned WSL `Ubuntu-24.04` under `/home`, `/opt`, `/srv`, and `/tmp`, excluding
  Windows mounts already covered by the fixed-drive scan.
- Inventoried Docker images, containers, and volumes.
- Checked Windows services, scheduled tasks, startup commands, environment
  variables, listening processes, and relevant shortcuts.
- Checked repository-local environment files, ignored files, naming rules,
  archives, logs, case collisions, and long paths.
- Ten locations could not be enumerated: nine protected Windows/system-volume
  locations and one volatile WindowsApps build path. None is a user project or
  normal source-code location.

## Verified Results

- The only Mochirii website source markers and matching Git remotes are the two
  canonical repositories.
- No second website or Pixelfed ops clone exists on either fixed drive or in
  WSL.
- The old Documents and CodexWork website paths are compatibility junctions,
  not duplicate worktrees.
- The website and Pixelfed ops working trees are clean on
  `codex/canonical-mochi-creds-path`.
- The website full toolchain and aggregate validation suites pass after active
  runbooks were corrected to use the canonical path.
- The Pixelfed ops production/runtime validation suite passed for the existing
  local documentation commit.
- No real `.env`, private key, token, or credential file exists inside either
  repository. Tracked `.env` files are examples or test configuration.
- The project credential boundary contains 43 files; the unrelated credential
  boundary contains 15 files; their basenames do not overlap.
- Credential ACLs allow only the current Windows account and `SYSTEM`, and no
  credential file is cloud-only.
- Proton Drive is running and responsive. Its most recent dashboard readback in
  this task sequence showed both credential folders synchronized with storage
  optimization disabled.
- Across 3,726 maintained project files, there are no case collisions,
  trailing-space/dot names, paths over 240 characters, stray logs/backups,
  or source-tree archives.
- No Mochirii website service, scheduled task, startup entry, listener, local
  container, or local volume is required for production.

## Intentional Separate Areas

- Mochi Pets and Mochi Social game repositories remain separate and untouched.
  Their local folder names and remote repository names differ, so future game
  work should begin with an explicit identity check before any rename.
- Non-Mochirii runtime files, shortcuts, development environments, backups,
  and repositories remain outside this Website audit.
- Shopify state is limited to the Website-owned theme and provider boundaries
  documented in this repository.
- Deno, Composer, Codex, Unity, browser, and Windows Recent entries are caches,
  application state, or history rather than authoritative website source.
- `Mochi Creds\$Temp\Trash` is empty Proton Drive sync scaffolding and should
  not be treated as a project folder.

## Cleanup Candidates

These items are not authoritative source and were deliberately not deleted:

- 127 Mochirii/Pixelfed-named `%TEMP%` items totaling 1,569,772,174 bytes,
  primarily upload fixtures, tar exports, screenshots, logs, and helper scripts.
- Two unused local Docker image tags for Pixelfed validation, each reporting
  2.31 GB. Shared layers mean their displayed sizes are not additive.
- Four stale Windows Recent shortcuts whose targets no longer exist.
- Regenerable Deno and Composer cache entries that preserve historical paths.
- An empty application-state directory under the Codex local app-data area.

Cleanup should use exact targets rather than a broad temp or Docker prune. Docker
documents that `image prune -a` removes every image not referenced by a
container, so project-specific image removal is safer when unrelated images are
present.

## Local Release State

- Website branch head: `f1bfc9745063436df02124c1d42fe0f4d169106a`.
- Pixelfed ops branch head: `a5bd0614449c26c67a5467f75343bfc34c715f70`.
- Both branches are local and unpublished.
- Historical reports and the dated online-hosted resume retain their original
  paths as time-accurate evidence; maintained runbooks use the canonical path.

## References

- Microsoft file naming rules:
  https://learn.microsoft.com/windows/win32/fileio/naming-a-file
- Git repository layout:
  https://git-scm.com/docs/gitrepository-layout.html
- Proton Drive Windows folder sync:
  https://proton.me/support/proton-drive-windows-sync-folder
- Docker image cleanup behavior:
  https://docs.docker.com/reference/cli/docker/image/prune/
