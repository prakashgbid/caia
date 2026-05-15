// Stage 3 — token-importance prune.
//
// LLMLingua-2 inspired. The design doc §5.3 calls for a question-conditioned
// causal LM scoring tokens by perplexity, then greedily pruning to a target
// ratio with per-segment budget weighting.
//
// v1 has two scoring backends:
//   1. router-log-probabilities — if the local-llm-router exposes a
//      `/v1/score-tokens` endpoint that returns per-token log-probability
//      under qwen2.5-coder:7b conditioned on the question, we use that.
//      This is the LLMLingua-2 path. As of LAI phase 6, the router does
//      NOT expose this endpoint (a 404 is the expected response). We
//      intentionally keep the call so a future router upgrade can light it
//      up without a stage3 change — but a 404 is treated as "endpoint not
//      implemented" and silently falls through to backend (2) without
//      surfacing an error to the caller. Any other failure (5xx, network,
//      timeout, malformed JSON) is still surfaced via `error` for ops.
//   2. heuristic — TF-IDF-style score against the user question. Matches
//      Headroom's approach (ModernBERT-style token-importance, no log-probs).
//      Documented as the LLMLingua-2 paper's own ablation baseline
//      ("BM25-keep") — captures ~70% of the LLMLingua-2 quality gain on
//      the paper's eval.
//
// Both backends respect Stage 1's `«protected:…»` markers — tokens inside
// a protected span are force-kept regardless of score.
//
// Phase 5 of the Local-AI-First build chain (404-fallback hardened in phase 6).
//
// A.9.4 (2026-05-14) — Stage 3 was burning one HTTP roundtrip per call on
// every request to discover the router /v1/score-tokens endpoint is missing
// (404). At ~50ms per Stage 3 invocation that compounds across the live
// traffic Stage 3 is now seeing post-Phase α wiring. We now memoize the
// 404 outcome per routerBaseUrl with a TTL so subsequent calls skip the
// roundtrip entirely; the router-upgrade path is unchanged — on TTL
// expiry the next call will probe again and pick up the endpoint if it
// has become available.

import { findProtectedRanges, isIndexProtected } from './stage1.js';
import { estimateTokens } from './types.js';

export interface Stage3Options {
  targetRatio?: number; // 0.5 = keep 50%
  routerBaseUrl?: string;
  model?: string;
  timeoutMs?: number;
  // Below this prompt token count, skip Stage 3 (overhead > savings).
  minTokensToPrune?: number;
  // Force the heuristic backend even if the router endpoint exists.
  // Tests use this to make the algorithm deterministic.
  forceHeuristic?: boolean;
  // Injectable fetch for tests.
  fetchImpl?: typeof fetch;
}

export interface PromptSegment {
  kind: 'system' | 'recent-reasoning' | 'tool-output' | 'old-tool-output' | 'user-question';
  text: string;
  // Per-segment budget weight (0 = never prune, 1 = prune aggressively).
  weight: number;
}

export interface Stage3Result {
  text: string;
  tokensIn: number;
  tokensOut: number;
  wallMs: number;
  backend: 'router' | 'heuristic' | 'skipped';
  error?: string | undefined;
}

const DEFAULTS: Required<Omit<Stage3Options, 'fetchImpl' | 'forceHeuristic'>> = {
  targetRatio: 0.5,
  routerBaseUrl: 'http://127.0.0.1:7411',
  model: 'qwen2.5-coder:7b',
  timeoutMs: 12000,
  minTokensToPrune: 500,
};

// ─── Missing-endpoint memo (A.9.4) ────────────────────────────────────
//
// Cache per routerBaseUrl: the first call to score this URL via
// /v1/score-tokens that returns 404 records the timestamp. Subsequent
// calls within the TTL skip the roundtrip and go straight to heuristic.
//
// Overridable via env STAGE3_ROUTER_404_TTL_MS (default 1 h). Tests
// reset the memo via `__resetRouter404Memo`.
const ROUTER_404_TTL_MS = parseInt(
  process.env['STAGE3_ROUTER_404_TTL_MS'] ?? '3600000',
  10,
);
const router404Memo = new Map<string, number>();

/** Internal: reset the per-baseUrl 404 cache. Test-only seam. */
export function __resetRouter404Memo(): void {
  router404Memo.clear();
}

function memoKnown404(baseUrl: string): boolean {
  const ts = router404Memo.get(baseUrl);
  if (ts === undefined) return false;
  if (Date.now() - ts > ROUTER_404_TTL_MS) {
    router404Memo.delete(baseUrl);
    return false;
  }
  return true;
}

