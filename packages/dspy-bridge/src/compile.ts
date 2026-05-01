/**
 * Daily compile orchestration — Node side.
 *
 * Pulls last-24h traces (PR3), persists trainset + evalset JSONL,
 * fires `bridge.compile()`, then evaluates the delta gate:
 *
 *     delta ≥ 0  →  promote (rewrite CURRENT pointer)
 *     delta < 0  →  rollback (leave CURRENT untouched, log + alert)
 *
 * The actual MIPROv2 work and the per-row scoring runs in Python — this
 * module is the policy layer (gate, promote, audit log, retention).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { DspyBridge } from './bridge.js';
import { defaultTraceRoot } from './traces.js';
import { buildTrainset, writeTrainsetJsonl, type TrainsetRow } from './trainset.js';
import {
  fixturesToEvalsetRows,
  PHASE2E_002_FIXTURES,
} from './evalsets/po-scope-detector-phase2e002.js';
import { PO_SCOPE_DETECTOR_PROGRAM } from './programs/po-scope-detector.js';

export interface DailyCompileOptions {
  /** Program to compile. Default: 'po-scope-detector'. */
  program?: string;
  /** Override trace root (test seam). */
  traceRoot?: string;
  /** Compiled-program root. Default: ~/.caia/dspy/compiled. */
  compiledRoot?: string;
  /**
   * Override the eval set rows. Default: PHASE2E-002 fixtures.
   * Supplying a custom set is allowed for back-compat with future
   * proposals; the runbook documents PHASE2E-002 as the authoritative
   * gate set.
   */
  evalsetRows?: readonly TrainsetRow[];
  /** Pre-instantiated bridge. Default: new DspyBridge({}). */
  bridge?: DspyBridge;
  /** Skip start/stop on the bridge (caller manages the lifecycle). */
  externallyManagedBridge?: boolean;
  /**
   * Promote-or-rollback policy. Default: delta >= 0 promotes.
   *
   * Returning `false` keeps the previous CURRENT pointer; returning
   * `true` rewrites it to the new version.
   */
  promotePolicy?: (verdict: CompileVerdict) => boolean;
  /** Test-seam wall-clock provider. */
  nowMs?: () => number;
}

export interface CompileVerdict {
  program: string;
  /** Version that was just compiled (e.g. 'v3'). */
  newVersion: string;
  /** Path to the new pickle on disk. */
  newPickle: string;
  /** Score of the new program on the eval set (0..1+ tie bonus). */
  newScore: number;
  /** Score of the previous CURRENT on the same eval set. */
  prevScore: number | null;
  /** newScore - prevScore (or null on first compile). */
  delta: number | null;
  /**
   * Whether the policy promoted the new version. true = CURRENT
   * pointer rewritten; false = no-op.
   */
  promoted: boolean;
  /** Trainset row count fed to MIPROv2. */
  trainsetSize: number;
  /** ISO-8601 timestamp the run completed. */
  finishedAtIso: string;
}

/**
 * Run a daily compile end-to-end. Returns the verdict.
 *
 * Flow:
 *   1. start() the bridge (unless externally-managed)
 *   2. build trainset.jsonl from the last 24h of traces
 *   3. write evalset.jsonl from PHASE2E-002 fixtures
 *   4. call bridge.compile() — Python runs MIPROv2 + scores
 *   5. read the score, compute delta
 *   6. apply promote/rollback policy
 *   7. write an audit-log row to ~/.caia/dspy/compiles.log
 */
export async function runDailyCompile(
  options: DailyCompileOptions = {},
): Promise<CompileVerdict> {
  const program = options.program ?? PO_SCOPE_DETECTOR_PROGRAM;
  const compiledRoot =
    options.compiledRoot ??
    path.join(os.homedir(), '.caia', 'dspy', 'compiled');
  const programDir = path.join(compiledRoot, program);
  fs.mkdirSync(programDir, { recursive: true });

  const traceRoot = options.traceRoot ?? defaultTraceRoot();
  const now = options.nowMs?.() ?? Date.now();
  const sinceIso = new Date(now - 24 * 3_600_000).toISOString();
  const untilIso = new Date(now).toISOString();

  // 2. Trainset.
  const trainsetRows = buildTrainset({
    program,
    sinceIso,
    untilIso,
    traceRoot,
  });
  const trainsetPath = path.join(programDir, 'trainset.jsonl');
  writeTrainsetJsonl(trainsetRows, trainsetPath);

  // 3. Evalset.
  const evalRows = options.evalsetRows ?? fixturesToEvalsetRows();
  const evalsetPath = path.join(programDir, 'evalset.jsonl');
  writeTrainsetJsonl(evalRows, evalsetPath);

  // 4. Compile via the bridge.
  const bridge = options.bridge ?? new DspyBridge();
  if (!options.externallyManagedBridge) {
    await bridge.start();
  }
  let compileResult;
  try {
    compileResult = await bridge.compile({
      program,
      optimizer: 'miprov2',
      trainsetPath,
      evalsetPath,
      outDir: programDir,
    });
  } finally {
    if (!options.externallyManagedBridge) {
      await bridge.stop().catch(() => undefined);
    }
  }

  // 5/6. Delta gate.
  const policy = options.promotePolicy ?? defaultPromotePolicy;
  const verdict: CompileVerdict = {
    program,
    newVersion: compileResult.version,
    newPickle: compileResult.pickle,
    newScore: compileResult.newScore,
    prevScore: compileResult.prevScore,
    delta: compileResult.delta,
    promoted: false,
    trainsetSize: trainsetRows.length,
    finishedAtIso: new Date(options.nowMs?.() ?? Date.now()).toISOString(),
  };
  const shouldPromote = policy(verdict);
  if (shouldPromote) {
    fs.writeFileSync(
      path.join(programDir, 'CURRENT'),
      `${compileResult.version}\n`,
      'utf8',
    );
    verdict.promoted = true;
  }

  // 7. Audit-log line.
  const logPath = path.join(compiledRoot, 'compiles.log');
  fs.appendFileSync(
    logPath,
    `${JSON.stringify(verdict)}\n`,
    { encoding: 'utf8' },
  );

  return verdict;
}

/**
 * Default policy — promote when delta >= 0 (or no previous version).
 *
 * On first compile (prevScore === null), `delta` is null. We promote so
 * the CURRENT pointer goes from "(none) -> v1" — otherwise the next
 * runtime predict() falls through to the uncompiled module forever.
 */
export function defaultPromotePolicy(verdict: CompileVerdict): boolean {
  if (verdict.delta === null) return true;
  return verdict.delta >= 0;
}

/**
 * Convenience for the cron CLI — render the verdict as a one-line
 * sparkline used by the runbook + dashboard.
 */
export function renderVerdictLine(verdict: CompileVerdict): string {
  const prev = verdict.prevScore === null ? '—' : verdict.prevScore.toFixed(3);
  const next = verdict.newScore.toFixed(3);
  const delta = verdict.delta === null ? '—' : (verdict.delta >= 0 ? '+' : '') + verdict.delta.toFixed(3);
  const verb = verdict.promoted ? 'promoted' : 'rolled-back';
  return (
    `[dspy:${verdict.program}] ${verb} ${verdict.newVersion} ` +
    `(prev=${prev} next=${next} Δ=${delta} train=${String(verdict.trainsetSize)})`
  );
}

/** Re-export the eval set size as a constant the runbook can quote. */
export const EVALSET_SIZE = PHASE2E_002_FIXTURES.length;
