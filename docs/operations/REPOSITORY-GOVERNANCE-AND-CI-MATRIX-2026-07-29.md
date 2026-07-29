# Repository Governance and CI Matrix

Date: 2026-07-29

Status: current controls and proposed target. Provider and repository settings
remain unchanged until an exact settings packet is approved.

## Current enforcement

| Repository | Current enforcement | Target exact-head context |
| --- | --- | --- |
| Website | Active default-branch rules block deletion and non-fast-forward updates and require strict current `validate`, `validate-next`, `validate-theme`, `validate-social`, `Vercel`, and `Supabase Preview` checks. The pull-request rule requires resolved threads but zero approving reviews; an always-bypass actor exists. | Preserve current strict checks; add accountable approval, stale-review dismissal or last-push approval, CODEOWNERS coverage, and a narrowly documented emergency policy when the plan supports them. |
| Social | Empty private repository; private-plan rulesets unavailable. | `validate-social / source`, native AMD64/ARM64 image tests, dependency and secret scans, SBOM/provenance, and exact filtered-history manifest. Production remains blocked without plan-supported enforcement or an approved compensating gate. |
| Forums | Empty private repository; private-plan rulesets unavailable. | `validate-forums / repository-contract`; no provider, runtime, Docker deployment, or secret access. |
| Mobile | Private repository; private-plan rulesets unavailable. | Existing `validate-mobile / validate` exact-head source, doctor, export, and production-audit checks. Apple signing/submission is separate. |
| Reaper | Private repository; private-plan rulesets unavailable. | Existing Bun CI plus `validate-reaper-edge / edge-contract` for the six-function additive candidate. No provider credentials in pull-request CI. |
| Pets | Private repository; private-plan rulesets unavailable. | Automatic `repository-contract`; credential-dependent exact-editor/build validation remains manual until its protected validation boundary is configured and approved. |
| Archived spinner | Archived historical repository. | No new implementation. Retain archive and immutable history; classify only exact stale-branch cleanup. |

Private-repository plan limits must not be described as protected enforcement.
Until that changes, each private-repository merge requires procedural controls:
exact SHA, current CI, human diff review, owner signoff after the latest push,
resolved conversations, explicit provider-effect statement, and verified merge
readback.

## CODEOWNERS proposal

No current organization team can be used as a Mochirii-only CODEOWNERS owner.
Do not place a personal account name in tracked source and do not invent a team.
After approval, create an organization team such as
`@Mochirii-Wushu/maintainers`, then cover:

- every repository's `.github/**`, `AGENTS.md`, security and release files;
- Website Auth, public copy/assets, Shopify theme, Supabase migrations/RLS/
  functions/configuration, and deployment contracts;
- Social Docker/Caddy/systemd/recovery/image publication and upstream pins;
- Reaper Discord handlers, command manifest, Edge Functions, deployment and
  rollback code;
- Mobile bundle/signing/privacy manifests and build profiles;
- Pets Unity packages, project settings, build scripts, LFS rules and artifact
  manifests;
- Forums upstream/plugin/theme locks, identity, backup, restore, deployment and
  public-theme source.

Team creation, permissions, rulesets, required reviews, and bypass actors need
their own exact GitHub settings approval. Source migration does not imply it.

## Workflow baseline

Every active workflow must:

1. use `permissions: contents: read` by default and grant only job-local
   permissions that are required;
2. pin third-party Actions to full reviewed commit SHAs;
3. pin runtimes, package managers, CLIs, images, and lockfiles;
4. use hosted runners; no workstation or production-host runner;
5. set a bounded timeout and concurrency serialization; side-effect-free pull-
   request validation may cancel superseded runs, while stateful live writes
   normally use `cancel-in-progress: false` unless rollback-safe cancellation
   is proven;
6. check out exact reviewed source with persisted credentials disabled;
7. keep pull-request jobs free of production secrets and write privileges;
8. use protected or separately approved deployment gates for live writes;
9. emit public-safe summaries without matched secret values or private payloads;
10. bind every artifact to commit, tree, dependency manifest, checksum, SBOM,
    and provenance where the plan supports attestations.

## Security settings proposal

Enable the dependency graph, Dependabot alerts, security updates, version
updates, dependency review, CodeQL/SAST, secret scanning, and push protection
where repository visibility and plan support them. Record unsupported controls
and use compensating local/CI scans; never claim a disabled or unavailable
control is active.

Production workflows require environment-scoped secrets by name only, least-
privilege access, MFA for human administrators, and short-lived workload
identity where the provider supports it. Secret values never enter Git, pull
requests, artifacts, logs, or documentation.
