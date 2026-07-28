import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const repositoryRoot = path.resolve(root, "../..");
const failures = [];

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
    if (!text.includes(value)) {
      failures.push(`${relativePath} must include: ${value}`);
    }
  }
}

function rejectIncludes(relativePath, text, values) {
  for (const value of values) {
    if (text.includes(value)) {
      failures.push(`${relativePath} must not include: ${value}`);
    }
  }
}

const composePath = "docker-compose.production.yml";
const compose = read(composePath);
requireIncludes(composePath, compose, [
  "name: mochirii-social",
  "${PIXELFED_IMAGE:?PIXELFED_IMAGE must be an immutable GHCR digest}",
  "${PIXELFED_ENV_FILE:?PIXELFED_ENV_FILE must point to the root-owned runtime environment}",
  "${PIXELFED_DATA_ROOT:?PIXELFED_DATA_ROOT must be an absolute path}/mariadb",
  "${PIXELFED_DATA_ROOT:?PIXELFED_DATA_ROOT must be an absolute path}/redis",
  "${PIXELFED_DATA_ROOT:?PIXELFED_DATA_ROOT must be an absolute path}/storage",
  '"127.0.0.1:8080:8080"',
  'AUTORUN_LARAVEL_MIGRATION: "false"',
  'MAX_PHOTO_SIZE: "92160"',
  'MAX_AVATAR_SIZE: "92160"',
  'PHP_POST_MAX_SIZE: "100M"',
  'PHP_UPLOAD_MAX_FILE_SIZE: "95M"',
  '"http://127.0.0.1:8080/api/service/readiness-check"',
  "start_period: 60s",
  "pull_policy: never",
]);
rejectIncludes(composePath, compose, [
  "build:",
  "mochirii-pixelfed:local",
  "./mysql-9-data",
  "./redis-data",
  "./storage",
  '"8080:8080"',
  'PHP_POST_MAX_SIZE: "250M"',
  'PHP_UPLOAD_MAX_FILE_SIZE: "100M"',
]);
if ((compose.match(/image: \*app-image/g) || []).length !== 3) {
  failures.push(`${composePath} must use the immutable app image for all three app services`);
}

const deployWorkflowPath = ".github/workflows/deploy-social-production.yml";
const deployWorkflow = readRepository(deployWorkflowPath);
requireIncludes(deployWorkflowPath, deployWorkflow, [
  "workflow_dispatch:",
  "environment: social-production",
  "permissions:",
  "contents: read",
  "packages: read",
  "persist-credentials: false",
  "DEPLOY social.mochirii.com",
  "MIGRATIONS APPROVED",
  "STAGE_PRIVATE_MEDIA_GATEWAY_UNDER_MAINTENANCE",
  "ANONYMOUS DENIAL AND CUTOVER VERIFIED",
  "gh attestation verify",
  "--source-digest",
  "--source-ref refs/heads/main",
  "--signer-workflow Mochirii-Wushu/Mochirii/.github/workflows/validate-social.yml",
  '--signer-digest "$RELEASE_COMMIT"',
  "--predicate-type https://spdx.dev/Document/v2.3",
  "--deny-self-hosted-runners",
  "StrictHostKeyChecking=yes",
  "UserKnownHostsFile=~/.ssh/known_hosts",
  "docker buildx imagetools inspect",
  "https://social.mochirii.com/",
  "cf-mitigated",
  "The public edge blocked the GitHub runner after the hosted public health gates passed.",
]);
rejectIncludes(deployWorkflowPath, deployWorkflow, [
  "runs-on: self-hosted",
  "StrictHostKeyChecking=no",
  "ssh-keyscan",
  "pull_request_target",
]);

const onlineVerificationWorkflowPath = ".github/workflows/verify-social-online-hosting.yml";
const onlineVerificationWorkflow = readRepository(onlineVerificationWorkflowPath);
requireIncludes(onlineVerificationWorkflowPath, onlineVerificationWorkflow, [
  "workflow_dispatch:",
  "environment: social-production",
  "permissions:\n  contents: read",
  "VERIFY social.mochirii.com",
  "StrictHostKeyChecking=yes",
  '"verify VERIFY_social.mochirii.com"',
  "https://mochirii.com/",
  "https://social.mochirii.com/",
  "Cloudflare blocked the GitHub runner after the forced hosted public gate passed.",
  "/auth/v1/health",
  "/functions/v1/reaper-discord-interactions",
  "/functions/v1/reaper-discord-member-sync",
  "/functions/v1/verify-member-access",
  "https://discord.com/api/v10/gateway",
]);
rejectIncludes(onlineVerificationWorkflowPath, onlineVerificationWorkflow, [
  "self-hosted",
  "StrictHostKeyChecking=no",
  "ssh-keyscan",
  "pull_request_target",
]);

