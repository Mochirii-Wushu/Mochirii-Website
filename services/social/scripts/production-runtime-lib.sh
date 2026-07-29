#!/usr/bin/env bash

set -Eeuo pipefail

RUNTIME_ROOT="${MOCHIRII_SOCIAL_ROOT:-/opt/mochirii-social}"
RELEASES_ROOT="$RUNTIME_ROOT/releases"
SHARED_ROOT="$RUNTIME_ROOT/shared"
# Consumed by deploy scripts after sourcing this library.
# shellcheck disable=SC2034
DATA_ROOT="$RUNTIME_ROOT/data"
CURRENT_LINK="$RUNTIME_ROOT/current"
# Consumed by deploy and backup scripts after sourcing this library.
# shellcheck disable=SC2034
LOCK_FILE="${MOCHIRII_SOCIAL_LOCK:-/run/lock/mochirii-social-deploy.lock}"
REGISTRY_IMAGE="ghcr.io/mochirii-wushu/mochirii-pixelfed-ops"
PULL_USER="${MOCHIRII_SOCIAL_PULL_USER:-mochirii}"
PRIVATE_MEDIA_STATE_ROOT="$SHARED_ROOT/private-media-cutover"
PRIVATE_MEDIA_MAINTENANCE_PROOF="$PRIVATE_MEDIA_STATE_ROOT/maintenance.proof"
PRIVATE_MEDIA_CUTOVER_STATE="$PRIVATE_MEDIA_STATE_ROOT/cutover.state"
DEPLOY_RUNTIME_CONTRACT="${MOCHIRII_SOCIAL_DEPLOY_RUNTIME_CONTRACT:-/usr/local/lib/mochirii-social/deploy-runtime.contract}"
RESTORE_STATE_ROOT="$SHARED_ROOT/restore-recovery"
RESTORE_STATE="$RESTORE_STATE_ROOT/restore.state"
RECOVERY_PAYLOAD_MAX_BYTES=536870912
RECOVERY_ENCRYPTED_MAX_BYTES=537919488
RECOVERY_DATABASE_MAX_BYTES=503316480
RECOVERY_CONFIGURATION_MAX_BYTES=16777216
RECOVERY_MANIFEST_MAX_BYTES=4096

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "This operation must run as root." >&2
    exit 1
  fi
}

validate_commit() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || {
    echo "The release commit must be a full lowercase Git SHA." >&2
    exit 1
  }
}

validate_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "The release image must use a sha256 digest." >&2
    exit 1
  }
}

validate_operation_id() {
  [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || {
    echo "The private-media operation ID must be a canonical lowercase UUIDv4." >&2
    return 1
  }
}

validate_sha256() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]] || {
    echo "The expected SHA-256 value is invalid." >&2
    return 1
  }
}

require_root_owned_state_directory() {
  [[ -d "$PRIVATE_MEDIA_STATE_ROOT" && ! -L "$PRIVATE_MEDIA_STATE_ROOT" ]] || {
    echo "The root-owned private-media state directory is missing." >&2
    return 1
  }
  [[ "$(stat -c '%U:%G:%a' "$PRIVATE_MEDIA_STATE_ROOT")" == "root:root:700" ]] || {
    echo "The private-media state directory must be root:root mode 0700." >&2
    return 1
  }
}

require_root_owned_mode_0600_file() {
  local file_path="$1"
  local label="$2"

  [[ -f "$file_path" && ! -L "$file_path" ]] || {
    echo "$label is missing or is not a regular file." >&2
    return 1
  }
  [[ "$(stat -c '%U:%G:%a' "$file_path")" == "root:root:600" ]] || {
    echo "$label must be root:root mode 0600." >&2
    return 1
  }
}

require_private_media_maintenance_proof() {
  require_root_owned_state_directory || return 1
  require_root_owned_mode_0600_file \
    "$PRIVATE_MEDIA_MAINTENANCE_PROOF" \
    "The private-media maintenance proof" || return 1

  local expected
  expected="$(printf '%s\n' \
    'version=1' \
    'state=stage-authorized' \
    'hostname=social.mochirii.com' \
    'expected_status=503')"
  [[ "$(cat "$PRIVATE_MEDIA_MAINTENANCE_PROOF")" == "$expected" ]] || {
    echo "The private-media maintenance proof has unexpected content." >&2
    return 1
  }
}

private_media_maintenance_proof_sha256() {
  require_private_media_maintenance_proof || return 1
  sha256sum "$PRIVATE_MEDIA_MAINTENANCE_PROOF" | awk '{ print $1 }' || return 1
}

fsync_path() {
  local target_path="$1"
  python3 - "$target_path" <<'PY'
import os
import sys

path = sys.argv[1]
flags = os.O_RDONLY
if os.path.isdir(path):
    flags |= getattr(os, "O_DIRECTORY", 0)
descriptor = os.open(path, flags)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
}

private_media_cutover_phase() {
  if [[ ! -e "$PRIVATE_MEDIA_CUTOVER_STATE" && ! -L "$PRIVATE_MEDIA_CUTOVER_STATE" ]]; then
    printf '%s\n' absent
    return 0
  fi
  validate_private_media_cutover_state || return 1
  cutover_state_value phase || return 1
}

validate_private_media_cutover_state() {
  local expected_operation_id="${1:-}"
  local expected_commit="${2:-}"
  local expected_digest="${3:-}"
  local expected_migration_tree="${4:-}"
  local -a lines

  require_root_owned_mode_0600_file "$PRIVATE_MEDIA_CUTOVER_STATE" "The private-media cutover state" || return 1
  mapfile -t lines <"$PRIVATE_MEDIA_CUTOVER_STATE" || return 1
  [[ "${#lines[@]}" -eq 14 ]] || {
    echo "The private-media cutover state has an unexpected field count." >&2
    return 1
  }
  [[ "${lines[0]}" == "version=2" ]] || return 1
  [[ "${lines[1]}" =~ ^phase=(absent|intent|staged|finalizing|completed|recovery_required)$ ]] || return 1
  [[ "${lines[2]}" =~ ^operation_id=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$ ]] || return 1
  local state_operation_id="${BASH_REMATCH[1]}"
  [[ "${lines[3]}" =~ ^commit=([0-9a-f]{40})$ ]] || return 1
  local state_commit="${BASH_REMATCH[1]}"
  [[ "${lines[4]}" =~ ^digest=(sha256:[0-9a-f]{64})$ ]] || return 1
  local state_digest="${BASH_REMATCH[1]}"
  [[ "${lines[5]}" =~ ^previous_commit=([0-9a-f]{40})$ ]] || return 1
  [[ "${lines[6]}" =~ ^previous_digest=sha256:[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[7]}" =~ ^horizon_state=(running|stopped)$ ]] || return 1
  [[ "${lines[8]}" =~ ^scheduler_state=(running|stopped)$ ]] || return 1
  [[ "${lines[9]}" =~ ^laravel_maintenance_state=(up|down)$ ]] || return 1
  [[ "${lines[10]}" =~ ^maintenance_proof_sha256=([0-9a-f]{64})$ ]] || return 1
  [[ "${lines[11]}" =~ ^runtime_contract_sha256=([0-9a-f]{64})$ ]] || return 1
  [[ "${lines[12]}" =~ ^migration_tree_sha256=([0-9a-f]{64})$ ]] || return 1
  local state_migration_tree="${BASH_REMATCH[1]}"
  [[ "${lines[13]}" =~ ^retired_operation_ids=($|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})*)$ ]] || return 1

  [[ -z "$expected_operation_id" || "$state_operation_id" == "$expected_operation_id" ]] || {
    echo "The private-media cutover state is bound to a different operation." >&2
    return 1
  }
  [[ -z "$expected_commit" || "$state_commit" == "$expected_commit" ]] || {
    echo "The private-media cutover state is bound to a different commit." >&2
    return 1
  }
  [[ -z "$expected_digest" || "$state_digest" == "$expected_digest" ]] || {
    echo "The private-media cutover state is bound to a different image digest." >&2
    return 1
  }
  [[ -z "$expected_migration_tree" || "$state_migration_tree" == "$expected_migration_tree" ]] || {
    echo "The private-media cutover state is bound to a different migration tree." >&2
    return 1
  }
}

cutover_state_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$PRIVATE_MEDIA_CUTOVER_STATE" || return 1
}

write_private_media_cutover_state() {
  local phase="$1"
  local operation_id="$2"
  local commit="$3"
  local digest="$4"
  local previous_commit="$5"
  local previous_digest="$6"
  local horizon_state="$7"
  local scheduler_state="$8"
  local laravel_state="$9"
  local maintenance_proof_sha256="${10}"
  local runtime_contract_sha256="${11}"
  local migration_tree_sha256="${12}"
  local retired_operation_ids="${13:-}"
  local candidate

  candidate="$(mktemp "$PRIVATE_MEDIA_STATE_ROOT/.cutover.state.XXXXXX")" || return 1
  {
    printf '%s\n' \
      'version=2' \
      "phase=$phase" \
      "operation_id=$operation_id" \
      "commit=$commit" \
      "digest=$digest" \
      "previous_commit=$previous_commit" \
      "previous_digest=$previous_digest" \
      "horizon_state=$horizon_state" \
      "scheduler_state=$scheduler_state" \
      "laravel_maintenance_state=$laravel_state" \
      "maintenance_proof_sha256=$maintenance_proof_sha256" \
      "runtime_contract_sha256=$runtime_contract_sha256" \
      "migration_tree_sha256=$migration_tree_sha256" \
      "retired_operation_ids=$retired_operation_ids"
  } >"$candidate" || return 1
  chown root:root "$candidate" || return 1
  chmod 0600 "$candidate" || return 1
  fsync_path "$candidate" || return 1
  mv -T "$candidate" "$PRIVATE_MEDIA_CUTOVER_STATE" || return 1
  fsync_path "$PRIVATE_MEDIA_STATE_ROOT" || return 1
  validate_private_media_cutover_state "$operation_id" "$commit" "$digest" "$migration_tree_sha256" || return 1
}

