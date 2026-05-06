/**
 * harness — top-level orchestration.
 *
 * Per DESIGN.md §3 + §4. The harness:
 *   1. Resolves config (CAIA defaults).
 *   2. Loads suites from suiteRoot (filtered by onlySuites).
 *   3. Reads corpus manifest (if present) for holdout-prompt context.
 *   4. Verifies provider (Ollama → mlx fallback) availability.
 *   5. Generates outputs for base + each adapter against every prompt.
 *   6. Scores outputs against the rubric.
 *   7. Aggregates winrates + regressions vs baselines.
 *   8. (Optional) Routes ties through the claude judge.
 *   9. Writes summary.md / score-cards.json / winrate-report.json /
 *      config.json + per-prompt outputs/<adapter>/<suite>/<id>.json.
 */

import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readCorpusManifest } from './corpus-bridge.js';
import { readBaseline } from './baseline-store.js';
import { aggregate } from './pairwise.js';
import { applyDefaults, loadSuites } from './suite-loader.js';
import { scoreOne } from './rubric-scorer.js';
import { writeRunReport } from './report-writer.js';
import { resolveConfig, type ApprenticeEvalConfig, type ResolvedApprenticeEvalConfig } from './config.js';
import type {
  AdapterSpec,
  AdapterWinrate,
  ClaudeJudge,
  CorpusManifestProjection,
  FsReader,
  FsWriter,
  GenerateRequest,
  GenerateResult,
  JudgeRecord,
  MlxFallback,
  OllamaClient,
  PairwiseResult,
  PromptSuite,
  RubricResult,
  RunConfigSnapshot,
  SuiteTestCase
} from './types.js';

export interface HarnessReport {
  readonly outputDir: string;
  readonly base: { readonly results: ReadonlyArray<RubricResult> };
  readonly adapters: ReadonlyArray<{
    readonly adapter: string;
    readonly winrate: AdapterWinrate;
    readonly pairwise: ReadonlyArray<PairwiseResult>;
  }>;
  readonly judgeCalls: number;
  readonly skipped: ReadonlyArray<string>;
}

const DEFAULT_FS: FsReader = {
  async readFile(path) {
    return readFile(path, 'utf-8');
  },
  async readDir(path) {
    return readdir(path);
  },
  async exists(path) {
    return existsSync(path);
  },
  async stat(path) {
    const s = await stat(path);
    return { mtimeMs: s.mtimeMs, size: s.size };
  }
};

const DEFAULT_WRITER: FsWriter = {
  async writeFile(path, data) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, 'utf-8');
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  }
};

