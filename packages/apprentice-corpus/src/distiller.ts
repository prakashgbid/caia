/**
 * Claude-binary-spawn distiller.
 *
 * Cribs from `@chiefaia/local-llm-router`'s `claude-adapter.ts`:
 *   - subprocess invocation pattern with `--print --output-format json`
 *   - explicit `ANTHROPIC_API_KEY=undefined` to force subscription path
 *   - timeout + JSON-parse error handling
 *
 * The distiller is invoked for InstructionPairs that score below the
 * quality threshold. It produces a refined `{instruction, response}`
 * pair which the aggregator then re-scores. Failures (rate-limit,
 * missing binary, malformed output) cause the sample to be dropped.
 */

import { spawnSync } from 'node:child_process';

import type {
  ClaudeDistiller,
  DistillInput,
  DistillOutput
} from './types.js';

export interface DefaultDistillerOptions {
  binaryPath: string;
  timeoutMs?: number;
  /** Test seam — replace `child_process.spawnSync`. */
  spawnFn?: typeof spawnSync;
  /** Optional model override. Default: claude-haiku-4-5 (cheap; distillation is not reasoning). */
  model?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export const DISTILL_PROMPT_TEMPLATE = `You are extracting a high-quality instruction-response pair for fine-tuning a coding agent.

Given the raw artifact below, produce a clean Q/A pair that captures the substantive content.

Rules:
- Drop voice-transcription noise (um, uh, you know).
- Keep operator decisions verbatim.
- Strip any credentials or personally-identifying patterns you spot.
- The instruction should be a clear question or task; the response should answer it directly.
- Output STRICT JSON exactly in the shape: {"instruction": "...", "response": "..."}.
- No prose before or after the JSON.

Raw artifact source: {source}/{kind}
Raw artifact:
"""
{text}
"""`;

/**
 * Build a default distiller backed by the `claude` CLI.
 *
 * Honours `feedback_no_api_key_billing.md` — explicitly nukes
 * `ANTHROPIC_API_KEY` from the spawned env so the binary falls
 * through to the keychain / OAuth subscription session.
 */
export function createDefaultDistiller(opts: DefaultDistillerOptions): ClaudeDistiller {
  const spawn = opts.spawnFn ?? spawnSync;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    async distill(input: DistillInput): Promise<DistillOutput> {
      const prompt = DISTILL_PROMPT_TEMPLATE
        .replace('{source}', input.source)
        .replace('{kind}', input.kind ?? 'unknown')
        .replace('{text}', input.text);

      const env = { ...process.env };
      delete env['ANTHROPIC_API_KEY'];

      const result = spawn(
        opts.binaryPath,
        ['--print', '--output-format', 'json', '--model', model],
        {
          input: prompt,
          encoding: 'utf-8',
          timeout,
          env
        }
      );

      if (result.error !== null && result.error !== undefined) {
        throw new Error(`distiller spawn failed: ${result.error.message}`);
      }
      if (result.status !== 0) {
        throw new Error(
          `distiller exited ${result.status}: ${(result.stderr ?? '').toString().slice(0, 300)}`
        );
      }
      const stdout = (result.stdout ?? '').toString();
      return parseDistillerOutput(stdout);
    }
  };
}

/**
 * Parse the `claude --print --output-format json` envelope, then the
 * inner JSON the distillation prompt asked for.
 *
 * The outer envelope is `{ "result": "..." }` per claude-adapter.ts.
 * The inner JSON is what the prompt template instructed.
 */
export function parseDistillerOutput(stdout: string): DistillOutput {
  let outer: unknown;
  try {
    outer = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`distiller stdout not JSON: ${(e as Error).message}`, { cause: e });
  }
  if (
    typeof outer !== 'object'
    || outer === null
    || typeof (outer as { result?: unknown }).result !== 'string'
  ) {
    throw new Error('distiller envelope missing "result" string');
  }
  const inner = (outer as { result: string }).result.trim();
  // The prompt instructs strict JSON, but be tolerant of leading/trailing whitespace.
  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch (e) {
    throw new Error(`distiller inner JSON parse failed: ${(e as Error).message}`, { cause: e });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('distiller inner JSON is not an object');
  }
  const obj = parsed as { instruction?: unknown; response?: unknown };
  if (typeof obj.instruction !== 'string' || typeof obj.response !== 'string') {
    throw new Error('distiller inner JSON missing instruction/response');
  }
  return { instruction: obj.instruction, response: obj.response };
}

/** Always-throw stub for tests / disabled distillation. */
export const noopDistiller: ClaudeDistiller = {
  async distill(): Promise<never> {
    throw new Error('distiller-disabled');
  }
};
