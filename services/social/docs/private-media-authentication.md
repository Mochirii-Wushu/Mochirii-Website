# Private Media Authentication

Mōchirīī Social serves member media only through the same-origin
`/media/private/...` gateway. Resource ownership, relationships, blocks, story
expiry, and group membership remain the authorization source of truth. The
controls in this document are additional authentication and abuse boundaries;
they never broaden that resource policy.

## Two-Factor Assurance

Members without two-factor authentication enabled continue to use their
current browser session or reviewed first-party OAuth bearer token. When a
member has enabled two-factor authentication, private media requires a fresh
checkpoint bound to the currently configured factor.

- Browser requests use the authenticated server-side session. A successful checkpoint
  records an exact factor fingerprint and verification time; a stale checkpoint
  or a changed factor redirects ordinary browser navigation back to the
  checkpoint and keeps private media opaque.
- Native clients call `POST /api/v1.1/security/private-media-assurance` with the
  current OAuth bearer token and a TOTP or unused recovery code. The response
  returns a short-lived encrypted assertion and the exact
  `X-Mochirii-Media-Assurance` request-header name.
- The native assertion is bound to the member, exact bearer token, current
  factor, issue time, and expiry. It cannot be used with another access token,
  after factor rotation, or after expiry. The OAuth token is still validated on
  every request.
- TOTP values are accepted once within the bounded replay window. Recovery
  codes are consumed transactionally and remain one-time credentials.

The default assurance lifetime is twelve hours and is clamped between five
minutes and twelve hours. The assertion is an authentication secret: clients
must keep it out of URLs, analytics, crash reports, and logs, retain it only as
long as needed, and discard it on sign-out or OAuth-token replacement.

## Request Limits

Laravel's named request limiters enforce separate hashed identity and client-IP
ceilings. Private media permits 240 requests per minute per identity and 360
per minute per IP. Checkpoints permit 5 per minute and 15 per hour per identity,
plus 10 per minute and 30 per hour per IP. Every `429` is empty and no-store.
Authentication and current-member checks run before these limiters, so an
anonymous caller does not gain an account-enumeration signal.

The current-member check has its own cheaper boundary before any remote HTTP
request: six refreshes per minute per identity and thirty per minute per client
address. A Redis atomic lock permits one refresh in flight for a member,
waiters recheck the success cache after acquiring that lock, and a five-second
negative result prevents a failed or slow burst from becoming serial remote
requests. Lock timeout, cache failure, limiter failure, and a rejected remote
check all fail closed.

These controls use the application's configured distributed limiter store in
production. Do not replace it with process-local memory on a multi-process
runtime. Rate-limit keys contain only keyed hashes, not raw member IDs,
addresses, bearer tokens, or factor values.

Caddy trusts forwarded client-address headers only when the direct peer is in
Cloudflare's published IPv4 or IPv6 ranges, parses those headers in strict
right-to-left order, and overwrites the upstream `X-Forwarded-For` value with
its sanitized `{client_ip}`. Laravel trusts only that direct Caddy hop because
the application port is bound to `127.0.0.1`. Permanent release gates validate
that Caddy's loaded JSON configuration exactly matches the validated on-disk
Caddyfile, the loopback binding, Redis as both the default and limiter cache,
and two distinct sanitized example client addresses observed by Laravel. A
changed Cloudflare range requires a reviewed Caddy source update and the
rollback-safe Caddy installer; it must never be fetched dynamically during a
request.

## Release And Readback

Source validation must cover browser, native, changed-factor, wrong-token,
expired, replayed, recovery-code, identity-limit, IP-limit, anonymous, and
relationship-policy cases. A production release remains separately gated and
must read back:

1. the exact merged image digest and immutable provenance;
2. the production limiter store and trusted-proxy client-address behavior;
3. browser checkpoint completion followed by authorized media access;
4. native checkpoint completion followed by the same media access;
5. opaque denial for missing, expired, tampered, or wrong-token assertions;
6. unchanged anonymous object/CDN denial and ActivityPub-disabled state.

Do not retain codes, assertions, bearer tokens, signed object URLs, media paths,
member identifiers, or response bodies in release evidence.

## Standards References

- [Laravel 12 request rate limiting](https://laravel.com/docs/12.x/routing#rate-limiting)
- [Laravel 12 atomic cache locks](https://laravel.com/docs/12.x/cache#atomic-locks)
- [Laravel 12 Passport bearer authentication](https://laravel.com/docs/12.x/passport#protecting-routes)
- [Caddy trusted proxy and client-IP options](https://caddyserver.com/docs/caddyfile/options#trusted-proxies)
- [Cloudflare published IP ranges](https://www.cloudflare.com/ips/)
- [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [NIST SP 800-63B session management and reauthentication](https://pages.nist.gov/800-63-4/sp800-63b/session/)
