/**
 * Word + heading counters used to enforce the spec's length bounds on
 * the three rendered Markdown documents.
 */

import { ProposalGeneratorError } from '../errors.js';

export interface DocBounds {
  minWords?: number;
  maxWords?: number;
  minH1?: number;
  maxH1?: number;
  minH2?: number;
  maxH2?: number;
}

/** Per-spec bounds. */
export const EXEC_SUMMARY_BOUNDS: DocBounds = { minWords: 50, maxWords: 400 };
/** One-pager ≤ ~320 words at default body font ≈ 1 page. */
export const ONE_PAGER_BOUNDS: DocBounds = { minWords: 40, maxWords: 320 };
/**
 * Full proposal: per spec 10–30 pages. Estimate via word + heading bounds.
 * Word floor ~2,500 (≈ 10 pages × 250 wpp); ceiling ~12,500 (≈ 30 pages).
 * Heading floor ~6 (cover + TOC + 4 sections at minimum).
 */
export const FULL_PROPOSAL_BOUNDS: DocBounds = {
  minWords: 2_500,
  maxWords: 12_500,
  minH1: 1,
  minH2: 4,
};

export function countWords(markdown: string): number {
  if (!markdown) return 0;
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, ' ') // code fences
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ') // links/images
    .replace(/[#>*_~`-]/g, ' ');
  const trimmed = stripped.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

export function countHeadings(markdown: string, level: 1 | 2 | 3 = 1): number {
  if (!markdown) return 0;
  const re = level === 1 ? /^#\s/gm : level === 2 ? /^##\s/gm : /^###\s/gm;
  const matches = markdown.match(re);
  return matches ? matches.length : 0;
}

/**
 * Assert that `markdown` falls within `bounds`. Throws
 * `ProposalGeneratorError('word_count_violation')` on failure with a
 * structured context.
 */
export function assertWithinBounds(label: string, markdown: string, bounds: DocBounds): void {
  const words = countWords(markdown);
  const h1 = countHeadings(markdown, 1);
  const h2 = countHeadings(markdown, 2);

  const violations: string[] = [];
  if (bounds.minWords !== undefined && words < bounds.minWords)
    violations.push(`words < ${bounds.minWords} (got ${words})`);
  if (bounds.maxWords !== undefined && words > bounds.maxWords)
    violations.push(`words > ${bounds.maxWords} (got ${words})`);
  if (bounds.minH1 !== undefined && h1 < bounds.minH1)
    violations.push(`H1 count < ${bounds.minH1} (got ${h1})`);
  if (bounds.maxH1 !== undefined && h1 > bounds.maxH1)
    violations.push(`H1 count > ${bounds.maxH1} (got ${h1})`);
  if (bounds.minH2 !== undefined && h2 < bounds.minH2)
    violations.push(`H2 count < ${bounds.minH2} (got ${h2})`);
  if (bounds.maxH2 !== undefined && h2 > bounds.maxH2)
    violations.push(`H2 count > ${bounds.maxH2} (got ${h2})`);

  if (violations.length > 0) {
    throw new ProposalGeneratorError(
      'word_count_violation',
      `${label}: ${violations.join('; ')}`,
      undefined,
      { label, words, h1, h2, bounds, violations },
    );
  }
}