transition_private_media_cutover_phase() {
  local expected_phase="$1"
  local next_phase="$2"
  local operation_id commit digest previous_commit previous_digest horizon_state
  local scheduler_state laravel_state proof_sha256 contract_sha256 migration_tree_sha256 retired_ids
  validate_private_media_cutover_state || return 1
  local current_phase
  current_phase="$(cutover_state_value phase)" || return 1
  [[ "$current_phase" == "$expected_phase" ]] || {
    echo "The private-media cutover phase changed unexpectedly." >&2
    return 1
  }
  operation_id="$(cutover_state_value operation_id)" || return 1
  commit="$(cutover_state_value commit)" || return 1
  digest="$(cutover_state_value digest)" || return 1
  previous_commit="$(cutover_state_value previous_commit)" || return 1
  previous_digest="$(cutover_state_value previous_digest)" || return 1
  horizon_state="$(cutover_state_value horizon_state)" || return 1
  scheduler_state="$(cutover_state_value scheduler_state)" || return 1
  laravel_state="$(cutover_state_value laravel_maintenance_state)" || return 1
  proof_sha256="$(cutover_state_value maintenance_proof_sha256)" || return 1
  contract_sha256="$(cutover_state_value runtime_contract_sha256)" || return 1
  migration_tree_sha256="$(cutover_state_value migration_tree_sha256)" || return 1
  retired_ids="$(cutover_state_value retired_operation_ids)" || return 1
  write_private_media_cutover_state \
    "$next_phase" \
    "$operation_id" "$commit" "$digest" "$previous_commit" "$previous_digest" \
    "$horizon_state" "$scheduler_state" "$laravel_state" "$proof_sha256" \
    "$contract_sha256" "$migration_tree_sha256" "$retired_ids" || return 1
}

private_media_operation_is_retired() {
  local operation_id="$1"
  local retired_operation_ids=""
  validate_operation_id "$operation_id" || return 2
  if [[ -e "$PRIVATE_MEDIA_CUTOVER_STATE" || -L "$PRIVATE_MEDIA_CUTOVER_STATE" ]]; then
    validate_private_media_cutover_state || return 2
    retired_operation_ids="$(cutover_state_value retired_operation_ids)" || return 2
  fi
  [[ ",$retired_operation_ids," == *",$operation_id,"* ]] && return 0
  return 1
}

assert_private_media_operation_available() {
  local operation_id="$1"
  local retired_status
  if private_media_operation_is_retired "$operation_id"; then
    echo "The private-media operation ID has already been consumed." >&2
    return 1
  else
    retired_status=$?
  fi
  if [[ "$retired_status" -ne 1 ]]; then
    echo "The private-media operation state could not be validated." >&2
    return 1
  fi
  return 0
}

retire_recovered_private_media_cutover_intent() {
  validate_private_media_cutover_state || return 1
  local phase
  phase="$(cutover_state_value phase)" || return 1
  [[ "$phase" == "intent" ]] || {
    echo "Only a recovered intent may be retired automatically." >&2
    return 1
  }
  local operation_id
  local retired_operation_ids
  operation_id="$(cutover_state_value operation_id)" || return 1
  retired_operation_ids="$(cutover_state_value retired_operation_ids)" || return 1
  if [[ -n "$retired_operation_ids" ]]; then
    retired_operation_ids+=",$operation_id"
  else
    retired_operation_ids="$operation_id"
  fi
  local commit digest previous_commit previous_digest horizon_state scheduler_state
  local laravel_state proof_sha256 contract_sha256 migration_tree_sha256
  commit="$(cutover_state_value commit)" || return 1
  digest="$(cutover_state_value digest)" || return 1
  previous_commit="$(cutover_state_value previous_commit)" || return 1
  previous_digest="$(cutover_state_value previous_digest)" || return 1
  horizon_state="$(cutover_state_value horizon_state)" || return 1
  scheduler_state="$(cutover_state_value scheduler_state)" || return 1
  laravel_state="$(cutover_state_value laravel_maintenance_state)" || return 1
  proof_sha256="$(cutover_state_value maintenance_proof_sha256)" || return 1
  contract_sha256="$(cutover_state_value runtime_contract_sha256)" || return 1
  migration_tree_sha256="$(cutover_state_value migration_tree_sha256)" || return 1
  write_private_media_cutover_state \
    absent \
    "$operation_id" \
    "$commit" "$digest" "$previous_commit" "$previous_digest" \
    "$horizon_state" "$scheduler_state" "$laravel_state" "$proof_sha256" \
    "$contract_sha256" "$migration_tree_sha256" "$retired_operation_ids" || return 1
}

reject_active_private_media_cutover_state() {
  local operation_label="$1"
  local phase
  phase="$(private_media_cutover_phase)" || return 1
  case "$phase" in
    absent | completed)
      return 0
      ;;
    intent | staged | finalizing | recovery_required)
      echo "$operation_label is blocked while private-media cutover phase $phase is active." >&2
      return 1
      ;;
    *)
      echo "The private-media cutover phase is unsupported." >&2
      return 1
      ;;
  esac
}

ensure_root_owned_restore_state_directory() {
  if [[ ! -e "$RESTORE_STATE_ROOT" && ! -L "$RESTORE_STATE_ROOT" ]]; then
    install -d -m 0700 -o root -g root "$RESTORE_STATE_ROOT" || return 1
    fsync_path "$SHARED_ROOT" || return 1
  fi
  [[ -d "$RESTORE_STATE_ROOT" && ! -L "$RESTORE_STATE_ROOT" ]] || {
    echo "The restore-recovery state directory is invalid." >&2
    return 1
  }
  [[ "$(stat -c '%U:%G:%a' "$RESTORE_STATE_ROOT")" == root:root:700 ]] || {
    echo "The restore-recovery state directory must be root:root mode 0700." >&2
    return 1
  }
}

