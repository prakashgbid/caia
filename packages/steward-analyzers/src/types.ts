/**
 * Shared types for Steward Gatekeeper static analyzers.
 *
 * The `Finding` shape is the analyzer-side analogue of the steward-core
 * engine's `ProcessDrift`. Both flow into the dashboard's
 * `smart_cicd_observations` table (bucket prefix `steward_*`), but
 * analyzers bypass the predicate evaluator because their signal source
 * (file content, git refs, GitHub PR diff) is not naturally event-shaped.
 */

export type Severity = 'low' | 'medium' | 'high' | 'block';

/** A single drift / violation surfaced by an analyzer. */
export interface Finding {
  /** Stable kebab-case ID for the analyzer that emitted this finding. */
  analyzer: string;
  /** Stable kebab-case ID for the specific rule within the analyzer. */
  ruleId: string;
  /** Repo-relative path to the offending file (or `'<repo>'` if global). */
  path: string;
  /** 1-based line number in `path`, when locatable. */
  line?: number;
  /** Severity governs CI exit code + dashboard escalation. */
  severity: Severity;
  /** One-sentence summary suitable for a CI annotation. */
  message: string;
  /** Optional remediation hint pointing at a fix command or memory rule. */
  remediation?: string;
  /** Optional structured context for dashboard rendering / tests. */
  context?: Record<string, unknown>;
}

/** Aggregate result returned by an analyzer. */
export interface AnalyzerResult {
  analyzer: string;
  findings: Finding[];
  /** Files actually scanned (for dashboard transparency + flake suppression). */
  scanned: string[];
}

/**
 * `block` severity returns exit code 1 from the CLI; `low|medium|high`
 * return 0 (so CI surfaces them as warnings without blocking the merge).
 * Used by the `steward-gatekeeper` CLI shim.
 */
export function exitCodeFor(findings: Finding[]): number {
  return findings.some((f) => f.severity === 'block') ? 1 : 0;
}
