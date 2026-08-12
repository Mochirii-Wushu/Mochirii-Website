import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowsDir = resolve(".github", "workflows");
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort();

const failures = [];
const fullSha = /^[0-9a-f]{40}$/;
const buildkitImage = "moby/buildkit:v0.31.2@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec";
const cosignInstaller = "sigstore/cosign-installer";
const cosignInstallerRef = "6f9f17788090df1f26f669e9d70d6ae9567deba6";
const denoLinuxAmd64Sha256 = "1d97ecaf9e6bbb2a99e991caaf64ba9d62bf98759e8ef9938b9005855772b017";
const verifiedToolInstaller = "bash scripts/install-verified-social-build-tools.sh";
const alwaysReportingWorkflows = new Map([
  ["validate-supabase-local-preview.yml", "supabase-local-preview"],
  ["validate-shopify-theme.yml", "validate-theme"],
  ["validate-social.yml", "validate-social"],
]);

function stepBlock(lines, usesIndex) {
  let end = lines.length;
  for (let index = usesIndex + 1; index < lines.length; index += 1) {
    if (/^      - /.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(usesIndex, end).join("\n");
}

function workflowJobs(lines) {
  const jobsIndex = lines.findIndex((line) => line === "jobs:");
  if (jobsIndex === -1) return [];

  const headers = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index]) && lines[index].trim()) break;
    const match = lines[index].match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (match) headers.push({ id: match[1], index });
  }

  return headers.map((header, position) => ({
    id: header.id,
    start: header.index,
    end: headers[position + 1]?.index ?? lines.length,
  }));
}

