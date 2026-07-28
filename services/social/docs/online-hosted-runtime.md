# Online-Hosted Runtime

Mochirii Social serves production traffic from DigitalOcean and does not use a
local workstation as a server, runner, scheduler, tunnel, database, or media
store.

## Hosted Ownership

- GitHub is the protected source, CI, private GHCR, and manual release control
  plane. Workflows use GitHub-hosted runners only.
- The single DigitalOcean Droplet runs Caddy, Docker, Pixelfed, MariaDB, Redis,
  Horizon, and the Laravel scheduler.
- DigitalOcean Spaces remains the primary media store. Backup storage is a
  separate operational boundary.
- Cloudflare remains the public DNS and proxy edge for
  `https://social.mochirii.com`.
- Supabase remains the hosted identity and account-sync authority. The
  Pixelfed host never receives a Supabase service-role key.

GitHub is a delivery dependency, not a serving dependency. An already deployed
release must continue serving if GitHub or the operator workstation is offline.

## Production Filesystem

```text
/opt/mochirii-social/
  current -> releases/<commit>
  releases/<commit>/
    docker-compose.production.yml
    release.env
    release.meta
  shared/
    pixelfed.env
    private-media-cutover/
      maintenance.proof
      cutover.state
    restore-recovery/
      restore.state
  data/
    mariadb/
    redis/
    storage/
  backups/
```

The production Compose file accepts only an immutable GHCR digest, contains no
build directives, binds the application to `127.0.0.1:8080`, and uses absolute
data paths. Caddy is the only public path to the app.

Process liveness and dependency readiness are deliberately separate. The
public `/api/service/health-check` confirms only that the application process
can answer. The dependency probe is callable only from the application
container loopback and must be run exactly as:

```sh
docker exec pixelfed-app curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/api/service/readiness-check
```

It returns `READY` only after bounded MariaDB and Redis probes succeed. The
same path through `https://social.mochirii.com` must always return opaque
`404`; it is not a public monitoring endpoint.

## Deployment Contract

The `Deploy Mochirii Social production` workflow requires:

- a full commit already merged into `main`;
- the exact digest published for that commit;
- the typed confirmation `DEPLOY social.mochirii.com`;
- `NONE` when no migration is expected, or `MIGRATIONS APPROVED` after a
  reviewed online backup;
- one reviewed deployment mode: the one-time
  `STAGE_PRIVATE_MEDIA_GATEWAY_UNDER_MAINTENANCE` bootstrap described below,
  the exact-operation
  `FINALIZE_PRIVATE_MEDIA_GATEWAY_AFTER_VERIFIED_CUTOVER` mode, or the
  permanent `ANONYMOUS DENIAL AND CUTOVER VERIFIED` gate only after a
  same-window readback proves that anonymous direct-object and CDN requests are
  denied, private media remains enabled, and an authorized application media
  request still succeeds.
- a canonical lowercase UUIDv4 dispatch ID. Private-media staging and
  finalization enforce durable operation-ID uniqueness: the same ID may recover
  an interrupted `intent`, but a recovered attempt must stop and a fresh
  dispatch must use a new ID. Ordinary deployments use the value only for
  request correlation and do not claim durable replay prevention.

The permanent private-media gate is required for every ordinary runtime
publication. Do not select it from historical documentation or assumed
provider state. Capture the public-safe pass/fail evidence outside Git without
retaining object keys, signed URLs, member identifiers, credentials, or
response bodies.

The staging mode exists only to break the initial gateway/cutover dependency;
it is not a second ordinary deployment path. It accepts only migration approval
`NONE`, requires a root-owned mode-`0600` proof for a separately installed
external maintenance boundary, and requires GET and HEAD readbacks with no
redirect, cookie, or cacheable response. Application routes must return a
bounded no-store `503`; installer and direct raw-media/avatar paths must return
an empty no-store `404`. It rejects any active or completed cutover state.

