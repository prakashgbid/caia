/**
 * Leakage guard — detects when an output is verbatim-quoting the system
 * prompt / pre-prompt context.
 *
 * Algorithm: contiguous-token-sequence overlap (≥ minTokens consecutive
 * tokens from corpus appearing verbatim in output) is the primary signal.
 * Trigram cosine is reported informationally but the leak verdict depends
 * on contiguous overlap only, since cosine on length-mismatched strings
 * (a short output vs. a long corpus) is dominated by length, not content.
 *
 * Action is FLAG only — never redact, since legitimate output may rephrase
 * primer content.
 */

export interface LeakageOptions {
  /** Cosine-similarity threshold over character trigrams. Default 0.6. (Reported only; not used to gate the verdict.) */
  threshold?: number;
  /** Minimum contiguous token-overlap window. Default 6. */
  minTokens?: number;
}

export interface LeakageScanResult {
  /** Cosine similarity 0..1 (over trigrams). Informational. */
  similarity: number;
  /** Longest contiguous token-overlap with the corpus (number of tokens). */
  longestOverlap: number;
  /** True iff longestOverlap >= minTokens. */
  leaked: boolean;
}

export function scanLeakage(
  output: string,
  systemPromptCorpus: string,
  opts: LeakageOptions = {},
): LeakageScanResult {
  const minTokens = opts.minTokens ?? 6;
  if (!systemPromptCorpus.trim() || !output.trim()) {
    return { similarity: 0, longestOverlap: 0, leaked: false };
  }
  const similarity = trigramCosine(output, systemPromptCorpus);
  const longestOverlap = longestContiguousOverlap(output, systemPromptCorpus);
  const leaked = longestOverlap >= minTokens;
  return { similarity, longestOverlap, leaked };
}

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function longestContiguousOverlap(a: string, b: string): number {
  const ta = tokenise(a);
  const tb = tokenise(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  // Build a token-set from b, then sliding window in a, longest run that's
  // present (as a contiguous substring) in b.
  const bJoined = ` ${tb.join(' ')} `;
  let longest = 0;
  let i = 0;
  while (i < ta.length) {
    let j = i;
    let run = 0;
    while (j < ta.length) {
      run++;
      const sub = ` ${ta.slice(i, j + 1).join(' ')} `;
      if (bJoined.includes(sub)) {
        if (run > longest) longest = run;
        j++;
      } else {
        break;
      }
    }
    i++;
  }
  return longest;
}

function trigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.toLowerCase();
  for (let i = 0; i + 3 <= t.length; i++) {
    const tri = t.slice(i, i + 3);
    m.set(tri, (m.get(tri) ?? 0) + 1);
  }
  return m;
}

function trigramCosine(a: string, b: string): number {
  const ma = trigrams(a);
  const mb = trigrams(b);
  if (ma.size === 0 || mb.size === 0) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (const [k, v] of ma) {
    aMag += v * v;
    const bv = mb.get(k);
    if (bv) dot += v * bv;
  }
  for (const v of mb.values()) bMag += v * v;
  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}
