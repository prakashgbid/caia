/**
 * Wire protocol shared between the Node bridge and the Python DSPy
 * server. Plain JSON-Lines over stdin/stdout; one JSON object per
 * line, both directions.
 *
 * The protocol is intentionally tiny — load a compiled program,
 * predict against it, optionally compile a new version. All heavy
 * state (loaded programs, LM adapters) lives in the Python process.
 */

export type DspyMethod =
  | 'ping'
  | 'load_program'
  | 'predict'
  | 'compile'
  | 'list_programs'
  | 'shutdown';

/** A request id — caller-generated, echoed in the response. */
export type RequestId = string;

export interface DspyRequest<TParams = unknown> {
  id: RequestId;
  method: DspyMethod;
  params: TParams;
}

export interface DspyResponseOk<TResult = unknown> {
  id: RequestId;
  ok: true;
  result: TResult;
}

export interface DspyResponseErr {
  id: RequestId;
  ok: false;
  error: {
    /** Stable string ids: 'parse-error', 'no-program', 'lm-failed', etc. */
    code: string;
    message: string;
    /** Optional structured detail. */
    detail?: unknown;
  };
}

export type DspyResponse<TResult = unknown> =
  | DspyResponseOk<TResult>
  | DspyResponseErr;

// ─── Method param/result shapes ──────────────────────────────────────────

export interface PingParams {
  payload?: string;
}
export interface PingResult {
  pong: true;
  pyVersion: string;
  dspyVersion: string;
  uptimeMs: number;
}

export interface LoadProgramParams {
  /** Program name, e.g. 'po-scope-detector'. */
  program: string;
  /**
   * Concrete version, or 'latest' to follow the version pointer file
   * at `~/.caia/dspy/compiled/<program>/CURRENT`.
   */
  version: string;
}
export interface LoadProgramResult {
  program: string;
  version: string;
  /** Resolved on-disk pickle path. */
  pickle: string;
}

export interface PredictParams {
  program: string;
  /** 'latest' resolves via CURRENT pointer; concrete version pins. */
  version: string;
  input: Record<string, unknown>;
}
export interface PredictResult {
  /** Whatever the DSPy module's signature outputs. */
  output: Record<string, unknown>;
  /** The model id the underlying LM reported (telemetry). */
  model: string;
  /** Wall-clock ms of the predict() call. */
  durationMs: number;
}

export interface CompileParams {
  program: string;
  /** Optimizer name. P0 supports 'miprov2'. */
  optimizer: 'miprov2';
  /**
   * Trainset path on disk. JSONL of `{"input": {...}, "label": {...}}`
   * objects with shape matching the program's signature.
   */
  trainsetPath: string;
  /** Eval set path on disk; same JSONL shape. */
  evalsetPath: string;
  /** Output directory; the new pickle lands at <outDir>/<program>-vN.pkl. */
  outDir: string;
  /** Optional max bootstrapped demos for MIPROv2 (default 4). */
  maxBootstrappedDemos?: number;
}
export interface CompileResult {
  program: string;
  /** Path to the freshly-written pickle. */
  pickle: string;
  /** Version string assigned by the compiler. */
  version: string;
  /** Score on evalset for the new program. */
  newScore: number;
  /** Score on evalset for the previous CURRENT (or null if first compile). */
  prevScore: number | null;
  /** newScore - prevScore (or null if first compile). */
  delta: number | null;
}

export interface ListProgramsResult {
  programs: Array<{
    program: string;
    versions: string[];
    current: string | null;
  }>;
}
