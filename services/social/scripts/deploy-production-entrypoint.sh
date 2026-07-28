#!/usr/bin/env bash

set -Eeuo pipefail

umask 077
runtime_library=/usr/local/lib/mochirii-social/production-runtime-lib.sh
[[ -f "$runtime_library" && ! -L "$runtime_library" ]] || {
  echo "The installed deployment runtime library is unavailable." >&2
  exit 1
}
# shellcheck source=/dev/null
source "$runtime_library"
verify_installed_deploy_runtime_contract

read -r action argument_one argument_two argument_three argument_four argument_five argument_six extra \
  <<<"${SSH_ORIGINAL_COMMAND:-}"

if [[ "$action" == "verify" ]]; then
  [[ "$argument_one" == "VERIFY_social.mochirii.com" ]] || {
    echo "The verification confirmation is invalid." >&2
    exit 1
  }
  [[ -z "${argument_two:-}" && -z "${argument_three:-}" && -z "${argument_four:-}" && -z "${argument_five:-}" && -z "${argument_six:-}" && -z "${extra:-}" ]] || {
    echo "Unexpected verification arguments." >&2
    exit 1
  }

  exec sudo -n /usr/local/sbin/mochirii-social-deploy --verify-online-hosting
fi

if [[ "$action" == "verify-stage" ]]; then
  [[ "$argument_four" == "VERIFY_PRIVATE_MEDIA_STAGE" ]] || {
    echo "The closed-stage verification confirmation is invalid." >&2
    exit 1
  }
  [[ -z "${argument_five:-}" && -z "${argument_six:-}" && -z "${extra:-}" ]] || {
    echo "Unexpected closed-stage verification arguments." >&2
    exit 1
  }
  validate_operation_id "$argument_one"
  validate_commit "$argument_two"
  validate_digest "$argument_three"
  exec sudo -n /usr/local/sbin/mochirii-social-deploy \
    --verify-closed-stage "$argument_one" "$argument_two" "$argument_three"
fi

if [[ "$action" == "verify-finalization" ]]; then
  [[ "$argument_four" == "VERIFY_PRIVATE_MEDIA_FINALIZATION" ]] || {
    echo "The finalization-ready verification confirmation is invalid." >&2
    exit 1
  }
  [[ -z "${argument_five:-}" && -z "${argument_six:-}" && -z "${extra:-}" ]] || {
    echo "Unexpected finalization-ready verification arguments." >&2
    exit 1
  }
  validate_operation_id "$argument_one"
  validate_commit "$argument_two"
  validate_digest "$argument_three"
  exec sudo -n /usr/local/sbin/mochirii-social-deploy \
    --verify-finalization-ready "$argument_one" "$argument_two" "$argument_three"
fi

[[ "$action" == "deploy" ]] || {
  echo "Unsupported deployment action." >&2
  exit 1
}
[[ -z "${extra:-}" ]] || {
  echo "Unexpected deployment arguments." >&2
  exit 1
}

commit="$argument_one"
digest="$argument_two"
confirmation="$argument_three"
migration_approval="$argument_four"
deployment_mode="$argument_five"
operation_id="$argument_six"

[[ "$confirmation" == "DEPLOY_social.mochirii.com" ]] || {
  echo "The deployment confirmation is invalid." >&2
  exit 1
}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]]
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$migration_approval" == "NONE" || "$migration_approval" == "MIGRATIONS_APPROVED" ]]
validate_operation_id "$operation_id"
case "$deployment_mode" in
  STAGE_PRIVATE_MEDIA_GATEWAY_UNDER_MAINTENANCE)
    [[ "$migration_approval" == "NONE" ]]
    ;;
  FINALIZE_PRIVATE_MEDIA_GATEWAY_AFTER_VERIFIED_CUTOVER)
    [[ "$migration_approval" == "NONE" ]]
    ;;
  ANONYMOUS_DENIAL_AND_CUTOVER_VERIFIED)
    ;;
  *)
    echo "A reviewed deployment mode is required." >&2
    exit 1
    ;;
esac

bundle_path="$(mktemp /tmp/mochirii-social-release.XXXXXX.tar.gz)"
cleanup() {
  rm -f "$bundle_path"
}
trap cleanup EXIT

head -c 1048577 >"$bundle_path"
[[ "$(stat -c '%s' "$bundle_path")" -le 1048576 ]] || {
  echo "The release bundle is too large." >&2
  exit 1
}

sudo -n /usr/local/sbin/mochirii-social-deploy \
  "$bundle_path" "$commit" "$digest" "$migration_approval" "$deployment_mode" "$operation_id"
