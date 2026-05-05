/**
 * Mentor Phase-4 incident clustering.
 *
 * Goal: given the lessons currently in the retrieval index, identify
 * **systemic** failure patterns — distinct from one-offs — so that
 * Phase-4 PR-2 can propose a Steward gatekeeper rule for the patterns
 * that actually recur.
 *
 * Inputs come from the same source-readers + index store that Phase-3
 * already builds. The clustering layer re-uses the persisted
 * `IndexedLesson` rows (kind = 'proposal' for the active incident
 * stream; kind = 'feedback' is excluded from clustering — those are
 * already-distilled lessons, not raw incident events).
 *
 * ## Slug parsing
 *
 * Mentor's `memory-writer` writes proposals under:
 *
 *     <memoryDir>/proposals/<YYYYMMDD>-<HHMMSS>-<classification>-<topic>.md
 *
 * Examples observed in production memoryDir at the start of leg 8:
 *
 *     20260505-051149-unclassified-leg-4-stage-6-verify-test.md
 *     20260505-051240-decisionclassifierviolation-stop-asking-me-...-j.md
 *     20260505-051300-relitigation-we-already-decided-this-in-...-m.md
 *     20260505-155146-prematurecompletion-pr-0-regression-after-merge.md
 *     20260505-155146-prematurecompletion-pr-0-regression-after-merge-2.md
 *     20260505-155146-prematurecompletion-pr-0-regression-after-merge-10.md
 *
 * `parseProposalSlug` extracts (timestamp, classification, topic) and
 * **collapses the trailing `-N` collision-suffix** so all 30+
 * `prematurecompletion-pr-0-regression-after-merge*` entries normalise
 * to the same `topicSlug = 'pr-0-regression-after-merge'`.
 *
 * ## Cluster definition
 *
 * A cluster is the equivalence class of proposals that share both
 * (classification, normalisedTopicSlug). Each cluster carries:
 *
 *   - `occurrenceCount` — total members in the cluster
 *   - `firstSeenMs` / `lastSeenMs` — span of timestamps
 *   - `systemic` — true iff `occurrenceCount >= systemicThreshold`
 *                  (default 3)
 *   - `burst`    — true iff (lastSeenMs - firstSeenMs) <= burstWindowMs
 *                  (default 1 h). Bursts often mean a single root cause
 *                  blew up loudly, not 3 distinct events; PR-2 weights
 *                  them differently.
 *
 * Returned clusters are sorted by `occurrenceCount` desc then by
 * `lastSeenMs` desc (newest first within the same count). Deterministic
 * — every test that asserts ordering can rely on this.
 *
 * ## Design rationale
 *
 * - **Slug-based, not embedding-based.** We considered clustering by
 *   embedding cosine-similarity (already in stack via Phase-3) but the
 *   slug already encodes the dimensions that matter (classification +
 *   target). Embedding-based would need a similarity threshold + a
 *   linkage strategy + tie-breaking; slug-based is reproducible,
 *   auditable, and matches how operators think about "the same
 *   incident". Embedding similarity stays available for retrieval and
 *   future second-pass clustering if slug clustering ever proves too
 *   coarse.
 *
 * - **Pure functions.** No side effects, no DB access. The CLI layer
 *   loads rows from the index store and feeds them in. Tests use plain
 *   in-memory fixtures.
 */

import type { IndexedLesson } from './types.js';

/** Minimum cluster size to flag as systemic. Operator-tunable. */
export const DEFAULT_SYSTEMIC_THRESHOLD = 3;

/**
 * Default burst window: any cluster whose first → last span fits inside
 * this window is flagged as a burst rather than a sustained pattern.
 *
 * 1 hour was chosen because the production observation is: postmerge
 * regression bursts (the 30+ `prematurecompletion-pr-0-regression-...`
 * entries) all clustered within minutes of each other from a single
 * watcher loop. A multi-hour or multi-day spread is the actual
 * "sustained pattern" signal.
 */
export const DEFAULT_BURST_WINDOW_MS = 60 * 60 * 1000;

