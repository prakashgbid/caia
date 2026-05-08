/**
 * Shared helpers for deterministic detectors.
 */

import type { AdversarialFinding, DiffHunk, FailureModeId, Severity } from '../types.js';
import { DEFAULT_SEVERITY } from '../types.js';
import { walkHunk, type DiffLine } from '../diff-parser.js';

/** Build a stable id-hash for a finding — used for cross-chunk dedup. */
export function findingId(parts: { category: string; file: string; line: number; attackVector: string }): string {
  // tiny non-crypto hash — collisions are unlikely with our 4-part input.
  const s = `${parts.category}|${parts.file}|${parts.line}|${parts.attackVector}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return `crit-${(h >>> 0).toString(16)}`;
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
  category: FailureModeId;
  file: string;
  line: number;
  attackVector: string;
  description: string;
  reproductionSteps: string[];
  suggestedMitigation?: string;
  detectorId: string;
  excerpt: string;
  severity?: Severity;
}): AdversarialFinding {
  const sev = args.severity ?? DEFAULT_SEVERITY[args.category];
  const f: AdversarialFinding = {
    id: findingId(args),
    category: args.category,
    severity: sev,
    file: args.file,
    line: args.line,
    attackVector: args.attackVector,
    description: args.description,
    reproductionSteps: args.reproductionSteps,
    source: 'deterministic',
    detectorId: args.detectorId,
    excerpt: args.excerpt
  };
  if (args.suggestedMitigation !== undefined) {
    f.suggestedMitigation = args.suggestedMitigation;
  }
  return f;
}

/** Path is allowlisted as a fixture — credential-shape literals here are
 * intentional. Mirrors the project's existing `.gitleaks.toml` allowlist. */
export function isAllowlistedFixturePath(file: string): boolean {
  return /(?:^|\/)(?:__fixtures__|tests\/fixtures|tests\/__fixtures__|fixtures)\//.test(file)
    || /\.example\b|\.sample\b/.test(file);
}
