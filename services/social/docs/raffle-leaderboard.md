# Private raffle leaderboard

Mōchirīī Social renders `/guild/raffle` only for a signed-in Social account that
has a current OIDC mapping and passes the existing private-member boundary. The
page reads a sanitized current-cycle leaderboard from the canonical raffle
service; it never stores raffle standings in the Social database and never
makes a cross-origin request from a member's browser.

## Host configuration

The following values are host-only and must remain blank in committed example
files:

```dotenv
MOCHIRII_RAFFLE_LEADERBOARD_URL=
MOCHIRII_RAFFLE_LEADERBOARD_SECRET=
MOCHIRII_RAFFLE_LEADERBOARD_TIMEOUT=5
```

The secret must be independently generated for this read-only route, contain at
least 32 bytes, and must not be reused by Social account sync. Missing or invalid
configuration fails closed with an opaque response.

The endpoint is pinned in source to the current hosted function origin and the
exact `/functions/v1/get-current-raffle` path. Alternate hosts, ports, userinfo,
queries, fragments, redirects, and path variants are rejected before the
request is signed.

## Signed request contract

Social sends a JSON `POST` body containing only the mapped OIDC subject:

```json
{"sub":"00000000-0000-4000-8000-000000000000"}
```

For each request it creates a current Unix timestamp and a random 16-byte nonce.
The HMAC input is the following exact UTF-8 string, using LF separators and no
trailing LF:

```text
v1
{lowercase-sub}
{unix-timestamp}
{32-character-lowercase-hex-nonce}
```

The request carries only these authentication headers:

- `x-mochirii-raffle-timestamp`: base-10 Unix seconds.
- `x-mochirii-raffle-nonce`: 32 lowercase hexadecimal characters.
- `x-mochirii-raffle-signature`: `v1=` followed by the lowercase HMAC-SHA256 hex digest.

The reader must enforce a maximum 60-second clock skew, reject replayed nonces,
compare signatures in constant time, and revalidate current member access for
the subject before reading any raffle row.

## Response contract

Only a `200 application/json` response no larger than 64 KiB is accepted. The
response must have exactly these fields:

```json
{
  "cycleLabel": "July 2026",
  "asOf": "2026-07-28T00:00:00Z",
  "entries": [
    {"rank": 1, "displayName": "Guild Member", "entryCount": 10}
  ]
}
```

The Social service rejects extra fields, malformed Unicode, control characters,
more than 250 rows, counts outside 1 through 10, or inconsistent dense ranks.
It never logs response bodies, member names, OIDC subjects, nonces, signatures,
or secrets.

## Release boundary

Source may be reviewed and tested with blank configuration. Activating the page
requires separate approval for the canonical reader, a host secret, an immutable
Social image, and the in-place production rollout. Do not create a new host or
weaken the private Social middleware, frame protections, or ActivityPub controls.
