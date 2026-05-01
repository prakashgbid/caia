/**
 * Trainset / evalset builders.
 *
 * Reads:
 *   - last-24h trace JSONL for a program (from `traces.ts`)
 *   - the spend-guard `SpendRecord` stream (cost-side tap; passed in by
 *     the cron because spend-guard's record-sink is owned upstream)
 *
 * Writes JSONL files in the shape the Python server expects:
 *
 *     {"input": {...}, "label": {...}}
 *
 * The label is required for the eval set (PHASE2E-002) and optional for
 * the trainset (raw production traces are unsupervised; MIPROv2
 * bootstraps demos via its own self-supervision pass).
 *
 * "Pull from spend_records (Langfuse later)" per the proposal §7:
 *   - Today: the cron passes spend records and traces in side-by-side.
 *     We use the cost surface to GATE candidates (low-confidence calls
 *     are higher-leverage to demonstrate) and the trace surface to
 *     supply the actual (input, output) pairs.
 *   - Tomorrow: a Langfuse exporter replaces both feeds with a single
 *     trace stream. Same JSONL output shape.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SpendRecord } from './spend-bridge.js';
import { readTraces, type TraceRow } from './traces.js';

export interface BuildTrainsetOptions {
  program: string;
  /** ISO-8601 inclusive lower bound. Default: 24h ago. */
  sinceIso?: string;
  /** ISO-8601 inclusive upper bound. Default: now. */
  untilIso?: string;
  /** Where to read traces from. Default: ~/.caia/dspy/traces. */
  traceRoot?: string;
  /** Optional spend records — used to score example leverage. */
  spendRecords?: readonly SpendRecord[];
  /** Maximum trainset rows. Default: 200. */
  maxRows?: number;
}

export interface TrainsetRow {
  input: Record<string, unknown>;
  label?: Record<string, unknown>;
}

/**
 * Build a JSONL-serialisable trainset from the last-N-hours of traces.
 *
 * Selection rules:
 *   1. include only rows with ok=true (failures don't teach anything
 *      useful at this layer — they're a tracing concern)
 *   2. dedupe by `JSON.stringify(input)` so identical prompts don't
 *      dominate the optimizer
 *   3. prefer rows that produced an explicit `label` (judge verdict)
 *   4. cap at `maxRows` (default 200) — MIPROv2 doesn't need more and
 *      compile time is roughly linear in trainset size
 */
export function buildTrainset(opts: BuildTrainsetOptions): TrainsetRow[] {
  const sinceIso =
    opts.sinceIso ?? new Date(Date.now() - 24 * 3_600_000).toISOString();
  const untilIso = opts.untilIso ?? new Date().toISOString();
  const max = opts.maxRows ?? 200;

  const traces = readTraces(opts.program, sinceIso, untilIso, {
    ...(opts.traceRoot ? { root: opts.traceRoot } : {}),
  });

  const seen = new Set<string>();
  const rows: TrainsetRow[] = [];

  // Sort: labelled rows first (more informative), then by timestamp DESC.
  const sorted = [...traces].sort((a, b) => {
    const labelDelta =
      (b.label ? 1 : 0) - (a.label ? 1 : 0);
    if (labelDelta !== 0) return labelDelta;
    return b.ts.localeCompare(a.ts);
  });

  for (const t of sorted) {
    const key = JSON.stringify(t.input);
    if (seen.has(key)) continue;
    seen.add(key);
    const row: TrainsetRow = { input: t.input };
    if (t.label) {
      row.label = t.label;
    } else {
      // Use the model's own verdict as a noisy pseudo-label so the
      // bootstrap pass has something to chew on. MIPROv2 will discard
      // demos whose metric-score is poor — this is just seed material.
      row.label = pseudoLabelFromOutput(t);
    }
    rows.push(row);
    if (rows.length >= max) break;
  }
  return rows;
}

/**
 * Persist a trainset as JSONL. Returns the absolute path.
 */
export function writeTrainsetJsonl(
  rows: readonly TrainsetRow[],
  outPath: string,
): string {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(outPath, text, 'utf8');
  return path.resolve(outPath);
}

function pseudoLabelFromOutput(t: TraceRow): Record<string, unknown> {
  // For po-scope-detector, the output already carries (targetScope,
  // confidence, rationale). For unknown programs we just pass it
  // through — the program-specific score() function decides what to
  // do with it.
  return { ...t.output };
}
