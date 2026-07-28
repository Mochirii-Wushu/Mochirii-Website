#!/usr/bin/env bash

set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || {
  echo "Run the private-media bootstrap helper and archive harness as root." >&2
  exit 1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_root="$(mktemp -d)"
runtime_targets=(
  /usr/local/lib/mochirii-social/production-runtime-lib.sh
  /usr/local/sbin/mochirii-social-deploy
  /usr/local/sbin/mochirii-social-backup
  /usr/local/sbin/mochirii-social-restore
  /usr/local/sbin/mochirii-social-deploy-entry
)
for runtime_target in "${runtime_targets[@]}"; do
  [[ ! -e "$runtime_target" && ! -L "$runtime_target" ]] || {
    echo "The helper and archive harness refuses to replace an installed deployment runtime." >&2
    exit 1
  }
done
cleanup() {
  rm -rf "$test_root"
  rm -f -- "${runtime_targets[@]}"
  rmdir /usr/local/lib/mochirii-social 2>/dev/null || true
}
trap cleanup EXIT

export MOCHIRII_SOCIAL_ROOT="$test_root/runtime"
export MOCHIRII_SOCIAL_DEPLOY_RUNTIME_CONTRACT="$test_root/deploy-runtime.contract"
export PATH="$test_root/bin:$PATH"
install -d -m 0700 -o root -g root "$MOCHIRII_SOCIAL_ROOT/shared/private-media-cutover"
install -d -m 0755 "$test_root/bin" /usr/local/lib/mochirii-social

cat >"$test_root/bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
headers=""
method=GET
url=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dump-header) headers="$2"; shift 2 ;;
    --head) method=HEAD; shift ;;
    --request) method="$2"; shift 2 ;;
    --write-out) shift 2 ;;
    --max-time | --max-redirs) shift 2 ;;
    --output) shift 2 ;;
    --silent | --show-error) shift ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
