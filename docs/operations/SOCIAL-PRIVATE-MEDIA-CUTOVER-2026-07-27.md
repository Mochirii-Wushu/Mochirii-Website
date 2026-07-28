# Mochirii Social Private Media Cutover

Date: 2026-07-27
Status: source foundation prepared; provider conversion and production rollout are blocked pending exact approval

## Decision and scope

Mochirii Social member media must not be reachable through an anonymous object
URL or a direct local-storage path. Static application assets, including the
default avatar, may remain public. No provider write described here has been
performed.

The separately applied installer-only Caddy block changed no media route,
object ACL, Spaces/CDN state, or application image and satisfies none of this
private-media cutover's preconditions.

The reviewed source foundation does the following:

- writes future member posts, avatars, stories, group images, and group videos
  with private visibility;
- returns only same-origin gateway URLs from member-facing model and API
  contracts;
- authenticates browser media requests with the existing encrypted server
  session and native clients with a Passport bearer token;
- revalidates local suspension/deletion state and the resource audience on
  every request, including blocks, following-only posts, direct-message
  participants, story expiry, and private-group membership; a successful
  external guild-membership decision may be cached for no more than 300
  seconds and therefore is not a promise of an external provider call on every
  request;
- redirects cloud objects only to HTTPS, allowlisted, very-short-lived signed
  URLs and streams local files with byte-range support;
- denies direct member-storage paths at Caddy and sends `private, no-store`,
  `nosniff`, and no-referrer response controls;
- keeps raw object paths and storage URLs out of serialized models.

The source change does **not** make existing objects private. Production must
remain closed during the cutover until every existing object and every cache
surface passes the anonymous-denial checks below.

The reviewed delivery source also provides one narrowly bounded bootstrap mode
that can stage the gateway while an external maintenance boundary is already
proven active. It does not change an ACL, CDN entry, database, secret, or
provider setting. The host-installed forced entrypoint, runtime, and library
must first be aligned atomically from the exact clean merged commit under a
separately approved host packet; merging this source does not update those
root-owned files.

## Exact object boundary

The conversion inventory is limited to existing member-generated objects under
these logical key prefixes:

- `public/m/`
- `public/_esm.t3/`
- `public/avatars/`
- `public/cache/avatars/`
- `cache/avatars/`
- `public/g/`
- `public/g1/`

The reviewed default-avatar JPG and PNG are excluded and may remain public.
No other prefix may be changed from this packet. Before execution, the operator
must replace this logical list with an immutable, per-object manifest captured
from the current bucket. The manifest records the exact key, byte count,
checksum or ETag semantics, current ACL, last-modified time, and whether a CDN
copy exists. It belongs only in the ignored operations evidence boundary and
must contain no credential, signed URL, member caption, or account token.

## Preconditions

Stop before any write unless all of the following are true:

1. One accountable operator with MFA has exact approval for the reviewed image
   digest, runtime visibility setting if required, object ACL manifest, and any
   affected CDN cache purge.
2. The exact prior immutable Social image digest, service state, health state,
   member-object manifest, current ACLs, bucket-listing setting, and CDN state
   have been captured.
3. The current encrypted backup has been restored in an isolated validation
   environment and matched to the captured object inventory without exposing
   member data. Recipient-only `age` encryption is not producer authentication,
   so production recovery also requires a separately trusted signed/MACed
   manifest or immutable archive digest. The database/configuration archive
   does not back up private Spaces media; an independent object backup and
   restore/readback must pass before the cutover.
4. Registration and ActivityPub remain disabled and the hostname is placed in
   an approved maintenance boundary that does not present the private-media
   claim while anonymous object access is still possible.
   The root-owned maintenance proof and a live no-store `503` must both pass;
   the proof file by itself is insufficient.
5. The reviewed image supports both browser-session and native bearer media
   requests, and no migration or secret change is included.
6. The bucket's listing policy is private. An anonymous list request must be
   denied before and after the conversion.

## Approved-order change packet

Each step is fail-closed. Record only counts, hashes, status, and redacted route
categories; never retain object signatures or authentication headers.

**P2 production-runtime activation blocker:** the reviewed scripts close on
catchable nonzero exit, `HUP`, `INT`, and `TERM`, but this source-only preview
does not install a boot or container-prestart visibility guard. `SIGKILL`, host
power loss, or Docker restart after `php artisan up` and before final durable
acceptance can restart an unaccepted application image publicly. Caddy still
denies the reviewed raw private-media roots, but that does not close the full
application. Do not install the runtime updater or dispatch staging,
finalization, ordinary deployment, or production restore until a separately
reviewed boot visibility guard is active or the release owner gives exact
written risk acceptance.

