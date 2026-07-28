import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const repositoryRoot = path.resolve(root, "../..");
const failures = [];
const mariaDbRecoveryImage =
  "mariadb:11.4@sha256:a794d9eb009e20de605858a11f32f63b4075cbd197c650436f0e3b457e4caed7";

const recoveryTools = Object.freeze({
  age: Object.freeze({
    version: "1.3.1",
    amd64: "bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377",
    arm64: "c6878a324421b69e3e20b00ba17c04bc5c6dab0030cfe55bf8f68fa8d9e9093a",
  }),
  rclone: Object.freeze({
    version: "1.74.4",
    amd64: "fe435e0c36228e7c2f116a8701f01127bb1f694005fc11d1f27186c8bca4115d",
    arm64: "97685285c9ad6a0cf17d5844115d2a67245af6444db672187074bd9c358de419",
  }),
});

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Missing required file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
}

function readRepository(relativePath) {
  const fullPath = path.join(repositoryRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Missing required repository file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
}

function requireIncludes(relativePath, text, values) {
  for (const value of values) {
    if (!text.includes(value)) failures.push(`${relativePath} must include: ${value}`);
  }
}

function rejectIncludes(relativePath, text, values) {
  for (const value of values) {
    if (text.includes(value)) failures.push(`${relativePath} must not include: ${value}`);
  }
}

const backupPath = "scripts/backup-production-runtime.sh";
const backup = read(backupPath);
requireIncludes(backupPath, backup, [
  "--single-transaction",
  "--routines",
  "--events",
  "--triggers",
  "--hex-blob",
  "--network none",
  "RESTORE_TABLES=(users statuses media oauth_clients)",
  "age \\",
  "--recipients-file",
  "RCLONE_CONFIG_MOCHIRII_BACKUP_PROVIDER=DigitalOcean",
  "prune_retention daily 14",
  "prune_retention weekly 8",
  "prune_retention monthly 6",
  "Refusing to prune an unexpected backup object name.",
  `AGE_VERSION="v${recoveryTools.age.version}"`,
  `RCLONE_VERSION="rclone v${recoveryTools.rclone.version}"`,
  "The age version does not match the approved backup pin.",
  "The rclone version does not match the approved backup pin.",
  "RECOVERY_DATABASE_MAX_BYTES",
  "RECOVERY_CONFIGURATION_MAX_BYTES",
  "RECOVERY_PAYLOAD_MAX_BYTES",
  "extract_validated_recovery_payload",
  "validate_recovery_payload_manifest",
  "validate_recovery_configuration_archive",
  "validate_recovery_configuration_bindings",
  "verify_bounded_encrypted_recovery_file",
  "verify_secure_backup_recipient_file",
  "verify_secure_backup_environment_file",
  'BACKUP_S3_ACCESS_KEY_ID=""',
  'BACKUP_S3_SECRET_ACCESS_KEY=""',
  'BACKUP_S3_BUCKET=""',
  'BACKUP_S3_ENDPOINT=""',
  'BACKUP_S3_REGION=""',
  'age_version_output="$(age --version 2>/dev/null || true)"',
  'rclone_version_output="$(rclone version 2>/dev/null || true)"',
  '[[ "$age_version_output" == "$AGE_VERSION" ]]',
  '[[ "${rclone_version_output%%$\'\\n\'*}" == "$RCLONE_VERSION" ]]',
  mariaDbRecoveryImage,
]);

const recoveryToolInstallerPath = "scripts/install-pinned-recovery-tools.sh";
const recoveryToolInstaller = read(recoveryToolInstallerPath);
requireIncludes(recoveryToolInstallerPath, recoveryToolInstaller, [
  `AGE_VERSION="${recoveryTools.age.version}"`,
  `RCLONE_VERSION="${recoveryTools.rclone.version}"`,
  recoveryTools.age.amd64,
  recoveryTools.age.arm64,
  recoveryTools.rclone.amd64,
  recoveryTools.rclone.arm64,
  'https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-${architecture}.tar.gz',
  'https://github.com/rclone/rclone/releases/download/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-${architecture}.zip',
  "sha256sum --check --strict -",
  "--proto '=https'",
  "--proto-redir '=https'",
  "--max-time 300",
  '[[ "$(uname -s)" == "Linux" ]]',
  "x86_64 | amd64",
  "aarch64 | arm64",
  "Unsupported recovery-tool architecture:",
  '[[ "$("$work_directory/bin/age" --version)" == "v${AGE_VERSION}" ]]',
  '[[ "$("$work_directory/bin/age-keygen" --version)" == "v${AGE_VERSION}" ]]',
  '[[ "${rclone_version_output%%$\'\\n\'*}" == "rclone v${RCLONE_VERSION}" ]]',
  'install -m 0755 "$work_directory/bin/age" "$destination/age"',
  'install -m 0755 "$work_directory/bin/age-keygen" "$destination/age-keygen"',
  'install -m 0755 "$work_directory/bin/rclone" "$destination/rclone"',
]);
rejectIncludes(recoveryToolInstallerPath, recoveryToolInstaller, [
  "/latest/",
  "releases/latest",
  "apt-get",
]);

const servicePath = "systemd/mochirii-social-backup.service";
const service = read(servicePath);
requireIncludes(servicePath, service, [
  "ExecStart=/usr/local/sbin/mochirii-social-backup nightly",
  "NoNewPrivileges=true",
  "ProtectHome=true",
  "TimeoutStartSec=45min",
]);

const timerPath = "systemd/mochirii-social-backup.timer";
const timer = read(timerPath);
requireIncludes(timerPath, timer, [
  "OnCalendar=*-*-* 03:15:00 UTC",
  "Persistent=true",
]);

const workflowPath = ".github/workflows/recover-social-production.yml";
const workflow = readRepository(workflowPath);
requireIncludes(workflowPath, workflow, [
  "workflow_dispatch:",
  "environment: social-recovery",
  "persist-credentials: false",
  "validate-only",
  "restore-production",
  "VERIFY social backup",
  "RESTORE social.mochirii.com",
  "StrictHostKeyChecking=yes",
  "--network none",
  "runs-on: ubuntu-24.04",
  "bash services/social/scripts/install-pinned-recovery-tools.sh \"$recovery_tools\"",
  "source services/social/scripts/production-runtime-lib.sh",
  "RECOVERY_ENCRYPTED_MAX_BYTES",
  "rclone --config /dev/null --quiet size --json",
  "verify_bounded_encrypted_recovery_file",
  "RECOVERY_PAYLOAD_MAX_BYTES + 1",
  "extract_validated_recovery_payload recovery/recovery.tar recovery/extracted",
  "validate_recovery_payload_manifest recovery/extracted",
  "validate_recovery_configuration_archive",
  "validate_recovery_configuration_bindings",
  "printf '%s\\n' \"$recovery_tools\" >> \"$GITHUB_PATH\"",
  mariaDbRecoveryImage,
]);
rejectIncludes(workflowPath, workflow, [
  "self-hosted",
  "ubuntu-latest",
  "apt-get",
  "StrictHostKeyChecking=no",
  "ssh-keyscan",
  "pull_request:",
  "pull_request_target",
  "tar -tf recovery/recovery.tar",
  "tar -xf recovery/recovery.tar",
  "format=1",
]);

const validationWorkflowPath = ".github/workflows/validate-social.yml";
const validationWorkflow = readRepository(validationWorkflowPath);
requireIncludes(validationWorkflowPath, validationWorkflow, [
  "validate-social-core:",
  "name: validate-social-core",
  "validate-recovery-tools:",
  "name: recovery-tools-${{ matrix.architecture }}",
  "needs: validate-social-core",
  "runner: ubuntu-24.04",
  "runner: ubuntu-24.04-arm",
  "name: Verify native recovery runner architecture",
  "RUNNER_ARCHITECTURE: ${{ runner.arch }}",
  'native_architecture="$(uname -m)"',
  'case "$RECOVERY_ARCHITECTURE:$RUNNER_ARCHITECTURE:$native_architecture" in',
  "amd64:X64:x86_64 | arm64:ARM64:aarch64)",
  "Unexpected recovery runner architecture:",
  "bash -n \\",
  "shellcheck \\",
  "bash services/social/scripts/install-pinned-recovery-tools.sh \"$tools_directory\"",
  '"$tools_directory/age-keygen" -y "$test_directory/identity"',
  "cmp --silent \"$test_directory/payload\" \"$test_directory/recovered\"",
  'rclone_root=":local:$test_directory/rclone-local"',
  'copyto "$test_directory/payload.age" "$rclone_root/daily/$rclone_object"',
  'lsf --files-only "$rclone_root/daily"',
  'deletefile "$rclone_root/daily/$rclone_object"',
  "validate-social:",
  "name: validate-social",
  "needs: [validate-social-core, validate-recovery-tools]",
  "if: always()",
  '[[ "$CORE_RESULT" == "success" ]]',
  '[[ "$RECOVERY_RESULT" == "success" ]]',
  '[[ "$RECOVERY_RESULT" == "skipped" ]]',
  "needs: validate-social",
]);

const backupInstallerPath = "scripts/install-production-backups.sh";
const backupInstaller = read(backupInstallerPath);
requireIncludes(backupInstallerPath, backupInstaller, [
  'bash "$repo_root/scripts/install-pinned-recovery-tools.sh" /usr/local/bin',
]);
rejectIncludes(backupInstallerPath, backupInstaller, ["apt-get", "releases/latest"]);

for (const [relativePath, text] of [
  [backupPath, backup],
  [workflowPath, workflow],
]) {
  requireIncludes(relativePath, text, [
    "restore_ready=false",
    "--execute='SELECT 1;'",
    "The isolated restore database did not become ready.",
  ]);
  rejectIncludes(relativePath, text, ["mariadb-admin ping"]);
}

const runbookPath = "docs/online-backup-recovery.md";
const runbook = read(runbookPath);
const compactRunbook = runbook.replace(/\s+/g, " ");
requireIncludes(runbookPath, compactRunbook, [
  "canonical repository is public",
  "`social-recovery` environment secrets",
  "`social-recovery` environment variables",
  "protected `social-recovery` environment",
  "protected `main`",
  "native AMD64 and ARM64",
  "no-network local backend",
  "GitHub-hosted native ARM64 hardware",
  "runner.arch",
  "uname -m",
  "required `validate-social` result fails closed",
  "does not install tools on the live Droplet",
]);
rejectIncludes(runbookPath, runbook, ["repository Actions secrets"]);

for (const [relativePath, text] of [
  [backupPath, backup],
  ["scripts/restore-production-runtime.sh", read("scripts/restore-production-runtime.sh")],
  ["scripts/restore-production-entrypoint.sh", read("scripts/restore-production-entrypoint.sh")],
  [backupInstallerPath, backupInstaller],
  [recoveryToolInstallerPath, recoveryToolInstaller],
]) {
  rejectIncludes(relativePath, text, ["set -x", "echo $BACKUP_", "env |", "printenv"]);
}

if (failures.length) {
  console.error("Production backup checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Production backup checks passed.");