function recordRouter404(baseUrl: string): void {
  router404Memo.set(baseUrl, Date.now());
}

// Default per-segment weights from the design doc §5.3.
export const DEFAULT_SEGMENT_WEIGHTS: Record<PromptSegment['kind'], number> = {
  system: 0,
  'user-question': 0,
  'recent-reasoning': 0.1,
  'tool-output': 0.5,
  'old-tool-output': 1.0,
};

export async function stage3Prune(
  segments: PromptSegment[],
  userQuestion: string,
  opts: Stage3Options = {},
): Promise<Stage3Result> {
  const o = { ...DEFAULTS, ...opts };
  const startedAt = Date.now();
  const fetcher = opts.fetchImpl ?? fetch;

  const totalText = segments.map((s) => s.text).join('\n');
  const tokensIn = estimateTokens(totalText);

  if (tokensIn < o.minTokensToPrune) {
    return {
      text: assemble(segments),
      tokensIn,
      tokensOut: tokensIn,
      wallMs: Date.now() - startedAt,
      backend: 'skipped',
    };
  }

  // Try router first unless forced to heuristic.
  let scoredSegments: Array<{ segment: PromptSegment; scores: number[] }>;
  let backend: 'router' | 'heuristic' = 'heuristic';
  let routerError: string | undefined;

  if (!opts.forceHeuristic) {
    // Skip the HTTP roundtrip if we already know this routerBaseUrl
    // returns 404 for /v1/score-tokens (A.9.4).
    if (memoKnown404(o.routerBaseUrl)) {
      scoredSegments = scoreHeuristic(segments, userQuestion);
    } else {
      try {
        scoredSegments = await scoreViaRouter(segments, userQuestion, o, fetcher);
        backend = 'router';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A 404 from the router means the optional `/v1/score-tokens` endpoint
        // isn't implemented on this build — that's the expected v1 path. Treat
        // it as silent fallback and don't surface it as an error, AND memoize
        // so subsequent calls skip the roundtrip. Any other failure
        // (5xx, network, timeout, shape) is surfaced for ops.
        if (msg === 'router-status-404') {
          recordRouter404(o.routerBaseUrl);
        } else {
          routerError = msg;
        }
        scoredSegments = scoreHeuristic(segments, userQuestion);
      }
    }
  } else {
    scoredSegments = scoreHeuristic(segments, userQuestion);
  }

  const pruned = pruneWithBudget(scoredSegments, o.targetRatio);
  const out = assemble(pruned);

  return {
    text: out,
    tokensIn,
    tokensOut: estimateTokens(out),
    wallMs: Date.now() - startedAt,
    backend,
    error: routerError,
  };
}

// ─── Backend 1: router log-probabilities ──────────────────────────────

