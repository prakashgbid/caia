/**
 * @chiefaia/apprentice-serving — shared types.
 *
 * Pipeline overview (mirrors DESIGN.md §5):
 *
 *   adapterPath (Phase 2 output)
 *           ↓
 *     ApprenticeServing.register()
 *           ↓
 *     metadata-reader → training-metadata.json + eval-report.json
 *           ↓
 *     adapter-registry.upsert() → registry.json (atomic rename)
 *           ↓
 *   (later) promoteToCanary / promoteToProduction / rollback / reject
 *           ↓
 *     ollama-client.create()/.remove() → subprocess: ollama create/rm
 *           ↓
 *     canary-router.write() → canary-routing.json (atomic rename)
 *
 * Option E shape: every CAIA-specific path / model name template / Ollama
 * binary path is a constructor parameter with a CAIA default; tests inject
 * fixtures + a mocked OllamaClient.  See DESIGN.md for full architecture
 * rationale.
 */

// ──────────────────────────────────────────────────────────────────────────
// Registry types
// ──────────────────────────────────────────────────────────────────────────

export type RegistryStatus =
  | 'registered'
  | 'shadow'
  | 'canary'
  | 'production'
  | 'archived'
  | 'rejected';

/** A single registry entry. */
export interface RegistryEntry {
  /**
   * Stable identity = adapter directory basename.
   * Example: `2026-05-06-qwen2.5-coder-7b-rank8-iters1500`.
   * Used as the registry primary key and the basis for the Ollama
   * model name (`<baseShortName>-<status>-<sha7>` etc.).
   */
  adapterName: string;
  adapterPath: string;
  /** sha256 of training-metadata.json file contents. */
  metadataSha256: string;
  /** Pulled from training-metadata.json; cross-run identity. */
  configSha256: string;
  /** From training-metadata.json. */
  baseModel: string;
  /** From training-metadata.json. Used as the Ollama FROM tag. */
  baseModelOllamaTag: string;
  /** Set when status ∈ {shadow, canary, production}. */
  ollamaModelName?: string;
  /** Optional eval verdict from `<adapterPath>/eval-report.json`. */
  evalReport?: EvalSummary;
  status: RegistryStatus;
  /** Append-only history of state transitions. */
  history: RegistryHistoryEntry[];
  /** Set iff status === 'canary'. */
  canaryPercent?: number;
  /** Set iff status === 'rejected'. */
  rejectionReason?: string;
  /** ISO-8601. */
  registeredAt: string;
  /** Most recent promotion event. */
  promotedAt?: string;
  /** Set iff status === 'archived'. */
  archivedAt?: string;
}

export interface RegistryHistoryEntry {
  at: string;
  fromStatus: RegistryStatus | null;
  toStatus: RegistryStatus;
  note?: string;
}

export interface EvalSummary {
  winRate: number;
  decision: string;
  regressionFlags: string[];
}

/** What gets persisted at registryPath. */
export interface RegistryFile {
  version: 1;
  generatedAt: string;
  entries: RegistryEntry[];
}

// ──────────────────────────────────────────────────────────────────────────
// Canary-routing config
// ──────────────────────────────────────────────────────────────────────────

export interface CanaryRoutingConfigFile {
  version: 1;
  generatedAt: string;
  production: CanaryRoutingProductionEntry | null;
  canary: CanaryRoutingCanaryEntry | null;
}

export interface CanaryRoutingProductionEntry {
  ollamaModelName: string;
  adapterName: string;
}