validate_restore_state() {
  local -a lines
  ensure_root_owned_restore_state_directory || return 1
  require_root_owned_mode_0600_file "$RESTORE_STATE" "The restore-recovery state" || return 1
  mapfile -t lines <"$RESTORE_STATE" || return 1
  [[ "${#lines[@]}" -eq 9 ]] || return 1
  [[ "${lines[0]}" == version=1 ]] || return 1
  [[ "${lines[1]}" =~ ^phase=(intent|recovery_required|completed)$ ]] || return 1
  [[ "${lines[2]}" =~ ^operation_id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || return 1
  [[ "${lines[3]}" =~ ^release_commit=[0-9a-f]{40}$ ]] || return 1
  [[ "${lines[4]}" =~ ^release_digest=sha256:[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[5]}" =~ ^database_sha256=[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[6]}" =~ ^configuration_sha256=[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[7]}" =~ ^started_utc=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1
  [[ "${lines[8]}" =~ ^completed_utc=(NONE|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)$ ]] || return 1
}

restore_state_value() {
  sed -n "s/^$1=//p" "$RESTORE_STATE" || return 1
}

restore_state_phase() {
  if [[ ! -e "$RESTORE_STATE" && ! -L "$RESTORE_STATE" ]]; then
    printf '%s\n' absent
    return 0
  fi
  validate_restore_state || return 1
  restore_state_value phase || return 1
}

write_restore_state() {
  local phase="$1"
  local operation_id="$2"
  local release_commit="$3"
  local release_digest="$4"
  local database_sha256="$5"
  local configuration_sha256="$6"
  local started_utc="$7"
  local completed_utc="$8"
  local candidate
  ensure_root_owned_restore_state_directory || return 1
  candidate="$(mktemp "$RESTORE_STATE_ROOT/.restore.state.XXXXXX")" || return 1
  printf '%s\n' \
    version=1 \
    "phase=$phase" \
    "operation_id=$operation_id" \
    "release_commit=$release_commit" \
    "release_digest=$release_digest" \
    "database_sha256=$database_sha256" \
    "configuration_sha256=$configuration_sha256" \
    "started_utc=$started_utc" \
    "completed_utc=$completed_utc" >"$candidate" || return 1
  chown root:root "$candidate" || return 1
  chmod 0600 "$candidate" || return 1
  fsync_path "$candidate" || return 1
  mv -T "$candidate" "$RESTORE_STATE" || return 1
  fsync_path "$RESTORE_STATE_ROOT" || return 1
  validate_restore_state || return 1
}

reject_active_restore_state() {
  local operation_label="$1"
  local phase
  phase="$(restore_state_phase)" || return 1
  case "$phase" in
    absent | completed) return 0 ;;
    intent | recovery_required)
      echo "$operation_label is blocked by durable restore-recovery phase $phase." >&2
      return 1
      ;;
    *)
      echo "The restore-recovery phase is unsupported." >&2
      return 1
      ;;
  esac
}

verify_installed_deploy_runtime_contract() {
  local expected_contract_sha256="${1:-}"
  local -a lines
  local -a expected_paths=(
    /usr/local/lib/mochirii-social/production-runtime-lib.sh
    /usr/local/sbin/mochirii-social-deploy
    /usr/local/sbin/mochirii-social-backup
    /usr/local/sbin/mochirii-social-restore
    /usr/local/sbin/mochirii-social-deploy-entry
  )
  local -a expected_modes=(644 755 755 755 755)
  local index
  local manifest_path

  [[ -f "$DEPLOY_RUNTIME_CONTRACT" && ! -L "$DEPLOY_RUNTIME_CONTRACT" ]] || {
    echo "The installed deployment-runtime contract is missing." >&2
    return 1
  }
  [[ "$(stat -c '%U:%G:%a' "$DEPLOY_RUNTIME_CONTRACT")" == "root:root:444" ]] || {
    echo "The installed deployment-runtime contract must be root:root mode 0444." >&2
    return 1
  }
  mapfile -t lines <"$DEPLOY_RUNTIME_CONTRACT" || return 1
  [[ "${#lines[@]}" -eq 8 && "${lines[0]}" == "version=2" ]] || return 1
  [[ "${lines[1]}" =~ ^installed_from_commit=[0-9a-f]{40}$ ]] || return 1
  [[ "${lines[2]}" =~ ^contract_sha256=([0-9a-f]{64})$ ]] || return 1
  local recorded_contract_sha256="${BASH_REMATCH[1]}"
  local calculated_contract_sha256
  calculated_contract_sha256="$(printf '%s\n' "${lines[@]:3}" | sha256sum | awk '{ print $1 }')" || return 1
  [[ "$calculated_contract_sha256" == "$recorded_contract_sha256" ]] || {
    echo "The installed deployment-runtime contract digest is inconsistent." >&2
    return 1
  }
  [[ -z "$expected_contract_sha256" || "$recorded_contract_sha256" == "$expected_contract_sha256" ]] || {
    echo "The installed deployment runtime does not match the release contract." >&2
    return 1
  }
  for index in "${!expected_paths[@]}"; do
    [[ "${lines[$((index + 3))]}" =~ ^[0-9a-f]{64}\ \ (/.+)$ ]] || {
      echo "The installed deployment-runtime manifest is malformed." >&2
      return 1
    }
    manifest_path="${BASH_REMATCH[1]}"
    [[ "$manifest_path" == "${expected_paths[$index]}" ]] || {
      echo "The installed deployment-runtime manifest has an unexpected target." >&2
      return 1
    }
    [[ -f "$manifest_path" && ! -L "$manifest_path" ]] || {
      echo "An installed deployment-runtime target is not a regular file." >&2
      return 1
    }
    [[ "$(stat -c '%U:%G:%a' "$manifest_path")" == "root:root:${expected_modes[$index]}" ]] || {
      echo "An installed deployment-runtime target has unsafe ownership or mode." >&2
      return 1
    }
  done
  printf '%s\n' "${lines[@]:3}" | sha256sum --check --strict --status
}

installed_deploy_runtime_contract_sha256() {
  verify_installed_deploy_runtime_contract "${1:-}" || return 1
  sed -n 's/^contract_sha256=//p' "$DEPLOY_RUNTIME_CONTRACT" || return 1
}

verify_controlled_public_response() {
  local method="$1"
  local url="$2"
  local expected_status="$3"
  local require_empty="$4"
  local maximum_size="$5"
  local cache_policy="${6:-no-store}"
  local headers
  local result
  local -a method_args
  headers="$(mktemp)" || return 1
  method_args=(--request "$method")
  if [[ "$method" == "HEAD" ]]; then
    method_args=(--head)
  fi

  result="$(curl \
    --silent \
    --show-error \
    --max-time 20 \
    --max-redirs 0 \
    "${method_args[@]}" \
    --dump-header "$headers" \
    --output /dev/null \
    --write-out '%{http_code}:%{size_download}' \
    "$url")" || {
      rm -f "$headers"
      echo "A controlled public boundary request failed." >&2
      return 1
    }

  local status="${result%%:*}"
  local size="${result#*:}"
  [[ "$status" == "$expected_status" ]] || {
    rm -f "$headers"
    echo "A controlled public boundary returned HTTP $status instead of $expected_status." >&2
    return 1
  }
  [[ "$require_empty" == false || "$size" == "0" ]] || {
    rm -f "$headers"
    echo "A controlled public denial returned a response body." >&2
    return 1
  }
  [[ "$size" =~ ^[0-9]+$ && "$size" -le "$maximum_size" ]] || {
    rm -f "$headers"
    echo "A controlled public boundary exceeded its response-size limit." >&2
    return 1
  }
  if grep -Eiq '^(location|set-cookie):' "$headers"; then
    rm -f "$headers"
    echo "A controlled public boundary returned a redirect or cookie." >&2
    return 1
  fi
  local cache_control
  local normalized_cache_control
  cache_control="$(awk '
    BEGIN { IGNORECASE = 1; combined = "" }
    /^cache-control:/ {
      sub(/^[^:]+:[[:space:]]*/, "")
      sub(/\r$/, "")
      combined = combined (combined == "" ? "" : ",") $0
    }
    END { print tolower(combined) }
  ' "$headers")" || return 1
  normalized_cache_control="$(printf '%s' "$cache_control" | tr ';' ',' | tr -d '[:space:]')" || return 1
  if [[ -z "$normalized_cache_control" ]] || \
    [[ ",$normalized_cache_control," =~ ,public, ]] || \
    [[ ",$normalized_cache_control," =~ ,immutable, ]] || \
    [[ ",$normalized_cache_control," =~ ,(max-age|s-maxage)=[1-9][0-9]*, ]]; then
    rm -f "$headers"
    echo "A controlled public boundary returned a cacheable policy." >&2
    return 1
  fi
  case "$cache_policy" in
    no-store)
      if ! [[ ",$normalized_cache_control," =~ ,no-store, ]]; then
        rm -f "$headers"
        echo "A controlled public boundary must be no-store." >&2
        return 1
      fi
      ;;
    private-no-cache)
      if ! [[ ",$normalized_cache_control," =~ ,(no-store|no-cache), ]] || \
        ! [[ ",$normalized_cache_control," =~ ,(private|no-store), ]]; then
        rm -f "$headers"
        echo "The private gateway denial must be private and non-cacheable." >&2
        return 1
      fi
      ;;
    private-no-store)
      if ! [[ ",$normalized_cache_control," =~ ,no-store, ]] || \
        ! [[ ",$normalized_cache_control," =~ ,private, ]]; then
        rm -f "$headers"
        echo "The raw private-storage denial must be private and no-store." >&2
        return 1
      fi
      ;;
    *)
      rm -f "$headers"
      echo "Unsupported controlled-response cache policy." >&2
      return 1
      ;;
  esac
  rm -f "$headers"
}

verify_public_maintenance_boundary() {
  local operation_id="$1"
  local method
  local route
  local -a maintenance_routes=(
    /
    /login
    /auth/oidc/start
    /api/service/health-check
    /media/private/media/1/original
    "/__mochirii-maintenance-probe-$operation_id"
  )
  for method in GET HEAD; do
    for route in "${maintenance_routes[@]}"; do
      verify_controlled_public_response "$method" "https://social.mochirii.com$route" 503 false 65536 || return 1
    done
    verify_controlled_public_response "$method" https://social.mochirii.com/installer 404 true 0 || return 1
    verify_controlled_public_response "$method" https://social.mochirii.com/installer/private-media-probe 404 true 0 || return 1
    local storage_path
    for storage_path in \
      storage/m \
      storage/m/private-media-probe \
      storage/_esm.t3 \
      storage/_esm.t3/private-media-probe \
      storage/g \
      storage/g/private-media-probe \
      storage/g1 \
      storage/g1/private-media-probe \
      storage/avatars \
      storage/avatars/private-media-probe \
      storage/cache/avatars \
      storage/cache/avatars/private-media-probe; do
      verify_controlled_public_response \
        "$method" \
        "https://social.mochirii.com/$storage_path" \
        404 \
        true \
        0 \
        private-no-store || return 1
    done
  done
}

verify_public_closed_application_boundary() {
  local operation_id="$1"
  local method
  local route
  local -a closed_routes=(
    /
    /login
    /auth/oidc/start
    /api/service/health-check
    /media/private/media/1/original
    "/__mochirii-finalize-probe-$operation_id"
  )
  for method in GET HEAD; do
    for route in "${closed_routes[@]}"; do
      verify_controlled_public_response \
        "$method" "https://social.mochirii.com$route" \
        503 false 65536 private-no-cache || return 1
    done
  done
  verify_public_private_media_denial_boundary || return 1
}

