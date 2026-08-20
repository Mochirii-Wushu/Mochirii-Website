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

function stripYamlComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === quote && line[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "#" && (index === 0 || /\s/u.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function yamlMapping(line) {
  const active = stripYamlComment(line).trimEnd();
  const match = active.match(/^(\s*)(-\s+)?((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^']|'')*')|(?:[A-Za-z0-9_-]+))\s*:\s*(.*)$/u);
  if (!match) return null;
  return {
    indent: match[1].length,
    keyIndent: match[1].length + (match[2]?.length || 0),
    sequence: Boolean(match[2]),
    key: decodeYamlScalar(match[3]),
    value: match[4],
  };
}

function decodeYamlScalar(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) {
      throw new Error(`multiline double-quoted YAML scalars are outside the accepted policy grammar`);
    }
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`invalid double-quoted YAML scalar ${value}`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) {
      throw new Error(`multiline single-quoted YAML scalars are outside the accepted policy grammar`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === "false") return false;
  if (value === "true") return true;
  if (value === "null" || value === "~") return null;
  return value;
}

function isBlockScalar(value) {
  return /^[|>](?:(?:[1-9][+-]?)|(?:[+-][1-9]?))?$/u.test(value.trim());
}

function mappingValue(lines, index, mapping) {
  if (!isBlockScalar(mapping.value)) {
    return { value: decodeYamlScalar(mapping.value), end: index };
  }
  const body = [];
  let end = index;
  const parentIndent = mapping.keyIndent ?? mapping.indent;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    const indent = line.match(/^\s*/u)[0].length;
    if (line.trim() && indent <= parentIndent) break;
    body.push(line);
    end = cursor;
  }
  return { value: body.join("\n"), end };
}

function flowDepth(value) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") depth -= 1;
  }
  return depth;
}

function normalizedFlowTokens(value) {
  return value
    .replace(/"(?:[^"\\]|\\.)*"/gu, (token) => String(decodeYamlScalar(token)))
    .replace(/'(?:[^']|'')*'/gu, (token) => String(decodeYamlScalar(token)));
}

function flowUsesYamlIndirection(value) {
  const structural = value
    .replace(/"(?:[^"\\]|\\.)*"/gu, "")
    .replace(/'(?:[^']|'')*'/gu, "");
  return /(?:^|[\s[,{])[&*!](?=[^\s\]},]|$)/u.test(structural);
}

