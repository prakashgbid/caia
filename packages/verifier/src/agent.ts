/**
 * VerifierAgent — public entrypoint.
 *
 * Orchestrates a single verifier run end-to-end:
 *
 *   1. Create a fresh git worktree at /tmp/verifier_<job_id> at PR head SHA.
 *   2. Build the verifier prompt (independent of implementing spawn — fresh
 *      prompt, no shared context beyond the strict-JSON DoD blob).
 *   3. Spawn `claude --print --permission-mode bypassPermissions`, with
 *      ANTHROPIC_API_KEY scrubbed from env (subscription-only path).
 *   4. Parse + schema-validate the last-line JSON blob.
 *   5. Cleanup the worktree (try/finally — runs on success, exception,
 *      and timeout paths). Idempotent.
 *
 * The agent itself NEVER recurses (no nested verifier on the verifier).
 * The MAX_VERIFIER_BUDGET_MS cap (15 min) enforces the "budget it like any
 * other spawn" constraint from the operating contract.
 *
 * Returns a VerifierRunOutcome describing the final verdict, the cleanup
 * outcome, and the failure reason (if any).
 */

import { spawnClaude } from '@chiefaia/claude-spawner';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildVerifierPrompt } from './prompt-builder.js';
import type {
  RoutingClass,
  VerifierRunOutcome,
  VerifierSpawnInputs,
  VerifierVerdict
} from './types.js';
import { parseAndValidateVerdict } from './verdict-validator.js';
import { createWorktree, type WorktreeHandle } from './worktree.js';

/** 15-minute hard cap per the operating contract. */
const MAX_VERIFIER_BUDGET_MS = 15 * 60 * 1000;

export interface VerifierAgentConfig {
  /** Repo root the verifier runs against. Defaults to cwd. */
  repoPath?: string;
  /** Override the default `claude` binary lookup. */
  claudeBinary?: string;
  /** Maximum wall-clock for the spawn. Default 15min. */
  maxBudgetMs?: number;
  /** Test seam — replaces the runChild() implementation. */
  runChild?: RunChildFn;
  /** Test seam — replaces the worktree factory. */
  worktreeFactory?: typeof createWorktree;
}

export interface RunChildResult {
  rc: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type RunChildFn = (args: {
  binary: string;
  argv: string[];
  cwd: string;
  prompt: string;
  env: Record<string, string>;
  timeoutMs: number;
}) => Promise<RunChildResult>;

/**
 * Default child runner — delegates to `@chiefaia/claude-spawner`'s
 * `spawnClaude`. The agent-level `runChild` test seam is preserved so
 * existing tests can inject a mock without depending on claude-spawner
 * internals; this default impl just adapts the shapes.
 */
const defaultRunChild: RunChildFn = async ({ binary, argv, cwd, prompt, env, timeoutMs }) => {
  // The agent already strips ANTHROPIC_API_KEY in buildEnvWithoutApiKey,
  // but spawnClaude scrubs again unconditionally — defence in depth.
  const result = await spawnClaude({
    prompt,
    options: {
      binaryPath: binary,
      overrideArgs: argv,
      cwd,
      // Pass the agent-built env through; claude-spawner will scrub the
      // canonical auth-token vars regardless of what we hand it.
      extraEnv: env,
      timeoutMs
    }
  });
  return {
    rc: result.rc ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut
  };
};

function lastJsonLine(stdout: string): string | null {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const t = raw.trim();
    if (t.startsWith('{') && t.endsWith('}')) return t;
  }
  return null;
}

