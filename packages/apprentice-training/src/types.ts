/**
 * @chiefaia/apprentice-training — shared types.
 *
 * Pipeline overview (mirrors DESIGN.md §4):
 *
 *   manifest.json + samples.jsonl
 *           ↓
 *     ApprenticeTrainer.train()
 *           ↓
 *     splitter (honour manifest.holdout when present)
 *           ↓
 *     formatter → {train,valid,test}.jsonl in workDir
 *           ↓
 *     preflight (python+mlx_lm importable, free RAM, paths)
 *           ↓
 *     subprocess: python -m mlx_lm.lora --train ...
 *           ↓
 *     postflight (adapter file + adapter_config.json verified)
 *           ↓
 *     metadata-writer → training-metadata.json + Modelfile
 *           ↓
 *     optional: evalHarness.evaluate(adapter)
 *           ↓
 *     TrainResult
 *
 * Option E shape: every CAIA-specific path / model / hyperparam is a
 * constructor parameter with a CAIA default; tests inject fixtures + a
 * mocked subprocess. See DESIGN.md for the full architecture rationale.
 */

/** A single chat-completions message. Same shape as OpenAI / MLX-LM chat format. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Sample shape we read from `samples.jsonl`. The corpus aggregator writes
 * extra metadata under `meta`; the trainer ignores everything except `id`
 * (for split bucketing) and `messages` (for trainable JSONL emission).
 */
export interface CorpusSample {
  id: string;
  messages: ChatMessage[];
  meta?: Record<string, unknown>;
}

/**
 * Subset of the corpus manifest (`packages/apprentice-corpus/.../manifest.json`)
 * that the trainer cares about. The full schema lives in
 * `@chiefaia/apprentice-corpus` types — we duplicate the read-side shape
 * here so this package's typecheck is not coupled to the corpus's exact
 * version. `holdout` is optional (ships in PR #367; older corpora omit).
 */
export interface CorpusManifestRead {
  version: number;
  generatedAt: string;
  outputDir: string;
  totals: {
    final: number;
    [k: string]: number;
  };
  /** PR #367 — id list of held-out samples for cross-run-stable test split. */
  holdout?: string[];
  /** Snapshot hash of the corpus config for traceability. */
  configSha256?: string;
  [k: string]: unknown;
}

/**
 * LoRA / training hyperparameters — defaults tuned for Mac M1 Pro 16GB.
 * See DESIGN.md §6.
 */
export interface LoraConfig {
  /** Number of model layers to apply LoRA to (canonical mlx-lm flag: --num-layers). */
  numLayers: number;
  /** LoRA rank (r) — capacity knob. */
  rank: number;
  /** LoRA alpha — typically 2× rank. */
  alpha: number;
  /** Dropout. 0.0 is standard for SFT on small instruction corpora. */
  dropout: number;
  /** Optimiser learning rate. */
  learningRate: number;
  /** Total training iterations (steps). */
  iters: number;
  /** Batch size per step. 16 GB safe default = 1. */
  batchSize: number;
  /** Max sequence length (tokens). Truncate longer samples. */
  maxSeqLength: number;
  /** Gradient accumulation — effective batch = batchSize × N without RAM cost. */
  gradAccumulationSteps: number;
  /** Trade compute for memory; ~30% slower, ~30% less peak RAM. */
  gradCheckpoint: boolean;
  /** Loss only on assistant message (chat-format mandatory). */
  maskPrompt: boolean;
  /** Checkpoint every N iters. */
  saveEvery: number;
  /** Validation loss every N iters. */
  stepsPerEval: number;
  /** Validation batch count per eval pass. */
  valBatches: number;
  /** Random seed. */
  seed: number;
}

/**
 * Filesystem access surface — injected so tests can fake it without
 * touching real disk. Covers everything `metadata-writer` and
 * `manifest-reader` need.
 */
export interface FsAccess {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string): void;
  readDir(path: string): string[];
  stat(path: string): { mtimeMs: number; size: number; isFile: boolean; isDirectory: boolean };
}

