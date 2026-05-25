/**
 * Policy: `no-idle-research`
 *
 * Composite of two spec policies:
 *   - `p004-no-idle-no-waiting.ts` (line 596) — completion reports must
 *      contain "next dispatch:" or "no follow-up because".
 *   - `p008-action-research-outputs.ts` (line 600) — research completion
 *      briefs must reference a follow-up dispatch or operator decision.
 *
 * Source memories: `feedback-no-idle-no-waiting`,
 *                  `feedback-action-research-outputs`.
 *
 * Rule: a research or completion-report brief that has no follow-up plan
 * (and no explicit "no follow-up because <reason>" rationale) violates the
 * no-idle discipline. The framework should not produce reports that lie
 * idle waiting for the operator.
 *
 * Mode: `soft-fail` per spec lines 596/600 (both are soft-fail). The brief
 * may legitimately have no follow-up if it says so explicitly.
 *
 * Detection: scans the brief for any of the follow-up markers. If none
 * match AND the brief looks like a completion/research report (heuristic:
 * intent=='research' OR contains "## Status" or "## Results" or "completed"),
 * fire soft-fail.
 */

import type {
  DispatchContext,
  Policy,
  PolicyEvidence,
  PolicyVerdict
} from '../types.js';

const FOLLOW_UP_MARKER_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /^#{1,6}\s*next\s+dispatch\b/im, label: '## Next dispatch heading' },
  { pattern: /\bnext\s+dispatch\s*[:\-]/i, label: '"next dispatch:" line' },
  {
    pattern: /\bno\s+follow[\s\-]?up\s+because\b/i,
    label: '"no follow-up because" rationale'
  },
  { pattern: /\bfollow[\s\-]?up\s+dispatch\s*[:\-]/i, label: '"follow-up dispatch:" line' },
  { pattern: /\boperator[\s\-]?decision\s+needed\b/i, label: '"operator decision needed"' },
  {
    pattern: /\bnext\s+step[s]?\s*[:\-]/i,
    label: '"next steps:" line'
  },
  {
    pattern: /\bawaiting\s+operator\s+decision\s+on\b/i,
    label: '"awaiting operator decision on <topic>"'
  },
  {
    pattern: /\bdispatch(?:es|ing)?\s+(?:queued|scheduled|fired)\b/i,
    label: '"dispatches queued / scheduled / fired"'
  }
];

const REPORT_LIKE_PATTERNS: ReadonlyArray<RegExp> = [
  /^#{1,6}\s*results?\b/im,
  /^#{1,6}\s*status\b/im,
  /^#{1,6}\s*outcome[s]?\b/im,
  /^#{1,6}\s*conclusion[s]?\b/im,
  /^#{1,6}\s*summary\b/im,
  /^#{1,6}\s*findings?\b/im,
  /\b(?:task|work)\s+completed\b/i,
  /\bcompletion\s+report\b/i
];

function looksLikeReport(briefMd: string, intent: DispatchContext['intent']): boolean {
  if (intent === 'research') return true;
  return REPORT_LIKE_PATTERNS.some((rx) => rx.test(briefMd));
}

export function findFollowUpMarkers(
  briefMd: string
): ReadonlyArray<PolicyEvidence> {
  const evidence: PolicyEvidence[] = [];
  const lines = briefMd.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const { pattern } of FOLLOW_UP_MARKER_PATTERNS) {
      if (pattern.test(line)) {
        evidence.push({
          source: 'brief',
          line: i + 1,
          snippet: line.length > 200 ? `${line.slice(0, 199)}…` : line
        });
      }
    }
  }
  return evidence;
}

export const noIdleResearchPolicy: Policy = {
  id: 'no-idle-research',
  description:
    'Research or completion-report briefs must reference a follow-up dispatch, an operator decision needed, or an explicit "no follow-up because <reason>". Source: feedback-no-idle-no-waiting + feedback-action-research-outputs.',
  defaultMode: 'soft-fail',
  async check(ctx: DispatchContext): Promise<PolicyVerdict> {
    if (!looksLikeReport(ctx.briefMd, ctx.intent)) {
      return { ok: true };
    }
    const markers = findFollowUpMarkers(ctx.briefMd);
    if (markers.length > 0) {
      return { ok: true };
    }
    return {
      ok: false,
      mode: 'soft-fail',
      reason:
        'Research/completion brief has no follow-up marker. The framework rejects idle reports — every output must enumerate the next dispatch, name an operator decision needed, or say "no follow-up because <reason>".',
      suggestedFix:
        'Add a "## Next dispatch" section listing the follow-up tasks (with target agent + brief one-liner). If there is genuinely no follow-up, add a line "No follow-up because <explicit reason>".'
    };
  }
};
