/**
 * Tokenization for the reuse-searcher. Lowercase, strip stop-words, split on
 * non-alphanumerics, light stemming (drop plural-s + common gerund -ing).
 * Pure function — no I/O — so it can be exercised by the unit test suite
 * without any package-index dependency.
 */

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "for", "nor", "so", "yet",
  "of", "to", "in", "on", "at", "by", "with", "as", "is", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "i", "you", "we", "they", "he", "she", "it",
  "that", "this", "these", "those", "there", "here",
  "from", "into", "onto", "over", "under", "about",
  "not", "no", "yes", "if", "then", "else", "than",
  "build", "make", "create", "add", "implement", "ship",
  "use", "using", "used", "need", "needs", "want",
]);

/** Drop trailing -s / -es / -ies / -ing where it's a clean morpheme. */
function lightStem(t: string): string {
  if (t.length <= 3) return t;
  if (t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3);
  if (t.endsWith("es") && (t.endsWith("ses") || t.endsWith("xes") || t.endsWith("zes"))) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) return t.slice(0, -1);
  return t;
}

export function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 1)
    .filter((t) => !STOP_WORDS.has(t))
    .map(lightStem);
  return tokens;
}

/** Build a frequency map (term → count). */
export function termFrequency(tokens: readonly string[]): ReadonlyMap<string, number> {
  const f = new Map<string, number>();
  for (const t of tokens) f.set(t, (f.get(t) ?? 0) + 1);
  return f;
}
