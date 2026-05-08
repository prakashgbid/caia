/**
 * Conventions loader — reads AGENTS.md and extracts craftsmanship-relevant
 * sections to ground the LLM-reasoned tier in CAIA's own style rules.
 *
 * Sections of interest (heading-name match, case-insensitive):
 *   - "Code style"
 *   - "Conventions"
 *   - "Craftsmanship"
 *   - "Idioms"
 *   - "Naming"
 *   - "Testing conventions"
 *
 * If the conventions file is missing → returns an empty array (the LLM
 * tier still runs, just without project-specific grounding — the agent's
 * pre-spawn Mentor + Librarian injection still provides context).
 */

import type { ConventionExcerpt, FsReader } from './types.js';

/** Headings whose contents we extract for the LLM prompt. */
const CONVENTIONS_HEADINGS = [
  'code style',
  'conventions',
  'craftsmanship',
  'idioms',
  'naming',
  'testing',
  'testing conventions'
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
    if (!isCraftsmanshipHeading(currentHeading)) {
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

function isCraftsmanshipHeading(heading: string): boolean {
  const norm = heading.toLowerCase();
  return CONVENTIONS_HEADINGS.some(h => norm.includes(h));
}
