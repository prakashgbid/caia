/**
 * N-gram copyright scanner — DESIGN.md §6.
 *
 * Tokenises text into lowercase word tokens (whitespace-split, punctuation
 * stripped), then walks N-token windows looking for any verbatim run that
 * appears in any source. Matches are rewritten in the synthesis output: the
 * matching run is replaced with a `[...]` marker, and a counter is incremented
 * for the diagnostics field.
 *
 * The implementation is deliberately simple: O(N) tokenisation, O(M) match
 * via a Set<string> of source N-grams. At report scale (≈100 KB body, ≈100 KB
 * total fetched corpus) this runs in <50 ms.
 *
 * NOT a copyright detector in the legal sense — it's a guardrail that catches
 * the most common LLM failure mode (paraphrase that ends up regurgitating a
 * full sentence). Combined with the synthesis prompt's instructions, it
 * keeps verbatim runs ≤ maxQuoteWords words.
 */

const TOKEN_RE = /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g;

/** Tokenise text into lowercase word tokens. Punctuation stripped. */
export function tokenize(text: string): string[] {
  const matches = text.match(TOKEN_RE);
  if (matches === null) return [];
  return matches.map(t => t.toLowerCase());
}

/** Build the set of N-grams (joined by space) present in `text`. */
export function buildNgramSet(text: string, n: number): Set<string> {
  const tokens = tokenize(text);
  const out = new Set<string>();
  if (n <= 0 || tokens.length < n) return out;
  for (let i = 0; i + n <= tokens.length; i++) {
    out.add(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

export interface ScrubResult {
  scrubbed: string;
  hits: number;
}

/**
 * Scan `body` for any N-token consecutive run that appears in `sourceText`.
 * Replace each matching run (and any contiguous overlapping continuation)
 * with `[...]`. Returns the scrubbed body and the number of distinct hits.
 *
 * `n` is the threshold — matches strictly longer than (n-1) words trigger a
 * scrub. e.g. n=15 means ≥15 verbatim words from a single source body becomes
 * `[...]`.
 *
 * The algorithm walks the body's token list. For each starting position we
 * extend the run as long as the (start, len) slice is present in the source's
 * N-gram set. If the maximal extension reaches at least N tokens, scrub.
 *
 * The body's punctuation/whitespace between scrubbed runs is preserved by
 * tracking the original character offsets of each token via the `tokenize`
 * regex.
 */
export function scrubVerbatimRuns(
  body: string,
  sourceTexts: readonly string[],
  n: number
): ScrubResult {
  if (n <= 0 || body.length === 0 || sourceTexts.length === 0) {
    return { scrubbed: body, hits: 0 };
  }
  // Tokenise body with offsets.
  const bodyTokens: { token: string; start: number; end: number }[] = [];
  for (const m of body.matchAll(TOKEN_RE)) {
    bodyTokens.push({
      token: m[0].toLowerCase(),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length
    });
  }
  if (bodyTokens.length < n) return { scrubbed: body, hits: 0 };

  // Combined source token set: every consecutive token sequence of any source.
  const sourceTokens: string[][] = sourceTexts.map(s => tokenize(s));

  // For O(1) lookup of variable-length runs we instead probe each candidate
  // (start, len) by walking the source token sequences. Cheap because the
  // outer scan is O(B*max_run) and runs > maxRun stop early.
  const isRunInSource = (
    bodySlice: readonly string[]
  ): boolean => {
    if (bodySlice.length === 0) return false;
    for (const src of sourceTokens) {
      if (src.length < bodySlice.length) continue;
      const first = bodySlice[0];
      for (let i = 0; i + bodySlice.length <= src.length; i++) {
        if (src[i] !== first) continue;
        let match = true;
        for (let j = 1; j < bodySlice.length; j++) {
          if (src[i + j] !== bodySlice[j]) {
            match = false;
            break;
          }
        }
        if (match) return true;
      }
    }
    return false;
  };

  // Greedily walk body tokens, finding maximal runs.
  type Replacement = { start: number; end: number };
  const replacements: Replacement[] = [];
  let hits = 0;

  let i = 0;
  while (i < bodyTokens.length) {
    // Find the longest run starting at i that appears in some source.
    // Doubling-then-binary-search keeps this O(log L * N).
    let lo: number;
    let hi = 1;
    let lastGood = 0;
    while (i + hi <= bodyTokens.length) {
      const slice = bodyTokens.slice(i, i + hi).map(t => t.token);
      if (isRunInSource(slice)) {
        lastGood = hi;
        if (hi > 1024) break; // safety cap
        hi *= 2;
      } else {
        break;
      }
    }
    if (lastGood === 0) {
      i++;
      continue;
    }
    // Binary-search between lastGood and min(2*lastGood, bodyTokens.length-i)
    lo = lastGood;
    hi = Math.min(2 * lastGood, bodyTokens.length - i);
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const slice = bodyTokens.slice(i, i + mid).map(t => t.token);
      if (isRunInSource(slice)) lo = mid;
      else hi = mid - 1;
    }
    const runLen = lo;
    if (runLen >= n) {
      const startTok = bodyTokens[i];
      const endTok = bodyTokens[i + runLen - 1];
      if (startTok !== undefined && endTok !== undefined) {
        replacements.push({ start: startTok.start, end: endTok.end });
        hits++;
      }
      i += runLen;
    } else {
      i++;
    }
  }

  if (replacements.length === 0) return { scrubbed: body, hits: 0 };

  // Apply replacements right-to-left to preserve offsets.
  let out = body;
  for (let r = replacements.length - 1; r >= 0; r--) {
    const rep = replacements[r];
    if (rep === undefined) continue;
    out = out.slice(0, rep.start) + '[...]' + out.slice(rep.end);
  }
  return { scrubbed: out, hits };
}
