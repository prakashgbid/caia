// V2 templated chain scaffolder (sibling of the LLM-assisted path in
// `src/llm.ts`). Converts a fully-structured backlog item (yaml shape
// below) into the three on-disk artifacts a chain needs:
//
//   ~/.caia/chain/<id>/state.json
//   ~/Documents/projects/agent-memory/<id>_phases.yaml
//   ~/Documents/projects/agent-memory/_<id>_run_phase.sh
//
// Output shape mirrors the existing hand-built chains so the orchestrator
// + chain-runner pipeline picks generated chains up unchanged.
//
// Determinism is the contract: same input → byte-identical output (no
// timestamps in the rendered runner / yaml beyond a header comment, no
// LLM calls, no network).

import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { Machine } from './types.js';

export interface BacklogSuccessCriteria {
  output_file: string;
  min_bytes: number;
  grep_match?: string;
  requires_merged_pr?: boolean;
}

export interface BacklogItem {
  id: string;
  title: string;
  description: string;
  machine: Machine;
  file_paths: string[];
  success_criteria: BacklogSuccessCriteria;
  phase_count: number;
  deps: string[];
  demonstrate_step: string;
}

export interface ScaffoldOptions {
  /** Override $HOME for tests. */
  home?: string;
  /** Override the timestamp baked into the runner script comment (tests). */
  generatedAt?: string;
  /** Allow overwriting existing artifacts. Default false → throws. */
  force?: boolean;
}

export interface ScaffoldResult {
  chainId: string;
  stateFile: string;
  phasesYaml: string;
  runnerScript: string;
  phaseLogDir: string;
}

const VALID_MACHINES: ReadonlySet<Machine> = new Set<Machine>(['m3', 'm1', 'stolution']);
const ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export function validateBacklogItem(item: unknown): asserts item is BacklogItem {
  if (!item || typeof item !== 'object') {
    throw new Error('backlog item: not an object');
  }
  const it = item as Record<string, unknown>;
  if (typeof it.id !== 'string' || !ID_RE.test(it.id)) {
    throw new Error(
      `backlog item: invalid id ${JSON.stringify(it.id)} (lowercase kebab-case required)`,
    );
  }
  if (typeof it.title !== 'string' || it.title.length === 0) {
    throw new Error('backlog item: title required (non-empty string)');
  }
  if (typeof it.description !== 'string' || it.description.length === 0) {
    throw new Error('backlog item: description required (non-empty string)');
  }
  if (typeof it.machine !== 'string' || !VALID_MACHINES.has(it.machine as Machine)) {
    throw new Error(
      `backlog item: machine must be one of ${[...VALID_MACHINES].join(',')} (got ${JSON.stringify(it.machine)})`,
    );
  }
  if (!Array.isArray(it.file_paths) || it.file_paths.some((p) => typeof p !== 'string')) {
    throw new Error('backlog item: file_paths must be string[]');
  }
  const sc = it.success_criteria;
  if (!sc || typeof sc !== 'object') {
    throw new Error('backlog item: success_criteria required (object)');
  }
  const scc = sc as Record<string, unknown>;
  if (typeof scc.output_file !== 'string' || scc.output_file.length === 0) {
    throw new Error('backlog item: success_criteria.output_file required');
  }
  if (typeof scc.min_bytes !== 'number' || scc.min_bytes < 0) {
    throw new Error('backlog item: success_criteria.min_bytes must be a non-negative number');
  }
  if (scc.grep_match !== undefined && typeof scc.grep_match !== 'string') {
    throw new Error('backlog item: success_criteria.grep_match must be a string when provided');
  }
  if (scc.requires_merged_pr !== undefined && typeof scc.requires_merged_pr !== 'boolean') {
    throw new Error('backlog item: success_criteria.requires_merged_pr must be a boolean');
  }
  if (typeof it.phase_count !== 'number' || it.phase_count < 1 || it.phase_count > 3) {
    throw new Error(
      `backlog item: phase_count must be an integer in [1, 3] (got ${JSON.stringify(it.phase_count)})`,
    );
  }
  if (!Array.isArray(it.deps) || it.deps.some((d) => typeof d !== 'string')) {
    throw new Error('backlog item: deps must be string[]');
  }
  if (typeof it.demonstrate_step !== 'string' || it.demonstrate_step.length === 0) {
    throw new Error('backlog item: demonstrate_step required (non-empty string)');
  }
}

export function deriveLogSlug(chainId: string): string {
  return chainId.replace(/-/g, '_');
}

