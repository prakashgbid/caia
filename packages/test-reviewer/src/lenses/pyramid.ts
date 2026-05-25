/**
 * @caia/test-reviewer — pyramid balance lens.
 *
 * Compares the actual per-layer distribution of `ticket.testCases` against
 * the Testing Architect's `testing.testTypeMixPercentages[ticketType]`.
 *
 * The architect's mix is a 6-axis split (unit, integration, e2e, visual,
 * a11y, perf) that sums to 100 — but `TestCase.layer` is a 5-axis split
 * (unit, integration, e2e, visual, accessibility). We map:
 *   - `a11y` (architect axis) ↔ `accessibility` (TestCase.layer)
 *   - `perf` (architect axis) has no `TestCase.layer` counterpart in v1
 *     of the ticket-template, so we fold its target into `unit+integration`
 *     for the comparison.
 *
 * Findings:
 *   - Layer well below target (< 50% of declared share) → underfill (P1).
 *   - Layer well above target (> 200% of declared share, when target > 0)
 *     → overfill (P2, advisory).
 *
 * Hard floors (apply even when the architect's mix is absent):
 *   - `unit` layer share ≥ `unitFloorPct` (default 30).
 *   - `e2e`  layer share ≤ `e2eCeilingPct`  (default 50).
 *   These mirror the Testing Architect's own invariants (see
 *   `@caia/testing-architect`'s `testing.mix-is-realistic-not-100-pct-unit`).
 *
 * Smoothing: layers whose expected case-count rounds below 1 are skipped —
 * flagging a missing 0.5-case is noise on small suites.
 */

import type { TestCase } from '@chiefaia/ticket-template';
import type { PyramidFinding, Severity } from '../types.js';

const LAYERS: readonly TestCase['layer'][] = [
  'unit',
  'integration',
  'e2e',
  'visual',
  'accessibility',
] as const;

export interface PyramidInput {
  testCases: readonly TestCase[];
  ticketType: string | undefined;
  composedArchitecture: Record<string, unknown>;
  underfillSeverity?: Severity;
  overfillSeverity?: Severity;
  unitFloorPct?: number;
  e2eCeilingPct?: number;
}

interface NormalizedMix {
  unit: number;
  integration: number;
  e2e: number;
  visual: number;
  accessibility: number;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Resolve the architect's mix for `ticketType` from the composed
 * architecture, mapping axes onto `TestCase.layer` space. Returns null
 * if the architect didn't ship a mix for this ticket type.
 */
export function resolveMix(
  composed: Record<string, unknown>,
  ticketType: string | undefined,
): NormalizedMix | null {
  if (!ticketType) return null;
  const mix = asObject(composed['testing.testTypeMixPercentages']);
  if (!mix) return null;
  const perType = asObject(mix[ticketType]);
  if (!perType) return null;

  const unit = asNumber(perType['unit']);
  const integration = asNumber(perType['integration']);
  const e2e = asNumber(perType['e2e']);
  const visual = asNumber(perType['visual']);
  const a11y = asNumber(perType['a11y']);
  const perf = asNumber(perType['perf']);

  if (
    unit === null ||
    integration === null ||
    e2e === null ||
    visual === null ||
    a11y === null ||
    perf === null
  ) {
    return null;
  }

  // Fold `perf` into unit+integration proportionally (perf tests in v1 of
  // ticket-template don't have a `TestCase.layer` of their own; they're
  // typically authored as unit or integration tests with a perf-budget
  // assertion).
  const split = unit + integration;
  const unitAdj = split > 0 ? unit + perf * (unit / split) : unit + perf / 2;
  const integrationAdj =
    split > 0
      ? integration + perf * (integration / split)
      : integration + perf / 2;

  return {
    unit: unitAdj,
    integration: integrationAdj,
    e2e,
    visual,
    accessibility: a11y,
  };
}

export function runPyramidLens(
  input: PyramidInput,
): readonly PyramidFinding[] {
  const underfillSeverity = input.underfillSeverity ?? 'P1';
  const overfillSeverity = input.overfillSeverity ?? 'P2';
  const unitFloor = input.unitFloorPct ?? 30;
  const e2eCeiling = input.e2eCeilingPct ?? 50;

  const total = input.testCases.length;
  const findings: PyramidFinding[] = [];

  // Zero cases — no pyramid to evaluate. The AC-coverage lens will catch
  // this; we don't double-fire.
  if (total === 0) return findings;

  // Compute per-layer histogram.
  const counts: NormalizedMix = {
    unit: 0,
    integration: 0,
    e2e: 0,
    visual: 0,
    accessibility: 0,
  };
  for (const tc of input.testCases) counts[tc.layer] += 1;

  const actualPct: NormalizedMix = {
    unit: (counts.unit / total) * 100,
    integration: (counts.integration / total) * 100,
    e2e: (counts.e2e / total) * 100,
    visual: (counts.visual / total) * 100,
    accessibility: (counts.accessibility / total) * 100,
  };

  // Hard floors (always run).
  if (actualPct.unit < unitFloor) {
    findings.push({
      layer: 'unit',
      actualPct: round1(actualPct.unit),
      targetPct: null,
      reason: `unit-layer share ${round1(actualPct.unit)}% is below the hard floor of ${unitFloor}%`,
      severity: underfillSeverity,
    });
  }
  if (actualPct.e2e > e2eCeiling) {
    findings.push({
      layer: 'e2e',
      actualPct: round1(actualPct.e2e),
      targetPct: null,
      reason: `e2e-layer share ${round1(actualPct.e2e)}% exceeds the hard ceiling of ${e2eCeiling}% — suite will be slow + flaky`,
      severity: underfillSeverity,
    });
  }

  // Architect-mix comparison (if available).
  const mix = resolveMix(input.composedArchitecture, input.ticketType);
  if (mix) {
    for (const layer of LAYERS) {
      const target = mix[layer];
      const actual = actualPct[layer];
      // Smoothing: if the expected case-count rounds below 1, skip — both
      // under-fill (missing 0.5-case is noise) and over-fill (a single
      // test in a layer with a 3%% target on a 10-case suite is fine)
      // suffer from small-target spam.
      const expectedCount = (target * total) / 100;
      if (expectedCount < 1) continue;
      if (target > 0 && actual < target * 0.5) {
        findings.push({
          layer,
          actualPct: round1(actual),
          targetPct: round1(target),
          reason: `${layer}-layer share ${round1(actual)}% is < 50% of the Testing Architect's target ${round1(target)}%`,
          severity: underfillSeverity,
        });
      } else if (target > 0 && actual > target * 2) {
        findings.push({
          layer,
          actualPct: round1(actual),
          targetPct: round1(target),
          reason: `${layer}-layer share ${round1(actual)}% is > 200% of the Testing Architect's target ${round1(target)}%`,
          severity: overfillSeverity,
        });
      }
    }
  }

  return findings;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
