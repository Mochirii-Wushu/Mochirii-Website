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

acquire_deploy_lock() {
  mkdir -p "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || {
    echo "Another Mochirii Social deployment or recovery operation is active." >&2
    exit 1
  }
}

if [[ "${1:-}" == "--verify-online-hosting" ]]; then
  [[ "$#" -eq 1 ]] || {
    echo "Online-hosting verification accepts no additional arguments." >&2
    exit 1
  }
  acquire_deploy_lock
  verify_installed_deploy_runtime_contract
  verify_online_hosting
  exit 0
fi

if [[ "${1:-}" == "--verify-closed-stage" ]]; then
  operation_id="${2:-}"
  expected_commit="${3:-}"
  expected_digest="${4:-}"
  [[ "$#" -eq 4 ]] || {
    echo "Closed-stage verification requires an operation ID, commit, and image digest." >&2
    exit 1
  }
  validate_operation_id "$operation_id"
  validate_commit "$expected_commit"
  validate_digest "$expected_digest"
  acquire_deploy_lock
  reject_active_restore_state "Closed-stage verification"
  require_root_owned_state_directory
  validate_private_media_cutover_state "$operation_id" "$expected_commit" "$expected_digest"
  phase="$(cutover_state_value phase)"
  [[ "$phase" == staged || "$phase" == finalizing ]] || {
    echo "Closed-stage verification requires staged or finalizing state." >&2
    exit 1
  }
  runtime_contract_sha256="$(cutover_state_value runtime_contract_sha256)"
  verify_private_media_state_bindings "$runtime_contract_sha256"
  verify_private_media_migration_tree_parity \
    "$(cutover_state_value digest)" \
    "$(cutover_state_value previous_digest)" \
    "$(cutover_state_value migration_tree_sha256)"
  verify_staged_private_media_gateway_local "$(cutover_state_value digest)"
  verify_public_closed_application_boundary "$operation_id"
  echo "Closed private-media stage verification passed."
  exit 0
fi

if [[ "${1:-}" == "--verify-finalization-ready" ]]; then
  operation_id="${2:-}"
  expected_commit="${3:-}"
  expected_digest="${4:-}"
  [[ "$#" -eq 4 ]] || {
    echo "Finalization-ready verification requires an operation ID, commit, and image digest." >&2
    exit 1
  }
  validate_operation_id "$operation_id"
  validate_commit "$expected_commit"
  validate_digest "$expected_digest"
  acquire_deploy_lock
  reject_active_restore_state "Finalization-ready verification"
  require_root_owned_state_directory
  validate_private_media_cutover_state "$operation_id" "$expected_commit" "$expected_digest"
  phase="$(cutover_state_value phase)"
  runtime_contract_sha256="$(cutover_state_value runtime_contract_sha256)"
  verify_private_media_state_bindings "$runtime_contract_sha256"
  verify_private_media_migration_tree_parity \
    "$expected_digest" \
    "$(cutover_state_value previous_digest)" \
    "$(cutover_state_value migration_tree_sha256)"
  candidate_release="$(release_dir_for "$expected_commit")"
  previous_release="$(release_dir_for "$(cutover_state_value previous_commit)")"
  current_target="$(readlink -f "$CURRENT_LINK")"
  [[ "$current_target" == "$previous_release" || "$current_target" == "$candidate_release" ]] || {
    echo "The current release is outside the exact finalization recovery set." >&2
    exit 1
  }

  case "$phase" in
    staged)
      verify_staged_private_media_gateway_local "$expected_digest"
      verify_public_closed_application_boundary "$operation_id"
      ;;
    finalizing)
      laravel_state="$(laravel_maintenance_state)"
      if [[ "$laravel_state" == down ]]; then
        verify_staged_private_media_gateway_local "$expected_digest"
        verify_public_closed_application_boundary "$operation_id"
      elif [[ "$laravel_state" == up ]]; then
        verify_permanent_private_media_runtime "$expected_digest"
        for worker_name in pixelfed-horizon pixelfed-scheduler; do
          worker_state="$(container_runtime_state "$worker_name")"
          [[ "$worker_state" == running || "$worker_state" == stopped ]]
          if [[ "$worker_state" == running ]]; then
            verify_named_container_image "$worker_name" "$expected_digest"
          fi
        done
      else
        echo "The finalizing application state is ambiguous." >&2
        exit 1
      fi
      ;;
    completed)
      [[ "$current_target" == "$candidate_release" ]]
      verify_runtime
      verify_exact_runtime_images "$expected_digest"
      verify_permanent_private_media_runtime "$expected_digest"
      ;;
    *)
      echo "Finalization-ready verification rejects cutover phase $phase." >&2
      exit 1
      ;;
  esac
  echo "Exact private-media finalization readiness passed for phase $phase."
  exit 0
