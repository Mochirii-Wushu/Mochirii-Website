# Social Service Entitlement v1

Status: source foundation only. Provider activation remains blocked.

## Contract

`mochirii.social-service-entitlement` version `1` is the Website-owned,
service-specific authorization result for Mōchirīī Social. It is additive to
the existing member-access response and does not replace Gallery eligibility.

The only grant predicate is:

```text
active && discordVerified
```

Here, `active` means exact `member_status === "active"`.
`discordVerified` means an exact trusted Discord identity match with the
required-role evidence still inside the bounded verification window. A
manual Gallery approval never grants Social access, and Gallery continues to use its
existing independent policy.

The response has these exact fields:

- `contract`: `mochirii.social-service-entitlement`
- `version`: `1`
- `service`: `social`
- `allowed`: exact boolean
- `memberStatus`: exact source status or `null`
- `discordVerified`: exact boolean
- `reason`: one versioned reason
- `evaluatedAt`: canonical server timestamp
- `validUntil`: canonical verification expiry for a grant, otherwise `null`

Consumers fail unavailable on missing, nested, malformed, inconsistent,
unknown-field, stale-response, future-response, or wrong-version contracts.
A valid denial is distinct from an unavailable verifier.

## Source Consumers

- `verify-member-access` emits the contract from one evaluation time while
  preserving `galleryEligible`, `manualApproved`, and every existing Gallery
  behavior.
- `/api/oauth/decision` requires a successful outer function envelope and an
  allowed v1 contract before submitting an approval. Denials remain permitted
  without membership so a member can cancel safely.
- The consent UI requests a Discord refresh and uses the same strict contract
  for presentation, its approval button, and prior-consent redirect handling.
- `sync-pixelfed-social-account` requires the strict contract and immediately
  marks the Website-side Social account revoked on an authoritative denial.

## Deliberate Launch Blockers

This source change does not secure every OAuth token issuance path. The custom
consent UI and `/api/oauth/decision` are not the token issuer; prior-consent and
refresh-token paths can bypass that route. A separately reviewed server-side
all-token-issuance policy, exact Social client mapping, provider activation,
rollback, and hostile provider tests are required before launch.

The sync bridge evaluates stored Discord evidence and does not itself perform a
live Discord refresh. Production activation therefore remains blocked until a
reviewed live-refresh/revocation design is accepted, or an explicit bounded
staleness decision is recorded. Social transport authentication, durable
revocation/outbox processing, Pixelfed session termination, and Forums SSO are
separate contracts and are not implemented here.

No source result authorizes a Supabase, OAuth client, Vercel, Pixelfed,
DigitalOcean, DNS, or other provider mutation; provider activation remains blocked.
