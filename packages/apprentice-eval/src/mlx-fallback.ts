/**
 * mlx-fallback — invokes `mlx_lm.generate` as a subprocess when Ollama
 * doesn't support adapter loading (e.g. operator's Ollama is < 0.4).
 *
 * Per DESIGN.md §6 (last paragraph). Mac-native; ships without API key.
 *
 * Subscription-only constraint: this is a local Python subprocess; no
 * remote calls; no auth tokens. We still scrub ANTHROPIC_API_KEY etc.
 * from the spawned env for defence in depth.
 */

import { spawn } from 'node:child_process';

import type { GenerateRequest, GenerateResult, MlxFallback } from './types.js';

export interface CreateMlxFallbackOpts {
  /** Defaults to `python3` on PATH. */
  readonly pythonBin?: string;
  /** Defaults to `mlx_lm.generate`. */
  readonly entryModule?: string;
  /** Per-call timeout in ms. */
  readonly perPromptTimeoutMs?: number;
  /** Override for tests. */
  readonly spawnImpl?: typeof spawn;
  /** Override env for tests; default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

const SECRETS_TO_SCRUB = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'COHERE_API_KEY',
  'GEMINI_API_KEY',
  'HF_TOKEN',
  'HUGGINGFACEHUB_API_TOKEN'
];

function buildSafeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = { ...env };
  for (const key of SECRETS_TO_SCRUB) {
    delete safe[key];
  }
  return safe;
}

interface MlxRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

async function runProcess(
  cmd: string,
  args: ReadonlyArray<string>,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
  spawnImpl: typeof spawn
): Promise<MlxRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(cmd, [...args], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`[apprentice-eval] mlx_lm.generate timed out after ${timeoutMs}ms`));
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
  });
}

export function createMlxFallback(opts: CreateMlxFallbackOpts = {}): MlxFallback {
  const pythonBin = opts.pythonBin ?? 'python3';
  const entryModule = opts.entryModule ?? 'mlx_lm.generate';
  const defaultTimeout = opts.perPromptTimeoutMs ?? 180_000;
  const spawnImpl = opts.spawnImpl ?? spawn;
  const env = buildSafeEnv(opts.env ?? process.env);

  return {
    async available() {
      try {
        const result = await runProcess(
          pythonBin,
          ['-c', `import importlib; importlib.import_module('${entryModule.split('.')[0]}')`],
          5_000,
          env,
          spawnImpl
        );
        return result.code === 0;
      } catch {
        return false;
      }
    },

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const args = [
        '-m',
        entryModule,
        '--model',
        req.model,
        '--prompt',
        req.prompt,
        '--temp',
        String(req.temperature ?? 0)
      ];
      if (req.adapter) {
        args.push('--adapter-path', req.adapter);
      }
      if (req.seed !== undefined) {
        args.push('--seed', String(req.seed));
      }
      const t0 = Date.now();
      const result = await runProcess(
        pythonBin,
        args,
        req.timeoutMs ?? defaultTimeout,
        env,
        spawnImpl
      );
      const elapsedMs = Date.now() - t0;
      if (result.code !== 0) {
        throw new Error(
          `[apprentice-eval] mlx_lm.generate exited ${result.code}: ${result.stderr.slice(0, 500)}`
        );
      }
      return {
        output: result.stdout,
        elapsedMs,
        model: req.model,
        ...(req.adapter !== undefined ? { adapter: req.adapter } : {}),
        provider: 'mlx',
        ...(req.seed !== undefined ? { seed: req.seed } : {})
      };
    }
  };
}

export const __TEST_ONLY = { buildSafeEnv, SECRETS_TO_SCRUB };