export interface ProposalMetadata {
  /** Absolute path on disk. */
  sourcePath: string;
  /** Path-derived slug (kept verbatim from the IndexedLesson row). */
  rawSlug: string;
  /** Classification token from the slug (e.g. 'prematurecompletion'). */
  classification: string;
  /**
   * Topic slug AFTER stripping the YYYYMMDD-HHMMSS prefix, the
   * classification token, and the trailing `-N` collision suffix.
   *
   * Example: `prematurecompletion-pr-0-regression-after-merge-10` →
   * `pr-0-regression-after-merge`.
   */
  topicSlug: string;
  /** Parsed timestamp from the filename prefix (UTC ms). */
  timestampMs: number;
}

export interface Cluster {
  classification: string;
  topicSlug: string;
  occurrenceCount: number;
  members: ProposalMetadata[];
  firstSeenMs: number;
  lastSeenMs: number;
  /** occurrenceCount >= systemicThreshold */
  systemic: boolean;
  /** lastSeenMs - firstSeenMs <= burstWindowMs */
  burst: boolean;
}

export interface ClusterOptions {
  /** Default DEFAULT_SYSTEMIC_THRESHOLD. */
  systemicThreshold?: number;
  /** Default DEFAULT_BURST_WINDOW_MS. */
  burstWindowMs?: number;
}

/**
 * Parse a proposal slug into structured metadata.
 *
 * Returns null if the slug doesn't match the expected
 * `YYYYMMDD-HHMMSS-classification-topic` shape. Callers should treat
 * a null return as "this row is not a Mentor-emitted proposal" and
 * skip it for clustering purposes.
 */
export function parseProposalSlug(rawSlug: string): ProposalMetadata | null {
  // Slug format: YYYYMMDD-HHMMSS-<classification>-<topic>
  // Example:     20260505-155146-prematurecompletion-pr-0-regression-after-merge
  //              ^^^^^^^^ ^^^^^^ ^^^^^^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //              date     time   classification      topic (the rest)
  //
  // Trailing `-N` (digits only) is a collision-resolution suffix added
  // when multiple proposals would otherwise overwrite each other —
  // strip it so duplicates collapse into the same topic bucket.
  const match = /^(\d{8})-(\d{6})-([a-z0-9]+)-(.+)$/i.exec(rawSlug);
  if (!match) return null;
  const date = match[1];
  const time = match[2];
  const classification = match[3];
  const rawTopic = match[4];
  if (
    date === undefined ||
    time === undefined ||
    classification === undefined ||
    rawTopic === undefined
  ) {
    return null;
  }

  const timestampMs = parseTimestamp(date, time);
  if (timestampMs === null) return null;

  return {
    sourcePath: '',
    rawSlug,
    classification: classification.toLowerCase(),
    topicSlug: stripCollisionSuffix(rawTopic),
    timestampMs
  };
}

/**
 * Strip the trailing `-N` (digits only) collision suffix that the
 * memory-writer appends when a proposal would otherwise collide with
 * an existing filename.
 *
 * `pr-0-regression-after-merge`     → `pr-0-regression-after-merge`
 * `pr-0-regression-after-merge-2`   → `pr-0-regression-after-merge`
 * `pr-0-regression-after-merge-10`  → `pr-0-regression-after-merge`
 *
 * The function is conservative: a trailing token that contains any
 * non-digit (e.g. `…-merge-v2-final`) is left intact because it could
 * be a legitimate part of the topic.
 *
 * Edge case: `pr-0-...` itself contains a numeric segment; only the
 * **last** `-` boundary is considered, which keeps `pr-0` intact.
 */
export function stripCollisionSuffix(topic: string): string {
  const idx = topic.lastIndexOf('-');
  if (idx <= 0) return topic;
  const tail = topic.slice(idx + 1);
  if (tail.length === 0) return topic;
  if (!/^\d+$/.test(tail)) return topic;
  // Also: only strip if the prefix is non-empty (defensive — shouldn't
  // happen given idx > 0 above).
  const head = topic.slice(0, idx);
  if (head.length === 0) return topic;
  return head;
}

