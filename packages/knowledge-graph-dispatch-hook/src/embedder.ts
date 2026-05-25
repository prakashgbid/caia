/**
 * @caia/knowledge-graph-dispatch-hook — KG semantic search wrapper.
 *
 * Thin, opinionated adapter over `@chiefaia/architecture-registry`'s
 * `archSearch`. Adds three things on top of the raw archSearch:
 *
 *   1. **Kind normalisation** — collapses the AKG's 12 ArtifactKinds into
 *      the 5 logical buckets the preamble understands: adr / principle /
 *      lesson / feedback / other. Principle/lesson/feedback are
 *      recognised either by `kind=adr` + tag (until the AKG schema gains
 *      first-class kinds in spec task T06) OR by future first-class
 *      kinds when they ship. Forward-compatible.
 *
 *   2. **Slot-rolling kind mix** — caller asks for a {adr:3, principle:1,
 *      lesson:1, feedback:1} mix; if a kind underflows, the slot rolls
 *      into the next kind in priority order so total `topK` is
 *      preserved. Avoids holes in the preamble.
 *
 *   3. **Fallback path** — if the embedder is unavailable (Ollama down,
 *      model not pulled), retries as sparse-only and annotates
 *      `fallbackUsed: 'sparse-only'` on the result. Spec line 282-283:
 *      "Embedder unavailable: caught + falls through to sparse-only".
 *
 * The DB handle + embedder are owned by the caller. This module is pure
 * and easily testable; the integration test passes a real
 * better-sqlite3 + StubEmbeddingClient pair.
 */

import {
  archSearch,
  type ArchSearchHit,
  type ArchSearchOpts,
  type ArchSearchResult,
  type ArtifactKind,
  EmbedderUnavailableError,
  type EmbeddingClient,
} from '@chiefaia/architecture-registry';
import type Database from 'better-sqlite3';

import type {
  KindMix,
  RetrievedArtifact,
} from './types.js';

/**
 * The kind-normalisation table. Keys are AKG `ArtifactKind` values;
 * values are the bucket the preamble lives in.
 *
 * The AKG today exposes `'adr'` but not `'principle'|'lesson'|'feedback'`.
 * Until spec task T06 adds them, principle/lesson/feedback rows are
 * stored as `kind='adr'` with a discriminating tag in `tags[]`. We honour
 * both: a hit whose `kind` lookup returns 'other' is reclassified into
 * 'principle'|'lesson'|'feedback' if its tags include the matching tag.
 *
 * Note: the AKG ArtifactKind enum may add new kinds in future PRs. Any
 * unknown kind falls through to 'other' — never throws.
 */
const KIND_BUCKETS: Readonly<Record<ArtifactKind | string, RetrievedArtifact['kind']>> = {
  adr: 'adr',
  // First-class kinds promoted by T06 — declared here as strings so a
  // future ArtifactKind extension is recognised without touching this file.
  principle: 'principle',
  lesson: 'lesson',
  feedback: 'feedback',
};

const TAG_BUCKETS: ReadonlyArray<readonly [string, RetrievedArtifact['kind']]> = [
  ['feedback', 'feedback'],
  ['lesson', 'lesson'],
  ['principle', 'principle'],
];

/**
 * Default per-kind mix. Spec line 676:
 *   "result mix = 3 ADRs + 1 principle + 1 lesson by default"
 * We also reserve a feedback slot (Layer 3 preamble has "Recent
 * feedback memories" as the fourth section, line 670). topK defaults to
 * 6 to fit the mix; callers passing topK=5 (spec default) drop the
 * feedback slot.
 */
export const DEFAULT_KIND_MIX: Required<KindMix> = Object.freeze({
  adr: 3,
  principle: 1,
  lesson: 1,
  feedback: 1,
  other: 0,
});

/** Priority order used by the slot-rolling allocator. */
const KIND_PRIORITY: ReadonlyArray<RetrievedArtifact['kind']> = [
  'adr',
  'principle',
  'lesson',
  'feedback',
  'other',
];

/**
 * Inputs to `retrieveContext`. The caller owns the DB and embedder
 * lifecycle.
 */
export interface RetrieveDeps {
  db: Database.Database;
  embedder: EmbeddingClient;
}

