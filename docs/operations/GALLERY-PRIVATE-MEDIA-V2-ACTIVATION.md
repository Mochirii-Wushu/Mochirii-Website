# Gallery private-media v2 activation gate

## Current packet

- Activation state: `false`
- Provider mutation authorized: `false`
- Runtime/API implementation included: `false`
- Migration included: `false`
- Public copy change included: `false`
- Current packet runtime cost mutation: `false`
- Future activation cost classification: `COST_UNKNOWN`

This packet owns only the additive design contract, its static checker, hostile
checker tests, and these directly related documents. The current v1 approved
feed remains the runtime contract. No Preview, production, storage, database,
browser, or provider result is claimed.

## Source gate

Run with the repository-pinned Node/npm toolchain:

```sh
npm run check:gallery-private-media-v2-contract
npm run test:gallery-private-media-v2-contract
npm run check
git diff --check
```

The focused checker must prove that the contract is dormant, the v1 owner is
preserved, and no application or Edge Function source registers or consumes
the v2 route family. The hostile suite must reject list capability disclosure,
incomplete publication-sequence snapshots, cursor/order/null-cohort/page-bound
changes, arbitrary URL destinations, capability method/media/header/redaction
drift, route activation, raw diagnostics, sensitive examples, and unsupported
decision claims.

## Required activation successor

Activation needs a separate branch, security review, and explicit approval.
That successor must provide all of the following without weakening this
contract:

1. Implement exact bounded request parsing, DTO construction, cursor signing,
   confidential safe-field cursor encoding, opaque public aliases, and atomic
   fail-closed list/intent rate limits. Implement the global strictly monotonic
   publication-sequence history atomically with every list-visible change;
   capture one committed high-water ceiling and enforce its versioned-visibility
   predicate plus the exact public sort/null continuation on every page. Prove
   later same-time, null-time, and visibility changes cannot enter that
   snapshot. Prove rate subjects are keyed and window-bound without raw IP,
   account, cookie, or fingerprint persistence.
2. Generate thumbnails and viewer media through a decoded, metadata-stripping
   re-encode. Approve and test viewer input/output dimension, decoded-pixel,
   byte, format, and quality bounds. Prove the uploaded encoded original is
   never public or returned by either endpoint.
3. Register same-origin routes without provider redirects and verify that the
   original/media request occurs only after the exact `OPEN_MEDIA` intent. The
   content route must accept only bodyless `GET`, emit `image/webp` with exact
   `no-store`, `nosniff`, and `no-referrer` headers, and redact capability
   tokens, paths, and URLs before logs, errors, traces, or diagnostics.
4. Preserve v1 until the v2 consumer, rollback path, and compatibility window
   are independently reviewed. Do not silently fall back from v2 failures to a
   capability-disclosing response.
5. Resolve attribution with approved public copy and privacy review, or keep
   attribution absent.
6. Resolve retention and account-deletion behavior with data ownership,
   moderation/audit exceptions, cleanup ordering, retry/failure semantics, and
   rollback or forward-fix evidence.
7. Add unit, integration, hostile, route, response-size, timeout, pagination,
   accessibility/device, and no-pre-intent-request coverage.
8. Complete clean-checkout CI, reviewed Preview, provider readback, production
   deployment approval, live verification, and rollback rehearsal.
9. Complete a current quota and billing preflight for egress, compute, and
   storage. Future activation remains `COST_UNKNOWN` until that evidence is
   reviewed; do not relabel it cost-neutral from this source packet.

## Stop states

Stop before activation if any decision gate is unresolved, the sanitizer or
atomic rate limiter is unproven, a DTO can expose an original/provider
capability or private identifier, the cursor can duplicate/skip items, a URL
can leave the same-origin route family, content method/media/privacy headers
drift, capability material or raw diagnostics can cross any observability or
public boundary, or v1 rollback is not exact. Source-only green evidence does
not authorize any provider or production action.
