# Instagram Login Decision

Date: 2026-07-29

Decision: `SKIPPED_FOR_GUILD_IDENTITY`.

Instagram profile links and approved publishing are separate product lanes and
must not be treated as authentication. Mochirii will not use a shared guild
account, a member's professional-account permissions, imported content, or a
publishing token to establish Website identity or guild entitlement.

Current Instagram platform flows are designed around Instagram API use cases
and permissions, including professional-account capabilities. They do not
justify adding Instagram as a general member sign-in method. No app, secret,
callback, Supabase provider setting, public sign-in button, or identity mapping
is authorized.

Reconsideration requires a current official consumer-safe authentication flow,
individual-member account support, minimal scopes, no shared/professional
account dependency, privacy/legal approval, identity collision/recovery tests,
server-side guild verification, and a separate exact provider/release packet.

## References

- [Meta Instagram Platform](https://developers.facebook.com/docs/instagram-platform/)
- [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)
- [Supabase supported social-login providers](https://supabase.com/docs/guides/auth/social-login)