export interface CanaryRoutingCanaryEntry {
  ollamaModelName: string;
  adapterName: string;
  /** 0..100 inclusive. */
  percent: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Training metadata read-side
// ──────────────────────────────────────────────────────────────────────────

/** What we read from <adapterPath>/training-metadata.json.
 *  Defensive subset of @chiefaia/apprentice-training's TrainingMetadata —
 *  duplicated here so this package doesn't take a build-time dep on the
 *  trainer (cleaner Phase 4 wiring; lets serving be useful pre-trainer-merge). */
export interface TrainingMetadataRead {
  version: number;
  generatedAt: string;
  baseModel: string;
  baseModelOllamaTag: string;
  configSha256: string;
  /** Pass-through; we don't validate contents. */
  loraConfig?: Record<string, unknown>;
  /** Pass-through. */
  corpusTotals?: Record<string, unknown>;
  /** Pass-through. */
  subprocess?: Record<string, unknown>;
  /** Pass-through. */
  warnings?: string[];
  [k: string]: unknown;
}

/** What we read from <adapterPath>/eval-report.json (when present). */
export interface EvalReportRead {
  /** Phase 1 may emit a top-level `adapters` array; we pluck the first
   *  entry whose name matches our adapter. Fallback: first entry. */
  adapters?: Array<{
    name?: string;
    winRate?: number;
    decision?: string;
    regressionFlags?: string[];
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

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
  readDir(p: string): string[];
  stat(p: string): { mtimeMs: number; size: number; isFile: boolean; isDirectory: boolean };
}

/** Subset of OllamaClient operations we need. */
export interface OllamaClient {
  /** `ollama --version`. Throws OllamaNotInstalledError on failure. */
  version(): Promise<string>;
  /** `ollama list`. Returns model names. */
  list(): Promise<string[]>;
  /** `ollama create <name> -f <modelfilePath>`. cwd is set to <adapterPath>. */
  create(args: OllamaCreateArgs): Promise<void>;
  /** `ollama rm <name>`. Treats not-found as success. */
  remove(modelName: string): Promise<void>;
  /** `ollama show <name> --modelfile`. Returns the Modelfile content. */
  show(modelName: string): Promise<string>;
}

export interface OllamaCreateArgs {
  modelName: string;
  modelfilePath: string;
  cwd: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────

export interface ApprenticeServingConfig {
  /** Default: ~/Documents/projects/apprentice/registry.json */
  registryPath?: string;
  /** Default: ~/Documents/projects/apprentice/canary-routing.json */
  canaryRoutingConfigPath?: string;

  /** Default: 'ollama' (resolved via PATH). */
  ollamaBinaryPath?: string;
  /** Default: undefined (respects user's OLLAMA_HOST env var). */
  ollamaHost?: string;

  /** Default: (b) => `${b}-production`. */
  productionModelName?: (baseShortName: string) => string;
  /** Default: (b, s7) => `${b}-canary-${s7}`. */
  canaryModelName?: (baseShortName: string, sha7: string) => string;
  /** Default: (b, s7) => `${b}-shadow-${s7}`. */
  shadowModelName?: (baseShortName: string, sha7: string) => string;

  /** Default: 10 — older archived entries are GC'd from registry. */
  maxArchivedToKeep?: number;

  // Test seams
  ollamaClient?: OllamaClient;
  fs?: FsAccess;
  clock?: () => Date;
  /** Used to derive the subprocess timeout for ollama operations. */
  ollamaTimeoutMs?: number;
}

/** Fully-resolved config (defaults filled in). */
export type ResolvedServingConfig = Required<
  Omit<ApprenticeServingConfig, 'ollamaClient' | 'ollamaHost'>
> & {
  ollamaClient?: OllamaClient;
  ollamaHost?: string;
};

export interface AdapterRegistryConfig {
  registryPath?: string;
  fs?: FsAccess;
  clock?: () => Date;
}

export type ResolvedAdapterRegistryConfig = Required<AdapterRegistryConfig>;

export interface CanaryRouterConfig {
  canaryRoutingConfigPath?: string;
  fs?: FsAccess;
  clock?: () => Date;
}

export type ResolvedCanaryRouterConfig = Required<CanaryRouterConfig>;

// ──────────────────────────────────────────────────────────────────────────
// Routing decision (what CanaryRouter.resolve() returns)
// ──────────────────────────────────────────────────────────────────────────

export type RoutingDecision =
  | { kind: 'no-production'; production: null; canary: null }
  | {
      kind: 'production-only';
      production: CanaryRoutingProductionEntry;
      canary: null;
    }
  | {
      kind: 'production-with-canary';
      production: CanaryRoutingProductionEntry;
      canary: CanaryRoutingCanaryEntry;
    };

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

export class ServingError extends Error {
  public override readonly name: string;
  constructor(name: string, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = name;
  }
}

export class AdapterNotFoundError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('AdapterNotFoundError', message, details);
  }
}

export class MetadataMalformedError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('MetadataMalformedError', message, details);
  }
}

export class RegistryInvariantError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('RegistryInvariantError', message, details);
  }
}

export class RegistryStateMismatchError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('RegistryStateMismatchError', message, details);
  }
}

export class RegistryCorruptError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('RegistryCorruptError', message, details);
  }
}

export class OllamaNotInstalledError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('OllamaNotInstalledError', message, details);
  }
}

export class OllamaCreateError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('OllamaCreateError', message, details);
  }
}

export class OllamaRemoveError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('OllamaRemoveError', message, details);
  }
}

export class OllamaInspectError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('OllamaInspectError', message, details);
  }
}

export class RollbackTargetInvalidError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('RollbackTargetInvalidError', message, details);
  }
}

export class CanaryPercentOutOfRangeError extends ServingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CanaryPercentOutOfRangeError', message, details);
  }
}
