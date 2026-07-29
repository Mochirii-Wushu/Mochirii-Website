#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run the backup installer as root." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
recipient_public_key="${1:-}"
recovery_public_key="${2:-}"
producer_signing_key="${3:-}"
recovery_user="${MOCHIRII_SOCIAL_RECOVERY_USER:-github-recovery}"

for public_key_file in "$recipient_public_key" "$recovery_public_key"; do
  [[ -f "$public_key_file" && "$(wc -l <"$public_key_file")" -eq 1 ]] || {
    echo "Two single-line Ed25519 public-key files are required." >&2
    exit 1
  }
  grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$' "$public_key_file" || {
    echo "Backup and recovery keys must be Ed25519 public keys." >&2
    exit 1
  }
done
[[ -f "$producer_signing_key" && ! -L "$producer_signing_key" ]] || {
  echo "A regular backup-producer Ed25519 private-key file is required." >&2
  exit 1
}
[[ "$(stat -c '%U:%G:%a' "$producer_signing_key")" == root:root:600 ]] || {
  echo "The backup-producer signing key must be root:root mode 0600." >&2
  exit 1
}
command -v ssh-keygen >/dev/null || {
  echo "The backup-producer signing key requires ssh-keygen." >&2
  exit 1
}
producer_public_key="$(ssh-keygen -y -f "$producer_signing_key" </dev/null 2>/dev/null)" || {
  echo "The backup-producer signing key is invalid or not available non-interactively." >&2
  exit 1
}
[[ "$producer_public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || {
  echo "The backup-producer signing key must be Ed25519." >&2
  exit 1
}

bash "$repo_root/scripts/install-pinned-recovery-tools.sh" /usr/local/bin

install -d -m 0700 -o root -g root /opt/mochirii-social/backups
install -m 0644 -o root -g root \
  "$recipient_public_key" \
  /opt/mochirii-social/shared/backup-recipient.pub
install -m 0600 -o root -g root \
  "$producer_signing_key" \
  /opt/mochirii-social/shared/backup-producer-signing-key
install -m 0755 -o root -g root \
  "$repo_root/scripts/backup-production-runtime.sh" \
  /usr/local/sbin/mochirii-social-backup
install -m 0755 -o root -g root \
  "$repo_root/scripts/enable-production-backups.sh" \
  /usr/local/sbin/mochirii-social-backup-enable
install -m 0755 -o root -g root \
  "$repo_root/scripts/restore-production-runtime.sh" \
  /usr/local/sbin/mochirii-social-restore
install -m 0755 -o root -g root \
  "$repo_root/scripts/restore-production-entrypoint.sh" \
  /usr/local/sbin/mochirii-social-restore-entry
install -m 0644 -o root -g root \
  "$repo_root/systemd/mochirii-social-backup.service" \
  /etc/systemd/system/mochirii-social-backup.service
install -m 0644 -o root -g root \
  "$repo_root/systemd/mochirii-social-backup.timer" \
  /etc/systemd/system/mochirii-social-backup.timer

if ! id "$recovery_user" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$recovery_user"
fi
passwd --lock "$recovery_user" >/dev/null
recovery_home="$(getent passwd "$recovery_user" | cut -d: -f6)"
install -d -m 0700 -o "$recovery_user" -g "$recovery_user" "$recovery_home/.ssh"
{
  printf '%s ' 'restrict,command="/usr/local/sbin/mochirii-social-restore-entry"'
  cat "$recovery_public_key"
} >"$recovery_home/.ssh/authorized_keys"
chown "$recovery_user:$recovery_user" "$recovery_home/.ssh/authorized_keys"
chmod 0600 "$recovery_home/.ssh/authorized_keys"

sudoers_file=/etc/sudoers.d/mochirii-social-restore
cat >"$sudoers_file" <<EOF
$recovery_user ALL=(root) NOPASSWD: /usr/local/sbin/mochirii-social-restore *
EOF
chmod 0440 "$sudoers_file"
visudo -cf "$sudoers_file" >/dev/null

sshd_policy=/etc/ssh/sshd_config.d/99-mochirii-hardening.conf
if grep -Fxq 'AllowUsers mochirii github-deploy' "$sshd_policy"; then
  sed -i 's/^AllowUsers mochirii github-deploy$/AllowUsers mochirii github-deploy github-recovery/' "$sshd_policy"
elif ! grep -Fxq 'AllowUsers mochirii github-deploy github-recovery' "$sshd_policy"; then
  echo "Unexpected SSH AllowUsers policy; refusing to modify it." >&2
  exit 1
fi
sshd -t
systemctl reload ssh
systemctl daemon-reload

echo "Installed online backup and restricted recovery controls."
