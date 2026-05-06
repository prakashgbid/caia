/**
 * Public types for @chiefaia/apprentice-eval.
 *
 * Per DESIGN.md §3 (public API) + §7 (scoring) + §10 (output layout).
 * Keep this module dependency-free — every other module imports from here.
 */

// ─── Suite YAML shape (Promptfoo-compatible subset) ──────────────────────

/** A single assertion fired against a generated output. */
export type Assertion =
  | { readonly type: 'contains'; readonly value: string; readonly weight?: number }
  | { readonly type: 'not-contains'; readonly value: string; readonly weight?: number }
  | { readonly type: 'regex'; readonly value: string; readonly weight?: number }
  | { readonly type: 'equals'; readonly value: string; readonly weight?: number }
  | {
      readonly type: 'javascript';
      /** Predicate body; receives `output` (string) → returns boolean | number. */
      readonly value: string;
      readonly weight?: number;
    }
  | {
      readonly type: 'semantic-similarity';
      readonly value: string;
      /** 0..1; assertion passes when cosine ≥ threshold. */
      readonly threshold?: number;
      readonly weight?: number;
    };

export interface SuiteTestCase {
  /** Stable id; if missing, derived from `description` slug. */
  readonly id?: string;
  readonly description: string;
  readonly vars: { readonly prompt: string; readonly [k: string]: string };
  readonly assert: ReadonlyArray<Assertion>;
}

export interface SuiteDefaultTest {
  readonly vars?: Record<string, string>;
  readonly assert?: ReadonlyArray<Assertion>;
}

export interface PromptSuite {
  /** Suite slug; matches the YAML basename. */
  readonly id: string;
  readonly description: string;
  readonly defaultTest?: SuiteDefaultTest;
  readonly tests: ReadonlyArray<SuiteTestCase>;
  /** Source path. Useful for debugging. */
  readonly sourcePath: string;
}

// ─── Adapter spec ────────────────────────────────────────────────────────

export interface AdapterSpec {
  readonly name: string;
  /** Base model tag the adapter was trained on (Ollama tag, e.g. `qwen2.5-coder:7b`). */
  readonly kind: string;
  /** Filesystem path to the adapter directory or `.safetensors` file. */
  readonly path: string;
}

// ─── Generation result + scoring ─────────────────────────────────────────

export interface GenerateRequest {
  readonly model: string;
  readonly prompt: string;
  readonly adapter?: string;
  readonly seed?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}

export interface GenerateResult {
  readonly output: string;
  readonly elapsedMs: number;
  readonly model: string;
  readonly adapter?: string;
  /** Provider that actually served the call (`ollama` | `mlx`). */
  readonly provider: 'ollama' | 'mlx' | 'fake';
  readonly seed?: number;
}

export interface AssertionResult {
  readonly type: Assertion['type'];
  readonly value: string;
  readonly passed: boolean;
  readonly weight: number;
  /** Cosine / numeric / explanatory; populated when relevant. */
  readonly score?: number;
  readonly reason?: string;
}

export interface RubricResult {
  readonly promptId: string;
  readonly suiteId: string;
  readonly adapter: string;
  readonly passed: number;
  readonly failed: number;
  readonly weightedScore: number;
  readonly assertions: ReadonlyArray<AssertionResult>;
}

// ─── Pairwise + winrate ──────────────────────────────────────────────────

export type PairwiseOutcome = 'win' | 'loss' | 'tie';

export interface PairwiseResult {
  readonly promptId: string;
  readonly suiteId: string;
  readonly adapter: string;
  readonly baseScore: number;
  readonly adapterScore: number;
  readonly outcome: PairwiseOutcome;
  readonly delta: number;
}

export interface AdapterWinrate {
  readonly adapter: string;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  /** wins / (wins + losses); ties excluded from denom. NaN if no decisive prompts. */
  readonly winRate: number;
  readonly suitePassRate: number;
  readonly regressions: ReadonlyArray<RegressionFlag>;
  readonly decision: 'promote-canary' | 'reject-regression' | 'reject-winrate' | 'reject-no-data';
}

