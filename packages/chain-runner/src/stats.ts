// H-18 / H-20 (chain-runner-battle-harden phase 10, 2026-05-14). Aggregated
// metrics across chains. Walks every audit.jsonl under ~/.caia/chain/*/ and
// pairs `phase_in_progress` events with their matching `phase_done` /
// `phase_failed` by session_id to produce per-phase runtime + counts.
//
// Outputs:
//   - aggregatePhaseStats(chains?) — programmatic API
//   - renderMarkdown / renderJson — CLI formatters
//   - calibratePhase(stats, phase, p) — H-20 calibration helper
//
// Pairing semantics: a session is the canonical key for an attempt because
// phase_in_progress, phase_done, phase_failed, attempt_started, and
// attempt_completed all carry session_id (per the H-19 registry). When a
// phase_in_progress has no matching phase_done OR phase_failed inside the
// same audit.jsonl, the session is treated as "in-flight" and only counted
// in the in_flight column — not in p50/p95 runtime.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface PhaseStatsRow {
  /** Stable id: e.g. "chain-id:phase-id" when chains are joined, else just phase_id. */
  key: string;
  chainId: string;
  phaseId: number;
  /** Successful runs (phase_done seen). */
  successCount: number;
  /** Failed runs (phase_failed seen). */
  failureCount: number;
  /** In-flight attempts (phase_in_progress with no matching done/failed). */
  inFlightCount: number;
  /** All matched durations in seconds (sorted ascending). */
  durationsSec: number[];
  /** Per-failure-class histogram (from phase_failed `class` / fallback `reason`). */
  failureClasses: Record<string, number>;
  /** Min / max / p50 / p95 / mean of successful durations. */
  minSec: number | null;
  maxSec: number | null;
  p50Sec: number | null;
  p95Sec: number | null;
  meanSec: number | null;
  /** Earliest and latest event timestamps seen in this row (ISO). */
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface AggregateResult {
  rows: PhaseStatsRow[];
  /** Chains that contributed data (any audit.jsonl read). */
  chainsRead: string[];
  /** Chains skipped because no audit.jsonl. */
  chainsMissingAudit: string[];
  /** Total events processed across all chains. */
  eventsParsed: number;
  /** Events skipped (malformed JSON). */
  eventsSkipped: number;
  /** Generated-at ISO timestamp. */
  generatedAt: string;
}

export interface AggregateOptions {
  /** Restrict to these chain ids. Empty / undefined = all chains under chainRoot. */
  chains?: string[];
  /** Restrict to a specific phase name (case-sensitive). */
  phaseName?: string;
  /** Drop events with ts < sinceIso (lexical ISO compare). */
  sinceIso?: string;
  /** Override chain root (defaults to $CAIA_CHAIN_HOME or ~/.caia/chain). */
  chainRoot?: string;
}

/** Resolve the chain root, honoring the CAIA_CHAIN_HOME env override. */
export function defaultChainRoot(): string {
  return process.env['CAIA_CHAIN_HOME'] ?? join(homedir(), '.caia', 'chain');
}

/**
 * Walk audit.jsonl and pair phase_in_progress with phase_done / phase_failed
 * keyed by session_id. Returns one row per (chainId, phaseId) seen.
 */