Before its first durable runtime mutation, staging atomically persists one
root-owned mode-`0600` `cutover.state` under a root-owned mode-`0700` directory.
The fixed v2 record binds the operation ID, candidate commit/digest, previous
commit/digest, exact Horizon/scheduler/Laravel states, maintenance-proof hash,
installed runtime-contract hash, and migration-tree hash. The candidate and
currently running immutable images must both have exactly the reviewed
migration tree, and the candidate must report no pending migration.

The runtime then pauses and gracefully terminates Horizon, enters Laravel
maintenance, stops Horizon and the scheduler with a bounded 90-second grace
period, starts only the candidate application image, and verifies the
private-media authorization route and effective private storage default. It
leaves `current` unchanged, atomically moves `intent` to `staged`, and keeps
both workers stopped. A failed first attempt tries every rollback action. It
restores the captured Laravel and worker states, proves the exact prior image
and local runtime policy/health, and keeps the separately installed public
maintenance and raw-storage denial boundary in place. Only the later approved
provider packet may remove that external boundary. A complete rollback then
removes the recovered intent; an incomplete rollback retains durable
`recovery_required` state and blocks deploy, backup, restore, and ordinary
verification.

After a separately authorized, manifest-scoped provider cutover has passed,
the finalization mode may act only on the exact operation, commit, digest,
runtime contract, and migration tree in `staged`. It atomically enters
`finalizing`, lifts Laravel maintenance, and proves application policy plus the
public gateway and raw-storage denial matrix while both writers remain stopped.
Only then does it resume the captured workers, run full production acceptance,
atomically move `current`, and enter `completed`. Its dedicated preflight
accepts the exact closed stage, a policy-proven live `finalizing` candidate, or
a fully accepted exact `completed` replay. `current` may be either the prior or
candidate release while `finalizing`, making crash recovery idempotent. A
failure that proves Laravel down and both workers stopped retains retryable
`finalizing`; only an unprovable closure becomes `recovery_required`.
`completed` permanently rejects the one-time staging mode. Backups, restores,
and ordinary hosted verification accept only absent or completed cutover state.
A restore separately persists an fsynced `restore.state` before replacing the
database; `intent` or `recovery_required` blocks backup, deploy, runtime update,
and online verification until the same bound recovery payload succeeds.

The workflow verifies the GHCR commit tag resolves to the supplied digest,
verifies its GitHub Actions provenance and SPDX SBOM attestations against the
exact `main` commit and signer workflow, then sends a two-file no-secret release
bundle over strict-host-key SSH. The
deploy account is restricted to one forced command, has no Docker group access,
cannot request a shell or forwarding, and can run only the root-owned deploy
wrapper. The wrapper also requires the bundled Compose file to match the
root-owned template accepted during bootstrap, so possession of the deploy key
cannot introduce a new privileged mount or service definition.

The accepted provenance is produced only after the image passes the workflow's
disposable MariaDB/Redis migration-and-worker check. Host staging also runs a
network-disabled image contract, compares the candidate migration tree with
both reviewed source metadata and the currently running immutable image, and
performs only a read-only pending-migration query. Staging never applies a
migration.

The image workflow does not install or attest `/etc/caddy/Caddyfile`. A Caddy
boundary change is a separate host packet: capture the active and reviewed
SHA-256 values, create a root-owned backup, validate a candidate, atomically
replace the target, reload rather than restart Caddy, and prove rollback. Never
assume an image publication activated new Caddy matchers.

Image-only failures restore the prior release, `current` link, application, and
workers. A release that attempts a database migration never rewrites historical
bootstrap identity or pretends to roll back schema: `current` remains at the
prior release while Laravel and both writers stay closed for an explicitly
approved forward fix or tested restore.

The root-owned deploy wrapper requires both an origin-loopback success and a
public HTTPS success through Cloudflare before returning. The GitHub runner then
checks the public edge independently. A normal 2xx/3xx passes. A 403 passes only
after the authoritative hosted public check has passed; known Cloudflare
challenge and block headers are reported when present. Transport failures and
all other unexpected statuses remain fail-closed without weakening the zone's
security posture for hosted runners.

