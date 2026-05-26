/**
 * Scoring for candidate packages. Pure function — score(briefTerms, packageRecord) → number.
 *
 * Weights (operator-tunable in the future):
 *   - description-token match × 1.0
 *   - keyword-token match     × 1.5
 *   - export-name-token match × 2.0
 *   - package-name-token match× 2.5  (because "@caia/ui" is the canonical answer to the literal token "ui")
 *
 * Returns a score in [0, ∞). Normalisation to [0, 1] happens at the rank
 * step so multi-batch comparability is preserved.
 */

export interface PackageRecord {
  packageName: string;          // "@caia/ui"
  description: string;          // package.json description
  keywords: readonly string[];  // package.json keywords
  mainExports: readonly string[]; // best-effort list of exported names
  /** Pre-computed token bag for the package — built once at index time. */
  tokens: {
    name: ReadonlySet<string>;
    description: ReadonlySet<string>;
    keywords: ReadonlySet<string>;
    exports: ReadonlySet<string>;
  };
}

export interface ScoreBreakdown {
  total: number;
  byField: { name: number; keywords: number; exports: number; description: number };
  matchedTerms: string[];
}

const WEIGHT = { name: 2.5, keywords: 1.5, exports: 2.0, description: 1.0 } as const;

export function scorePackage(briefTerms: readonly string[], pkg: PackageRecord): ScoreBreakdown {
  const matched = new Set<string>();
  let n = 0;
  let k = 0;
  let e = 0;
  let d = 0;

  for (const t of briefTerms) {
    if (pkg.tokens.name.has(t)) {
      n += WEIGHT.name;
      matched.add(t);
    }
    if (pkg.tokens.keywords.has(t)) {
      k += WEIGHT.keywords;
      matched.add(t);
    }
    if (pkg.tokens.exports.has(t)) {
      e += WEIGHT.exports;
      matched.add(t);
    }
    if (pkg.tokens.description.has(t)) {
      d += WEIGHT.description;
      matched.add(t);
    }
  }

  return {
    total: n + k + e + d,
    byField: { name: n, keywords: k, exports: e, description: d },
    matchedTerms: Array.from(matched).sort(),
  };
}
