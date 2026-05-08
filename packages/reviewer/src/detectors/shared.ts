/**
 * Shared helpers for deterministic detectors.
 */

import type {
  CraftsmanshipDimensionId,
  CraftsmanshipFinding,
  CraftsmanshipSeverity,
  DiffHunk
} from '../types.js';
import { DEFAULT_SEVERITY } from '../types.js';
import { walkHunk, type DiffLine } from '../diff-parser.js';

/** Build a stable id-hash for a finding — used for cross-chunk dedup. */
export function findingId(parts: { dimension: string; file: string; line: number; suggestionTitle: string }): string {
  const s = `${parts.dimension}|${parts.file}|${parts.line}|${parts.suggestionTitle}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return `rev-${(h >>> 0).toString(16)}`;
}

/** Cap excerpt at 200 chars per DESIGN.md §4. */
export function excerpt(text: string, max = 200): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

/** Iterate added lines only — most detectors only care about new content. */
export function addedTextOnly(hunk: DiffHunk): DiffLine[] {
  return walkHunk(hunk).filter(l => l.kind === '+');
}

export function makeFinding(args: {
  dimension: CraftsmanshipDimensionId;
  file: string;
  line: number;
  suggestionTitle: string;
  description: string;
  suggestedChange?: string;
  detectorId: string;
  excerpt: string;
  severity?: CraftsmanshipSeverity;
}): CraftsmanshipFinding {
  const sev = args.severity ?? DEFAULT_SEVERITY[args.dimension];
  const f: CraftsmanshipFinding = {
    id: findingId(args),
    dimension: args.dimension,
    severity: sev,
    file: args.file,
    line: args.line,
    suggestionTitle: args.suggestionTitle,
    description: args.description,
    source: 'deterministic',
    detectorId: args.detectorId,
    excerpt: args.excerpt
  };
  if (args.suggestedChange !== undefined) {
    f.suggestedChange = args.suggestedChange;
  }
  return f;
}

/** Path is a test-fixture / fixture file — many craftsmanship rules don't
 * apply (intentionally messy code, fixtures of forbidden patterns, etc.). */
export function isFixturePath(file: string): boolean {
  return /(?:^|\/)(?:__fixtures__|tests\/fixtures|tests\/__fixtures__|fixtures)\//.test(file)
    || /\.example\b|\.sample\b/.test(file);
}

/** Path is a test file. */
export function isTestPath(file: string): boolean {
  return /(?:^|\/)(?:tests|__tests__)\//.test(file)
    || /\.(test|spec)\.[jt]sx?$/.test(file);
}

/** Path is a markdown / docs file — comment-density / type-any don't apply. */
export function isDocsPath(file: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(file);
}

/** Path is TypeScript / JavaScript source under packages or apps. */
export function isJsTsSrcPath(file: string): boolean {
  if (!/^(?:packages|apps)\/[^/]+\/src\//.test(file)) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file);
}