const deployScriptPath = "scripts/deploy-production-runtime.sh";
const deployScript = read(deployScriptPath);
requireIncludes(deployScriptPath, deployScript, [
  "flock -n",
  "Pending migrations require MIGRATIONS_APPROVED.",
  "/usr/local/sbin/mochirii-social-backup",
  "php artisan migrate --force --isolated --no-interaction",
  "rollback_image",
  "wait_for_container_running pixelfed-app 120",
  "verify_runtime",
  '"--verify-online-hosting"',
  "verify_online_hosting",
  "The release Compose file does not match the approved host template.",
  "Private-media gateway staging permits only migration approval NONE.",
  "require_private_media_maintenance_proof",
  "verify_public_maintenance_boundary",
  "captured_horizon_state",
  "captured_scheduler_state",
  "write_private_media_cutover_state",
  "transition_private_media_cutover_phase intent staged",
  "transition_private_media_cutover_phase staged finalizing",
  "transition_private_media_cutover_phase finalizing completed",
  "compose_release \"$current_release\" stop --timeout 90 horizon scheduler",
  "horizon:terminate",
  "verify_staged_private_media_gateway",
  "stage_rollback_armed=true",
  "rollback_private_media_stage",
  "recovery_required",
  "verify_private_media_migration_tree_parity",
  "Cutover finalization failed; finalizing state remains for forward recovery.",
]);

const runtimeLibraryPath = "scripts/production-runtime-lib.sh";
const runtimeLibrary = read(runtimeLibraryPath);
requireIncludes(runtimeLibraryPath, runtimeLibrary, [
  'PULL_USER="${MOCHIRII_SOCIAL_PULL_USER:-mochirii}"',
  'sudo -H -u "$PULL_USER" -- docker pull',
  '--env-file "$SHARED_ROOT/pixelfed.env"',
  '--env-file "$release_dir/release.env"',
  "https://social.mochirii.com/",
  "wait_for_container_running()",
  "wait_for_container_health pixelfed-app 300",
  "docker exec pixelfed-app curl",
  "http://127.0.0.1:8080/api/service/readiness-check",
  "https://social.mochirii.com/api/service/readiness-check",
  '[[ "$public_readiness_status" == "404" ]]',
  "verify_spaces_round_trip",
  'Storage::disk("s3")',
  "Spaces write, read, and delete gates passed.",
  'PRIVATE_MEDIA_MAINTENANCE_PROOF="$PRIVATE_MEDIA_STATE_ROOT/maintenance.proof"',
  'PRIVATE_MEDIA_CUTOVER_STATE="$PRIVATE_MEDIA_STATE_ROOT/cutover.state"',
  "root:root:700",
  "root:root:600",
  "expected_status=503",
  "validate_private_media_cutover_state",
  "write_private_media_cutover_state",
  "reject_active_private_media_cutover_state",
  "verify_installed_deploy_runtime_contract",
  "verify_candidate_migration_tree",
  "verify_private_media_migration_tree_parity",
  "container_runtime_state",
  "wait_for_container_stopped",
  "verify_staged_private_media_gateway_local",
  "Staged private-media gateway gates passed behind maintenance.",
]);
rejectIncludes(runtimeLibraryPath, runtimeLibrary, [
  "PRIVATE_MEDIA_PENDING_MARKER",
  "PRIVATE_MEDIA_COMPLETED_MARKER",
  "gateway-stage.pending",
  "cutover.completed",
  "reject_private_media_bootstrap_replay",
  "write_private_media_pending_marker",
]);

const entrypointPath = "scripts/deploy-production-entrypoint.sh";
const entrypoint = read(entrypointPath);
requireIncludes(entrypointPath, entrypoint, [
  "SSH_ORIGINAL_COMMAND",
  "DEPLOY_social.mochirii.com",
  "VERIFY_social.mochirii.com",
  "--verify-online-hosting",
  "head -c 1048577",
  "sudo -n /usr/local/sbin/mochirii-social-deploy",
  "ANONYMOUS_DENIAL_AND_CUTOVER_VERIFIED",
  "STAGE_PRIVATE_MEDIA_GATEWAY_UNDER_MAINTENANCE",
  "A reviewed deployment mode is required.",
]);

const healthControllerPath = "app/Http/Controllers/HealthCheckController.php";
const healthController = read(healthControllerPath);
requireIncludes(healthControllerPath, healthController, [
  "if (! $this->isDirectLoopbackRequest($request))",
  "['127.0.0.1', '::1']",
  "str_starts_with($header, 'x-forwarded-')",
  "DB::connection('readiness')->selectOne('select 1 as ready')",
  "Redis::connection('readiness')->command('ping')",
  "['PONG', '+PONG']",
  "response('NOT READY', 503)",
]);
if (healthController.indexOf("if (! $this->isDirectLoopbackRequest($request))") > healthController.indexOf("DB::connection('readiness')")) {
  failures.push(`${healthControllerPath} must authorize direct loopback before probing dependencies`);
}