export interface RetrieveOpts {
  /** Total cap across all kinds. Default 6 (sum of DEFAULT_KIND_MIX). */
  topK?: number;
  /** Cosine threshold floor. Default 0.6. */
  threshold?: number;
  /** Per-kind slot allocation; underflow rolls forward. */
  kindMix?: KindMix;
  /** Force one retriever side. */
  sparseOnly?: boolean;
  denseOnly?: boolean;
  /** Optional project / domain filters passed through to archSearch. */
  projects?: ReadonlyArray<string>;
  techSubDomains?: ReadonlyArray<string>;
}

export interface RetrieveResult {
  artifacts: RetrievedArtifact[];
  /** Raw archSearch result for debugging / telemetry. */
  raw: ArchSearchResult;
  /** True if we fell back to sparse-only because the embedder was unavailable. */
  fallbackUsedSparseOnly: boolean;
  /** Total tokens spent on embedding (0 in sparse-only fallback). */
  embedderTokens: number;
  latencyMs: number;
}

/**
 * Run an AKG semantic search for `query`, normalise + allocate hits per
 * the kind mix, and return the picked artifacts. Pure-ish: only side
 * effects are the DB read + embedder call.
 */
export async function retrieveContext(
  query: string,
  deps: RetrieveDeps,
  opts: RetrieveOpts = {},
): Promise<RetrieveResult> {
  const t0 = Date.now();
  const mix = mergeKindMix(opts.kindMix);
  const topK = opts.topK ?? sumMix(mix);
  const threshold = opts.threshold ?? 0.6;

  // Ask the AKG for plenty of headroom so the allocator has options.
  // 3x the mix's largest bucket is a comfortable floor.
  const innerK = Math.max(topK * 3, 12);

  const searchOpts: ArchSearchOpts = {
    topK: innerK,
    minScore: threshold,
  };
  if (opts.sparseOnly) searchOpts.sparseOnly = true;
  if (opts.denseOnly) searchOpts.denseOnly = true;
  if (opts.projects && opts.projects.length > 0) {
    searchOpts.projects = opts.projects;
  }
  if (opts.techSubDomains && opts.techSubDomains.length > 0) {
    searchOpts.techSubDomains = opts.techSubDomains;
  }

  let raw: ArchSearchResult;
  let fallbackUsedSparseOnly = false;

  try {
    raw = await archSearch(query, searchOpts, deps);
  } catch (err) {
    if (err instanceof EmbedderUnavailableError && !searchOpts.sparseOnly) {
      // Retry as sparse-only.
      fallbackUsedSparseOnly = true;
      raw = await archSearch(
        query,
        { ...searchOpts, sparseOnly: true, denseOnly: false },
        deps,
      );
    } else {
      throw err;
    }
  }

  const allocated = allocateByKindMix(raw.hits, mix, topK);

  return {
    artifacts: allocated,
    raw,
    fallbackUsedSparseOnly,
    embedderTokens: raw.embedderTokens,
    latencyMs: Date.now() - t0,
  };
}

/**
 * Merge a caller-supplied mix with the defaults; unspecified buckets
 * inherit `DEFAULT_KIND_MIX`. Caller can zero out a bucket by passing
 * `{ feedback: 0 }`.
 */
export function mergeKindMix(input?: KindMix): Required<KindMix> {
  return {
    adr: input?.adr ?? DEFAULT_KIND_MIX.adr,
    principle: input?.principle ?? DEFAULT_KIND_MIX.principle,
    lesson: input?.lesson ?? DEFAULT_KIND_MIX.lesson,
    feedback: input?.feedback ?? DEFAULT_KIND_MIX.feedback,
    other: input?.other ?? DEFAULT_KIND_MIX.other,
  };
}

export function sumMix(mix: Required<KindMix>): number {
  return mix.adr + mix.principle + mix.lesson + mix.feedback + mix.other;
}

/**
 * Walk the ranked hits, bucketing by normalised kind, then allocate
 * per the mix with slot-rolling. Guarantees:
 *   - returns at most `topK` artifacts
 *   - never returns the same id twice
 *   - preserves rank order within each kind
 *   - kind-order in the output follows KIND_PRIORITY (adr → other)
 */
