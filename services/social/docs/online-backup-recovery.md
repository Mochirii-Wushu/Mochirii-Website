# Online Backup And Recovery

Mochirii Social backups run on the production Droplet through systemd. They do
not require a Windows task, local Docker container, tunnel, or workstation.

## Backup Contract

At 03:15 UTC, `/usr/local/sbin/mochirii-social-backup nightly`:

1. creates a transactional MariaDB dump with routines, events, triggers, and
   binary data;
2. packages the root-owned runtime, Caddy, SSH, release, and backup settings;
3. restores the dump into an isolated, network-disabled MariaDB container and
   compares critical table counts;
4. encrypts the validated recovery payload to the dedicated public recipient;
5. signs a bounded producer manifest over the encrypted archive identity,
   length, SHA-256, release commit, and immutable image digest with a dedicated
   Ed25519 producer key;
6. uploads the ciphertext, manifest, and detached OpenSSH signature privately
   to the regional backup Space with a dedicated key; and
7. retains 14 daily, 8 weekly, and 6 monthly recovery-point bundles.

The encrypted object is capped at 513 MiB and the decrypted format-2 archive
has one end-to-end 512 MiB transport ceiling. Recovery checks the exact remote
object count and byte size before download, verifies the downloaded ciphertext
against that metadata, and streams decryption through a 512 MiB plus one-byte
capture so neither ciphertext nor successfully decrypted plaintext can grow runner disk
use without bound.
`database.sql.gz` is limited to 480 MiB, `configuration.tar.gz` to 16 MiB, and
the manifest to 4 KiB, leaving more than 12 MiB for archive framing. Backup
creation, isolated GitHub validation, the restricted SSH entrypoint, and host
restore all use the same bounded regular-member extractor and exact manifest
hash checks. Raw `tar` listing or extraction is not a validation path.

All newly created backups use exact ten-line manifest format 2. During the
runtime transition, the parser retains exact format-1 compatibility for a
historical recovery point that also has separately approved, valid producer
authentication. Unsigned historical objects are not accepted by the automated
workflow. Format 1 uses an exact four-line legacy schema and the same
three-member archive parser and size limits; database and configuration hashes
are computed locally into a private normalized companion manifest and bind
durable restore replay state. Mixed, reordered, duplicate, or extra fields are
rejected. Because format 1 predates archived deployment-runtime and cutover
bindings, the currently installed verified runtime contract remains
authoritative; archived host configuration is still never installed silently.

Manual pre-deploy and pre-restore points use a separate eight-bundle retention
class. Pruning validates every exact object name before deleting it. The
versioned bucket lifecycle remains the provider-side second boundary.

The Droplet stores only the encryption recipient. The matching identity belongs
in a `social-recovery` environment secret and in one offline copy inside the
approved credentials boundary. Backup, media, and temporary administrative
Spaces keys remain separate.

The recipient file is a non-symlink regular file owned `root:root` with mode
`0600` or `0644`. Backup creation fails closed on ownership, group/other-write
mode, or link drift so an untrusted local user cannot redirect future recovery
encryption.

`age` provides recipient confidentiality and authenticated-ciphertext integrity;
producer authentication is separate. New source signs a strict eight-line
manifest with OpenSSH `ssh-keygen -Y sign` in the
`mochirii-social-backup` namespace. Recovery verifies that detached signature
against one protected allowlisted Ed25519 public key before decryption, then
checks the exact object basename, ciphertext size and SHA-256, public-key hash,
release commit, and image digest. A modified archive, manifest, signature,
object selection, or producer key fails closed. This source capability is not
live evidence: production remains sender-unauthenticated until a separately
approved host packet installs the root-owned private key, the protected GitHub
environment receives the matching public key, and a real upload plus isolated
validation readback succeeds.

The current recovery archive contains the database and reviewed host/runtime
configuration. It neither backs up nor independently reads back the primary
private member-media objects stored in Spaces. A separately approved,
independent object-media backup plus restore/readback exercise is required
before claiming full Social recovery or activating the private-media cutover.

## Pinned Recovery Tools

Both the Droplet backup installer and the GitHub-hosted recovery workflow use
`scripts/install-pinned-recovery-tools.sh`. It installs only checksum-verified
release artifacts for these approved versions:

| Tool | Version | Purpose |
| --- | --- | --- |
| `age` and `age-keygen` | `1.3.1` | Encrypt and decrypt recovery payloads |
| `rclone` | `1.74.4` | Transfer private recovery objects |

The installer supports Linux AMD64 and ARM64, requires HTTPS for the initial
request and every redirect, verifies an architecture-specific SHA-256 before
extracting, and checks the reported version before installation. The production
backup also refuses to run if either installed version drifts from this contract.
This removes Ubuntu package-repository timing from the backup and recovery path.
The approved Ubuntu host must already provide `curl`, `install`, `mktemp`,
`sha256sum`, `tar`, `uname`, and `unzip`; the installer stops with the missing
prerequisite name before downloading anything.

