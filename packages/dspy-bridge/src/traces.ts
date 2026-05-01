/**
 * Trace writer — append-only JSONL trace store for DSPy training data.
 *
 * Why this exists: the substrate proposal §7 calls for a feedback loop
 * that compiles the active DSPy program against the last 24h of
 * production calls. `@chiefaia/spend-guard` already records spend, but
 * its `SpendRecord` only carries cost / model / tokens — not the prompt
 * or response.
 *
 * This module owns the *content* side of the same event: prompt in,
 * verdict out, success flag. The trace pipeline (`trainset.ts`) reads
 * these JSONL files and shapes them into a DSPy trainset.
 *
 * The format is intentionally trivial — one JSON object per line, one
 * file per UTC date per program:
 *
 *     ~/.caia/dspy/traces/<program>/YYYY-MM-DD.jsonl
 *
 * Files are append-only; rotation is by date; old files can be pruned
 * by the cron once they roll out of the 24h window.
 *
 * Langfuse migration (proposal §7 next phase): swap the writer for a
 * Langfuse client; the JSONL format stays as the disaster-recovery
 * fallback so we never lose telemetry on Langfuse outages.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface TraceRow {
  /** ISO-8601 timestamp the call completed at. */
  ts: string;
  /** DSPy program name, e.g. 'po-scope-detector'. */
  program: string;
  /** The compiled-program version that served the call (or 'uncompiled'). */
  version: string;
  /** RPC input dict (typed per program; opaque here). */
  input: Record<string, unknown>;
  /** RPC output dict. May be partial when ok=false. */
  output: Record<string, unknown>;
  /** Whether the call returned a usable verdict. */
  ok: boolean;
  /** Concrete model id reported by the LM. */
  model: string;
  /** Wall-clock ms of the predict call. */
  durationMs: number;
  /**
   * Optional ground-truth label. Filled in when the orchestrator later
   * adjudicates the call (e.g. judge-pair pass on the parent decomposition).
   * Absent for raw production traces — those become *unsupervised* train
   * rows for MIPROv2 bootstrapping.
   */
  label?: Record<string, unknown>;
}

export interface TraceWriterOptions {
  /** Override the trace root. Default: ~/.caia/dspy/traces. */
  root?: string;
  /** Test seam. */
  nowDateIso?: () => string;
}

/**
 * Append a trace row for a given program. Idempotent on file creation;
 * thread-safe on a single Node process via append-only writes.
 */
export function recordTrace(
  program: string,
  row: Omit<TraceRow, 'ts' | 'program'>,
  options: TraceWriterOptions = {},
): void {
  const root = options.root ?? defaultTraceRoot();
  const dir = path.join(root, program);
  fs.mkdirSync(dir, { recursive: true });
  const tsIso = options.nowDateIso?.() ?? new Date().toISOString();
  const day = tsIso.slice(0, 10); // YYYY-MM-DD
  const file = path.join(dir, `${day}.jsonl`);
  const fullRow: TraceRow = { ts: tsIso, program, ...row };
  fs.appendFileSync(file, `${JSON.stringify(fullRow)}\n`, { encoding: 'utf8' });
}

/**
 * Read all trace rows for a program written between [sinceIso, untilIso].
 * Inclusive on both ends (same date string -> reads that day's file).
 *
 * Filters by ok=true unless `includeFailed: true` is passed — failed
 * rows are useful for offline debugging but bad for trainsets.
 */
export function readTraces(
  program: string,
  sinceIso: string,
  untilIso: string,
  options: { root?: string; includeFailed?: boolean } = {},
): TraceRow[] {
  const root = options.root ?? defaultTraceRoot();
  const dir = path.join(root, program);
  if (!fs.existsSync(dir)) return [];
  const sinceDay = sinceIso.slice(0, 10);
  const untilDay = untilIso.slice(0, 10);
  const days = enumerateDays(sinceDay, untilDay);

  const rows: TraceRow[] = [];
  for (const day of days) {
    const file = path.join(dir, `${day}.jsonl`);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as TraceRow;
        if (obj.ts < sinceIso || obj.ts > untilIso) continue;
        if (!options.includeFailed && !obj.ok) continue;
        rows.push(obj);
      } catch {
        // Skip malformed lines; log path is left to the cron.
      }
    }
  }
  return rows;
}

export function defaultTraceRoot(): string {
  return path.join(os.homedir(), '.caia', 'dspy', 'traces');
}

function enumerateDays(startDay: string, endDay: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startDay}T00:00:00Z`);
  const end = new Date(`${endDay}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
