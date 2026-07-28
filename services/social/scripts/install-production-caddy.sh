#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run the Caddy installer as root." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_config="$repo_root/caddy/Caddyfile"
target_config=/etc/caddy/Caddyfile
candidate_config=
rollback_config=
changed=false

for command_name in caddy cmp curl cut docker install mktemp mv rm sha256sum systemctl; do
  command -v "$command_name" >/dev/null || {
    echo "Missing Caddy deployment dependency: $command_name" >&2
    exit 1
  }
done
[[ -f "$source_config" && -f "$target_config" ]] || {
  echo "The tracked or active Caddy configuration is missing." >&2
  exit 1
}

rollback() {
  trap - ERR
  if [[ "$changed" == true && -f "$rollback_config" ]]; then
    echo "Caddy verification failed; restoring the prior configuration." >&2
    local restore_config
    restore_config="$(mktemp /etc/caddy/Caddyfile.mochirii-restore.XXXXXX)"
    install -m 0644 -o root -g root "$rollback_config" "$restore_config"
    caddy validate --config "$restore_config" --adapter caddyfile >/dev/null
    mv -f "$restore_config" "$target_config"
    systemctl reload caddy
  else
    echo "Caddy verification failed before any active configuration change." >&2
  fi
  if [[ -n "$candidate_config" && -f "$candidate_config" ]]; then
    rm -f "$candidate_config"
  fi
}
trap rollback ERR

caddy validate --config "$source_config" --adapter caddyfile >/dev/null
source_sha256="$(sha256sum "$source_config" | cut -d ' ' -f 1)"
prior_sha256="$(sha256sum "$target_config" | cut -d ' ' -f 1)"

if ! cmp -s "$source_config" "$target_config"; then
  candidate_config="$(mktemp /etc/caddy/Caddyfile.mochirii-candidate.XXXXXX)"
  rollback_config="$(mktemp /etc/caddy/Caddyfile.mochirii-backup.XXXXXX)"
  install -m 0644 -o root -g root "$source_config" "$candidate_config"
  install -m 0600 -o root -g root "$target_config" "$rollback_config"
  caddy validate --config "$candidate_config" --adapter caddyfile >/dev/null
  mv -f "$candidate_config" "$target_config"
  candidate_config=
  changed=true
  caddy validate --config "$target_config" --adapter caddyfile >/dev/null
  systemctl reload caddy
fi

active_sha256="$(sha256sum "$target_config" | cut -d ' ' -f 1)"
[[ "$active_sha256" == "$source_sha256" ]] || {
  echo "Active Caddy configuration does not match the reviewed source." >&2
  false
}

docker exec pixelfed-app curl \
  --fail \
  --silent \
  --show-error \
  --max-time 5 \
  http://127.0.0.1:8080/api/service/readiness-check >/dev/null
curl \
  --fail \
  --silent \
  --show-error \
  --max-time 20 \
  --header 'Host: social.mochirii.com' \
  http://127.0.0.1:8080/ >/dev/null
curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --max-time 30 \
  https://social.mochirii.com/ >/dev/null
readiness_status="$(curl \
  --silent \
  --show-error \
  --max-time 20 \
  --output /dev/null \
  --write-out '%{http_code}' \
  https://social.mochirii.com/api/service/readiness-check)"
[[ "$readiness_status" == "404" ]] || {
  echo "Public dependency readiness route returned HTTP $readiness_status instead of 404." >&2
  false
}

retired_paths=(
  /installer
  /register
  /auth/sign_up
  /auth/invite
  /auth/pci
  /auth/raw/mastodon
  /auth/mastodon
  /i/app-email-verify
  /i/app-email-resend
  /api/auth/app-code-verify
  /api/auth/onboarding
  /api/v1.1/auth
  /oauth/clients
  /oauth/personal-access-tokens
  /oauth/scopes
  /oauth/token/refresh
  /oauth/tokens
  /settings/developers
  /settings/applications
  /settings/invites
)
for path in "${retired_paths[@]}"; do
  status="$(curl \
    --silent \
    --show-error \
    --max-time 20 \
    --output /dev/null \
    --write-out '%{http_code}' \
    "https://social.mochirii.com${path}")"
  [[ "$status" == "404" ]] || {
    echo "Retired public route ${path} returned HTTP ${status} instead of 404." >&2
    false
  }
done

verify_private_storage_denial() {
  local method="$1"
  local path="$2"
  local headers
  local body
  local result
  local -a method_args=(--request "$method")
  [[ "$method" == HEAD ]] && method_args=(--head)
  headers="$(mktemp)"
  body="$(mktemp)"
  result="$(curl \
    --silent \
    --show-error \
    --max-time 20 \
    --max-redirs 0 \
    --noproxy '*' \
    --resolve social.mochirii.com:443:127.0.0.1 \
    "${method_args[@]}" \
    --dump-header "$headers" \
    --output "$body" \
    --write-out '%{http_code}:%{size_download}' \
    "https://social.mochirii.com${path}")"
  [[ "$result" == 404:0 ]]
  [[ ! -s "$body" ]]
  if grep -Eiq '^(location|set-cookie):' "$headers"; then
    echo "A private-storage denial returned a redirect or cookie." >&2
    return 1
  fi
  grep -Eiq '^cache-control:[^\r]*private[^\r]*no-store|^cache-control:[^\r]*no-store[^\r]*private' "$headers"
  grep -Eiq '^x-content-type-options:[[:space:]]*nosniff\r?$' "$headers"
  grep -Eiq '^referrer-policy:[[:space:]]*no-referrer\r?$' "$headers"
  rm -f "$headers" "$body"
}

private_storage_paths=(
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
  for path in "${private_storage_paths[@]}"; do
    verify_private_storage_denial "$method" "$path"
  done
done

for path in /oauth/token /oauth/authorize; do
  status="$(curl \
    --silent \
    --show-error \
    --max-time 20 \
    --output /dev/null \
    --write-out '%{http_code}' \
    --noproxy '*' \
    --resolve social.mochirii.com:443:127.0.0.1 \
    "https://social.mochirii.com${path}")"
  [[ "$status" != "404" ]] || {
    echo "Required OAuth route ${path} is blocked by the active Caddy configuration." >&2
    false
  }
done

trap - ERR
if [[ "$changed" == true ]]; then
  echo "Prior Caddy SHA-256: $prior_sha256"
  echo "Reviewed Caddy SHA-256: $source_sha256"
  echo "Root-owned rollback capture: $rollback_config"
  echo "Atomically installed, reloaded, and verified the tracked Caddy runtime boundary."
else
  echo "Caddy was already bound to reviewed SHA-256: $active_sha256"
  echo "Verified the tracked Caddy runtime boundary without reloading it."
fi