extract_validated_release_bundle() {
  local bundle_path="$1"
  local destination="$2"

  python3 - "$bundle_path" "$destination" <<'PY'
import gzip
import io
import os
import pathlib
import stat
import sys
import tarfile

bundle = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
limits = {
    "docker-compose.production.yml": 262_144,
    "release.meta": 4_096,
}

bundle_stat = bundle.lstat()
if not stat.S_ISREG(bundle_stat.st_mode) or bundle_stat.st_size > 1_048_576:
    raise SystemExit("The compressed release bundle is not a bounded regular file.")
with gzip.open(bundle, mode="rb") as compressed:
    uncompressed = compressed.read(393_217)
    if len(uncompressed) > 393_216 or compressed.read(1):
        raise SystemExit("The release bundle exceeds its bounded uncompressed archive limit.")

with tarfile.open(fileobj=io.BytesIO(uncompressed), mode="r:") as archive:
    members = archive.getmembers()
    if len(members) != len(limits):
        raise SystemExit("The release bundle contains an unexpected number of members.")
    if {member.name for member in members} != set(limits):
        raise SystemExit("The release bundle contains an unexpected member path.")
    if archive.pax_headers or any(member.pax_headers or getattr(member, "sparse", None) for member in members):
        raise SystemExit("The release bundle contains unsupported extended metadata.")
    if any(member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE) for member in members):
        raise SystemExit("The release bundle contains a non-regular member.")
    if any(member.size < 0 or member.size > limits[member.name] for member in members):
        raise SystemExit("The release bundle exceeds its uncompressed size limits.")
    if sum(member.size for member in members) > sum(limits.values()):
        raise SystemExit("The release bundle exceeds its total uncompressed size limit.")

    for member in members:
        source = archive.extractfile(member)
        if source is None:
            raise SystemExit("The release bundle member could not be read.")
        target = destination / member.name
        descriptor = os.open(
            target,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        try:
            remaining = member.size
            while remaining:
                chunk = source.read(min(remaining, 65_536))
                if not chunk:
                    raise SystemExit("The release bundle member ended early.")
                view = memoryview(chunk)
                while view:
                    written = os.write(descriptor, view)
                    view = view[written:]
                remaining -= len(chunk)
            if source.read(1):
                raise SystemExit("The release bundle member exceeded its declared size.")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

directory_descriptor = os.open(destination, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
PY
}

extract_validated_recovery_payload() {
  local payload_path="$1"
  local destination="$2"

  python3 - \
    "$payload_path" \
    "$destination" \
    "$RECOVERY_PAYLOAD_MAX_BYTES" \
    "$RECOVERY_DATABASE_MAX_BYTES" \
    "$RECOVERY_CONFIGURATION_MAX_BYTES" \
    "$RECOVERY_MANIFEST_MAX_BYTES" <<'PY'
import os
import pathlib
import stat
import sys
import tarfile

payload = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
payload_limit, database_limit, configuration_limit, manifest_limit = map(int, sys.argv[3:])
limits = {
    "database.sql.gz": database_limit,
    "configuration.tar.gz": configuration_limit,
    "manifest": manifest_limit,
}

payload_stat = payload.lstat()
if (
    not stat.S_ISREG(payload_stat.st_mode)
    or payload_stat.st_size <= 0
    or payload_stat.st_size > payload_limit
):
    raise SystemExit("Recovery payload is not a bounded regular file.")

destination_stat = destination.lstat()
if not stat.S_ISDIR(destination_stat.st_mode) or stat.S_ISLNK(destination_stat.st_mode):
    raise SystemExit("Recovery extraction destination is unsafe.")

seen = set()
with tarfile.open(payload, mode="r|") as archive:
    if archive.pax_headers:
        raise SystemExit("Recovery payload contains global PAX metadata.")
    for member in archive:
        name = member.name
        if (
            name not in limits
            or name in seen
            or member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE)
            or member.pax_headers
            or getattr(member, "sparse", None)
            or member.size < 0
            or member.size > limits[name]
        ):
            raise SystemExit("Recovery payload contains an unsafe archive entry.")
        source = archive.extractfile(member)
        if source is None:
            raise SystemExit("Recovery payload member could not be read.")
        target = destination / name
        descriptor = os.open(
            target,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        try:
            remaining = member.size
            while remaining:
                chunk = source.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise SystemExit("Recovery payload member ended early.")
                view = memoryview(chunk)
                while view:
                    written = os.write(descriptor, view)
                    if written <= 0:
                        raise SystemExit("Recovery payload write was incomplete.")
                    view = view[written:]
                remaining -= len(chunk)
            if source.read(1):
                raise SystemExit("Recovery payload member exceeded its declared size.")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        seen.add(name)

if seen != set(limits):
    raise SystemExit("Recovery payload is incomplete.")

directory_descriptor = os.open(destination, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
PY
}

validate_recovery_configuration_archive() {
  local archive_path="$1"
  local runtime_prefix="$2"
  local expected_commit="$3"
  local manifest_format="$4"
  local destination="${5:-}"

  validate_commit "$expected_commit"
  [[ "$manifest_format" == 1 || "$manifest_format" == 2 ]] || {
    echo "Configuration archive manifest format is unsupported." >&2
    return 1
  }

  python3 - \
    "$archive_path" \
    "$runtime_prefix" \
    "$expected_commit" \
    "$manifest_format" \
    "$destination" \
    "$RECOVERY_CONFIGURATION_MAX_BYTES" <<'PY'
import gzip
import io
import os
import pathlib
import stat
import sys
import tarfile

archive_path = pathlib.Path(sys.argv[1])
runtime_prefix = sys.argv[2]
expected_commit = sys.argv[3]
manifest_format = sys.argv[4]
destination_value = sys.argv[5]
compressed_limit = int(sys.argv[6])
expanded_limit = 32 * 1024 * 1024
member_limit = 4 * 1024 * 1024

archive_stat = archive_path.lstat()
if (
    not stat.S_ISREG(archive_stat.st_mode)
    or archive_stat.st_size <= 0
    or archive_stat.st_size > compressed_limit
):
    raise SystemExit("Configuration archive is not a bounded regular file.")

common_required = {
    "etc/caddy/Caddyfile",
    "etc/ssh/sshd_config.d/99-mochirii-hardening.conf",
    f"{runtime_prefix}/shared/backup.env",
    f"{runtime_prefix}/shared/backup-recipient.pub",
    f"{runtime_prefix}/shared/pixelfed.env",
}
runtime_required = {
    "usr/local/lib/mochirii-social/deploy-runtime.contract",
    "usr/local/lib/mochirii-social/production-runtime-lib.sh",
    "usr/local/sbin/mochirii-social-deploy",
    "usr/local/sbin/mochirii-social-backup",
    "usr/local/sbin/mochirii-social-restore",
    "usr/local/sbin/mochirii-social-deploy-entry",
}
optional_units = {
    "etc/systemd/system/mochirii-social-backup.service",
    "etc/systemd/system/mochirii-social-backup.timer",
}
cutover_pair = {
    f"{runtime_prefix}/shared/private-media-cutover/cutover.state",
    f"{runtime_prefix}/shared/private-media-cutover/maintenance.proof",
}
release_required = {
    f"{runtime_prefix}/releases/{expected_commit}/docker-compose.production.yml",
    f"{runtime_prefix}/releases/{expected_commit}/release.env",
    f"{runtime_prefix}/releases/{expected_commit}/release.meta",
}
required = common_required | release_required
allowed = required | optional_units
if manifest_format == "2":
    required |= runtime_required
    allowed |= runtime_required | cutover_pair

with gzip.open(archive_path, mode="rb") as compressed:
    expanded = compressed.read(expanded_limit + 1)
    if len(expanded) > expanded_limit or compressed.read(1):
        raise SystemExit("Configuration archive exceeds the expanded recovery bound.")

destination = pathlib.Path(destination_value) if destination_value else None
if destination is not None:
    destination_stat = destination.lstat()
    if not stat.S_ISDIR(destination_stat.st_mode) or destination.is_symlink():
        raise SystemExit("Configuration extraction destination is unsafe.")

with tarfile.open(fileobj=io.BytesIO(expanded), mode="r:") as archive:
    if archive.pax_headers:
        raise SystemExit("Configuration archive contains global PAX metadata.")
    members = archive.getmembers()
    if not 1 <= len(members) <= 32:
        raise SystemExit("Configuration archive has an invalid entry count.")
    total = 0
    names = set()
    for member in members:
        name = member.name.removeprefix("./")
        if (
            name.startswith("/")
            or ".." in name.split("/")
            or name in names
            or not member.isfile()
            or member.pax_headers
            or getattr(member, "sparse", None)
            or name not in allowed
        ):
            raise SystemExit("Configuration archive contains an unsafe entry.")
        if member.size < 0 or member.size > member_limit:
            raise SystemExit("Configuration archive member exceeds the recovery bound.")
        total += member.size
        if total > expanded_limit:
            raise SystemExit("Configuration archive exceeds the expanded recovery bound.")
        names.add(name)

    if not required.issubset(names):
        raise SystemExit("Configuration archive is missing required recovery evidence.")
    present_cutover = names & cutover_pair
    if present_cutover and present_cutover != cutover_pair:
        raise SystemExit("Configuration archive has an incomplete cutover evidence pair.")

    for member in members:
        source = archive.extractfile(member)
        if source is None:
            raise SystemExit("Configuration archive member could not be read.")
        payload = source.read(member.size + 1)
        if len(payload) != member.size or source.read(1):
            raise SystemExit("Configuration archive member read was incomplete.")
        if destination is None:
            continue
        name = member.name.removeprefix("./")
        target = destination.joinpath(*name.split("/"))
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor = os.open(
            target,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        try:
            view = memoryview(payload)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise SystemExit("Configuration archive member write was incomplete.")
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
PY
}

validate_recovery_configuration_bindings() {
  local configuration_root="$1"
  local normalized_manifest="$2"
  local runtime_prefix="$3"

  python3 - "$configuration_root" "$normalized_manifest" "$runtime_prefix" <<'PY'
import hashlib
import os
import pathlib
import re
import stat
import sys

root = pathlib.Path(sys.argv[1])
manifest_path = pathlib.Path(sys.argv[2])
runtime_prefix = sys.argv[3]
sha_pattern = re.compile(r"[0-9a-f]{64}")
commit_pattern = re.compile(r"[0-9a-f]{40}")
digest_pattern = re.compile(r"sha256:[0-9a-f]{64}")

if not stat.S_ISDIR(root.lstat().st_mode) or root.is_symlink():
    raise SystemExit("Recovery configuration root is unsafe.")
manifest_stat = manifest_path.lstat()
if not stat.S_ISREG(manifest_stat.st_mode):
    raise SystemExit("Normalized recovery manifest is unsafe.")
lines = manifest_path.read_text(encoding="utf-8").splitlines()
expected_keys = [
    "format",
    "created_utc",
    "release_commit",
    "release_digest",
    "database_sha256",
    "configuration_sha256",
    "cutover_phase",
    "cutover_state_sha256",
    "maintenance_proof_sha256",
    "deploy_runtime_contract_file_sha256",
]
if len(lines) != len(expected_keys) or [line.partition("=")[0] for line in lines] != expected_keys:
    raise SystemExit("Normalized recovery manifest has an invalid exact schema.")
values = dict(line.split("=", 1) for line in lines)
if values["format"] not in {"1", "2"}:
    raise SystemExit("Normalized recovery manifest format is unsupported.")
if not commit_pattern.fullmatch(values["release_commit"]):
    raise SystemExit("Normalized recovery release commit is invalid.")
if not digest_pattern.fullmatch(values["release_digest"]):
    raise SystemExit("Normalized recovery release digest is invalid.")

def regular_file(path):
    try:
        return stat.S_ISREG(path.lstat().st_mode)
    except FileNotFoundError:
        return False

def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(65_536), b""):
            digest.update(chunk)
    return digest.hexdigest()

release_root = root / runtime_prefix / "releases" / values["release_commit"]
if not release_root.is_dir() or release_root.is_symlink():
    raise SystemExit("Archived release directory is missing or unsafe.")
release_meta = release_root / "release.meta"
if not regular_file(release_meta):
    raise SystemExit("Archived release metadata is missing or unsafe.")
metadata_lines = release_meta.read_text(encoding="utf-8").splitlines()
expected_metadata_keys = ["commit", "digest", "repository"]
if len(metadata_lines) == 5:
    expected_metadata_keys += ["migration_tree_sha256", "runtime_contract_sha256"]
if len(metadata_lines) not in {3, 5} or [
    line.partition("=")[0] for line in metadata_lines
] != expected_metadata_keys:
    raise SystemExit("Archived release metadata has an invalid exact schema.")
metadata = {}
for line in metadata_lines:
    key, separator, value = line.partition("=")
    if not separator or key in metadata:
        raise SystemExit("Archived release metadata is malformed or duplicated.")
    metadata[key] = value
if metadata.get("commit") != values["release_commit"] or metadata.get("digest") != values["release_digest"]:
    raise SystemExit("Archived release metadata does not match the recovery manifest.")
canonical_repository = "Mochirii-Wushu/Mochirii-Website"
legacy_repository = "Mochirii-Wushu/Mochirii"
metadata_repository = metadata.get("repository")
current_repository_valid = (
    len(metadata_lines) == 5 and metadata_repository == canonical_repository
)
legacy_repository_compatible = (
    len(metadata_lines) == 3 and metadata_repository == legacy_repository
)
if not (current_repository_valid or legacy_repository_compatible):
    raise SystemExit("Archived release metadata repository is invalid.")
if len(metadata_lines) == 5 and (
    not sha_pattern.fullmatch(metadata["migration_tree_sha256"])
    or not sha_pattern.fullmatch(metadata["runtime_contract_sha256"])
):
    raise SystemExit("Archived release metadata hashes are invalid.")

contract = root / "usr/local/lib/mochirii-social/deploy-runtime.contract"
cutover_state = root / runtime_prefix / "shared/private-media-cutover/cutover.state"
maintenance_proof = root / runtime_prefix / "shared/private-media-cutover/maintenance.proof"
if values["format"] == "1":
    if any(os.path.lexists(path) for path in (contract, cutover_state, maintenance_proof)):
        raise SystemExit("Legacy recovery configuration contains unsupported modern bindings.")
    raise SystemExit(0)

if not regular_file(contract):
    raise SystemExit("Archived deployment-runtime contract is missing or unsafe.")
expected_contract_file_sha = values["deploy_runtime_contract_file_sha256"]
if not sha_pattern.fullmatch(expected_contract_file_sha) or sha256(contract) != expected_contract_file_sha:
    raise SystemExit("Archived deployment-runtime contract file hash is invalid.")
contract_lines = contract.read_text(encoding="utf-8").splitlines()
if len(contract_lines) != 8 or contract_lines[0] != "version=2":
    raise SystemExit("Archived deployment-runtime contract has an invalid exact schema.")
if not re.fullmatch(r"installed_from_commit=[0-9a-f]{40}", contract_lines[1]):
    raise SystemExit("Archived deployment-runtime source commit is invalid.")
contract_sha_match = re.fullmatch(r"contract_sha256=([0-9a-f]{64})", contract_lines[2])
if not contract_sha_match:
    raise SystemExit("Archived deployment-runtime aggregate is invalid.")
manifest_payload = ("\n".join(contract_lines[3:]) + "\n").encode()
if hashlib.sha256(manifest_payload).hexdigest() != contract_sha_match.group(1):
    raise SystemExit("Archived deployment-runtime aggregate does not match its manifest.")
runtime_paths = [
    "/usr/local/lib/mochirii-social/production-runtime-lib.sh",
    "/usr/local/sbin/mochirii-social-deploy",
    "/usr/local/sbin/mochirii-social-backup",
    "/usr/local/sbin/mochirii-social-restore",
    "/usr/local/sbin/mochirii-social-deploy-entry",
]
for expected_path, contract_line in zip(runtime_paths, contract_lines[3:], strict=True):
    match = re.fullmatch(r"([0-9a-f]{64})  (/.+)", contract_line)
    if not match or match.group(2) != expected_path:
        raise SystemExit("Archived deployment-runtime manifest path is invalid.")
    archived_runtime = root.joinpath(*expected_path.removeprefix("/").split("/"))
    if not regular_file(archived_runtime) or sha256(archived_runtime) != match.group(1):
        raise SystemExit("Archived deployment-runtime file hash is invalid.")

state_sha = values["cutover_state_sha256"]
proof_sha = values["maintenance_proof_sha256"]
if state_sha == "ABSENT":
    if values["cutover_phase"] != "absent" or proof_sha != "ABSENT":
        raise SystemExit("Absent cutover evidence has inconsistent manifest fields.")
    if os.path.lexists(cutover_state) or os.path.lexists(maintenance_proof):
        raise SystemExit("Unexpected cutover evidence is present.")
    raise SystemExit(0)

if not sha_pattern.fullmatch(state_sha) or not sha_pattern.fullmatch(proof_sha):
    raise SystemExit("Cutover evidence hashes are invalid.")
if not regular_file(cutover_state) or not regular_file(maintenance_proof):
    raise SystemExit("Cutover evidence is missing or unsafe.")
if sha256(cutover_state) != state_sha or sha256(maintenance_proof) != proof_sha:
    raise SystemExit("Cutover evidence does not match the recovery manifest.")
state_lines = cutover_state.read_text(encoding="utf-8").splitlines()
state_patterns = [
    r"version=2",
    rf"phase={re.escape(values['cutover_phase'])}",
    r"operation_id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
    r"commit=[0-9a-f]{40}",
    r"digest=sha256:[0-9a-f]{64}",
    r"previous_commit=[0-9a-f]{40}",
    r"previous_digest=sha256:[0-9a-f]{64}",
    r"horizon_state=(running|stopped)",
    r"scheduler_state=(running|stopped)",
    r"laravel_maintenance_state=(up|down)",
    rf"maintenance_proof_sha256={proof_sha}",
    r"runtime_contract_sha256=[0-9a-f]{64}",
    r"migration_tree_sha256=[0-9a-f]{64}",
    r"retired_operation_ids=($|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})*)",
]
if len(state_lines) != len(state_patterns) or any(
    re.fullmatch(pattern, line) is None
    for pattern, line in zip(state_patterns, state_lines, strict=True)
):
    raise SystemExit("Archived cutover state has an invalid exact schema.")
PY
}

validate_recovery_payload_manifest() {
  local extracted_root="$1"
  local normalized_manifest="$2"
  local manifest="$extracted_root/manifest"

  gzip -t "$extracted_root/database.sql.gz" || return 1
  python3 - \
    "$manifest" \
    "$extracted_root/database.sql.gz" \
    "$extracted_root/configuration.tar.gz" \
    "$normalized_manifest" <<'PY'
import hashlib
import os
import pathlib
import re
import sys

manifest_path, database_path, configuration_path, normalized_path = map(pathlib.Path, sys.argv[1:])
lines = manifest_path.read_text(encoding="utf-8").splitlines()
sha256_pattern = re.compile(r"[0-9a-f]{64}")

def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()

database_sha256 = digest(database_path)
configuration_sha256 = digest(configuration_path)

if len(lines) == 4 and lines[0] == "format=1":
    expected = [
        re.compile(r"format=1"),
        re.compile(r"created_utc=[0-9]{8}T[0-9]{6}Z"),
        re.compile(r"release_commit=[0-9a-f]{40}"),
        re.compile(r"release_digest=sha256:[0-9a-f]{64}"),
    ]
    if any(not pattern.fullmatch(line) for pattern, line in zip(expected, lines)):
        raise SystemExit("Legacy recovery manifest has an invalid exact schema.")
    normalized = [
        *lines,
        f"database_sha256={database_sha256}",
        f"configuration_sha256={configuration_sha256}",
        "cutover_phase=absent",
        "cutover_state_sha256=ABSENT",
        "maintenance_proof_sha256=ABSENT",
        "deploy_runtime_contract_file_sha256=ABSENT",
    ]
elif len(lines) == 10 and lines[0] == "format=2":
    expected = [
        re.compile(r"format=2"),
        re.compile(r"created_utc=[0-9]{8}T[0-9]{6}Z"),
        re.compile(r"release_commit=[0-9a-f]{40}"),
        re.compile(r"release_digest=sha256:[0-9a-f]{64}"),
        re.compile(r"database_sha256=[0-9a-f]{64}"),
        re.compile(r"configuration_sha256=[0-9a-f]{64}"),
        re.compile(r"cutover_phase=(?:absent|completed)"),
        re.compile(r"cutover_state_sha256=(?:ABSENT|[0-9a-f]{64})"),
        re.compile(r"maintenance_proof_sha256=(?:ABSENT|[0-9a-f]{64})"),
        re.compile(r"deploy_runtime_contract_file_sha256=[0-9a-f]{64}"),
    ]
    if any(not pattern.fullmatch(line) for pattern, line in zip(expected, lines)):
        raise SystemExit("Recovery manifest has an invalid exact format-2 schema.")
    values = dict(line.split("=", 1) for line in lines)
    if (
        not sha256_pattern.fullmatch(values["database_sha256"])
        or values["database_sha256"] != database_sha256
        or not sha256_pattern.fullmatch(values["configuration_sha256"])
        or values["configuration_sha256"] != configuration_sha256
    ):
        raise SystemExit("Recovery manifest component hashes do not match the payload.")
    normalized = lines
else:
    raise SystemExit("Recovery manifest has an unsupported exact schema.")

if normalized_path.exists() or normalized_path.is_symlink():
    raise SystemExit("Normalized recovery manifest target already exists.")
candidate = normalized_path.with_name(normalized_path.name + ".candidate")
descriptor = os.open(
    candidate,
    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
    0o600,
)
try:
    payload = ("\n".join(normalized) + "\n").encode()
    view = memoryview(payload)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:
            raise SystemExit("Normalized recovery manifest write was incomplete.")
        view = view[written:]
    os.fsync(descriptor)
finally:
    os.close(descriptor)
os.replace(candidate, normalized_path)
directory_descriptor = os.open(
    normalized_path.parent,
    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
)
try:
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
PY
}

verify_secure_backup_recipient_file() {
  local recipient_path="$1"
  [[ -f "$recipient_path" && ! -L "$recipient_path" ]] || {
    echo "The root-owned backup recipient is missing or unsafe." >&2
    return 1
  }
  case "$(stat -c '%U:%G:%a' "$recipient_path")" in
    root:root:600 | root:root:644) ;;
    *)
      echo "The backup recipient must be root:root mode 0600 or 0644." >&2
      return 1
      ;;
  esac
}

