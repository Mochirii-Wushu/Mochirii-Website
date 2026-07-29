# Spotify Login Eligibility Packet

Date: 2026-07-29

Decision: `DEFERRED_PROVIDER_ELIGIBILITY`.

## Current finding

Spotify development mode is not suitable for a general guild login rollout.
Current documentation limits development-mode users and requires the app owner
to meet account conditions; wider access requires extended quota eligibility.
Spotify's current extended-quota criteria include an established organization,
an active launched service, a large minimum active-user audience, market
availability, commercial viability, and policy compliance. Mochirii must not
claim production eligibility without a fresh provider decision.

The July 2026 development-mode quota update changes client-ID/quota mechanics,
not the requirement to prove that the intended audience is supported.

## Allowed work before eligibility

- No provider app, secret, callback, Auth setting, public button, or member
  token storage.
- A later provider-free spike may test protocol/identity behavior only with
  synthetic fixtures and no public route.
- If eligibility becomes credible, request a new packet covering minimum
  scopes, exact redirects, account linking, privacy/data deletion, 429 handling,
  provider review, rollout cohort, recovery, and rollback.

## Stop conditions

Stop if production requires a shared personal account, a paid subscription,
an unsupported audience, unapproved data access, or an eligibility statement
that cannot be proven from current provider documentation/readback.

## References

- [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify February 2026 development-mode migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify July 2026 quota update](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates)