1. Under a separate rollback-safe host prerequisite packet, align only the
   root-owned deployment library, deploy/backup/restore runtimes, runtime byte
   contract, and forced entrypoint from the exact clean merged commit using the
   reviewed atomic updater and a unique UUIDv4 operation ID. Its durable update
   state, canonical root-owned backup, exact five-path contract, preimage
   verification, entrypoint-last install, fsync transitions, and consumed-ID
   rules must pass; restart or reload nothing. A source PR or preview must not
   run it. Install the reviewed Caddy raw-storage denial only through its own
   rollback-safe host packet: capture and checksum the active file, validate an
   allowlisted diff, run `caddy validate`, atomically install and reload, then
   prove every exact storage root and descendant with GET and HEAD before
   staging.
2. Prove the external maintenance boundary, dispatch
   `STAGE_PRIVATE_MEDIA_GATEWAY_UNDER_MAINTENANCE` with migration approval
   `NONE`, and require exact commit/digest provenance plus SPDX SBOM
   attestations. The runtime captures the prior image and worker states, places
   Laravel in maintenance, stops Horizon and the scheduler, starts only the
   candidate application, proves its private-media gateway contract, and
   atomically transitions one root-owned v2 state record from `intent` to
   `staged`. The record binds the operation ID, both immutable image identities,
   captured worker/Laravel states, maintenance proof, runtime byte contract,
   and migration tree. The candidate and currently running image must expose
   the exact same reviewed migration-tree hash before staging may continue. A
   staging failure verifies restoration of the exact
   prior digest and captured states; incomplete recovery retains
   `recovery_required` and blocks automation.
3. With all writers still quiesced, re-read the bucket into a second immutable
   manifest and require an exact match with the approved key allowlist. Stop on
   any new, missing, or out-of-prefix key.
4. Verify the staged exact reviewed immutable GHCR digest while the maintenance
   boundary remains closed. Do not change the database, OAuth clients, Droplet
   size, DNS, Cloudflare rules, or secrets.
5. Verify the source image starts healthy and that one controlled browser
   session and one reviewed native bearer token can read an allowlisted test
   image and a byte range from a test video through `/media/private/...`.
6. Confirm the effective cloud-disk default is private. If production
   explicitly overrides it as public, stop unless the same exact approval also
   names the change to `AWS_VISIBILITY=private`.
7. Change only the manifest-listed member objects to private ACLs. DigitalOcean
   documents private ACLs and S3-compatible signed URLs; use its current
   official API or an approved pinned S3-compatible client. Do not use a bucket
   wildcard, make the bucket public, or change the excluded static objects.
8. If a Spaces CDN is enabled, purge only the affected reviewed member-object
   URLs/prefixes using the approved cache-purge target. Private origin ACLs do
   not prove that an earlier public CDN response is gone. Stop if targeted
   invalidation and anonymous denial cannot be demonstrated.
9. Clear the application caches that can contain prior serialized avatar,
   status, story, or group URLs. Do not flush unrelated databases or alter
   persistent member records.
10. From an anonymous client, require denial for:
   - GET and HEAD to one object in every converted prefix at the Spaces origin;
   - the same GET and HEAD through every configured CDN/custom endpoint;
   - direct local `/storage/m`, `/storage/_esm.t3`, `/storage/g`,
     `/storage/g1`, `/storage/avatars`, and `/storage/cache/avatars` roots and
     member descendants;
   - bucket-root and list-objects requests.
11. From authenticated clients, require successful browser-session and native
   bearer reads for an avatar, public/unlisted post, permitted private post,
   direct-message attachment, active follower story, and permitted group
   media. Require opaque 404 responses for signed-out, suspended, blocked,
   non-follower, non-participant, expired-story, private-group nonmember,
   draft, archived, deleted-parent, orphan, unsafe-path, and remote-media cases.
12. Scan rendered HTML, JSON, accessibility text, console output, logs, and
    network requests. No raw storage key, object endpoint, CDN media hostname,
    signed query, or upstream platform branding may appear before a gateway
    authorization decision. Application diagnostics must not contain bearer
    tokens, cookies, signed URLs, or object keys.
13. Re-read the exact object inventory. Every converted member object must be
    private, every excluded static object must retain its approved state, the
    bucket must remain non-listable, and the byte/checksum inventory must be
    unchanged.
14. Remove the external maintenance boundary only after all checks pass while
    leaving Laravel maintenance active, then dispatch
    `FINALIZE_PRIVATE_MEDIA_GATEWAY_AFTER_VERIFIED_CUTOVER` for the exact staged operation,
    commit, digest, runtime contract, and migration tree. The runtime resumes
    only the captured workers, runs full production acceptance, moves the
    current release, and atomically transitions `finalizing` to `completed`.
    The finalization preflight accepts the exact closed stage, a publicly
    policy-proven live `finalizing` candidate, or a fully accepted exact
    `completed` replay. The current link may be either the prior or candidate
    release across a crash boundary. Public gateway and raw-storage denials are
    proven before either writer resumes. Only then may the live copy present the
    proven behavior. A safely closed failure retains retryable `finalizing`;
    an unprovable closure becomes `recovery_required`.