function buildEnvWithoutApiKey(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'ANTHROPIC_API_KEY') continue; // subscription-only
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export class VerifierAgent {
  readonly config: Required<Omit<VerifierAgentConfig, 'runChild' | 'worktreeFactory'>> & {
    runChild: RunChildFn;
    worktreeFactory: typeof createWorktree;
  };

  constructor(input: VerifierAgentConfig = {}) {
    this.config = {
      repoPath: input.repoPath ?? process.cwd(),
      claudeBinary: input.claudeBinary ?? 'claude',
      maxBudgetMs: input.maxBudgetMs ?? MAX_VERIFIER_BUDGET_MS,
      runChild: input.runChild ?? defaultRunChild,
      worktreeFactory: input.worktreeFactory ?? createWorktree
    };
  }

  async verify(input: VerifierSpawnInputs): Promise<VerifierRunOutcome> {
    const startedAt = Date.now();

    // The slot-manager may have already created the worktree, in which
    // case input.verifierWorktree is honoured as-is and the agent does
    // NOT create one. This lets the spawner own the lifecycle when it
    // runs the verifier as a vendored phase, while letting the CLI use
    // the agent standalone.
    let wt: WorktreeHandle | null = null;
    let worktreePath = input.verifierWorktree;
    let cleanupReason: 'success' | 'exception' | 'timeout' | 'sigterm' = 'success';
    let worktreeCleanedUp = false;

    try {
      if (!worktreePath || worktreePath === '') {
        const jobId = `${input.taskId}-${input.verifierSpawnId}`;
        wt = this.config.worktreeFactory({
          repoPath: this.config.repoPath,
          jobId,
          commitSha: input.prHeadSha
        });
        worktreePath = wt.path;
      }
      const promptInput: VerifierSpawnInputs = { ...input, verifierWorktree: worktreePath };
      const prompt = buildVerifierPrompt(promptInput);

      const env = buildEnvWithoutApiKey();
      const claudeArgs = [
        '--print',
        '--permission-mode',
        'bypassPermissions',
        '--output-format',
        'text'
      ];
      const childResult = await this.config.runChild({
        binary: this.config.claudeBinary,
        argv: claudeArgs,
        cwd: worktreePath,
        prompt,
        env,
        timeoutMs: this.config.maxBudgetMs
      });

      if (childResult.timedOut) cleanupReason = 'timeout';
      const stdoutTail = childResult.stdout.slice(-2000);
      const stderrTail = childResult.stderr.slice(-2000);
      const lastLine = lastJsonLine(childResult.stdout);

      let verdict: VerifierVerdict | null = null;
      let failureReason: string | null = null;

      if (childResult.timedOut) {
        failureReason = `verifier timed out after ${this.config.maxBudgetMs}ms`;
      } else if (childResult.rc !== 0) {
        failureReason = `verifier rc=${childResult.rc}; stderr-tail=${stderrTail.slice(-500)}`;
      } else if (lastLine === null) {
        failureReason = 'verifier produced no parseable JSON last-line';
      } else {
        const r = parseAndValidateVerdict(lastLine);
        if (r.ok && r.verdict) {
          verdict = r.verdict;
        } else {
          failureReason = `verifier verdict failed schema: ${r.errors.join('; ')}`;
        }
      }

      // Cleanup runs whether verdict was good or bad — finally branch.
      if (wt) {
        await wt.cleanup(cleanupReason);
        worktreeCleanedUp = wt.cleanedUp();
      } else {
        worktreeCleanedUp = true; // caller manages
      }

      const ok = verdict !== null && verdict.overall === 'pass';
      return {
        ok,
        verdict,
        rawLastLine: lastLine,
        stdoutTail,
        stderrTail,
        worktreePath,
        worktreeCleanedUp,
        cleanupReason,
        durationMs: Date.now() - startedAt,
        failureReason
      };
    } catch (e) {
      cleanupReason = 'exception';
      if (wt) {
        await wt.cleanup(cleanupReason);
        worktreeCleanedUp = wt.cleanedUp();
      }
      return {
        ok: false,
        verdict: null,
        rawLastLine: null,
        stdoutTail: '',
        stderrTail: '',
        worktreePath,
        worktreeCleanedUp,
        cleanupReason,
        durationMs: Date.now() - startedAt,
        failureReason: `verifier exception: ${(e as Error).message}`
      };
    }
  }
}

export interface RunVerifierArgs {
  inputs: VerifierSpawnInputs;
  config?: VerifierAgentConfig;
}

export async function runVerifier(args: RunVerifierArgs): Promise<VerifierRunOutcome> {
  const agent = new VerifierAgent(args.config);
  return agent.verify(args.inputs);
}

/** Map a routing class to the autonomous-loop blocking semantics. */
export function isBlockingForRouting(rc: RoutingClass): boolean {
  return rc === 'autonomous-loop';
}

/** Helper used by tests + the CLI to fabricate a stable jobId. */
export function deriveJobId(taskId: string, verifierSpawnId: string): string {
  return mkdtempSync(join(tmpdir(), `${taskId}-${verifierSpawnId}-`))
    .split('/')
    .pop() as string;
}