fi

bundle_path="${1:-}"
commit="${2:-}"
digest="${3:-}"
migration_approval="${4:-NONE}"
deployment_mode="${5:-NOT_AUTHORIZED}"
operation_id="${6:-}"

validate_commit "$commit"
validate_digest "$digest"
validate_operation_id "$operation_id"
[[ "$migration_approval" == "NONE" || "$migration_approval" == "MIGRATIONS_APPROVED" ]] || {
  echo "Migration approval must be NONE or MIGRATIONS_APPROVED." >&2
  exit 1
}
case "$deployment_mode" in
  STAGE_PRIVATE_MEDIA_GATEWAY_UNDER_MAINTENANCE)
    [[ "$migration_approval" == "NONE" ]] || {
      echo "Private-media gateway staging permits only migration approval NONE." >&2
      exit 1
    }
    ;;
  FINALIZE_PRIVATE_MEDIA_GATEWAY_AFTER_VERIFIED_CUTOVER)
    [[ "$migration_approval" == "NONE" ]] || {
      echo "Private-media gateway finalization permits only migration approval NONE." >&2
      exit 1
    }
    ;;
  ANONYMOUS_DENIAL_AND_CUTOVER_VERIFIED)
    ;;
  *)
    echo "A reviewed deployment mode is required." >&2
    exit 1
    ;;
esac
[[ -f "$bundle_path" ]] || {
  echo "The release bundle is missing." >&2
  exit 1
}

mkdir -p "$RELEASES_ROOT"
acquire_deploy_lock
require_root_owned_state_directory
verify_installed_deploy_runtime_contract
reject_active_restore_state "Deployment"

stage_dir="$(mktemp -d "$RUNTIME_ROOT/.release-${commit}.XXXXXX")"
stage_rollback_armed=false
finalization_fail_closed_armed=false
ordinary_fail_closed_armed=false
finalization_completed_replay=false
release_dir="$(release_dir_for "$commit")"

restore_worker_state() {
  local release_path="$1"
  local service_name="$2"
  local container_name="$3"
  local desired_state="$4"
  case "$desired_state" in
    running)
      compose_release "$release_path" up --detach --no-build --no-deps "$service_name" || return 1
      wait_for_container_health "$container_name" 180 || return 1
      ;;
    stopped)
      compose_release "$release_path" stop --timeout 90 "$service_name" >/dev/null || return 1
      wait_for_container_stopped "$container_name" 90 || return 1
      ;;
    *)
      echo "Unsupported captured worker state: $desired_state" >&2
      return 1
      ;;
  esac
}

close_finalizing_runtime() {
  enforce_fail_closed_runtime "$release_dir" "$operation_id"
}

verify_restored_runtime_policy() {
  docker exec pixelfed-app php artisan tinker --execute="
    if (
      config('pixelfed.open_registration') ||
      config('federation.activitypub.enabled') ||
      !config('pixelfed.cloud_storage') ||
      config('filesystems.cloud') !== 's3'
    ) {
      throw new RuntimeException('Restored runtime policy gate failed.');
    }
  " >/dev/null || return 1
}

