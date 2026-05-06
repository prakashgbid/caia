/**
 * Top-level training orchestrator. See DESIGN.md §4 for the pipeline.
 *
 * Public API:
 *
 *     const trainer = new ApprenticeTrainer(config);
 *     const result = await trainer.train();
 *
 * The constructor resolves CAIA defaults; `train()` runs the full
 * pipeline (split → format → preflight → subprocess → postflight →
 * metadata → optional eval). Every step is testable in isolation; the
 * trainer wires them.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveConfig, validateResolvedConfig } from './config.js';
import { ManifestReader } from './manifest-reader.js';
import { splitSamples } from './splitter.js';
import { writeSplitJsonl } from './jsonl-formatter.js';
import { Preflight } from './preflight.js';
import { Postflight } from './postflight.js';
import { MetadataWriter, configSha256 } from './metadata-writer.js';
import {
  buildMlxLoraArgs,
  renderLoraConfigYaml
} from './mlx-args-builder.js';
import type {
  ApprenticeTrainingConfig,
  EvalAdapterReport,
  ResolvedTrainingConfig,
  TrainResult
} from './types.js';
import { MlxLoraSubprocessError, TrainingError } from './types.js';

export interface TrainOptions {
  /** Override the corpus manifest path for this run only. */
  corpusManifestPath?: string;
  /** Skip the MLX-LM helper-spawn check during preflight. Used by Stage 6 integration tests. */
  skipMlxLmCheck?: boolean;
  /** When true, perform every step except subprocess spawn — for `train --dry-run`. */
  dryRun?: boolean;
}

export class ApprenticeTrainer {
  public readonly config: ResolvedTrainingConfig;
  private readonly manifestReader: ManifestReader;
  private readonly preflight: Preflight;
  private readonly postflight: Postflight;
  private readonly metadataWriter: MetadataWriter;

  constructor(input: ApprenticeTrainingConfig = {}) {
    this.config = resolveConfig(input);
    const validationErrors = validateResolvedConfig(this.config);
    if (validationErrors.length > 0) {
      throw new TrainingError(
        'ConfigValidationError',
        `Invalid training config:\n  - ${validationErrors.join('\n  - ')}`
      );
    }
    this.manifestReader = new ManifestReader(this.config.fs);
    this.preflight = new Preflight(this.config.fs, this.config.subprocessRunner);
    this.postflight = new Postflight(this.config.fs);
    this.metadataWriter = new MetadataWriter(this.config.fs, this.config.clock);
  }

