#!/usr/bin/env bash

set -Eeuo pipefail

require_clean_installer_checkout() {
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
    echo "The installer source must be the exact repository root." >&2
    return 1
  }
  [[ "$(git -C "$checkout_root" rev-parse HEAD)" == "$expected_commit" ]] || {
    echo "The installer source is not the expected commit." >&2
    return 1
  }
  [[ -z "$(git -C "$checkout_root" status --porcelain=v1 --untracked-files=all)" ]] || {
    echo "The installer source checkout must be clean, including untracked files." >&2
    return 1
  }

  for tracked_path in "$@"; do
    [[ "$tracked_path" != /* && "$tracked_path" != *'..'* ]] || {
      echo "The installer received an unsafe tracked source path." >&2
      return 1
    }
    git -C "$checkout_root" ls-files --error-unmatch -- "$tracked_path" >/dev/null || {
      echo "Installer source is not tracked: $tracked_path" >&2
      return 1
    }
    [[ -f "$checkout_root/$tracked_path" && ! -L "$checkout_root/$tracked_path" ]] || {
      echo "Installer source is not a regular non-symlink file: $tracked_path" >&2
      return 1
    }
    tree_entry="$(git -C "$checkout_root" ls-tree "$expected_commit" -- "$tracked_path")" || return 1
    [[ "$tree_entry" =~ ^(100644|100755)[[:space:]]blob[[:space:]]([0-9a-f]{40})[[:space:]] ]] || {
      echo "Installer source has an unsupported committed file type: $tracked_path" >&2
      return 1
    }
    commit_blob="${BASH_REMATCH[2]}"
    source_blob="$(git -C "$checkout_root" hash-object -- "$checkout_root/$tracked_path")" || return 1
    [[ "$source_blob" == "$commit_blob" ]] || {
      echo "Installer source differs from the expected commit: $tracked_path" >&2
      return 1
    }
  done
}

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run the installer as root." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_key_file="${1:-}"
deploy_user="${MOCHIRII_SOCIAL_DEPLOY_USER:-github-deploy}"
runtime_root="${MOCHIRII_SOCIAL_ROOT:-/opt/mochirii-social}"
repository_root="$(cd "$repo_root/../.." && pwd)"
source_commit="$(git -C "$repository_root" rev-parse HEAD)" || exit 1
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
require_clean_installer_checkout \
  "$repository_root" \
  "$source_commit" \
  services/social/docker-compose.production.yml \
  services/social/scripts/production-runtime-lib.sh \
  services/social/scripts/deploy-production-runtime.sh \
  services/social/scripts/backup-production-runtime.sh \
  services/social/scripts/restore-production-runtime.sh \
  services/social/scripts/deploy-production-entrypoint.sh

[[ -f "$public_key_file" ]] || {
  echo "Usage: install-production-runtime.sh <deploy-public-key-file>" >&2
  exit 1
}
[[ "$(wc -l <"$public_key_file")" -eq 1 ]] || {
  echo "The deploy public-key file must contain exactly one key." >&2
  exit 1
}
grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$' "$public_key_file" || {
  echo "The deploy key must be an Ed25519 public key." >&2
  exit 1
}

for command_name in \
  bash curl docker flock git install mktemp mv python3 rsync sha256sum stat sudo tar visudo; do
  command -v "$command_name" >/dev/null || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done
docker compose version >/dev/null

install -d -m 0750 -o root -g root \
  "$runtime_root" \
  "$runtime_root/releases" \
  "$runtime_root/shared" \
  "$runtime_root/data" \
  "$runtime_root/backups"
install -d -m 0700 -o root -g root \
  "$runtime_root/shared/private-media-cutover" \
  "$runtime_root/shared/restore-recovery"
install -m 0644 -o root -g root \
  "$repo_root/docker-compose.production.yml" \
  "$runtime_root/shared/docker-compose.production.yml"
install -d -m 0755 -o root -g root /usr/local/lib/mochirii-social
install -m 0644 -o root -g root \
  "$repo_root/scripts/production-runtime-lib.sh" \
  /usr/local/lib/mochirii-social/production-runtime-lib.sh
install -m 0755 -o root -g root \
  "$repo_root/scripts/deploy-production-runtime.sh" \
  /usr/local/sbin/mochirii-social-deploy
install -m 0755 -o root -g root \
  "$repo_root/scripts/backup-production-runtime.sh" \
  /usr/local/sbin/mochirii-social-backup
install -m 0755 -o root -g root \
  "$repo_root/scripts/restore-production-runtime.sh" \
  /usr/local/sbin/mochirii-social-restore
contract_manifest="$(mktemp)"
trap 'rm -f "$contract_manifest"' EXIT
{
  printf '%s  %s\n' \
    "$(sha256sum "$repo_root/scripts/production-runtime-lib.sh" | cut -d' ' -f1)" \
    /usr/local/lib/mochirii-social/production-runtime-lib.sh
  printf '%s  %s\n' \
    "$(sha256sum "$repo_root/scripts/deploy-production-runtime.sh" | cut -d' ' -f1)" \
    /usr/local/sbin/mochirii-social-deploy
  printf '%s  %s\n' \
    "$(sha256sum "$repo_root/scripts/backup-production-runtime.sh" | cut -d' ' -f1)" \
    /usr/local/sbin/mochirii-social-backup
  printf '%s  %s\n' \
    "$(sha256sum "$repo_root/scripts/restore-production-runtime.sh" | cut -d' ' -f1)" \
    /usr/local/sbin/mochirii-social-restore
  printf '%s  %s\n' \
    "$(sha256sum "$repo_root/scripts/deploy-production-entrypoint.sh" | cut -d' ' -f1)" \
    /usr/local/sbin/mochirii-social-deploy-entry
} >"$contract_manifest"
contract_sha256="$(sha256sum "$contract_manifest" | cut -d' ' -f1)"
{
  printf '%s\n' \
    'version=2' \
    "installed_from_commit=$source_commit" \
    "contract_sha256=$contract_sha256"
  cat "$contract_manifest"
} >/usr/local/lib/mochirii-social/deploy-runtime.contract
chown root:root /usr/local/lib/mochirii-social/deploy-runtime.contract
chmod 0444 /usr/local/lib/mochirii-social/deploy-runtime.contract
install -m 0755 -o root -g root \
  "$repo_root/scripts/deploy-production-entrypoint.sh" \
  /usr/local/sbin/mochirii-social-deploy-entry
rm -f "$contract_manifest"
trap - EXIT
# shellcheck source=/dev/null
source /usr/local/lib/mochirii-social/production-runtime-lib.sh
verify_installed_deploy_runtime_contract "$contract_sha256"

if ! id "$deploy_user" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$deploy_user"
fi
passwd --lock "$deploy_user" >/dev/null

deploy_home="$(getent passwd "$deploy_user" | cut -d: -f6)"
install -d -m 0700 -o "$deploy_user" -g "$deploy_user" "$deploy_home/.ssh"
{
  printf '%s ' 'restrict,command="/usr/local/sbin/mochirii-social-deploy-entry"'
  cat "$public_key_file"
} >"$deploy_home/.ssh/authorized_keys"
chown "$deploy_user:$deploy_user" "$deploy_home/.ssh/authorized_keys"
chmod 0600 "$deploy_home/.ssh/authorized_keys"

sudoers_file="/etc/sudoers.d/mochirii-social-deploy"
cat >"$sudoers_file" <<EOF
$deploy_user ALL=(root) NOPASSWD: /usr/local/sbin/mochirii-social-deploy *
EOF
chmod 0440 "$sudoers_file"
visudo -cf "$sudoers_file" >/dev/null

echo "Installed the restricted Mochirii Social deployment runtime."
