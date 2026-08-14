# Mōchirīī Forums account handoff

This is the no-secret source and activation contract for the Website-owned
Mōchirīī Forums account producer. The Website remains the identity and member
eligibility authority. The Forums host remains the consumer.

## Source boundary

- Browser entry: `https://mochirii.com/forums/connect`
- Server endpoint: `POST https://mochirii.com/api/forums/discourse-connect`
- Exact consumer callback: `https://forums.mochirii.com/session/sso_login`
- Existing eligibility authority: `verify-member-access`
- Server-only activation flag: `MOCHIRII_FORUMS_DISCOURSE_CONNECT_ENABLED`
- Server-only shared secret: `MOCHIRII_FORUMS_DISCOURSE_CONNECT_SECRET`

The shared secret must be 32 random bytes encoded as exactly 64 lowercase hex
characters. The Website and Forums runtime stores receive the same value through
their protected secret boundaries. It must never enter Git, a browser bundle,
an URL, a log, a build artifact, or operator evidence.

## Producer contract

The endpoint stays unavailable unless the activation flag is exactly `true`
and the secret satisfies the exact format above. It accepts only a same-origin
JSON `POST` from the canonical Website origin and only the two opaque `sso` and
`sig` fields.

Processing is fail-closed and ordered:

1. Bound the request and encoded payload sizes.
2. Compare HMAC-SHA256 over the exact encoded payload in constant time.
3. Only after the HMAC succeeds, Base64-decode and parse the query payload.
4. Require one 32-character nonce and the exact Forums callback; reject every
   extra, duplicate, alternate-origin, alternate-path, query, fragment, port,
   or user-info value.
5. Verify the bearer with Supabase Auth, require a confirmed email, then invoke
   the existing member-access authority with a current Discord refresh.
6. Require both member status fields to be `active`, `discordVerified=true`,
   an exact UUID match, and a safe current display name. Manual gallery approval
   never grants Forums access.
7. Use the lowercase Supabase UUID as immutable `external_id`. Derive the
   20-character ASCII username from a domain-separated SHA-256 digest of that
   UUID and pass the current display name separately.
8. Set administrator and moderator fields to `false`, sign the response, and
   return only the exact callback for browser navigation.

All responses are private and no-store. The route writes no request, payload,
nonce, email, member identifier, signature, redirect, or secret to application
logs. Public errors use only Mōchirīī product language.

The query-bearing browser entry also has an explicit private, no-store,
no-referrer, and noindex response contract. On first render it copies only the
already-signed opaque `sso` and `sig` pair into per-tab `sessionStorage` and
immediately replaces the address bar with `/forums/connect`. A signed-out
member then visits only `/auth?redirect=%2Fforums%2Fconnect`; neither the auth
URL nor the OAuth return URL carries the signed pair. The connection page reads
the pair from the same tab after sign-in and deletes it after a successful
handoff or a terminal invalid/denied result. Browser-storage or URL-scrubbing
failure is fail-closed. This browser resume state is not a producer replay or
expiry store; the consumer controls nonce validity as described below.

## Nonce expiry and replay boundary

At the reviewed consumer revision
`cbf996f65aae3da1843224aa624bcd9a225931ac`, the consumer creates a
cryptographically random nonce, binds it to the initiating browser session for
30 minutes, rejects unknown, stale, cross-session, or reused nonces with HTTP
419 before identity lookup, and expires a nonce immediately before the first
identity lookup. It retains the used-nonce marker for 24 hours. That consumer
check is the authoritative expiry and replay control in the officially
supported protocol.

The standard producer request contains no issuance timestamp or independently
verifiable consumer-session state. The Website therefore does not invent a
second nonce store, database, timestamp, or plugin contract and does not claim
to reject a first-seen stale nonce. The signed browser flow always returns to
the consumer, which applies its authoritative session, expiry, and one-time-use
checks before any account lookup.

The source fixture at
`apps/web/lib/forums/fixtures/discourse-connect-consumer-cbf996f.json` pins the
reviewed source hashes and stale/replay contract. The online verifier fetches
only that exact revision and confirms the source hashes and validation order:

    npm run verify:forums-discourse-connect-consumer

## Activation and rollback

This source preparation does not set either runtime value, change Vercel or
Supabase, deploy, or enable the Forums consumer.

Activation order:

1. Put one generated secret into the two protected runtime stores without
   printing it.
2. Keep the Website flag disabled until the pinned source fixture passes and a
   disposable consumer at that exact revision proves stale and reused nonce
   rejection with HTTP 419 before login.
3. Enable both sides only for the final end-to-end signed flow.
4. Verify signed-out denial, valid-member success, inactive and unverified
   denial, exact callback navigation, consumer nonce expiry, and consumer replay
   rejection.

Rollback is to disable the Website flag and the Forums consumer, leaving the
existing Website authentication and member-access authority unchanged.

## Official sources reviewed

- [DiscourseConnect setup and signing protocol](https://meta.discourse.org/t/setup-discourseconnect-official-single-sign-on-for-discourse-sso/13045)
- [Supabase `getUser` authorization guidance](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