export function allocateByKindMix(
  hits: ReadonlyArray<ArchSearchHit>,
  mix: Required<KindMix>,
  topK: number,
): RetrievedArtifact[] {
  const buckets: Record<RetrievedArtifact['kind'], RetrievedArtifact[]> = {
    adr: [],
    principle: [],
    lesson: [],
    feedback: [],
    other: [],
  };

  for (const hit of hits) {
    const artifact = normaliseHit(hit);
    buckets[artifact.kind].push(artifact);
  }

  const out: RetrievedArtifact[] = [];
  const seenIds = new Set<string>();
  const remaining: Record<RetrievedArtifact['kind'], number> = {
    adr: mix.adr,
    principle: mix.principle,
    lesson: mix.lesson,
    feedback: mix.feedback,
    other: mix.other,
  };

  // Pass 1: allocate exactly the mix per kind.
  for (const kind of KIND_PRIORITY) {
    const bucket = buckets[kind];
    const slot = remaining[kind];
    for (let i = 0; i < bucket.length && i < slot; i++) {
      const a = bucket[i]!;
      if (seenIds.has(a.id)) continue;
      seenIds.add(a.id);
      out.push(a);
      if (out.length >= topK) return out;
    }
    // Track what we actually took so unfilled slots roll forward.
    const took = Math.min(bucket.length, slot);
    remaining[kind] = slot - took;
  }

  // Pass 2: distribute unfilled slots across remaining hits in priority
  // order. Each iteration takes one hit from the highest-priority kind
  // that still has hits.
  while (out.length < topK) {
    let progressed = false;
    for (const kind of KIND_PRIORITY) {
      const bucket = buckets[kind];
      // Start past whatever Pass 1 already consumed.
      const consumed = out.filter((a) => a.kind === kind).length;
      const candidate = bucket[consumed];
      if (!candidate) continue;
      if (seenIds.has(candidate.id)) continue;
      seenIds.add(candidate.id);
      out.push(candidate);
      progressed = true;
      if (out.length >= topK) break;
    }
    if (!progressed) break;
  }

  return out;
}

/**
 * Map a raw `ArchSearchHit` to a `RetrievedArtifact`. Looks up the kind
 * bucket; if the kind itself doesn't resolve (e.g. AKG `kind=adr`), checks
 * the tags for a more specific bucket (feedback/lesson/principle/etc).
 */
export function normaliseHit(hit: ArchSearchHit): RetrievedArtifact {
  const row = hit.row;
  let kind: RetrievedArtifact['kind'] =
    KIND_BUCKETS[row.kind] ?? 'other';

  if (kind === 'adr' || kind === 'other') {
    // Look for a tag-based reclassification.
    for (const [tag, bucket] of TAG_BUCKETS) {
      if (row.tags.includes(tag)) {
        kind = bucket;
        break;
      }
    }
  }

  const id = deriveId(hit);
  const date = deriveDate(hit);

  const artifact: RetrievedArtifact = {
    kind,
    id,
    title: row.name,
    score: hit.scoreFused,
    raw: hit,
  };
  if (date !== undefined) {
    artifact.date = date;
  }
  return artifact;
}

/**
 * Derive a display id. Preference order:
 *   1. Parse first capture group out of `name` for ADR-style ids
 *      ("ADR-011 Event-first state…" → "ADR-011").
 *   2. Use `row.entryPath` basename minus extension.
 *   3. Fall back to a short prefix of `row.id` (the arch_* internal id).
 */
export function deriveId(hit: ArchSearchHit): string {
  const row = hit.row;
  const idMatch = row.name.match(
    /^(ADR-\d+|P\d+|L\d+|feedback-[a-z0-9-]+)/i,
  );
  if (idMatch?.[1]) return idMatch[1];
  if (row.entryPath) {
    const base = row.entryPath.split('/').pop() ?? row.entryPath;
    return base.replace(/\.[a-z]+$/i, '');
  }
  return row.id;
}

/**
 * Derive an optional date (YYYY-MM-DD). Tries the metadataJson payload
 * (best-effort JSON parse for a `date` or `decisionDate` field) and
 * falls back to a date prefix in the entryPath ("2026-05-24-foo.md").
 */
export function deriveDate(hit: ArchSearchHit): string | undefined {
  const row = hit.row;
  if (row.metadataJson && row.metadataJson !== '{}') {
    try {
      const parsed = JSON.parse(row.metadataJson) as Record<string, unknown>;
      const dec = parsed['decisionDate'];
      const date = parsed['date'];
      if (typeof dec === 'string' && isIsoDate(dec)) return dec.slice(0, 10);
      if (typeof date === 'string' && isIsoDate(date)) return date.slice(0, 10);
    } catch {
      // ignore — metadataJson is best-effort
    }
  }
  if (row.entryPath) {
    const m = row.entryPath.match(/(\d{4}-\d{2}-\d{2})/);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}
