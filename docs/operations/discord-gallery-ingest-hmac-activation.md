# Discord Gallery Ingest HMAC Activation

Status: source-only candidate. No deployment is authorized by this document.
Nothing here authorizes a migration apply, secret write, Edge Function change,
Discord call, member submission, media fetch, provider mutation, or release.

## Ownership and versioned interfaces

The terminal signer belongs only to `Mochirii-Wushu/Reaper-Discord-Bot`.
Website owns only the `submit-discord-gallery-image` verifier, private nonce
ledger, resumable ingest reservation, Gallery RLS, migrations, and moderation
CAS. Website must not contain an active-key selector, signer, legacy
shared-secret fallback, or second Reaper writer.

The Website consumer copy of
`docs/integrations/discord-gallery-ingest-hmac.v1.json` is exactly 2,227 UTF-8
bytes with final LF and SHA-256
`af3025221626aadd2d0fc82fd79bb02b3f253ccdd8753fb78082aa885c929e3f`.
It must remain byte-identical to Reaper's producer contract. The earlier Reaper
trees `5b3c24140f723a5d5ef2ad9a8e125108b0bd2097`,
`c8d93ecd961346756419604ee079d6a615645a13`, and the later `cf237` candidate
were revoked during review and are not release references. The independently
reviewed source-only replacement is Reaper base/HEAD
`88d06147159ba3b9ea8d62fee08e50187c394a5b` with staged tree
`6547fb8e06e792e59d810ab97de9609f3e0ccbf6`; its HMAC contract blob is
`28144a28fa540ed6d93cd5d103c566049c9589d3` and its authorization-context
contract blob is `f7a9c927001931423af8beef57113d66f2257a63`. Those local source identities
are compatibility evidence, not deployment or activation evidence.

The HMAC v1 canonical string joins these fields with LF: protocol version,
non-secret key ID, uppercase method, runtime-normalized WHATWG pathname, Unix
timestamp, 16-byte lowercase-hex nonce, and lowercase SHA-256 of the exact
bounded request-body bytes. The signature is lowercase HMAC-SHA256 prefixed by
`v1=`. The body limit is 16 KiB, the clock skew is at most 60 seconds, and the
body-read deadline is five seconds.

The verifier hashes the exact collected bytes before fatal UTF-8 decoding. It
does not normalize CRLF, whitespace, Unicode, or a UTF-8 BOM. Invalid UTF-8 and
literal U+FEFF anywhere in the decoded JSON body (leading BOM or embedded) are
rejected only after a valid signature and one-use nonce consumption. Parsed
string fields also reject a semantically equivalent JSON `\uFEFF` escape. The
producer must reject U+FEFF before signing. The nonce security ledger is the
sole permitted pre-context mutation.

The signed pathname is the Edge runtime's normalized WHATWG
`Request.url.pathname`, not the raw HTTP request target. The verifier requires
the exact canonical Supabase HTTPS origin and function pathname, empty query,
fragment, credentials, and non-default port. It cannot recover a pre-gateway
dot-segment or percent-encoding spelling. Raw-target normalization therefore
remains a private activation-manifest and provider-readback limitation; this
source does not claim raw-target binding.

The checked-in receiver is strict HMAC-only and intentionally inactive. It has
no legacy dual-accept bridge. Without the complete HMAC configuration it fails
closed before JSON parsing, profile lookup, external media fetch, or storage.

The HMAC-bound body also carries the version and digest from
`docs/integrations/discord-gallery-authorization-context.v1.json`. That
consumer fixture is exactly 8,451 UTF-8 bytes with final LF and SHA-256
`db5ab92c20df4e59957979750e2ba6d3484f6112eb0ad87787bdf1d5be8d237c`.
Website independently recomputes the context from canonical positive-uint64
guild, gallery-channel, and exactly two unique ASCII-sorted required-role IDs,
with role matching fixed to `all`. It rejects a missing, malformed, or
mismatched context before profile lookup, external media fetch, storage, or
application-row mutation.

The context digest detects one-sided configuration drift. It cannot detect a
matching guild, channel, role-set, or role-match change made to both runtimes.
Coordinated changes remain governed by a reviewed private activation manifest
and exact provider readback. Neither contract, diagnostics, nor source may
contain real private provider IDs, secrets, key material, or member IDs.

## Bounded attachment and reservation boundary

After HMAC verification, nonce consumption, duplicate-safe JSON parsing,
authorization-context comparison, exact payload-shape checks, and current
member-eligibility checks pass, the source candidate:

- permits only exact HTTPS Discord CDN attachment hosts and attachment paths,
  with no credentials, fragments, non-default ports, or body URL/channel/
  attachment identity mismatch;
- follows at most three redirects manually and revalidates every destination;
- applies one 15-second deadline to redirects, headers, and the streamed body;
- enforces an 8 MiB declared and streamed byte ceiling, rejects a lying
  `Content-Length`, and requires canonical declared, response, structural, and
  decoded MIME to agree;
- structurally validates complete JPEG, PNG, or static WebP containers before
  full pixel decode; and
- acquires one private database reservation whose current lease token is also
  the UUID in a generated `<member>/discord-ingest/<lease>.<ext>` path, upserts
  only the validated bytes for that lease generation, confirms exact Storage
  object ID, version, size, MIME, validator version, and SHA-256, then
  transactionally finalizes the application row.

