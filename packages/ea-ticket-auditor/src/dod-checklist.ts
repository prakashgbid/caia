/**
 * The 15-point Definition of Done — implemented as runnable predicates
 * against a ticket markdown body. Each check returns pass + evidence (or
 * reason if failing).
 *
 * The list is derived from the operator's repeated DoD references in
 * agent-memory (feedback-* memories around acceptance criteria,
 * non-functional stories, observability, security review, etc.). Items
 * are intentionally loose-coupling: each check is a small regex / structural
 * test, not an LLM call, so the Auditor is cheap to run in CI.
 */

import type { DodCheckItem, DodCheckResult } from './types.js';

function regexCheck(re: RegExp, name: string): (body: string) => DodCheckResult {
  return (body: string): DodCheckResult => {
    const m = body.match(re);
    if (m === null) return { pass: false, reason: `missing ${name}` };
    return { pass: true, evidence: m[0].slice(0, 80) };
  };
}

function sectionCheck(headers: string[]): (body: string) => DodCheckResult {
  return (body: string): DodCheckResult => {
    for (const h of headers) {
      const re = new RegExp(`(?:^|\\n)#{1,6}\\s*${escapeRegExp(h)}\\b`, 'i');
      if (re.test(body)) return { pass: true, evidence: h };
    }
    return { pass: false, reason: `missing section: ${headers.join(' or ')}` };
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const DEFAULT_DOD_CHECKS: DodCheckItem[] = [
  { id: 'DoD-01', title: 'Acceptance criteria present', check: sectionCheck(['Acceptance Criteria', 'Acceptance', 'AC']) },
  { id: 'DoD-02', title: 'Test cases listed', check: sectionCheck(['Tests', 'Test Cases', 'Test Plan', 'Testing']) },
  { id: 'DoD-03', title: 'Architect contract referenced', check: regexCheck(/\barchitects?\s*[:,]/i, 'architect contract') },
  { id: 'DoD-04', title: 'Non-functional requirements section', check: sectionCheck(['Non-Functional', 'NFR', 'Quality Attributes']) },
  { id: 'DoD-05', title: 'Performance budget specified', check: regexCheck(/p(?:50|95|99)\s*[<≤=]\s*\d+\s*(?:ms|s)|TTI\s*[<≤=]|throughput/i, 'performance budget') },
  { id: 'DoD-06', title: 'Accessibility AA target', check: regexCheck(/(WCAG\s*2\.\d)|a11y|accessibility/i, 'a11y target') },
  { id: 'DoD-07', title: 'Security review owner named', check: regexCheck(/security\s*(review|owner|reviewer)/i, 'security review owner') },
  { id: 'DoD-08', title: 'Observability hooks declared', check: regexCheck(/(metrics?|tracing|spans?|logs?)\s*[:=-]/i, 'observability hooks') },
  { id: 'DoD-09', title: 'Rollout plan present', check: sectionCheck(['Rollout', 'Rollout Plan', 'Deployment Plan']) },
  { id: 'DoD-10', title: 'Rollback procedure present', check: sectionCheck(['Rollback', 'Rollback Plan']) },
  { id: 'DoD-11', title: 'Data migration considered (if applicable)', check: regexCheck(/migration|backfill|no\s+migration\s+required/i, 'migration consideration') },
  { id: 'DoD-12', title: 'Documentation update flagged', check: regexCheck(/docs?\s*(update|change)|documentation|README/i, 'doc update flag') },
  { id: 'DoD-13', title: 'Telemetry / analytics hooks', check: regexCheck(/telemetry|analytics?\s*event|tracker/i, 'telemetry hooks') },
  { id: 'DoD-14', title: 'Definition of Ready met', check: regexCheck(/(?:DoR|Definition\s+of\s+Ready|preconditions)/i, 'DoR') },
  { id: 'DoD-15', title: 'Story split or atomicity justified', check: regexCheck(/story\s*split|atomic|one\s+story\s+one\s+deploy/i, 'atomicity / split justification') }
];