## Backup and restore continuity

Encrypted backups use recovery manifest format 2. They bind the database and
configuration hashes, release identity, independently validated historical
cutover state/proof when present, and the current exact five-file deployment
runtime contract. A later legitimate runtime update does not rewrite the
historical bootstrap contract recorded in `cutover.state`.

Restore accepts only bounded regular archive members and validates every hash
in a private staging directory. Encrypted objects are capped at 513 MiB before
upload or download; exact remote object count and size, downloaded ciphertext
size, and a 512 MiB plus one-byte streaming decryption bound are all checked.
One end-to-end plaintext transport contract applies at backup creation,
isolated GitHub validation, restricted SSH input, and host restore: 512 MiB
total, including at most 480 MiB for `database.sql.gz`, 16 MiB
for `configuration.tar.gz`, and 4 KiB for the manifest. The remaining archive
framing margin exceeds 12 MiB. Every consumer uses the same bounded
regular-member parser and exact format-2 manifest validation; raw `tar`
inspection or extraction is not accepted. Restore does not automatically
install archived host configuration. Before destructive database replacement
it atomically writes root-owned `restore.state`; `intent` and
`recovery_required` block backup, deploy, deploy-runtime update, and online
verification after a managed/catchable process failure. Without the separately
required boot visibility guard they do not by themselves prevent Docker from
restarting an app after uncatchable host loss. The same bound payload may resume
recovery. Only full application, worker, exact-image, private-gateway, and
raw-storage acceptance changes the restore phase to `completed`.

All new recovery points use the exact ten-line format-2 manifest. Existing
format-1 points that successfully decrypt from the protected private object
boundary remain recoverable only through their exact four-line schema. They
receive the same archive/path/size validation, and their
database and configuration hashes are computed into a root-private normalized
manifest before durable restore state is written. Mixed, extra, duplicate, or
reordered schemas are rejected. Format 1 contains no archived deploy-runtime or
cutover binding, so recovery retains the currently installed verified
five-file runtime as authority and never applies archived host configuration.

## Rollback

The preferred rollback keeps objects private and restores a compatible prior
gateway image. If no compatible image exists, keep the hostname in maintenance
and correct the gateway; do not reopen with broken or anonymous member media.

Restoring public ACLs is an emergency compatibility rollback only. It requires
a separate exact approval, the captured per-object ACL manifest, a targeted CDN
purge, and removal of the public privacy claim before the hostname is reopened.
Never use a broad bucket-public operation. After any rollback, repeat the
inventory, health, anonymous, authenticated, cache, and leakage checks.

## Stop conditions

Stop without reopening for any source/digest mismatch, incomplete inventory,
unverified backup, object-byte drift, unknown ACL, public bucket listing,
anonymous object or CDN success, signed URL longer than the configured maximum,
raw URL/path leakage, audience bypass, invalid native authorization, unhealthy
container, registration opening, federation exposure, or unrelated provider
diff.

## Performance and native-client notes

- Very short signed redirects protect cloud objects but reduce shared CDN cache
  usefulness. Optimize generated image sizes and use the gateway only for
  member media; do not lengthen signatures to recover cache hit rate.
- Local video delivery uses the framework's binary response with Range and
  If-Range support. Cloud video range behavior must be verified through the
  signed object response during cutover.
- The iOS client must attach its Passport bearer token to the same-origin
  gateway request. It may follow the resulting short-lived signed redirect,
  but must not persist, log, share, or place that URL in analytics or browser
  storage.
- HLS manifests are not returned because relative segment URLs would bypass a
  per-object authorization decision. Video currently uses the authorized
  original/optimized object with byte ranges until a segment-aware gateway is
  reviewed.

## Primary references

- [DigitalOcean Spaces file permissions](https://docs.digitalocean.com/products/spaces/how-to/set-file-permissions/)
- [DigitalOcean Spaces access management](https://docs.digitalocean.com/products/spaces/how-to/manage-access/)
- [DigitalOcean Spaces listing permissions](https://docs.digitalocean.com/products/spaces/how-to/set-file-listing-permissions/)
- [DigitalOcean Spaces CDN endpoints](https://docs.digitalocean.com/products/spaces/how-to/customize-cdn-endpoint/)
- [Laravel Passport SPA and bearer authentication](https://laravel.com/docs/12.x/passport)
- [Laravel authentication](https://laravel.com/docs/12.x/authentication)
- [Laravel filesystem temporary URLs](https://laravel.com/docs/12.x/filesystem#temporary-urls)
- [Caddy request matchers](https://caddyserver.com/docs/caddyfile/matchers)
