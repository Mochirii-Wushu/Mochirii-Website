# Discord Gallery Ingest HMAC Activation

Status: source-only candidate. Nothing in this document authorizes a provider
write, migration apply, Edge Function deployment, Discord call, or production
gallery submission.

## Boundary

`reaper-discord-interactions` is the only intended signer and
`submit-discord-gallery-image` is the only intended verifier. The verifier
remains `verify_jwt = false` because this is a signed service-to-service
webhook-style request, so its handler must authenticate every request itself.

The `v1` request signs:

1. protocol version;
2. non-secret key ID;
3. `POST` method;
4. exact `/functions/v1/submit-discord-gallery-image` path;
5. Unix timestamp in seconds;
6. 128-bit random nonce; and
7. SHA-256 of the exact raw JSON bytes sent on the wire.

The signature is HMAC-SHA256. Timestamps may differ from the receiver clock by
at most 60 seconds. The receiver verifies the signature before parsing JSON,
then atomically consumes `(key_id, nonce)` through the service-role-only
`consume_discord_gallery_ingest_nonce` RPC. The raw request body is limited to
16 KiB. Unknown keys, malformed signatures, stale timestamps, replays, missing
storage, and database errors fail closed before attachment retrieval.

## Secret and rotation contract

- `DISCORD_GALLERY_INGEST_HMAC_KEYS_JSON` is a bounded JSON object containing
  one to three key IDs mapped to independent secrets of at least 32 bytes.
- `DISCORD_GALLERY_INGEST_HMAC_ACTIVE_KEY_ID` selects the one key used by the
  signer. The verifier accepts any valid key in the bounded set.
- Key IDs are operational labels, not secrets. Secret values must exist only in
  the approved provider secret store and private recovery boundary.
- Never print, hash, log, commit, place in a pull request, or pass a secret in a
  shell command that can be retained in history.
- New code never accepts the former static-secret header. The old secret may be
  retained unused only for an explicitly approved rollback window, then
  removed separately.

Rotation is additive: provision a new independent key in the receiver set,
confirm both functions read the bounded set, switch the active key ID, wait
beyond the maximum request window, then remove the retired key. Never replace
the only accepted key and active key in separate uncoordinated writes.

## Release gates

1. Rebase this candidate onto the final protected `main` and recalculate the
   migration and function inventory.
2. Require a non-skipped Supabase Preview for the nonce migration and both
   unchanged function identities.
3. Require the Deno authentication suite, pgTAP source review, repository
   checks, Edge type checks, audits, and exact-head checks.
4. Obtain exact approval for the migration, both new secret names, the normal
   protected-main integration deployment, and the resulting full function
   redeployment. Do not deploy manually.
5. In an isolated preview, send one correctly signed but deliberately invalid
   metadata fixture. The first request should reach metadata validation without
   downloading an attachment; an exact replay must fail authentication. Never
   use a real member, attachment, or production Discord interaction for this
   check.
6. After production release, use the same non-submitting authentication probe,
   confirm normal Discord PING handling remains healthy, and monitor only
   redacted outcome counts. Do not log headers or request bodies.

## Rollback

If authentication or normal interaction acceptance regresses, redeploy the
reviewed prior source through the protected workflow. The nonce table and RPC
may remain inert while rollback is evaluated; do not rewrite migration history
or delete nonce evidence. Restoring the prior secret contract, if necessary,
requires separate exact secret approval. After rollback, verify Discord PING,
function inventory/JWT parity, and that no attachment request or gallery row
was created by the canary.