const databaseConfigPath = "config/database.php";
const databaseConfig = read(databaseConfigPath);
requireIncludes(databaseConfigPath, databaseConfig, [
  "MOCHIRII_READINESS_DEPENDENCY_TIMEOUT_SECONDS",
  "'readiness' => [",
]);

const installerPath = "scripts/install-production-runtime.sh";
const installer = read(installerPath);
requireIncludes(installerPath, installer, [
  "github-deploy",
  'restrict,command=\"/usr/local/sbin/mochirii-social-deploy-entry\"',
  '"$runtime_root/shared/docker-compose.production.yml"',
  '"$runtime_root/shared/private-media-cutover"',
  "passwd --lock",
  "visudo -cf",
  "require_clean_installer_checkout",
  "status --porcelain=v1 --untracked-files=all",
  "ls-files --error-unmatch",
  "ls-tree",
  "hash-object --",
  "regular non-symlink file",
]);

const deploymentRuntimeUpdaterPath = "scripts/install-production-deploy-runtime-update.sh";
const deploymentRuntimeUpdater = read(deploymentRuntimeUpdaterPath);
requireIncludes(deploymentRuntimeUpdaterPath, deploymentRuntimeUpdater, [
  "expected_commit",
  "require_exact_updater_checkout",
  'git -C "$checkout_root" rev-parse HEAD',
  'status --porcelain=v1 --untracked-files=all',
  "ls-files --error-unmatch",
  "ls-tree",
  "hash-object --",
  "regular non-symlink file",
  "bash -n",
  "root:root:700",
  "deploy-runtime-$expected_commit",
  "mktemp",
  "mv -T",
  "rollback",
  "no service was restarted or reloaded",
]);

const migrationPath = "scripts/migrate-production-runtime.sh";
const migration = read(migrationPath);
requireIncludes(migrationPath, migration, [
  "mariadb-dump",
  "--single-transaction",
  "gzip -t",
  "php artisan down",
  "rsync -aHAX --numeric-ids",
  "rollback_legacy",
  "wait_for_container_running pixelfed-app 120",
]);

const restorePath = "scripts/restore-production-runtime.sh";
const restore = read(restorePath);
requireIncludes(restorePath, restore, [
  "wait_for_container_running pixelfed-app 120",
  "verify_runtime",
]);

const backupInstallerPath = "scripts/install-production-backups.sh";
const backupInstaller = read(backupInstallerPath);
requireIncludes(backupInstallerPath, backupInstaller, [
  "github-recovery",
  'restrict,command=\"/usr/local/sbin/mochirii-social-restore-entry\"',
  "passwd --lock",
  "AllowUsers mochirii github-deploy github-recovery",
  "visudo -cf",
]);

const caddyPath = "caddy/Caddyfile";
const caddy = read(caddyPath);
requireIncludes(caddyPath, caddy, [
  "social.mochirii.com",
  "max_size 100MB",
  "@dependencyReadiness path /api/service/readiness-check",
  'header @dependencyReadiness Cache-Control "private, no-store"',
  "respond @dependencyReadiness 404",
  "reverse_proxy 127.0.0.1:8080",
  "header_up X-Request-ID {http.request.uuid}",
  "header_down X-Request-ID {http.request.uuid}",
]);
if (caddy.indexOf("respond @dependencyReadiness 404") > caddy.indexOf("reverse_proxy 127.0.0.1:8080")) {
  failures.push(`${caddyPath} must reject the dependency readiness route before the public reverse proxy`);
}
if (/\{http\.request\.header\.x-request-id\}/iu.test(caddy)) {
  failures.push(`${caddyPath} must never trust a caller-supplied request ID`);
}

const caddyInstallerPath = "scripts/install-production-caddy.sh";
const caddyInstaller = read(caddyInstallerPath);
requireIncludes(caddyInstallerPath, caddyInstaller, [
  "caddy validate",
  "systemctl reload caddy",
  "rollback",
  "mktemp /etc/caddy/Caddyfile.mochirii-candidate.XXXXXX",
  "mktemp /etc/caddy/Caddyfile.mochirii-backup.XXXXXX",
  'install -m 0600 -o root -g root "$target_config" "$rollback_config"',
  'mv -f "$candidate_config" "$target_config"',
  'docker exec pixelfed-app curl',
  "retired_paths=(",
  "for path in /oauth/token /oauth/authorize",
  "https://social.mochirii.com/",
  "https://social.mochirii.com/api/service/readiness-check",
  '[[ "$readiness_status" == "404" ]]',
]);

for (const [relativePath, text] of [
  [deployScriptPath, deployScript],
  [entrypointPath, entrypoint],
  [installerPath, installer],
  [migrationPath, migration],
  [restorePath, restore],
  [backupInstallerPath, backupInstaller],
  [caddyInstallerPath, caddyInstaller],
]) {
  rejectIncludes(relativePath, text, ["set -x", "DB_PASSWORD=", "DB_ROOT_PASSWORD="]);
}

if (failures.length) {
  console.error("Production runtime checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Production runtime checks passed.");