verify_restored_stage_rollback() {
  local expected_digest="$1"
  local horizon_state="$2"
  local scheduler_state="$3"
  local laravel_state="$4"
  local rollback_operation_id="$5"

  verify_worker_state pixelfed-horizon "$horizon_state" || return 1
  verify_worker_state pixelfed-scheduler "$scheduler_state" || return 1
  verify_exact_runtime_images "$expected_digest" || return 1
  verify_restored_runtime_policy || return 1

  case "$laravel_state" in
    up)
      [[ "$horizon_state" == running && "$scheduler_state" == running ]] || {
        echo "A live restored runtime requires both captured workers to be running." >&2
        return 1
      }
      verify_runtime_local || return 1
      ;;
    down)
      wait_for_container_running pixelfed-app 120 || return 1
      verify_exact_container_image "$expected_digest" || return 1
      [[ "$(laravel_maintenance_state)" == down ]] || {
        echo "The restored prior runtime did not retain its captured maintenance state." >&2
        return 1
      }
      ;;
    *)
      echo "Unsupported captured Laravel state: $laravel_state" >&2
      return 1
      ;;
  esac

  # The separately installed external boundary remains in place throughout an
  # automatic rollback. Only its separately approved provider packet may
  # reopen the public site after the restored prior runtime is accepted.
  verify_public_maintenance_boundary "$rollback_operation_id" || return 1
}

rollback_private_media_stage() {
  local rollback_failed=false
  local state_previous_commit
  local state_previous_digest
  local state_previous_release
  local state_horizon
  local state_scheduler
  local state_laravel

  validate_private_media_cutover_state "$operation_id" "$commit" "$digest" "$migration_tree_sha256" || return 1
  local rollback_phase
  rollback_phase="$(cutover_state_value phase)" || return 1
  [[ "$rollback_phase" == intent ]] || {
    echo "Automatic stage rollback is permitted only from intent state." >&2
    return 1
  }
  state_previous_commit="$(cutover_state_value previous_commit)" || return 1
  state_previous_digest="$(cutover_state_value previous_digest)" || return 1
  state_previous_release="$(release_dir_for "$state_previous_commit")" || return 1
  state_horizon="$(cutover_state_value horizon_state)" || return 1
  state_scheduler="$(cutover_state_value scheduler_state)" || return 1
  state_laravel="$(cutover_state_value laravel_maintenance_state)" || return 1

  echo "Restoring the exact prior Social runtime behind maintenance." >&2
  if [[ -f "$release_dir/release.env" ]]; then
    compose_release "$release_dir" stop --timeout 90 pixelfed >/dev/null 2>&1 || rollback_failed=true
  fi
  compose_release "$state_previous_release" up --detach --no-build --no-deps pixelfed || rollback_failed=true
  wait_for_container_running pixelfed-app 120 || rollback_failed=true
  verify_exact_container_image "$state_previous_digest" || rollback_failed=true
  docker exec pixelfed-app php artisan down --retry=60 --no-ansi >/dev/null || rollback_failed=true
  compose_release "$state_previous_release" stop --timeout 90 horizon scheduler >/dev/null 2>&1 || rollback_failed=true
  wait_for_container_stopped pixelfed-horizon 90 || rollback_failed=true
  wait_for_container_stopped pixelfed-scheduler 90 || rollback_failed=true
  verify_restored_runtime_policy || rollback_failed=true
  verify_public_maintenance_boundary "$operation_id" || rollback_failed=true

  if [[ "$rollback_failed" == false ]]; then
    case "$state_laravel" in
      up)
        docker exec pixelfed-app php artisan up --no-ansi >/dev/null || rollback_failed=true
        ;;
      down)
        ;;
      *)
        rollback_failed=true
        ;;
    esac
    restore_worker_state "$state_previous_release" horizon pixelfed-horizon "$state_horizon" || rollback_failed=true
    restore_worker_state "$state_previous_release" scheduler pixelfed-scheduler "$state_scheduler" || rollback_failed=true
    verify_restored_stage_rollback \
      "$state_previous_digest" \
      "$state_horizon" \
      "$state_scheduler" \
      "$state_laravel" \
      "$operation_id" || rollback_failed=true
  fi

  if [[ "$rollback_failed" == true ]]; then
    enforce_fail_closed_runtime "$state_previous_release" "$operation_id" || true
    if transition_private_media_cutover_phase intent recovery_required; then
      echo "Private-media stage recovery is incomplete; durable recovery_required state was retained." >&2
    else
      echo "Private-media stage recovery is incomplete and the durable recovery_required transition could not be proven." >&2
    fi
    return 1
  fi

  retire_recovered_private_media_cutover_intent || return 1
  echo "The exact prior image and captured worker state were restored; submit a fresh operation ID before retrying." >&2
}