export interface RegressionFlag {
  readonly promptId: string;
  readonly suiteId: string;
  readonly adapter: string;
  readonly priorScore: number;
  readonly currentScore: number;
  readonly delta: number;
}

// ─── Baselines ───────────────────────────────────────────────────────────

export interface BaselineEntry {
  readonly promptId: string;
  readonly suiteId: string;
  readonly weightedScore: number;
  readonly recordedAt: string;
}

export interface BaselineSnapshot {
  readonly version: 1;
  readonly adapter: string;
  /** ISO timestamp when this baseline was last refreshed. */
  readonly recordedAt: string;
  readonly entries: ReadonlyArray<BaselineEntry>;
}

// ─── Reports ─────────────────────────────────────────────────────────────

export interface RunConfigSnapshot {
  readonly baseModel: string;
  readonly adapters: ReadonlyArray<AdapterSpec>;
  readonly suiteIds: ReadonlyArray<string>;
  readonly winRateThreshold: number;
  readonly forgettingThreshold: number;
  readonly judgeEnabled: boolean;
  readonly judgeBudget: number;
  readonly seed: number;
  readonly tieEpsilon: number;
  readonly corpusManifestSha?: string;
}

export interface ScoreCardEntry extends RubricResult {
  readonly elapsedMs: number;
  readonly provider: GenerateResult['provider'];
}

export interface ScoreCards {
  readonly version: 1;
  readonly generatedAt: string;
  readonly entries: ReadonlyArray<ScoreCardEntry>;
}

export interface WinrateReport {
  readonly version: 1;
  readonly generatedAt: string;
  readonly base: { readonly model: string; readonly suitePassRate: number };
  readonly adapters: ReadonlyArray<AdapterWinrate>;
  readonly pairwise: ReadonlyArray<PairwiseResult>;
}

export interface JudgeRecord {
  readonly promptId: string;
  readonly suiteId: string;
  readonly adapter: string;
  readonly preference: 'A' | 'B' | 'tie';
  /** Anonymised mapping; A may be base or adapter. */
  readonly aIs: 'base' | 'adapter';
  readonly rationale: string;
  readonly elapsedMs: number;
}

export interface AbPreferenceRecord {
  readonly promptId: string;
  readonly suiteId: string;
  readonly adapter: string;
  readonly preference: 'A' | 'B' | 'tie' | 'skip';
  readonly aIs: 'base' | 'adapter';
  readonly recordedAt: string;
}

// ─── Test seams (DI shapes) ──────────────────────────────────────────────

export interface OllamaClient {
  readonly generate: (req: GenerateRequest) => Promise<GenerateResult>;
  /** Returns `true` if the running Ollama supports the `adapter` field. */
  readonly supportsAdapters: () => Promise<boolean>;
  /** Throws if Ollama is unreachable. */
  readonly ping: () => Promise<void>;
}

export interface MlxFallback {
  readonly generate: (req: GenerateRequest) => Promise<GenerateResult>;
  readonly available: () => Promise<boolean>;
}

export interface ClaudeJudge {
  readonly judge: (input: {
    readonly prompt: string;
    readonly outputA: string;
    readonly outputB: string;
  }) => Promise<{ readonly preference: 'A' | 'B' | 'tie'; readonly rationale: string }>;
  readonly available: () => Promise<boolean>;
}

export interface FsReader {
  readonly readFile: (path: string) => Promise<string>;
  readonly readDir: (path: string) => Promise<ReadonlyArray<string>>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly stat: (path: string) => Promise<{ readonly mtimeMs: number; readonly size: number }>;
}

export interface FsWriter {
  readonly writeFile: (path: string, data: string) => Promise<void>;
  readonly mkdir: (path: string) => Promise<void>;
}

/** Minimal corpus-manifest projection — the eval harness only needs holdout ids. */
export interface CorpusManifestProjection {
  readonly outputDir: string;
  readonly generatedAt: string;
  readonly configSha256: string;
  readonly holdout: ReadonlyArray<string>;
}