/**
 * Cluster proposal rows by (classification, normalised topicSlug).
 *
 * Non-proposal lessons (kind === 'feedback') are silently skipped —
 * they're distilled lessons, not raw incidents. Rows whose slug
 * doesn't parse are skipped (and surface as zero clusters rather than
 * noise).
 */
export function clusterProposals(
  lessons: IndexedLesson[],
  opts: ClusterOptions = {}
): Cluster[] {
  const systemicThreshold = opts.systemicThreshold ?? DEFAULT_SYSTEMIC_THRESHOLD;
  const burstWindowMs = opts.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS;

  const buckets = new Map<string, Cluster>();

  for (const row of lessons) {
    if (row.kind !== 'proposal') continue;
    const meta = parseProposalSlug(row.slug);
    if (meta === null) continue;
    meta.sourcePath = row.sourcePath;

    const key = `${meta.classification}::${meta.topicSlug}`;
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, {
        classification: meta.classification,
        topicSlug: meta.topicSlug,
        occurrenceCount: 1,
        members: [meta],
        firstSeenMs: meta.timestampMs,
        lastSeenMs: meta.timestampMs,
        systemic: false,
        burst: false
      });
    } else {
      existing.members.push(meta);
      existing.occurrenceCount = existing.members.length;
      if (meta.timestampMs < existing.firstSeenMs) {
        existing.firstSeenMs = meta.timestampMs;
      }
      if (meta.timestampMs > existing.lastSeenMs) {
        existing.lastSeenMs = meta.timestampMs;
      }
    }
  }

  // Finalise systemic + burst flags + member ordering.
  const clusters: Cluster[] = [];
  for (const c of buckets.values()) {
    c.members.sort((a, b) => a.timestampMs - b.timestampMs);
    c.systemic = c.occurrenceCount >= systemicThreshold;
    c.burst = c.lastSeenMs - c.firstSeenMs <= burstWindowMs;
    clusters.push(c);
  }

  // Sort: most occurrences first; then most recent last-seen first;
  // then classification asc; then topicSlug asc — fully deterministic.
  clusters.sort((a, b) => {
    if (a.occurrenceCount !== b.occurrenceCount) {
      return b.occurrenceCount - a.occurrenceCount;
    }
    if (a.lastSeenMs !== b.lastSeenMs) {
      return b.lastSeenMs - a.lastSeenMs;
    }
    if (a.classification !== b.classification) {
      return a.classification.localeCompare(b.classification);
    }
    return a.topicSlug.localeCompare(b.topicSlug);
  });

  return clusters;
}

/**
 * Convenience: filter the cluster list down to systemic ones only.
 * Used by PR-2 (Steward rule proposer) and the CLI.
 */
export function systemicClusters(clusters: Cluster[]): Cluster[] {
  return clusters.filter((c) => c.systemic);
}

/**
 * Parse `YYYYMMDD` + `HHMMSS` strings into UTC ms-since-epoch.
 *
 * The memory-writer emits these in local time, but for ordering
 * purposes the absolute timezone doesn't matter as long as it's
 * consistent. We treat them as UTC; the resulting ordering is correct
 * within any single host (memory-writer + clusterer always run on the
 * same machine).
 */
function parseTimestamp(date: string, time: string): number | null {
  if (date.length !== 8 || time.length !== 6) return null;
  const yyyy = Number(date.slice(0, 4));
  const mm = Number(date.slice(4, 6));
  const dd = Number(date.slice(6, 8));
  const hh = Number(time.slice(0, 2));
  const mi = Number(time.slice(2, 4));
  const ss = Number(time.slice(4, 6));
  if (
    !Number.isFinite(yyyy) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(dd) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mi) ||
    !Number.isFinite(ss)
  ) {
    return null;
  }
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  if (hh > 23 || mi > 59 || ss > 59) return null;
  return Date.UTC(yyyy, mm - 1, dd, hh, mi, ss);
}
