#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f /usr/local/lib/mochirii-social/production-runtime-lib.sh ]]; then
  # shellcheck source=/dev/null
  source /usr/local/lib/mochirii-social/production-runtime-lib.sh
else
  # shellcheck source=production-runtime-lib.sh
  source "$script_dir/production-runtime-lib.sh"
fi

require_root
umask 077

BACKUP_ROOT="$RUNTIME_ROOT/backups"

payload_path="${1:-}"
confirmation="${2:-}"
[[ "$confirmation" == "RESTORE_social.mochirii.com" ]] || {
  echo "The production restore confirmation is invalid." >&2
  exit 1
}
[[ -f "$payload_path" ]] || {
  echo "The recovery payload is missing." >&2
  exit 1
}

mkdir -p "$(dirname "$LOCK_FILE")" "$BACKUP_ROOT"
exec 9>"$LOCK_FILE"
flock -n 9 || {
  echo "Another Mochirii Social deployment or restore is active." >&2
  exit 1
}
verify_installed_deploy_runtime_contract
reject_active_private_media_cutover_state "Production restore"

stage_dir="$(mktemp -d "$BACKUP_ROOT/.restore.XXXXXX")"
cleanup() {
  if [[ "$stage_dir" == "$BACKUP_ROOT/.restore."* ]]; then
    rm -rf -- "$stage_dir"
  fi
  rm -f "$payload_path"
}

restore_mutation_armed=false
restore_failure_handled=false
restore_fail_closed_once() {
  local close_failed=false
  [[ "$restore_mutation_armed" == true && "$restore_failure_handled" == false ]] || return 0
  restore_failure_handled=true
  if ! enforce_fail_closed_runtime "$current_release" restore; then
    close_failed=true
  fi
  write_restore_state \
    recovery_required \
    "$restore_operation_id" \
    "$restore_release_commit" \
    "$restore_release_digest" \
    "$restore_database_sha256" \
    "$restore_configuration_sha256" \
    "$restore_started_utc" \
    NONE || close_failed=true
  if [[ "$close_failed" == true ]]; then
    echo "The database restore failed and the closed application boundary could not be fully proven; operator recovery is required." >&2
  else
    echo "The database restore failed; the application and workers remain closed for operator recovery." >&2
  fi
}

restore_exit_handler() {
  local exit_code=$?
  trap - EXIT HUP INT TERM
  set +e
  if [[ "$exit_code" -ne 0 ]]; then
    restore_fail_closed_once
  fi
  cleanup
  exit "$exit_code"
}
trap restore_exit_handler EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

extract_validated_recovery_payload "$payload_path" "$stage_dir"
validated_manifest="$stage_dir/validated.manifest"
validate_recovery_payload_manifest "$stage_dir" "$validated_manifest"
restore_manifest_format="$(sed -n 's/^format=//p' "$validated_manifest")"
[[ "$restore_manifest_format" == 1 || "$restore_manifest_format" == 2 ]]
restore_release_commit="$(sed -n 's/^release_commit=//p' "$validated_manifest")"
restore_release_digest="$(sed -n 's/^release_digest=//p' "$validated_manifest")"
restore_database_sha256="$(sed -n 's/^database_sha256=//p' "$validated_manifest")"
restore_configuration_sha256="$(sed -n 's/^configuration_sha256=//p' "$validated_manifest")"

configuration_root="$stage_dir/configuration"
mkdir -m 0700 "$configuration_root"
validate_recovery_configuration_archive \
  "$stage_dir/configuration.tar.gz" \
  "${RUNTIME_ROOT#/}" \
  "$restore_release_commit" \
  "$restore_manifest_format" \
  "$configuration_root"
validate_recovery_configuration_bindings \
  "$configuration_root" \
  "$validated_manifest" \
  "${RUNTIME_ROOT#/}"

restore_phase="$(restore_state_phase)"
case "$restore_phase" in
  intent | recovery_required)
    [[ "$(restore_state_value release_commit)" == "$restore_release_commit" ]]
    [[ "$(restore_state_value release_digest)" == "$restore_release_digest" ]]
    [[ "$(restore_state_value database_sha256)" == "$restore_database_sha256" ]]
    [[ "$(restore_state_value configuration_sha256)" == "$restore_configuration_sha256" ]]
    restore_operation_id="$(restore_state_value operation_id)"
    restore_started_utc="$(restore_state_value started_utc)"
    ;;
  absent | completed)
    MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD=1 \
      /usr/local/sbin/mochirii-social-backup "pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
    restore_operation_id="$(tr '[:upper:]' '[:lower:]' </proc/sys/kernel/random/uuid)"
    validate_operation_id "$restore_operation_id"
    restore_started_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    ;;
esac
current_release="$(readlink -f "$CURRENT_LINK")"
compose_release "$current_release" config --quiet
write_restore_state \
  intent \
  "$restore_operation_id" \
  "$restore_release_commit" \
  "$restore_release_digest" \
  "$restore_database_sha256" \
  "$restore_configuration_sha256" \
  "$restore_started_utc" \
  NONE
restore_mutation_armed=true
docker exec pixelfed-app php artisan down --retry=60 --no-ansi
compose_release "$current_release" stop horizon scheduler pixelfed

docker exec pixelfed-db sh -ec '
  MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb --user=root --execute="
    DROP DATABASE IF EXISTS \`$MARIADB_DATABASE\`;
    CREATE DATABASE \`$MARIADB_DATABASE\`
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  "
'
gzip -dc "$stage_dir/database.sql.gz" | docker exec \
  --interactive \
  pixelfed-db sh -ec '
    MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb --user=root "$MARIADB_DATABASE"
  '

for table_name in users statuses media oauth_clients; do
  docker exec pixelfed-db sh -ec '
    MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb \
      --user=root \
      --batch \
      --skip-column-names \
      "$MARIADB_DATABASE" \
      --execute="$1"
  ' sh "SELECT COUNT(*) FROM \`$table_name\`;" >/dev/null
done

compose_release "$current_release" up --detach --no-build pixelfed
wait_for_container_running pixelfed-app 120
docker exec pixelfed-app php artisan optimize:clear --no-ansi >/dev/null
docker exec pixelfed-app php artisan up --no-ansi
current_digest="$(release_metadata_value "$current_release" digest)"
validate_digest "$current_digest"
verify_permanent_private_media_runtime_local "$current_digest"
verify_permanent_private_media_runtime "$current_digest"
compose_release "$current_release" up --detach --no-build --no-deps horizon scheduler
verify_runtime
verify_exact_runtime_images "$current_digest"
verify_permanent_private_media_runtime "$current_digest"
write_restore_state \
  completed \
  "$restore_operation_id" \
  "$restore_release_commit" \
  "$restore_release_digest" \
  "$restore_database_sha256" \
  "$restore_configuration_sha256" \
  "$restore_started_utc" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
restore_mutation_armed=false

echo "Production database restore completed and runtime gates passed."