verify_secure_backup_environment_file() {
  local environment_path="$1"
  [[ -f "$environment_path" && ! -L "$environment_path" ]] || {
    echo "The root-owned backup environment is missing or unsafe." >&2
    return 1
  }
  [[ "$(stat -c '%U:%G:%a' "$environment_path")" == root:root:600 ]] || {
    echo "The backup environment must be root:root mode 0600." >&2
    return 1
  }
}

verify_bounded_encrypted_recovery_file() {
  local encrypted_path="$1"
  local expected_bytes="${2:-}"
  [[ -f "$encrypted_path" && ! -L "$encrypted_path" ]] || {
    echo "Encrypted recovery payload is missing or unsafe." >&2
    return 1
  }
  local actual_bytes
  actual_bytes="$(stat -c '%s' "$encrypted_path")"
  [[ "$actual_bytes" =~ ^[0-9]+$ && "$actual_bytes" -gt 0 && \
    "$actual_bytes" -le "$RECOVERY_ENCRYPTED_MAX_BYTES" ]] || {
    echo "Encrypted recovery payload exceeds its bounded transport limit." >&2
    return 1
  }
  if [[ -n "$expected_bytes" ]]; then
    [[ "$expected_bytes" =~ ^[0-9]+$ && "$actual_bytes" -eq "$expected_bytes" ]] || {
      echo "Encrypted recovery payload size changed during transfer." >&2
      return 1
    }
  fi
}