function flowHasPathFilter(value) {
  return /(?:^|[\s[,{])paths(?:-ignore)?(?=\s*:)/u.test(normalizedFlowTokens(value));
}

function parseTrigger(lines, label) {
  const triggers = [];
  for (let index = 0; index < lines.length; index += 1) {
    const mapping = yamlMapping(lines[index]);
    if (mapping?.indent === 0 && !mapping.sequence && mapping.key === "on") {
      triggers.push({ index, mapping });
    }
  }
  if (triggers.length !== 1) throw new Error(`${label}: workflow must define exactly one top-level on key`);
  const [{ index, mapping }] = triggers;
  let value = mapping.value.trim();
  if (/^[&*!]/u.test(value)) throw new Error(`${label}: aliases, anchors, and custom tags are prohibited in on`);
  if (isBlockScalar(value)) throw new Error(`${label}: block-scalar on values are outside the accepted policy grammar`);

  if (value.startsWith("[") || value.startsWith("{")) {
    let cursor = index;
    while (flowDepth(value) > 0 && cursor + 1 < lines.length) {
      cursor += 1;
      value += `\n${stripYamlComment(lines[cursor])}`;
    }
    if (flowDepth(value) !== 0) throw new Error(`${label}: unterminated flow-style on value`);
    if (/\\\r?\n/u.test(value)) {
      throw new Error(`${label}: multiline escaped flow scalars are outside the accepted policy grammar`);
    }
    if (flowUsesYamlIndirection(value)) {
      throw new Error(`${label}: aliases, anchors, and custom tags are prohibited in on`);
    }
    return {
      value: /(?:^|[\s[,{])pull_request_target(?=\s*(?::|[\]},]|$))/u.test(normalizedFlowTokens(value))
        ? { pull_request_target: null }
        : value,
      hasPathFilters: flowHasPathFilter(value),
    };
  }

  if (value) return { value: decodeYamlScalar(value), hasPathFilters: false };
  const trigger = {};
  const seenEvents = new Set();
  let childIndent = null;
  let hasPathFilters = false;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const active = stripYamlComment(lines[cursor]);
    if (!active.trim()) continue;
    const indent = active.match(/^\s*/u)[0].length;
    if (indent <= mapping.indent) break;
    if (childIndent === null) childIndent = indent;
    const trimmed = active.trimStart();
    const nested = yamlMapping(active);
    if (indent === childIndent) {
      if (!nested || nested.sequence || nested.indent !== childIndent) {
        throw new Error(`${label}: on must use canonical block-mapping event keys`);
      }
      if (seenEvents.has(nested.key)) throw new Error(`${label}: duplicate ${nested.key} event key`);
      seenEvents.add(nested.key);
      if (/^[&*!]/u.test(nested.value.trim()) || flowUsesYamlIndirection(nested.value)) {
        throw new Error(`${label}: aliases, anchors, and custom tags are prohibited in on`);
      }
      const eventValue = nested.value.trim();
      if (eventValue && eventValue !== "null" && eventValue !== "~") {
        throw new Error(`${label}: inline event configuration is outside the accepted policy grammar`);
      }
      trigger[nested.key] = null;
      continue;
    }
    if (/^(?:[?{]|[&*!]|-\s*[&*!])/u.test(trimmed)) {
      throw new Error(`${label}: explicit keys, flow mappings, aliases, anchors, and tags are prohibited in on`);
    }
    if (nested && (/^[&*!]/u.test(nested.value.trim()) || flowUsesYamlIndirection(nested.value))) {
      throw new Error(`${label}: aliases, anchors, and custom tags are prohibited in on`);
    }
    if (nested?.key === "paths" || nested?.key === "paths-ignore" ||
        (nested && flowHasPathFilter(nested.value))) {
      hasPathFilters = true;
    }
  }
  return { value: trigger, hasPathFilters };
}

function parseTopLevelPermissions(lines, label) {
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const mapping = yamlMapping(lines[index]);
    if (mapping?.indent === 0 && !mapping.sequence && mapping.key === "permissions") {
      entries.push({ index, mapping });
    }
  }
  if (entries.length > 1) throw new Error(`${label}: workflow must define at most one top-level permissions key`);
  if (entries.length === 0) return null;

  const [{ index, mapping }] = entries;
  if (mapping.value.trim()) {
    throw new Error(`${label}: permissions must use the exact accepted block-mapping policy grammar`);
  }
  const rows = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const active = stripYamlComment(lines[cursor]);
    if (!active.trim()) continue;
    const indent = active.match(/^\s*/u)[0].length;
    if (indent <= mapping.indent) break;
    rows.push({ active, indent, mapping: yamlMapping(active) });
  }
  if (rows.length === 0) throw new Error(`${label}: permissions must contain contents: read`);
  const childIndent = Math.min(...rows.map((row) => row.indent));
  const permissions = {};
  for (const row of rows) {
    if (row.indent !== childIndent || !row.mapping || row.mapping.sequence || row.mapping.indent !== childIndent) {
      throw new Error(`${label}: permissions must use scalar canonical mapping entries`);
    }
    if (Object.hasOwn(permissions, row.mapping.key)) {
      throw new Error(`${label}: duplicate ${row.mapping.key} permission key`);
    }
    if (isBlockScalar(row.mapping.value) || /^[&*!]/u.test(row.mapping.value.trim())) {
      throw new Error(`${label}: indirect or multiline permission values are prohibited`);
    }
    permissions[row.mapping.key] = decodeYamlScalar(row.mapping.value);
  }
  if (Object.keys(permissions).length !== 1 || permissions.contents !== "read") {
    throw new Error(`${label}: top-level permissions must be exactly contents: read`);
  }
  return permissions;
}

function nestedMapping(lines, start, end, parentIndent, label) {
  const values = {};
  let childIndent = null;
  for (let index = start + 1; index < end; index += 1) {
    const mapping = yamlMapping(lines[index]);
    if (!mapping || mapping.indent <= parentIndent) continue;
    if (childIndent === null) childIndent = mapping.indent;
    if (mapping.indent !== childIndent || mapping.sequence) continue;
    if (Object.hasOwn(values, mapping.key)) throw new Error(`${label}: duplicate ${mapping.key} key`);
    const resolved = mappingValue(lines, index, mapping);
    values[mapping.key] = resolved.value;
    index = resolved.end;
  }
  return values;
}

