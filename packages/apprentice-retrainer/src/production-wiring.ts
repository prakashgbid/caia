/**
 * production-wiring — constructs an `ApprenticeRetrainer` with all four
 * upstream pipelines (corpus, training, eval, serving) injected via thin
 * adapters that bridge the upstream package APIs to the Phase 4
 * retrainer's duck-typed `CorpusAggregator` / `Trainer` / `EvalHarness`
 * interfaces.
 *
 * Background — Phase 4 was shipped enabled with the LaunchAgent pointing
 * at `dist/cli.js run`, but `cli.ts` constructs the retrainer with NO
 * pipelines wired (it is documented as the dev-time / operator-driven
 * entry point). The cron therefore failed every scheduled tick with
 * `CorpusFailedError: no corpusAggregator injected` — see
 * `~/Documents/projects/apprentice/retrainer-state.json` after the
 * 2026-05-16T09:00Z tick. This module is the missing production wiring;
 * `dist/cron.js` is the entry the LaunchAgent should call.
 *
 * Option E: every CAIA-specific path / threshold is parameterised. Tests
 * remain decoupled — they still pass fakes directly into
 * `new ApprenticeRetrainer({ corpusAggregator, trainer, evalHarness, serving })`.
 */

import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { ApprenticeCorpusAggregator } from '@chiefaia/apprentice-corpus';
import type { ApprenticeCorpusConfig } from '@chiefaia/apprentice-corpus';
import { ApprenticeTrainer } from '@chiefaia/apprentice-training';
import type { ApprenticeTrainingConfig } from '@chiefaia/apprentice-training';
import { ApprenticeEvalHarness } from '@chiefaia/apprentice-eval';
import type { ApprenticeEvalConfig } from '@chiefaia/apprentice-eval';
import { ApprenticeServing } from '@chiefaia/apprentice-serving';
import type { ApprenticeServingConfig } from '@chiefaia/apprentice-serving';

import { ApprenticeRetrainer } from './retrainer.js';
import type {
  ApprenticeRetrainerConfig,
  CorpusAggregateResult,
  CorpusAggregator,
  EvalAdapterReport,
  EvalHarness,
  EvalReport,
  EvalRequest,
  Trainer,
  TrainerRequest,
  TrainerResult
} from './types.js';

// ──────────────────────────────────────────────────────────────────────────
// Per-pipeline overrides — operators rarely set these; defaults follow the
// upstream packages' CAIA defaults exactly.
// ──────────────────────────────────────────────────────────────────────────

export interface ProductionWiringOverrides {
  corpus?: ApprenticeCorpusConfig;
  training?: ApprenticeTrainingConfig;
  eval?: Omit<ApprenticeEvalConfig, 'adapters'>;
  serving?: ApprenticeServingConfig;
  retrainer?: Omit<
    ApprenticeRetrainerConfig,
    'corpusAggregator' | 'trainer' | 'evalHarness' | 'serving'
  >;
  /**
   * Disable the eval harness — used by integration smoke tests where the
   * full eval suite is too slow / lacks Ollama. When false the retrainer
   * skips eval and the post-train gate falls through to no-eval semantics.
   */
  disableEval?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// Adapter shims
// ──────────────────────────────────────────────────────────────────────────

/**
 * Wraps `ApprenticeCorpusAggregator` to satisfy the retrainer's
 * `CorpusAggregator` interface — which expects `{ manifestPath,
 * corpusManifestSha256, totalSamples, newSamplesSinceLastRun? }`.
 *
 * The upstream `aggregate()` returns the full `CorpusManifest` value
 * object plus writes `<outputDir>/manifest.json` to disk; we project to
 * the retrainer's shape and hash the on-disk manifest for the sha256
 * field (the retrainer records this in the state file for traceability).
 */
class CorpusAggregatorAdapter implements CorpusAggregator {
  constructor(private readonly core: ApprenticeCorpusAggregator) {}