The manual `Verify Mochirii online hosting` workflow uses the same restricted
deploy identity with the separate typed confirmation
`VERIFY social.mochirii.com`. Its forced command cannot deploy, open a shell,
allocate a PTY, or forward traffic. It runs the live container, Horizon,
scheduler, policy, and origin gates, then writes, reads, and immediately deletes
one random temporary object through Pixelfed's existing Spaces credentials.
The GitHub-hosted runner independently checks the website, social edge,
Supabase Auth boundary, unsigned Reaper and member-access rejection, and the
public Discord API. This workflow is the no-workstation independence proof; it
does not send Discord messages or mutate commands, accounts, or provider
settings.

## Authorization And Revocation Boundary

First-party Social authorization permits only a pre-registered OAuth
authorization-code client with S256 PKCE and an exact callback. Implicit grants,
out-of-band redirects, public client self-registration, personal access tokens,
and interactive token-management surfaces remain unavailable. The Website
binds consent to the exact server-only `MOCHIRII_SOCIAL_OAUTH_CLIENT_ID`; a
missing or mismatched value fails closed before consent.

Local account suspension, deletion state, and current resource audience are
checked on every request. A successful external membership decision may be
cached for no more than 300 seconds to bound provider load; a denial is never
converted into a positive cache entry. This does not mean the external
provider is called on every request. Lower-latency external revocation requires
a separately reviewed authenticated invalidation hook that evicts only the
affected member decision; do not shorten or bypass the current boundary by
adding polling, broad cache flushes, or a new paid service.

## Bootstrap And Rollback

Initial bootstrap is a maintenance operation:

The procedure below is non-executable while the production activation blocker
in the next section remains open. Source review or CI preview is not approval to
install or run it.

1. Install the restricted deployment runtime with a dedicated public key.
2. Confirm the installer stored the reviewed production Compose template under
   `/opt/mochirii-social/shared`.
3. Run `migrate-production-runtime.sh` as root with the merged commit and exact
   image digest.
4. The script creates a transactional database backup, stops the legacy stack,
   copies data with numeric ownership preserved, starts the online layout, and
   runs runtime gates.
5. If bootstrap fails, it stops the new layout and restarts the untouched
   legacy data paths.

Keep the legacy checkout read-only for 72 hours after deployment, upload,
restore, and reboot acceptance. Do not delete it merely because the first page
load succeeds.

### Production activation blocker: uncatchable process or host loss

This source preview closes the runtime on catchable nonzero exit, `HUP`, `INT`,
and `TERM`, and durable intent/recovery records block the next managed
operation. It does not yet install a boot or container-prestart visibility
guard. A `SIGKILL`, host power loss, or Docker restart after `php artisan up`
but before final durable acceptance can therefore restart an unaccepted
application image publicly. Caddy continues to deny the reviewed raw private
media roots, but that is not proof that the entire application is closed.

This is a P2 production-runtime activation blocker. Do not install the runtime
updater or dispatch staging, finalization, an ordinary deployment, or a
production restore from this source until a separately reviewed boot visibility
guard is active, or the release owner gives exact written acceptance of this
risk. Source review and CI preview do not accept or remove the blocker.

### One-time private-media gateway staging

The repository source cannot update its own root-owned forced-command runtime.
Before the first staging dispatch, a **separately approved, rollback-safe host
prerequisite packet** must run
`scripts/install-production-deploy-runtime-update.sh` from the exact clean
merged checkout and full commit. A source PR, CI run, or preview never runs this
host updater. The updater takes the same deployment lock plus a unique UUIDv4
operation ID, rejects active cutover or restore recovery, validates every shell
file, and writes a root-owned fsynced update intent before mutation. Its
root-owned backup is byte-verified before any recovery write. It atomically
installs the library, deploy, backup, and restore runtimes, writes a
deterministic contract binding those four files and the forced entrypoint to
their exact paths, then installs the entrypoint last. Completed and recovered
IDs cannot be replayed; interrupted recovery accepts only the exact original ID
and then requires a fresh dispatch. It restarts or reloads nothing.
The recorded installer commit is evidence; unrelated application commits do
not require another host write when the deterministic contract digest is
unchanged.