container_runtime_state() {
  local container_name="$1"
  local running
  running="$(docker inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null)" || {
    echo "Required container $container_name is missing." >&2
    return 1
  }
  case "$running" in
    true) printf '%s\n' running ;;
    false) printf '%s\n' stopped ;;
    *)
      echo "Required container $container_name returned an unsupported state." >&2
      return 1
      ;;
  esac
}

laravel_maintenance_state() {
  local state
  state="$(docker exec pixelfed-app php artisan tinker --execute="echo app()->isDownForMaintenance() ? 'MOCHIRII_LARAVEL_DOWN' : 'MOCHIRII_LARAVEL_UP';" 2>/dev/null | tr -d '\r\n')" || {
    echo "The application maintenance state could not be read." >&2
    return 1
  }
  case "$state" in
    MOCHIRII_LARAVEL_DOWN) printf '%s\n' down ;;
    MOCHIRII_LARAVEL_UP) printf '%s\n' up ;;
    *)
      echo "The application maintenance state could not be read." >&2
      return 1
      ;;
  esac
}

release_metadata_value() {
  local release_path="$1"
  local key="$2"
  local value
  local key_count
  value="$(sed -n "s/^${key}=//p" "$release_path/release.meta")" || return 1
  key_count="$(awk -F= -v expected="$key" '$1 == expected { count += 1 } END { print count + 0 }' "$release_path/release.meta")" || return 1
  [[ -n "$value" && "$key_count" -eq 1 ]] || {
    echo "Release metadata key $key is missing or duplicated." >&2
    return 1
  }
  printf '%s\n' "$value"
}

image_migration_tree_sha256() {
  local expected_digest="$1"
  local image_ref="$REGISTRY_IMAGE@$expected_digest"
  local tree_sha256
  tree_sha256="$(docker run \
    --rm \
    --network none \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --workdir /var/www/html \
    --entrypoint sh \
    "$image_ref" \
    -ec 'find database/migrations -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d" " -f1')" || return 1
  validate_sha256 "$tree_sha256" || return 1
  printf '%s\n' "$tree_sha256"
}

verify_candidate_migration_tree() {
  local expected_digest="$1"
  local expected_migration_tree_sha256="$2"
  local image_tree_sha256

  validate_sha256 "$expected_migration_tree_sha256" || return 1
  image_tree_sha256="$(image_migration_tree_sha256 "$expected_digest")" || return 1
  [[ "$image_tree_sha256" == "$expected_migration_tree_sha256" ]] || {
    echo "The candidate image migration tree does not match the reviewed source tree." >&2
    return 1
  }
}

verify_private_media_migration_tree_parity() {
  local candidate_digest="$1"
  local previous_digest="$2"
  local expected_migration_tree_sha256="$3"
  local candidate_tree_sha256
  local previous_tree_sha256

  candidate_tree_sha256="$(image_migration_tree_sha256 "$candidate_digest")" || return 1
  previous_tree_sha256="$(image_migration_tree_sha256 "$previous_digest")" || return 1
  [[ "$candidate_tree_sha256" == "$expected_migration_tree_sha256" ]] || {
    echo "The candidate migration tree differs from the reviewed source tree." >&2
    return 1
  }
  [[ "$previous_tree_sha256" == "$expected_migration_tree_sha256" ]] || {
    echo "The currently deployed migration tree differs from the reviewed source tree." >&2
    return 1
  }
}