  async aggregate(): Promise<CorpusAggregateResult> {
    const manifest = await this.core.aggregate();
    const manifestPath = path.join(manifest.outputDir, 'manifest.json');
    const content = readFileSync(manifestPath, 'utf-8');
    const corpusManifestSha256 = createHash('sha256').update(content).digest('hex');
    return {
      manifestPath,
      corpusManifestSha256,
      totalSamples: manifest.totals.final
      // newSamplesSinceLastRun intentionally omitted: the aggregator does
      // not track inter-run deltas, so the retrainer's `?? totalSamples`
      // fallback gates on the absolute size of the new corpus snapshot —
      // which is the correct behaviour for a from-scratch aggregator.
    };
  }
}

/**
 * Wraps `ApprenticeTrainer` to satisfy the retrainer's `Trainer`
 * interface — which expects `{ adapterPath, configSha256,
 * baseModelOllamaTag }`. The upstream `TrainResult` carries these inside
 * `result.metadata`; we project.
 */
class TrainerAdapter implements Trainer {
  constructor(private readonly core: ApprenticeTrainer) {}

  async train(args: TrainerRequest): Promise<TrainerResult> {
    const result = await this.core.train({ corpusManifestPath: args.corpusManifestPath });
    return {
      adapterPath: result.adapterPath,
      configSha256: result.metadata.configSha256,
      baseModelOllamaTag: result.metadata.baseModelOllamaTag
    };
  }
}

/**
 * Wraps `ApprenticeEvalHarness` to satisfy the retrainer's `EvalHarness`
 * interface. The harness reads its adapter list from constructor config
 * and `evaluate()` takes no args, so we construct a fresh harness per
 * call with the requested adapters merged into the base config.
 *
 * The harness's `RegressionFlag` is a per-prompt object; the retrainer's
 * `regressionFlags` field is `string[]`. We project each regression to
 * the form `"<suiteId>/<promptId>(Δ=<delta>)"` — enough for the operator
 * digest to triage. The post-train decision in `decision.ts` only checks
 * `regressionFlags.length`, not contents.
 */
class EvalHarnessAdapter implements EvalHarness {
  constructor(private readonly baseConfig: Omit<ApprenticeEvalConfig, 'adapters'>) {}

  async evaluate(args: EvalRequest): Promise<EvalReport> {
    const harness = new ApprenticeEvalHarness({
      ...this.baseConfig,
      adapters: args.adapters.map((a) => ({ name: a.name, kind: a.kind, path: a.path }))
    });
    const report = await harness.evaluate();
    const adapters: EvalAdapterReport[] = report.adapters.map((a) => ({
      name: a.adapter,
      winRate: a.winrate.winRate,
      decision: a.winrate.decision,
      regressionFlags: a.winrate.regressions.map(
        (r) => `${r.suiteId}/${r.promptId}(Δ=${r.delta.toFixed(3)})`
      )
    }));
    return { adapters, outputDir: report.outputDir };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Factory
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build a fully-wired `ApprenticeRetrainer` ready for the cron driver.
 * Every upstream package gets its own CAIA-default config; pass
 * `overrides` to surgically override a single dependency's config (e.g.
 * to point the trainer at a different output dir for staging).
 */
export function createProductionRetrainer(
  overrides: ProductionWiringOverrides = {}
): ApprenticeRetrainer {
  const corpusCore = new ApprenticeCorpusAggregator(overrides.corpus ?? {});
  const trainerCore = new ApprenticeTrainer(overrides.training ?? {});
  const serving = new ApprenticeServing(overrides.serving ?? {});

  const config: ApprenticeRetrainerConfig = {
    ...(overrides.retrainer ?? {}),
    corpusAggregator: new CorpusAggregatorAdapter(corpusCore),
    trainer: new TrainerAdapter(trainerCore),
    serving
  };
  if (overrides.disableEval !== true) {
    config.evalHarness = new EvalHarnessAdapter(overrides.eval ?? {});
  }
  return new ApprenticeRetrainer(config);
}