[[ -n "$headers" && -n "$url" ]]
status=503
size=128
cache_control=no-store
case "$url" in
  */storage/m | */storage/m/* | */storage/_esm.t3 | */storage/_esm.t3/* | */storage/g | */storage/g/* | */storage/g1 | */storage/g1/* | */storage/avatars | */storage/avatars/* | */storage/cache/avatars | */storage/cache/avatars/*)
    status=404
    size=0
    cache_control='private, no-store'
    ;;
  */installer | */installer/*)
    status=404
    size=0
    ;;
  */media/private/*)
    if [[ "${MOCK_PRIVATE_GATEWAY_STATE:-maintenance}" == permanent ]]; then
      status=404
      size=6358
      cache_control='no-cache, private'
    fi
    ;;
esac
[[ "$method" == HEAD ]] && size=0
{
  printf 'HTTP/2 %s\r\n' "$status"
  printf 'cache-control: %s\r\n' "$cache_control"
  case "${MOCK_CURL_MODE:-ok}" in
    redirect) printf 'location: https://example.invalid/\r\n' ;;
    cookie) printf 'set-cookie: unsafe=1\r\n' ;;
    cachepublic) printf 'cache-control: public, max-age=3600\r\n' ;;
    cacheimmutable) printf 'cache-control: immutable\r\n' ;;
    cachesmaxage) printf 'cache-control: s-maxage=60\r\n' ;;
  esac
  printf '\r\n'
} >"$headers"
case "${MOCK_CURL_MODE:-ok}" in
  badstatus) status=200 ;;
  large) [[ "$status" == 503 ]] && size=70000 ;;
  body) [[ "$status" == 404 ]] && size=1 ;;
esac
printf '%s:%s' "$status" "$size"
MOCK_CURL
chmod 0755 "$test_root/bin/curl"

cat >"$test_root/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == exec ]]; then
  printf '%s' "${MOCK_LARAVEL_SENTINEL:-MOCHIRII_LARAVEL_UP}"
  exit 0
fi
if [[ "${1:-}" == run ]]; then
  if [[ "$*" == *"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"* ]]; then
    printf '%s\n' "${MOCK_PREVIOUS_MIGRATION_TREE:-${MOCK_MIGRATION_TREE:?}}"
  else
    printf '%s\n' "${MOCK_MIGRATION_TREE:?}"
  fi
  exit 0
fi
echo "Unsupported docker mock invocation" >&2
exit 1
MOCK_DOCKER
chmod 0755 "$test_root/bin/docker"

# shellcheck source=production-runtime-lib.sh
source "$script_dir/production-runtime-lib.sh"

proof_content="$(printf '%s\n' \
  'version=1' \
  'state=stage-authorized' \
  'hostname=social.mochirii.com' \
  'expected_status=503')"
printf '%s\n' "$proof_content" >"$PRIVATE_MEDIA_MAINTENANCE_PROOF"
chown root:root "$PRIVATE_MEDIA_MAINTENANCE_PROOF"
chmod 0600 "$PRIVATE_MEDIA_MAINTENANCE_PROOF"

for index in "${!runtime_targets[@]}"; do
  if [[ "$index" -eq 0 ]]; then
    install -m 0644 "$script_dir/production-runtime-lib.sh" "${runtime_targets[$index]}"
    chmod 0644 "${runtime_targets[$index]}"
  else
    printf '#!/usr/bin/env bash\ntrue\n' >"${runtime_targets[$index]}"
    chmod 0755 "${runtime_targets[$index]}"
  fi
  chown root:root "${runtime_targets[$index]}"
done
contract_manifest="$test_root/contract.manifest"
for runtime_target in "${runtime_targets[@]}"; do
  sha256sum "$runtime_target" >>"$contract_manifest"
done
contract_sha256="$(sha256sum "$contract_manifest" | cut -d' ' -f1)"
{
  printf '%s\n' \
    'version=2' \
    'installed_from_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    "contract_sha256=$contract_sha256"
  cat "$contract_manifest"
} >"$DEPLOY_RUNTIME_CONTRACT"
chown root:root "$DEPLOY_RUNTIME_CONTRACT"
chmod 0444 "$DEPLOY_RUNTIME_CONTRACT"
verify_installed_deploy_runtime_contract "$contract_sha256"
cp "$DEPLOY_RUNTIME_CONTRACT" "$test_root/contract.original"

tampered_manifest="$test_root/contract.tampered.manifest"
{
  printf '%s  %s\n' "$(sha256sum "${runtime_targets[0]}" | cut -d' ' -f1)" /tmp/unexpected-runtime-library
  for index in 1 2 3 4; do
    sha256sum "${runtime_targets[$index]}"
  done
} >"$tampered_manifest"
tampered_contract_sha256="$(sha256sum "$tampered_manifest" | cut -d' ' -f1)"
{
  printf '%s\n' \
    version=2 \
    installed_from_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    "contract_sha256=$tampered_contract_sha256"
  cat "$tampered_manifest"
} >"$DEPLOY_RUNTIME_CONTRACT"
chmod 0444 "$DEPLOY_RUNTIME_CONTRACT"
if verify_installed_deploy_runtime_contract 2>/dev/null; then
  echo "A self-consistent deployment contract with a substituted target was accepted." >&2
  exit 1
fi
install -m 0444 -o root -g root "$test_root/contract.original" "$DEPLOY_RUNTIME_CONTRACT"

chmod 0600 "${runtime_targets[0]}"
if verify_installed_deploy_runtime_contract 2>/dev/null; then
  echo "A deployment-runtime target with mode drift was accepted." >&2
  exit 1
fi
chmod 0644 "${runtime_targets[0]}"
mv "${runtime_targets[1]}" "$test_root/deploy.original"
ln -s "$test_root/deploy.original" "${runtime_targets[1]}"
if verify_installed_deploy_runtime_contract 2>/dev/null; then
  echo "A symlinked deployment-runtime target was accepted." >&2
  exit 1
fi
rm -f "${runtime_targets[1]}"
mv "$test_root/deploy.original" "${runtime_targets[1]}"
verify_installed_deploy_runtime_contract "$contract_sha256"

recipient_fixture="$test_root/backup-recipient.pub"
printf '%s\n' 'age1testfixture' >"$recipient_fixture"
chown root:root "$recipient_fixture"
chmod 0644 "$recipient_fixture"
verify_secure_backup_recipient_file "$recipient_fixture"
chmod 0600 "$recipient_fixture"
verify_secure_backup_recipient_file "$recipient_fixture"
chmod 0664 "$recipient_fixture"
if verify_secure_backup_recipient_file "$recipient_fixture" 2>/dev/null; then
  echo "A group-writable backup recipient file was accepted." >&2
  exit 1
fi
chmod 0644 "$recipient_fixture"
ln -s "$recipient_fixture" "$test_root/backup-recipient-link.pub"
if verify_secure_backup_recipient_file "$test_root/backup-recipient-link.pub" 2>/dev/null; then
  echo "A symlinked backup recipient file was accepted." >&2
  exit 1
fi

backup_environment_fixture="$test_root/backup.env"
printf '%s\n' 'fixture=true' >"$backup_environment_fixture"
chown root:root "$backup_environment_fixture"
chmod 0600 "$backup_environment_fixture"
verify_secure_backup_environment_file "$backup_environment_fixture"
chmod 0640 "$backup_environment_fixture"
if verify_secure_backup_environment_file "$backup_environment_fixture" 2>/dev/null; then
  echo "A group-readable backup environment was accepted." >&2
  exit 1
fi
chmod 0600 "$backup_environment_fixture"
ln -s "$backup_environment_fixture" "$test_root/backup-environment-link.env"
if verify_secure_backup_environment_file \
    "$test_root/backup-environment-link.env" 2>/dev/null; then
  echo "A symlinked backup environment was accepted." >&2
  exit 1
fi

encrypted_fixture="$test_root/recovery-encrypted.tar.age"
printf '%s' 'encrypted-fixture' >"$encrypted_fixture"
verify_bounded_encrypted_recovery_file \
  "$encrypted_fixture" "$(stat -c '%s' "$encrypted_fixture")"
if verify_bounded_encrypted_recovery_file "$encrypted_fixture" 1 2>/dev/null; then
  echo "An encrypted recovery payload with transfer-size drift was accepted." >&2
  exit 1
fi
: >"$test_root/recovery-encrypted-empty.tar.age"
if verify_bounded_encrypted_recovery_file \
    "$test_root/recovery-encrypted-empty.tar.age" 2>/dev/null; then
  echo "An empty encrypted recovery payload was accepted." >&2
  exit 1
fi
truncate -s "$((RECOVERY_ENCRYPTED_MAX_BYTES + 1))" \
  "$test_root/recovery-encrypted-oversized.tar.age"
if verify_bounded_encrypted_recovery_file \
    "$test_root/recovery-encrypted-oversized.tar.age" 2>/dev/null; then
  echo "An oversized encrypted recovery payload was accepted." >&2
  exit 1
fi
ln -s "$encrypted_fixture" "$test_root/recovery-encrypted-link.tar.age"
if verify_bounded_encrypted_recovery_file \
    "$test_root/recovery-encrypted-link.tar.age" 2>/dev/null; then
  echo "A symlinked encrypted recovery payload was accepted." >&2
  exit 1
fi

python3 - "$test_root" <<'PY'
import io
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1])

def write_bundle(name, members):
    with tarfile.open(root / f"{name}.tar.gz", "w:gz") as archive:
        for member_name, kind, payload in members:
            info = tarfile.TarInfo(member_name)
            if kind == "file":
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))
            elif kind == "hardlink":
                info.type = tarfile.LNKTYPE
                info.linkname = payload.decode()
                archive.addfile(info)

valid = [
    ("docker-compose.production.yml", "file", b"services: {}\n"),
    ("release.meta", "file", b"metadata\n"),
]
write_bundle("valid", valid)
write_bundle("oversized", [valid[0], ("release.meta", "file", b"x" * 4097)])
write_bundle("hardlink", [valid[0], ("release.meta", "hardlink", b"docker-compose.production.yml")])
write_bundle("unexpected", [valid[0], ("../release.meta", "file", b"metadata\n")])
write_bundle("duplicate", [valid[0], valid[0]])
PY
install -d -m 0700 "$test_root/extract-valid"
extract_validated_release_bundle "$test_root/valid.tar.gz" "$test_root/extract-valid"
[[ -f "$test_root/extract-valid/docker-compose.production.yml" && -f "$test_root/extract-valid/release.meta" ]]
for invalid_bundle in oversized hardlink unexpected duplicate; do
  install -d -m 0700 "$test_root/extract-$invalid_bundle"
  if extract_validated_release_bundle \
    "$test_root/$invalid_bundle.tar.gz" \
    "$test_root/extract-$invalid_bundle" 2>/dev/null; then
    echo "The release bundle preflight accepted $invalid_bundle archive metadata." >&2
    exit 1
  fi
done

python3 - "$test_root" "$RECOVERY_DATABASE_MAX_BYTES" <<'PY'
import gzip
import hashlib
import io
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1])
database_limit = int(sys.argv[2])
database = gzip.compress(b"SELECT 1;\n", mtime=0)
configuration = gzip.compress(b"recovery configuration\n", mtime=0)

def manifest_v1():
    return (
        "format=1\n"
        "created_utc=20260728T000000Z\n"
        "release_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
        "release_digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"
    ).encode()

def manifest_v2(*, database_sha=None):
    database_sha = database_sha or hashlib.sha256(database).hexdigest()
    return (
        "format=2\n"
        "created_utc=20260728T000000Z\n"
        "release_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
        "release_digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"
        f"database_sha256={database_sha}\n"
        f"configuration_sha256={hashlib.sha256(configuration).hexdigest()}\n"
        "cutover_phase=absent\n"
        "cutover_state_sha256=ABSENT\n"
        "maintenance_proof_sha256=ABSENT\n"
        "deploy_runtime_contract_file_sha256=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\n"
    ).encode()

def write_payload(name, members):
    with tarfile.open(root / f"recovery-{name}.tar", "w:") as archive:
        for member_name, kind, payload in members:
            info = tarfile.TarInfo(member_name)
            if kind == "file":
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))
            elif kind == "hardlink":
                info.type = tarfile.LNKTYPE
                info.linkname = payload.decode()
                archive.addfile(info)

valid = [
    ("database.sql.gz", "file", database),
    ("configuration.tar.gz", "file", configuration),
    ("manifest", "file", manifest_v2()),
]
write_payload("valid", valid)
write_payload("valid-v1", [valid[0], valid[1], ("manifest", "file", manifest_v1())])
write_payload("hardlink", [valid[0], valid[1], ("manifest", "hardlink", b"database.sql.gz")])
write_payload("unexpected", [valid[0], valid[1], ("../manifest", "file", manifest_v2())])
write_payload("duplicate", [valid[0], valid[1], valid[2], valid[2]])
write_payload(
    "mixed",
    [
        valid[0],
        valid[1],
        (
            "manifest",
            "file",
            manifest_v1() + f"database_sha256={hashlib.sha256(database).hexdigest()}\n".encode(),
        ),
    ],
)
reordered = manifest_v2().decode().splitlines()
reordered[1], reordered[2] = reordered[2], reordered[1]
write_payload(
    "reordered",
    [valid[0], valid[1], ("manifest", "file", ("\n".join(reordered) + "\n").encode())],
)
write_payload(
    "badhash",
    [valid[0], valid[1], ("manifest", "file", manifest_v2(database_sha="d" * 64))],
)

oversized = tarfile.TarInfo("database.sql.gz")
oversized.size = database_limit + 1
with (root / "recovery-oversized-member.tar").open("wb") as target:
    target.write(oversized.tobuf(format=tarfile.GNU_FORMAT))
    target.write(b"\0" * 1024)

valid_bytes = (root / "recovery-valid.tar").read_bytes()
(root / "recovery-truncated.tar").write_bytes(valid_bytes[:600])
PY
install -d -m 0700 "$test_root/recovery-valid"
extract_validated_recovery_payload "$test_root/recovery-valid.tar" "$test_root/recovery-valid"
validate_recovery_payload_manifest \
  "$test_root/recovery-valid" \
  "$test_root/recovery-valid/validated.manifest"
grep -Fxq 'format=2' "$test_root/recovery-valid/validated.manifest"
install -d -m 0700 "$test_root/recovery-valid-v1"
extract_validated_recovery_payload "$test_root/recovery-valid-v1.tar" "$test_root/recovery-valid-v1"
validate_recovery_payload_manifest \
  "$test_root/recovery-valid-v1" \
  "$test_root/recovery-valid-v1/validated.manifest"
grep -Fxq 'format=1' "$test_root/recovery-valid-v1/validated.manifest"
grep -Eq '^database_sha256=[0-9a-f]{64}$' "$test_root/recovery-valid-v1/validated.manifest"
grep -Eq '^configuration_sha256=[0-9a-f]{64}$' "$test_root/recovery-valid-v1/validated.manifest"
for invalid_recovery in hardlink unexpected duplicate mixed reordered badhash oversized-member truncated; do
  install -d -m 0700 "$test_root/recovery-$invalid_recovery-extracted"
  if extract_validated_recovery_payload \
      "$test_root/recovery-$invalid_recovery.tar" \
      "$test_root/recovery-$invalid_recovery-extracted" 2>/dev/null && \
    validate_recovery_payload_manifest \
      "$test_root/recovery-$invalid_recovery-extracted" \
      "$test_root/recovery-$invalid_recovery-extracted/validated.manifest" 2>/dev/null; then
    echo "Recovery payload accepted invalid archive: $invalid_recovery" >&2
    exit 1
  fi
done
truncate -s "$((RECOVERY_PAYLOAD_MAX_BYTES + 1))" "$test_root/recovery-oversized-archive.tar"
install -d -m 0700 "$test_root/recovery-oversized-archive-extracted"
if extract_validated_recovery_payload \
    "$test_root/recovery-oversized-archive.tar" \
    "$test_root/recovery-oversized-archive-extracted" 2>/dev/null; then
  echo "Recovery payload accepted invalid archive: oversized-archive" >&2
  exit 1
fi
ln -s "$test_root/recovery-valid.tar" "$test_root/recovery-symlink.tar"
install -d -m 0700 "$test_root/recovery-symlink-extracted"
if extract_validated_recovery_payload \
    "$test_root/recovery-symlink.tar" \
    "$test_root/recovery-symlink-extracted" 2>/dev/null; then
  echo "Recovery payload accepted invalid archive: symlink" >&2
  exit 1
fi

configuration_runtime_prefix=opt/mochirii-social
python3 - "$test_root" "$configuration_runtime_prefix" <<'PY'
import io
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1])
runtime_prefix = sys.argv[2]
commit = "a" * 40
common = [
    "etc/caddy/Caddyfile",
    "etc/ssh/sshd_config.d/99-mochirii-hardening.conf",
    f"{runtime_prefix}/shared/backup.env",
    f"{runtime_prefix}/shared/backup-recipient.pub",
    f"{runtime_prefix}/shared/pixelfed.env",
]
release = [
    f"{runtime_prefix}/releases/{commit}/docker-compose.production.yml",
    f"{runtime_prefix}/releases/{commit}/release.env",
    f"{runtime_prefix}/releases/{commit}/release.meta",
]
runtime = [
    "usr/local/lib/mochirii-social/deploy-runtime.contract",
    "usr/local/lib/mochirii-social/production-runtime-lib.sh",
    "usr/local/sbin/mochirii-social-deploy",
    "usr/local/sbin/mochirii-social-backup",
    "usr/local/sbin/mochirii-social-restore",
    "usr/local/sbin/mochirii-social-deploy-entry",
]
optional = [
    "etc/systemd/system/mochirii-social-backup.service",
    "etc/systemd/system/mochirii-social-backup.timer",
    f"{runtime_prefix}/shared/private-media-cutover/cutover.state",
    f"{runtime_prefix}/shared/private-media-cutover/maintenance.proof",
]

def write(name, entries, *, pax=False):
    kwargs = {"format": tarfile.PAX_FORMAT} if pax else {}
    with tarfile.open(root / f"configuration-{name}.tar.gz", "w:gz", **kwargs) as archive:
        for index, (entry_name, kind, payload) in enumerate(entries):
            member = tarfile.TarInfo(entry_name)
            if pax and index == 0:
                member.pax_headers = {"comment": "unreviewed"}
            if kind == "file":
                member.size = len(payload)
                archive.addfile(member, io.BytesIO(payload))
            elif kind == "hardlink":
                member.type = tarfile.LNKTYPE
                member.linkname = payload.decode()
                archive.addfile(member)
            elif kind == "symlink":
                member.type = tarfile.SYMTYPE
                member.linkname = payload.decode()
                archive.addfile(member)

def files(names, payload=b"evidence\n"):
    return [(name, "file", payload) for name in names]

legacy = files(common + release)
current = files(common + release + runtime + optional)
write("valid-v1", legacy)
write("valid-v2", current)
write("hardlink", current[:-1] + [(current[-1][0], "hardlink", common[0].encode())])
write("symlink", current[:-1] + [(current[-1][0], "symlink", common[0].encode())])
write("traversal", current + [("../unexpected", "file", b"bad")])
write("duplicate", current + [current[0]])
write("missing", current[1:])
wrong_release = [entry.replace(commit, "b" * 40) for entry in release]
write("wrong-release", files(common + wrong_release + runtime))
write("oversized-member", files(common + release + runtime[:-1]) + [
    (runtime[-1], "file", b"x" * (4 * 1024 * 1024 + 1)),
])
expanded_names = common + release + runtime + optional
write("expanded", files(expanded_names, b"x" * (3 * 1024 * 1024)))
write("pax", current, pax=True)
PY
for config_format in 1 2; do
  config_extract="$test_root/configuration-valid-v$config_format"
  install -d -m 0700 "$config_extract"
  validate_recovery_configuration_archive \
    "$test_root/configuration-valid-v$config_format.tar.gz" \
    "$configuration_runtime_prefix" \
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    "$config_format" \
    "$config_extract"
  [[ -f "$config_extract/etc/caddy/Caddyfile" ]]
done
for invalid_configuration in \
  hardlink symlink traversal duplicate missing wrong-release oversized-member expanded pax; do
  if validate_recovery_configuration_archive \
      "$test_root/configuration-$invalid_configuration.tar.gz" \
      "$configuration_runtime_prefix" \
      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
      2 2>/dev/null; then
    echo "Configuration archive accepted invalid input: $invalid_configuration" >&2
    exit 1
  fi
done

python3 - "$test_root" "$configuration_runtime_prefix" <<'PY'
import hashlib
import io
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1])
runtime_prefix = sys.argv[2]
commit = "a" * 40
digest = "sha256:" + "b" * 64
runtime_paths = [
    "/usr/local/lib/mochirii-social/production-runtime-lib.sh",
    "/usr/local/sbin/mochirii-social-deploy",
    "/usr/local/sbin/mochirii-social-backup",
    "/usr/local/sbin/mochirii-social-restore",
    "/usr/local/sbin/mochirii-social-deploy-entry",
]
runtime_payloads = {
    path.removeprefix("/"): f"runtime-{index}\n".encode()
    for index, path in enumerate(runtime_paths)
}
contract_manifest_lines = [
    f"{hashlib.sha256(runtime_payloads[path.removeprefix('/')]).hexdigest()}  {path}"
    for path in runtime_paths
]
contract_manifest = ("\n".join(contract_manifest_lines) + "\n").encode()
runtime_contract_sha = hashlib.sha256(contract_manifest).hexdigest()
contract = (
    "version=2\n"
    f"installed_from_commit={'c' * 40}\n"
    f"contract_sha256={runtime_contract_sha}\n"
    + contract_manifest.decode()
).encode()
proof = (
    "version=1\n"
    "state=stage-authorized\n"
    "hostname=social.mochirii.com\n"
    "expected_status=503\n"
).encode()
proof_sha = hashlib.sha256(proof).hexdigest()
# The historical cutover contract intentionally differs from the current
# archived deploy-runtime contract after a legitimate runtime-only update.
cutover_state = (
    "version=2\n"
    "phase=completed\n"
    "operation_id=123e4567-e89b-42d3-a456-426614174000\n"
    f"commit={commit}\n"
    f"digest={digest}\n"
    f"previous_commit={'d' * 40}\n"
    f"previous_digest=sha256:{'e' * 64}\n"
    "horizon_state=running\n"
    "scheduler_state=running\n"
    "laravel_maintenance_state=up\n"
    f"maintenance_proof_sha256={proof_sha}\n"
    f"runtime_contract_sha256={'f' * 64}\n"
    f"migration_tree_sha256={'1' * 64}\n"
    "retired_operation_ids=\n"
).encode()
cutover_state_sha = hashlib.sha256(cutover_state).hexdigest()

common = {
    "etc/caddy/Caddyfile": b"caddy\n",
    "etc/ssh/sshd_config.d/99-mochirii-hardening.conf": b"ssh\n",
    f"{runtime_prefix}/shared/backup.env": b"backup\n",
    f"{runtime_prefix}/shared/backup-recipient.pub": b"recipient\n",
    f"{runtime_prefix}/shared/pixelfed.env": b"pixelfed\n",
}
release = {
    f"{runtime_prefix}/releases/{commit}/docker-compose.production.yml": b"services: {}\n",
    f"{runtime_prefix}/releases/{commit}/release.env": b"IMAGE_DIGEST=fixture\n",
    f"{runtime_prefix}/releases/{commit}/release.meta": (
        f"commit={commit}\n"
        f"digest={digest}\n"
        "repository=Mochirii-Wushu/Mochirii\n"
        f"migration_tree_sha256={'4' * 64}\n"
        f"runtime_contract_sha256={'5' * 64}\n"
    ).encode(),
}
legacy_release = {
    **release,
    f"{runtime_prefix}/releases/{commit}/release.meta": (
        f"commit={commit}\n"
        f"digest={digest}\n"
        "repository=Mochirii-Wushu/Mochirii\n"
    ).encode(),
}
current = {
    **common,
    **release,
    "usr/local/lib/mochirii-social/deploy-runtime.contract": contract,
    **runtime_payloads,
}
current_cutover = {
    **current,
    f"{runtime_prefix}/shared/private-media-cutover/cutover.state": cutover_state,
    f"{runtime_prefix}/shared/private-media-cutover/maintenance.proof": proof,
}

def write_archive(name, entries):
    with tarfile.open(root / f"semantic-{name}.tar.gz", "w:gz") as archive:
        for path, payload in entries.items():
            member = tarfile.TarInfo(path)
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))

def write_manifest(name, format_value, *, state="ABSENT", proof_value="ABSENT", phase="absent"):
    contract_file_sha = (
        hashlib.sha256(contract).hexdigest() if format_value == 2 else "ABSENT"
    )
    (root / f"semantic-{name}.manifest").write_text(
        f"format={format_value}\n"
        "created_utc=20260728T000000Z\n"
        f"release_commit={commit}\n"
        f"release_digest={digest}\n"
        f"database_sha256={'2' * 64}\n"
        f"configuration_sha256={'3' * 64}\n"
        f"cutover_phase={phase}\n"
        f"cutover_state_sha256={state}\n"
        f"maintenance_proof_sha256={proof_value}\n"
        f"deploy_runtime_contract_file_sha256={contract_file_sha}\n",
        encoding="utf-8",
    )

write_archive("valid-v1", {**common, **legacy_release})
write_archive("valid-v2", current)
write_archive("valid-cutover", current_cutover)
write_manifest("valid-v1", 1)
write_manifest("valid-v2", 2)
write_manifest(
    "valid-cutover",
    2,
    state=cutover_state_sha,
    proof_value=proof_sha,
    phase="completed",
)
PY
for semantic_case in valid-v1 valid-v2 valid-cutover; do
  semantic_format=2
  [[ "$semantic_case" == valid-v1 ]] && semantic_format=1
  semantic_root="$test_root/semantic-$semantic_case"
  install -d -m 0700 "$semantic_root"
  validate_recovery_configuration_archive \
    "$test_root/semantic-$semantic_case.tar.gz" \
    "$configuration_runtime_prefix" \
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    "$semantic_format" \
    "$semantic_root"
  validate_recovery_configuration_bindings \
    "$semantic_root" \
    "$test_root/semantic-$semantic_case.manifest" \
    "$configuration_runtime_prefix"
done
declare -A semantic_tamper_targets=(
  [release-meta]="$configuration_runtime_prefix/releases/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/release.meta"
  [contract]="usr/local/lib/mochirii-social/deploy-runtime.contract"
  [runtime]="usr/local/sbin/mochirii-social-deploy"
)
for semantic_tamper in release-meta contract runtime; do
  semantic_bad_root="$test_root/semantic-bad-$semantic_tamper"
  cp -a "$test_root/semantic-valid-v2" "$semantic_bad_root"
  if [[ "$semantic_tamper" == release-meta ]]; then
    printf '%s\n' \
      commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
      digest=sha256:9999999999999999999999999999999999999999999999999999999999999999 \
      repository=Mochirii-Wushu/Mochirii \
      migration_tree_sha256=4444444444444444444444444444444444444444444444444444444444444444 \
      runtime_contract_sha256=5555555555555555555555555555555555555555555555555555555555555555 \
      >"$semantic_bad_root/${semantic_tamper_targets[$semantic_tamper]}"
  else
    printf '%s\n' tampered >>"$semantic_bad_root/${semantic_tamper_targets[$semantic_tamper]}"
  fi
  if validate_recovery_configuration_bindings \
      "$semantic_bad_root" \
      "$test_root/semantic-valid-v2.manifest" \
      "$configuration_runtime_prefix" 2>/dev/null; then
    echo "Configuration bindings accepted tampered evidence: $semantic_tamper" >&2
    exit 1
  fi
done
for semantic_tamper in cutover-state cutover-proof; do
  semantic_bad_root="$test_root/semantic-bad-$semantic_tamper"
  cp -a "$test_root/semantic-valid-cutover" "$semantic_bad_root"
  if [[ "$semantic_tamper" == cutover-state ]]; then
    semantic_target="$configuration_runtime_prefix/shared/private-media-cutover/cutover.state"
  else
    semantic_target="$configuration_runtime_prefix/shared/private-media-cutover/maintenance.proof"
  fi
  printf '%s\n' tampered >>"$semantic_bad_root/$semantic_target"
  if validate_recovery_configuration_bindings \
      "$semantic_bad_root" \
      "$test_root/semantic-valid-cutover.manifest" \
      "$configuration_runtime_prefix" 2>/dev/null; then
    echo "Configuration bindings accepted tampered evidence: $semantic_tamper" >&2
    exit 1
  fi
done

# Aggregate validation must not rely on ambient `errexit`: these helpers are
# intentionally invoked from conditional rollback/finalization paths.
if (
  wait_for_container_health() { return 1; }
  docker() { return 0; }
  curl() { return 0; }
  verify_runtime
) >/dev/null 2>&1; then
  echo "Runtime verification masked an early container-health failure." >&2
  exit 1
fi
if (
  wait_for_container_running() { return 1; }
  verify_exact_container_image() { return 0; }
  verify_worker_state() { return 0; }
  laravel_maintenance_state() { printf '%s\n' down; }
  docker() { return 0; }
  verify_closed_private_media_runtime_local \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
) >/dev/null 2>&1; then
  echo "Closed private-media validation masked an early app-state failure." >&2
  exit 1
fi
if (
  verify_closed_private_media_runtime_local() { return 1; }
  verify_public_maintenance_boundary() { return 0; }
  verify_staged_private_media_gateway \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    123e4567-e89b-42d3-a456-426614174000
) >/dev/null 2>&1; then
  echo "Staged private-media validation masked an early local-gate failure." >&2
  exit 1
fi
if (
  verify_permanent_private_media_runtime_local() { return 1; }
  verify_public_private_media_gateway_denial_boundary() { return 0; }
  verify_public_private_media_denial_boundary() { return 0; }
  verify_permanent_private_media_runtime \
    sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
) >/dev/null 2>&1; then
  echo "Permanent private-media validation masked an early local-gate failure." >&2
  exit 1
fi
if (
  validate_private_media_cutover_state() { return 1; }
  private_media_maintenance_proof_sha256() { printf '%064d\n' 0; }
  cutover_state_value() { printf '%064d\n' 0; }
  verify_installed_deploy_runtime_contract() { return 0; }
  verify_private_media_state_bindings "$(printf '%064d' 0)"
) >/dev/null 2>&1; then
  echo "Private-media state bindings masked an invalid durable state." >&2
  exit 1
fi
if (
  reject_active_private_media_cutover_state() { return 1; }
  reject_active_restore_state() { return 0; }
  verify_online_hosting
) >/dev/null 2>&1; then
  echo "Online-hosting verification masked an active cutover state." >&2
  exit 1
fi
if (
  ln() { return 1; }
  mv() { return 0; }
  fsync_path() { return 0; }
  set_current_release_link "$test_root/release"
) >/dev/null 2>&1; then
  echo "Current-release replacement masked a link-creation failure." >&2
  exit 1
fi

declare -A hard_stop_state=(
  [pixelfed-app]=true
  [pixelfed-horizon]=true
  [pixelfed-scheduler]=true
)
hard_stop_log="$test_root/hard-stop.log"
docker() {
  case "${1:-}" in
    ps)
      [[ "${MOCK_DOCKER_QUERY_FAILURE:-false}" == false ]] || return 1
      local filter_value="${4:-}"
      local queried_container="${filter_value#name=^/}"
      queried_container="${queried_container%\$}"
      if [[ -n "${hard_stop_state[$queried_container]+present}" ]]; then
        printf '%s\n' "$queried_container"
      fi
      ;;
    inspect)
      if [[ "${2:-}" == --format ]]; then
        printf '%s\n' "${hard_stop_state[${4:-}]:-false}"
      else
        [[ -n "${hard_stop_state[${2:-}]+present}" ]]
      fi
      ;;
    exec)
      return 1
      ;;
    stop)
      local stopped_container="${4:-}"
      hard_stop_state[$stopped_container]=false
      printf '%s\n' "$stopped_container" >>"$hard_stop_log"
      ;;
    *)
      return 1
      ;;
  esac
}
compose_release() {
  return 1
}
laravel_maintenance_state() {
  printf '%s\n' up
}
enforce_fail_closed_runtime "$test_root/missing-release" hard-stop-test
[[ "$FAIL_CLOSED_RUNTIME_MODE" == hard-stop ]]
verify_fail_closed_hard_stop
for stopped_container in pixelfed-app pixelfed-horizon pixelfed-scheduler; do
  grep -Fxq "$stopped_container" "$hard_stop_log" || {
    echo "Maintenance failure did not invoke the direct container hard stop." >&2
    exit 1
  }
done
MOCK_DOCKER_QUERY_FAILURE=true
if verify_fail_closed_hard_stop 2>/dev/null; then
  echo "A Docker query failure was accepted as a proven hard stop." >&2
  exit 1
fi
MOCK_DOCKER_QUERY_FAILURE=false
unset 'hard_stop_state[pixelfed-app]'
unset 'hard_stop_state[pixelfed-horizon]'
unset 'hard_stop_state[pixelfed-scheduler]'
verify_fail_closed_hard_stop
unset -f docker compose_release laravel_maintenance_state
unset hard_stop_state
# Restore the production helpers replaced only inside the hard-stop mock.
# shellcheck source=production-runtime-lib.sh
source "$script_dir/production-runtime-lib.sh"

rollback_compose_log="$test_root/rollback-compose.log"
compose_release() {
  printf '%s\n' "$*" >>"$rollback_compose_log"
  return 1
}
if ! quiesce_candidate_for_rollback_best_effort "$test_root/missing-candidate-release"; then
  echo "An absent candidate app made best-effort prior-runtime rollback cleanup fail." >&2
  exit 1
fi
grep -Fxq "$test_root/missing-candidate-release stop --timeout 90 horizon scheduler" \
  "$rollback_compose_log"

operation_id=123e4567-e89b-42d3-a456-426614174000
commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
previous_commit=cccccccccccccccccccccccccccccccccccccccc
previous_digest=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
migration_tree=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
proof_sha256="$(private_media_maintenance_proof_sha256)"

backup_script="$script_dir/backup-production-runtime.sh"
rm -f "$PRIVATE_MEDIA_CUTOVER_STATE"
MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD=1 bash "$backup_script" --verify-cutover-guard >/dev/null
for backup_phase in intent staged finalizing recovery_required completed; do
  write_private_media_cutover_state \
    "$backup_phase" "$operation_id" "$commit" "$digest" "$previous_commit" "$previous_digest" \
    running running up "$proof_sha256" "$contract_sha256" "$migration_tree"
  if [[ "$backup_phase" == completed ]]; then
    MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD=1 bash "$backup_script" --verify-cutover-guard >/dev/null
  elif MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD=1 bash "$backup_script" --verify-cutover-guard >/dev/null 2>&1; then
    echo "Backup accepted active cutover phase: $backup_phase" >&2
    exit 1
  fi
done
rm -f "$PRIVATE_MEDIA_CUTOVER_STATE"
write_restore_state \
  intent \
  323e4567-e89b-42d3-a456-426614174000 \
  "$commit" \
  "$digest" \
  ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  1111111111111111111111111111111111111111111111111111111111111111 \
  2026-07-28T00:00:00Z \
  NONE
if MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD=1 bash "$backup_script" --verify-cutover-guard >/dev/null 2>&1; then
  echo "Backup accepted an active restore-recovery intent." >&2
  exit 1
fi
write_restore_state \
  completed \
  323e4567-e89b-42d3-a456-426614174000 \
  "$commit" \
  "$digest" \
  ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  1111111111111111111111111111111111111111111111111111111111111111 \
  2026-07-28T00:00:00Z \
  2026-07-28T00:01:00Z
MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD=1 bash "$backup_script" --verify-cutover-guard >/dev/null
cp "$RESTORE_STATE" "$test_root/restore.valid"
sed '1s/version=1/version=9/' "$test_root/restore.valid" >"$RESTORE_STATE"
chmod 0600 "$RESTORE_STATE"
if validate_restore_state 2>/dev/null || restore_state_phase >/dev/null 2>&1; then
  echo "A restore state with an invalid early field was accepted." >&2
  exit 1
fi
sed '5s/^release_digest=.*/release_digest=invalid/' \
  "$test_root/restore.valid" >"$RESTORE_STATE"