JPEG and PNG keep a 4,096-pixel edge and 12.6-million-pixel limit, subject to
feature-detected `createImageBitmap` full decode. WebP uses the existing
digest-pinned official libwebp 1.6.0 module because the hosted Deno
2.1-compatible runtime does not provide the later WebP `createImageBitmap`
capability. That immutable validator proves source WebP only through a
720-pixel edge. Larger WebP is unsupported rather than classified as corrupt.
A uniform 4,096-pixel WebP policy requires a separate decoder rebuild,
provenance review, and source approval.

An upload or finalization interruption does not delete or reassign the object.
An expired-lease takeover atomically rotates the reservation to a fresh path
before the successor uploads. A predecessor Storage request that completes
late can therefore write only its expired generation path and cannot overwrite
the successor's ready object. One or more private generation objects can
persist after a successful retry and require a future reviewed retention
cleanup; this packet does not claim that every failure stores nothing. The
Storage schema dependency is explicit: activation must read back compatible
`storage.objects.id uuid`, `version text`, and `user_metadata jsonb` fields
before applying the migration.

The nonce and reservation tables remain in `private`, force RLS, and grant no
direct API-role table access; the migration preserves the established
authenticated/service-role `private` schema usage needed by existing Gallery
RLS helpers. It creates no new public table, so the newer explicit public Data
API exposure default is not invoked. The verifier does not depend on anonymous
OpenAPI access or nested Edge Function calls.

Authenticated members retain current pending Website-upload edits. They cannot
insert, overwrite, delete, or edit service-owned Discord reservation objects
or HMAC-bound Discord submission metadata. Moderation rechecks the digest,
ready reservation, and exact Storage object identity/version before its atomic
status transition.

## Release blockers outside this candidate

This receiver full-decodes source pixels but stores the original encoded bytes.
It does not strip JPEG EXIF/APP segments or allowed PNG ancillary metadata and
does not provide a sanitized publication derivative. Public activation and
Gallery release remain blocked until a separately reviewed re-encode/
sanitization pipeline is defined and tested.

There is no atomic per-member/window business rate limit for distinct eligible
attachments. A reviewed database-backed concurrency-safe limit, or a
separately approved provider control, is required before release.

The current public feed v1, uploader attribution, signed-original delivery,
arbitrary public item URL trust, publication retention/anonymization, and
account-deletion policy remain separate product/privacy decisions. Current
visible attribution and Gallery wording are unchanged. No publication ledger
or uploader-name freeze is included here.

## Private activation manifest

Before any activation, create a separately reviewed private manifest that
binds:

1. the exact Website source revision, all three migration revisions, both Edge
   Function revisions, and the two contract hashes above;
2. the exact independently reviewed Reaper replacement signer revision;
3. matching receiver/signer key IDs without recording secret values;
4. matching canonical guild, channel, required-role, authorization-context,
   payload bounds, and MIME behavior;
5. the canonical Supabase project origin, function settings, Storage schema
   capability, gateway normalization behavior, and deployment exclusions;
6. the tiny synthetic hosted JPEG/PNG/WebP decoder capability probes, without
   member or media content; and
7. a count-only inventory of legacy Discord submissions, including whether any
   pending row lacks a reservation and validated source digest; and
8. fail-closed rollback/forward-fix revisions, operator channel, and observation
   window.

The checked moderation path deliberately rejects a legacy Discord row without
the new digest/reservation evidence. Activation therefore also requires a
separately reviewed disposition for any such pending row; this source packet
does not backfill, inspect, or publish production member or media data.

Provider readback must prove these values match. Git, CI output, issue/PR text,
and public evidence may contain only booleans and counts, never real provider
identifiers, secrets, signed URLs, member data, or media.

## Separately approved cutover choices

The simpler strong cutover accepts a brief fail-closed ingest and moderation
pause. The exact approved packet must order secret provisioning, strict
Website verifier and checked-moderation deployment, the nonce/reservation/RLS
migrations, Reaper signer activation, and readback so no weaker producer is
accepted and no caller observes an unguarded old moderation RPC. Then prove
one-use nonce behavior, reservation recovery, single-writer ownership, fixed
redacted diagnostics, and the synthetic decoder probes.

A zero-downtime alternative requires a separately designed and reviewed,
time-bounded transition mode. It must never downgrade a request carrying
partial or invalid HMAC headers, must have an enforced expiry, and must remove
the weaker path after provider readback. No bounded transition mode exists in
this candidate.

Both choices are blocked until the user approves the exact migration, secret,
Website function, Reaper runtime, provider-readback, release-gate, and rollback
packet. No deployment is authorized.

## Failure and rollback

The safe default on activation failure is to disable the terminal signer and
leave ingest fail closed while a reviewed forward fix is prepared. Do not
delete nonce or reservation evidence, rewrite migration history, or remove a
possibly shared object. After the RLS/CAS migration, the old moderation Edge
Function is not a valid rollback because its unchecked RPC grant is revoked.
Restoring a weaker legacy receiver or moderation path requires a separate
explicit security decision and compatible migration plan.

This source packet addresses responsive card geometry plus strict receiver,
transport/decode, resumable-storage, and Discord-original mutation defects. It
does not claim Gallery completeness, production readiness, provider
verification, migration execution, or release approval.
