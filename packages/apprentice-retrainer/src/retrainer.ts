/**
 * ApprenticeRetrainer — top-level orchestrator. Composes:
 *   - StateStore       (run-state persistence)
 *   - acquireLock      (single-instance flock)
 *   - decision         (pure pre-train + post-train state machine)
 *   - DigestWriter     (operator-facing markdown)
 *   - injected pipelines: corpusAggregator, trainer, evalHarness, serving
 *
 * The `run()` method is the cron entry point. The `promoteCanaryToProduction()`
 * and `rejectCanary()` methods are operator-driven.
 */

import * as path from 'node:path';
import {
  CorpusFailedError,
  EvalFailedError,
  NoCanaryActiveError,
  PromotionFailedError,
  RegisterFailedError,
  TrainingFailedError
} from './types.js';
import type {
  ApprenticeRetrainerConfig,
  EvalAdapterReport,
  RegistryEntry,
  ResolvedRetrainerConfig,
  RetrainerRunResult,
  RetrainerStateFile
} from './types.js';
import { resolveConfig } from './config.js';
import { StateStore } from './state-store.js';
import { acquireLock } from './lockfile.js';
import { DigestWriter, renderBody } from './digest.js';
import {
  postTrainDecision,
  preTrainDecision,
  shouldRetrainGivenDelta
} from './decision.js';

export class ApprenticeRetrainer {
  private readonly cfg: ResolvedRetrainerConfig;
  private readonly state: StateStore;
  private readonly digest: DigestWriter;

  constructor(config: ApprenticeRetrainerConfig = {}) {
    this.cfg = resolveConfig(config);
    this.state = new StateStore({
      runStatePath: this.cfg.runStatePath,
      fs: this.cfg.fs,
      clock: this.cfg.clock
    });
    this.digest = new DigestWriter(this.cfg.fs, this.cfg.digestPath);
  }

  readState(): RetrainerStateFile {
    return this.state.read();
  }

  /**
   * One end-to-end retraining tick. The cron driver invokes this.
   * Acquires lock; reads state; decides; executes; records; releases lock.
   */
  async run(opts: { force?: boolean } = {}): Promise<RetrainerRunResult> {
    const lock = acquireLock({
      lockfilePath: this.cfg.lockfilePath,
      fs: this.cfg.fs,
      clock: this.cfg.clock
    });
    try {
      const result = await this.runUnlocked(opts);
      // Best-effort: clear lastError on successful tick.
      if (result.kind !== 'failed') this.state.clearError();
      return result;
    } catch (e) {
      const err = e as Error;
      this.state.recordError({
        at: this.cfg.clock().toISOString(),
        message: err.message,
        kind: err.name ?? 'Error'
      });
      const result: RetrainerRunResult = {
        kind: 'failed',
        error: { message: err.message, kind: err.name ?? 'Error' }
      };
      this.state.recordOutcome('failed', { note: err.message });
      this.digest.appendEntry({
        at: this.cfg.clock().toISOString(),
        outcome: 'failed',
        body: renderBody(result)
      });
      return result;
    } finally {
      lock.release();
    }
  }

  /** Operator-driven canary → production promotion. */
  async promoteCanaryToProduction(): Promise<RegistryEntry> {
    const serving = this.cfg.serving;
    if (serving === undefined) {
      throw new PromotionFailedError('no serving instance injected');
    }
    const canary = serving.currentCanary();
    if (canary === undefined) throw new NoCanaryActiveError('no canary currently active');
    const promoted = await serving.promoteToProduction(canary.adapterPath);
    this.state.recordProductionPromotion(this.cfg.clock().toISOString());
    this.digest.appendEntry({
      at: this.cfg.clock().toISOString(),
      outcome: 'trained-and-canary-promoted',
      body: `Operator-promoted canary to production.\n\n- Adapter: ${promoted.adapterName}\n- Model: ${promoted.ollamaModelName}`
    });
    return promoted;
  }

