/**
 * @caia/test-reviewer — AC coverage lens.
 *
 * For each acceptance criterion `acceptanceCriteria[i]`, require at least
 * one `TestCase` with:
 *   - `linkedAcceptanceCriterionIndex === i`, AND
 *   - `category === 'happy'`
 *
 * The happy-path requirement is deliberate: an edge or error test that
 * happens to link to an AC doesn't prove the criterion's success path
 * works. A green-light happy test does.
 *
 * Missing AC → P1 (default) rerun directive blaming the Test Author.
 */

import type { TestCase } from '@chiefaia/ticket-template';
import type { AcCoverageFinding, Severity } from '../types.js';

export interface AcCoverageInput {
  testCases: readonly TestCase[];
  acceptanceCriteria: readonly string[];
  severity?: Severity;
}

export function runAcCoverageLens(
  input: AcCoverageInput,
): readonly AcCoverageFinding[] {
  const severity = input.severity ?? 'P1';
  const findings: AcCoverageFinding[] = [];

  for (let i = 0; i < input.acceptanceCriteria.length; i++) {
    const acText = input.acceptanceCriteria[i] ?? '';
    const happyCase = input.testCases.find(
      (tc) =>
        tc.linkedAcceptanceCriterionIndex === i && tc.category === 'happy',
    );
    if (!happyCase) {
      // Distinguish "no test at all" from "non-happy test only" for better
      // operator feedback.
      const anyLinked = input.testCases.some(
        (tc) => tc.linkedAcceptanceCriterionIndex === i,
      );
      findings.push({
        acIndex: i,
        acText,
        reason: anyLinked
          ? `acceptance criterion #${i} has linked test cases but none with category='happy'`
          : `acceptance criterion #${i} has no linked test case`,
        severity,
      });
    }
  }

  return findings;
}
