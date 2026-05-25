/**
 * @caia/test-reviewer — edge-case lens.
 *
 * Require at least `max(edgeCaseFloor, ceil(totalCases / 10))` test cases
 * with `category === 'edge'`. The ratio scales with suite size: a
 * 5-case suite needs 1 edge case; a 50-case suite needs 5.
 *
 * Edge cases are the tests that catch off-by-one, empty-collection,
 * boundary-of-range, and Unicode-surprise bugs — the bread and butter of
 * software defects. A test suite without them is a smoke screen.
 */

import type { TestCase } from '@chiefaia/ticket-template';
import type { EdgeFinding, Severity } from '../types.js';

export interface EdgeInput {
  testCases: readonly TestCase[];
  /** Hard floor — at least this many edge cases regardless of suite size. */
  floor?: number;
  severity?: Severity;
}

export function runEdgeLens(input: EdgeInput): readonly EdgeFinding[] {
  const total = input.testCases.length;
  // Zero cases — handled by AC-coverage lens; don't double-fire.
  if (total === 0) return [];

  const floor = input.floor ?? 1;
  const severity = input.severity ?? 'P1';
  const required = Math.max(floor, Math.ceil(total / 10));

  const actual = input.testCases.filter((tc) => tc.category === 'edge').length;

  if (actual < required) {
    return [
      {
        reason:
          actual === 0
            ? `no edge-case tests (need ${required} for a ${total}-case suite)`
            : `only ${actual} edge-case test(s) — need ${required} for a ${total}-case suite`,
        severity,
      },
    ];
  }
  return [];
}