  /** Operator-driven canary rejection. */
  async rejectCanary(reason: string): Promise<RegistryEntry> {
    const serving = this.cfg.serving;
    if (serving === undefined) {
      throw new PromotionFailedError('no serving instance injected');
    }
    const canary = serving.currentCanary();
    if (canary === undefined) throw new NoCanaryActiveError('no canary currently active');
    const rejected = await serving.reject(canary.adapterPath, reason);
    this.digest.appendEntry({
      at: this.cfg.clock().toISOString(),
      outcome: 'trained-and-rejected',
      body: `Operator-rejected canary.\n\n- Adapter: ${rejected.adapterName}\n- Reason: ${reason}`
    });
    return rejected;
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async runUnlocked(opts: { force?: boolean }): Promise<RetrainerRunResult> {
    const force = opts.force === true;
    const state = this.state.read();
    const serving = this.cfg.serving;

    const currentCanary = serving?.currentCanary();
    const currentProduction = serving?.currentProduction();

    const preDecision = preTrainDecision({
      state,
      currentCanary,
      currentProduction,
      nowMs: this.cfg.clock().getTime(),
      force,
      retrainThreshold: this.cfg.retrainThreshold,
      retrainMaxAgeMs: this.cfg.retrainMaxAgeMs,
      canaryHoldDays: this.cfg.canaryHoldDays
    });

    if (preDecision.kind === 'skip-canary-active') {
      const result: RetrainerRunResult = {
        kind: 'skipped-canary-active',
        canary: currentCanary!,
        daysHeld: preDecision.daysHeld
      };
      const skipExtras: { adapterName?: string; note?: string } = { note: `canary held ${preDecision.daysHeld} day(s); soak continues` };
      if (currentCanary?.adapterName !== undefined) skipExtras.adapterName = currentCanary.adapterName;
      this.state.recordOutcome('skipped-canary-active', skipExtras);
      this.digest.appendEntry({
        at: this.cfg.clock().toISOString(),
        outcome: 'skipped-canary-active',
        body: renderBody(result)
      });
      return result;
    }

    if (preDecision.kind === 'prompt-operator-canary-held') {
      const result: RetrainerRunResult = {
        kind: 'canary-held-prompting-operator',
        canary: currentCanary!,
        daysHeld: preDecision.daysHeld
      };
      const heldExtras: { adapterName?: string; note?: string } = { note: `canary has held ${preDecision.daysHeld} day(s); operator decision required` };
      if (currentCanary?.adapterName !== undefined) heldExtras.adapterName = currentCanary.adapterName;
      this.state.recordOutcome('canary-held-prompting-operator', heldExtras);
      this.digest.appendEntry({
        at: this.cfg.clock().toISOString(),
        outcome: 'canary-held-prompting-operator',
        body: renderBody(result)
      });
      return result;
    }

    if (preDecision.kind === 'skip-no-delta') {
      const result: RetrainerRunResult = {
        kind: 'skipped-no-delta',
        deltaCount: preDecision.deltaCount,
        lastTrainAt: preDecision.lastTrainAt
      };
      this.state.recordOutcome('skipped-no-delta');
      this.digest.appendEntry({
        at: this.cfg.clock().toISOString(),
        outcome: 'skipped-no-delta',
        body: renderBody(result)
      });
      return result;
    }

    // ── kind === 'aggregate-and-train' ──
    return this.runTrainCycle(state, force);
  }

  private async runTrainCycle(state: RetrainerStateFile, force: boolean): Promise<RetrainerRunResult> {
    if (this.cfg.corpusAggregator === undefined) {
      throw new CorpusFailedError('no corpusAggregator injected');
    }
    if (this.cfg.trainer === undefined) {
      throw new TrainingFailedError('no trainer injected');
    }
    if (this.cfg.serving === undefined) {
      throw new RegisterFailedError('no serving instance injected');
    }

    let aggregateResult;
    try {
      aggregateResult = await this.cfg.corpusAggregator.aggregate();
    } catch (e) {
      throw new CorpusFailedError((e as Error).message, { cause: (e as Error).name });
    }

    // Delta gate — caller hasn't checked count yet at decision time.
    const isAged = state.lastSuccessfulTrain !== null
      ? this.cfg.clock().getTime() - new Date(state.lastSuccessfulTrain.at).getTime() >= this.cfg.retrainMaxAgeMs
      : true; // never trained
    const newSamples = aggregateResult.newSamplesSinceLastRun ?? aggregateResult.totalSamples;
    if (!shouldRetrainGivenDelta(newSamples, this.cfg.retrainThreshold, force || isAged)) {
      const result: RetrainerRunResult = {
        kind: 'skipped-no-delta',
        deltaCount: newSamples,
        lastTrainAt: state.lastSuccessfulTrain?.at ?? null
      };
      this.state.recordOutcome('skipped-no-delta');
      this.digest.appendEntry({
        at: this.cfg.clock().toISOString(),
        outcome: 'skipped-no-delta',
        body: renderBody(result)
      });
      return result;
    }

    let trainResult;
    try {
      trainResult = await this.cfg.trainer.train({ corpusManifestPath: aggregateResult.manifestPath });
    } catch (e) {
      throw new TrainingFailedError((e as Error).message, { cause: (e as Error).name });
    }

    let evalReport: EvalAdapterReport | undefined;
    if (this.cfg.evalHarness !== undefined) {
      try {
        const report = await this.cfg.evalHarness.evaluate({
          adapters: [
            {
              name: path.basename(trainResult.adapterPath),
              kind: 'lora',
              path: trainResult.adapterPath
            }
          ]
        });
        evalReport = report.adapters[0];
      } catch (e) {
        throw new EvalFailedError((e as Error).message, { cause: (e as Error).name });
      }
    }

    let registered;
    try {
      registered = await this.cfg.serving.register(trainResult.adapterPath);
    } catch (e) {
      throw new RegisterFailedError((e as Error).message, { cause: (e as Error).name });
    }

    const post = postTrainDecision({ evalReport, evalWinRateGate: this.cfg.evalWinRateGate });

    if (post.kind === 'promote-canary') {
      try {
        await this.cfg.serving.promoteToCanary(trainResult.adapterPath, this.cfg.defaultCanaryPercent);
      } catch (e) {
        throw new PromotionFailedError((e as Error).message, { cause: (e as Error).name });
      }
      this.state.recordSuccessfulTrain({
        at: this.cfg.clock().toISOString(),
        adapterPath: trainResult.adapterPath,
        adapterName: registered.adapterName,
        corpusManifestSha256: aggregateResult.corpusManifestSha256,
        outcome: 'trained-and-canary-promoted'
      });
      this.state.recordCanaryPromotion(this.cfg.clock().toISOString());
      this.state.recordOutcome('trained-and-canary-promoted', {
        adapterName: registered.adapterName
      });
      const result: RetrainerRunResult = {
        kind: 'trained-and-canary-promoted',
        adapterPath: trainResult.adapterPath,
        canaryPercent: this.cfg.defaultCanaryPercent,
        ...(evalReport !== undefined ? { evalReport } : {})
      };
      this.digest.appendEntry({
        at: this.cfg.clock().toISOString(),
        outcome: 'trained-and-canary-promoted',
        body: renderBody(result, evalReport)
      });
      return result;
    }

    // Reject path.
    const reason = post.reason;
    try {
      await this.cfg.serving.reject(trainResult.adapterPath, reason);
    } catch (e) {
      throw new PromotionFailedError((e as Error).message, { cause: (e as Error).name });
    }
    this.state.recordSuccessfulTrain({
      at: this.cfg.clock().toISOString(),
      adapterPath: trainResult.adapterPath,
      adapterName: registered.adapterName,
      corpusManifestSha256: aggregateResult.corpusManifestSha256,
      outcome: 'trained-and-rejected'
    });
    this.state.recordOutcome('trained-and-rejected', { adapterName: registered.adapterName, note: reason });
    const result: RetrainerRunResult = {
      kind: 'trained-and-rejected',
      adapterPath: trainResult.adapterPath,
      reason,
      ...(evalReport !== undefined ? { evalReport } : {})
    };
    this.digest.appendEntry({
      at: this.cfg.clock().toISOString(),
      outcome: 'trained-and-rejected',
      body: renderBody(result, evalReport)
    });
    return result;
  }
}