verify_candidate_private_media_gateway_offline() {
  local expected_digest="$1"
  local image_ref="$REGISTRY_IMAGE@$expected_digest"

  docker run \
    --rm \
    --network none \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --workdir /var/www/html \
    --entrypoint sh \
    "$image_ref" \
    -ec '
      test -f routes/api.php
      test -f app/Http/Controllers/MochiriiPrivateMediaController.php
      test -f app/Http/Middleware/MochiriiPrivateSocial.php
      test -f config/mochirii-private-media.php
      grep -Fq "mochirii.private-media.show" routes/api.php
      grep -Fq "private-media" routes/api.php
      grep -Fq "mochirii.private:private-media" routes/api.php
      grep -Fq "validemail" routes/api.php
      grep -Fq "config('"'"'mochirii-private-media.enabled'"'"')" app/Http/Controllers/MochiriiPrivateMediaController.php
      grep -Fq "abort_unless" app/Http/Controllers/MochiriiPrivateMediaController.php
      grep -Fq "temporaryUrl" app/Http/Controllers/MochiriiPrivateMediaController.php
      grep -Fq "visibility" config/filesystems.php
    '
}

set_current_release_link() {
  local release_path="$1"
  local candidate_link="$RUNTIME_ROOT/.current.$$.tmp"
  ln -s "$release_path" "$candidate_link" || return 1
  mv -T "$candidate_link" "$CURRENT_LINK" || return 1
  fsync_path "$RUNTIME_ROOT" || return 1
}

verify_exact_container_image() {
  verify_named_container_image pixelfed-app "$1" || return 1
}

verify_named_container_image() {
  local container_name="$1"
  local expected_digest="$2"
  local expected_image="$REGISTRY_IMAGE@$expected_digest"
  [[ "$(docker inspect --format '{{.Config.Image}}' "$container_name")" == "$expected_image" ]] || {
    echo "$container_name does not use the expected immutable image digest." >&2
    return 1
  }
}

verify_exact_runtime_images() {
  local expected_digest="$1"
  local expected_image="$REGISTRY_IMAGE@$expected_digest"
  local container_name
  for container_name in pixelfed-app pixelfed-horizon pixelfed-scheduler; do
    [[ "$(docker inspect --format '{{.Config.Image}}' "$container_name")" == "$expected_image" ]] || {
      echo "$container_name does not use the expected immutable image digest." >&2
      return 1
    }
  done
}

verify_worker_state() {
  local container_name="$1"
  local desired_state="$2"
  case "$desired_state" in
    running)
      wait_for_container_health "$container_name" 180 || return 1
      ;;
    stopped)
      wait_for_container_stopped "$container_name" 60 || return 1
      ;;
    *)
      echo "Unsupported captured worker state: $desired_state" >&2
      return 1
      ;;
  esac
}

verify_private_media_state_bindings() {
  local expected_contract_sha256="$1"
  local proof_sha256
  local recorded_proof_sha256
  local recorded_contract_sha256
  validate_private_media_cutover_state || return 1
  proof_sha256="$(private_media_maintenance_proof_sha256)" || return 1
  recorded_proof_sha256="$(cutover_state_value maintenance_proof_sha256)" || return 1
  [[ "$proof_sha256" == "$recorded_proof_sha256" ]] || {
    echo "The maintenance proof changed after the private-media operation began." >&2
    return 1
  }
  verify_installed_deploy_runtime_contract "$expected_contract_sha256" || return 1
  recorded_contract_sha256="$(cutover_state_value runtime_contract_sha256)" || return 1
  [[ "$expected_contract_sha256" == "$recorded_contract_sha256" ]] || {
    echo "The installed runtime contract changed after the private-media operation began." >&2
    return 1
  }
}

verify_closed_private_media_runtime_local() {
  local expected_digest="$1"
  local maintenance_state
  wait_for_container_running pixelfed-app 120 || return 1
  verify_exact_container_image "$expected_digest" || return 1
  verify_worker_state pixelfed-horizon stopped || return 1
  verify_worker_state pixelfed-scheduler stopped || return 1
  maintenance_state="$(laravel_maintenance_state)" || return 1
  [[ "$maintenance_state" == down ]] || {
    echo "The staged application is not in Laravel maintenance mode." >&2
    return 1
  }
  docker exec pixelfed-app php artisan tinker --execute="
    if (
      !app()->isDownForMaintenance() ||
      !Illuminate\\Support\\Facades\\Route::has('mochirii.private-media.show') ||
      !config('mochirii-private-media.enabled') ||
      !config('pixelfed.cloud_storage') ||
      config('filesystems.cloud') !== 's3' ||
      config('filesystems.disks.'.config('filesystems.cloud').'.visibility') !== 'private'
    ) {
      throw new RuntimeException('Closed private-media gateway gate failed.');
    }
  " >/dev/null || return 1
}

verify_permanent_private_media_runtime_local() {
  local expected_digest="$1"
  local maintenance_state
  wait_for_container_health pixelfed-app 300 || return 1
  verify_exact_container_image "$expected_digest" || return 1
  maintenance_state="$(laravel_maintenance_state)" || return 1
  [[ "$maintenance_state" == up ]] || {
    echo "The permanent private-media runtime is unexpectedly in maintenance mode." >&2
    return 1
  }
  docker exec pixelfed-app php artisan tinker --execute="
    if (
      app()->isDownForMaintenance() ||
      !Illuminate\\Support\\Facades\\Route::has('mochirii.private-media.show') ||
      !config('mochirii-private-media.enabled') ||
      !config('pixelfed.cloud_storage') ||
      config('filesystems.cloud') !== 's3' ||
      config('filesystems.disks.'.config('filesystems.cloud').'.visibility') !== 'private'
    ) {
      throw new RuntimeException('Permanent private-media runtime gate failed.');
    }
  " >/dev/null || return 1
}

verify_public_private_media_denial_boundary() {
  local method
  local route
  local -a denied_routes=(
    /storage/m
    /storage/m/private-media-probe
    /storage/_esm.t3
    /storage/_esm.t3/private-media-probe
    /storage/g
    /storage/g/private-media-probe
    /storage/g1
    /storage/g1/private-media-probe
    /storage/avatars
    /storage/avatars/private-media-probe
    /storage/cache/avatars
    /storage/cache/avatars/private-media-probe
  )
  for method in GET HEAD; do
    for route in "${denied_routes[@]}"; do
      verify_controlled_public_response "$method" "https://social.mochirii.com$route" 404 true 0 private-no-store || return 1
    done
  done
}

verify_public_private_media_gateway_denial_boundary() {
  local method
  local route
  local -a gateway_routes=(
    /media/private/media/1/original
    /media/private/media/999999999/original
  )
  for method in GET HEAD; do
    for route in "${gateway_routes[@]}"; do
      verify_controlled_public_response \
        "$method" \
        "https://social.mochirii.com$route" \
        404 false 65536 private-no-cache || return 1
    done
  done
}

verify_permanent_private_media_runtime() {
  verify_permanent_private_media_runtime_local "$1" || return 1
  verify_public_private_media_gateway_denial_boundary || return 1
  verify_public_private_media_denial_boundary || return 1
  echo "Permanent private-media runtime gates passed."
}

emit_container_diagnostics() {
  local container_name="$1"
  # Container logs can contain signed object URLs, object keys, authorization
  # material, or member content. Emit only this non-secret lifecycle allowlist.
  docker inspect \
    --format 'container={{.Name}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit_code={{.State.ExitCode}} restart_count={{.RestartCount}}' \
    "$container_name" 2>/dev/null >&2 || true
}

release_dir_for() {
  printf '%s/%s\n' "$RELEASES_ROOT" "$1"
}

pull_release_image() {
  local image_ref="$1"
  id "$PULL_USER" >/dev/null 2>&1 || {
    echo "The configured GHCR pull user does not exist." >&2
    exit 1
  }
  sudo -H -u "$PULL_USER" -- docker pull "$image_ref" >/dev/null
}

compose_release() {
  local release_dir="$1"
  shift
  docker compose \
    --project-directory "$release_dir" \
    --env-file "$SHARED_ROOT/pixelfed.env" \
    --env-file "$release_dir/release.env" \
    --file "$release_dir/docker-compose.production.yml" \
    "$@"
}

quiesce_candidate_for_rollback_best_effort() {
  local candidate_release="$1"

  # A failed `compose up` may already have removed pixelfed-app. The caller
  # proves the restored prior release with the full runtime/image/policy gates;
  # absence here is therefore an expected idempotent cleanup state.
  if docker inspect pixelfed-app >/dev/null 2>&1; then
    docker exec pixelfed-app php artisan down --retry=60 --no-ansi >/dev/null 2>&1 || true
  fi
  compose_release "$candidate_release" stop --timeout 90 horizon scheduler >/dev/null 2>&1 || true
}

wait_for_container_health() {
  local container_name="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))

  while ((SECONDS < deadline)); do
    local status
    status="$(
      docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$container_name" 2>/dev/null || true
    )"

    case "$status" in
      healthy | running)
        return 0
        ;;
      unhealthy | exited | dead)
        echo "$container_name entered terminal state: $status" >&2
        emit_container_diagnostics "$container_name"
        return 1
        ;;
    esac

    sleep 5
  done

  echo "$container_name did not become healthy within ${timeout_seconds}s." >&2
  emit_container_diagnostics "$container_name"
  return 1
}