cleanup() {
  local exit_code=$?
  local visible_phase
  local phase_transition_proven
  trap - EXIT
  if [[ "$exit_code" -ne 0 && "$stage_rollback_armed" == true ]]; then
    stage_rollback_armed=false
    rollback_private_media_stage || true
  fi
  if [[ "$exit_code" -ne 0 && "$finalization_fail_closed_armed" == true ]]; then
    finalization_fail_closed_armed=false
    visible_phase=""
    phase_transition_proven=true
    if ! visible_phase="$(private_media_cutover_phase 2>/dev/null)"; then
      phase_transition_proven=false
    fi
    if close_finalizing_runtime; then
      if [[ "$phase_transition_proven" != true ]]; then
        :
      elif [[ "$visible_phase" == completed ]]; then
        transition_private_media_cutover_phase completed finalizing || {
          transition_private_media_cutover_phase completed recovery_required || phase_transition_proven=false
        }
      elif [[ "$visible_phase" != finalizing ]]; then
        transition_private_media_cutover_phase "$visible_phase" recovery_required || phase_transition_proven=false
      fi
      if [[ "$phase_transition_proven" == true ]]; then
        echo "Finalization remains safely closed and its durable recovery state was retained." >&2
      else
        echo "Finalization is closed, but its durable recovery state could not be proven." >&2
      fi
    else
      case "$visible_phase" in
        finalizing | completed)
          transition_private_media_cutover_phase "$visible_phase" recovery_required || phase_transition_proven=false
          ;;
        *) phase_transition_proven=false ;;
      esac
      if [[ "$phase_transition_proven" == true ]]; then
        echo "Finalization could not prove a closed runtime; recovery_required state was retained." >&2
      else
        echo "Finalization could not prove a closed runtime or a durable recovery_required transition." >&2
      fi
    fi
  fi
  if [[ "$exit_code" -ne 0 && "$ordinary_fail_closed_armed" == true ]]; then
    rollback_image || true
  fi
  rm -rf "$stage_dir"
  rm -f "$bundle_path"
  exit "$exit_code"
}
trap cleanup EXIT

extract_validated_release_bundle "$bundle_path" "$stage_dir"
[[ "$(wc -l <"$stage_dir/release.meta")" -eq 5 ]] || {
  echo "The release metadata has an unexpected field count." >&2
  exit 1
}
grep -Fxq "commit=$commit" "$stage_dir/release.meta"
grep -Fxq "digest=$digest" "$stage_dir/release.meta"
grep -Fxq "repository=Mochirii-Wushu/Mochirii-Website" "$stage_dir/release.meta"
migration_tree_sha256="$(sed -n 's/^migration_tree_sha256=//p' "$stage_dir/release.meta")"
runtime_contract_sha256="$(sed -n 's/^runtime_contract_sha256=//p' "$stage_dir/release.meta")"
validate_sha256 "$migration_tree_sha256"
validate_sha256 "$runtime_contract_sha256"
[[ "$(grep -c '^migration_tree_sha256=' "$stage_dir/release.meta")" -eq 1 ]]
[[ "$(grep -c '^runtime_contract_sha256=' "$stage_dir/release.meta")" -eq 1 ]]
verify_installed_deploy_runtime_contract "$runtime_contract_sha256"