export function chainPaths(chainId: string, home: string): {
  stateDir: string;
  stateFile: string;
  phasesYaml: string;
  runnerScript: string;
  phaseLogDir: string;
} {
  const slug = deriveLogSlug(chainId);
  const memDir = join(home, 'Documents/projects/agent-memory');
  return {
    stateDir: join(home, '.caia/chain', chainId),
    stateFile: join(home, '.caia/chain', chainId, 'state.json'),
    phasesYaml: join(memDir, `${slug}_phases.yaml`),
    runnerScript: join(memDir, `_${slug}_run_phase.sh`),
    phaseLogDir: join(memDir, `_${slug}_phase_logs`),
  };
}

interface BlueprintPhase {
  id: number;
  name: string;
  description: string;
  max_minutes: number;
  promptKind: 'implement' | 'verify' | 'demonstrate';
}

function blueprintPhases(item: BacklogItem): BlueprintPhase[] {
  const n = item.phase_count;
  if (n === 1) {
    return [
      {
        id: 1,
        name: 'implement',
        description: `Implement: ${item.title}`,
        max_minutes: 180,
        promptKind: 'implement',
      },
    ];
  }
  if (n === 2) {
    return [
      {
        id: 1,
        name: 'implement',
        description: `Implement: ${item.title}`,
        max_minutes: 180,
        promptKind: 'implement',
      },
      {
        id: 2,
        name: 'demonstrate_and_report',
        description: `Demonstrate + report: ${item.title}`,
        max_minutes: 60,
        promptKind: 'demonstrate',
      },
    ];
  }
  return [
    {
      id: 1,
      name: 'investigate',
      description: `Investigate: ${item.title}`,
      max_minutes: 60,
      promptKind: 'verify',
    },
    {
      id: 2,
      name: 'implement',
      description: `Implement: ${item.title}`,
      max_minutes: 180,
      promptKind: 'implement',
    },
    {
      id: 3,
      name: 'demonstrate_and_report',
      description: `Demonstrate + report: ${item.title}`,
      max_minutes: 60,
      promptKind: 'demonstrate',
    },
  ];
}

function bullet(items: string[]): string {
  if (items.length === 0) return '  (none — see description above)';
  return items.map((p) => `  - ${p}`).join('\n');
}

function renderImplementPrompt(item: BacklogItem, phaseId: number): string {
  const branch = `feat/${item.id}`;
  const merged = item.success_criteria.requires_merged_pr ? 'YES — drive to MERGED' : 'no';
  return `Phase ${phaseId} — ${item.title}

## Background
${item.description}

## Files in scope
${bullet(item.file_paths)}

## Implementation
1. Make the change described above. Touch only the files in scope unless a dependency
   forces you to extend the blast radius — if you do, document why in the report.
2. Add unit tests covering the new behavior. Wire them into the package's test runner.
3. Run \`pnpm --filter <package> test\` for every touched package; do not ship red.

## PR
Branch: \`${branch}\`
Open via \`caia-pr-create-safe\` (rebases on develop). Merge required: ${merged}.

## Demonstrate
${item.demonstrate_step}

## Report
Write to ${item.success_criteria.output_file}
- min size ${item.success_criteria.min_bytes} bytes
- summarize what shipped, the PR # (if any), and any follow-ups.
${item.success_criteria.grep_match ? `- must mention: ${item.success_criteria.grep_match}` : ''}

Then \`gate-mark-done.sh\` + \`caia-chain mark-done ${phaseId}\`.
`;
}

function renderVerifyPrompt(item: BacklogItem, phaseId: number): string {
  return `Phase ${phaseId} — investigate before implementation: ${item.title}

## Background
${item.description}

## Investigate
Read the files in scope and adjacent code. Confirm the planned change is still correct
given current state (drift since the backlog item was filed). Note any surprises.

## Files
${bullet(item.file_paths)}

## Report
Write a short note to ${item.success_criteria.output_file} with:
- "still applies as written" OR "needs adjustment: <what>"
- the exact lines/symbols that will change in phase ${phaseId + 1}.

\`gate-mark-done.sh\` + \`caia-chain mark-done ${phaseId}\`.
`;
}

function renderDemonstratePrompt(item: BacklogItem, phaseId: number): string {
  return `Phase ${phaseId} — demonstrate + final report: ${item.title}

## Demonstrate the implementation
${item.demonstrate_step}

Capture the command output. If it fails, the implementation phase regressed —
mark this phase failed and trigger re-run of the implementation phase.

## Final report
Update / overwrite ${item.success_criteria.output_file} with:
- what shipped (summary + PR # if any)
- the demonstrate output (verbatim block)
- any v1.1 follow-ups
${item.success_criteria.grep_match ? `- must mention: ${item.success_criteria.grep_match}` : ''}

Min size ${item.success_criteria.min_bytes} bytes.

\`gate-mark-done.sh\` + \`caia-chain mark-done ${phaseId}\`.
`;
}

