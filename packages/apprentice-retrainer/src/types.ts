/**
 * @chiefaia/apprentice-retrainer — shared types.
 *
 * Phase 4: cron-driven orchestrator that runs corpus → train → eval →
 * register → promote-canary end-to-end. Reads + writes a persisted
 * run-state file. Operator-prompts for full canary → production promotion.
 *
 * Per Option E: every CAIA-specific path / threshold / pipeline is an
 * injected constructor parameter with a CAIA default. Tests pass fakes.
 */

import type {
  ApprenticeServing,
  RegistryEntry
} from '@chiefaia/apprentice-serving';

// ──────────────────────────────────────────────────────────────────────────
// Pipeline duck-types — Phase 4 imports the upstream packages at RUNTIME
// only (via dynamic import in the wrapper modules). Build-time deps stay
// minimal. Tests inject fake implementations of these interfaces.
// ──────────────────────────────────────────────────────────────────────────

export interface CorpusAggregator {
  /** Produce a fresh corpus snapshot. Returns the path to the manifest.json. */
  aggregate(): Promise<CorpusAggregateResult>;
}

export interface CorpusAggregateResult {
  manifestPath: string;
  corpusManifestSha256: string;
  totalSamples: number;
  newSamplesSinceLastRun?: number;
}

export interface Trainer {
  /** Run training; return the adapter directory path + adapter name. */
  train(args: TrainerRequest): Promise<TrainerResult>;
}

export interface TrainerRequest {
  corpusManifestPath: string;
}

export interface TrainerResult {
  adapterPath: string;
  /** Subset of training-metadata.json for sanity checks. */
  configSha256: string;
  baseModelOllamaTag: string;
}

export interface EvalHarness {
  evaluate(args: EvalRequest): Promise<EvalReport>;
}

export interface EvalRequest {
  adapters: Array<{ name: string; kind: string; path: string }>;
}

export interface EvalAdapterReport {
  name: string;
  winRate: number;
  decision: string;
  regressionFlags: string[];
}

export interface EvalReport {
  adapters: EvalAdapterReport[];
  outputDir: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Run-state file shape
// ──────────────────────────────────────────────────────────────────────────

export interface RetrainerStateFile {
  version: 1;
  generatedAt: string;
  lastSuccessfulTrain: LastTrainRecord | null;
  lastCanaryPromotedAt: string | null;
  lastProductionPromotedAt: string | null;
  lastError: LastErrorRecord | null;
  history: RetrainerHistoryEntry[];
}

export interface LastTrainRecord {
  at: string;
  adapterPath: string;
  adapterName: string;
  corpusManifestSha256: string;
  outcome: RetrainerOutcome;
}

export interface LastErrorRecord {
  at: string;
  message: string;
  kind: string;
}

export interface RetrainerHistoryEntry {
  at: string;
  outcome: RetrainerOutcome;
  adapterName?: string;
  note?: string;
}

export type RetrainerOutcome =
  | 'skipped-no-delta'
  | 'skipped-canary-active'
  | 'trained-and-rejected'
  | 'trained-and-canary-promoted'
  | 'canary-held-prompting-operator'
  | 'failed';

// ──────────────────────────────────────────────────────────────────────────
// Run result
// ──────────────────────────────────────────────────────────────────────────

export type RetrainerRunResult =
  | { kind: 'skipped-no-delta'; deltaCount: number; lastTrainAt: string | null }
  | { kind: 'skipped-canary-active'; canary: RegistryEntry; daysHeld: number }
  | { kind: 'trained-and-rejected'; adapterPath: string; reason: string; evalReport?: EvalAdapterReport }
  | { kind: 'trained-and-canary-promoted'; adapterPath: string; canaryPercent: number; evalReport?: EvalAdapterReport }
  | { kind: 'canary-held-prompting-operator'; canary: RegistryEntry; daysHeld: number }
  | { kind: 'failed'; error: { message: string; kind: string } };

// ──────────────────────────────────────────────────────────────────────────
// Test seams
// ──────────────────────────────────────────────────────────────────────────

export interface FsAccess {
  exists(p: string): boolean;
  readFile(p: string): string;
  writeFile(p: string, content: string): void;
  mkdir(p: string): void;
  rename(oldP: string, newP: string): void;
  unlink(p: string): void;
  appendFile?(p: string, content: string): void;
}

// ──────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────

export interface ApprenticeRetrainerConfig {
  /** Default: ~/Documents/projects/apprentice/retrainer-state.json */
  runStatePath?: string;
  /** Default: ~/Documents/projects/reports/apprentice-retrainer-digest.md */
  digestPath?: string;
  /** Default: ~/Documents/projects/apprentice/retrainer.lock */
  lockfilePath?: string;

  /** Default: 500 — minimum new pairs to trigger retrain. */
  retrainThreshold?: number;
  /** Default: 7 days — max age before retrain even with insufficient delta. */
  retrainMaxAgeMs?: number;
  /** Default: 0.60 — eval winRate gate for auto-canary-promote. */
  evalWinRateGate?: number;
  /** Default: 10 — initial canary traffic percent. */
  defaultCanaryPercent?: number;
  /** Default: 3 — days a canary must hold before operator-prompt. */
  canaryHoldDays?: number;

  // — injected pipelines (Option E) —
  corpusAggregator?: CorpusAggregator;
  trainer?: Trainer;
  evalHarness?: EvalHarness;
  serving?: ApprenticeServing;

  // — test seams —
  fs?: FsAccess;
  clock?: () => Date;
}

export type ResolvedRetrainerConfig = Required<
  Omit<
    ApprenticeRetrainerConfig,
    'corpusAggregator' | 'trainer' | 'evalHarness' | 'serving'
  >
> & {
  corpusAggregator?: CorpusAggregator;
  trainer?: Trainer;
  evalHarness?: EvalHarness;
  serving?: ApprenticeServing;
};

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

export class RetrainerError extends Error {
  public override readonly name: string;
  constructor(name: string, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = name;
  }
}

export class LockfileError extends RetrainerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('LockfileError', message, details);
  }
}

export class CorpusFailedError extends RetrainerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CorpusFailedError', message, details);
  }
}

export class TrainingFailedError extends RetrainerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('TrainingFailedError', message, details);
  }
}

export class EvalFailedError extends RetrainerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('EvalFailedError', message, details);
  }
}

export class RegisterFailedError extends RetrainerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('RegisterFailedError', message, details);
  }
}

export class PromotionFailedError extends RetrainerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('PromotionFailedError', message, details);
  }
}

export class StateCorruptError extends RetrainerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('StateCorruptError', message, details);
  }
}

export class NoCanaryActiveError extends RetrainerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('NoCanaryActiveError', message, details);
  }
}

// Re-export RegistryEntry so callers don't need to dual-import.
export type { RegistryEntry };
