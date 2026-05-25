/**
 * Policy: `auto-merge-prs`
 *
 * Maps to spec `p005-auto-merge-prs.ts` (lines 597, 641, 1156) and ADR-005.
 *
 * Rule: if the brief opens a PR on an operator-owned repo and mentions
 * "waiting on operator merge" (or equivalent passive phrasing), fail.
 * The operator-locked workflow is admin-merge, not "review and approve."
 *
 * Mode: `hard-fail`. The auto-merge rule is non-negotiable per ADR-005.
 */

import type {
  DispatchContext,
  Policy,
  PolicyEvidence,
  PolicyVerdict
} from '../types.js';

const PASSIVE_MERGE_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\bwait(?:ing|s)?\s+(?:on|for)\s+(?:the\s+)?(?:operator|user|reviewer|human|maintainer)\s+(?:to\s+)?(?:merge|review|approve)\b/gi,
    label: '"waiting on operator/user/reviewer to merge"'
  },
  {
    pattern: /\bpending\s+(?:operator|user|reviewer|human|maintainer)\s+(?:merge|review|approval)\b/gi,
    label: '"pending operator merge"'
  },
  {
    pattern: /\b(?:please|kindly)\s+(?:merge|approve|review)\b/gi,
    label: '"please merge / please approve"'
  },
  {
    pattern: /\bawaiting\s+(?:merge|approval|review|operator|sign[\-\s]?off)\b/gi,
    label: '"awaiting merge/approval/sign-off"'
  },
  {
    pattern: /\bneeds?\s+(?:operator|user|reviewer|human)\s+(?:merge|approval|review)\b/gi,
    label: '"needs operator merge"'
  },
  {
    pattern: /\bwill\s+wait\s+for\s+(?:merge|approval|review)\b/gi,
    label: '"will wait for merge"'
  }
];

const DEFAULT_OPERATOR_REPO_NAMESPACES: ReadonlyArray<string> = [
  'caia',
  'chiefaia',
  '@caia',
  '@chiefaia'
];

export function isOperatorRepo(
  repoOrUrl: string,
  extraNamespaces: ReadonlyArray<string> = []
): boolean {
  const namespaces = [...DEFAULT_OPERATOR_REPO_NAMESPACES, ...extraNamespaces];
  const normalised = repoOrUrl.toLowerCase();
  return namespaces.some((ns) => {
    const n = ns.toLowerCase();
    return (
      normalised === n ||
      normalised.startsWith(`${n}/`) ||
      normalised.includes(`/${n}/`) ||
      normalised.includes(`${n.replace(/^@/, '')}/`)
    );
  });
}

export function findPassiveMergePhrasings(
  text: string,
  sourceLabel: string
): ReadonlyArray<PolicyEvidence> {
  const evidence: PolicyEvidence[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const { pattern } of PASSIVE_MERGE_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        evidence.push({
          source: sourceLabel,
          line: i + 1,
          snippet: line.length > 200 ? `${line.slice(0, 199)}…` : line
        });
        if (evidence.length >= 20) return evidence;
      }
    }
  }
  return evidence;
}

export const autoMergePrsPolicy: Policy = {
  id: 'auto-merge-prs',
  description:
    'PRs on operator-owned repos must use admin-merge. Brief / PR body must not contain passive-merge phrasings. Source: ADR-005 / feedback-auto-merge-prs.',
  defaultMode: 'hard-fail',
  async check(ctx: DispatchContext): Promise<PolicyVerdict> {
    const extraNs = Array.isArray(ctx.metadata?.['operatorRepos'])
      ? (ctx.metadata!['operatorRepos'] as ReadonlyArray<string>)
      : [];
    const hasOperatorTarget = ctx.targetRepos.some((r) =>
      isOperatorRepo(r, extraNs)
    );
    if (!hasOperatorTarget) {
      return { ok: true };
    }
    const briefMatches = findPassiveMergePhrasings(ctx.briefMd, 'brief');
    const prBodyMatches = ctx.prBody
      ? findPassiveMergePhrasings(ctx.prBody, 'prBody')
      : [];
    const evidence = [...briefMatches, ...prBodyMatches];
    if (evidence.length === 0) {
      return { ok: true };
    }
    return {
      ok: false,
      mode: 'hard-fail',
      reason: `Brief or PR body contains ${evidence.length} passive-merge phrasing${evidence.length === 1 ? '' : 's'} on an operator-owned repo. ADR-005 requires admin-merge.`,
      suggestedFix:
        'Replace passive merge phrasing with admin-merge plan. Use: "PR opened. Admin-merging now per ADR-005." Then run `gh pr merge --admin --squash`.',
      evidence
    };
  }
};