The external maintenance packet must then install a root-owned regular file at
`/opt/mochirii-social/shared/private-media-cutover/maintenance.proof`, mode
`0600`, with exactly:

```text
version=1
state=stage-authorized
hostname=social.mochirii.com
expected_status=503
```

The file alone is not proof of maintenance: the host verifies GET and HEAD for
`/`, `/login`, the OAuth start, API health, private gateway, and a random path
as bounded no-store `503` responses with no redirect or cookie. Installer and
the exact roots and descendants of `/storage/m`, `/storage/_esm.t3`,
`/storage/g`, `/storage/g1`, `/storage/avatars`, and
`/storage/cache/avatars` must be empty `private, no-store` `404` responses. The
reviewed Caddy source is installed only by a separate rollback-safe host packet
with backup, allowlisted diff, `caddy validate`, atomic replacement, reload, and
GET/HEAD readback. The GitHub runner independently checks
the bounded root response.
Creating or removing the external maintenance boundary, capturing the final
object manifest, changing manifest-listed ACLs, targeted CDN purging, clearing
application caches, authenticated/anonymous verification, and reopening all
remain a separately approved provider packet. The staging workflow performs
none of those provider operations and never resumes Horizon or the scheduler.

Encrypted recovery objects are capped at 513 MiB before upload or download.
Recovery resolves exactly one remote object and validates its byte count,
checks the downloaded ciphertext against that count, and streams successful
decryption through a 512 MiB plus one-byte capture. Encrypted recovery archives
use manifest format 2. They bind database and
configuration hashes, release metadata, independently validated historical
cutover state/proof when present, and the current exact five-file deployment
runtime. The decrypted transport is capped at exactly 512 MiB: the compressed
database member is capped at 480 MiB, configuration at 16 MiB, and the manifest
at 4 KiB, leaving more than 12 MiB for archive framing. Backup creation, the
GitHub isolated-restore gate, the restricted SSH entrypoint, and host restore
all enforce this same contract. Restore performs bounded regular-member
extraction into a private staging directory and validates every format-2
binding; raw `tar` inspection or extraction is not an acceptance path. It does
not silently install host configuration. A future fresh-host recovery path
must explicitly install the validated runtime and durable state from that
bundle before database restore; this source does not provide or authorize that
fresh-host activation path.

Recipient encryption protects confidentiality and detects ciphertext
tampering, but it does not prove which producer created an archive. A writer
that knows the public recipient can create a decryptable replacement. Treat
private object IAM, exact object/size selection, schema validation, and workflow
evidence as operational controls only; authenticated production recovery still
requires a signed or MACed manifest, or an immutable archive digest supplied by
an independently trusted approval record.

These archives cover the database and reviewed host/runtime configuration, not
the primary private member-media objects in Spaces. Full recovery therefore
also requires a separately approved independent object backup and a successful
object restore/readback exercise. Database/configuration restore evidence alone
must not be used to claim member-media recoverability.

New backups always use the exact ten-line format-2 manifest. Historical backups
that successfully decrypt from the protected private object boundary remain
accepted only with their exact four-line format-1 schema during the transition.
The same bounded parser handles both. For legacy
payloads it computes database and configuration SHA-256 values locally into a
root-private normalized companion manifest, which binds crash recovery and
replay. Mixed, reordered, duplicate, or extra fields fail closed. Format 1
predates archived runtime/cutover bindings, so the already installed verified
five-file runtime remains authoritative and archived host settings remain
read-only evidence.

## Secret Boundary

Never print or commit `.env`, database credentials, Spaces keys, OAuth keys,
the GHCR pull token, SSH private keys, signed URLs, or recovery material.
Production secrets live only in protected provider settings or root-owned host
files. Workflow evidence may include commit IDs, image digests, service health,
and whether required values are present.

The private-GHCR pull credential remains only in the approved `mochirii`
account's mode-`600` Docker configuration. The root-owned deploy wrapper asks
that account to pull the exact digest and does not duplicate the token into the
root or deploy-account homes.
