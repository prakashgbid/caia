/**
 * judge — optional `claude` binary subprocess for tied outputs.
 *
 * Per DESIGN.md §7d. Subscription-only:
 *   - ANTHROPIC_API_KEY is explicitly cleared from the spawned env.
 *   - Hard cap via judgeBudget (caller-enforced).
 *   - Default judgeEnabled: false.
 *   - Anonymised A/B presentation; the harness records the un-anon mapping.
 */

import { spawnClaude, SCRUBBED_AUTH_ENV_VARS } from '@chiefaia/claude-spawner';
import type { spawn } from 'node:child_process';

import type { ClaudeJudge } from './types.js';

export interface CreateClaudeJudgeOpts {
  readonly claudeBin?: string;
  readonly timeoutMs?: number;
  readonly spawnImpl?: typeof spawn;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Re-export of `@chiefaia/claude-spawner`'s SCRUBBED_AUTH_ENV_VARS so
 * existing imports of `SECRETS_TO_SCRUB` from this module's tests
 * keep working. Same list, single source of truth.
 */
const SECRETS_TO_SCRUB = SCRUBBED_AUTH_ENV_VARS;

function scrub(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const k of SECRETS_TO_SCRUB) delete out[k];
  return out;
}

const JUDGE_PROMPT_TEMPLATE = `\
You are a strict pairwise judge. Two model outputs (A and B) are below for the same prompt. Decide which is better. Respond with EXACTLY ONE LINE in this shape:

  A | <one-sentence rationale>
  B | <one-sentence rationale>
  TIE | <one-sentence rationale>

Do not pick A merely because it is longer. Do not output anything beyond that one line.

----- PROMPT -----
{{PROMPT}}

----- OUTPUT A -----
{{A}}

----- OUTPUT B -----
{{B}}
`;

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Thin shim around `@chiefaia/claude-spawner`'s `spawnClaude` that
 * preserves the existing judge-internal `RunResult` shape (so the
 * preference-parsing path doesn't have to change).
 *
 * The `claude-spawner` package owns env scrub + timeout; we no longer
 * manage either locally. Timeout-as-rejection is preserved via the
 * `ok=false && timedOut=true` branch.
 */
async function runProcess(
  bin: string,
  args: ReadonlyArray<string>,
  stdin: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
  spawnImpl: (typeof spawn) | undefined
): Promise<RunResult> {
  const result = await spawnClaude({
    prompt: stdin,
    options: {
      binaryPath: bin,
      overrideArgs: [...args],
      extraEnv: env as Record<string, string>,
      timeoutMs,
      ...(spawnImpl !== undefined ? { spawnFn: spawnImpl } : {})
    }
  });
  if (result.timedOut) {
    throw new Error(`[apprentice-eval] judge subprocess timeout after ${timeoutMs}ms`);
  }
  if (!result.ok && result.diagnostic?.startsWith('child process error')) {
    throw new Error(result.diagnostic.slice('child process error: '.length));
  }
  if (!result.ok && result.diagnostic?.startsWith('failed to spawn')) {
    throw new Error(result.diagnostic.slice('failed to spawn '.length));
  }
  return { stdout: result.stdout, stderr: result.stderr, code: result.rc };
}

export function parseJudgeReply(reply: string): {
  preference: 'A' | 'B' | 'tie';
  rationale: string;
} {
  const line = reply.trim().split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const m = /^\s*(A|B|TIE)\s*\|\s*(.*)$/i.exec(line);
  if (!m) {
    return { preference: 'tie', rationale: `unparseable judge reply: ${line.slice(0, 200)}` };
  }
  const verdict = m[1]!.toUpperCase();
  const pref: 'A' | 'B' | 'tie' = verdict === 'A' ? 'A' : verdict === 'B' ? 'B' : 'tie';
  return { preference: pref, rationale: (m[2] ?? '').trim() };
}

export function createClaudeJudge(opts: CreateClaudeJudgeOpts = {}): ClaudeJudge {
  const claudeBin = opts.claudeBin ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? 60_000;
  // spawnImpl falls back to undefined → spawnClaude uses its own default.
  const spawnImpl = opts.spawnImpl;
  const env = scrub(opts.env ?? process.env);

  return {
    async available() {
      try {
        const r = await runProcess(claudeBin, ['--version'], '', 5_000, env, spawnImpl);
        return r.code === 0;
      } catch {
        return false;
      }
    },
    async judge({ prompt, outputA, outputB }) {
      const stdin = JUDGE_PROMPT_TEMPLATE.replace('{{PROMPT}}', prompt)
        .replace('{{A}}', outputA)
        .replace('{{B}}', outputB);
      const result = await runProcess(
        claudeBin,
        ['--print'],
        stdin,
        timeoutMs,
        env,
        spawnImpl
      );
      if (result.code !== 0) {
        throw new Error(
          `[apprentice-eval] claude judge exited ${result.code}: ${result.stderr.slice(0, 300)}`
        );
      }
      return parseJudgeReply(result.stdout);
    }
  };
}

export const __TEST_ONLY = { JUDGE_PROMPT_TEMPLATE, scrub, SECRETS_TO_SCRUB };