/**
 * Subprocess runner — injected so unit tests can mock it.
 * Exits with non-zero → throw `MlxLoraSubprocessError`. Streams
 * stdout/stderr to `logFilePath`.
 */
export interface SubprocessRunner {
  run(args: SubprocessArgs): Promise<SubprocessResult>;
}

export interface SubprocessArgs {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  /** Absolute path to capture combined stdout+stderr. */
  logFilePath: string;
  /** Hard timeout. SIGTERM → 30s grace → SIGKILL. */
  timeoutMs: number;
}

export interface SubprocessResult {
  exitCode: number;
  signal: string | null;
  elapsedMs: number;
  /** Last 100 lines of combined stdout+stderr for triage on error. */
  logTail: string;
  /** Did the runner kill the subprocess due to timeoutMs? */
  timedOut: boolean;
}

/**
 * Eval harness injection point. Phase 4's retrainer wires
 * `@chiefaia/apprentice-eval`'s `ApprenticeEvalHarness.evaluate()` here.
 * This package has zero source-tree dep on apprentice-eval.
 */
export interface EvalHarness {
  evaluate(args: EvalRequest): Promise<EvalReport>;
}

export interface EvalAdapterDescriptor {
  name: string;
  kind: string;
  path: string;
}

export interface EvalRequest {
  adapters: EvalAdapterDescriptor[];
}

export interface EvalAdapterReport {
  name: string;
  /** Pairwise win-rate vs base ∈ [0, 1]. */
  winRate: number;
  /** Per-suite pass-rate ∈ [0, 1]. */
  passRate?: number;
  /** Decision string from the harness's pairwise aggregator. */
  decision: 'promote-canary' | 'reject-low-winrate' | 'reject-regressions' | 'baseline';
  /** Regression-flag prompt ids; non-empty disqualifies. */
  regressionFlags: string[];
}

export interface EvalReport {
  adapters: EvalAdapterReport[];
  /** Output directory the harness wrote — for cross-reference in metadata. */
  outputDir: string;
}

/**
 * Full configuration shape. `Required<>` of this is what the constructor
 * resolves to (CAIA defaults filled in for any omitted field).
 */
export interface ApprenticeTrainingConfig {
  /** Path to corpus manifest.json (Phase 0 output). */
  corpusManifestPath?: string;
  /** Where to write the date-stamped adapter directory. */
  outputAdapterRoot?: string;
  /** Where to write the temporary working JSONL files for this run. */
  workDirRoot?: string;

  /** MLX-canonical HF repo identifier; 4-bit pre-quantised auto-triggers QLoRA. */
  baseModel?: string;
  /** Ollama tag for Modelfile scaffold (Phase 3 deploys). */
  baseModelOllamaTag?: string;

  /** Python interpreter to spawn. Must have mlx-lm installed. */
  pythonBinaryPath?: string;
  /** Python module path for the LoRA entry point (override for cloud-GPU paths). */
  mlxLmModule?: string;

  /** LoRA hyperparameters. Partial — anything omitted falls back to DEFAULT_LORA_CONFIG. */
  loraConfig?: Partial<LoraConfig>;

  /** Train fraction when `manifest.holdout` is absent. */
  trainSplitFraction?: number;
  /** Valid fraction (taken from non-holdout remainder when holdout present). */
  validSplitFraction?: number;
  /** Test fraction when `manifest.holdout` is absent (overridden by holdout.length when present). */
  testSplitFraction?: number;
  /** Seed for deterministic id-hash split. */
  splitSeed?: number;

  /** Hard floor on samples-after-split-train; refuse to train below. */
  minSamplesToTrain?: number;
  /** Hard timeout on the mlx_lm.lora subprocess (ms). */
  trainingTimeoutMs?: number;

  /** Cloud GPU stub — false in Phase 2; cloud path is Phase 2-cloud-extension. */
  cloudGpuEnabled?: boolean;

