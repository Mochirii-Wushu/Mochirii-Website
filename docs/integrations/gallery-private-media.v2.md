# Gallery private-media v2 design contract

This document describes an additive, source-only contract. It does not register
routes, change the current approved-feed consumer, alter storage, or authorize a
provider operation.

## Frozen status

- Lifecycle: `DORMANT_SOURCE_ONLY`
- Activation: `false`
- Runtime routes registered: `false`
- Runtime mutation included: `false`
- Provider mutation authorized: `false`
- Public mutation included: `false`
- v1 compatibility: `PRESERVE_UNCHANGED`

The machine-readable authority is
[`gallery-private-media.v2.contract.json`](gallery-private-media.v2.contract.json).
The checker rejects contract drift and any runtime source that registers or
consumes the v2 route family while this status remains dormant.

## List boundary

`POST /api/gallery/private-media/v2/list` accepts only `cursor` and `pageSize`.
Its item DTO is exactly:

- `publicItemId`
- `thumbnailUrl`
- `thumbnailWidth`
- `thumbnailHeight`
- `caption`
- `category`
- `publishedAt`

The DTO contains no original/full/media capability, signed provider URL,
storage path, bucket, provider path, raw database identifier, uploader
identifier, or profile identifier. The thumbnail is a sanitized, re-encoded,
same-origin relative resource. A provider redirect is forbidden. The thumbnail
must decode within a 720-pixel edge and 518,400 pixels, then re-encode within
the same edge/pixel limits and 80 KiB with non-pixel metadata removed.

`publicItemId` is a server-generated public alias with the `gpm2i.` prefix and
22-43 base64url characters without padding. It is stable across pages but must
not equal or embed a database, submission, user, storage, or provider
identifier.

The default and maximum page size are 24. The cursor has the `gpm2c.` wire
prefix, is opaque, versioned, authenticated, snapshot-bound, filter-bound,
forward-only, confidential through authenticated encryption, and expires after
900 seconds. Clients do not decode it. Its safe payload inventory is limited to
the version, snapshot publication-sequence ceiling, public published-time and
public-alias position, filter digest, and expiry. Database, submission, user,
storage, provider, and capability material is forbidden.

The first page atomically captures the committed high-water mark of a
server-assigned, global, strictly increasing publication sequence. Creating or
changing any list-visible version, including insert, publish, unpublish,
republish, published-time, public alias, filter membership, or visibility,
atomically assigns the next immutable sequence. Every continuation evaluates
versioned rows with
`visibleFromPublicationSequence <= snapshotPublicationSequence` and either no
end sequence or `visibleUntilPublicationSequence > snapshotPublicationSequence`.
Later same-timestamp inserts, null-timestamp inserts, and visibility mutations
therefore cannot enter the captured snapshot.

Within that snapshot, ordering is fixed to `publishedAt DESC NULLS LAST`, then
the non-null unique `publicItemId DESC` tie-breaker. A non-null continuation
accepts a lower published time, the same time with a lower public alias, or the
null-time cohort. A null-time continuation accepts only a lower public alias
within that cohort. Both public sort values travel in the confidential cursor;
clients never construct continuation predicates.

The list request body is capped at 1,024 bytes and three seconds. The response
is capped at 262,144 bytes and four seconds. Its server-side rate limit is an
atomic, fail-closed 30 requests per 60 seconds for a privacy-preserving request
subject. That subject is a 32-byte, server-keyed, window-bound digest with key
rotation and a 120-second maximum retention. Raw IP, account, or cookie values
are not persisted, and browser fingerprinting is forbidden.

## Intent boundary

`POST /api/gallery/private-media/v2/intent` accepts exactly `publicItemId` and
the literal intent `OPEN_MEDIA`. Before issuance, the server must parse a
bounded body, require the exact fields, validate the public item identifier and
intent, resolve the currently approved revision, and atomically enforce the
intent rate limit. Only then may it issue one capability.

The response contains exactly `version`, `publicItemId`, `capabilityUrl`, and
`expiresAt`. `capabilityUrl` is a non-redirecting same-origin relative resource
under `/api/gallery/private-media/v2/content/`; absolute, provider, `data:`,
`javascript:`, and `file:` destinations are invalid. It is single-use and bound
to the validated item, intent, and current revision. Its lifetime is 15-60
seconds, with a 45-second default.

The capability serves only a sanitized re-encode with non-pixel metadata
removed. It never serves the uploaded encoded original. Delivery accepts only
a bodyless `GET`, returns status 200 with exact media type `image/webp`, and
sets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and
`Referrer-Policy: no-referrer`. A 50 MiB absolute response ceiling,
five-second first byte, and 30-second total timeout are hard safety limits; they
are not a claim that viewer derivative dimensions, decoded pixels, or quality
have been approved. Those output bounds stay activation-blocking and
unresolved. The intent request body is capped at 512 bytes and three seconds;
its JSON response is capped at 2,048 bytes and four seconds. Its atomic
fail-closed rate limit is 12 requests per 60 seconds using the same bounded
server-keyed subject derivation as the list route.

Capability tokens, paths, and full URLs are redacted before any log, error,
trace, or diagnostic emission. None of those channels may contain capability
material, including on failure.

## Failure and privacy boundary

The JSON error envelope contains only `code` and `message`, using the fixed code
set in the machine-readable contract. Provider messages, request/provider
identifiers, causes, stacks, filesystem paths, storage paths, provider
identifiers, capability tokens/paths/URLs or examples, secret material, and
private identifier examples are not permitted.

## Decision gates

- Attribution: `UNRESOLVED` and activation-blocking
- Retention: `UNRESOLVED` and activation-blocking
- Account deletion: `UNRESOLVED` and activation-blocking
- Viewer derivative bounds: `UNRESOLVED` and activation-blocking

The v2 list therefore carries no uploader attribution. This contract makes no
claim that media is anonymized, retained for a particular duration, or deleted
with an account. Each decision needs an approved product/privacy policy,
implementation, cleanup behavior, tests, and provider evidence before
activation.

## Cost gate

- Current packet cost mutation: `false`
- Future activation cost classification: `COST_UNKNOWN`
- Current quota and billing preflight: required and activation-blocking

This source-only packet creates no runtime, egress, compute, or storage cost
mutation. It does not prove future implementation cost-neutral. Current quota,
billing, egress, compute, and storage evidence is required before activation.

## Compatibility

The current v1 approved-feed route and consumer remain unchanged. v2 is not an
automatic fallback and no consumer may opt in until a separately reviewed
activation change completes the gates in the operations runbook. Rollback
before activation is removal of these dormant design files only; there is no
runtime or data rollback in this packet.
