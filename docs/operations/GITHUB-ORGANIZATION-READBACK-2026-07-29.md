# GitHub Organization Readback

Captured: `2026-07-29T09:56:02.594Z`

Status: authenticated, read-only GitHub provider evidence. This report records
repository metadata, default-branch heads, and open work items returned by the
connected GitHub application. It contains no secret values and authorizes no
push, branch update, pull-request action, settings change, or deployment.

## Canonical repository inventory

GitHub repository `size` is the API-reported repository size in KiB. Empty
repositories may advertise `main` as their default branch without having a
`refs/heads/main` commit yet.

| Repository | ID | Visibility | Default branch | Size (KiB) | Archived | Default-branch head |
| --- | ---: | --- | --- | ---: | --- | --- |
| `Mochirii-Wushu/Mochirii-Website` | `1165431769` | Public | `main` | `597677` | No | `2eec9e467b4679fd77648ef61e77cf246ec9589b` |
| `Mochirii-Wushu/Mochirii-Social` | `1315393978` | Private | `main` | `0` | No | `EMPTY_NO_MAIN_REF` |
| `Mochirii-Wushu/Mochirii-Social-Mobile` | `1308068818` | Private | `main` | `6049` | No | `57deb668620da6312d571090dee55e8fb58547d2` |
| `Mochirii-Wushu/Reaper-Discord-Bot` | `1262640933` | Private | `main` | `41` | No | `79023914ee5c6502520b88aebe861904af9c2472` |
| `Mochirii-Wushu/Mochirii-Pets` | `1312993596` | Private | `main` | `125` | No | `09357c0432bf6aeb55742a27699110f0a0cb76ac` |
| `Mochirii-Wushu/Mochirii-Forums` | `1315392249` | Private | `main` | `0` | No | `EMPTY_NO_MAIN_REF` |
| `Mochirii-Wushu/Mochirii-Raffle-Spinner` | `1312814644` | Private | `main` | `3558` | Yes | `95e917357517faeb43be9e2da6551baec213aed8` |

These seven names are the canonical organization repository names at capture
time. The archived raffle-spinner repository remains historical and must not be
restored as a production source owner.

## Open pull requests

| Repository | PR | State at capture | Exact remote head | Classification |
| --- | ---: | --- | --- | --- |
| Website | [#538](https://github.com/Mochirii-Wushu/Mochirii-Website/pull/538) | Open, non-draft, mergeable | `9887798aaf8868b3cbbb59deee21904e28d1813e` | Superseded locally by additional unpushed naming/evidence corrections; do not merge the older remote head. |
| Website | [#536](https://github.com/Mochirii-Wushu/Mochirii-Website/pull/536) | Open, non-draft, mergeable | `bf62698fd390e9e60453beee1809f605791b8190` | Source-only Social private-media hardening; production activation remains separately gated. |
| Mochirii Pets | [#4](https://github.com/Mochirii-Wushu/Mochirii-Pets/pull/4) | Open, non-draft, mergeable | `aadaaedc19aaf6e85d7bd742102c616c35b3c77f` | Superseded locally by an additional unpushed documentation correction; do not merge the older remote head. |

No open pull request was returned for Social, Social Mobile, Reaper, Forums, or
the archived raffle-spinner repository. That is a capture-time result, not a
permanent assertion.

## Open issues

| Repository | Issue | Classification |
| --- | ---: | --- |
| Website | [#443](https://github.com/Mochirii-Wushu/Mochirii-Website/issues/443) | Tracked ESLint 10 and TypeScript 7 compatibility gate; keep open until its explicit criteria pass. |
| Website | [#475](https://github.com/Mochirii-Wushu/Mochirii-Website/issues/475) | Tracked Social Vue 2/Laravel Mix modernization and dependency-debt lane. |
| Social Mobile | [#9](https://github.com/Mochirii-Wushu/Mochirii-Social-Mobile/issues/9) | Tracked Expo SDK 57 build/test dependency advisory path. |
| Mochirii Pets | [#3](https://github.com/Mochirii-Wushu/Mochirii-Pets/issues/3) | Provider-gated protected Unity validation configuration. |

These issues are classified roadmap or provider-gated work. They must not be
closed merely to obtain a zero count; closure requires their own acceptance
criteria and exact authorization.

## Unread provider fields

This readback did not enumerate branches/tags beyond the named heads, releases,
packages, LFS server objects, wikis, Discussions, Pages, collaborators, teams,
rulesets, branch protection, required checks, environments, webhooks, deploy
keys, GitHub Apps, Actions secret/variable names, runner capacity, dependency
alerts, code-scanning findings, or secret-scanning findings. Those fields remain
`UNVERIFIED_PROVIDER_READBACK` until a separately authorized name-only or
public-safe readback records them.

## Refresh rule

Re-read GitHub immediately before every push, pull-request reconciliation, or
merge. A later head, visibility, archive state, work item, or settings result
supersedes this dated snapshot without rewriting it.