wait_for_container_running() {
  local container_name="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))

  while ((SECONDS < deadline)); do
    local status
    status="$(docker inspect --format '{{.State.Status}}' "$container_name" 2>/dev/null || true)"

    case "$status" in
      running)
        return 0
        ;;
      exited | dead)
        echo "$container_name entered terminal state: $status" >&2
        emit_container_diagnostics "$container_name"
        return 1
        ;;
    esac

    sleep 2
  done

  echo "$container_name did not enter running state within ${timeout_seconds}s." >&2
  emit_container_diagnostics "$container_name"
  return 1
}

container_exact_presence() {
  local container_name="$1"
  local listing
  local -a names
  listing="$(docker ps --all \
    --filter "name=^/${container_name}$" \
    --format '{{.Names}}')" || {
    echo "Docker could not prove whether $container_name exists." >&2
    return 1
  }
  mapfile -t names < <(printf '%s\n' "$listing" | sed '/^$/d')
  case "${#names[@]}" in
    0) printf '%s\n' absent ;;
    1)
      [[ "${names[0]}" == "$container_name" ]] || {
        echo "Docker returned an unexpected container identity for $container_name." >&2
        return 1
      }
      printf '%s\n' present
      ;;
    *)
      echo "Docker returned multiple exact matches for $container_name." >&2
      return 1
      ;;
  esac
}

wait_for_container_stopped() {
  local container_name="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))

  while ((SECONDS < deadline)); do
    local presence
    local running
    presence="$(container_exact_presence "$container_name")" || return 1
    if [[ "$presence" == absent ]]; then
      return 0
    fi
    [[ "$presence" == present ]] || return 1
    running="$(docker inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null)" || {
      echo "Docker could not inspect $container_name while proving it stopped." >&2
      return 1
    }
    [[ "$running" == "false" ]] && return 0
    sleep 2
  done

  echo "$container_name did not stop within ${timeout_seconds}s." >&2
  emit_container_diagnostics "$container_name"
  return 1
}

verify_fail_closed_hard_stop() {
  local container_name
  for container_name in pixelfed-app pixelfed-horizon pixelfed-scheduler; do
    local presence
    presence="$(container_exact_presence "$container_name")" || return 1
    [[ "$presence" == absent ]] && continue
    [[ "$presence" == present ]] || return 1
    [[ "$(docker inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null)" == false ]] || {
      echo "$container_name remains live after fail-closed hard stop." >&2
      return 1
    }
  done
}

hard_stop_fail_closed_runtime() {
  local release_path="$1"
  local container_name

  compose_release "$release_path" stop --timeout 90 \
    horizon scheduler pixelfed >/dev/null 2>&1 || true
  for container_name in pixelfed-horizon pixelfed-scheduler pixelfed-app; do
    local presence
    local running
    presence="$(container_exact_presence "$container_name")" || return 1
    [[ "$presence" == absent ]] && continue
    [[ "$presence" == present ]] || return 1
    running="$(docker inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null)" || return 1
    case "$running" in
      false) ;;
      true)
      docker stop --time 90 "$container_name" >/dev/null 2>&1 || true
      ;;
      *)
        echo "Docker returned an unsupported running state for $container_name." >&2
        return 1
        ;;
    esac
  done
  for container_name in pixelfed-horizon pixelfed-scheduler pixelfed-app; do
    wait_for_container_stopped "$container_name" 90 || return 1
  done
  verify_fail_closed_hard_stop || return 1
}

close_runtime_or_hard_stop() {
  local release_path="$1"
  local controlled_close=true

  FAIL_CLOSED_RUNTIME_MODE=""
  local app_presence
  app_presence="$(container_exact_presence pixelfed-app)" || return 1
  if [[ "$app_presence" == present ]]; then
    docker exec pixelfed-app php artisan down --retry=60 --no-ansi >/dev/null 2>&1 || \
      controlled_close=false
  else
    controlled_close=false
  fi
  compose_release "$release_path" stop --timeout 90 horizon scheduler \
    >/dev/null 2>&1 || controlled_close=false
  if [[ "$controlled_close" == true ]]; then
    wait_for_container_stopped pixelfed-horizon 90 || controlled_close=false
    wait_for_container_stopped pixelfed-scheduler 90 || controlled_close=false
    [[ "$(laravel_maintenance_state 2>/dev/null || true)" == down ]] || \
      controlled_close=false
  fi

  if [[ "$controlled_close" == true ]]; then
    FAIL_CLOSED_RUNTIME_MODE=maintenance
    return 0
  fi

  hard_stop_fail_closed_runtime "$release_path" || return 1
  FAIL_CLOSED_RUNTIME_MODE=hard-stop
}

enforce_fail_closed_runtime() {
  local release_path="$1"
  local boundary_id="$2"

  close_runtime_or_hard_stop "$release_path" || return 1
  if [[ "$FAIL_CLOSED_RUNTIME_MODE" == maintenance ]] && \
    verify_public_closed_application_boundary "$boundary_id"; then
    return 0
  fi
  hard_stop_fail_closed_runtime "$release_path" || return 1
  FAIL_CLOSED_RUNTIME_MODE=hard-stop
  verify_fail_closed_hard_stop || return 1
}

verify_staged_private_media_gateway_local() {
  local expected_digest="$1"
  verify_closed_private_media_runtime_local "$expected_digest" || return 1
  echo "Staged private-media gateway local gates passed."
}

verify_staged_private_media_gateway() {
  verify_staged_private_media_gateway_local "$1" || return 1
  verify_public_maintenance_boundary "$2" || return 1
  echo "Staged private-media gateway gates passed behind maintenance."
}

verify_runtime_local() {
  wait_for_container_health pixelfed-db 180 || return 1
  wait_for_container_health pixelfed-redis 90 || return 1
  wait_for_container_health pixelfed-app 300 || return 1
  wait_for_container_health pixelfed-horizon 180 || return 1
  wait_for_container_health pixelfed-scheduler 180 || return 1

  docker exec pixelfed-horizon php artisan horizon:status --no-ansi || return 1
  docker exec pixelfed-scheduler php artisan schedule:list --no-ansi >/dev/null || return 1
  docker exec pixelfed-app curl \
    --fail \
    --silent \
    --show-error \
    --max-time 5 \
    http://127.0.0.1:8080/api/service/readiness-check >/dev/null || return 1
  curl \
    --fail \
    --silent \
    --show-error \
    --max-time 20 \
    --header 'Host: social.mochirii.com' \
    http://127.0.0.1:8080/ >/dev/null || return 1

  docker exec pixelfed-app php artisan tinker --execute="
    if (
      config('pixelfed.open_registration') ||
      !config('pixelfed.oauth_enabled') ||
      config('federation.activitypub.enabled') ||
      !config('pixelfed.cloud_storage') ||
      config('filesystems.cloud') !== 's3' ||
      !config('media.delete_local_after_cloud')
    ) {
      throw new RuntimeException('Runtime policy gate failed.');
    }
  " >/dev/null || return 1
}

verify_runtime() {
  verify_runtime_local || return 1
  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --max-time 30 \
    https://social.mochirii.com/ >/dev/null || return 1

  local public_readiness_status
  public_readiness_status="$(curl \
    --silent \
    --show-error \
    --max-time 20 \
    --output /dev/null \
    --write-out '%{http_code}' \
    https://social.mochirii.com/api/service/readiness-check)" || return 1
  [[ "$public_readiness_status" == "404" ]] || {
    echo "Public dependency readiness route returned HTTP $public_readiness_status instead of 404." >&2
    return 1
  }

  echo "Pixelfed runtime gates passed."
}

verify_spaces_round_trip() {
  docker exec pixelfed-app php artisan tinker --execute='
    $disk = \Illuminate\Support\Facades\Storage::disk("s3");
    $key = "hosted-verification/" . bin2hex(random_bytes(16)) . ".txt";
    $payload = bin2hex(random_bytes(32));

    try {
      if (!$disk->put($key, $payload)) {
        throw new \RuntimeException("Spaces write failed.");
      }
      if (!$disk->exists($key)) {
        throw new \RuntimeException("Spaces read-after-write failed.");
      }
      if (!hash_equals($payload, $disk->get($key))) {
        throw new \RuntimeException("Spaces content verification failed.");
      }
    } finally {
      $disk->delete($key);
    }

    if ($disk->exists($key)) {
      throw new \RuntimeException("Spaces delete verification failed.");
    }
  ' >/dev/null || return 1

  echo "Spaces write, read, and delete gates passed."
}

verify_online_hosting() {
  reject_active_private_media_cutover_state "Online-hosting verification" || return 1
  reject_active_restore_state "Online-hosting verification" || return 1
  local cutover_phase
  cutover_phase="$(private_media_cutover_phase)" || return 1
  [[ "$cutover_phase" == completed ]] || {
    echo "Online-hosting verification requires a completed private-media bootstrap." >&2
    return 1
  }
  local current_release
  local current_digest
  current_release="$(readlink -f "$CURRENT_LINK")" || return 1
  current_digest="$(release_metadata_value "$current_release" digest)" || return 1
  validate_digest "$current_digest" || return 1
  verify_runtime || return 1
  verify_exact_runtime_images "$current_digest" || return 1
  verify_permanent_private_media_runtime "$current_digest" || return 1
  verify_spaces_round_trip || return 1
  echo "Online-hosted Pixelfed independence gates passed."
}