Repository validation runs syntax checks and ShellCheck, then installs and
exercises the pinned binaries on native AMD64 and ARM64 Ubuntu 24.04 runners.
Each runner verifies the exact versions, completes an `age` encrypt/decrypt
round trip with a byte-identical payload, and exercises `rclone` `copyto`, `lsf`,
and `deletefile` against its no-network local backend. The
[`ubuntu-24.04-arm` runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
uses GitHub-hosted native ARM64 hardware. A fail-closed preflight binds each
matrix entry to GitHub's `runner.arch` value and the host's `uname -m` result, so
the required `validate-social` result fails closed on an unexpected or
unavailable architecture and blocks Social image publication. The workflow does
not silently fall back to emulation, another architecture, or a bypass. This CI
coverage validates the source and release artifacts; it does not install tools
on the live Droplet. The live host remains unchanged until a separately approved
installation packet and post-install version readback are completed.

To update a pin, review the upstream release and its security notes. For `age`,
verify the [official release](https://github.com/FiloSottile/age/releases) checksum
through its Sigsum or GitHub artifact attestation. For `rclone`, follow the
[release-signing procedure](https://rclone.org/release_signing/) and verify the
signed checksum file with release key fingerprint
`FBF737ECE9F8AB18604BD2AC93935E02FF3B54FA`. Update both architecture hashes,
the expected versions, this runbook, and the static contract together; then test
installation and an encrypt/decrypt round trip on Ubuntu 24.04 before any
separately approved host installation or recovery dispatch.

## Host Settings

`/opt/mochirii-social/shared/backup.env` is root-owned mode `600` and contains:

```text
BACKUP_S3_ACCESS_KEY_ID=<dedicated backup key id>
BACKUP_S3_SECRET_ACCESS_KEY=<dedicated backup key secret>
BACKUP_S3_BUCKET=mochirii-social-backups
BACKUP_S3_ENDPOINT=https://sfo3.digitaloceanspaces.com
BACKUP_S3_REGION=sfo3
```

Never commit, print, copy into a release bundle, or place this file in a user
home directory. Activate the timer only after a manual encrypted upload and
isolated restore pass:

`/opt/mochirii-social/shared/backup-producer-signing-key` is a separate
root-owned mode-`0600` unencrypted Ed25519 private key used only by the
non-interactive backup service. It is never included in the recovery archive.
Generate and preserve it only through an approved credentials packet; install
it and its matching protected-environment public key atomically with the signed
backup release so the timer cannot create unsigned recovery points.

```bash
sudo /usr/local/sbin/mochirii-social-backup-enable
```

## GitHub Recovery

The canonical repository is public. Store recovery credentials only as
`social-recovery` environment secrets and non-secret destinations as
`social-recovery` environment variables. Restrict deployments to protected
`main`, and retain any required-reviewer rule confirmed through GitHub provider
readback. Repository-wide credentials are not the recovery boundary.

The protected `Verify or restore Mochirii Social backup` workflow obtains the
exact private object key only from the protected `social-recovery` environment
secret `BACKUP_RECOVERY_OBJECT_KEY`; it is not retained in workflow-dispatch
inputs. The matching producer public key comes only from the same environment's
`BACKUP_PRODUCER_PUBLIC_KEY` secret. Configuring or changing either value is a
separate exact provider approval, and a missing or malformed value fails
closed. `validate-only`
decrypts and restores it into an isolated GitHub-hosted MariaDB container.
`restore-production` additionally requires the typed confirmation
`RESTORE social.mochirii.com` and streams only the validated, at-most-512-MiB
plaintext payload over strict-host-key SSH to the locked, forced-command
`github-recovery` account.

`validate-only` may be used for source and recovery-point evidence. Do not
dispatch `restore-production` or install its reviewed host runtime until the
[production activation blocker](online-hosted-runtime.md#production-activation-blocker-uncatchable-process-or-host-loss)
is cleared by installing and reading back the reviewed boot visibility guard.
A successful backup validation does not prove that host prerequisite.

The host creates a new verified encrypted pre-restore point before replacing the
database. A failed production restore stays in maintenance mode for a forward
fix or another reviewed restore. Configuration files in the payload are not
automatically applied during a database restore.

The control set is protected `main`, the protected `social-recovery`
environment, full-SHA-pinned actions, read-only workflow permissions,
owner-controlled manual dispatch, exact typed confirmations, non-cancelling
concurrency, strict host-key checking, and the Droplet forced command. Do not
claim that GitHub reviewed a restore unless the required-reviewer rule is
verified by provider readback.