  /** Run `evalHarness.evaluate` on the produced adapter and write eval-report.json. */
  evalAfterTrain?: boolean;
  /** Injected by Phase 4 retrainer; default undefined skips eval. */
  evalHarness?: EvalHarness;

  /** Test seam — defaults to a real child_process spawn runner. */
  subprocessRunner?: SubprocessRunner;
  /** Test seam — defaults to a real fs adapter. */
  fs?: FsAccess;
  /** Test seam — defaults to () => new Date(). */
  clock?: () => Date;
}

/** Fully-resolved config — what the trainer sees internally. */
export type ResolvedTrainingConfig = Required<Omit<ApprenticeTrainingConfig, 'evalHarness'>> & {
  loraConfig: LoraConfig;
  evalHarness?: EvalHarness;
};

/**
 * Stage 4: trainer success result. Adapter directory is the canonical
 * Phase-3-consumable artifact; metadata + log are sidecars.
 */
export interface TrainResult {
  /** Absolute path to `<outputAdapterRoot>/<dated-shortname>/`. */
  adapterPath: string;
  /** `<adapterPath>/adapters.safetensors`. */
  adapterFile: string;
  /** `<adapterPath>/adapter_config.json`. */
  adapterConfigFile: string;
  /** `<adapterPath>/training-metadata.json`. */
  trainingMetadataPath: string;
  /** `<adapterPath>/training-log.txt`. */
  trainingLogPath: string;
  /** `<adapterPath>/Modelfile` (Ollama scaffold). */
  modelfilePath: string;
  /** Wall-clock total (split + format + preflight + subprocess + postflight). */
  elapsedMs: number;
  /** Subset of fields written into training-metadata.json — for cross-checks. */
  metadata: TrainingMetadata;
  /** Optional eval result if `evalAfterTrain && evalHarness`. */
  evalReport?: EvalAdapterReport;
}

/**
 * Output of split phase — what the formatter writes to JSONL files and
 * what postflight asserts against.
 */
export interface SplitResult {
  train: CorpusSample[];
  valid: CorpusSample[];
  test: CorpusSample[];
  /** Trace of how the split was decided — recorded in metadata. */
  trace: {
    totalSamples: number;
    holdoutFromManifest: number;
    holdoutFromIdHash: number;
    splitSeed: number;
    fractions: { train: number; valid: number; test: number };
  };
}

/**
 * Trace info captured for `training-metadata.json`. See DESIGN.md §8.
 */
export interface TrainingMetadata {
  version: 1;
  generatedAt: string;
  trainerVersion: string;
  corpusManifestPath: string;
  corpusManifestSha256: string;
  corpusTotals: {
    samplesUsed: number;
    trainCount: number;
    validCount: number;
    testCount: number;
  };
  baseModel: string;
  baseModelOllamaTag: string;
  loraConfig: LoraConfig;
  subprocess: {
    argv: string[];
    exitCode: number;
    elapsedMs: number;
    timedOut: boolean;
    host: { model?: string; memBytes?: number; arch?: string };
  };
  git?: { branch?: string; sha?: string; dirty?: boolean };
  configSha256: string;
  warnings: string[];
}

/**
 * Errors. All extend `Error` and carry context for triage; the cli pretty-prints them.
 */
export class TrainingError extends Error {
  public override readonly name: string;
  constructor(name: string, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = name;
  }
}

export class InsufficientCorpusError extends TrainingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('InsufficientCorpusError', message, details);
  }
}

export class PreflightError extends TrainingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('PreflightError', message, details);
  }
}

export class MlxLmVersionIncompatibleError extends TrainingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('MlxLmVersionIncompatibleError', message, details);
  }
}

export class MlxLoraSubprocessError extends TrainingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('MlxLoraSubprocessError', message, details);
  }
}

export class AdapterNotProducedError extends TrainingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('AdapterNotProducedError', message, details);
  }
}

export class CloudGpuBudgetError extends TrainingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CloudGpuBudgetError', message, details);
  }
}
