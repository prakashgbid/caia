/**
 * Dispatcher — given a task, creates a git worktree, builds a prompt, and
 * spawns `claude -p` as a child process. Returns process handle + metadata.
 *
 * Dispatch method: Option 1 — claude -p (headless mode, --output-format json).
 * Verified: `claude --help` confirms -p/--print and --output-format flags exist.
 * The output is streamed to stdout and captured; session_id is extracted from
 * the final JSON line.
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { publishEvent } from './publish-event';

const API_BASE = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export interface DispatchTask {
  id: string;
  title: string;
  cwd: string;
  notes: string | null;
  declaredFiles: string[];
  domainSlug: string | null;
  projectId: string | null;
  rootPromptId?: string | null;
}

export interface DispatchConfig {
  maxTurns: number;
  permissionMode: string;
  worktreeBaseDir: string;  // e.g. /repo/.claude/worktrees
}

export interface DispatchHandle {
  taskId: string;
  pid: number;
  worktreePath: string;
  startedAt: string;
  executorRunId: number;
  process: child_process.ChildProcess;
  outputLines: string[];
}

// Phase-2 token optimization: model IDs for tiered routing.
// OAuth via CLAUDE_CODE_OAUTH_TOKEN inherited from launchd plist; never API key.
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
export const MODEL_SONNET = 'claude-sonnet-4-6';
export const MODEL_OPUS = 'claude-opus-4-6';

const HAIKU_KEYWORDS = [
  'status', 'verify', 'check', 'lookup', 'rename', 'rename-only',
  'trivial', '1-line', 'one-line', 'boilerplate',
];
const OPUS_KEYWORDS = [
  'architecture', 'design', 'debug-complex', 'refactor-multi', 'p0',
];

function parseNotes(notes: string | null): Record<string, unknown> | null {
  if (!notes) return null;
  try {
    return JSON.parse(notes) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isCanaryTask(task: DispatchTask): boolean {
  const meta = parseNotes(task.notes);
  return meta?.canary === true;
}

/**
 * Pick a model based on task signals. Default Sonnet 4.6.
 * Order: explicit notes.model override → canary (Haiku) → keyword match → default.
 */
export function selectModel(task: DispatchTask): string {
  const meta = parseNotes(task.notes);
  const override = meta && typeof meta.model === 'string' ? meta.model : null;
  if (override === 'haiku') return MODEL_HAIKU;
  if (override === 'sonnet') return MODEL_SONNET;
  if (override === 'opus') return MODEL_OPUS;
  if (override) return override; // raw model id passthrough

  if (isCanaryTask(task)) return MODEL_HAIKU;

  const haystack = [
    task.title || '',
    typeof meta?.kind === 'string' ? meta.kind : '',
    typeof meta?.complexity === 'string' ? meta.complexity : '',
    typeof meta?.priority === 'string' ? meta.priority : '',
  ].join(' ').toLowerCase();

  for (const kw of OPUS_KEYWORDS) {
    if (haystack.includes(kw)) return MODEL_OPUS;
  }
  for (const kw of HAIKU_KEYWORDS) {
    if (haystack.includes(kw)) return MODEL_HAIKU;
  }
  return MODEL_SONNET;
}

// Stable prefix — identical across worker invocations for prompt-cache reuse.
// Anything variable (task id, title, notes) goes in the tail.
const STABLE_WORKER_PREFIX = `You are a Conductor worker.

Rules:
- End with "[result] DONE: <summary>" or "[result] FAILED: <reason>".
- Max 3min per bash command, 15s per network call.
- Do not ask clarifying questions — make reasonable assumptions and proceed.
- For investigations, audits, or read-only exploration that don't need the worker's main context, spawn a subagent with the Task tool. Reserve main context for the actual change.
- After the result line, stop.

---
`;

export function buildPrompt(task: DispatchTask): string {
  if (isCanaryTask(task)) {
    return `Canary task ${task.id}.
Run: echo "[result] DONE: canary ok"
Then stop.`;
  }

  const files = task.declaredFiles.length > 0
    ? task.declaredFiles.join(', ')
    : '(use judgment)';

  // Variable tail — task-specific. Order matters: stable prefix above is identical
  // per-worker-invocation, so prefix-cache hits compound across the 5-min window.
  let tail = `Task ${task.id}: ${task.title}\nCwd: ${task.cwd}\nFiles: ${files}`;
  if (task.domainSlug) tail += `\nDomain: ${task.domainSlug}`;
  if (task.notes) tail += `\nNotes: ${task.notes}`;

  return STABLE_WORKER_PREFIX + tail;
}

async function createWorktree(
  taskId: string,
  config: DispatchConfig,
): Promise<string> {
  const shortTs = Date.now().toString(36);
  const worktreeName = `exec-${taskId.replace(/[^a-z0-9]/gi, '-')}-${shortTs}`;
  const worktreePath = path.join(config.worktreeBaseDir, worktreeName);

  // Find git root by looking up from cwd
  // We create the worktree from the conductor repo itself
  const conductorRoot = path.resolve(__dirname, '..', '..');

  try {
    child_process.execSync(
      `git worktree add "${worktreePath}" HEAD --detach`,
      { cwd: conductorRoot, stdio: 'pipe' },
    );
  } catch {
    // Worktree creation failed — use a temp dir instead (non-git cwd)
    fs.mkdirSync(worktreePath, { recursive: true });
  }

  return worktreePath;
}