  /** Run the full training pipeline. Returns when adapter is on disk + verified. */
  async train(opts: TrainOptions = {}): Promise<TrainResult> {
    const wallStart = Date.now();
    const cfg = this.config;
    const fs = cfg.fs;
    const manifestPath = opts.corpusManifestPath ?? cfg.corpusManifestPath;

    // 1. Read corpus.
    const { manifest, sha256: corpusManifestSha256 } = this.manifestReader.loadManifest(manifestPath);
    const samplesPath = this.manifestReader.resolveSamplesPath(manifestPath, manifest);
    const samples = this.manifestReader.loadSamples(samplesPath);

    // 2. Split.
    const split = splitSamples(samples, manifest, cfg);

    // 3. Compute deterministic adapter dir + run-id work-dir.
    const dateStr = isoDate(cfg.clock());
    const modelShortname = baseModelToShortname(cfg.baseModel);
    const adapterDirName =
      `${dateStr}-${modelShortname}-rank${cfg.loraConfig.rank}-iters${cfg.loraConfig.iters}`;
    const adapterPath = path.join(cfg.outputAdapterRoot, adapterDirName);

    const corpusSha8 = corpusManifestSha256.slice(0, 8);
    const configSha8 = configSha256(cfg).slice(0, 8);
    const runId = `${corpusSha8}-${configSha8}-${Date.now().toString(36)}`;
    const workDir = path.join(cfg.workDirRoot, runId);

    // 4. Preflight.
    const pre = await this.preflight.run({
      cfg,
      adapterPath,
      ...(opts.skipMlxLmCheck !== undefined ? { skipMlxLmCheck: opts.skipMlxLmCheck } : {})
    });
    const warnings = [...pre.warnings];

    // 5. Materialise work-dir + adapter-dir + JSONL files.
    fs.mkdir(workDir);
    fs.mkdir(adapterPath);
    writeSplitJsonl(workDir, split, fs);
    fs.writeFile(path.join(workDir, 'lora.yaml'), renderLoraConfigYaml(cfg.loraConfig));
    fs.writeFile(
      path.join(workDir, 'config-snapshot.json'),
      JSON.stringify(stableConfigForSnapshot(cfg), null, 2) + '\n'
    );

    // 6. Build subprocess invocation.
    const invocation = buildMlxLoraArgs({ cfg, workDir, adapterPath });
    const trainingLogPath = path.join(adapterPath, 'training-log.txt');

    if (opts.dryRun) {
      // Dry-run: write a stub log + metadata, skip the real spawn.
      fs.writeFile(trainingLogPath, '[dry-run] subprocess not executed\n');
      const md = this.metadataWriter.write({
        cfg,
        adapterPath,
        corpusManifestPath: manifestPath,
        corpusManifestSha256,
        trainCount: split.train.length,
        validCount: split.valid.length,
        testCount: split.test.length,
        argv: [invocation.command, ...invocation.args],
        exitCode: 0,
        elapsedMs: 0,
        timedOut: false,
        host: hostInfo(),
        warnings: [...warnings, 'dry-run — no subprocess executed']
      });

      return {
        adapterPath,
        adapterFile: path.join(adapterPath, 'adapters.safetensors'),
        adapterConfigFile: path.join(adapterPath, 'adapter_config.json'),
        trainingMetadataPath: md.metadataPath,
        trainingLogPath,
        modelfilePath: md.modelfilePath,
        elapsedMs: Date.now() - wallStart,
        metadata: md.metadata
      };
    }

    // 7. Spawn the real subprocess.
    const cleanedEnv = cleanSubprocessEnv(process.env);
    const subResult = await cfg.subprocessRunner.run({
      command: invocation.command,
      args: invocation.args,
      cwd: workDir,
      env: cleanedEnv,
      logFilePath: trainingLogPath,
      timeoutMs: cfg.trainingTimeoutMs
    });

    if (subResult.exitCode !== 0) {
      const reason = subResult.timedOut ? 'timed out' : `exited with code ${subResult.exitCode}`;
      throw new MlxLoraSubprocessError(
        `mlx_lm.lora ${reason}. Last log lines:\n${subResult.logTail}`,
        {
          adapterPath,
          exitCode: subResult.exitCode,
          signal: subResult.signal,
          timedOut: subResult.timedOut,
          elapsedMs: subResult.elapsedMs
        }
      );
    }

    // 8. Postflight.
    this.postflight.run({ adapterPath, logTail: subResult.logTail });

    // 9. Metadata + Modelfile.
    const md = this.metadataWriter.write({
      cfg,
      adapterPath,
      corpusManifestPath: manifestPath,
      corpusManifestSha256,
      trainCount: split.train.length,
      validCount: split.valid.length,
      testCount: split.test.length,
      argv: [invocation.command, ...invocation.args],
      exitCode: subResult.exitCode,
      elapsedMs: subResult.elapsedMs,
      timedOut: subResult.timedOut,
      host: hostInfo(),
      warnings
    });

    // 10. Optional eval-after-train.
    let evalReport: EvalAdapterReport | undefined;
    if (cfg.evalAfterTrain && cfg.evalHarness) {
      const adapterShortname = adapterDirName;
      const er = await cfg.evalHarness.evaluate({
        adapters: [
          {
            name: adapterShortname,
            kind: cfg.baseModelOllamaTag,
            path: adapterPath
          }
        ]
      });
      evalReport = er.adapters[0];
      fs.writeFile(
        path.join(adapterPath, 'eval-report.json'),
        JSON.stringify({ adapters: er.adapters, outputDir: er.outputDir }, null, 2) + '\n'
      );
    }

    const out: TrainResult = {
      adapterPath,
      adapterFile: path.join(adapterPath, 'adapters.safetensors'),
      adapterConfigFile: path.join(adapterPath, 'adapter_config.json'),
      trainingMetadataPath: md.metadataPath,
      trainingLogPath,
      modelfilePath: md.modelfilePath,
      elapsedMs: Date.now() - wallStart,
      metadata: md.metadata
    };
    if (evalReport !== undefined) out.evalReport = evalReport;
    return out;
  }
}

function isoDate(d: Date): string {
  // YYYY-MM-DD
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function baseModelToShortname(baseModel: string): string {
  // mlx-community/Qwen2.5-Coder-7B-Instruct-4bit  → qwen2.5-coder-7b
  const tail = baseModel.split('/').pop() ?? baseModel;
  const lower = tail.toLowerCase();
  // Strip common quantisation suffixes for a stable slug.
  return lower
    .replace(/-(instruct|chat)/g, '')
    .replace(/-(\d+bit|fp16|bf16|q\d_\w+)$/g, '')
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Strip secrets + non-stable seams for the snapshot file. */
function stableConfigForSnapshot(cfg: ResolvedTrainingConfig): Record<string, unknown> {
  return {
    baseModel: cfg.baseModel,
    baseModelOllamaTag: cfg.baseModelOllamaTag,
    pythonBinaryPath: cfg.pythonBinaryPath,
    mlxLmModule: cfg.mlxLmModule,
    loraConfig: cfg.loraConfig,
    trainSplitFraction: cfg.trainSplitFraction,
    validSplitFraction: cfg.validSplitFraction,
    testSplitFraction: cfg.testSplitFraction,
    splitSeed: cfg.splitSeed,
    minSamplesToTrain: cfg.minSamplesToTrain,
    trainingTimeoutMs: cfg.trainingTimeoutMs,
    cloudGpuEnabled: cfg.cloudGpuEnabled
  };
}

function hostInfo(): { model?: string; memBytes?: number; arch?: string } {
  return {
    model: process.platform === 'darwin' ? 'darwin' : process.platform,
    memBytes: os.totalmem(),
    arch: os.arch()
  };
}

/**
 * Remove ANTHROPIC_API_KEY from the spawned subprocess env. The
 * subprocess doesn't call any LLM (mlx-lm uses local quantised weights),
 * but we clear it defensively per the standing rule
 * `feedback_no_api_key_billing.md`.
 */
function cleanSubprocessEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  delete out.ANTHROPIC_API_KEY;
  return out;
}
// Mark createHash as used to satisfy the linter (used by metadata-writer's configSha256 import).
// This is a no-op — kept here so a future refactor that inlines metadata-writer doesn't drop the import.
void createHash;
