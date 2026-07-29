# Public Brand, Copy, and Mood-Language Policy

Date: 2026-07-29

Status: proposed internal policy for repository reorganization. It changes no
member-facing copy and grants no provider, release, or publication approval.

## Brand boundary

Use the approved NFC forms on Mochirii-authored member-facing guild surfaces:

- `Mōchirīī` for the guild;
- `Mōchī` for the approved short form;
- `Mōchirīī Social` for the public Social product;
- `Mochi Pets` for the game product;
- `Mochirii Cosmetics` for the established commerce identity.

Use ASCII `Mochirii` on technical and operational surfaces, including
repository slugs, domains, package names, code symbols, API identifiers,
database objects, environment-variable names, image/container names, logs,
metrics, workflow identifiers, provider configuration, and no-secret internal
engineering documentation.

Do not globally replace names. Preserve upstream names, dependency names,
licenses, notices, compatibility records, and immutable historical evidence.

## Narrow public exceptions

A third-party name, logo, or required phrase may appear publicly only when it
is necessary for one of these purposes:

1. an authentication control using the provider's current required name,
   approved asset, and required wording;
2. consent, privacy, account-disconnection, data-deletion, support, or legal
   disclosure required by the provider or applicable law;
3. a required license, copyright notice, attribution, or platform identity
   label.

The exception is limited to the exact control or disclosure. It does not permit
promotional provider references elsewhere. Every visible provider control and
consent phrase still requires exact public-copy approval before release.

## Mood-language rule

Do not introduce mood-oriented framing into new or changed Mochirii-authored
public copy. Prohibited examples include `warm`, `calm`, `quiet`, `cozy`,
`serene`, `peaceful`, `soothing`, `dreamy`, and equivalent emotional framing.
Use direct, functional, product-specific language instead.

Older tracked guidance or public copy may contain those words. Existing
occurrences are baseline findings, not approval to add more. Do not edit them
as part of repository movement. Record each rendered occurrence and prepare a
separate exact-copy proposal for the content owner.

For reorganization work, this rule supersedes older internal writing advice
that encourages mood terms. It does not rewrite historical evidence and does
not authorize a visible wording change.

## Public scan boundary

Apply brand, mood, and copy controls to Mochirii-authored rendered surfaces,
including UI text, navigation, metadata, alt text, emails, bot messages, forum
theme copy, screenshots intended for publication, and app-store material.

Exclude from mood/brand enforcement, while preserving their own controls:

- user-generated content;
- exact provider-required authentication and legal wording;
- required licenses and attribution;
- non-rendered diagnostics, structured logs, and provider readbacks that are
  restricted to authorized operators; authenticated leader or moderator UI is
  still a rendered Mochirii surface and is not exempt;
- dependency manifests, source identifiers, and machine-generated notices;
- immutable historical Git evidence.

An exclusion is not permission to expose a secret, private topology, provider
payload, member data, or promotional provider language.

## Public-copy baseline

The existing protected hash baseline covers only its declared high-value fields.
It is not a complete inventory of rendered public copy. Until a complete
baseline exists:

- preserve tracked public text byte for byte during source movement;
- run the protected-copy, public-brand, content, and repository-boundary checks;
- scan and report existing mood-language occurrences without editing them;
- treat any rendered-text delta as a public-copy change;
- prove rendered equivalence when framework or encoding boundaries make byte
  identity impossible.

## Change-report mechanism

Before any public-copy change, create a dated review packet containing:

| Field | Required content |
| --- | --- |
| Surface | Route, component, email, bot command, forum/app-store surface, or other exact location |
| Source | Repository, path, and stable field/key or line anchor |
| Existing text | Exact current text, without paraphrase |
| Proposed text | Exact replacement text |
| Reason | Functional, legal, accessibility, provider, or correction rationale |
| Brand review | NFC/ASCII decision and any scoped exception used |
| Mood scan | Old/new occurrence result and equivalent-language review |
| Accessibility | Label, alt-text, screen-reader, keyboard, and comprehension impact |
| Localization | Locale and fallback impact, including untranslated surfaces |
| Visual evidence | Before/after screenshots when layout or rendering can change; private evidence stays ignored |
| Validation | Hash/baseline update, rendered diff, tests, and preview evidence |
| Approval | Exact content owner, approved text, timestamp, and approval reference |
| Rollback | Prior text/hash/artifact and restoration procedure |

Approval applies only to the exact recorded text and source revision. A later
edit, provider-wording change, or regenerated asset requires a new review.

## Validation and evidence

Current tracked controls include:

- [`scripts/protected-content-baseline.json`](../../scripts/protected-content-baseline.json)
  and [`scripts/check-protected-content.mjs`](../../scripts/check-protected-content.mjs);
- [`scripts/public-brand-exceptions.json`](../../scripts/public-brand-exceptions.json)
  and [`scripts/check-public-guild-brand.mjs`](../../scripts/check-public-guild-brand.mjs);
- [`scripts/check-content-guardrails.mjs`](../../scripts/check-content-guardrails.mjs);
- [`scripts/check-brand-boundaries.mjs`](../../scripts/check-brand-boundaries.mjs);
- the dated [no-change copy audit](evidence/2026-07-12/copy/no-change-copy-audit.md).

Generated screenshots, rendered dumps, and private review evidence belong under
ignored `.artifacts/operations`, not public Git. Durable approval records may be
tracked only when they contain no secrets, private payloads, or member data.
