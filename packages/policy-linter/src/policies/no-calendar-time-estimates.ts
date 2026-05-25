/**
 * Policy: `no-calendar-time-estimates`
 *
 * Maps to spec `p003-no-timelines.ts` (lines 593, 663, 871, 1138).
 *
 * Rule: a brief must not contain calendar-time tokens (days/weeks/months/etc).
 * AI work is not date-estimated; tasks are ordered by dependency and grouped
 * by layer. Operator memory: `feedback-no-timelines`.
 *
 * Mode: `soft-fail` (per spec Q1 default, line 1138 — "a brief that contains
 * 'by Friday' is a soft violation"). Hard-fail every such brief blocks
 * dispatches the operator wanted; soft-failing lets them through with a
 * warning and an INBOX entry.
 *
 * Detection: regex against the brief markdown. Excludes literal historical
 * date references (e.g. `2026-05-25`, `## 2026-05-25 — ...`, ISO timestamps)
 * because those are valid event timestamps, not future estimates.
 */

import type {
  DispatchContext,
  Policy,
  PolicyEvidence,
  PolicyVerdict
} from '../types.js';

/**
 * Match calendar-time tokens like:
 *
 *   - `3 days`
 *   - `2-3 weeks`
 *   - `by Friday`
 *   - `next Monday`
 *   - `in 4 hours`
 *   - `Q3 2026`
 *   - `next sprint`
 *
 * Word boundaries prevent matching inside code like `daysOfWeek`.
 * Case-insensitive.
 */
const TIME_UNIT_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // "3 days", "2-3 weeks", "4 hours" — numeric quantity + unit
  {
    pattern: /\b\d+(?:[-–]\d+)?\s*(?:days?|weeks?|months?|quarters?|hours?|mins?|minutes?|sprints?)\b/gi,
    label: 'numeric calendar-time estimate'
  },
  // "by Friday", "by Monday", "by EOD", "by EOW", "by tomorrow"
  {
    pattern: /\bby\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|eow|tomorrow|today|next\s+week|month|year)\b/gi,
    label: '"by <calendar deadline>" phrasing'
  },
  // "next sprint", "next Monday", "next week"
  {
    pattern: /\bnext\s+(?:sprint|week|month|quarter|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    label: '"next <calendar period>" phrasing'
  },
  // "in 4 hours", "in 2 days"
  {
    pattern: /\bin\s+\d+\s*(?:days?|weeks?|months?|hours?|mins?|minutes?)\b/gi,
    label: '"in N units" phrasing'
  },
  // Quarter references: Q1, Q2 2026
  {
    pattern: /\bQ[1-4](?:\s*\d{4})?\b/g,
    label: 'quarter reference'
  }
];

/**
 * Internal: scan a markdown brief for time-estimate violations. Exported for
 * unit-test consumption. Skips lines that look like ISO/historical date
 * headers (e.g. lines that start with `## 2026-`, or that contain only an
 * ISO timestamp).
 */
export function findCalendarTimeMatches(
  briefMd: string,
  sourceLabel = 'brief'
): ReadonlyArray<PolicyEvidence> {
  const evidence: PolicyEvidence[] = [];
  const lines = briefMd.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (isHistoricalDateHeader(line)) continue;
    for (const { pattern } of TIME_UNIT_PATTERNS) {
      // Reset lastIndex defensively for /g regexes reused across lines.
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        evidence.push({
          source: sourceLabel,
          line: i + 1,
          snippet: truncate(m[0], 120)
        });
        if (evidence.length >= 20) {
          // Cap evidence so reports stay readable.
          return evidence;
        }
      }
    }
  }
  return evidence;
}

function isHistoricalDateHeader(line: string): boolean {
  // Lines that consist mostly of an ISO date/timestamp + optional header
  // syntax — these are valid event records, not future estimates.
  const trimmed = line.trim();
  if (!trimmed) return false;
  // ISO 8601 date / timestamp at the start.
  if (/^#{0,6}\s*\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/.test(trimmed)) {
    return true;
  }
  // "submittedAt: 2026-05-25T..." style frontmatter values.
  if (/:\s*\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return true;
  }
  return false;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export const noCalendarTimeEstimatesPolicy: Policy = {
  id: 'no-calendar-time-estimates',
  description:
    'AI work is not date-estimated. Brief must not contain calendar-time tokens (days/weeks/months, "by Friday", "next sprint", Q3 2026, etc). Source: feedback-no-timelines.',
  defaultMode: 'soft-fail',
  async check(ctx: DispatchContext): Promise<PolicyVerdict> {
    const matches = findCalendarTimeMatches(ctx.briefMd);
    if (matches.length === 0) {
      return { ok: true };
    }
    return {
      ok: false,
      mode: 'soft-fail',
      reason: `Brief contains ${matches.length} calendar-time estimate${matches.length === 1 ? '' : 's'} — AI work is ordered by dependency, not dated.`,
      suggestedFix:
        'Replace calendar-time tokens with dependency ordering. Instead of "by Friday" or "in 3 days", state the upstream task that must complete first.',
      evidence: matches
    };
  }
};
