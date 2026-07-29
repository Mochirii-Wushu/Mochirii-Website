# Authentication Provider Rollout Decision

Date: 2026-07-29

Status: `DEFERRED_BY_OWNER`. This is an internal plan, not provider approval or
public copy. No provider, Auth, secret, callback, schema, or UI change is
authorized by this document.

## Current authority

- Supabase Auth remains the Website session authority.
- Fresh server-side guild entitlement remains mandatory after authentication.
- The first-party Website-to-Social OAuth flow is not a general social-login
  provider and remains governed by its existing exact-client contract.
- Authentication proves identity only. It never grants guild membership,
  moderation, raffle eligibility, or data access by itself.

## Current provider decisions

| Lane | Decision | Production condition |
| --- | --- | --- |
| Facebook Login | Planned only; no app/configuration/source/public UI work now. | Separate current-policy, privacy, public-copy, provider, exact-head, identity-migration, and rollback approval. |
| Spotify Login | Deferred; development mode is not a general guild rollout. | Current provider eligibility must support the actual audience before any production work. |
| Instagram Login | Skipped as a guild identity provider. | Reconsider only if an official consumer-safe login flow fits the product without a shared/professional guild account. |
| Twilio phone login | `DEFERRED_COST_GATE`; hidden and disabled. | Hard zero-cost non-trial production must be proven; current per-verification/channel pricing does not pass. |

Manual identity linking remains disabled unless a separate change proves
recent reauthentication, conflict handling, auditability, recovery, unlinking,
and member-data continuity. Supabase documents manual linking as a distinct
beta configuration, so it must not be inferred from adding a login button.

Any future OTP path must set `shouldCreateUser=false` (or the equivalent) for
login-only behavior, use CAPTCHA and rate limits, and remain unavailable when
configuration is missing. Dormant code is not activation authorization.

## Required release sequence

1. Re-read current official provider eligibility and pricing.
2. Capture only variable names, callback origins, scopes, and provider state;
   never secret values.
3. Prove identity collision/linking behavior against disposable fixtures.
4. Add server-side guild entitlement checks and cross-account RLS negatives.
5. Obtain exact public-copy/privacy/legal and provider mutation approval.
6. Run exact-head Preview, provider test-mode, recovery, and rollback evidence.
7. Activate one provider at a time behind a fail-closed switch.

## References

- [Supabase Social Login](https://supabase.com/docs/guides/auth/social-login)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)