chmod 0600 "$RESTORE_STATE"
if validate_restore_state 2>/dev/null; then
  echo "A restore state with an invalid middle field was accepted." >&2
  exit 1
fi
install -m 0600 -o root -g root "$test_root/restore.valid" "$RESTORE_STATE"
if (
  fsync_path() { return 1; }
  write_restore_state \
    intent \
    423e4567-e89b-42d3-a456-426614174000 \
    "$commit" \
    "$digest" \
    ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
    1111111111111111111111111111111111111111111111111111111111111111 \
    2026-07-28T00:02:00Z \
    NONE
) >/dev/null 2>&1; then
  echo "Restore-state writing masked an fsync failure." >&2
  exit 1
fi

MOCK_MIGRATION_TREE="$migration_tree" \
  verify_private_media_migration_tree_parity "$digest" "$previous_digest" "$migration_tree"
if MOCK_MIGRATION_TREE="$migration_tree" \
  MOCK_PREVIOUS_MIGRATION_TREE=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  verify_private_media_migration_tree_parity "$digest" "$previous_digest" "$migration_tree" 2>/dev/null; then
  echo "A modified deployed migration tree was accepted." >&2
  exit 1
fi

write_private_media_cutover_state \
  intent "$operation_id" "$commit" "$digest" "$previous_commit" "$previous_digest" \
  running running up "$proof_sha256" "$contract_sha256" "$migration_tree"
