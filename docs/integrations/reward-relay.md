# Disabled raffle reward relay contract

## Status and ownership

The reward relay is a disabled, source-only foundation under `services/reward-relay`. It is not part of the public raffle release and is not connected to Vercel, Supabase, DigitalOcean, Fly.io, a reward provider, Discord, or any scheduler. No deployment manifest, paid resource, credential value, production route, database migration, or provider configuration is included.

The canonical `Mochirii-Wushu/Mochirii-Website` repository owns the reviewed contract. A future isolated fixed-egress runtime would own electronic reward-provider traffic only after a separately approved architecture and release. Production must never depend on a developer workstation.

## Current raffle compatibility

This relay is source-only and does not alter the current disabled raffle foundation in `20260728140000_add_disabled_monthly_raffle_foundation.sql`. That foundation grants one standard entry after an eligible monthly opt-in and allows up to nine optional bonus entries, with ten total entries per person. The relay has no entry-writing capability and cannot change those limits.

Provider-specific identifiers remain internal to this integration boundary. Public raffle routes, metadata, accessibility text, errors, and public JSON must use provider-neutral Mōchirīī language.

## Trust boundaries

```text
authenticated member
  -> same-origin server claim boundary
  -> opaque one-use same-origin handle
  -> authenticated handoff route
  -> fresh transactional authorization
  -> mutually authenticated loopback relay
  -> fixed official provider API origin
  -> fresh link returned to server only
  -> final HTTPS reward redirect
```

Each transition revalidates its own authorization and input. Network position alone grants no trust.

- The browser supplies only the draw-result identifier. It cannot assert winner identity, reward kind, or reward reference.
- A trusted future server data-access adapter must atomically authorize or idempotently replay the claim by verifying the current active member, winner ownership, claim deadline and state, reward kind and reference. The handoff route must run a fresh transactional revalidation of the same facts immediately before redirecting.
- The claim boundary checks method, exact host, exact path, `Origin`, and Fetch Metadata before any relay call.
- Relay requests and responses are both HMAC-authenticated and bound to the exact request context. Request nonces are durably one-use until the absolute end of the signed timestamp's full acceptance window.
- The provider client selects one of two compiled official API origins. It rejects redirects, path escape, unbounded bodies, and timeouts.
- The handoff cookie contains only a cryptographically random opaque handle and an HMAC bound to its HTTPS origin and exact route. It contains no member, draw, reward, or URL data.
- Server-side handoff state contains only a SHA-256 handle digest, bounded claim metadata, environment, and expiry. It never contains a reward URL. Creation is unique and consumption is conditional, atomic, and one-use.
- The cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, path-scoped, short-lived, and has no `Domain` attribute.
- The link is requested only after the handle is consumed and the claim is freshly reauthorized. Both the relay response parser and final redirect boundary require the exact environment host; a generic HTTPS URL or sibling provider subdomain is rejected.
- Logs contain only event class, phase, status, trace identifier, endpoint class, and latency. Reward URLs, authorization values, bodies, member identifiers, and provider secrets are excluded.

## Claim-page isolation