async function registerExecutorRun(
  taskId: string,
  pid: number,
  worktreePath: string,
  attemptN: number,
): Promise<number> {
  const now = new Date().toISOString();
  try {
    const res = await fetch(`${API_BASE}/executor/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        attempt_n: attemptN,
        pid,
        worker_kind: 'claude-p',
        worktree_path: worktreePath,
        started_at: now,
        status: 'running',
      }),
    });
    if (res.ok) {
      const data = await res.json() as { id: number };
      return data.id;
    }
  } catch { /* API may be unavailable; non-fatal */ }
  return 0;
}

export async function dispatch(
  task: DispatchTask,
  config: DispatchConfig,
  attemptN: number,
): Promise<DispatchHandle> {
  const worktreePath = await createWorktree(task.id, config);
  const prompt = buildPrompt(task);
  const model = selectModel(task);
  const now = new Date().toISOString();

  const claudeArgs = [
    '--print',
    '--output-format', 'json',
    '--permission-mode', config.permissionMode,
    '--model', model,
    prompt,
  ];

  if (process.env['EXECUTOR_DEBUG']) {
    process.stderr.write(`[executor:task-${task.id}] model=${model}\n`);
  }

  const proc = child_process.spawn('claude', claudeArgs, {
    cwd: task.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  const outputLines: string[] = [];

  proc.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(l => l.trim());
    outputLines.push(...lines);
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (process.env['EXECUTOR_DEBUG']) {
      process.stderr.write(`[executor:task-${task.id}] ${text}`);
    }
  });

  // Prevent unhandled 'error' events from crashing the daemon (e.g. ENOENT)
  proc.on('error', (err: Error) => {
    process.stderr.write(`[executor:spawn-error task-${task.id}] ${err.message}\n`);
  });

  const pid = proc.pid ?? 0;

  // Mark task as running via API
  try {
    await fetch(`${API_BASE}/executor/tasks/${task.id}/running`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ started_at: now, attempt_n: attemptN }),
    });
  } catch { /* non-fatal */ }

  const executorRunId = await registerExecutorRun(task.id, pid, worktreePath, attemptN);

  // Emit worker.spawned via API.
  // DASH-107: stamp correlation_id (task.rootPromptId) and entity attribution
  // so /prompts/:id/journey can attribute the spawned worker to the originating
  // prompt across the executor → worker boundary.
  await publishEvent(
    'worker.spawned',
    { executor_run_id: executorRunId, task_id: task.id, pid, worktree_path: worktreePath },
    { correlationId: task.rootPromptId ?? null, entityType: 'task', entityId: task.id },
  );

  // Emit structured pick-up event for observability pipeline
  await publishEvent('executor.task.picked_up', {
    taskId: task.id,
    rootPromptId: task.rootPromptId ?? null,
    executorRunId,
    executorPid: pid,
    worktreePath,
    model,
    attemptN,
  }, { correlationId: task.rootPromptId ?? null, entityType: 'task', entityId: task.id });

  return {
    taskId: task.id,
    pid,
    worktreePath,
    startedAt: now,
    executorRunId,
    process: proc,
    outputLines,
  };
}

export function parseClaudeOutput(lines: string[]): {
  sessionId: string | null;
  resultOk: boolean;
  summary: string;
  costUsd: number | null;
  turnCount: number | null;
} {
  let sessionId: string | null = null;
  let resultOk = false;
  let summary = '';
  let costUsd: number | null = null;
  let turnCount: number | null = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj['session_id']) sessionId = String(obj['session_id']);
      if (obj['cost_usd'] !== undefined) costUsd = Number(obj['cost_usd']);
      if (obj['num_turns'] !== undefined) turnCount = Number(obj['num_turns']);
      if (typeof obj['result'] === 'string') {
        summary = (obj['result'] as string).slice(0, 1000);
        resultOk = summary.toLowerCase().includes('[result] done');
      }
    } catch { /* not JSON — plain text output */ }
  }

  // Fallback: scan raw lines for result marker
  if (!summary) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.includes('[result]')) {
        summary = line.trim().slice(0, 1000);
        resultOk = line.toLowerCase().includes('[result] done');
        break;
      }
    }
  }

  return { sessionId, resultOk, summary, costUsd, turnCount };
}

export function cleanupWorktree(worktreePath: string): void {
  const conductorRoot = path.resolve(__dirname, '..', '..');
  try {
    child_process.execSync(
      `git worktree remove "${worktreePath}" --force`,
      { cwd: conductorRoot, stdio: 'pipe' },
    );
  } catch {
    // If not a git worktree, just remove the directory
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}