export function aggregatePhaseStats(opts: AggregateOptions = {}): AggregateResult {
  const root = opts.chainRoot ?? defaultChainRoot();
  const generatedAt = new Date().toISOString();
  const result: AggregateResult = {
    rows: [],
    chainsRead: [],
    chainsMissingAudit: [],
    eventsParsed: 0,
    eventsSkipped: 0,
    generatedAt,
  };

  let chainDirs: string[];
  if (opts.chains && opts.chains.length > 0) {
    chainDirs = opts.chains.map((c) => join(root, c));
  } else {
    if (!existsSync(root)) return result;
    try {
      chainDirs = readdirSync(root)
        .map((e) => join(root, e))
        .filter((p) => {
          try {
            return statSync(p).isDirectory();
          } catch {
            return false;
          }
        });
    } catch {
      return result;
    }
  }

  // map: chainId -> phaseId -> per-session phase_in_progress markers
  type RowKey = string; // `${chainId}::${phaseId}`
  const rowsByKey = new Map<RowKey, PhaseStatsRow>();
  const ensureRow = (chainId: string, phaseId: number): PhaseStatsRow => {
    const k = `${chainId}::${phaseId}`;
    let r = rowsByKey.get(k);
    if (!r) {
      r = {
        key: k,
        chainId,
        phaseId,
        successCount: 0,
        failureCount: 0,
        inFlightCount: 0,
        durationsSec: [],
        failureClasses: {},
        minSec: null,
        maxSec: null,
        p50Sec: null,
        p95Sec: null,
        meanSec: null,
        firstSeen: null,
        lastSeen: null,
      };
      rowsByKey.set(k, r);
    }
    return r;
  };

  for (const chainDir of chainDirs) {
    const chainId = chainDir.split('/').pop() ?? chainDir;
    const auditFile = join(chainDir, 'audit.jsonl');
    if (!existsSync(auditFile)) {
      result.chainsMissingAudit.push(chainId);
      continue;
    }
    result.chainsRead.push(chainId);
    let raw: string;
    try {
      raw = readFileSync(auditFile, 'utf8');
    } catch {
      result.chainsMissingAudit.push(chainId);
      continue;
    }

    // Two-pass scan: first collect phase_in_progress markers by session_id;
    // second pass match phase_done / phase_failed.
    const markers = new Map<string, { phaseId: number; ts: string; attempt?: number }>();
    const lines = raw.split('\n');
    const events: Array<{
      event: string;
      ts: string;
      payload: Record<string, unknown>;
    }> = [];
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(s) as Record<string, unknown>;
      } catch {
        result.eventsSkipped += 1;
        continue;
      }
      result.eventsParsed += 1;
      const event = obj['event'];
      const ts = obj['ts'];
      if (typeof event !== 'string' || typeof ts !== 'string') continue;
      if (opts.sinceIso && ts < opts.sinceIso) continue;
      events.push({ event, ts, payload: obj });
    }

    for (const e of events) {
      if (e.event === 'phase_in_progress') {
        const sid = e.payload['session_id'];
        const pid = e.payload['phase_id'];
        if (typeof sid !== 'string' || typeof pid !== 'number') continue;
        const attempt =
          typeof e.payload['attempt'] === 'number'
            ? (e.payload['attempt'] as number)
            : undefined;
        const marker: { phaseId: number; ts: string; attempt?: number } = {
          phaseId: pid,
          ts: e.ts,
        };
        if (attempt !== undefined) marker.attempt = attempt;
        markers.set(sid, marker);
      }
    }

    for (const e of events) {
      const phaseId =
        typeof e.payload['phase_id'] === 'number'
          ? (e.payload['phase_id'] as number)
          : null;
      if (e.event === 'phase_done' && phaseId !== null) {
        const row = ensureRow(chainId, phaseId);
        bumpSeen(row, e.ts);
        // Lookup paired marker via session_id, falling back to scanning markers
        // by phaseId (some legacy phase_done lines omit session_id).
        const sid = e.payload['session_id'];
        let startTs: string | null = null;
        if (typeof sid === 'string' && markers.has(sid)) {
          startTs = markers.get(sid)!.ts;
          markers.delete(sid);
        } else {
          // Fall back: find the most recent unmatched marker for this phase.
          const sessionId = findRecentMarkerForPhase(markers, phaseId, e.ts);
          if (sessionId) {
            startTs = markers.get(sessionId)!.ts;
            markers.delete(sessionId);
          }
        }
        if (startTs) {
          const durationSec = Math.max(
            0,
            (new Date(e.ts).getTime() - new Date(startTs).getTime()) / 1000,
          );
          row.durationsSec.push(durationSec);
        }
        row.successCount += 1;
      } else if (e.event === 'phase_failed' && phaseId !== null) {
        const row = ensureRow(chainId, phaseId);
        bumpSeen(row, e.ts);
        const reason =
          (typeof e.payload['reason'] === 'string'
            ? (e.payload['reason'] as string)
            : '') || 'unknown';
        const klass =
          typeof e.payload['class'] === 'string'
            ? (e.payload['class'] as string)
            : classifyFromReason(reason);
        row.failureClasses[klass] = (row.failureClasses[klass] ?? 0) + 1;
        row.failureCount += 1;
        // Also consume the session marker if present so it doesn't count as
        // in-flight.
        const sid = e.payload['session_id'];
        if (typeof sid === 'string' && markers.has(sid)) markers.delete(sid);
      } else if (e.event === 'phase_in_progress' && phaseId !== null) {
        // Marker already recorded above; bump seen for ordering.
        const row = ensureRow(chainId, phaseId);
        bumpSeen(row, e.ts);
      }
    }

    // Any markers still in the map are in-flight (or orphaned).
    for (const [, marker] of markers) {
      const row = ensureRow(chainId, marker.phaseId);
      row.inFlightCount += 1;
    }
  }

  // Compute percentile stats per row + apply phaseName filter (if given,
  // requires a spec lookup — defer to caller for now: phaseName is matched
  // textually against a per-row label appended by the CLI).
  for (const row of rowsByKey.values()) {
    if (row.durationsSec.length > 0) {
      row.durationsSec.sort((a, b) => a - b);
      row.minSec = row.durationsSec[0]!;
      row.maxSec = row.durationsSec[row.durationsSec.length - 1]!;
      row.p50Sec = percentile(row.durationsSec, 50);
      row.p95Sec = percentile(row.durationsSec, 95);
      row.meanSec =
        row.durationsSec.reduce((a, b) => a + b, 0) / row.durationsSec.length;
    }
  }

  result.rows = [...rowsByKey.values()].sort((a, b) => {
    if (a.chainId !== b.chainId) return a.chainId.localeCompare(b.chainId);
    return a.phaseId - b.phaseId;
  });
  return result;
}