[[ "$(private_media_cutover_phase)" == intent ]]
validate_private_media_cutover_state "$operation_id" "$commit" "$digest" "$migration_tree"
if validate_private_media_cutover_state 223e4567-e89b-42d3-a456-426614174000 "$commit" "$digest" "$migration_tree" 2>/dev/null; then
  echo "Mismatched operation ID was accepted." >&2
  exit 1
fi
if reject_active_private_media_cutover_state "Behavioral harness" 2>/dev/null; then
  echo "Intent state did not fail closed." >&2
  exit 1
fi
transition_private_media_cutover_phase intent staged
[[ "$(private_media_cutover_phase)" == staged ]]
transition_private_media_cutover_phase staged finalizing
[[ "$(private_media_cutover_phase)" == finalizing ]]
transition_private_media_cutover_phase finalizing completed
reject_active_private_media_cutover_state "Behavioral harness"
cp "$PRIVATE_MEDIA_CUTOVER_STATE" "$test_root/cutover.valid"
head -n 2 "$test_root/cutover.valid" >"$PRIVATE_MEDIA_CUTOVER_STATE"
chmod 0600 "$PRIVATE_MEDIA_CUTOVER_STATE"
if validate_private_media_cutover_state 2>/dev/null; then
  echo "A truncated private-media cutover state was accepted." >&2
  exit 1
