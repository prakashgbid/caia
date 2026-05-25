/**
 * @caia/test-reviewer — error-state lens.
 *
 * Baseline requirement: at least one `category === 'error'` test in the
 * suite. Error tests prove the negative — that bad inputs fail loudly
 * instead of silently corrupting state.
 *
 * Conditional quality-tag floors (driven by the composed architecture):
 *   - If `architecture['a11y.wcagLevel']` is set (any value), require at
 *     least one `category === 'accessibility'` test. (Setting a WCAG
 *     level without testing accessibility is theatre.)
 *   - If `architecture['security.dataClassification']` ∈ {PII,
 *     confidential}, require at least one `category === 'security'` test.
 *     (Sensitive data without security tests is a P1 audit finding by
 *     itself.)
 */

import type { TestCase } from '@chiefaia/ticket-template';
import type { ErrorFinding, Severity } from '../types.js';

export interface ErrorInput {
  testCases: readonly TestCase[];
  composedArchitecture: Record<string, unknown>;
  severity?: Severity;
}

export function runErrorLens(input: ErrorInput): readonly ErrorFinding[] {
  const severity = input.severity ?? 'P1';
  const total = input.testCases.length;
  // Zero cases — handled by AC-coverage lens; don't double-fire.
  if (total === 0) return [];

  const findings: ErrorFinding[] = [];

  // Baseline: ≥1 error test.
  const errorCount = input.testCases.filter((tc) => tc.category === 'error')
    .length;
  if (errorCount === 0) {
    findings.push({
      qualifier: 'baseline',
      reason:
        'no error-state tests — every suite needs at least one negative-path test',
      severity,
    });
  }

  // A11y floor.
  const wcag = input.composedArchitecture['a11y.wcagLevel'];
  if (typeof wcag === 'string' && wcag.length > 0) {
    const a11yCount = input.testCases.filter(
      (tc) => tc.category === 'accessibility',
    ).length;
    if (a11yCount === 0) {
      findings.push({
        qualifier: 'a11y',
        reason: `architecture declares WCAG ${wcag} but the suite has no accessibility tests`,
        severity,
      });
    }
  }

  // Security floor.
  const dataClass = input.composedArchitecture['security.dataClassification'];
  if (dataClass === 'PII' || dataClass === 'confidential') {
    const secCount = input.testCases.filter(
      (tc) => tc.category === 'security',
    ).length;
    if (secCount === 0) {
      findings.push({
        qualifier: 'security',
        reason: `data classification '${dataClass}' requires at least one security test`,
        severity,
      });
    }
  }

  return findings;
}