The future `/raffle/claim` page is a private transition surface, not a marketing page. Its checked contract requires `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. The exact path is excluded from the shared Website shell that renders analytics and performance telemetry, and its path-specific content policy allows only same-origin execution and requests. The API responses apply the same cache and referrer policy plus a deny-all script/content policy. This source-only branch does not add or publish the page.

## Reward paths

| Reward kind | Relay allowed | Current contract result |
| --- | --- | --- |
| Electronic gift | Only after activation | An opaque handle reaches the verified winner; the server retrieves a fresh exact-host link only after final authorization. |
| In-game gift | Never | A separate game fulfillment workflow records the authorized claim. |
| Community honor | Never | A separate community workflow records the authorized recognition. |

The distinct paths prevent an in-game or community-honor award from accidentally generating a paid electronic order.

## Idempotency and reconciliation

An electronic order carries an immutable cycle UUID and uses one deterministic `external_id` derived from the immutable draw-result UUID. In one `BEGIN IMMEDIATE` transaction, local state binds the cycle to exactly one primary electronic order, records the reward value, rejects any aggregate cost above the configured cycle ceiling, binds one draw result to exactly one request digest, and marks the reservation before provider contact. A timeout or ambiguous response never causes a blind retry: the next attempt queries the same external ID and validates the returned campaign, product, value, delivery method, fees, currency, order reference, and reward reference.

Provider-only orders, missing upstream orders, duplicate upstream IDs, or binding mismatches suspend order creation. Re-enabling orders requires an explicit reviewed control action after reconciliation.

## Webhook contract

The future webhook handler must pass the unchanged raw body and signature header to the verifier. The verifier applies HMAC-SHA256 before JSON parsing, enforces a 64 KiB maximum, normalizes only bounded metadata, and uses the event UUID as the deduplication key. A repeated UUID with identical metadata is accepted as a duplicate; the same UUID with different content is an integrity conflict. Accepted and duplicate deliveries return HTTP 200 only after the store has durably and atomically recorded or confirmed the event, because non-200 responses are retried by the provider.

The in-memory store is a test double. Production activation requires a durable atomic uniqueness constraint and retention policy. Neither the raw payload nor a reward link may be retained.

## Defaults and cost boundary

`services/reward-relay/.env.example` is the checked-in policy source. Its exact defaults are provider mode disabled and order creation false. The local process accepts loopback hosts only. The source includes no infrastructure-as-code, public endpoint, fixed-egress allocation, funded balance, production key, webhook registration, or schedule; therefore this branch adds no provider cost.

## Activation gates

All of the following require a separate exact approval:

1. Legal and tax approval for the active drawing, eligible jurisdictions, official rules, claim period, winner verification, and reward treatment.
2. Provider production-account approval, organization/campaign/product reconciliation, recipient-less LINK confirmation, fee attestation, and a capped funding plan.
3. A reviewed isolated fixed-egress deployment that applies Zero Trust at every boundary: TLS, an explicit ingress allowlist and WAF/rate-limit policy, least-privilege IAM, MFA-protected operator access, encrypted storage, backup/recovery, monitoring, alert ownership, and a documented rollback.
4. Formal secret management through provider-managed secret stores: independent relay- and handoff-signing keys, least-privilege access, rotation/revocation procedures, and no credential value in Git, CI logs, documentation, or local commands.
5. A durable, transactional claim-authorization adapter plus durable opaque-handle, relay replay, and webhook UUID stores, all tested for concurrency, ownership changes, deadline transitions, and idempotent replay. No handoff schema may include a reward URL.
6. SAST, dependency audit, secret scan, image scan/SBOM/provenance, DAST against the isolated preview behind the intended WAF policy, hostile-request tests, and incident-response rehearsal.
7. An explicitly approved low-value sandbox rehearsal and separate production canary. Orders, scheduling, and claims remain disabled until every readback passes.

## Verification

The source contract is enforced by:

- `npm --prefix services/reward-relay test`
- `npm --prefix services/reward-relay audit --audit-level=moderate`
- `node scripts/check-reward-relay.mjs`
- the repository validation suite after the focused branch is rebased onto its eventual release base

The mocked end-to-end chain covers the browser request, atomic server authorization contract, opaque handle creation, fresh handoff reauthorization, final-request link generation, signed relay request and response, one-use redirect, provider failures, hostile origin/host/path metadata, cookie inspection/tampering/expiry/replay/wrong owner/wrong environment, handle revocation, full-horizon nonce retention, one-order-per-cycle cost enforcement, exact reward hosts, arbitrary-link rejection, claim-page isolation, raw-body webhook authentication and HTTP 200 acknowledgement, UUID deduplication, and separation of all three reward kinds.

## Primary references

- [Tremendous create-order endpoint](https://developers.tremendous.com/reference/create-order)
- [Tremendous LINK delivery](https://developers.tremendous.com/docs/link-delivery)
- [Tremendous official reward-link host guidance](https://help.tremendous.com/hc/en-us/articles/41472340067603-Is-Tremendous-legit)
- [Tremendous webhook verification and retry behavior](https://developers.tremendous.com/docs/webhooks-1)
- [Node.js `crypto` HMAC and randomness APIs](https://nodejs.org/api/crypto.html)
- [MDN secure cookie attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [OWASP Server-Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final)
