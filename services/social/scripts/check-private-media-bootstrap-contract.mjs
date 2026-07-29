import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const repositoryRoot = path.resolve(root, "../..");
const failures = [];
const canonicalRepository = "Mochirii-Wushu/Mochirii-Website";
const retiredRepository = ["Mochirii-Wushu", "Mochirii"].join("/");
const retiredRepositoryPattern = new RegExp(
  `${retiredRepository.replaceAll("/", "\\/")}(?![-A-Za-z0-9_])`,
  "u",
);

function read(base, relativePath) {
  const fullPath = path.join(base, relativePath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Missing required file: ${relativePath}`);
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

function requireOrder(relativePath, text, values) {
  let cursor = -1;
  for (const value of values) {
    const next = text.indexOf(value, cursor + 1);
    if (next < 0) {
      failures.push(`${relativePath} is missing ordered contract token: ${value}`);
      return;
    }
    cursor = next;
  }
}

const workflowPath = ".github/workflows/deploy-social-production.yml";
const workflow = read(repositoryRoot, workflowPath);
requireIncludes(workflowPath, workflow, [
  "default: NOT AUTHORIZED",
  "STAGE_PRIVATE_MEDIA_GATEWAY_UNDER_MAINTENANCE",
  "FINALIZE_PRIVATE_MEDIA_GATEWAY_AFTER_VERIFIED_CUTOVER",
  "ANONYMOUS DENIAL AND CUTOVER VERIFIED",
  "operation_id:",
  "attestations: read",
  "ref: ${{ inputs.commit }}",
  '[[ "$OPERATION_ID" =~ ^[0-9a-f]{8}-',
  '[[ "$MIGRATION_APPROVAL" == "NONE" ]]',
  '[[ "$(git rev-parse HEAD)" == "$RELEASE_COMMIT" ]]',
  "gh attestation verify",
  "--predicate-type https://slsa.dev/provenance/v1",
  "--predicate-type https://spdx.dev/Document/v2.3",
  '--source-digest "$RELEASE_COMMIT"',
  '--source-ref refs/heads/main',
  '--signer-digest "$RELEASE_COMMIT"',
  "--deny-self-hosted-runners",
  "migration_tree_sha256=",
  "runtime_contract_sha256=",
  `--repo ${canonicalRepository}`,
  `--signer-workflow ${canonicalRepository}/.github/workflows/validate-social.yml`,
  `gh api repos/${canonicalRepository}/commits/main`,
  "$DEPLOYMENT_MODE_TOKEN $OPERATION_ID",
  "verify-finalization $OPERATION_ID $RELEASE_COMMIT $RELEASE_DIGEST VERIFY_PRIVATE_MEDIA_FINALIZATION",
  "compare/$RELEASE_COMMIT...$remote_main",
  "--max-redirs 0",
  '[[ "$response_size" =~ ^[0-9]+$ && "$response_size" -le 65536 ]]',
]);
rejectIncludes(workflowPath, workflow, ["http.extraheader", "runs-on: self-hosted"]);
if (retiredRepositoryPattern.test(workflow)) {
  failures.push(`${workflowPath} must not use the retired repository identity`);
}
requireOrder(workflowPath, workflow, [
  "Verify published commit digest",
  "Verify image provenance and SBOM attestations",
  "Build no-secret release bundle",
  "Configure restricted SSH client",
  "Deploy immutable release",
]);

const socialWorkflowPath = ".github/workflows/validate-social.yml";
const socialWorkflow = read(repositoryRoot, socialWorkflowPath);
requireIncludes(socialWorkflowPath, socialWorkflow, [
  "check-clean-database-migrations.sh",
  "Attest production image provenance",
  "Attest production image SBOM",
  "test-private-media-bootstrap-runtime.sh",
  "install-production-caddy.sh",
]);
requireOrder(socialWorkflowPath, socialWorkflow, [
  "Verify clean MariaDB migrations and workers",
  "Publish immutable and main tags",
  "Attest production image provenance",
  "Attest production image SBOM",
]);

const recoveryWorkflowPath = ".github/workflows/recover-social-production.yml";
const recoveryWorkflow = read(repositoryRoot, recoveryWorkflowPath);
requireIncludes(recoveryWorkflowPath, recoveryWorkflow, [
  "source services/social/scripts/production-runtime-lib.sh",
  "BACKUP_RECOVERY_OBJECT_KEY",
  "RECOVERY_ENCRYPTED_MAX_BYTES",
  "rclone --config /dev/null --quiet size --json",
  "rclone_error=\"$(mktemp recovery/rclone-error.XXXXXX)\"",
  "The private recovery object metadata could not be read.",
  "The private recovery object could not be downloaded.",
  "verify_bounded_encrypted_recovery_file",
  "RECOVERY_PAYLOAD_MAX_BYTES + 1",
  "extract_validated_recovery_payload recovery/recovery.tar recovery/extracted",
  "validate_recovery_payload_manifest recovery/extracted",
  "validate_recovery_configuration_archive",
  "recovery/extracted/database.sql.gz",
]);
rejectIncludes(recoveryWorkflowPath, recoveryWorkflow, [
  "inputs.object_key",
  "tar -tf recovery/recovery.tar",
  "tar -xf recovery/recovery.tar",
  "format=1",
]);

const libraryPath = "scripts/production-runtime-lib.sh";
const library = read(root, libraryPath);
requireIncludes(libraryPath, library, [
  'PRIVATE_MEDIA_CUTOVER_STATE="$PRIVATE_MEDIA_STATE_ROOT/cutover.state"',
  "phase=(absent|intent|staged|finalizing|completed|recovery_required)",
  "root:root:700",
  "root:root:600",
  "expected_status=503",
  "fsync_path \"$candidate\"",
  'mv -T "$candidate" "$PRIVATE_MEDIA_CUTOVER_STATE"',
  "reject_active_private_media_cutover_state",
  "RESTORE_STATE_ROOT",
  "write_restore_state",
  "reject_active_restore_state",
  "verify_installed_deploy_runtime_contract",
  "/usr/local/lib/mochirii-social/production-runtime-lib.sh",
  "/usr/local/sbin/mochirii-social-deploy",
  "/usr/local/sbin/mochirii-social-backup",
  "/usr/local/sbin/mochirii-social-restore",
  "/usr/local/sbin/mochirii-social-deploy-entry",
  "installed_from_commit=",
  "contract_sha256=",
  "--max-redirs 0",
  "storage/m",
  "storage/_esm.t3",
  "storage/g",
  "storage/g1",
  "storage/avatars",
  "storage/cache/avatars",
  "verify_candidate_migration_tree",
  "verify_private_media_migration_tree_parity",
  "--network none",
  "verify_candidate_private_media_gateway_offline",
  "set_current_release_link",
  "MOCHIRII_LARAVEL_DOWN",
  "MOCHIRII_LARAVEL_UP",
  "RECOVERY_PAYLOAD_MAX_BYTES=536870912",
  "RECOVERY_ENCRYPTED_MAX_BYTES=537919488",
  "RECOVERY_DATABASE_MAX_BYTES=503316480",
  "RECOVERY_CONFIGURATION_MAX_BYTES=16777216",
  "extract_validated_recovery_payload",
  "validate_recovery_configuration_archive",
  "validate_recovery_payload_manifest",
  "verify_bounded_encrypted_recovery_file",
  "enforce_fail_closed_runtime",
  "hard_stop_fail_closed_runtime",
  "verify_fail_closed_hard_stop",
  "container_exact_presence",
  'docker ps --all',
  "A controlled public boundary returned a cacheable policy.",
  "validate_recovery_configuration_bindings",
  "quiesce_candidate_for_rollback_best_effort",
  'len(lines) == 4 and lines[0] == "format=1"',
  'len(lines) == 10 and lines[0] == "format=2"',
  "Legacy recovery manifest has an invalid exact schema.",
  "Recovery manifest has an invalid exact format-2 schema.",
  "Normalized recovery manifest target already exists.",
  "verify_secure_backup_recipient_file",
  "verify_secure_backup_environment_file",
  "Recovery payload contains an unsafe archive entry.",
  `canonical_repository = "${canonicalRepository}"`,
  "len(metadata_lines) == 5 and metadata_repository == canonical_repository",
  'len(metadata_lines) == 3 and metadata_repository == legacy_repository',
  "verify_private_media_proxy_runtime_contract",
  'caddy validate --config "$caddy_config" --adapter caddyfile',
  'caddy adapt --config "$caddy_config" --adapter caddyfile',
  'http://127.0.0.1:2019/config/',
  "if active != expected:",
  '"127.0.0.1:8080"',
  '$defaultCache !== "redis" || $limiterCache !== "redis"',
  '$firstIp !== "198.51.100.10"',
  '$secondIp !== "203.0.113.20"',
  "hash_equals($firstIp, $secondIp)",
]);
rejectIncludes(libraryPath, library, ["gateway-stage.pending", "cutover.completed"]);
requireOrder(libraryPath, library, [
  'chmod 0600 "$candidate"',
  'fsync_path "$candidate"',
  'mv -T "$candidate" "$PRIVATE_MEDIA_CUTOVER_STATE"',
  'fsync_path "$PRIVATE_MEDIA_STATE_ROOT"',
]);

const runtimePath = "scripts/deploy-production-runtime.sh";
const runtime = read(root, runtimePath);
requireIncludes(runtimePath, runtime, [
  "Private-media gateway staging permits only migration approval NONE.",
  '"--verify-closed-stage"',
  '"--verify-finalization-ready"',
  "validate_private_media_cutover_state",
  "verify_private_media_state_bindings",
  "rollback_private_media_stage",
  "recovery_required",
  "Private-media gateway staging refuses an image with pending migrations.",
  "horizon:pause",
  "horizon:terminate",
  "stop --timeout 90 horizon scheduler",
  "transition_private_media_cutover_phase intent staged",
  "transition_private_media_cutover_phase staged finalizing",
  "transition_private_media_cutover_phase finalizing completed",
  "finalization_completed_replay=true",
  "Finalization remains safely closed and its durable recovery state was retained.",
  "Finalization is closed, but its durable recovery state could not be proven.",
  "Finalizing the staged private-media gateway permits no migration.",
  "Cutover finalization failed; finalizing state remains for forward recovery.",
  "MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD=1",
  'verify_private_media_migration_tree_parity "$digest" "$current_digest"',
  'quiesce_candidate_for_rollback_best_effort "$release_dir"',
  "enforce_fail_closed_runtime",
  "verify_restored_stage_rollback",
  "verify_runtime_local",
]);
requireOrder(runtimePath, runtime, [
  "write_private_media_cutover_state",
  "stage_rollback_armed=true",
  'pull_release_image "$REGISTRY_IMAGE@$digest"',
  'docker exec pixelfed-horizon php artisan horizon:pause',
  'docker exec pixelfed-horizon php artisan horizon:terminate',
  'compose_release "$current_release" stop --timeout 90 horizon scheduler',
  'compose_release "$release_dir" up --detach --no-build --no-deps pixelfed',
  'verify_staged_private_media_gateway "$digest" "$operation_id"',
  "transition_private_media_cutover_phase intent staged",
  "stage_rollback_armed=false",
]);
requireOrder(runtimePath, runtime, [
  "transition_private_media_cutover_phase staged finalizing",
  'verify_staged_private_media_gateway_local "$digest"',
  "php artisan up",
  'verify_permanent_private_media_runtime_local "$digest"',
  'verify_permanent_private_media_runtime "$digest"',
  'restore_worker_state "$release_dir" horizon',
  "verify_runtime",
  'verify_exact_runtime_images "$digest"',
  'set_current_release_link "$release_dir"',
  "transition_private_media_cutover_phase finalizing completed",
]);

const updaterPath = "scripts/install-production-deploy-runtime-update.sh";
const updater = read(root, updaterPath);
requireIncludes(updaterPath, updater, [
  'lock_file="${MOCHIRII_SOCIAL_LOCK:-/run/lock/mochirii-social-deploy.lock}"',
  "flock -n 9",
  "before.sha256",
  "after.sha256",
  "rollback.sha256",
  "contract_sha256=",
  "installed_from_commit=",
  "validate_backup_snapshot",
  "before_manifest_sha256",
  "runtime_backup_root/deploy-runtime-$state_commit-$state_operation_id",
  "cutover_lines[@]",
  "private-media cutover state has an unexpected field count",
  "for index in 0 1 2 3",
  'install_script_atomic "${sources[4]}" "${targets[4]}"',
  "rollback_failed=true",
  "no service was restarted or reloaded",
  "require_exact_updater_checkout",
  "status --porcelain=v1 --untracked-files=all",
  "ls-files --error-unmatch",
  "ls-tree",
  "100644|100755",
  "regular non-symlink file",
]);

const installerPath = "scripts/install-production-runtime.sh";
const installer = read(root, installerPath);
requireIncludes(installerPath, installer, [
  "require_clean_installer_checkout",
  "status --porcelain=v1 --untracked-files=all",
  "ls-files --error-unmatch",
  "ls-tree",
  "hash-object --",
  "100644|100755",
  "regular non-symlink file",
  "The installer source checkout must be clean, including untracked files.",
]);
requireOrder(updaterPath, updater, [
  "for index in 0 1 2 3",
  "contract_candidate=",
  'install_script_atomic "${sources[4]}" "${targets[4]}"',
  "verify_installed_deploy_runtime_contract",
  "after.sha256",
]);
requireOrder(updaterPath, updater, [
  "Restore supporting files first.",
  "for index in 0 1 2 3; do",
  'if [[ -f "$backup_root/contract" ]]',
  'install_script_atomic "$backup_root/4" "${targets[4]}" "${modes[4]}"',
  'write_sha_manifest "$backup_root/rollback.sha256"',
]);

const backupPath = "scripts/backup-production-runtime.sh";
const backup = read(root, backupPath);
requireIncludes(backupPath, backup, [
  'BACKUP_LOCK_FILE="${MOCHIRII_SOCIAL_BACKUP_LOCK:-/run/lock/mochirii-social-backup.lock}"',
  "MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD",
  "reject_active_private_media_cutover_state \"Backup\"",
  "reject_active_restore_state \"Backup\"",
  '"--verify-cutover-guard"',
  "format=2",
  "deploy_runtime_contract_file_sha256=",
  "RECOVERY_DATABASE_MAX_BYTES",
  "RECOVERY_CONFIGURATION_MAX_BYTES",
  "RECOVERY_MANIFEST_MAX_BYTES",
  "RECOVERY_PAYLOAD_MAX_BYTES",
  "extract_validated_recovery_payload",
  "validate_recovery_payload_manifest",
  "validate_recovery_configuration_archive",
  "verify_bounded_encrypted_recovery_file",
  "verify_secure_backup_recipient_file",
  "verify_secure_backup_environment_file",
  '[[ -f "/$relative_file" && ! -L "/$relative_file" ]]',
  '"${PRIVATE_MEDIA_CUTOVER_STATE#/}"',
  '"${PRIVATE_MEDIA_MAINTENANCE_PROOF#/}"',
]);

const restorePath = "scripts/restore-production-runtime.sh";
const restore = read(root, restorePath);
requireIncludes(restorePath, restore, [
  "reject_active_private_media_cutover_state \"Production restore\"",
  "MOCHIRII_SOCIAL_DEPLOY_LOCK_HELD=1",
  "write_restore_state",
  "recovery_required",
  "verify_permanent_private_media_runtime_local",
  "verify_permanent_private_media_runtime",
  "extract_validated_recovery_payload",
  "validate_recovery_payload_manifest",
  "validate_recovery_configuration_archive",
  "validate_recovery_configuration_bindings",
  "validated_manifest=",
  'restore_manifest_format" == 1',
  "restore_exit_handler",
  "trap 'exit 129' HUP",
  "trap 'exit 130' INT",
  "trap 'exit 143' TERM",
  "enforce_fail_closed_runtime",
]);

const restoreEntrypointPath = "scripts/restore-production-entrypoint.sh";
const restoreEntrypoint = read(root, restoreEntrypointPath);
requireIncludes(restoreEntrypointPath, restoreEntrypoint, [
  "head -c 536870913",
  '"$(stat -c \'%s\' "$payload_path")" -le 536870912',
]);

const caddyPath = "caddy/Caddyfile";
const caddy = read(root, caddyPath);
requireIncludes(caddyPath, caddy, [
  "/storage/m /storage/m/*",
  "/storage/_esm.t3 /storage/_esm.t3/*",
  "/storage/g /storage/g/*",
  "/storage/g1 /storage/g1/*",
  "/storage/avatars /storage/avatars/*",
  "/storage/cache/avatars /storage/cache/avatars/*",
  'Cache-Control "private, no-store"',
  'X-Content-Type-Options "nosniff"',
  'Referrer-Policy "no-referrer"',
  "trusted_proxies static 103.21.244.0/22",
  "198.41.128.0/17",
  "2c0f:f248::/32",
  "client_ip_headers CF-Connecting-IP X-Forwarded-For",
  "trusted_proxies_strict",
  "header_up X-Forwarded-For {client_ip}",
]);

const harnessPath = "scripts/test-private-media-bootstrap-runtime.sh";
const harness = read(root, harnessPath);
requireIncludes(harnessPath, harness, [
  "MOCK_CURL_MODE",
  "Mismatched operation ID was accepted.",
  "A modified deployed migration tree was accepted.",
  "Intent state did not fail closed.",
  "redirect cookie badstatus large body cachepublic cacheimmutable cachesmaxage",
  "Ambiguous Laravel maintenance output was accepted.",
  "A competing deployment lock was acquired.",
  "Recovery payload accepted invalid archive:",
  "A group-writable backup recipient file was accepted.",
  "A symlinked backup recipient file was accepted.",
  "A symlinked backup environment was accepted.",
  "An encrypted recovery payload with transfer-size drift was accepted.",
  "An oversized encrypted recovery payload was accepted.",
  "A symlinked encrypted recovery payload was accepted.",
  "Configuration archive accepted invalid input:",
  "Current release metadata accepted the legacy repository slug.",
  "Legacy-shaped metadata accepted the canonical repository slug.",
  "Legacy release metadata accepted an unknown repository slug.",
  "Maintenance failure did not invoke the direct container hard stop.",
  "A Docker query failure was accepted as a proven hard stop.",
  "An absent candidate app made best-effort prior-runtime rollback cleanup fail.",
  "Backup accepted active cutover phase:",
  "Backup accepted an active restore-recovery intent.",
  "A truncated private-media cutover state was accepted.",
  "A self-consistent deployment contract with a substituted target was accepted.",
  "A symlinked deployment-runtime target was accepted.",
  "Runtime verification masked an early container-health failure.",
  "Permanent private-media validation masked an early local-gate failure.",
  "Private-media state bindings masked an invalid durable state.",
  "Current-release replacement masked a link-creation failure.",
  "A restore state with an invalid early field was accepted.",
  "A dangling private-media state link was treated as an available operation.",
  "Updater state accepted an invalid early field.",
  "Updater backup accepted an invalid early file hash.",
  "Updater manifest writing masked an early hash failure.",
  "A modified installer source checkout was accepted.",
  "An untracked installer source checkout was accepted.",
  "A hidden modified installer input was accepted.",
  "A hidden modified updater input was accepted.",
  "A skip-worktree modified installer input was accepted.",
  "A skip-worktree modified updater input was accepted.",
  "A restored live stage rollback did not run local runtime acceptance.",
  "A failed restored live-runtime gate did not force recovery_required.",
  "A restored maintenance-stage rollback ran live runtime acceptance.",
]);

if (failures.length > 0) {
  console.error("Private-media bootstrap contract failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Private-media bootstrap fail-closed source contract passed.");
