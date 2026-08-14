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
const alwaysReportingWorkflows = new Map([
  ["validate-supabase-local-preview.yml", "supabase-local-preview"],
  ["validate-shopify-theme.yml", "validate-theme"],
  ["validate-social.yml", "validate-social"],
]);
const approvedRetiredSocialWorkflow = [
  "name: Validate retired Mochirii Social boundary",
  "",
  "on:",
  "  pull_request:",
  "  push:",
  "    branches:",
  "      - main",
  "",
  "permissions:",
  "  contents: read",
  "",
  "jobs:",
  "  validate-social:",
  "    name: validate-social",
  "    runs-on: ubuntu-24.04",
  "",
  "    steps:",
  "      - name: Check out repository",
  "        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
  "        with:",
  "          persist-credentials: false",
  "",
  "      - name: Verify sole Social ownership marker",
  "        shell: bash",
  "        run: |",
  "          set -Eeuo pipefail",
  "          mapfile -t social_paths < <(git ls-files 'services/social/**')",
  "          [[ \"${#social_paths[@]}\" -eq 1 ]]",
  "          [[ \"${social_paths[0]}\" == \"services/social/README.md\" ]]",
  "",
  "          grep -Fxq '`Mochirii-Wushu/Mochirii-Social`.' services/social/README.md",
  "          grep -Fxq -- '- Incumbent Website source commit: `ef5675575aeea6cb41def256d0a889f60f963ff8`' services/social/README.md",
  "          grep -Fxq -- '- Predecessor image digest: `sha256:1fd27c8f76595595912e6f12f1677c7f108aa50f64b38a85089006b47ad395f1`' services/social/README.md",
  "",
  "          for workflow in \\",
  "            .github/workflows/deploy-social-production.yml \\",
  "            .github/workflows/recover-social-production.yml \\",
  "            .github/workflows/verify-social-online-hosting.yml; do",
  "            [[ ! -e \"$workflow\" ]]",
  "          done",
  "",
  "          [[ ! -e scripts/install-verified-social-build-tools.sh ]]",
  "          ! grep -Fq 'directory: /services/social' .github/dependabot.yml",
  "          ! grep -Fq '\"check:social\"' package.json",
  "          ! grep -Fq -- '--prefix\", \"services/social\"' scripts/check-all.mjs",
].join("\n") + "\n";

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

function retiredSocialWorkflowContractViolations(candidate) {
  const normalized = candidate.replaceAll("\r\n", "\n");
  if (normalized === approvedRetiredSocialWorkflow) return [];

  return [
    "must match the exact inert allowlist: top-level contents: read, one " +
      "validate-social job, pinned checkout without persisted credentials, " +
      "and the sole approved invariant shell step",
  ];
}

// These mutations exercise forms that loose blacklists routinely miss. The
// byte-level allowlist must reject every unapproved key, context, permission,
// action, and run step rather than trying to enumerate dangerous capabilities.
const retiredSocialHostileCanaries = new Map([
  [
    "bracket secret context",
    approvedRetiredSocialWorkflow.replace(
      "jobs:\n",
      "env:\n  HOSTILE: ${{ secrets['HOSTILE'] }}\n\njobs:\n",
    ),
  ],
  [
    "bracket variable context",
    approvedRetiredSocialWorkflow.replace(
      "jobs:\n",
      "env:\n  HOSTILE: ${{ vars['HOSTILE'] }}\n\njobs:\n",
    ),
  ],
  [
    "GitHub token context",
    approvedRetiredSocialWorkflow.replace(
      "jobs:\n",
      "env:\n  HOSTILE: ${{ github.token }}\n\njobs:\n",
    ),
  ],
  [
    "additional write permission",
    approvedRetiredSocialWorkflow.replace(
      "permissions:\n  contents: read\n",
      "permissions:\n  contents: read\n  issues: write\n",
    ),
  ],
  [
    "additional action",
    approvedRetiredSocialWorkflow.replace(
      "      - name: Verify sole Social ownership marker\n",
      "      - name: Hostile action\n" +
        "        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020\n\n" +
        "      - name: Verify sole Social ownership marker\n",
    ),
  ],
  ...["curl", "wget", "gh"].map((command) => [
    `additional ${command} run step`,
    approvedRetiredSocialWorkflow.replace(
      "      - name: Verify sole Social ownership marker\n",
      `      - name: Hostile ${command} step\n` +
        `        run: ${command} https://example.invalid\n\n` +
        "      - name: Verify sole Social ownership marker\n",
    ),
  ]),
]);
for (const [label, canary] of retiredSocialHostileCanaries) {
  if (retiredSocialWorkflowContractViolations(canary).length === 0) {
    failures.push(`Retired Social workflow policy canary accepted ${label}.`);
  }
}

let totalJobCount = 0;

for (const name of workflowFiles) {
  const file = `.github/workflows/${name}`;
  const text = readFileSync(resolve(workflowsDir, name), "utf8").replaceAll("\r\n", "\n");
  const lines = text.split("\n");
  let denoStepCount = 0;
  const denoChecksumCount = lines.filter((line) => line.trim() === `DENO_BINARY_SHA256: ${denoLinuxAmd64Sha256}`).length;
  const jobs = workflowJobs(lines);
  totalJobCount += jobs.length;

  if (jobs.length === 0) {
    failures.push(`${file}: workflow must define at least one job.`);
  }
  for (const job of jobs) {
    const runsOn = lines
      .slice(job.start, job.end)
      .map((line, offset) => ({ line, number: job.start + offset + 1 }))
      .filter(({ line }) => /^    runs-on:/.test(line));
    if (runsOn.length !== 1) {
      failures.push(`${file}: job ${job.id} must define exactly one runs-on value.`);
      continue;
    }

    const value = runsOn[0].line.slice("    runs-on:".length).trim();
    if (value.includes("self-hosted")) {
      failures.push(`${file}:${runsOn[0].number}: job ${job.id} must not depend on a self-hosted runner.`);
    } else if (value === "ubuntu-latest") {
      failures.push(`${file}:${runsOn[0].number}: job ${job.id} must pin the Ubuntu 24.04 runner family instead of ubuntu-latest.`);
    } else if (value !== "ubuntu-24.04") {
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
    if (name !== "validate-social.yml") {
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
  }

  if (name === "validate-social.yml") {
    for (const violation of retiredSocialWorkflowContractViolations(text)) {
      failures.push(`${file}: ${violation}.`);
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
      if (ref !== cosignInstallerRef || !/^\s+cosign-release:\s*v3\.0\.6\s*$/m.test(block)) {
        failures.push(`${file}:${index + 1}: Cosign must use the reviewed full-SHA installer and exact v3.0.6 release.`);
      }
    }
    if (action === "docker/setup-buildx-action") {
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
}

if (failures.length) {
  console.error("GitHub Actions security validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`GitHub Actions security validation OK (${workflowFiles.length} workflows, ${totalJobCount} jobs).`);