fi
install -m 0600 -o root -g root "$test_root/cutover.valid" "$PRIVATE_MEDIA_CUTOVER_STATE"
sed '1s/version=2/version=9/' "$test_root/cutover.valid" >"$PRIVATE_MEDIA_CUTOVER_STATE"
chmod 0600 "$PRIVATE_MEDIA_CUTOVER_STATE"
if validate_private_media_cutover_state 2>/dev/null || \
  assert_private_media_operation_available 223e4567-e89b-42d3-a456-426614174000 2>/dev/null; then
  echo "A private-media state with an invalid early field was accepted." >&2
  exit 1
fi
sed '8s/^horizon_state=.*/horizon_state=invalid/' \
  "$test_root/cutover.valid" >"$PRIVATE_MEDIA_CUTOVER_STATE"
chmod 0600 "$PRIVATE_MEDIA_CUTOVER_STATE"
if validate_private_media_cutover_state 2>/dev/null; then
  echo "A private-media state with an invalid middle field was accepted." >&2
  exit 1
fi
rm -f "$PRIVATE_MEDIA_CUTOVER_STATE"
ln -s "$test_root/nonexistent-cutover-state" "$PRIVATE_MEDIA_CUTOVER_STATE"
if assert_private_media_operation_available \
    223e4567-e89b-42d3-a456-426614174000 2>/dev/null; then
  echo "A dangling private-media state link was treated as an available operation." >&2
  exit 1