function parseSteps(lines, stepsIndex, end, label) {
  const stepsMapping = yamlMapping(lines[stepsIndex]);
  if (!stepsMapping || stepsMapping.value.trim()) {
    throw new Error(`${label}: steps must use the accepted block-sequence policy grammar`);
  }

  let blockEnd = end;
  for (let index = stepsIndex + 1; index < end; index += 1) {
    const active = stripYamlComment(lines[index]);
    if (!active.trim()) continue;
    const indent = active.match(/^\s*/u)[0].length;
    if (indent <= stepsMapping.indent) {
      blockEnd = index;
      break;
    }
  }

  const contentRows = [];
  for (let index = stepsIndex + 1; index < blockEnd; index += 1) {
    const active = stripYamlComment(lines[index]);
    if (!active.trim()) continue;
    contentRows.push({ index, active, indent: active.match(/^\s*/u)[0].length });
  }
  if (contentRows.length === 0) {
    throw new Error(`${label}: steps must contain at least one accepted mapping item`);
  }

  const stepIndent = Math.min(...contentRows.map((row) => row.indent));
  const starts = [];
  for (const row of contentRows) {
    if (row.indent !== stepIndent) continue;
    const sequenceItem = row.active.match(/^(\s*)-(?:\s+(.*))?$/u);
    const mapping = yamlMapping(row.active);
    if (!sequenceItem || !mapping?.sequence || mapping.indent !== stepIndent) {
      throw new Error(`${label}: unsupported or indirect YAML step item`);
    }
    starts.push(row.index);
  }
  return starts.map((start, position) => {
    const stepEnd = starts[position + 1] ?? blockEnd;
    const firstMapping = yamlMapping(lines[start]);
    const stepFieldIndent = firstMapping.keyIndent;
    const step = {};
    const seen = new Set();
    for (let index = start; index < stepEnd; index += 1) {
      const active = stripYamlComment(lines[index]);
      const indent = active.match(/^\s*/u)[0].length;
      if (index !== start && indent === stepFieldIndent && /^(?:\?|:)(?:\s|$)/u.test(active.trimStart())) {
        throw new Error(`${label}: explicit mapping keys are outside the accepted step policy grammar`);
      }
      const mapping = yamlMapping(active);
      if (!mapping) continue;
      const isStepField = (index === start && mapping.sequence && mapping.indent === stepIndent) ||
        (!mapping.sequence && mapping.indent === stepFieldIndent);
      if (!isStepField) continue;
      if (mapping.key === "<<") throw new Error(`${label}: YAML merge aliases are prohibited in steps`);
      if (!["name", "run", "uses", "with", "env"].includes(mapping.key)) continue;
      if (seen.has(mapping.key)) throw new Error(`${label}: duplicate ${mapping.key} key in one step`);
      seen.add(mapping.key);
      if (["with", "env"].includes(mapping.key)) {
        step[mapping.key] = nestedMapping(lines, index, stepEnd, mapping.keyIndent, label);
      } else {
        if (mapping.key === "run" && !isBlockScalar(mapping.value)) {
          for (let cursor = index + 1; cursor < stepEnd; cursor += 1) {
            const continuation = stripYamlComment(lines[cursor]);
            if (!continuation.trim()) continue;
            const continuationIndent = continuation.match(/^\s*/u)[0].length;
            if (continuationIndent <= stepFieldIndent) break;
            throw new Error(`${label}: multiline plain run scalars are outside the accepted policy grammar`);
          }
        }
        const resolved = mappingValue(lines, index, mapping);
        if (/^[&*!]/u.test(String(mapping.value).trim())) {
          throw new Error(`${label}: aliases, anchors, and custom tags are prohibited for ${mapping.key}`);
        }
        step[mapping.key] = resolved.value;
        index = resolved.end;
      }
    }
    return step;
  });
}