function bumpSeen(row: PhaseStatsRow, ts: string): void {
  if (row.firstSeen === null || ts < row.firstSeen) row.firstSeen = ts;
  if (row.lastSeen === null || ts > row.lastSeen) row.lastSeen = ts;
}

function findRecentMarkerForPhase(
  markers: Map<string, { phaseId: number; ts: string }>,
  phaseId: number,
  beforeTs: string,
): string | null {
  let best: string | null = null;
  let bestTs: string | null = null;
  for (const [sid, m] of markers) {
    if (m.phaseId !== phaseId) continue;
    if (m.ts > beforeTs) continue;
    if (bestTs === null || m.ts > bestTs) {
      bestTs = m.ts;
      best = sid;
    }
  }
  return best;
}

/**
 * Linear-interpolation percentile (R-7), matching numpy default. Input must
 * be sorted ascending. Returns null for empty input.
 */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const idx = ((p / 100) * (sorted.length - 1));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! + frac * (sorted[hi]! - sorted[lo]!);
}

function classifyFromReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('rate') && r.includes('limit')) return 'rate_limit';
  if (r.includes('auth')) return 'auth_failure';
  if (r.includes('runtime_exceeded')) return 'runtime_exceeded';
  if (r.includes('hung')) return 'worker_hung_post_success';
  return 'unknown';
}

// ---- Renderers ----

export function renderMarkdown(agg: AggregateResult): string {
  const lines: string[] = [];
  lines.push(`# chain-runner phase stats`);
  lines.push('');
  lines.push(`generated_at: ${agg.generatedAt}`);
  lines.push(`chains_read: ${agg.chainsRead.length} (${agg.chainsRead.join(', ') || '-'})`);
  if (agg.chainsMissingAudit.length > 0) {
    lines.push(`chains_missing_audit: ${agg.chainsMissingAudit.join(', ')}`);
  }
  lines.push(`events_parsed: ${agg.eventsParsed}  events_skipped: ${agg.eventsSkipped}`);
  lines.push('');
  if (agg.rows.length === 0) {
    lines.push('_(no phase data)_');
    return lines.join('\n');
  }
  lines.push(
    '| chain | phase | success | fail | in-flight | p50_sec | p95_sec | max_sec | mean_sec | failure_classes |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of agg.rows) {
    const fc =
      Object.entries(r.failureClasses)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ') || '-';
    lines.push(
      `| ${r.chainId} | ${r.phaseId} | ${r.successCount} | ${r.failureCount} | ${r.inFlightCount} | ${fmt(r.p50Sec)} | ${fmt(r.p95Sec)} | ${fmt(r.maxSec)} | ${fmt(r.meanSec)} | ${fc} |`,
    );
  }
  return lines.join('\n');
}

export function renderJson(agg: AggregateResult): string {
  return JSON.stringify(agg, null, 2);
}