fi
rm -f "$PRIVATE_MEDIA_CUTOVER_STATE"
install -m 0600 -o root -g root "$test_root/cutover.valid" "$PRIVATE_MEDIA_CUTOVER_STATE"
if (
  fsync_path() { return 1; }
  write_private_media_cutover_state \
    intent "$operation_id" "$commit" "$digest" "$previous_commit" "$previous_digest" \
    running running up "$proof_sha256" "$contract_sha256" "$migration_tree"
) >/dev/null 2>&1; then
  echo "Private-media state writing masked an fsync failure." >&2
  exit 1
fi

rm -f "$PRIVATE_MEDIA_CUTOVER_STATE"
write_private_media_cutover_state \
  intent "$operation_id" "$commit" "$digest" "$previous_commit" "$previous_digest" \
  running running up "$proof_sha256" "$contract_sha256" "$migration_tree"
retire_recovered_private_media_cutover_intent
[[ "$(private_media_cutover_phase)" == absent ]]
private_media_operation_is_retired "$operation_id"
if assert_private_media_operation_available "$operation_id" 2>/dev/null; then
  echo "A consumed private-media operation ID was accepted." >&2
  exit 1
fi
assert_private_media_operation_available 223e4567-e89b-42d3-a456-426614174000
second_operation_id=223e4567-e89b-42d3-a456-426614174000
write_private_media_cutover_state \
  intent "$second_operation_id" "$commit" "$digest" "$previous_commit" "$previous_digest" \
  running running up "$proof_sha256" "$contract_sha256" "$migration_tree" \
  "$(cutover_state_value retired_operation_ids)"