function hasExactRecoveryRunnerMatrix(jobText) {
  const entries = [...jobText.matchAll(
    /^\s+- architecture:\s*([^\s#]+)\s*\n\s+runner:\s*([^\s#]+)\s*$/gm,
  )].map((match) => [match[1], match[2]]);
  const architectureRows = jobText.match(/^\s+- architecture:/gm) ?? [];
  const runnerRows = jobText.match(/^\s+runner:/gm) ?? [];
  return architectureRows.length === 2 &&
    runnerRows.length === 2 &&
    JSON.stringify(entries) === JSON.stringify([
      ["amd64", "ubuntu-24.04"],
      ["arm64", "ubuntu-24.04-arm"],
    ]);
}

function hasExactRecoveryArchitectureGate(jobText) {
  return [
    "name: Verify native recovery runner architecture",
    "RECOVERY_ARCHITECTURE: ${{ matrix.architecture }}",
    "RUNNER_ARCHITECTURE: ${{ runner.arch }}",
    'native_architecture="$(uname -m)"',
    'case "$RECOVERY_ARCHITECTURE:$RUNNER_ARCHITECTURE:$native_architecture" in',
    "amd64:X64:x86_64 | arm64:ARM64:aarch64)",
    "Unexpected recovery runner architecture:",
  ].every((requirement) => jobText.includes(requirement));
}

const recoveryMatrixCanary = `
      matrix:
        include:
          - architecture: amd64
            runner: ubuntu-24.04
          - architecture: arm64
            runner: ubuntu-24.04-arm
          - architecture: unreviewed
            runner: unreviewed-runner
`;
if (hasExactRecoveryRunnerMatrix(recoveryMatrixCanary)) {
  failures.push("Recovery runner-matrix policy canary did not reject an additional runner.");
}

let totalJobCount = 0;

for (const name of workflowFiles) {
  const file = `.github/workflows/${name}`;
  const text = readFileSync(resolve(workflowsDir, name), "utf8").replaceAll("\r\n", "\n");
  const lines = text.split("\n");
  let buildxStepCount = 0;
  let cosignStepCount = 0;
  let denoStepCount = 0;
  const denoChecksumCount = lines.filter((line) => line.trim() === `DENO_BINARY_SHA256: ${denoLinuxAmd64Sha256}`).length;
  const verifiedToolInstallerCount = lines.filter((line) => line.trim() === `run: ${verifiedToolInstaller}`).length;
  const syftBinaryCount = lines.filter((line) => line.trim() === 'syft "$PIXELFED_IMAGE" -o spdx-json=pixelfed-sbom.spdx.json').length;
  const jobs = workflowJobs(lines);
  totalJobCount += jobs.length;

  if (jobs.length === 0) {
    failures.push(`${file}: workflow must define at least one job.`);
  }
  for (const job of jobs) {
    const jobText = lines.slice(job.start, job.end).join("\n");
    const runsOn = lines
      .slice(job.start, job.end)
      .map((line, offset) => ({ line, number: job.start + offset + 1 }))
      .filter(({ line }) => /^    runs-on:/.test(line));
    if (runsOn.length !== 1) {
      failures.push(`${file}: job ${job.id} must define exactly one runs-on value.`);
      continue;
    }

    const value = runsOn[0].line.slice("    runs-on:".length).trim();
    const approvedRecoveryMatrix =
      name === "validate-social.yml" &&
      job.id === "validate-recovery-tools" &&
      value === "${{ matrix.runner }}" &&
      hasExactRecoveryRunnerMatrix(jobText) &&
      hasExactRecoveryArchitectureGate(jobText);
    if (value.includes("self-hosted")) {
      failures.push(`${file}:${runsOn[0].number}: job ${job.id} must not depend on a self-hosted runner.`);
    } else if (value === "ubuntu-latest") {
      failures.push(`${file}:${runsOn[0].number}: job ${job.id} must pin the Ubuntu 24.04 runner family instead of ubuntu-latest.`);
    } else if (value !== "ubuntu-24.04" && !approvedRecoveryMatrix) {
      failures.push(`${file}:${runsOn[0].number}: job ${job.id} must use exact runs-on value ubuntu-24.04.`);
    }
  }

  if (!text.includes("permissions:\n  contents: read")) {
    failures.push(`${file}: workflow must declare top-level contents: read permissions.`);
  }

  const requiredContext = alwaysReportingWorkflows.get(name);
  if (requiredContext) {
    const triggerBlock = text.split(/^permissions:/m, 1)[0];
    if (/^\s+paths(?:-ignore)?:/m.test(triggerBlock)) {
      failures.push(`${file}: required checks must not use event-level path filters.`);
    }
    if (!new RegExp(`^  ${requiredContext}:\\n    name: ${requiredContext}$`, "m").test(text)) {
      failures.push(`${file}: must report the stable ${requiredContext} job name.`);
    }
    const ownsDedicatedDetector = name === "validate-supabase-local-preview.yml"
      ? text.includes("node scripts/detect-supabase-local-preview-changes.mjs")
      : text.includes("git diff --quiet");
    if (!/^\s+id:\s*changes\s*$/m.test(text) ||
        !text.includes("github.event.pull_request.base.sha || github.event.before") ||
        !ownsDedicatedDetector ||
        !text.includes("steps.changes.outputs.changed == 'true'")) {
      failures.push(`${file}: must detect owned-path changes inside an always-reporting job.`);
    }
  }

  lines.forEach((line, index) => {
    const match = line.match(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/);
    if (!match || match[1].startsWith("./")) return;

    const [action, ref] = match[1].split("@");
    if (!action || !fullSha.test(ref || "")) {
      failures.push(`${file}:${index + 1}: external actions must use a full 40-character commit SHA.`);
      return;
    }

    const block = stepBlock(lines, index);
    if (action === "actions/checkout" && !/^\s+persist-credentials:\s*false\s*$/m.test(block)) {
      failures.push(`${file}:${index + 1}: checkout must disable persisted credentials.`);
    }
    if (action === "actions/setup-node" && !/^\s+node-version-file:\s*\.node-version\s*$/m.test(block)) {
      failures.push(`${file}:${index + 1}: setup-node must use the repository .node-version file.`);
    }
    if (action === "denoland/setup-deno") {
      denoStepCount += 1;
      if (!/^\s+deno-version:\s*2\.9\.4\s*$/m.test(block)) {
        failures.push(`${file}:${index + 1}: setup-deno must install exact Deno 2.9.4.`);
      }
    }
    if (action === cosignInstaller) {
      cosignStepCount += 1;
      if (ref !== cosignInstallerRef || !/^\s+cosign-release:\s*v3\.0\.6\s*$/m.test(block)) {
        failures.push(`${file}:${index + 1}: Cosign must use the reviewed full-SHA installer and exact v3.0.6 release.`);
      }
    }
    if (action === "docker/setup-buildx-action") {
      buildxStepCount += 1;
      if (/^\s+version:/m.test(block) ||
          !/^\s+cache-binary:\s*false\s*$/m.test(block) ||
          !/^\s+driver-opts:\s*\|\s*$/m.test(block) ||
          !block.split("\n").some((line) => line.trim() === `image=${buildkitImage}`)) {
        failures.push(`${file}:${index + 1}: setup-buildx must use the preverified Buildx binary with caching disabled and the approved digest-pinned BuildKit v0.31.2 image.`);
      }
    }
    if (action.startsWith("anchore/sbom-action")) {
      failures.push(`${file}:${index + 1}: SBOM generation must use the approved digest-pinned Syft container instead of a runtime installer action.`);
    }
  });

  if (denoStepCount > 0 && denoChecksumCount !== denoStepCount) {
    failures.push(`${file}: every setup-deno step must be followed by an exact Deno 2.9.4 Linux AMD64 binary checksum gate.`);
  }

  if (name === "validate-social.yml" && buildxStepCount !== 2) {
    failures.push(`${file}: must contain exactly two pinned setup-buildx steps (production-image and publish-social-image).`);
  }
  if (name === "validate-social.yml" && cosignStepCount !== 2) {
    failures.push(`${file}: must contain exactly two reviewed Cosign installer steps.`);
  }
  if (name === "validate-social.yml" && verifiedToolInstallerCount !== 2) {
    failures.push(`${file}: must verify and install the reviewed Social build tools in both image jobs.`);
  }
  if (name === "validate-social.yml" && syftBinaryCount !== 2) {
    failures.push(`${file}: must generate both Social SBOMs with the verified Syft binary.`);
  }
  if (name === "validate-social.yml" && text.includes("ghcr.io/anchore/syft:")) {
    failures.push(`${file}: must not use an unsigned Syft container image.`);
  }
}

const verifiedToolInstallerText = readFileSync(
  resolve("scripts", "install-verified-social-build-tools.sh"),
  "utf8",
).replaceAll("\r\n", "\n");
const requiredVerifiedToolContract = [
  'readonly BUILDX_VERSION="v0.35.0"',
  'readonly BUILDX_SHA256="d41ece72044243b4f58b343441ae37446d9c29a7d6b5e11c61847bbcf8f7dfda"',
  'readonly BUILDX_BUNDLE_SHA256="efe9f45ff054cb8c29c74b908958277423c6f4ef57350354f452e1672f91ddcf"',
  'readonly BUILDX_CERTIFICATE_IDENTITY="https://github.com/docker/github-builder/.github/workflows/bake.yml@5f637c833aa76bc99372a1dc9a6f8bcd8056fb85"',
  'readonly SYFT_VERSION="1.49.0"',
  'readonly SYFT_SHA256="7aa2f03ee92739cf643279ba3990548b9925d4e22cae13f46831ee62821147fe"',
  'readonly SYFT_CHECKSUMS_SHA256="1870142953acd02a9de2f5ff019087cee4a6dc03e4a7c15b67de7b1dc48e0865"',
  'readonly SYFT_CERTIFICATE_IDENTITY="https://github.com/anchore/syft/.github/workflows/release.yaml@refs/heads/main"',
  'readonly CERTIFICATE_OIDC_ISSUER="https://token.actions.githubusercontent.com"',
  "cosign verify-blob \\",
  "sha256sum --check --strict -",
];
for (const requirement of requiredVerifiedToolContract) {
  if (!verifiedToolInstallerText.includes(requirement)) {
    failures.push(`scripts/install-verified-social-build-tools.sh: missing verified release contract: ${requirement}`);
  }
}

if (failures.length) {
  console.error("GitHub Actions security validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`GitHub Actions security validation OK (${workflowFiles.length} workflows, ${totalJobCount} jobs).`);
