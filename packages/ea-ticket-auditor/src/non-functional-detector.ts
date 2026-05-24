/**
 * Detects whether non-functional stories (perf / a11y / security /
 * observability) exist as explicit siblings under the parent epic.
 *
 * This is the second half of the Auditor's mandate per spec §4.3:
 * tickets should not embed NFR-acceptance inline; they should sit as
 * sibling stories so they're separately schedulable and reviewable.
 */

import type { TicketAuditInput } from './types.js';

const NON_FUNCTIONAL_CATEGORIES = [
  { key: 'perf', re: /perf(?:ormance)?\b|latency|throughput|p\d+/i, label: 'Performance' },
  { key: 'a11y', re: /a11y|accessibility|wcag|aria/i, label: 'Accessibility' },
  { key: 'security', re: /security|authn|authz|crypto|threat\s+model|sast|dast/i, label: 'Security' },
  { key: 'observability', re: /observability|tracing|metrics|spans|logs/i, label: 'Observability' }
] as const;

/** Returns the categories that are MISSING. */
export function findMissingNonFunctional(input: TicketAuditInput): string[] {
  const siblings = input.siblingStories ?? [];
  const corpus = siblings.map((s) => `${s.id}\n${s.body}`).join('\n\n');
  const out: string[] = [];
  for (const cat of NON_FUNCTIONAL_CATEGORIES) {
    if (!cat.re.test(corpus) && !cat.re.test(input.ticketBody)) {
      out.push(cat.label);
    }
  }
  return out;
}
