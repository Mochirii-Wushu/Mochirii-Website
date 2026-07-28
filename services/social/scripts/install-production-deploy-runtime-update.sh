#!/usr/bin/env bash

set -Eeuo pipefail

require_exact_updater_checkout() {
  local checkout_root="$1"
  local expected_commit="$2"
  shift 2
  local canonical_root
  local checkout_physical
  local tracked_path
  local source_blob
  local commit_blob
  local tree_entry

  canonical_root="$(git -C "$checkout_root" rev-parse --show-toplevel)" || return 1
  checkout_physical="$(cd "$checkout_root" && pwd -P)" || return 1
  canonical_root="$(cd "$canonical_root" && pwd -P)" || return 1
  [[ "$checkout_physical" == "$canonical_root" ]] || {
    echo "The updater source must be the exact repository root." >&2
    return 1
  }
  [[ "$(git -C "$checkout_root" rev-parse HEAD)" == "$expected_commit" ]] || {
    echo "The updater source is not the approved merged commit." >&2
    return 1
  }
  [[ -z "$(git -C "$checkout_root" status --porcelain=v1 --untracked-files=all)" ]] || {
    echo "The updater source checkout must be clean, including untracked files." >&2
    return 1
  }

  for tracked_path in "$@"; do
    [[ "$tracked_path" != /* && "$tracked_path" != *'..'* ]] || {
      echo "The updater received an unsafe tracked source path." >&2
      return 1
    }
    git -C "$checkout_root" ls-files --error-unmatch -- "$tracked_path" >/dev/null || {
      echo "Updater source is not tracked: $tracked_path" >&2
      return 1
    }
    [[ -f "$checkout_root/$tracked_path" && ! -L "$checkout_root/$tracked_path" ]] || {
      echo "Updater source is not a regular non-symlink file: $tracked_path" >&2
      return 1
    }
    tree_entry="$(git -C "$checkout_root" ls-tree "$expected_commit" -- "$tracked_path")" || return 1
    [[ "$tree_entry" =~ ^(100644|100755)[[:space:]]blob[[:space:]]([0-9a-f]{40})[[:space:]] ]] || {
      echo "Updater source has an unsupported committed file type: $tracked_path" >&2
      return 1
    }
    commit_blob="${BASH_REMATCH[2]}"
    source_blob="$(git -C "$checkout_root" hash-object -- "$checkout_root/$tracked_path")" || return 1
    [[ "$source_blob" == "$commit_blob" ]] || {
      echo "Updater source differs from the expected commit: $tracked_path" >&2
      return 1
    }
  done
}

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run the deployment-runtime updater as root." >&2
  exit 1
fi

umask 077
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
social_root="$repo_root/services/social"
expected_commit="${1:-}"
operation_id="${2:-}"
runtime_root="${MOCHIRII_SOCIAL_ROOT:-/opt/mochirii-social}"
lock_file="${MOCHIRII_SOCIAL_LOCK:-/run/lock/mochirii-social-deploy.lock}"
cutover_state="$runtime_root/shared/private-media-cutover/cutover.state"
restore_state="$runtime_root/shared/restore-recovery/restore.state"
update_state_root="$runtime_root/shared/deploy-runtime-update"
update_state="$update_state_root/update.state"
contract_target=/usr/local/lib/mochirii-social/deploy-runtime.contract
runtime_backup_root="$runtime_root/backups"
updater_source_paths=(
  services/social/scripts/install-production-deploy-runtime-update.sh
  services/social/scripts/production-runtime-lib.sh
  services/social/scripts/deploy-production-runtime.sh
  services/social/scripts/backup-production-runtime.sh
  services/social/scripts/restore-production-runtime.sh
  services/social/scripts/deploy-production-entrypoint.sh
)

[[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Usage: install-production-deploy-runtime-update.sh <exact-merged-commit> <operation-id>" >&2
  exit 1
}
[[ "$operation_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || {
  echo "The deployment-runtime update operation ID must be a canonical lowercase UUIDv4." >&2
  exit 1
}

for command_name in \
  bash chmod chown cmp dirname flock git install mktemp mv python3 sha256sum stat; do
  command -v "$command_name" >/dev/null || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done
python3 - <<'PY'
import os

descriptor = os.open(".", os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY

require_exact_updater_checkout \
  "$repo_root" "$expected_commit" "${updater_source_paths[@]}"

install -d -m 0755 -o root -g root "$(dirname "$lock_file")"
exec 9>"$lock_file"
flock -n 9 || {
  echo "Another Mochirii Social deployment or recovery operation is active." >&2
  exit 1
}

if [[ -e "$cutover_state" || -L "$cutover_state" ]]; then
  cutover_state_root="$(dirname "$cutover_state")"
  [[ -d "$cutover_state_root" && ! -L "$cutover_state_root" ]] || {
    echo "The private-media cutover state directory is invalid." >&2
    exit 1
  }
  [[ "$(stat -c '%U:%G:%a' "$cutover_state_root")" == root:root:700 ]] || {
    echo "The private-media cutover state directory must be root:root mode 0700." >&2
    exit 1
  }
  [[ -f "$cutover_state" && ! -L "$cutover_state" ]] || {
    echo "The private-media cutover state is not a regular file." >&2
    exit 1
  }
  [[ "$(stat -c '%U:%G:%a' "$cutover_state")" == root:root:600 ]] || {
    echo "The private-media cutover state must be root:root mode 0600." >&2
    exit 1
  }
  mapfile -t cutover_lines <"$cutover_state"
  [[ "${#cutover_lines[@]}" -eq 14 ]] || {
    echo "The private-media cutover state has an unexpected field count." >&2
    exit 1
  }
  [[ "${cutover_lines[0]}" == version=2 ]]
  [[ "${cutover_lines[1]}" =~ ^phase=(absent|intent|staged|finalizing|completed|recovery_required)$ ]]
  cutover_phase="${BASH_REMATCH[1]}"
  [[ "${cutover_lines[2]}" =~ ^operation_id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
  [[ "${cutover_lines[3]}" =~ ^commit=[0-9a-f]{40}$ ]]
  [[ "${cutover_lines[4]}" =~ ^digest=sha256:[0-9a-f]{64}$ ]]
  [[ "${cutover_lines[5]}" =~ ^previous_commit=[0-9a-f]{40}$ ]]
  [[ "${cutover_lines[6]}" =~ ^previous_digest=sha256:[0-9a-f]{64}$ ]]
  [[ "${cutover_lines[7]}" =~ ^horizon_state=(running|stopped)$ ]]
  [[ "${cutover_lines[8]}" =~ ^scheduler_state=(running|stopped)$ ]]
  [[ "${cutover_lines[9]}" =~ ^laravel_maintenance_state=(up|down)$ ]]
  [[ "${cutover_lines[10]}" =~ ^maintenance_proof_sha256=[0-9a-f]{64}$ ]]
  [[ "${cutover_lines[11]}" =~ ^runtime_contract_sha256=[0-9a-f]{64}$ ]]
  [[ "${cutover_lines[12]}" =~ ^migration_tree_sha256=[0-9a-f]{64}$ ]]
  [[ "${cutover_lines[13]}" =~ ^retired_operation_ids=($|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})*)$ ]]
  case "$cutover_phase" in
    absent | completed) ;;
    intent | staged | finalizing | recovery_required)
      echo "Deployment-runtime updates are blocked while private-media cutover phase $cutover_phase is active." >&2
      exit 1
      ;;
    *)
      echo "The private-media cutover state is invalid." >&2
      exit 1
      ;;
  esac
fi

if [[ -e "$restore_state" || -L "$restore_state" ]]; then
  restore_state_root="$(dirname "$restore_state")"
  [[ -d "$restore_state_root" && ! -L "$restore_state_root" ]]
  [[ "$(stat -c '%U:%G:%a' "$restore_state_root")" == root:root:700 ]]
  [[ -f "$restore_state" && ! -L "$restore_state" ]]
  [[ "$(stat -c '%U:%G:%a' "$restore_state")" == root:root:600 ]]
  mapfile -t restore_lines <"$restore_state"
  [[ "${#restore_lines[@]}" -eq 9 && "${restore_lines[0]}" == version=1 ]]
  [[ "${restore_lines[1]}" =~ ^phase=(intent|recovery_required|completed)$ ]]
  restore_phase="${BASH_REMATCH[1]}"
  [[ "${restore_lines[2]}" =~ ^operation_id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
  [[ "${restore_lines[3]}" =~ ^release_commit=[0-9a-f]{40}$ ]]
  [[ "${restore_lines[4]}" =~ ^release_digest=sha256:[0-9a-f]{64}$ ]]
  [[ "${restore_lines[5]}" =~ ^database_sha256=[0-9a-f]{64}$ ]]
  [[ "${restore_lines[6]}" =~ ^configuration_sha256=[0-9a-f]{64}$ ]]
  [[ "${restore_lines[7]}" =~ ^started_utc=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
  [[ "${restore_lines[8]}" =~ ^completed_utc=(NONE|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)$ ]]
  if [[ "$restore_phase" != completed ]]; then
    echo "Deployment-runtime updates are blocked by restore-recovery phase $restore_phase." >&2
    exit 1
  fi
fi

sources=(
  "$social_root/scripts/production-runtime-lib.sh"
  "$social_root/scripts/deploy-production-runtime.sh"
  "$social_root/scripts/backup-production-runtime.sh"
  "$social_root/scripts/restore-production-runtime.sh"
  "$social_root/scripts/deploy-production-entrypoint.sh"
)
targets=(
  /usr/local/lib/mochirii-social/production-runtime-lib.sh
  /usr/local/sbin/mochirii-social-deploy
  /usr/local/sbin/mochirii-social-backup
  /usr/local/sbin/mochirii-social-restore
  /usr/local/sbin/mochirii-social-deploy-entry
)
modes=(0644 0755 0755 0755 0755)

for source_path in "${sources[@]}"; do
  [[ -f "$source_path" && ! -L "$source_path" ]]
  bash -n "$source_path"
done
for index in "${!targets[@]}"; do
  target_path="${targets[$index]}"
  [[ -f "$target_path" && ! -L "$target_path" ]] || {
    echo "Expected installed deployment file is missing: $target_path" >&2
    exit 1
  }
  [[ "$(stat -c '%U:%G' "$target_path")" == root:root ]] || {
    echo "Installed deployment files must be owned by root." >&2
    exit 1
  }
  [[ "$(stat -c '%a' "$target_path")" == "${modes[$index]#0}" ]] || {
    echo "An installed deployment file has an unexpected mode: $target_path" >&2
    exit 1
  }
done
if [[ -e "$contract_target" || -L "$contract_target" ]]; then
  [[ -f "$contract_target" && ! -L "$contract_target" ]] || {
    echo "The installed deployment contract is not a regular file." >&2
    exit 1
  }
  [[ "$(stat -c '%U:%G:%a' "$contract_target")" == root:root:444 ]] || {
    echo "The installed deployment contract must be root:root mode 0444." >&2
    exit 1
  }
fi

fsync_path() {
  python3 - "$1" <<'PY'
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

write_sha_manifest() {
  local destination="$1"
  shift
  : >"$destination" || return 1
  for path in "$@"; do
    if [[ -f "$path" && ! -L "$path" ]]; then
      sha256sum "$path" >>"$destination" || return 1
    else
      printf 'ABSENT  %s\n' "$path" >>"$destination" || return 1
    fi
  done
  chown root:root "$destination" || return 1
  chmod 0600 "$destination" || return 1
  fsync_path "$destination" || return 1
}

install_script_atomic() {
  local source_path="$1"
  local target_path="$2"
  local mode="$3"
  local candidate
  candidate="$(mktemp "${target_path}.candidate.XXXXXX")" || return 1
  install -m "$mode" -o root -g root "$source_path" "$candidate" || return 1
  bash -n "$candidate" || return 1
  fsync_path "$candidate" || return 1
  mv -T "$candidate" "$target_path" || return 1
  fsync_path "$(dirname "$target_path")" || return 1
}

install_contract_atomic() {
  local source_path="$1"
  local target_path="$2"
  local candidate
  candidate="$(mktemp "${target_path}.candidate.XXXXXX")" || return 1
  install -m 0444 -o root -g root "$source_path" "$candidate" || return 1
  fsync_path "$candidate" || return 1
  mv -T "$candidate" "$target_path" || return 1
  fsync_path "$(dirname "$target_path")" || return 1
}

if [[ -e "$update_state_root" || -L "$update_state_root" ]]; then
  [[ -d "$update_state_root" && ! -L "$update_state_root" ]] || {
    echo "The deployment-runtime update state directory is invalid." >&2
    exit 1
  }
else
  install -d -m 0700 -o root -g root "$update_state_root"
fi
[[ "$(stat -c '%U:%G:%a' "$update_state_root")" == root:root:700 ]] || {
  echo "The deployment-runtime update state directory must be root:root mode 0700." >&2
  exit 1
}

validate_update_state() {
  local -a lines
  [[ -f "$update_state" && ! -L "$update_state" ]] || return 1
  [[ "$(stat -c '%U:%G:%a' "$update_state")" == root:root:600 ]] || return 1
  mapfile -t lines <"$update_state" || return 1
  [[ "${#lines[@]}" -eq 8 ]] || return 1
  [[ "${lines[0]}" == version=1 ]] || return 1
  [[ "${lines[1]}" =~ ^phase=(intent|completed|recovered|recovery_required)$ ]] || return 1
  [[ "${lines[2]}" =~ ^operation_id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || return 1
  [[ "${lines[3]}" =~ ^commit=[0-9a-f]{40}$ ]] || return 1
  [[ "${lines[4]}" =~ ^backup_root=/[^[:cntrl:]]+$ ]] || return 1
  [[ "${lines[5]}" =~ ^before_manifest_sha256=[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[6]}" =~ ^after_manifest_sha256=(NONE|[0-9a-f]{64})$ ]] || return 1
  [[ "${lines[7]}" =~ ^retired_operation_ids=($|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})*)$ ]] || return 1
  local state_operation_id="${lines[2]#operation_id=}"
  local state_commit="${lines[3]#commit=}"
  local state_backup_root="${lines[4]#backup_root=}"
  [[ "$state_backup_root" == "$runtime_backup_root/deploy-runtime-$state_commit-$state_operation_id" ]] || return 1
}

update_state_value() {
  sed -n "s/^$1=//p" "$update_state" || return 1
}

write_update_state() {
  local phase="$1"
  local state_operation_id="$2"
  local state_commit="$3"
  local backup_root="$4"
  local before_sha256="$5"
  local after_sha256="$6"
  local retired_operation_ids="$7"
  local candidate
  candidate="$(mktemp "$update_state_root/.update.state.XXXXXX")" || return 1
  printf '%s\n' \
    version=1 \
    "phase=$phase" \
    "operation_id=$state_operation_id" \
    "commit=$state_commit" \
    "backup_root=$backup_root" \
    "before_manifest_sha256=$before_sha256" \
    "after_manifest_sha256=$after_sha256" \
    "retired_operation_ids=$retired_operation_ids" >"$candidate" || return 1
  chown root:root "$candidate" || return 1
  chmod 0600 "$candidate" || return 1
  fsync_path "$candidate" || return 1
  mv -T "$candidate" "$update_state" || return 1
  fsync_path "$update_state_root" || return 1
  validate_update_state || return 1
}

append_retired_operation() {
  local list="$1"
  local retired="$2"
  if [[ ",$list," == *",$retired,"* ]]; then
    printf '%s\n' "$list"
  elif [[ -n "$list" ]]; then
    printf '%s,%s\n' "$list" "$retired"
  else
    printf '%s\n' "$retired"
  fi
}

validate_backup_snapshot() {
  local backup_root="$1"
  local snapshot_commit="$2"
  local snapshot_operation_id="$3"
  local expected_manifest_sha256="$4"
  local before_manifest="$backup_root/before.sha256"
  local expected_backup_root="$runtime_backup_root/deploy-runtime-$snapshot_commit-$snapshot_operation_id"
  local index
  local expected_hash
  local expected_path
  local -a manifest_lines

  [[ "$backup_root" == "$expected_backup_root" ]] || return 1
  [[ -d "$backup_root" && ! -L "$backup_root" ]] || return 1
  [[ "$(stat -c '%U:%G:%a' "$backup_root")" == root:root:700 ]] || return 1
  [[ -f "$before_manifest" && ! -L "$before_manifest" ]] || return 1
  [[ "$(stat -c '%U:%G:%a' "$before_manifest")" == root:root:600 ]] || return 1
  [[ "$(sha256sum "$before_manifest" | cut -d' ' -f1)" == "$expected_manifest_sha256" ]] || return 1
  mapfile -t manifest_lines <"$before_manifest" || return 1
  [[ "${#manifest_lines[@]}" -eq 6 ]] || return 1

  for index in "${!targets[@]}"; do
    expected_path="${targets[$index]}"
    [[ "${manifest_lines[$index]}" =~ ^([0-9a-f]{64})\ \ (/.+)$ ]] || return 1
    expected_hash="${BASH_REMATCH[1]}"
    [[ "${BASH_REMATCH[2]}" == "$expected_path" ]] || return 1
    [[ -f "$backup_root/$index" && ! -L "$backup_root/$index" ]] || return 1
    [[ "$(stat -c '%U:%G:%a' "$backup_root/$index")" == "root:root:${modes[$index]#0}" ]] || return 1
    [[ "$(sha256sum "$backup_root/$index" | cut -d' ' -f1)" == "$expected_hash" ]] || return 1
  done

  if [[ "${manifest_lines[5]}" =~ ^([0-9a-f]{64})\ \ (/.+)$ ]]; then
    expected_hash="${BASH_REMATCH[1]}"
    [[ "${BASH_REMATCH[2]}" == "$contract_target" ]] || return 1
    [[ -f "$backup_root/contract" && ! -L "$backup_root/contract" ]] || return 1
    [[ "$(stat -c '%U:%G:%a' "$backup_root/contract")" == root:root:444 ]] || return 1
    [[ "$(sha256sum "$backup_root/contract" | cut -d' ' -f1)" == "$expected_hash" ]] || return 1
    [[ ! -e "$backup_root/contract.absent" && ! -L "$backup_root/contract.absent" ]] || return 1
  else
    [[ "${manifest_lines[5]}" == "ABSENT  $contract_target" ]] || return 1
    [[ -f "$backup_root/contract.absent" && ! -L "$backup_root/contract.absent" ]] || return 1
    [[ "$(stat -c '%U:%G:%a' "$backup_root/contract.absent")" == root:root:600 ]] || return 1
    [[ ! -s "$backup_root/contract.absent" ]] || return 1
    [[ ! -e "$backup_root/contract" && ! -L "$backup_root/contract" ]] || return 1
  fi
}

restore_from_backup() {
  local backup_root="$1"
  local snapshot_commit="$2"
  local snapshot_operation_id="$3"
  local expected_manifest_sha256="$4"
  local restore_failed=false
  validate_backup_snapshot \
    "$backup_root" \
    "$snapshot_commit" \
    "$snapshot_operation_id" \
    "$expected_manifest_sha256" || return 1
  # Restore supporting files first. Until the old forced entrypoint is restored
  # last, any mixed contract/runtime snapshot fails closed rather than invoking
  # an entrypoint against incompatible helpers.
  for index in 0 1 2 3; do
    install_script_atomic "$backup_root/$index" "${targets[$index]}" "${modes[$index]}" || restore_failed=true
  done
  if [[ -f "$backup_root/contract" ]]; then
    install_contract_atomic "$backup_root/contract" "$contract_target" || restore_failed=true
  elif [[ -f "$backup_root/contract.absent" ]]; then
    rm -f "$contract_target" || restore_failed=true
    fsync_path "$(dirname "$contract_target")" || restore_failed=true
  else
    restore_failed=true
  fi
  install_script_atomic "$backup_root/4" "${targets[4]}" "${modes[4]}" || restore_failed=true
  write_sha_manifest "$backup_root/rollback.sha256" "${targets[@]}" "$contract_target" || restore_failed=true
  cmp -s "$backup_root/before.sha256" "$backup_root/rollback.sha256" || restore_failed=true
  [[ "$restore_failed" == false ]]
}

retired_operation_ids=""
if [[ -e "$update_state" || -L "$update_state" ]]; then
  validate_update_state || {
    echo "The deployment-runtime update state is invalid." >&2
    exit 1
  }
  state_phase="$(update_state_value phase)"
  state_operation_id="$(update_state_value operation_id)"
  state_commit="$(update_state_value commit)"
  state_backup_root="$(update_state_value backup_root)"
  retired_operation_ids="$(update_state_value retired_operation_ids)"
  case "$state_phase" in
    intent)
      [[ "$state_operation_id" == "$operation_id" && "$state_commit" == "$expected_commit" ]] || {
        echo "An interrupted deployment-runtime update requires its original operation ID." >&2
        exit 1
      }
      state_before_manifest_sha256="$(update_state_value before_manifest_sha256)"
      if restore_from_backup \
        "$state_backup_root" \
        "$state_commit" \
        "$state_operation_id" \
        "$state_before_manifest_sha256"; then
        retired_operation_ids="$(append_retired_operation "$retired_operation_ids" "$operation_id")"
        write_update_state recovered "$operation_id" "$expected_commit" "$state_backup_root" \
          "$state_before_manifest_sha256" NONE "$retired_operation_ids"
        echo "Recovered an interrupted deployment-runtime update; submit a fresh operation ID." >&2
      else
        write_update_state recovery_required "$operation_id" "$expected_commit" "$state_backup_root" \
          "$state_before_manifest_sha256" NONE "$retired_operation_ids" || true
        echo "Deployment-runtime recovery is incomplete." >&2
      fi
      exit 1
      ;;
    recovery_required)
      echo "Deployment-runtime update is blocked by recovery_required state." >&2
      exit 1
      ;;
    completed)
      if [[ "$state_operation_id" == "$operation_id" && "$state_commit" == "$expected_commit" ]]; then
        current_manifest="$(mktemp)"
        write_sha_manifest "$current_manifest" "${targets[@]}" "$contract_target"
        [[ "$(sha256sum "$current_manifest" | cut -d' ' -f1)" == "$(update_state_value after_manifest_sha256)" ]]
        verify_contract_commit="$(sed -n 's/^installed_from_commit=//p' "$contract_target")"
        [[ "$verify_contract_commit" == "$expected_commit" ]]
        rm -f "$current_manifest"
        echo "Deployment runtime update is already complete and verified."
        exit 0
      fi
      ;;
    recovered) ;;
  esac
fi

if [[ ",$retired_operation_ids," == *",$operation_id,"* ]]; then
  echo "The deployment-runtime update operation ID has already been consumed." >&2
  exit 1
fi

if [[ -e "$runtime_backup_root" || -L "$runtime_backup_root" ]]; then
  [[ -d "$runtime_backup_root" && ! -L "$runtime_backup_root" ]] || {
    echo "The deployment-runtime backup directory is invalid." >&2
    exit 1
  }
else
  install -d -m 0700 -o root -g root "$runtime_backup_root"
fi
[[ "$(stat -c '%U:%G:%a' "$runtime_backup_root")" == root:root:700 ]] || {
  echo "The deployment-runtime backup directory must be root:root mode 0700." >&2
  exit 1
}

backup_root="$runtime_backup_root/deploy-runtime-$expected_commit-$operation_id"
if [[ ! -e "$backup_root" && ! -L "$backup_root" ]]; then
  backup_candidate="$(mktemp -d "$runtime_backup_root/.deploy-runtime-$expected_commit-$operation_id.XXXXXX")"
  chmod 0700 "$backup_candidate"
  chown root:root "$backup_candidate"
  write_sha_manifest "$backup_candidate/before.sha256" "${targets[@]}" "$contract_target"
  for index in "${!targets[@]}"; do
    install -m "${modes[$index]}" -o root -g root "${targets[$index]}" "$backup_candidate/$index"
    fsync_path "$backup_candidate/$index"
  done
  if [[ -f "$contract_target" && ! -L "$contract_target" ]]; then
    install -m 0444 -o root -g root "$contract_target" "$backup_candidate/contract"
    fsync_path "$backup_candidate/contract"
  else
    : >"$backup_candidate/contract.absent"
    chmod 0600 "$backup_candidate/contract.absent"
    fsync_path "$backup_candidate/contract.absent"
  fi
  fsync_path "$backup_candidate"
  mv -T "$backup_candidate" "$backup_root"
  fsync_path "$runtime_backup_root"
  before_sha256="$(sha256sum "$backup_root/before.sha256" | cut -d' ' -f1)"
  validate_backup_snapshot "$backup_root" "$expected_commit" "$operation_id" "$before_sha256"
else
  [[ -d "$backup_root" && ! -L "$backup_root" && "$(stat -c '%U:%G:%a' "$backup_root")" == root:root:700 ]]
  before_sha256="$(sha256sum "$backup_root/before.sha256" | cut -d' ' -f1)"
  validate_backup_snapshot "$backup_root" "$expected_commit" "$operation_id" "$before_sha256"
  current_manifest="$(mktemp)"
  write_sha_manifest "$current_manifest" "${targets[@]}" "$contract_target"
  cmp -s "$backup_root/before.sha256" "$current_manifest"
  rm -f "$current_manifest"
fi

before_sha256="$(sha256sum "$backup_root/before.sha256" | cut -d' ' -f1)"
write_update_state intent "$operation_id" "$expected_commit" "$backup_root" "$before_sha256" NONE "$retired_operation_ids"

updated=true
rollback() {
  local exit_code=$?
  local rollback_failed=false
  trap - EXIT
  if [[ "$updated" == true && "$exit_code" -ne 0 ]]; then
    if restore_from_backup "$backup_root" "$expected_commit" "$operation_id" "$before_sha256"; then
      retired_operation_ids="$(append_retired_operation "$retired_operation_ids" "$operation_id")"
      write_update_state recovered "$operation_id" "$expected_commit" "$backup_root" \
        "$before_sha256" NONE "$retired_operation_ids" || rollback_failed=true
    else
      write_update_state recovery_required "$operation_id" "$expected_commit" "$backup_root" \
        "$before_sha256" NONE "$retired_operation_ids" || true
      rollback_failed=true
    fi
  fi
  if [[ "$rollback_failed" == true ]]; then
    echo "Deployment-runtime update rollback was incomplete; preserve $backup_root for manual recovery." >&2
    exit 1
  fi
  exit "$exit_code"
}
trap rollback EXIT

# Install all non-entrypoint scripts first. The forced entrypoint is always last.
for index in 0 1 2 3; do
  install_script_atomic "${sources[$index]}" "${targets[$index]}" "${modes[$index]}"
done

contract_manifest="$(mktemp "$backup_root/.contract-manifest.XXXXXX")"
: >"$contract_manifest"
for index in "${!sources[@]}"; do
  printf '%s  %s\n' \
    "$(sha256sum "${sources[$index]}" | cut -d' ' -f1)" \
    "${targets[$index]}" \
    >>"$contract_manifest"
done
contract_sha256="$(sha256sum "$contract_manifest" | cut -d' ' -f1)"
contract_candidate="$(mktemp "$backup_root/.contract.XXXXXX")"
{
  printf '%s\n' \
    version=2 \
    "installed_from_commit=$expected_commit" \
    "contract_sha256=$contract_sha256"
  cat "$contract_manifest"
} >"$contract_candidate"
rm -f "$contract_manifest"
chown root:root "$contract_candidate"
chmod 0444 "$contract_candidate"
fsync_path "$contract_candidate"
install_contract_atomic "$contract_candidate" "$contract_target"
rm -f "$contract_candidate"

install_script_atomic "${sources[4]}" "${targets[4]}" "${modes[4]}"

# Self-check all five installed files and their deterministic contract.
# shellcheck source=/dev/null
source /usr/local/lib/mochirii-social/production-runtime-lib.sh
verify_installed_deploy_runtime_contract "$contract_sha256"
for target_path in "${targets[@]}"; do
  bash -n "$target_path"
done
write_sha_manifest "$backup_root/after.sha256" "${targets[@]}" "$contract_target"
after_sha256="$(sha256sum "$backup_root/after.sha256" | cut -d' ' -f1)"
retired_operation_ids="$(append_retired_operation "$retired_operation_ids" "$operation_id")"
write_update_state completed "$operation_id" "$expected_commit" "$backup_root" \
  "$before_sha256" "$after_sha256" "$retired_operation_ids"

updated=false
echo "Installed deployment runtime contract $contract_sha256 from $expected_commit; no service was restarted or reloaded."
