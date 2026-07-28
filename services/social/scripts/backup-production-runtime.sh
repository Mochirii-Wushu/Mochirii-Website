#!/usr/bin/env bash

set -Eeuo pipefail

umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f /usr/local/lib/mochirii-social/production-runtime-lib.sh ]]; then
  # shellcheck source=/dev/null
  source /usr/local/lib/mochirii-social/production-runtime-lib.sh
else
  # shellcheck source=production-runtime-lib.sh
  source "$script_dir/production-runtime-lib.sh"
fi

BACKUP_ROOT="$RUNTIME_ROOT/backups"
BACKUP_ENV="${MOCHIRII_SOCIAL_BACKUP_ENV:-$RUNTIME_ROOT/shared/backup.env}"
RECIPIENT_FILE="${MOCHIRII_SOCIAL_BACKUP_RECIPIENT:-$RUNTIME_ROOT/shared/backup-recipient.pub}"
BACKUP_LOCK_FILE="${MOCHIRII_SOCIAL_BACKUP_LOCK:-/run/lock/mochirii-social-backup.lock}"
MARIADB_IMAGE="mariadb:11.4@sha256:a794d9eb009e20de605858a11f32f63b4075cbd197c650436f0e3b457e4caed7"
AGE_VERSION="v1.3.1"
RCLONE_VERSION="rclone v1.74.4"
RESTORE_TABLES=(users statuses media oauth_clients)

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "The production backup must run as root." >&2
  exit 1
fi

deploy_lock_held="${MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD:-0}"
[[ "$deploy_lock_held" == 0 || "$deploy_lock_held" == 1 ]] || {
  echo "MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD must be 0 or 1." >&2
  exit 1
}
if [[ "$deploy_lock_held" == 0 ]]; then
  install -d -m 0755 -o root -g root "$(dirname "$LOCK_FILE")"
  exec 8>"$LOCK_FILE"
  flock -n 8 || {
    echo "A Mochirii Social deployment or recovery operation is active." >&2
    exit 1
  }
fi
verify_installed_deploy_runtime_contract
reject_active_private_media_cutover_state "Backup"
reject_active_restore_state "Backup"
if [[ "${1:-}" == "--verify-cutover-guard" ]]; then
  [[ "$#" -eq 1 ]]
  echo "Backup cutover-state guard passed."
  exit 0
fi

