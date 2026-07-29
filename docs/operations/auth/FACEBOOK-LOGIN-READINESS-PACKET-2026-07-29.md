# Facebook Login Readiness Packet

Date: 2026-07-29

Decision: `PLANNED_NOT_AUTHORIZED`.

## Boundary

Facebook may authenticate an identity in a future separately approved release.
It may not establish guild entitlement, link accounts silently, import social
content, store provider access tokens for unrelated use, or expose provider
branding outside the approved login context and required legal disclosures.

No Meta app, use case, callback, permission, secret, Supabase provider setting,
public button, or privacy-policy change is created or authorized here.

## Readiness gates

- A current Meta account/business and app-eligibility readback.
- Exact Production and Preview callback allowlists; no wildcard or local URL in
  production.
- Minimum scopes only (`public_profile` and verified email when still required
  by the current supported flow); any broader scope needs its own review.
- Provider secret only in Supabase Auth's protected provider configuration.
- Disposable identity collision, pre-account-takeover, unlink/recovery, account
  deletion, revoked-provider, replay, and wrong-origin tests.
- Fresh Website guild verification after sign-in and deny-by-default RLS.
- Exact visible copy, privacy disclosures, data deletion instructions, app
  review evidence, rollback, and owner authorization.

## Stop conditions

Stop if Meta requires unapproved business verification, public copy, data use,
review material, shared credentials, cost, or permissions; if email ownership
is not verified; or if identity continuity cannot be proven without mutation.

## References

- [Supabase Login with Facebook](https://supabase.com/docs/guides/auth/social-login/auth-facebook)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