function parseWorkflow(text, label) {
  const lines = text.split("\n");
  const parsedTrigger = parseTrigger(lines, label);
  const workflow = {
    on: parsedTrigger.value,
    __eventPathFilters: parsedTrigger.hasPathFilters,
    permissions: parseTopLevelPermissions(lines, label),
    jobs: {},
  };
  const jobsIndex = lines.findIndex((line) => {
    const mapping = yamlMapping(line);
    return mapping?.indent === 0 && mapping.key === "jobs";
  });
  if (jobsIndex === -1) return workflow;
  const jobsMapping = yamlMapping(lines[jobsIndex]);
  if (jobsMapping.value.trim() === "{}") return workflow;
  if (jobsMapping.value.trim()) throw new Error(`${label}: flow-style jobs are outside the accepted policy grammar`);

  const starts = [];
  let jobIndent = null;
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const mapping = yamlMapping(lines[index]);
    if (!mapping) continue;
    if (mapping.indent <= jobsMapping.indent) break;
    if (jobIndent === null) jobIndent = mapping.indent;
    if (mapping.indent === jobIndent && !mapping.sequence) starts.push(index);
  }
  for (let position = 0; position < starts.length; position += 1) {
    const start = starts[position];
    const end = starts[position + 1] ?? lines.length;
    const header = yamlMapping(lines[start]);
    if (Object.hasOwn(workflow.jobs, header.key)) throw new Error(`${label}: duplicate job ${header.key}`);
    if (/^[&*!]/u.test(header.value.trim())) throw new Error(`${label}: aliases, anchors, and custom tags are prohibited for jobs`);
    const job = { __raw: lines.slice(start, end).join("\n"), steps: [] };
    let propertyIndent = null;
    for (let index = start + 1; index < end; index += 1) {
      const mapping = yamlMapping(lines[index]);
      if (!mapping || mapping.sequence || mapping.indent <= header.indent) continue;
      if (propertyIndent === null) propertyIndent = mapping.indent;
      if (mapping.indent !== propertyIndent) continue;
      if (mapping.key === "runs-on") {
        if (Object.hasOwn(job, "runs-on")) throw new Error(`${label}: duplicate runs-on in job ${header.key}`);
        job["runs-on"] = decodeYamlScalar(mapping.value);
      } else if (mapping.key === "steps") {
        job.steps = parseSteps(lines, index, end, label);
      }
    }
    workflow.jobs[header.key] = job;
  }
  return workflow;
}

function workflowUsesPullRequestTarget(workflow) {
  const trigger = workflow?.on;
  if (trigger === "pull_request_target") return true;
  if (Array.isArray(trigger)) return trigger.includes("pull_request_target");
  return trigger !== null && typeof trigger === "object" &&
    Object.hasOwn(trigger, "pull_request_target");
}

function workflowSteps(workflow) {
  const steps = [];
  for (const [jobId, job] of Object.entries(workflow?.jobs || {})) {
    if (!job || typeof job !== "object" || !Array.isArray(job.steps)) continue;
    job.steps.forEach((step, index) => {
      if (step && typeof step === "object") steps.push({ jobId, index, step });
    });
  }
  return steps;
}

function workflowExpressions(text) {
  const expressions = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("${{", cursor);
    if (start === -1) break;
    let quote = null;
    let escaped = false;
    let end = -1;
    for (let index = start + 3; index < text.length - 1; index += 1) {
      const character = text[index];
      if (quote === '"') {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (quote === "'") {
        if (character === quote && text[index + 1] === quote) index += 1;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "}" && text[index + 1] === "}") {
        end = index;
        break;
      }
    }
    if (end === -1) {
      expressions.push(text.slice(start + 3));
      break;
    }
    expressions.push(text.slice(start + 3, end));
    cursor = end + 2;
  }
  return expressions;
}