function renderPrompt(item: BacklogItem, blueprint: BlueprintPhase): string {
  switch (blueprint.promptKind) {
    case 'implement':
      return renderImplementPrompt(item, blueprint.id);
    case 'verify':
      return renderVerifyPrompt(item, blueprint.id);
    case 'demonstrate':
      return renderDemonstratePrompt(item, blueprint.id);
  }
}

interface RenderedSuccessCriteria {
  output_file: string;
  min_bytes: number;
  grep_match?: string;
  requires_merged_pr?: boolean;
}

interface RenderedPhase {
  id: number;
  name: string;
  description: string;
  deps: number[];
  max_minutes: number;
  success_criteria: RenderedSuccessCriteria;
  prompt_template: string;
}

interface RenderedSpec {
  defaults: { max_retries: number; heartbeat_interval_sec: number };
  chain_config: {
    alert_channels: string[];
    max_concurrent: number;
    acceptance_enforce_default: 'warn' | 'strict';
    machine: Machine;
  };
  phases: RenderedPhase[];
}

export function buildChainSpec(item: BacklogItem): RenderedSpec {
  const blueprint = blueprintPhases(item);
  const isLast = (id: number): boolean => id === blueprint[blueprint.length - 1]!.id;
  const phases: RenderedPhase[] = blueprint.map((bp) => {
    const sc: RenderedSuccessCriteria = {
      output_file: item.success_criteria.output_file,
      min_bytes: isLast(bp.id) ? item.success_criteria.min_bytes : 200,
    };
    if (item.success_criteria.grep_match && isLast(bp.id)) {
      sc.grep_match = item.success_criteria.grep_match;
    }
    if (item.success_criteria.requires_merged_pr && bp.promptKind === 'implement') {
      sc.requires_merged_pr = true;
    }
    return {
      id: bp.id,
      name: bp.name,
      description: bp.description,
      deps: bp.id === 1 ? [] : [bp.id - 1],
      max_minutes: bp.max_minutes,
      success_criteria: sc,
      prompt_template: renderPrompt(item, bp),
    };
  });
  return {
    defaults: { max_retries: 2, heartbeat_interval_sec: 60 },
    chain_config: {
      alert_channels: ['handoff', 'inbox', 'audit'],
      max_concurrent: 1,
      acceptance_enforce_default: 'warn',
      machine: item.machine,
    },
    phases,
  };
}