retire_recovered_private_media_cutover_intent
if assert_private_media_operation_available "$operation_id" 2>/dev/null || \
  assert_private_media_operation_available "$second_operation_id" 2>/dev/null; then
  echo "An older consumed private-media operation ID was accepted after two recoveries." >&2
  exit 1
fi

MOCK_CURL_MODE=ok verify_public_maintenance_boundary "$operation_id"
for failure_mode in redirect cookie badstatus large body cachepublic cacheimmutable cachesmaxage; do
  if MOCK_CURL_MODE="$failure_mode" verify_public_maintenance_boundary "$operation_id" 2>/dev/null; then
    echo "Maintenance boundary accepted mock failure mode: $failure_mode" >&2
    exit 1
  fi
done
MOCK_PRIVATE_GATEWAY_STATE=permanent verify_public_private_media_gateway_denial_boundary
MOCK_PRIVATE_GATEWAY_STATE=permanent verify_public_private_media_denial_boundary

[[ "$(MOCK_LARAVEL_SENTINEL=MOCHIRII_LARAVEL_UP laravel_maintenance_state)" == up ]]
[[ "$(MOCK_LARAVEL_SENTINEL=MOCHIRII_LARAVEL_DOWN laravel_maintenance_state)" == down ]]
if MOCK_LARAVEL_SENTINEL='MOCHIRII_LARAVEL_UP unexpected' laravel_maintenance_state 2>/dev/null; then
  echo "Ambiguous Laravel maintenance output was accepted." >&2
  exit 1
fi

# The initial host installer may bind installed bytes to a commit only when the
# entire checkout is clean and each installed input is the exact HEAD blob.
(
  installer_script="$script_dir/install-production-runtime.sh"
  updater_script="$script_dir/install-production-deploy-runtime-update.sh"
  # shellcheck disable=SC1090
  source <(sed -n '/^require_clean_installer_checkout() {$/,/^}$/p' "$installer_script")
  # shellcheck disable=SC1090
  source <(sed -n '/^require_exact_updater_checkout() {$/,/^}$/p' "$updater_script")
  installer_fixture="$test_root/installer-source"
  mkdir -p "$installer_fixture/services/social/scripts"
  git -C "$installer_fixture" init --quiet
  git -C "$installer_fixture" config user.name 'Mochirii Contract Test'
  git -C "$installer_fixture" config user.email 'contract-test@invalid.example'
  printf '%s\n' '#!/usr/bin/env bash' 'true' \
    >"$installer_fixture/services/social/scripts/runtime.sh"
  git -C "$installer_fixture" add services/social/scripts/runtime.sh
  git -C "$installer_fixture" commit --quiet -m fixture
  installer_commit="$(git -C "$installer_fixture" rev-parse HEAD)"
  installer_input=services/social/scripts/runtime.sh
  require_clean_installer_checkout \
    "$installer_fixture" "$installer_commit" "$installer_input"

  printf '%s\n' tampered >>"$installer_fixture/$installer_input"
  if require_clean_installer_checkout \
      "$installer_fixture" "$installer_commit" "$installer_input" 2>/dev/null; then
    echo "A modified installer source checkout was accepted." >&2
    exit 1
  fi
  git -C "$installer_fixture" restore -- "$installer_input"

  printf '%s\n' untracked >"$installer_fixture/untracked.txt"
  if require_clean_installer_checkout \
      "$installer_fixture" "$installer_commit" "$installer_input" 2>/dev/null; then
    echo "An untracked installer source checkout was accepted." >&2
    exit 1
  fi
  rm -f "$installer_fixture/untracked.txt"

  git -C "$installer_fixture" update-index --assume-unchanged "$installer_input"
  printf '%s\n' hidden-tamper >>"$installer_fixture/$installer_input"
  if require_clean_installer_checkout \
      "$installer_fixture" "$installer_commit" "$installer_input" 2>/dev/null; then
    echo "A hidden modified installer input was accepted." >&2
    exit 1
  fi
  if require_exact_updater_checkout \
      "$installer_fixture" "$installer_commit" "$installer_input" 2>/dev/null; then
    echo "A hidden modified updater input was accepted." >&2
    exit 1
  fi
  git -C "$installer_fixture" update-index --no-assume-unchanged "$installer_input"
  git -C "$installer_fixture" restore -- "$installer_input"
  git -C "$installer_fixture" update-index --skip-worktree "$installer_input"
  printf '%s\n' skip-worktree-tamper >>"$installer_fixture/$installer_input"
  if require_clean_installer_checkout \
      "$installer_fixture" "$installer_commit" "$installer_input" 2>/dev/null; then
    echo "A skip-worktree modified installer input was accepted." >&2
    exit 1
  fi
  if require_exact_updater_checkout \
      "$installer_fixture" "$installer_commit" "$installer_input" 2>/dev/null; then
    echo "A skip-worktree modified updater input was accepted." >&2
    exit 1
  fi
)

# Run the actual stage-rollback acceptance function with controlled runtime
# doubles. A captured live runtime must be accepted locally behind the external
# maintenance boundary; a failed local gate must retain recovery_required.
(
  deploy_script="$script_dir/deploy-production-runtime.sh"
  # shellcheck disable=SC1090
  source <(sed -n \
    -e '/^verify_restored_runtime_policy() {$/,/^}$/p' \
    -e '/^verify_restored_stage_rollback() {$/,/^}$/p' \
    -e '/^rollback_private_media_stage() {$/,/^}$/p' \
    "$deploy_script")

  # These doubles are invoked by the dynamically extracted production
  # rollback function, which static analysis cannot resolve.
  # shellcheck disable=SC2317
  run_stage_rollback_case() (
    local captured_laravel="$1"
    local fail_live_gate="$2"
    local expected_outcome="$3"
    local local_health_calls=0
    local fail_closed=false
    local recovery_required=false
    local retired=false
    local current_laravel=down
    declare -A worker_states=(
      [pixelfed-horizon]="$([[ "$captured_laravel" == up ]] && printf running || printf stopped)"
      [pixelfed-scheduler]="$([[ "$captured_laravel" == up ]] && printf running || printf stopped)"
    )
    declare -A cutover_values=(
      [phase]=intent
      [previous_commit]=cccccccccccccccccccccccccccccccccccccccc
      [previous_digest]=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
      [horizon_state]="${worker_states[pixelfed-horizon]}"
      [scheduler_state]="${worker_states[pixelfed-scheduler]}"
      [laravel_maintenance_state]="$captured_laravel"
    )

    operation_id=123e4567-e89b-42d3-a456-426614174000
    commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    migration_tree_sha256=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
    release_dir="$test_root/rollback-candidate-$captured_laravel-$fail_live_gate"
    mkdir -p "$release_dir"
    : >"$release_dir/release.env"

    validate_private_media_cutover_state() { return 0; }
    cutover_state_value() { printf '%s\n' "${cutover_values[$1]}"; }
    release_dir_for() { printf '%s\n' "$test_root/rollback-prior"; }
    compose_release() { return 0; }
    wait_for_container_running() { return 0; }
    wait_for_container_stopped() { return 0; }
    wait_for_container_health() { return 0; }
    verify_exact_container_image() { return 0; }
    verify_exact_runtime_images() { return 0; }
    verify_restored_runtime_policy() { return 0; }
    verify_public_maintenance_boundary() { return 0; }
    laravel_maintenance_state() { printf '%s\n' "$current_laravel"; }
    docker() {
      if [[ "$*" == *'php artisan down'* ]]; then
        current_laravel=down
      elif [[ "$*" == *'php artisan up'* ]]; then
        current_laravel=up
      fi
      return 0
    }
    restore_worker_state() {
      worker_states[$3]="$4"
    }
    verify_worker_state() {
      [[ "${worker_states[$1]}" == "$2" ]]
    }
    verify_runtime_local() {
      local_health_calls=$((local_health_calls + 1))
      [[ "$fail_live_gate" == false && "$current_laravel" == up && \
        "${worker_states[pixelfed-horizon]}" == running && \
        "${worker_states[pixelfed-scheduler]}" == running ]]
    }
    retire_recovered_private_media_cutover_intent() { retired=true; }
    enforce_fail_closed_runtime() { fail_closed=true; }
    transition_private_media_cutover_phase() {
      [[ "$1" == intent && "$2" == recovery_required ]]
      recovery_required=true
    }

    if [[ "$expected_outcome" == success ]]; then
      rollback_private_media_stage >/dev/null 2>&1
      [[ "$retired" == true && "$fail_closed" == false && \
        "$recovery_required" == false ]]
      if [[ "$captured_laravel" == up && "$local_health_calls" -ne 1 ]]; then
        echo "A restored live stage rollback did not run local runtime acceptance." >&2
        exit 1
      fi
      if [[ "$captured_laravel" == down && "$local_health_calls" -ne 0 ]]; then
        echo "A restored maintenance-stage rollback ran live runtime acceptance." >&2
        exit 1
      fi
    else
      if rollback_private_media_stage >/dev/null 2>&1; then
        echo "A failed restored live-runtime gate was accepted." >&2
        exit 1
      fi
      if [[ "$fail_closed" != true || "$recovery_required" != true || \
        "$retired" != false ]]; then
        echo "A failed restored live-runtime gate did not force recovery_required." >&2
        exit 1
      fi
    fi
  )

  run_stage_rollback_case up false success
  run_stage_rollback_case down false success
  run_stage_rollback_case up true failure
)