function timestampDir(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function buildGenReq(
  prompt: string,
  model: string,
  cfg: ResolvedApprenticeEvalConfig,
  promptIdx: number,
  adapterPath?: string
): GenerateRequest {
  return {
    model,
    prompt,
    seed: cfg.seed + promptIdx,
    temperature: 0,
    timeoutMs: cfg.perPromptTimeoutMs,
    ...(adapterPath ? { adapter: adapterPath } : {})
  };
}

async function pickProvider(
  ollama: OllamaClient,
  mlx: MlxFallback,
  needsAdapter: boolean
): Promise<{ provider: 'ollama' | 'mlx' | 'none'; reason: string }> {
  try {
    await ollama.ping();
  } catch (e) {
    if (await mlx.available()) return { provider: 'mlx', reason: `Ollama unreachable: ${describe(e)}` };
    return { provider: 'none', reason: `Ollama unreachable + mlx_lm not available: ${describe(e)}` };
  }
  if (!needsAdapter) return { provider: 'ollama', reason: 'no adapters configured' };
  if (await ollama.supportsAdapters()) return { provider: 'ollama', reason: 'ollama supports adapters' };
  if (await mlx.available()) return { provider: 'mlx', reason: 'ollama too old for adapters; falling back to mlx_lm' };
  return { provider: 'none', reason: 'no provider supports adapter loading' };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function runOnAllPrompts(opts: {
  suites: ReadonlyArray<PromptSuite>;
  generate: (req: GenerateRequest) => Promise<GenerateResult>;
  cfg: ResolvedApprenticeEvalConfig;
  model: string;
  adapterName: string;
  adapterPath: string | undefined;
}): Promise<{ outputs: Array<{ result: RubricResult; gen: GenerateResult }> }> {
  const outputs: Array<{ result: RubricResult; gen: GenerateResult }> = [];
  let i = 0;
  for (const suite of opts.suites) {
    for (const test of suite.tests) {
      const req = buildGenReq(test.vars.prompt, opts.model, opts.cfg, i++, opts.adapterPath);
      const gen = await opts.generate(req);
      const result = await scoreOne({
        suite,
        test,
        adapter: opts.adapterName,
        output: gen.output
      });
      outputs.push({ result, gen });
    }
  }
  return { outputs };
}

async function maybeJudgeTies(opts: {
  cfg: ResolvedApprenticeEvalConfig;
  judge: ClaudeJudge | undefined;
  adapter: string;
  pairwise: ReadonlyArray<PairwiseResult>;
  byKey: Map<string, { suite: PromptSuite; test: SuiteTestCase; baseOutput: string; adapterOutput: string }>;
}): Promise<JudgeRecord[]> {
  if (!opts.cfg.judgeEnabled || !opts.judge) return [];
  if (!(await opts.judge.available())) return [];
  const ties = opts.pairwise.filter((p) => p.outcome === 'tie');
  if (ties.length === 0) return [];
  const slice = ties.slice(0, opts.cfg.judgeBudget);
  const records: JudgeRecord[] = [];
  for (const t of slice) {
    const key = `${t.suiteId}::${t.promptId}`;
    const ctx = opts.byKey.get(key);
    if (!ctx) continue;
    const aIs: 'base' | 'adapter' = (records.length & 1) === 0 ? 'base' : 'adapter';
    const outputA = aIs === 'base' ? ctx.baseOutput : ctx.adapterOutput;
    const outputB = aIs === 'base' ? ctx.adapterOutput : ctx.baseOutput;
    const t0 = Date.now();
    const verdict = await opts.judge.judge({ prompt: ctx.test.vars.prompt, outputA, outputB });
    records.push({
      promptId: t.promptId,
      suiteId: t.suiteId,
      adapter: opts.adapter,
      preference: verdict.preference,
      aIs,
      rationale: verdict.rationale,
      elapsedMs: Date.now() - t0
    });
  }
  return records;
}

export class ApprenticeEvalHarness {
  private readonly cfg: ResolvedApprenticeEvalConfig;
  private readonly ollama: OllamaClient | undefined;
  private readonly mlx: MlxFallback | undefined;
  private readonly judge: ClaudeJudge | undefined;
  private readonly fs: FsReader;
  private readonly writer: FsWriter;
  private readonly clock: () => Date;

  constructor(input: ApprenticeEvalConfig & { pkgRoot?: string } = {}) {
    const pkgRoot = input.pkgRoot ?? process.cwd();
    this.cfg = resolveConfig(input, pkgRoot);
    this.ollama = input.ollama;
    this.mlx = input.mlx;
    this.judge = input.judge;
    this.fs = input.fs ?? DEFAULT_FS;
    this.writer = input.writer ?? DEFAULT_WRITER;
    this.clock = input.clock ?? (() => new Date());
  }

  /** Evaluate base + each adapter; emit reports; return summary. */
  async evaluate(): Promise<HarnessReport> {
    const skipped: string[] = [];
    const startedAt = this.clock();

    // Suites.
    const rawSuites = await loadSuites({
      suiteRoot: this.cfg.suiteRoot,
      fs: this.fs,
      ...(this.cfg.onlySuites ? { only: this.cfg.onlySuites } : {})
    });
    const suites = rawSuites.map(applyDefaults);
    if (suites.length === 0) {
      throw new Error(
        `[apprentice-eval] no suites found under ${this.cfg.suiteRoot}` +
          (this.cfg.onlySuites ? ` (filtered to ${this.cfg.onlySuites.join(',')})` : '')
      );
    }

    // Corpus manifest (optional).
    let corpus: CorpusManifestProjection | null = null;
    try {
      corpus = await readCorpusManifest({
        manifestPath: this.cfg.corpusManifestPath,
        fs: this.fs
      });
    } catch (e) {
      skipped.push(`corpus manifest: ${describe(e)}`);
    }

    // Adapters (filtered).
    const adapters: ReadonlyArray<AdapterSpec> = this.cfg.onlyAdapters
      ? this.cfg.adapters.filter((a) => this.cfg.onlyAdapters!.includes(a.name))
      : this.cfg.adapters;

    // Provider selection — only required when we actually call generate.
    const generate = await this.buildGenerateFn(adapters.length > 0, skipped);

    // Base run.
    const baseRun = await runOnAllPrompts({
      suites,
      generate,
      cfg: this.cfg,
      model: this.cfg.baseModel,
      adapterName: 'base',
      adapterPath: undefined
    });

    // Adapter runs + winrate.
    const adapterReports: Array<{
      adapter: string;
      winrate: AdapterWinrate;
      pairwise: ReadonlyArray<PairwiseResult>;
    }> = [];
    let totalJudge = 0;
    const adapterOutputsForReport: Array<{
      adapter: string;
      results: ReadonlyArray<RubricResult>;
      outputs: ReadonlyArray<{ result: RubricResult; gen: GenerateResult }>;
      pairwise: ReadonlyArray<PairwiseResult>;
      winrate: AdapterWinrate;
    }> = [];
    for (const a of adapters) {
      const aRun = await runOnAllPrompts({
        suites,
        generate,
        cfg: this.cfg,
        model: a.kind,
        adapterName: a.name,
        adapterPath: a.path
      });
      const baseline = await readBaseline({
        baselineRoot: this.cfg.baselineRoot,
        adapter: a.name,
        fs: this.fs
      });
      const { pairwise, winrate } = aggregate({
        base: baseRun.outputs.map((o) => o.result),
        adapter: aRun.outputs.map((o) => o.result),
        adapterName: a.name,
        tieEpsilon: this.cfg.tieEpsilon,
        winRateThreshold: this.cfg.winRateThreshold,
        forgettingThreshold: this.cfg.forgettingThreshold,
        baseline
      });

      // Optional judge.
      const byKey = new Map<string, { suite: PromptSuite; test: SuiteTestCase; baseOutput: string; adapterOutput: string }>();
      for (const suite of suites) {
        for (const test of suite.tests) {
          const id = test.id ?? test.description;
          const key = `${suite.id}::${id}`;
          const baseOutput = baseRun.outputs.find(
            (o) => o.result.suiteId === suite.id && o.result.promptId === id
          );
          const adapterOutput = aRun.outputs.find(
            (o) => o.result.suiteId === suite.id && o.result.promptId === id
          );
          if (baseOutput && adapterOutput) {
            byKey.set(key, {
              suite,
              test,
              baseOutput: baseOutput.gen.output,
              adapterOutput: adapterOutput.gen.output
            });
          }
        }
      }
      const judgeRecords = await maybeJudgeTies({
        cfg: this.cfg,
        judge: this.judge,
        adapter: a.name,
        pairwise,
        byKey
      });
      totalJudge += judgeRecords.length;
      adapterReports.push({ adapter: a.name, winrate, pairwise });
      adapterOutputsForReport.push({
        adapter: a.name,
        results: aRun.outputs.map((o) => o.result),
        outputs: aRun.outputs,
        pairwise,
        winrate
      });

      if (judgeRecords.length > 0) {
        const judgeJsonl =
          judgeRecords.map((r) => JSON.stringify(r)).join('\n') + (judgeRecords.length ? '\n' : '');
        const judgePath = join(this.outputDirFor(startedAt), 'judge.jsonl');
        await this.writer.mkdir(this.outputDirFor(startedAt));
        await this.writer.writeFile(judgePath, judgeJsonl);
      }
    }

    // Reports.
    const outputDir = this.outputDirFor(startedAt);
    const cfgSnapshot: RunConfigSnapshot = {
      baseModel: this.cfg.baseModel,
      adapters,
      suiteIds: suites.map((s) => s.id),
      winRateThreshold: this.cfg.winRateThreshold,
      forgettingThreshold: this.cfg.forgettingThreshold,
      judgeEnabled: this.cfg.judgeEnabled,
      judgeBudget: this.cfg.judgeBudget,
      seed: this.cfg.seed,
      tieEpsilon: this.cfg.tieEpsilon,
      ...(corpus?.configSha256 ? { corpusManifestSha: corpus.configSha256 } : {})
    };

    await writeRunReport({
      outputDir,
      generatedAt: startedAt.toISOString(),
      config: cfgSnapshot,
      base: { adapter: 'base', results: baseRun.outputs.map((o) => o.result), outputs: baseRun.outputs },
      adapters: adapterOutputsForReport,
      writer: this.writer
    });

    return {
      outputDir,
      base: { results: baseRun.outputs.map((o) => o.result) },
      adapters: adapterReports,
      judgeCalls: totalJudge,
      skipped
    };
  }

  private async buildGenerateFn(
    needsAdapter: boolean,
    skipped: string[]
  ): Promise<(req: GenerateRequest) => Promise<GenerateResult>> {
    if (!this.ollama && !this.mlx) {
      throw new Error(
        '[apprentice-eval] no provider injected — pass ollama and/or mlx in config'
      );
    }
    if (!this.ollama && this.mlx) {
      const ok = await this.mlx.available();
      if (!ok) throw new Error('[apprentice-eval] mlx fallback not available');
      return (req) => this.mlx!.generate(req);
    }
    if (this.ollama && !this.mlx) {
      try {
        await this.ollama.ping();
      } catch (e) {
        throw new Error(`[apprentice-eval] Ollama unreachable: ${describe(e)}`, { cause: e });
      }
      return (req) => this.ollama!.generate(req);
    }
    // Both injected — pick.
    const decision = await pickProvider(this.ollama!, this.mlx!, needsAdapter);
    if (decision.provider === 'none') {
      throw new Error(`[apprentice-eval] no usable provider: ${decision.reason}`);
    }
    skipped.push(`provider: ${decision.reason}`);
    if (decision.provider === 'ollama') return (req) => this.ollama!.generate(req);
    return (req) => this.mlx!.generate(req);
  }

  private outputDirFor(d: Date): string {
    return join(this.cfg.outputRoot, timestampDir(d));
  }
}

export const __TEST_ONLY = { timestampDir, pickProvider, runOnAllPrompts };
