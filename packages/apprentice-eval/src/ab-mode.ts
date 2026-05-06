/**
 * ab-mode — operator-blind A/B preference recorder.
 *
 * Per DESIGN.md §9. Sample N prompts from a chosen suite, generate base +
 * adapter outputs, present anonymised, capture preference, write to
 * `ab-preferences.jsonl`.
 *
 * The interactive UI is decoupled from the data path: the caller injects
 * a `prompter` function that takes the anonymised pair and returns the
 * preference. The CLI binds it to readline; tests bind it to a stub.
 */

import { join } from 'node:path';

import type {
  AbPreferenceRecord,
  AdapterSpec,
  FsWriter,
  GenerateRequest,
  GenerateResult,
  OllamaClient,
  PromptSuite
} from './types.js';

export interface AbPrompter {
  (input: {
    readonly promptId: string;
    readonly prompt: string;
    readonly outputA: string;
    readonly outputB: string;
  }): Promise<{ preference: 'A' | 'B' | 'tie' | 'skip' }>;
}

export interface RunAbModeOpts {
  readonly suite: PromptSuite;
  readonly adapter: AdapterSpec;
  readonly baseModel: string;
  readonly pairs: number;
  readonly seed: number;
  readonly outputDir: string;
  readonly ollama: OllamaClient;
  readonly prompter: AbPrompter;
  readonly writer: FsWriter;
  readonly clock: () => Date;
  readonly tempC?: number;
  readonly perPromptTimeoutMs?: number;
  /** RNG seed function — accepts seed, returns 0..1. */
  readonly random?: (seed: number, idx: number) => number;
}

function defaultRandom(seed: number, idx: number): number {
  // mulberry32-ish
  let t = (seed + idx * 0x9e3779b9) >>> 0;
  t ^= t >>> 15;
  t = Math.imul(t, 0x85ebca6b) >>> 0;
  t ^= t >>> 13;
  t = Math.imul(t, 0xc2b2ae35) >>> 0;
  t ^= t >>> 16;
  return (t >>> 0) / 0x1_0000_0000;
}

function sample<T>(arr: ReadonlyArray<T>, n: number, seed: number, random: typeof defaultRandom): T[] {
  if (n >= arr.length) return [...arr];
  const out: T[] = [];
  const idxs = new Set<number>();
  let i = 0;
  while (out.length < n && i < arr.length * 4) {
    const r = random(seed, i++);
    const k = Math.floor(r * arr.length);
    if (!idxs.has(k)) {
      idxs.add(k);
      out.push(arr[k]!);
    }
  }
  return out;
}

export async function runAbMode(opts: RunAbModeOpts): Promise<{
  records: ReadonlyArray<AbPreferenceRecord>;
  outputPath: string;
}> {
  const random = opts.random ?? defaultRandom;
  const tests = sample(opts.suite.tests, opts.pairs, opts.seed, random);
  const records: AbPreferenceRecord[] = [];
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i]!;
    const base = await opts.ollama.generate(buildReq(t.vars.prompt, opts.baseModel, opts, i));
    const adapter = await opts.ollama.generate(
      buildReq(t.vars.prompt, opts.adapter.kind, opts, i, opts.adapter.path)
    );
    // Coin-flip A/B order to keep operator blind.
    const aIs: 'base' | 'adapter' = random(opts.seed ^ 0x5a5a5a5a, i) < 0.5 ? 'base' : 'adapter';
    const outputA = aIs === 'base' ? base.output : adapter.output;
    const outputB = aIs === 'base' ? adapter.output : base.output;
    const reply = await opts.prompter({
      promptId: t.id ?? t.description,
      prompt: t.vars.prompt,
      outputA,
      outputB
    });
    records.push({
      promptId: t.id ?? t.description,
      suiteId: opts.suite.id,
      adapter: opts.adapter.name,
      preference: reply.preference,
      aIs,
      recordedAt: opts.clock().toISOString()
    });
  }
  await opts.writer.mkdir(opts.outputDir);
  const outputPath = join(opts.outputDir, 'ab-preferences.jsonl');
  const body = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  await opts.writer.writeFile(outputPath, body);
  return { records, outputPath };
}

function buildReq(
  prompt: string,
  model: string,
  opts: RunAbModeOpts,
  i: number,
  adapterPath?: string
): GenerateRequest {
  return {
    model,
    prompt,
    seed: opts.seed + i,
    temperature: opts.tempC ?? 0.7,
    ...(adapterPath ? { adapter: adapterPath } : {}),
    ...(opts.perPromptTimeoutMs !== undefined ? { timeoutMs: opts.perPromptTimeoutMs } : {})
  };
}

export const __TEST_ONLY = { sample, defaultRandom };

// Re-exports for callers that want the result-extraction shape but not
// the runtime invocation (e.g. tests that compose generate manually).
export type { GenerateResult };
