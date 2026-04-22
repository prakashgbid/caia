/**
 * pulse-testable.ts — re-exports internal functions for unit testing.
 * Only import from tests. Production code uses pulse.ts directly.
 */

import type { CheckResult, HealResult, PulseOutcome } from './types';
import { CRITICAL_CHECKS } from './checks/index';

export function computeOutcomeFromChecks(
  checks: CheckResult[],
  canaryPassed: boolean,
  heals: Pick<HealResult, 'success' | 'idempotent'>[],
): PulseOutcome {
  const failedChecks = checks.filter(c => !c.passed);
  const criticalFailed = failedChecks.some(c => CRITICAL_CHECKS.has(c.name));
  const hasAnyFailure = failedChecks.length > 0 || !canaryPassed;

  const healsApplied = heals.filter(h => h.success && !h.idempotent);
  if (healsApplied.length > 0) return 'AUTO-HEALED';
  if (criticalFailed || !canaryPassed) return 'CRITICAL';
  if (hasAnyFailure) return 'DEGRADED';
  return 'PASSING';
}

export function isCanaryTask(task: { notes?: string | null }): boolean {
  if (!task.notes) return false;
  try {
    const meta = JSON.parse(task.notes) as Record<string, unknown>;
    return meta.canary === true;
  } catch {
    return false;
  }
}