async function scoreViaRouter(
  segments: PromptSegment[],
  userQuestion: string,
  opts: Required<Omit<Stage3Options, 'fetchImpl' | 'forceHeuristic'>>,
  fetcher: typeof fetch,
): Promise<Array<{ segment: PromptSegment; scores: number[] }>> {
  const url = `${opts.routerBaseUrl.replace(/\/$/, '')}/v1/score-tokens`;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const resp = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        question: userQuestion,
        segments: segments.map((s) => ({ kind: s.kind, text: s.text })),
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`router-status-${resp.status}`);
    const data = (await resp.json()) as RouterScoreResponse;
    if (!Array.isArray(data?.segments) || data.segments.length !== segments.length) {
      throw new Error('router-score-shape');
    }
    const segs = data.segments;
    return segments.map((segment, i) => {
      const scores = segs[i]?.token_logprobs;
      if (!Array.isArray(scores)) throw new Error('router-score-missing');
      return { segment, scores };
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

interface RouterScoreResponse {
  segments?: Array<{ token_logprobs?: number[] }>;
}

// ─── Backend 2: heuristic TF-IDF-style scoring ────────────────────────

export function scoreHeuristic(
  segments: PromptSegment[],
  userQuestion: string,
): Array<{ segment: PromptSegment; scores: number[] }> {
  const queryTerms = tokenizeForScoring(userQuestion);
  const querySet = new Set(queryTerms);

  // Term frequency across the whole prompt, for document-frequency weighting.
  const docFreq = new Map<string, number>();
  for (const s of segments) {
    for (const tok of tokenizeForScoring(s.text)) {
      docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
    }
  }

  return segments.map((segment) => {
    // We score at the *word* level, then expand to char-level for the
    // pruning algorithm to use.
    const words = segment.text.split(/(\s+)/); // keep separators
    const scores = words.map((w) => {
      if (!w.trim()) return 0; // whitespace
      const norm = w.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!norm) return 0;
      // Higher score = MORE important (keep). LLMLingua-2 uses
      // keep-probability; we replicate that.
      let score = 0;
      // Direct question-term hit.
      if (querySet.has(norm)) score += 3;
      // Substring of a query term (handles plural / inflection cheaply).
      for (const q of querySet) {
        if (q.length > 4 && (norm.includes(q) || q.includes(norm))) {
          score += 1;
          break;
        }
      }
      // Rare-in-doc bonus (TF-IDF-style).
      const df = docFreq.get(norm) ?? 0;
      if (df === 1) score += 0.5;
      else if (df === 2) score += 0.25;
      // Code-shape bonus: identifier-shaped tokens, paths, numbers.
      // Bumped over the design-doc baseline because code/path tokens are
      // disproportionately load-bearing in tool-output blobs (see
      // routing_optimizer_design §5.5).
      if (/[_./]/.test(w)) score += 1.0;
      if (/^\d/.test(w)) score += 0.25;
      return score;
    });
    return { segment, scores };
  });
}

function tokenizeForScoring(s: string): string[] {
  // Lowercase, split on non-alphanum, drop short stopwords.
  const STOPWORDS = new Set([
    'a',
    'an',
    'the',
    'and',
    'or',
    'of',
    'to',
    'in',
    'is',
    'it',
    'this',
    'that',
    'for',
    'on',
    'at',
    'by',
    'with',
    'as',
    'be',
    'are',
    'was',
    'were',
  ]);
  return s
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// ─── Pruning with per-segment budget weights ──────────────────────────

function pruneWithBudget(
  scored: Array<{ segment: PromptSegment; scores: number[] }>,
  targetRatio: number,
): PromptSegment[] {
  return scored.map(({ segment, scores }) => {
    // weight=0 segments are never pruned.
    if (segment.weight === 0) return segment;

    // The effective ratio for this segment combines the global target with
    // the per-segment weight: weight=1.0 → full prune to targetRatio,
    // weight=0.1 → prune only 10% of what global would.
    const effectiveKeep = 1 - segment.weight * (1 - targetRatio);

    return { ...segment, text: pruneSegment(segment.text, scores, effectiveKeep) };
  });
}

// Per-segment pruning at the word level. Lower-scoring words drop first.
// Protected spans always stay.
export function pruneSegment(text: string, scores: number[], keepRatio: number): string {
  const protectedRanges = findProtectedRanges(text);
  const words = text.split(/(\s+)/);

  // Map each word index to its char range in the original text.
  const wordRanges: Array<[number, number]> = [];
  let cursor = 0;
  for (const w of words) {
    wordRanges.push([cursor, cursor + w.length]);
    cursor += w.length;
  }

  if (scores.length !== words.length) {
    // Defensive: scores out of sync; bail out untouched.
    return text;
  }

  // Mark protected words.
  const isProtected = words.map((_w, i) => {
    const range = wordRanges[i];
    if (!range) return false;
    const [start, end] = range;
    for (let j = start; j < end; j++) {
      if (isIndexProtected(j, protectedRanges)) return true;
    }
    return false;
  });

  // Total non-protected, non-whitespace word count and target keep count.
  const candidates: Array<{ idx: number; score: number }> = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const score = scores[i];
    if (word == null || score == null) continue;
    if (!word.trim()) continue; // whitespace
    if (isProtected[i]) continue;
    candidates.push({ idx: i, score });
  }
  const targetKeepFromCandidates = Math.ceil(candidates.length * keepRatio);

  // Sort by score DESC, keep top N.
  candidates.sort((a, b) => b.score - a.score);
  const keepIdxSet = new Set(candidates.slice(0, targetKeepFromCandidates).map((c) => c.idx));

  // Rebuild text, dropping un-kept tokens (preserving structure: drop
  // consecutive dropped words + their separator together to avoid an
  // ugly run of double-spaces).
  const out: string[] = [];
  let lastDropped = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w == null) continue;
    if (!w.trim()) {
      // Whitespace: keep only if previous wasn't dropped.
      if (!lastDropped) out.push(w);
      continue;
    }
    if (isProtected[i] || keepIdxSet.has(i)) {
      out.push(w);
      lastDropped = false;
    } else {
      lastDropped = true;
    }
  }

  // Collapse any consecutive whitespace from dropped tokens.
  return out.join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

// ─── Assembly ─────────────────────────────────────────────────────────

function assemble(segments: PromptSegment[]): string {
  return segments.map((s) => s.text).join('\n');
}
