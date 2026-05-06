/**
 * Configuration shape + CAIA defaults.
 *
 * Per DESIGN.md §3 (public API). Option E pre-send check: every CAIA-specific
 * path/URL is here with a default; tests inject overrides; production passes
 * CAIA-only.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  AdapterSpec,
  ClaudeJudge,
  FsReader,
  FsWriter,
  MlxFallback,
  OllamaClient
} from './types.js';

/** Public config — every field is optional; CAIA defaults fill the gaps. */
export interface ApprenticeEvalConfig {
  // ── Paths ───────────────────────────────────────────────────────────
  corpusManifestPath?: string;
  suiteRoot?: string;
  baselineRoot?: string;
  outputRoot?: string;

  // ── Models / adapters ───────────────────────────────────────────────
  baseModel?: string;
  adapters?: ReadonlyArray<AdapterSpec>;

  // ── External providers ──────────────────────────────────────────────
  ollamaBaseUrl?: string;
  judgeEnabled?: boolean;
  judgeBudget?: number;
  abMode?: boolean;

  // ── Behaviour knobs ─────────────────────────────────────────────────
  winRateThreshold?: number;
  forgettingThreshold?: number;
  tieEpsilon?: number;
  warmupRuns?: number;
  perPromptTimeoutMs?: number;
  seed?: number;
  /** Restrict to specific suite ids; default: all suites under suiteRoot. */
  onlySuites?: ReadonlyArray<string>;
  /** Restrict to specific adapter names; default: all configured adapters. */
  onlyAdapters?: ReadonlyArray<string>;

  // ── Test seams (DI) ─────────────────────────────────────────────────
  ollama?: OllamaClient;
  mlx?: MlxFallback;
  judge?: ClaudeJudge;
  fs?: FsReader;
  writer?: FsWriter;
  /** Override now() for deterministic tests. */
  clock?: () => Date;
}

/** Internal — fully-resolved config with all defaults filled. */
export interface ResolvedApprenticeEvalConfig {
  corpusManifestPath: string;
  suiteRoot: string;
  baselineRoot: string;
  outputRoot: string;
  baseModel: string;
  adapters: ReadonlyArray<AdapterSpec>;
  ollamaBaseUrl: string;
  judgeEnabled: boolean;
  judgeBudget: number;
  abMode: boolean;
  winRateThreshold: number;
  forgettingThreshold: number;
  tieEpsilon: number;
  warmupRuns: number;
  perPromptTimeoutMs: number;
  seed: number;
  onlySuites: ReadonlyArray<string> | null;
  onlyAdapters: ReadonlyArray<string> | null;
}

const HOME = homedir();

const DEFAULTS: ResolvedApprenticeEvalConfig = {
  corpusManifestPath: '',
  suiteRoot: '',
  baselineRoot: '',
  outputRoot: join(HOME, 'Documents', 'projects', 'apprentice', 'eval-runs'),
  baseModel: 'qwen2.5-coder:7b',
  adapters: [],
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  judgeEnabled: false,
  judgeBudget: 50,
  abMode: false,
  winRateThreshold: 0.6,
  forgettingThreshold: 0.1,
  tieEpsilon: 0.05,
  warmupRuns: 2,
  perPromptTimeoutMs: 90_000,
  seed: 42,
  onlySuites: null,
  onlyAdapters: null
};

export function resolveConfig(
  input: ApprenticeEvalConfig,
  pkgRoot: string
): ResolvedApprenticeEvalConfig {
  const resolved: ResolvedApprenticeEvalConfig = {
    ...DEFAULTS,
    corpusManifestPath:
      input.corpusManifestPath ??
      join(HOME, 'Documents', 'projects', 'apprentice', 'corpora', 'latest', 'manifest.json'),
    suiteRoot: input.suiteRoot ?? join(pkgRoot, 'suites'),
    baselineRoot: input.baselineRoot ?? join(pkgRoot, 'baselines'),
    outputRoot: input.outputRoot ?? DEFAULTS.outputRoot,
    baseModel: input.baseModel ?? DEFAULTS.baseModel,
    adapters: input.adapters ?? DEFAULTS.adapters,
    ollamaBaseUrl: input.ollamaBaseUrl ?? DEFAULTS.ollamaBaseUrl,
    judgeEnabled: input.judgeEnabled ?? DEFAULTS.judgeEnabled,
    judgeBudget: input.judgeBudget ?? DEFAULTS.judgeBudget,
    abMode: input.abMode ?? DEFAULTS.abMode,
    winRateThreshold: input.winRateThreshold ?? DEFAULTS.winRateThreshold,
    forgettingThreshold: input.forgettingThreshold ?? DEFAULTS.forgettingThreshold,
    tieEpsilon: input.tieEpsilon ?? DEFAULTS.tieEpsilon,
    warmupRuns: input.warmupRuns ?? DEFAULTS.warmupRuns,
    perPromptTimeoutMs: input.perPromptTimeoutMs ?? DEFAULTS.perPromptTimeoutMs,
    seed: input.seed ?? DEFAULTS.seed,
    onlySuites: input.onlySuites && input.onlySuites.length > 0 ? input.onlySuites : null,
    onlyAdapters: input.onlyAdapters && input.onlyAdapters.length > 0 ? input.onlyAdapters : null
  };

  if (resolved.judgeBudget < 0) throw new Error('[apprentice-eval] judgeBudget must be ≥ 0');
  if (resolved.winRateThreshold < 0 || resolved.winRateThreshold > 1) {
    throw new Error('[apprentice-eval] winRateThreshold must be in [0, 1]');
  }
  if (resolved.forgettingThreshold < 0 || resolved.forgettingThreshold > 1) {
    throw new Error('[apprentice-eval] forgettingThreshold must be in [0, 1]');
  }
  if (resolved.tieEpsilon < 0 || resolved.tieEpsilon > 1) {
    throw new Error('[apprentice-eval] tieEpsilon must be in [0, 1]');
  }
  if (resolved.warmupRuns < 0) throw new Error('[apprentice-eval] warmupRuns must be ≥ 0');

  return resolved;
}

export const __TEST_ONLY = { DEFAULTS };