export function renderPhasesYaml(item: BacklogItem): string {
  const spec = buildChainSpec(item);
  const header =
    `# ${item.id} — generated by @chiefaia/chain-scaffolder (templated path).\n` +
    `# Title:       ${item.title}\n` +
    `# Machine:     ${item.machine}\n` +
    `# Phase count: ${item.phase_count}\n` +
    (item.deps.length > 0 ? `# Chain deps:  ${item.deps.join(', ')}\n` : '') +
    `# DO NOT hand-edit. Re-scaffold via caia-scaffold from-template.\n`;
  const body = yaml.dump(spec, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  return `${header}\n${body}`;
}

const CAIA_CHAIN_BIN_DEFAULT = '/Users/macbook32/Documents/projects/caia/packages/chain-runner/bin/caia-chain.js';

export interface RunnerScriptInputs {
  chainId: string;
  phasesYaml: string;
  phaseLogDir: string;
  caiaChainBin?: string;
  generatedAt: string;
  fileScope: string[];
}

export function renderRunnerScript(inputs: RunnerScriptInputs): string {
  const caia = inputs.caiaChainBin ?? CAIA_CHAIN_BIN_DEFAULT;
  const addDirs = [
    '/Users/macbook32/Documents/projects/caia',
    '/Users/macbook32/Documents/projects/agent-memory',
    '/Users/macbook32/Documents/projects/reports',
  ]
    .map((d) => `  --add-dir ${d}`)
    .join(' \\\n');
  return `#!/bin/bash
# ${inputs.chainId} — run-phase dispatcher
# Generated by @chiefaia/chain-scaffolder at ${inputs.generatedAt}.
# DO NOT hand-edit; re-scaffold via caia-scaffold from-template.
set -euo pipefail
PHASE_ID="$1"; SESSION_ID="$2"; PROMPT_FILE="$3"
CHAIN_ID="${inputs.chainId}"
PHASES_FILE="${inputs.phasesYaml}"
CAIA_CHAIN="${caia}"
NODE_BIN="\${NODE_BIN:-/opt/homebrew/opt/node@22/bin/node}"
[ -x "$NODE_BIN" ] || NODE_BIN="/opt/homebrew/bin/node"
LOG_DIR="${inputs.phaseLogDir}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/phase\${PHASE_ID}_\${SESSION_ID}.log"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting phase=$PHASE_ID session=$SESSION_ID" | tee -a "$LOG_FILE"
( while true; do "$NODE_BIN" "$CAIA_CHAIN" heartbeat "$SESSION_ID" --chain-id "$CHAIN_ID" --phases "$PHASES_FILE" 2>/dev/null || true; sleep 60; done ) &
HB=$!
trap "kill $HB 2>/dev/null || true" EXIT
unset ANTHROPIC_API_KEY; unset ANTHROPIC_KEY
claude --permission-mode bypassPermissions --print --output-format text --max-turns 200 \\
${addDirs} \\
  < "$PROMPT_FILE" 2>&1 | tee -a "$LOG_FILE"
CE="\${PIPESTATUS[0]}"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] claude_exit=$CE" | tee -a "$LOG_FILE"
if [ -r "$HOME/.caia/chain-watchdog/_dispatcher_helpers.sh" ]; then
  source "$HOME/.caia/chain-watchdog/_dispatcher_helpers.sh"
  if detect_server_error 2>/dev/null; then mark_failed_transient_server_error 2>/dev/null || true; fi
fi
exit "$CE"
`;
}

interface PhaseState {
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'blocked';
  attempts: number;
  max_retries: number;
  max_minutes: number;
  started_at: string | null;
  completed_at: string | null;
  session_id: string | null;
  error: string | null;
  failure: null;
  last_failure_class: null;
  backoff_until: null;
  heartbeat_grace_sec: number;
}

interface StateFile {
  schema_version: number;
  chain_id: string;
  started_at: string | null;
  last_wake: null;
  paused: boolean;
  paused_at: null;
  paused_until: null;
  paused_reason: string | null;
  budget_consumed_pct: number;
  budget_cap_pct: number;
  current_phase: number | null;
  all_done: boolean;
  none_eligible_streak: number;
  phase_status: Record<string, PhaseState>;
}

const SCHEMA_VERSION = 2;
const DEFAULT_BUDGET_CAP_PCT = 25;
const DEFAULT_HEARTBEAT_GRACE_SEC = 1800;

export function buildInitialState(item: BacklogItem): StateFile {
  const blueprint = blueprintPhases(item);
  const phase_status: Record<string, PhaseState> = {};
  for (const bp of blueprint) {
    phase_status[String(bp.id)] = {
      status: 'pending',
      attempts: 0,
      max_retries: 2,
      max_minutes: bp.max_minutes,
      started_at: null,
      completed_at: null,
      session_id: null,
      error: null,
      failure: null,
      last_failure_class: null,
      backoff_until: null,
      heartbeat_grace_sec: DEFAULT_HEARTBEAT_GRACE_SEC,
    };
  }
  return {
    schema_version: SCHEMA_VERSION,
    chain_id: item.id,
    started_at: null,
    last_wake: null,
    paused: true,
    paused_at: null,
    paused_until: null,
    paused_reason:
      'scaffolded by @chiefaia/chain-scaffolder — operator/orchestrator must `caia-chain resume` before dispatch',
    budget_consumed_pct: 0,
    budget_cap_pct: DEFAULT_BUDGET_CAP_PCT,
    current_phase: null,
    all_done: false,
    none_eligible_streak: 0,
    phase_status,
  };
}

export function scaffoldFromBacklogItem(
  item: BacklogItem,
  opts: ScaffoldOptions = {},
): ScaffoldResult {
  validateBacklogItem(item);
  const home = opts.home ?? homedir();
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const paths = chainPaths(item.id, home);

  if (!opts.force) {
    for (const p of [paths.stateFile, paths.phasesYaml, paths.runnerScript]) {
      if (existsSync(p)) {
        throw new Error(
          `${p} already exists — pass --force to overwrite, or move it aside first`,
        );
      }
    }
  }

  mkdirSync(paths.stateDir, { recursive: true });
  mkdirSync(paths.phaseLogDir, { recursive: true });

  const state = buildInitialState(item);
  writeFileSync(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  writeFileSync(paths.phasesYaml, renderPhasesYaml(item), 'utf8');

  const runner = renderRunnerScript({
    chainId: item.id,
    phasesYaml: paths.phasesYaml,
    phaseLogDir: paths.phaseLogDir,
    generatedAt,
    fileScope: item.file_paths,
  });
  writeFileSync(paths.runnerScript, runner, 'utf8');
  chmodSync(paths.runnerScript, 0o755);

  return {
    chainId: item.id,
    stateFile: paths.stateFile,
    phasesYaml: paths.phasesYaml,
    runnerScript: paths.runnerScript,
    phaseLogDir: paths.phaseLogDir,
  };
}
