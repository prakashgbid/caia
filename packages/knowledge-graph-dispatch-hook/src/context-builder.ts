/**
 * @caia/knowledge-graph-dispatch-hook — markdown preamble renderer.
 *
 * Renders the "Architecture Context (auto-injected by AKG)" markdown
 * block defined in the Layer 3 spec
 * (`research/ai_first_continuous_discipline_2026.md`, lines 651-672).
 *
 * Shape (verbatim from spec):
 *
 *   ## Architecture Context (auto-injected by AKG)
 *
 *   The following decisions, principles, and lessons may be relevant to
 *   this task. Read them before proceeding. If any seem to constrain the
 *   requested action, surface that to the caller via your output.
 *
 *   ### ADRs
 *   - [ADR-011] Event-first state with database as projection
 *   …
 *   ### Principles
 *   - [P3] No timelines, ever
 *   …
 *   ### Lessons
 *   - [L01] Pixel-perfect calibration (85%/95% diff thresholds)
 *   …
 *   ### Recent feedback memories
 *   - [feedback-continuous-discipline-problem] (2026-05-24)
 *
 * Rules:
 *   - Empty sections are OMITTED (no headers for empty kinds).
 *   - When ALL sections are empty, the whole preamble is the empty
 *     string — the api layer skips prepending in that case.
 *   - Order is fixed: ADRs → Principles → Lessons → Recent feedback
 *     memories → Other. Within a section, rank order from the embedder
 *     is preserved.
 *   - Titles are trimmed and markdown-character-escaped lightly
 *     (closing brackets only, to keep the `[ID] Title` shape parseable).
 *   - Feedback memories include a `(YYYY-MM-DD)` suffix when a date is
 *     known; omitted otherwise.
 *
 * Pure: no I/O, no deps beyond the types module.
 */

import type { RetrievedArtifact } from './types.js';

export const PREAMBLE_HEADER = '## Architecture Context (auto-injected by AKG)';

export const PREAMBLE_INTRO = [
  'The following decisions, principles, and lessons may be relevant to',
  'this task. Read them before proceeding. If any seem to constrain the',
  'requested action, surface that to the caller via your output.',
].join(' ');

const SECTION_ORDER: ReadonlyArray<{
  kind: RetrievedArtifact['kind'];
  heading: string;
}> = [
  { kind: 'adr', heading: '### ADRs' },
  { kind: 'principle', heading: '### Principles' },
  { kind: 'lesson', heading: '### Lessons' },
  { kind: 'feedback', heading: '### Recent feedback memories' },
  { kind: 'other', heading: '### Other' },
];

/**
 * Build the preamble markdown block from a list of retrieved artifacts.
 *
 * @param artifacts Ranked artifact list (from embedder.retrieveContext).
 * @returns Markdown string. Empty string when `artifacts` is empty or
 *          contains only empty/invalid entries.
 */
export function buildPreamble(
  artifacts: ReadonlyArray<RetrievedArtifact>,
): string {
  if (artifacts.length === 0) return '';

  const grouped = groupByKind(artifacts);
  const sections: string[] = [];

  for (const { kind, heading } of SECTION_ORDER) {
    const items = grouped[kind];
    if (!items || items.length === 0) continue;
    const lines = items.map((a) => renderArtifactLine(a, kind));
    sections.push(`${heading}\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return '';

  return [
    PREAMBLE_HEADER,
    '',
    PREAMBLE_INTRO,
    '',
    sections.join('\n\n'),
  ].join('\n');
}

/**
 * Prepend the preamble to a brief, with two trailing newlines so the
 * original brief's heading rendering is preserved. If `preamble` is
 * empty, returns `brief` unchanged.
 */
export function prependPreamble(brief: string, preamble: string): string {
  if (preamble.length === 0) return brief;
  return `${preamble}\n\n${brief}`;
}

/**
 * Group artifacts by kind, preserving rank order within each kind.
 */
export function groupByKind(
  artifacts: ReadonlyArray<RetrievedArtifact>,
): Record<RetrievedArtifact['kind'], RetrievedArtifact[]> {
  const acc: Record<RetrievedArtifact['kind'], RetrievedArtifact[]> = {
    adr: [],
    principle: [],
    lesson: [],
    feedback: [],
    other: [],
  };
  for (const a of artifacts) {
    acc[a.kind].push(a);
  }
  return acc;
}

/**
 * Render one bullet for the preamble.
 *
 *   ADR-style:        - [ADR-011] Event-first state with database as projection
 *   Principle-style:  - [P3] No timelines, ever
 *   Lesson-style:     - [L01] Pixel-perfect calibration (85%/95% diff thresholds)
 *   Feedback-style:   - [feedback-continuous-discipline-problem] (2026-05-24)
 *   Other-style:      - [<id>] <title>
 *
 * For feedback memories specifically: the title is dropped when the id
 * already encodes intent ("feedback-no-timelines" reads cleanly on its
 * own) and a date suffix is appended when available.
 */
export function renderArtifactLine(
  artifact: RetrievedArtifact,
  kind: RetrievedArtifact['kind'],
): string {
  const id = sanitiseId(artifact.id);
  if (kind === 'feedback') {
    const datePart = artifact.date ? ` (${artifact.date})` : '';
    return `- [${id}]${datePart}`;
  }
  const title = sanitiseTitle(artifact.title);
  return title.length > 0 ? `- [${id}] ${title}` : `- [${id}]`;
}

/**
 * Strip closing brackets from the id so the [id] shape stays parseable.
 * Caps at 80 chars.
 */
function sanitiseId(id: string): string {
  const cleaned = id.replace(/[\[\]]/g, '').trim();
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

/**
 * Strip line breaks, collapse whitespace, trim, cap at 200 chars.
 * Closing brackets in titles are escaped with a backslash so consumers
 * eyeballing the markdown still see them.
 */
function sanitiseTitle(title: string): string {
  const collapsed = title.replace(/\s+/g, ' ').trim();
  const escaped = collapsed.replace(/\]/g, '\\]');
  return escaped.length > 200 ? `${escaped.slice(0, 197).trim()}…` : escaped;
}
