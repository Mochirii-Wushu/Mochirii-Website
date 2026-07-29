# Mochirii reward relay

This directory is a source-only, disabled foundation for electronic raffle rewards in the canonical `Mochirii-Wushu/Mochirii-Website` repository. It is not connected to the public raffle pages, Vercel, Supabase, a reward account, a scheduler, or any hosted runtime. It creates no infrastructure or recurring cost.

It is compatible with the current `20260728140000_add_disabled_monthly_raffle_foundation.sql` contract of one standard entry plus up to nine optional bonus entries. The relay cannot read or write entries, alter the public raffle contract, or activate a drawing.

The checked-in posture is deliberately closed:

- `TREMENDOUS_MODE=disabled`
- `TREMENDOUS_ORDERS_ENABLED=false`
- loopback-only binding (`127.0.0.1` or `::1`)
- no deployment templates or provider secrets
- no production Next.js route integration

Starting this source in its default configuration cannot contact the reward provider or create an order. Activation requires a separate reviewed release and explicit authorization for infrastructure, secrets, funding, provider access, and a bounded canary.

## Security contract

The relay exposes only five exact JSON `POST` routes:

- `/v1/readiness`
- `/v1/orders`
- `/v1/orders/by-external-id`
- `/v1/rewards/state`
- `/v1/rewards/link`

Every accepted request uses HMAC-SHA256 over the method, exact path, timestamp, nonce, and body digest. Nonces are durably consumed through the absolute final millisecond in which their signed timestamp can remain valid, timestamps have a maximum 60-second skew, request bodies are bounded, and authenticated responses are separately signed over the exact path, HTTP status, originating request timestamp and nonce, and canonical response digest. Unsigned, stale, replayed, malformed, query-bearing, oversized, or unknown requests fail closed.

Provider access is restricted to the two fixed official API origins selected by the configured environment. Reward handoffs separately allow only the exact environment host: `testflight.tremendous.com` for sandbox and `reward.tremendous.com` for production. The provider client rejects redirects, bounds responses, applies a timeout, and cannot accept an arbitrary upstream origin from environment configuration.

Order creation is recipient-less `LINK` delivery. Every signed request carries an immutable cycle UUID. One durable transaction binds that cycle to exactly one primary electronic order, records its reward value, enforces the configured per-cycle cost ceiling before provider contact, and binds the deterministic external ID to one draw result. The reservation is marked uncertain before the network request. Retries reconcile the same external ID instead of issuing a second order. Provider conflicts or response-integrity failures suspend orders.

Generated reward links are accepted only from the exact environment-specific HTTPS reward host. They are retrieved only during the final authenticated server request, validated again immediately before redirect, and never placed in cookies, browser storage, handoff state, durable relay state, analytics, or logs. The proposed server boundary accepts only a draw-result identifier from the browser; a trusted server adapter must atomically verify active membership, current winner ownership, claim deadline and state, reward kind and reference, and idempotency. It repeats that authorization immediately before retrieving the link.

The browser receives a random opaque handle with an origin-and-path HMAC, a maximum 60-second lifetime, and `HttpOnly; Secure; SameSite=Strict` attributes. Server-side state stores only the handle digest and bounded claim metadata. Handle creation and conditional one-use consumption are explicit adapter operations; a wrong member or environment cannot consume the rightful holder's record. The included in-memory store is test-only. It must never be selected by a deployed runtime. Production activation requires a durable transactional store with the same no-URL schema.

The future `/raffle/claim` route is governed by an explicit isolation contract: `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and no analytics, third-party scripts, or third-party requests. The site route shell excludes this exact path from shared analytics and performance telemetry, and its path-specific content policy permits only same-origin execution and requests. The current branch does not add that production route.

Webhook verification operates on the exact raw request bytes using the documented HMAC-SHA256 signature. Event UUIDs are deduplicated atomically by the integration contract. An accepted or duplicate delivery receives HTTP 200 only after the event store confirms the durable outcome, matching the provider retry contract. The sample store retains bounded metadata and a body digest, never the raw event body.

Electronic, in-game, and community-honor rewards remain distinct paths. Only the electronic path can call this relay.

## Local verification

Use the repository-pinned Node 22 toolchain:

```powershell
npm --prefix services/reward-relay test
npm --prefix services/reward-relay audit --audit-level=moderate
node scripts/check-reward-relay.mjs
```

The tests are fully mocked. They do not require credentials, call a provider, create orders, or start a hosted service.

## Activation boundary

Before any deployment, a separate change must add the real server adapter, its transactional claim-authorization data access, durable opaque-handoff/webhook/replay storage, isolated claim-page implementation, and an approved runtime design. The release packet must cover legal eligibility, tax handling, provider production approval, least-privilege secrets, fixed egress, webhook ownership, monitoring, incident response, recovery, funding limits, and an explicitly approved low-value canary. None of those gates is satisfied by this source foundation.

See [the internal integration contract](../../docs/integrations/reward-relay.md) for the data flow and activation checklist.

## Primary references

- [Tremendous create-order idempotency](https://developers.tremendous.com/reference/create-order)
- [Tremendous link delivery](https://developers.tremendous.com/docs/link-delivery)
- [Tremendous official reward-link host guidance](https://help.tremendous.com/hc/en-us/articles/41472340067603-Is-Tremendous-legit)
- [Tremendous webhook verification](https://developers.tremendous.com/docs/webhooks-1)
- [Node.js HMAC and cryptographic randomness](https://nodejs.org/api/crypto.html)
- [MDN Set-Cookie security attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final)