function fmt(n: number | null): string {
  if (n === null) return '-';
  if (n < 10) return n.toFixed(2);
  return Math.round(n).toString();
}

// ---- H-20 calibration ----

export interface CalibrationResult {
  chainId: string | null;
  phaseId: number | null;
  phaseName: string;
  /** percentile used (default 95). */
  p: number;
  /** Observation count across matching rows. */
  observations: number;
  /** p_pct in seconds across the merged successful durations. */
  pSec: number | null;
  /** Same, in minutes (ceil). */
  pMin: number | null;
  /** Suggested max_minutes — 1.5x the p value, ceiling. Null if no data. */
  suggestedMaxMinutes: number | null;
  /** Free-form rationale string. */
  rationale: string;
  /** Underlying rows considered. */
  rows: PhaseStatsRow[];
}

export interface CalibrationOptions {
  /** Restrict to specific chain id; defaults to all. */
  chainId?: string;
  /** Percentile (1–99); default 95. */
  p?: number;
  /** Multiplier applied to the p_sec → max_minutes recommendation; default 1.5. */
  multiplier?: number;
  /** Override chain root for tests. */
  chainRoot?: string;
}

/**
 * Recommend a max_minutes cap for a phase given empirical data. The
 * `phaseName` argument is the YAML phase name; we match it to rows by their
 * `phaseId` when a spec resolver is provided OR by literal numeric id when
 * the user passed an integer. The simpler integer form is used by the CLI.
 *
 * Strategy: collect all matching rows' successful durations, take the
 * requested percentile, multiply by `multiplier` (default 1.5x for slack),
 * and ceiling to the nearest minute. Returns null when no successful runs
 * are seen — the operator should keep the YAML's current value.
 */
export function calibratePhase(
  phaseSelector: number | string,
  opts: CalibrationOptions = {},
): CalibrationResult {
  const p = opts.p ?? 95;
  const multiplier = opts.multiplier ?? 1.5;
  const aggOpts: AggregateOptions = {};
  if (opts.chainId) aggOpts.chains = [opts.chainId];
  if (opts.chainRoot) aggOpts.chainRoot = opts.chainRoot;
  const agg = aggregatePhaseStats(aggOpts);

  const matchRows = agg.rows.filter((r) => {
    if (typeof phaseSelector === 'number') return r.phaseId === phaseSelector;
    return String(r.phaseId) === phaseSelector;
  });

  const merged = matchRows.flatMap((r) => r.durationsSec).sort((a, b) => a - b);
  const observations = merged.length;
  const pSec = percentile(merged, p);
  const pMin = pSec === null ? null : Math.ceil(pSec / 60);
  const suggestedMaxMinutes =
    pSec === null ? null : Math.max(5, Math.ceil((pSec * multiplier) / 60));

  let rationale: string;
  if (pSec === null) {
    rationale =
      `No successful runs observed for phase ${phaseSelector} across ${agg.chainsRead.length} chains; ` +
      `keep the YAML's current max_minutes.`;
  } else {
    rationale =
      `Observed p${p}=${pSec.toFixed(1)}s (${pMin} min) across ${observations} successful runs in ` +
      `chains [${matchRows.map((r) => r.chainId).join(', ')}]. ` +
      `Recommended max_minutes = ceil(${p}p × ${multiplier} / 60) = ${suggestedMaxMinutes} min.`;
  }

  return {
    chainId: opts.chainId ?? null,
    phaseId: typeof phaseSelector === 'number' ? phaseSelector : Number(phaseSelector) || null,
    phaseName: String(phaseSelector),
    p,
    observations,
    pSec,
    pMin,
    suggestedMaxMinutes,
    rationale,
    rows: matchRows,
  };
}

export function renderCalibration(r: CalibrationResult): string {
  const lines: string[] = [];
  lines.push(`# calibrate phase=${r.phaseName} p=${r.p}`);
  lines.push(`observations: ${r.observations}`);
  lines.push(`p${r.p}_sec:        ${r.pSec === null ? '-' : r.pSec.toFixed(1)}`);
  lines.push(`p${r.p}_min:        ${r.pMin ?? '-'}`);
  lines.push(`suggested_max_minutes: ${r.suggestedMaxMinutes ?? '-'}`);
  lines.push('');
  lines.push(r.rationale);
  return lines.join('\n');
}