accepted_compose="$SHARED_ROOT/docker-compose.production.yml"
[[ -f "$accepted_compose" && ! -L "$accepted_compose" ]] || {
  echo "The root-owned production Compose template is missing." >&2
  exit 1
}
cmp -s "$stage_dir/docker-compose.production.yml" "$accepted_compose" || {
  echo "The release Compose file does not match the approved host template." >&2
  exit 1
}
if grep -Eq '^[[:space:]]*build:' "$stage_dir/docker-compose.production.yml"; then
  echo "Production Compose must not contain build directives." >&2
  exit 1
fi

[[ -f "$SHARED_ROOT/pixelfed.env" ]] || {
  echo "The root-owned Pixelfed environment is missing." >&2
  exit 1
}
[[ -L "$CURRENT_LINK" ]] || {
  echo "The online runtime must be bootstrapped before GitHub deployments." >&2
  exit 1
}
current_release="$(readlink -f "$CURRENT_LINK")"
case "$current_release" in
  "$RELEASES_ROOT"/*) ;;
  *)
    echo "The current release resolves outside the approved releases directory." >&2
    exit 1
    ;;
esac
[[ -f "$current_release/release.env" && -f "$current_release/release.meta" ]] || {
  echo "The current release metadata is incomplete." >&2
  exit 1
}
current_commit="$(release_metadata_value "$current_release" commit)"
current_digest="$(release_metadata_value "$current_release" digest)"
validate_commit "$current_commit"
validate_digest "$current_digest"

phase="$(private_media_cutover_phase)"
retired_operation_ids=""
if [[ -f "$PRIVATE_MEDIA_CUTOVER_STATE" ]]; then
  retired_operation_ids="$(cutover_state_value retired_operation_ids)"
fi
initial_private_media_stage=false
finalize_private_media_stage=false
ordinary_deployment=false

if [[ "$deployment_mode" == STAGE_PRIVATE_MEDIA_GATEWAY_UNDER_MAINTENANCE ]]; then
  require_private_media_maintenance_proof
  verify_public_maintenance_boundary "$operation_id"
  case "$phase" in
    absent)
      assert_private_media_operation_available "$operation_id"
      initial_private_media_stage=true
      ;;
    intent)
      validate_private_media_cutover_state "$operation_id" "$commit" "$digest" "$migration_tree_sha256"
      verify_private_media_state_bindings "$runtime_contract_sha256"
      stage_rollback_armed=false
      rollback_private_media_stage
      echo "Recovered an interrupted private-media stage; a fresh dispatch is required." >&2
      exit 1
      ;;
    staged)
      echo "A private-media gateway stage is already pending; replay is not allowed." >&2
      exit 1
      ;;
    completed)
      echo "The one-time private-media gateway bootstrap has already completed." >&2
      exit 1
      ;;
    finalizing | recovery_required)
      echo "Private-media gateway staging is blocked by cutover phase $phase." >&2
      exit 1
      ;;
  esac
elif [[ "$deployment_mode" == FINALIZE_PRIVATE_MEDIA_GATEWAY_AFTER_VERIFIED_CUTOVER ]]; then
  case "$phase" in
    staged | finalizing)
      validate_private_media_cutover_state "$operation_id" "$commit" "$digest" "$migration_tree_sha256"
      verify_private_media_state_bindings "$runtime_contract_sha256"
      finalize_private_media_stage=true
      ;;
    completed)
      validate_private_media_cutover_state "$operation_id" "$commit" "$digest" "$migration_tree_sha256"
      verify_private_media_state_bindings "$runtime_contract_sha256"
      finalization_completed_replay=true
      finalize_private_media_stage=true
      ;;
    absent)
      echo "Private-media finalization requires the exact staged operation." >&2
      exit 1
      ;;
    intent | recovery_required)
      echo "Permanent deployment is blocked by private-media cutover phase $phase." >&2
      exit 1
      ;;
  esac
else
  case "$phase" in
    completed)
      ordinary_deployment=true
      ;;
    absent)
      echo "Permanent deployment is blocked until the private-media bootstrap completes." >&2
      exit 1
      ;;
    intent | staged | finalizing | recovery_required)
      echo "Ordinary deployment is blocked by private-media cutover phase $phase." >&2
      exit 1
      ;;
  esac
fi

if [[ "$initial_private_media_stage" == true ]]; then
  verify_exact_runtime_images "$current_digest"
  captured_horizon_state="$(container_runtime_state pixelfed-horizon)"
  captured_scheduler_state="$(container_runtime_state pixelfed-scheduler)"
  captured_laravel_state="$(laravel_maintenance_state)"
  [[ "$captured_horizon_state" == running && "$captured_scheduler_state" == running && "$captured_laravel_state" == up ]] || {
    echo "The application and both production workers must be active before the one-time gateway stage." >&2
    exit 1
  }
  maintenance_proof_sha256="$(private_media_maintenance_proof_sha256)"
  write_private_media_cutover_state \
    intent \
    "$operation_id" \
    "$commit" \
    "$digest" \
    "$current_commit" \
    "$current_digest" \
    "$captured_horizon_state" \
    "$captured_scheduler_state" \
    "$captured_laravel_state" \
    "$maintenance_proof_sha256" \
    "$runtime_contract_sha256" \
    "$migration_tree_sha256" \
    "$retired_operation_ids"
  stage_rollback_armed=true
fi

if [[ -e "$release_dir" ]]; then
  [[ -d "$release_dir" && ! -L "$release_dir" ]]
  grep -Fxq "commit=$commit" "$release_dir/release.meta"
  grep -Fxq "digest=$digest" "$release_dir/release.meta"
  grep -Fxq "migration_tree_sha256=$migration_tree_sha256" "$release_dir/release.meta"
  grep -Fxq "runtime_contract_sha256=$runtime_contract_sha256" "$release_dir/release.meta"
else
  install -d -m 0750 -o root -g root "$release_dir"
  install -m 0644 -o root -g root "$accepted_compose" "$release_dir/docker-compose.production.yml"
  install -m 0644 -o root -g root "$stage_dir/release.meta" "$release_dir/release.meta"
  cat >"$release_dir/release.env" <<EOF
PIXELFED_IMAGE=$REGISTRY_IMAGE@$digest
PIXELFED_ENV_FILE=$SHARED_ROOT/pixelfed.env
PIXELFED_DATA_ROOT=$DATA_ROOT
EOF
  chown root:root "$release_dir/release.env"
  chmod 0640 "$release_dir/release.env"
fi

pull_release_image "$REGISTRY_IMAGE@$digest"
compose_release "$release_dir" config --quiet
if [[ "$initial_private_media_stage" == true ]]; then
  verify_private_media_migration_tree_parity "$digest" "$current_digest" "$migration_tree_sha256"
elif [[ "$finalize_private_media_stage" == true ]]; then
  verify_private_media_migration_tree_parity \
    "$digest" \
    "$(cutover_state_value previous_digest)" \
    "$migration_tree_sha256"
else
  verify_candidate_migration_tree "$digest" "$migration_tree_sha256"
fi
verify_candidate_private_media_gateway_offline "$digest"

pending_output="$(
  compose_release "$release_dir" run \
    --rm \
    --no-deps \
    --env AUTORUN_ENABLED=false \
    --env AUTORUN_LARAVEL_MIGRATION=false \
    pixelfed php artisan migrate:status --pending --no-ansi --no-interaction
)"
migrations_pending=false
grep -Fq 'No pending migrations.' <<<"$pending_output" || migrations_pending=true

if [[ "$initial_private_media_stage" == true ]]; then
  [[ "$migrations_pending" == false ]] || {
    echo "Private-media gateway staging refuses an image with pending migrations." >&2
    exit 1
  }

  docker exec pixelfed-horizon php artisan horizon:pause --no-ansi >/dev/null
  docker exec pixelfed-horizon php artisan horizon:terminate --no-ansi >/dev/null
  docker exec pixelfed-app php artisan down --retry=60 --no-ansi >/dev/null
  compose_release "$current_release" stop --timeout 90 horizon scheduler >/dev/null
  wait_for_container_stopped pixelfed-horizon 90
  wait_for_container_stopped pixelfed-scheduler 90
  compose_release "$release_dir" up --detach --no-build --no-deps pixelfed
  verify_staged_private_media_gateway "$digest" "$operation_id"
  transition_private_media_cutover_phase intent staged
  stage_rollback_armed=false
  echo "Staged $commit at $digest behind maintenance; workers remain quiesced pending separately approved cutover."
  exit 0
fi

if [[ "$finalize_private_media_stage" == true ]]; then
  [[ "$migration_approval" == NONE && "$migrations_pending" == false ]] || {
    echo "Finalizing the staged private-media gateway permits no migration." >&2
    exit 1
  }
  if [[ "$finalization_completed_replay" == true ]]; then
    [[ "$(readlink -f "$CURRENT_LINK")" == "$release_dir" ]] || {
      echo "Completed private-media finalization is not bound to the current release." >&2
      exit 1
    }
    verify_runtime
    verify_exact_runtime_images "$digest"
    verify_permanent_private_media_runtime "$digest"
    echo "The verified private-media finalization is already complete."
    exit 0
  fi
  if [[ "$phase" == staged ]]; then
    transition_private_media_cutover_phase staged finalizing
  fi
  finalization_fail_closed_armed=true

  state_previous_release="$(release_dir_for "$(cutover_state_value previous_commit)")"
  current_target="$(readlink -f "$CURRENT_LINK")"
  [[ "$current_target" == "$state_previous_release" || "$current_target" == "$release_dir" ]] || {
    echo "The current release changed outside the private-media cutover contract." >&2
    exit 1
  }

  finalization_ready=false
  if [[ "$current_target" == "$release_dir" ]] && \
    [[ "$(container_runtime_state pixelfed-horizon)" == running ]] && \
    [[ "$(container_runtime_state pixelfed-scheduler)" == running ]] && \
    [[ "$(laravel_maintenance_state)" == up ]]; then
    finalization_ready=true
  fi

  if [[ "$finalization_ready" == false ]]; then
    docker exec pixelfed-app php artisan down --retry=60 --no-ansi >/dev/null 2>&1 || true
    compose_release "$release_dir" stop --timeout 90 horizon scheduler >/dev/null 2>&1 || true
    compose_release "$release_dir" up --detach --no-build --no-deps pixelfed
    verify_staged_private_media_gateway_local "$digest"
    docker exec pixelfed-app php artisan up --no-ansi >/dev/null
    verify_permanent_private_media_runtime_local "$digest"
    verify_permanent_private_media_runtime "$digest"
    restore_worker_state "$release_dir" horizon pixelfed-horizon "$(cutover_state_value horizon_state)"
    restore_worker_state "$release_dir" scheduler pixelfed-scheduler "$(cutover_state_value scheduler_state)"
  fi

  if ! verify_runtime || \
    ! verify_exact_runtime_images "$digest" || \
    ! verify_permanent_private_media_runtime "$digest"; then
    echo "Cutover finalization failed; finalizing state remains for forward recovery." >&2
    exit 1
  fi
  set_current_release_link "$release_dir"
  transition_private_media_cutover_phase finalizing completed
  finalization_fail_closed_armed=false
  echo "Finalized the verified private-media cutover at $commit and $digest."
  exit 0
fi

[[ "$ordinary_deployment" == true ]]
migrations_started=false
if [[ "$migrations_pending" == true ]]; then
  [[ "$migration_approval" == "MIGRATIONS_APPROVED" ]] || {
    echo "Pending migrations require MIGRATIONS_APPROVED." >&2
    exit 1
  }
  [[ -x /usr/local/sbin/mochirii-social-backup ]] || {
    echo "A verified online backup command is required before migrations." >&2
    exit 1
  }
  MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD=1 \
    /usr/local/sbin/mochirii-social-backup "pre-deploy-$commit"
fi

rollback_image() {
  local rollback_failed=false
  ordinary_fail_closed_armed=false
  if [[ "$migrations_started" == true ]]; then
    enforce_fail_closed_runtime "$release_dir" ordinary || rollback_failed=true
    [[ "$(readlink -f "$CURRENT_LINK")" == "$current_release" ]] || rollback_failed=true
    if [[ "$rollback_failed" == true ]]; then
      echo "A migration was attempted and the closed runtime could not be proven; operator recovery is required." >&2
      return 1
    fi
    echo "A migration was attempted; the prior release link is unchanged and the application and workers remain closed for operator-approved forward-fix or database restore." >&2
    return 0
  fi
  echo "Runtime verification failed; restoring the previous image release." >&2
  # Candidate cleanup is best effort: `compose up` can fail after removing the
  # candidate app. Only the exact prior-runtime acceptance below decides
  # whether rollback succeeded. Carrying an expected "container absent" error
  # forward would otherwise close a fully restored prior release.
  quiesce_candidate_for_rollback_best_effort "$release_dir"
  compose_release "$current_release" up --detach --no-build --remove-orphans pixelfed || rollback_failed=true
  wait_for_container_running pixelfed-app 120 || rollback_failed=true
  docker exec pixelfed-app php artisan up --no-ansi >/dev/null || rollback_failed=true
  verify_permanent_private_media_runtime_local "$current_digest" || rollback_failed=true
  verify_permanent_private_media_runtime "$current_digest" || rollback_failed=true
  restore_worker_state "$current_release" horizon pixelfed-horizon running || rollback_failed=true
  restore_worker_state "$current_release" scheduler pixelfed-scheduler running || rollback_failed=true
  set_current_release_link "$current_release" || rollback_failed=true
  verify_runtime || rollback_failed=true
  verify_exact_runtime_images "$current_digest" || rollback_failed=true
  verify_permanent_private_media_runtime "$current_digest" || rollback_failed=true
  if [[ "$rollback_failed" == true ]]; then
    if enforce_fail_closed_runtime "$current_release" ordinary; then
      echo "Previous-image rollback could not be proven; a fail-closed runtime boundary remains for operator recovery." >&2
    else
      echo "Previous-image rollback and the fail-closed hard stop could not be proven; immediate operator isolation is required." >&2
    fi
    return 1
  fi
  return 0
}

verify_runtime
verify_exact_runtime_images "$current_digest"
verify_permanent_private_media_runtime "$current_digest"
ordinary_fail_closed_armed=true
docker exec pixelfed-horizon php artisan horizon:pause --no-ansi >/dev/null
docker exec pixelfed-horizon php artisan horizon:terminate --no-ansi >/dev/null
docker exec pixelfed-app php artisan down --retry=60 --no-ansi >/dev/null
compose_release "$current_release" stop --timeout 90 horizon scheduler >/dev/null
wait_for_container_stopped pixelfed-horizon 90
wait_for_container_stopped pixelfed-scheduler 90

if [[ "$migrations_pending" == true ]]; then
  migrations_started=true
  if ! compose_release "$release_dir" run \
    --rm \
    --no-deps \
    --env AUTORUN_ENABLED=false \
    --env AUTORUN_LARAVEL_MIGRATION=false \
    pixelfed php artisan migrate --force --isolated --no-interaction; then
    rollback_image || true
    exit 1
  fi
fi

if ! compose_release "$release_dir" up \
  --detach \
  --no-build \
  --remove-orphans \
  db redis pixelfed; then
  rollback_image || true
  exit 1
fi
wait_for_container_running pixelfed-app 120
docker exec pixelfed-app php artisan up --no-ansi
if ! verify_permanent_private_media_runtime_local "$digest"; then
  rollback_image || true
  exit 1
fi
if ! verify_permanent_private_media_runtime "$digest"; then
  rollback_image || true
  exit 1
fi
restore_worker_state "$release_dir" horizon pixelfed-horizon running
restore_worker_state "$release_dir" scheduler pixelfed-scheduler running
if ! verify_runtime || \
  ! verify_exact_runtime_images "$digest" || \
  ! verify_permanent_private_media_runtime "$digest"; then
  rollback_image || true
  exit 1
fi
set_current_release_link "$release_dir"
ordinary_fail_closed_armed=false

echo "Deployed $commit at $digest."
