/**
 * @caia/ea-reviewer — completeness lens.
 *
 * Sourced from research/17_architect_framework_spec_2026.md §6.2.
 *
 * For each architect that applied, every required `SectionContract.section`
 * key must be populated non-null in the composed architecture. Missing
 * keys are reported with the owning architect and a configurable severity.
 */

import type { ArchitectSectionContract } from '@caia/architect-kit';
import type {
  ArchitectAuditRow,
  CompletenessFinding,
  Severity,
} from './types.js';

export interface CompletenessInput {
  composedArchitecture: Record<string, unknown>;
  auditRows: readonly ArchitectAuditRow[];
  contracts: readonly ArchitectSectionContract[];
  /** Severity to attach to missing-required findings. Default: 'P1'. */
  missingRequiredSeverity?: Severity;
}

/**
 * Run the completeness lens. Returns one finding per missing required path
 * across every architect that ran (status != failed). Architects with
 * status==failed are skipped — their absence is already represented in
 * the audit row.
 */
export function runCompletenessLens(
  input: CompletenessInput,
): readonly CompletenessFinding[] {
  const severity: Severity = input.missingRequiredSeverity ?? 'P1';
  const ranByName = new Map(
    input.auditRows.map((r) => [r.architectName, r]),
  );

  const findings: CompletenessFinding[] = [];
  for (const contract of input.contracts) {
    const audit = ranByName.get(contract.architectName);
    // The architect didn't run (skipped or not registered for this ticket)
    if (!audit) continue;
    // Failed architects — the dispatcher already marks them as such. No
    // need to flag every one of their missing paths individually.
    if (audit.status === 'failed') {
      findings.push({
        architect: contract.architectName,
        missingPath: '<all>',
        severity,
      });
      continue;
    }
    for (const section of contract.sections) {
      if (!section.required) continue;
      const value = input.composedArchitecture[section.path];
      if (value == null || value === '') {
        findings.push({
          architect: contract.architectName,
          missingPath: section.path,
          severity,
        });
      }
    }
  }
  return findings;
}