label="${1:-nightly}"
[[ "$label" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || {
  echo "The backup label is invalid." >&2
  exit 1
}
verify_only=false
[[ "$label" == "verify-local" ]] && verify_only=true

for command_name in docker flock gzip od tar; do
  command -v "$command_name" >/dev/null || {
    echo "Missing backup dependency: $command_name" >&2
    exit 1
  }
done

if [[ "$verify_only" == false ]]; then
  for command_name in age rclone; do
    command -v "$command_name" >/dev/null || {
      echo "Missing backup dependency: $command_name" >&2
      exit 1
    }
  done
  age_version_output="$(age --version 2>/dev/null || true)"
  [[ "$age_version_output" == "$AGE_VERSION" ]] || {
    echo "The age version does not match the approved backup pin." >&2
    exit 1
  }
  rclone_version_output="$(rclone version 2>/dev/null || true)"
  [[ "${rclone_version_output%%$'\n'*}" == "$RCLONE_VERSION" ]] || {
    echo "The rclone version does not match the approved backup pin." >&2
    exit 1
  }
  verify_secure_backup_environment_file "$BACKUP_ENV"
  verify_secure_backup_recipient_file "$RECIPIENT_FILE"

  # The root-owned file is the sole authority for provider settings; ignore any
  # inherited process environment and give static analysis explicit defaults.
  BACKUP_S3_ACCESS_KEY_ID=""
  BACKUP_S3_SECRET_ACCESS_KEY=""
  BACKUP_S3_BUCKET=""
  BACKUP_S3_ENDPOINT=""
  BACKUP_S3_REGION=""
  set -a
  # shellcheck source=/dev/null
  source "$BACKUP_ENV"
  set +a

  required_variables=(
    BACKUP_S3_ACCESS_KEY_ID
    BACKUP_S3_SECRET_ACCESS_KEY
    BACKUP_S3_BUCKET
    BACKUP_S3_ENDPOINT
    BACKUP_S3_REGION
  )
  for variable_name in "${required_variables[@]}"; do
    [[ -n "${!variable_name:-}" ]] || {
      echo "Missing required backup setting: $variable_name" >&2
      exit 1
    }
  done
  [[ "$BACKUP_S3_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || {
    echo "The backup bucket name is invalid." >&2
    exit 1
  }
  [[ "$BACKUP_S3_ENDPOINT" =~ ^https://[a-z0-9-]+\.digitaloceanspaces\.com$ ]] || {
    echo "The backup endpoint is invalid." >&2
    exit 1
  }

  export RCLONE_CONFIG_MOCHIRII_BACKUP_TYPE=s3
  export RCLONE_CONFIG_MOCHIRII_BACKUP_PROVIDER=DigitalOcean
  export RCLONE_CONFIG_MOCHIRII_BACKUP_ENV_AUTH=false
  export RCLONE_CONFIG_MOCHIRII_BACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
  export RCLONE_CONFIG_MOCHIRII_BACKUP_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_MOCHIRII_BACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT"
  export RCLONE_CONFIG_MOCHIRII_BACKUP_REGION="$BACKUP_S3_REGION"
  remote_root="MOCHIRII_BACKUP:$BACKUP_S3_BUCKET"
fi

install -d -m 0700 -o root -g root "$BACKUP_ROOT" "$(dirname "$BACKUP_LOCK_FILE")"
exec 9>"$BACKUP_LOCK_FILE"
flock -n 9 || {
  echo "Another Mochirii Social backup is active." >&2
  exit 1
}

available_kib="$(df --output=avail "$BACKUP_ROOT" | tail -n 1 | tr -d ' ')"
[[ "$available_kib" =~ ^[0-9]+$ && "$available_kib" -ge 2097152 ]] || {
  echo "At least 2 GiB of free disk is required for backup validation." >&2
  exit 1
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
work_dir="$(mktemp -d "$BACKUP_ROOT/.work-${timestamp}.XXXXXX")"
restore_container="mochirii-backup-verify-${timestamp,,}-$$"

cleanup() {
  docker rm --force "$restore_container" >/dev/null 2>&1 || true
  if [[ "$work_dir" == "$BACKUP_ROOT/.work-"* ]]; then
    rm -rf -- "$work_dir"
  fi
}
trap cleanup EXIT

database_dump="$work_dir/database.sql.gz"
config_archive="$work_dir/configuration.tar.gz"
payload_archive="$work_dir/recovery.tar"
encrypted_archive="$work_dir/recovery.tar.age"

docker exec pixelfed-db sh -ec '
  MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump \
    --user=root \
    --single-transaction \
    --quick \
    --routines \
    --events \
    --triggers \
    --hex-blob \
    "$MARIADB_DATABASE"
' | gzip -9 >"$database_dump"
gzip -t "$database_dump"
[[ "$(stat -c '%s' "$database_dump")" -le "$RECOVERY_DATABASE_MAX_BYTES" ]] || {
  echo "The compressed database dump exceeds the 480 MiB recovery member limit." >&2
  exit 1
}
echo "Transactional database dump created."

restore_password="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
docker run \
  --detach \
  --rm \
  --name "$restore_container" \
  --network none \
  --memory 768m \
  --tmpfs /var/lib/mysql:rw,noexec,nosuid,size=640m \
  --env MARIADB_DATABASE=restore_check \
  --env MARIADB_ROOT_PASSWORD="$restore_password" \
  "$MARIADB_IMAGE" >/dev/null

restore_ready=false
for _ in {1..60}; do
  if docker exec \
    --env MYSQL_PWD="$restore_password" \
    "$restore_container" \
    mariadb \
      --user=root \
      --batch \
      --skip-column-names \
      --execute='SELECT 1;' >/dev/null 2>&1; then
    restore_ready=true
    break
  fi
  sleep 2
done
[[ "$restore_ready" == true ]] || {
  echo "The isolated restore database did not become ready." >&2
  exit 1
}
echo "Isolated restore database is ready."

gzip -dc "$database_dump" | docker exec \
  --interactive \
  --env MYSQL_PWD="$restore_password" \
  "$restore_container" \
  mariadb --user=root restore_check

read_source_count() {
  local table_name="$1"
  docker exec pixelfed-db sh -ec '
    MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb \
      --user=root \
      --batch \
      --skip-column-names \
      "$MARIADB_DATABASE" \
      --execute="$1"
  ' sh "SELECT COUNT(*) FROM \`$table_name\`;"
}

read_restore_count() {
  local table_name="$1"
  docker exec \
    --env MYSQL_PWD="$restore_password" \
    "$restore_container" \
    mariadb \
    --user=root \
    --batch \
    --skip-column-names \
    restore_check \
    --execute="SELECT COUNT(*) FROM \`$table_name\`;"
}

for table_name in "${RESTORE_TABLES[@]}"; do
  source_count="$(read_source_count "$table_name")"
  restore_count="$(read_restore_count "$table_name")"
  [[ "$source_count" =~ ^[0-9]+$ && "$source_count" == "$restore_count" ]] || {
    echo "Restore verification failed for a critical table." >&2
    exit 1
  }
done
docker rm --force "$restore_container" >/dev/null
echo "Critical table counts match the isolated restore."

if [[ "$verify_only" == true ]]; then
  echo "Transactional dump and isolated restore verification passed."
  exit 0
fi

release_dir="$(readlink -f "$RUNTIME_ROOT/current")"
[[ "$release_dir" == "$RUNTIME_ROOT/releases/"* ]] || {
  echo "The current release link is invalid." >&2
  exit 1
}
cutover_phase="$(private_media_cutover_phase)"
[[ "$cutover_phase" == absent || "$cutover_phase" == completed ]]
cutover_state_sha256=ABSENT
maintenance_proof_sha256=ABSENT
runtime_contract_file_sha256="$(sha256sum "$DEPLOY_RUNTIME_CONTRACT" | cut -d' ' -f1)"

config_files=(
  "${BACKUP_ENV#/}"
  "${RECIPIENT_FILE#/}"
  "${RUNTIME_ROOT#/}/shared/pixelfed.env"
  "${release_dir#/}/docker-compose.production.yml"
  "${release_dir#/}/release.env"
  "${release_dir#/}/release.meta"
  "etc/caddy/Caddyfile"
  "etc/ssh/sshd_config.d/99-mochirii-hardening.conf"
  "${DEPLOY_RUNTIME_CONTRACT#/}"
  "usr/local/lib/mochirii-social/production-runtime-lib.sh"
  "usr/local/sbin/mochirii-social-deploy"
  "usr/local/sbin/mochirii-social-backup"
  "usr/local/sbin/mochirii-social-restore"
  "usr/local/sbin/mochirii-social-deploy-entry"
)
if [[ -e "$PRIVATE_MEDIA_CUTOVER_STATE" || -L "$PRIVATE_MEDIA_CUTOVER_STATE" ]]; then
  require_root_owned_state_directory
  validate_private_media_cutover_state
  require_private_media_maintenance_proof
  [[ "$(cutover_state_value phase)" == "$cutover_phase" ]]
  [[ "$(cutover_state_value maintenance_proof_sha256)" == "$(private_media_maintenance_proof_sha256)" ]]
  cutover_state_sha256="$(sha256sum "$PRIVATE_MEDIA_CUTOVER_STATE" | cut -d' ' -f1)"
  maintenance_proof_sha256="$(sha256sum "$PRIVATE_MEDIA_MAINTENANCE_PROOF" | cut -d' ' -f1)"
  config_files+=(
    "${PRIVATE_MEDIA_CUTOVER_STATE#/}"
    "${PRIVATE_MEDIA_MAINTENANCE_PROOF#/}"
  )
fi
for optional_file in \
  etc/systemd/system/mochirii-social-backup.service \
  etc/systemd/system/mochirii-social-backup.timer; do
  if [[ -e "/$optional_file" || -L "/$optional_file" ]]; then
    [[ -f "/$optional_file" && ! -L "/$optional_file" ]] || {
      echo "Optional recovery configuration is not a regular file." >&2
      exit 1
    }
    config_files+=("$optional_file")
  fi
done
for relative_file in "${config_files[@]}"; do
  [[ -f "/$relative_file" && ! -L "/$relative_file" ]] || {
    echo "Required recovery configuration is missing or unsafe." >&2
    exit 1
  }
done
tar \
  --create \
  --gzip \
  --file "$config_archive" \
  --directory / \
  --owner 0 \
  --group 0 \
  --numeric-owner \
  "${config_files[@]}"
[[ "$(stat -c '%s' "$config_archive")" -le "$RECOVERY_CONFIGURATION_MAX_BYTES" ]] || {
  echo "The compressed recovery configuration exceeds the 16 MiB member limit." >&2
  exit 1
}

release_commit="$(awk -F= '$1 == "commit" { print $2 }' "$release_dir/release.meta")"
release_digest="$(awk -F= '$1 == "digest" { print $2 }' "$release_dir/release.meta")"
[[ "$release_commit" =~ ^[0-9a-f]{40}$ && "$release_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "The release metadata is invalid." >&2
  exit 1
}
validate_recovery_configuration_archive \
  "$config_archive" \
  "${RUNTIME_ROOT#/}" \
  "$release_commit" \
  2
database_sha256="$(sha256sum "$database_dump" | cut -d' ' -f1)"
configuration_sha256="$(sha256sum "$config_archive" | cut -d' ' -f1)"
cat >"$work_dir/manifest" <<EOF
format=2
created_utc=$timestamp
release_commit=$release_commit
release_digest=$release_digest
database_sha256=$database_sha256
configuration_sha256=$configuration_sha256
cutover_phase=$cutover_phase
cutover_state_sha256=$cutover_state_sha256
maintenance_proof_sha256=$maintenance_proof_sha256
deploy_runtime_contract_file_sha256=$runtime_contract_file_sha256
EOF
[[ "$(stat -c '%s' "$work_dir/manifest")" -le "$RECOVERY_MANIFEST_MAX_BYTES" ]] || {
  echo "The recovery manifest exceeds its bounded member limit." >&2
  exit 1
}
tar \
  --create \
  --file "$payload_archive" \
  --directory "$work_dir" \
  database.sql.gz configuration.tar.gz manifest
[[ "$(stat -c '%s' "$payload_archive")" -le "$RECOVERY_PAYLOAD_MAX_BYTES" ]] || {
  echo "The recovery payload exceeds the 512 MiB transport limit." >&2
  exit 1
}
payload_validation_root="$work_dir/payload-validation"
install -d -m 0700 "$payload_validation_root"
extract_validated_recovery_payload "$payload_archive" "$payload_validation_root"
validate_recovery_payload_manifest \
  "$payload_validation_root" \
  "$payload_validation_root/validated.manifest"
install -d -m 0700 "$payload_validation_root/configuration"
validate_recovery_configuration_archive \
  "$payload_validation_root/configuration.tar.gz" \
  "${RUNTIME_ROOT#/}" \
  "$release_commit" \
  2 \
  "$payload_validation_root/configuration"
validate_recovery_configuration_bindings \
  "$payload_validation_root/configuration" \
  "$payload_validation_root/validated.manifest" \
  "${RUNTIME_ROOT#/}"
rm -rf -- "$payload_validation_root"
age \
  --encrypt \
  --recipients-file "$RECIPIENT_FILE" \
  --output "$encrypted_archive" \
  "$payload_archive"
verify_bounded_encrypted_recovery_file "$encrypted_archive"
rm -f "$database_dump" "$config_archive" "$payload_archive" "$work_dir/manifest"

upload_object() {
  local retention_class="$1"
  local object_name="$2"
  rclone \
    --config /dev/null \
    --quiet \
    copyto \
    --s3-acl private \
    --s3-no-check-bucket \
    "$encrypted_archive" \
    "$remote_root/$retention_class/$object_name" || return 1
  rclone \
    --config /dev/null \
    --quiet \
    lsf \
    --files-only \
    "$remote_root/$retention_class" \
    | grep -Fxq "$object_name" || return 1
}

prune_retention() {
  local retention_class="$1"
  local keep_count="$2"
  local object_name
  local index
  local object_listing
  object_listing="$(rclone \
      --config /dev/null \
      lsf \
      --files-only \
      "$remote_root/$retention_class" \
      | LC_ALL=C sort -r)" || return 1
  mapfile -t objects <<<"$object_listing" || return 1
  for ((index = keep_count; index < ${#objects[@]}; index++)); do
    object_name="${objects[$index]}"
    [[ "$object_name" =~ ^[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]+\.tar\.age$ ]] || {
      echo "Refusing to prune an unexpected backup object name." >&2
      exit 1
    }
    rclone \
      --config /dev/null \
      --quiet \
      deletefile "$remote_root/$retention_class/$object_name" || return 1
  done
}

object_name="$timestamp-$label.tar.age"
if [[ "$label" == "nightly" ]]; then
  upload_object daily "$object_name"
  if [[ "$(date -u +%u)" == "7" ]]; then
    upload_object weekly "$object_name"
  fi
  if [[ "$(date -u +%d)" == "01" ]]; then
    upload_object monthly "$object_name"
  fi
  prune_retention daily 14
  prune_retention weekly 8
  prune_retention monthly 6
  echo "Verified encrypted nightly recovery point uploaded."
else
  upload_object manual "$object_name"
  prune_retention manual 8
  echo "Verified encrypted manual recovery point uploaded."
fi
