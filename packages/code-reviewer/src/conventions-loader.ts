/**
 * Conventions loader — reads AGENTS.md (or any conventions file) and
 * extracts the sections most relevant to a correctness/bugs/style review.
 *
 * Sections of interest (heading-name match, case-insensitive):
 *   - "Code style"
 *   - "Conventions"
 *   - "Naming"
 *   - "Testing"
 *   - "Type safety"
 *   - "Correctness"
 *   - "Bug patterns"
 *
 * Mirrors `@chiefaia/reviewer`'s loader shape but tilts the heading allow-
 * list toward correctness/bugs (Reviewer tilted toward craftsmanship).
 *
 * If the conventions file is missing → returns an empty array (the LLM
 * tier still runs, just without project-specific grounding).
 */

import type { ConventionExcerpt, FsReader } from './types.js';

const CONVENTIONS_HEADINGS = [
  'code style',
  'conventions',
  'naming',
  'testing',
  'type safety',
  'correctness',
  'bug patterns',
  'review checklist'
];

const HEADING_LINE = /^##+\s+(.+?)\s*(?:\(.*\))?$/;
const BODY_EXCERPT_MAX = 500;

export function loadConventions(fs: FsReader, conventionsPath: string): ConventionExcerpt[] {
  if (!fs.exists(conventionsPath)) return [];
  let content: string;
  try {
    content = fs.readFile(conventionsPath);
  } catch {
    return [];
  }
  return parseConventionsMarkdown(conventionsPath, content);
}

export function parseConventionsMarkdown(source: string, content: string): ConventionExcerpt[] {
  const lines = content.split('\n');
  const out: ConventionExcerpt[] = [];
  let currentHeading: string | null = null;
  let currentBuffer: string[] = [];

  const flush = (): void => {
    if (currentHeading === null) return;
    if (!isInterestingHeading(currentHeading)) {
      currentHeading = null;
      currentBuffer = [];
      return;
    }
    const body = currentBuffer.join('\n').trim();
    if (body.length === 0) {
      currentHeading = null;
      currentBuffer = [];
      return;
    }
    out.push({
      source,
      heading: currentHeading,
      bodyExcerpt: body.slice(0, BODY_EXCERPT_MAX)
    });
    currentHeading = null;
    currentBuffer = [];
  };

  for (const line of lines) {
    const m = HEADING_LINE.exec(line);
    if (m !== null) {
      flush();
      currentHeading = (m[1] ?? '').trim();
      currentBuffer = [];
      continue;
    }
    if (currentHeading !== null) {
      currentBuffer.push(line);
    }
  }
  flush();
  return out;
}

function isInterestingHeading(heading: string): boolean {
  const norm = heading.toLowerCase();
  return CONVENTIONS_HEADINGS.some(h => norm.includes(h));
}
