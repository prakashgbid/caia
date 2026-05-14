/**
 * APP.2 / A.10.2 — pre-train corpus-quality gate.
 *
 * Read the corpus manifest produced by `apprentice-corpus` and decide whether
 * the retrainer should proceed or skip with a clean `gated-pending-quality`
 * outcome. The gate fires *before* training so the Saturday 02:00 cron does
 * not burn M3 cycles on an obviously-underqualified corpus.
 *
 * Histogram → average: weighted-mean over fixed 0.2-wide bins; bin midpoints
 * are 0.1 / 0.3 / 0.5 / 0.7 / 0.9. Empty histogram → 0.
 */
import type { FsAccess } from './types.js';

/** Subset of CorpusManifest shape we need; kept structurally typed to avoid
 *  a build-time dep on `@chiefaia/apprentice-corpus`. */
export interface CorpusManifestLike {
  totals?: { final?: number };
  qualityHistogram?: Record<string, number>;
}

export interface QualityGateInput {
  manifest: CorpusManifestLike;
  qualityFloorAvg: number;
  qualityFloorCount: number;
}

export interface QualityGateDecision {
  pass: boolean;
  avg: number;
  count: number;
  /** Empty when pass=true; human-readable cause when pass=false. */
  reason: string;
}

const BIN_MIDPOINTS: Record<string, number> = {
  '0.0-0.2': 0.1,
  '0.2-0.4': 0.3,
  '0.4-0.6': 0.5,
  '0.6-0.8': 0.7,
  '0.8-1.0': 0.9
};

export function averageQualityFromHistogram(
  histogram: Record<string, number> | undefined
): number {
  if (histogram === undefined) return 0;
  let weightedSum = 0;
  let total = 0;
  for (const [bin, count] of Object.entries(histogram)) {
    const mid = BIN_MIDPOINTS[bin];
    if (mid === undefined) continue;
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) continue;
    weightedSum += mid * n;
    total += n;
  }
  return total === 0 ? 0 : weightedSum / total;
}

export function decideQualityGate(input: QualityGateInput): QualityGateDecision {
  const count = input.manifest.totals?.final ?? 0;
  const avg = averageQualityFromHistogram(input.manifest.qualityHistogram);
  const lowAvg = avg < input.qualityFloorAvg;
  const lowCount = count < input.qualityFloorCount;
  if (!lowAvg && !lowCount) {
    return { pass: true, avg, count, reason: '' };
  }
  const reasons: string[] = [];
  if (lowAvg) reasons.push(`avg=${avg.toFixed(3)} < floor=${input.qualityFloorAvg}`);
  if (lowCount) reasons.push(`count=${count} < floor=${input.qualityFloorCount}`);
  return { pass: false, avg, count, reason: reasons.join('; ') };
}

export interface AuditAppendOptions {
  fs: FsAccess;
  auditPath: string;
  /** Already-stringified JSONL row, NO trailing newline. */
  jsonRow: string;
}

/**
 * Append a single JSONL row to the audit log. Creates parent dirs as needed.
 * Append-only — never reads or truncates the existing file.
 */
export function appendAuditRow(opts: AuditAppendOptions): void {
  const parentSep = opts.auditPath.lastIndexOf('/');
  if (parentSep > 0) {
    const dir = opts.auditPath.slice(0, parentSep);
    if (!opts.fs.exists(dir)) opts.fs.mkdir(dir);
  }
  const line = opts.jsonRow + '\n';
  if (opts.fs.appendFile !== undefined) {
    opts.fs.appendFile(opts.auditPath, line);
    return;
  }
  const existing = opts.fs.exists(opts.auditPath) ? opts.fs.readFile(opts.auditPath) : '';
  opts.fs.writeFile(opts.auditPath, existing + line);
}