# Exercise the updater's actual validators in isolation. They are called from
# conditional recovery paths, so an early mismatch must survive later success.
(
  updater_script="$script_dir/install-production-deploy-runtime-update.sh"
  # shellcheck disable=SC1090
  source <(sed -n \
    -e '/^write_sha_manifest() {$/,/^}$/p' \
    -e '/^validate_update_state() {$/,/^}$/p' \
    -e '/^validate_backup_snapshot() {$/,/^}$/p' \
    "$updater_script")
  runtime_backup_root="$test_root/updater-backups"
  update_state="$test_root/updater.state"
  contract_target=/fixture/deploy-runtime.contract
  targets=(/fixture/runtime-lib /fixture/deploy /fixture/backup /fixture/restore /fixture/entry)
  modes=(0644 0755 0755 0755 0755)
  updater_operation_id=523e4567-e89b-42d3-a456-426614174000
  updater_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  updater_backup_root="$runtime_backup_root/deploy-runtime-$updater_commit-$updater_operation_id"
  install -d -m 0700 -o root -g root "$updater_backup_root"
  for updater_index in "${!targets[@]}"; do
    printf 'fixture-%s\n' "$updater_index" >"$updater_backup_root/$updater_index"
    chown root:root "$updater_backup_root/$updater_index"
    chmod "${modes[$updater_index]}" "$updater_backup_root/$updater_index"
  done
  : >"$updater_backup_root/contract.absent"
  chown root:root "$updater_backup_root/contract.absent"
  chmod 0600 "$updater_backup_root/contract.absent"
  for updater_index in "${!targets[@]}"; do
    printf '%s  %s\n' \
      "$(sha256sum "$updater_backup_root/$updater_index" | cut -d' ' -f1)" \
      "${targets[$updater_index]}" \
      >>"$updater_backup_root/before.sha256"
  done
  printf 'ABSENT  %s\n' "$contract_target" >>"$updater_backup_root/before.sha256"
  chown root:root "$updater_backup_root/before.sha256"
  chmod 0600 "$updater_backup_root/before.sha256"
  snapshot_sha256="$(sha256sum "$updater_backup_root/before.sha256" | cut -d' ' -f1)"
  validate_backup_snapshot \
    "$updater_backup_root" "$updater_commit" "$updater_operation_id" "$snapshot_sha256"

  printf '%s\n' \
    version=1 \
    phase=intent \
    "operation_id=$updater_operation_id" \
    "commit=$updater_commit" \
    "backup_root=$updater_backup_root" \
    "before_manifest_sha256=$snapshot_sha256" \
    after_manifest_sha256=NONE \
    retired_operation_ids= \
    >"$update_state"
  chown root:root "$update_state"
  chmod 0600 "$update_state"
  validate_update_state
  cp "$update_state" "$test_root/updater.state.valid"
  sed '1s/version=1/version=9/' "$test_root/updater.state.valid" >"$update_state"
  if validate_update_state 2>/dev/null; then
    echo "Updater state accepted an invalid early field." >&2
    exit 1
  fi
  sed '4s/^commit=.*/commit=invalid/' "$test_root/updater.state.valid" >"$update_state"
  if validate_update_state 2>/dev/null; then
    echo "Updater state accepted an invalid middle field." >&2
    exit 1
  fi
  install -m 0600 -o root -g root "$test_root/updater.state.valid" "$update_state"

  cp "$updater_backup_root/before.sha256" "$test_root/updater.before.valid"
  sed '1s/^[0-9a-f]\{64\}/0000000000000000000000000000000000000000000000000000000000000000/' \
    "$test_root/updater.before.valid" >"$updater_backup_root/before.sha256"
  tampered_snapshot_sha256="$(sha256sum "$updater_backup_root/before.sha256" | cut -d' ' -f1)"
  if validate_backup_snapshot \
      "$updater_backup_root" "$updater_commit" "$updater_operation_id" \
      "$tampered_snapshot_sha256" 2>/dev/null; then
    echo "Updater backup accepted an invalid early file hash." >&2
    exit 1
  fi
  sed '1s#  /fixture/runtime-lib$#  /fixture/wrong-runtime-lib#' \
    "$test_root/updater.before.valid" >"$updater_backup_root/before.sha256"
  tampered_snapshot_sha256="$(sha256sum "$updater_backup_root/before.sha256" | cut -d' ' -f1)"
  if validate_backup_snapshot \
      "$updater_backup_root" "$updater_commit" "$updater_operation_id" \
      "$tampered_snapshot_sha256" 2>/dev/null; then
    echo "Updater backup accepted an invalid early manifest path." >&2
    exit 1
  fi
  install -m 0600 -o root -g root \
    "$test_root/updater.before.valid" "$updater_backup_root/before.sha256"

  # These doubles are invoked by the dynamically extracted manifest writer.
  # shellcheck disable=SC2317
  if (
    sha256sum() { return 1; }
    chown() { return 0; }
    chmod() { return 0; }
    fsync_path() { return 0; }
    write_sha_manifest "$test_root/updater.partial-manifest" "$updater_backup_root/0"
  ) >/dev/null 2>&1; then
    echo "Updater manifest writing masked an early hash failure." >&2
    exit 1
  fi
)

lock_file="$test_root/deploy.lock"
exec 8>"$lock_file"
flock -n 8
if flock -n "$lock_file" true; then
  echo "A competing deployment lock was acquired." >&2
  exit 1
fi

echo "Private-media bootstrap helper and archive harness passed."
