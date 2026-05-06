/**
 * judge — optional `claude` binary subprocess for tied outputs.
 *
 * Per DESIGN.md §7d. Subscription-only:
 *   - ANTHROPIC_API_KEY is explicitly cleared from the spawned env.
 *   - Hard cap via judgeBudget (caller-enforced).
 *   - Default judgeEnabled: false.
 *   - Anonymised A/B presentation; the harness records the un-anon mapping.
 */

import { spawn } from 'node:child_process';

import type { ClaudeJudge } from './types.js';

export interface CreateClaudeJudgeOpts {
  readonly claudeBin?: string;
  readonly timeoutMs?: number;
  readonly spawnImpl?: typeof spawn;
  readonly env?: NodeJS.ProcessEnv;
}

const SECRETS_TO_SCRUB = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'COHERE_API_KEY',
  'GEMINI_API_KEY'
];

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

async function runProcess(
  bin: string,
  args: ReadonlyArray<string>,
  stdin: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
  spawnImpl: typeof spawn
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(bin, [...args], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`[apprentice-eval] judge subprocess timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin?.write(stdin);
    child.stdin?.end();
  });
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
  const spawnImpl = opts.spawnImpl ?? spawn;
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