function usesUntrustedGithubContextInRun(runText) {
  return workflowExpressions(runText).some((expression) => {
    const normalized = expression.replace(
      /\[\s*(["'])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/gu,
      ".$2",
    );
    return /\bgithub\s*\.\s*(?:event\b|ref\b|ref_name\b|head_ref\b|base_ref\b|actor\b|triggering_actor\b|token\b)/u.test(normalized) ||
      /\bgithub\b(?!\s*\.)/u.test(normalized) ||
      /\binputs\b/u.test(normalized) ||
      /\bsecrets\b/u.test(normalized);
  });
}

function hasExactRecoveryRunnerMatrix(job) {
  const entries = [...String(job?.__raw || "").matchAll(
    /^\s+- architecture:\s*([^\s#]+)\s*\n\s+runner:\s*([^\s#]+)\s*$/gm,
  )].map((match) => [match[1], match[2]]);
  const architectureRows = String(job?.__raw || "").match(/^\s+- architecture:/gm) ?? [];
  const runnerRows = String(job?.__raw || "").match(/^\s+runner:/gm) ?? [];
  return architectureRows.length === 2 && runnerRows.length === 2 &&
    JSON.stringify(entries) === JSON.stringify([
      ["amd64", "ubuntu-24.04"],
      ["arm64", "ubuntu-24.04-arm"],
    ]);
}

function hasExactRecoveryArchitectureGate(job) {
  return [
    "name: Verify native recovery runner architecture",
    "RECOVERY_ARCHITECTURE: ${{ matrix.architecture }}",
    "RUNNER_ARCHITECTURE: ${{ runner.arch }}",
    'native_architecture="$(uname -m)"',
    'case "$RECOVERY_ARCHITECTURE:$RUNNER_ARCHITECTURE:$native_architecture" in',
    "amd64:X64:x86_64 | arm64:ARM64:aarch64)",
    "Unexpected recovery runner architecture:",
  ].every((requirement) => String(job?.__raw || "").includes(requirement));
}

const recoveryMatrixCanary = {
  __raw: `
      matrix:
        include:
          - architecture: amd64
            runner: ubuntu-24.04
          - architecture: arm64
            runner: ubuntu-24.04-arm
          - architecture: unreviewed
            runner: unreviewed-runner
`,
};
if (hasExactRecoveryRunnerMatrix(recoveryMatrixCanary)) {
  failures.push("Recovery runner-matrix policy canary did not reject an additional runner.");
}

const pullRequestTargetCanary = `
on:
  pull_request_target:
jobs: {}
`;
for (const [label, invalidYaml] of [
  ["duplicate key", "on: push\non: pull_request\njobs: {}\n"],
  ["custom tag", "on: !unsafe push\njobs: {}\n"],
  ["alias", "base: &base {runs-on: ubuntu-24.04}\non: push\njobs: {test: *base}\n"],
  ["flow alias", "on: [push, *events]\njobs: {}\n"],
  ["literal block trigger", "on: |-\n  pull_request_target\njobs: {}\n"],
  ["folded block trigger", "on: >-\n  pull_request_target\njobs: {}\n"],
  ["continued quoted flow trigger", 'on: ["pull_request_\\\n  target"]\njobs: {}\n'],
  ["dot-prefixed flow alias", "name: &.events pull_request_target\non: [*.events]\njobs: {}\n"],
  ["top-level explicit trigger key", "? on\n: [pull_request_target]\njobs: {}\n"],
  ["block explicit event key", "on:\n  ? pull_request_target\n  : null\njobs: {}\n"],
  ["block child flow mapping", "on:\n  { pull_request_target: null }\njobs: {}\n"],
]) {
  try {
    parseWorkflow(invalidYaml, `${label} canary`);
    failures.push(`Workflow parser accepted the ${label} policy canary.`);
  } catch {
    // Expected: ambiguous or extensible YAML features are outside this policy grammar.
  }
}
if (!workflowUsesPullRequestTarget(parseWorkflow(pullRequestTargetCanary, "block trigger canary"))) {
  failures.push("pull_request_target policy canary was not rejected.");
}
if (workflowUsesPullRequestTarget(parseWorkflow("on:\n  pull_request:\njobs: {}\n", "ordinary trigger canary"))) {
  failures.push("pull_request_target policy canary rejected an ordinary pull_request workflow.");
}
if (!workflowUsesPullRequestTarget(parseWorkflow("on: [push, pull_request_target]\njobs: {}\n", "inline trigger canary"))) {
  failures.push("Inline pull_request_target policy canary was not rejected.");
}
if (!workflowUsesPullRequestTarget(parseWorkflow('"on": {"pull_request_target": null}\njobs: {}\n', "quoted flow trigger canary"))) {
  failures.push("Quoted flow-mapping pull_request_target policy canary was not rejected.");
}
if (!workflowUsesPullRequestTarget(parseWorkflow('"\\u006fn": [push, "\\u0070ull_request_target"]\njobs: {}\n', "escaped trigger canary"))) {
  failures.push("Unicode-escaped pull_request_target policy canary was not rejected.");
}
if (!workflowUsesPullRequestTarget(parseWorkflow("on:\n  'pull_request_target':\njobs: {}\n", "quoted block trigger canary"))) {
  failures.push("Quoted block-mapping pull_request_target policy canary was not rejected.");
}
for (const multilineTrigger of [
  "on: [\n  push,\n  pull_request_target\n]\njobs: {}\n",
  '"on": {\n  "pull_request_target": null\n}\njobs: {}\n',
]) {
  if (!workflowUsesPullRequestTarget(parseWorkflow(multilineTrigger, "multiline trigger canary"))) {
    failures.push("Multiline pull_request_target policy canary was not rejected.");
  }
}
if (workflowUsesPullRequestTarget(parseWorkflow("# pull_request_target\non: push\njobs: {}\n", "comment canary"))) {
  failures.push("pull_request_target policy canary rejected a comment.");
}
if (workflowUsesPullRequestTarget(parseWorkflow("on: push\njobs:\n  test:\n    steps:\n      - run: echo pull_request_target\n", "run-text canary"))) {
  failures.push("pull_request_target policy canary rejected ordinary run text.");
}

const validPermissionsCanary = parseWorkflow(
  "on: push\npermissions:\n  contents: read\njobs: {}\n",
  "valid permissions canary",
);
if (validPermissionsCanary.permissions?.contents !== "read") {
  failures.push("Structured permissions policy canary rejected exact contents: read.");
}
for (const [label, invalidPermissions] of [
  [
    "multiline-name permissions spoof",
    'name: "permissions:\n  contents: read"\non: push\npermissions: write-all\njobs: {}\n',
  ],
  ["flow permissions", "on: push\npermissions: { contents: read }\njobs: {}\n"],
  ["duplicate permissions", "on: push\npermissions:\n  contents: read\npermissions:\n  contents: write\njobs: {}\n"],
]) {
  try {
    parseWorkflow(invalidPermissions, `${label} canary`);
    failures.push(`Workflow parser accepted the ${label} policy canary.`);
  } catch {
    // Expected: permissions are accepted only as one exact canonical block mapping.
  }
}

for (const [label, pathFilteredTrigger] of [
  [
    "permissions-before-trigger path filter",
    "permissions:\n  contents: read\non:\n  pull_request:\n    paths:\n      - apps/web/**\njobs: {}\n",
  ],
  [
    "quoted path-filter key",
    'on:\n  pull_request:\n    "paths-ignore": ["docs/**"]\npermissions:\n  contents: read\njobs: {}\n',
  ],
  [
    "flow path-filter key",
    'on: { pull_request: { "paths": ["apps/web/**"] } }\npermissions:\n  contents: read\njobs: {}\n',
  ],
  [
    "escaped flow path-filter key",
    'on: { pull_request: { "\\u0070aths-ignore": ["docs/**"] } }\npermissions:\n  contents: read\njobs: {}\n',
  ],
]) {
  try {
    const parsed = parseWorkflow(pathFilteredTrigger, `${label} canary`);
    if (!parsed.__eventPathFilters) {
      failures.push(`Workflow parser missed the ${label} policy canary.`);
    }
  } catch {
    // Also safe: unsupported trigger syntax is rejected rather than partially interpreted.
  }
}

const untrustedRunContextCanary = `echo "\${{ github.event.pull_request.title }}"`;
if (!usesUntrustedGithubContextInRun(untrustedRunContextCanary)) {
  failures.push("Untrusted workflow-expression policy canary was not rejected.");
}
const environmentMediatedCanary = 'printf "%s\\n" "$PULL_REQUEST_TITLE"';
if (usesUntrustedGithubContextInRun(environmentMediatedCanary)) {
  failures.push("Untrusted workflow-expression policy canary rejected an environment-mediated value.");
}
if (usesUntrustedGithubContextInRun('echo "\${{ github.sha }}"')) {
  failures.push("Immutable github.sha workflow-expression policy canary was rejected.");
}
if (!usesUntrustedGithubContextInRun('echo "\${{ github.ref }}"')) {
  failures.push("Untrusted ref-expression policy canary was not rejected.");
}
for (const expression of [
  "\${{ github['event']['pull_request']['title'] }}",
  "\${{ github.event['pull_request']['title'] }}",
  "\${{ toJSON(github.event) }}",
  "\${{ toJSON(github) }}",
  "\${{ toJSON(inputs) }}",
  "\${{ format('{0}', github.event.pull_request.title) }}",
  "\${{ format('{{0}} {0}', github.event.pull_request.title) }}",
  "\${{ inputs.release_name }}",
  "\${{ github.token }}",
  "\${{ github['token'] }}",
  "\${{ secrets.DEPLOY_TOKEN }}",
  "\${{ secrets['DEPLOY_TOKEN'] }}",
]) {
  if (!usesUntrustedGithubContextInRun(`echo "${expression}"`)) {
    failures.push(`Untrusted wrapped workflow-expression policy canary was not rejected: ${expression}`);
  }
}

for (const canary of [
  "steps:\n  - run: echo \"\${{ github.event.pull_request.title }}\"\n",
  'steps:\n  - "run": echo "\${{ github.event.pull_request.title }}"\n',
  "steps:\n  - run : echo \"\${{ github.event.pull_request.title }}\"\n",
  "steps:\n  - run: |2-\n      echo \"\${{ github.event.pull_request.title }}\"\n",
  "steps:\n  - name: |-\n      harmless\n    run: echo \"\${{ github.event.pull_request.title }}\"\n",
]) {
  const parsed = parseWorkflow(`on: push\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    ${canary.replaceAll("\n", "\n    ")}`, "run syntax canary");
  const unsafeRun = workflowSteps(parsed).some(({ step }) =>
    typeof step.run === "string" && usesUntrustedGithubContextInRun(step.run)
  );
  if (!unsafeRun) failures.push("Run-step syntax policy canary was not rejected.");
}

for (const [label, unsupportedSteps] of [
  ["dash-only step", "steps:\n  -\n    run: echo unsafe\n"],
  ["flow-mapping step", "steps:\n  - { run: echo unsafe }\n"],
  ["anchored and aliased steps", "steps:\n  - &danger\n    run: echo unsafe\n  - *danger\n"],
  ["flow-sequence steps", "steps: [{ run: echo unsafe }]\n"],
  ["explicit run key", "steps:\n  - name: hidden\n    ? run\n    : echo \"\${{ github.event.pull_request.title }}\"\n"],
  ["explicit uses key", "steps:\n  - name: hidden\n    ? uses\n    : owner/action@unreviewed\n"],
  ["multiline plain run expression", "steps:\n  - run: echo \"\${{\n      github.event.pull_request.title }}\"\n"],
]) {
  const invalidWorkflow = `on: push\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    ${unsupportedSteps.replaceAll("\n", "\n    ")}`;
  try {
    parseWorkflow(invalidWorkflow, `${label} canary`);
    failures.push(`Workflow parser accepted the ${label} policy canary.`);
  } catch {
    // Expected: indirect and flow-style step forms are outside this policy grammar.
  }
}

for (const usesLine of [
  "- uses: owner/action@unreviewed",
  '- "uses": owner/action@unreviewed',
  "- uses : owner/action@unreviewed",
]) {
  const parsed = parseWorkflow(`on: push\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n      ${usesLine}\n`, "uses syntax canary");
  const value = workflowSteps(parsed)[0]?.step?.uses;
  if (typeof value !== "string" || fullSha.test(value.split("@").at(-1) || "")) {
    failures.push("Uses-step syntax policy canary did not expose an unpinned action.");
  }
}

let totalJobCount = 0;

for (const name of workflowFiles) {
  const file = `.github/workflows/${name}`;
  const text = readFileSync(resolve(workflowsDir, name), "utf8").replaceAll("\r\n", "\n");
  const lines = text.split("\n");
  let workflow;
  try {
    workflow = parseWorkflow(text, file);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : `${file}: invalid workflow YAML`);
    continue;
  }
  let buildxStepCount = 0;
  let cosignStepCount = 0;
  let denoStepCount = 0;
  const denoChecksumCount = lines.filter((line) => line.trim() === `DENO_BINARY_SHA256: ${denoLinuxAmd64Sha256}`).length;
  const steps = workflowSteps(workflow);
  const verifiedToolInstallerCount = steps.filter(({ step }) =>
    typeof step.run === "string" && step.run.trim() === verifiedToolInstaller
  ).length;
  const syftBinaryCount = steps.reduce((count, { step }) => {
    if (typeof step.run !== "string") return count;
    return count + step.run.split("\n")
      .filter((line) => line.trim() === 'syft "$PIXELFED_IMAGE" -o spdx-json=pixelfed-sbom.spdx.json')
      .length;
  }, 0);
  const jobs = Object.entries(workflow?.jobs || {});
  totalJobCount += jobs.length;

  if (workflowUsesPullRequestTarget(workflow)) {
    failures.push(`${file}: pull_request_target is prohibited; untrusted pull-request code must run only without privileged context.`);
  }
  for (const { jobId, index, step } of steps) {
    if (typeof step.run === "string" && usesUntrustedGithubContextInRun(step.run)) {
      failures.push(`${file}: job ${jobId} step ${index + 1}: do not interpolate mutable github event/ref/actor or inputs context directly into run; assign it to env and quote the shell variable.`);
    }
  }

  if (jobs.length === 0) {
    failures.push(`${file}: workflow must define at least one job.`);
  }
  for (const [jobId, job] of jobs) {
    if (!job || typeof job !== "object" || !Object.hasOwn(job, "runs-on")) {
      failures.push(`${file}: job ${jobId} must define exactly one runs-on value.`);
      continue;
    }

    const value = job["runs-on"];
    const approvedRecoveryMatrix =
      name === "validate-social.yml" &&
      jobId === "validate-recovery-tools" &&
      value === "${{ matrix.runner }}" &&
      hasExactRecoveryRunnerMatrix(job) &&
      hasExactRecoveryArchitectureGate(job);
    if (typeof value !== "string") {
      failures.push(`${file}: job ${jobId} must use one scalar runs-on value.`);
    } else if (value.includes("self-hosted")) {
      failures.push(`${file}: job ${jobId} must not depend on a self-hosted runner.`);
    } else if (value === "ubuntu-latest") {
      failures.push(`${file}: job ${jobId} must pin the Ubuntu 24.04 runner family instead of ubuntu-latest.`);
    } else if (value !== "ubuntu-24.04" && !approvedRecoveryMatrix) {
      failures.push(`${file}: job ${jobId} must use exact runs-on value ubuntu-24.04.`);
    }
  }

  if (workflow.permissions?.contents !== "read" || Object.keys(workflow.permissions).length !== 1) {
    failures.push(`${file}: workflow must declare top-level contents: read permissions.`);
  }

  const requiredContext = alwaysReportingWorkflows.get(name);
  if (requiredContext) {
    if (workflow.__eventPathFilters) {
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

  for (const { jobId, index, step } of steps) {
    if (typeof step.uses !== "string" || step.uses.startsWith("./")) continue;
    const separator = step.uses.lastIndexOf("@");
    const action = separator > 0 ? step.uses.slice(0, separator) : step.uses;
    const ref = separator > 0 ? step.uses.slice(separator + 1) : "";
    if (!action || !fullSha.test(ref || "")) {
      failures.push(`${file}: job ${jobId} step ${index + 1}: external actions must use a full 40-character commit SHA.`);
      continue;
    }

    const withValues = step.with && typeof step.with === "object" ? step.with : {};
    if (action === "actions/checkout" && withValues["persist-credentials"] !== false) {
      failures.push(`${file}: job ${jobId} step ${index + 1}: checkout must disable persisted credentials.`);
    }
    if (action === "actions/setup-node" && withValues["node-version-file"] !== ".node-version") {
      failures.push(`${file}: job ${jobId} step ${index + 1}: setup-node must use the repository .node-version file.`);
    }
    if (action === "denoland/setup-deno") {
      denoStepCount += 1;
      if (withValues["deno-version"] !== "2.9.4") {
        failures.push(`${file}: job ${jobId} step ${index + 1}: setup-deno must install exact Deno 2.9.4.`);
      }
    }
    if (action === cosignInstaller) {
      cosignStepCount += 1;
      if (ref !== cosignInstallerRef || withValues["cosign-release"] !== "v3.0.6") {
        failures.push(`${file}: job ${jobId} step ${index + 1}: Cosign must use the reviewed full-SHA installer and exact v3.0.6 release.`);
      }
    }
    if (action === "docker/setup-buildx-action") {
      buildxStepCount += 1;
      if (Object.hasOwn(withValues, "version") ||
          withValues["cache-binary"] !== false ||
          typeof withValues["driver-opts"] !== "string" ||
          !withValues["driver-opts"].split("\n").some((line) => line.trim() === `image=${buildkitImage}`)) {
        failures.push(`${file}: job ${jobId} step ${index + 1}: setup-buildx must use the preverified Buildx binary with caching disabled and the approved digest-pinned BuildKit v0.31.2 image.`);
      }
    }
    if (action.startsWith("anchore/sbom-action")) {
      failures.push(`${file}: job ${jobId} step ${index + 1}: SBOM generation must use the approved digest-pinned Syft container instead of a runtime installer action.`);
    }
  }

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
