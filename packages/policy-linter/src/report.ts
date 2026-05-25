/**
 * @caia/policy-linter — structured `PolicyReport` builders + renderers.
 *
 * The engine produces a `PolicyReport`. Callers (CLI, dispatch-hook, CI
 * action) render it in one of three formats:
 *
 *   - `toJson` — for machine consumption (CI artifacts, INBOX entries).
 *   - `toMarkdown` — for PR comments + INBOX.md entries.
 *   - `toLine` — single-line summary for terminal exit messages.
 *
 * Worst-outcome resolution follows the rank order (highest first):
 *   hard-fail > soft-fail > advisory > pass.
 */

import type {
  Policy,
  PolicyMode,
  PolicyReport,
  PolicyResult,
  PolicyVerdict
} from './types.js';

const MODE_RANK: Readonly<Record<PolicyMode | 'pass', number>> = Object.freeze({
  pass: 0,
  advisory: 1,
  'soft-fail': 2,
  'hard-fail': 3
});

/**
 * Roll a list of per-policy results into a `PolicyReport`. `now` is injected
 * for testability.
 */
export function buildReport(
  callerAgentId: string,
  results: ReadonlyArray<PolicyResult>,
  now: () => Date = (): Date => new Date()
): PolicyReport {
  const worstRank = results.reduce(
    (max, r) => Math.max(max, MODE_RANK[r.effectiveMode]),
    0
  );
  const worstOutcome = ((): PolicyReport['worstOutcome'] => {
    switch (worstRank) {
      case 0:
        return 'pass';
      case 1:
        return 'advisory';
      case 2:
        return 'soft-fail';
      case 3:
        return 'hard-fail';
      default:
        return 'pass';
    }
  })();
  const violationCount = results.filter((r) => r.effectiveMode !== 'pass').length;
  return {
    generatedAt: now().toISOString(),
    callerAgentId,
    results,
    worstOutcome,
    violationCount
  };
}

/**
 * Build one `PolicyResult` from a verdict + the policy that produced it.
 * Centralises the verdict -> effectiveMode resolution so all callers agree.
 */
export function buildResult(
  policy: Pick<Policy, 'id' | 'description' | 'defaultMode'>,
  verdict: PolicyVerdict,
  durationMs: number
): PolicyResult {
  const effectiveMode: PolicyResult['effectiveMode'] = verdict.ok
    ? 'pass'
    : verdict.mode;
  return {
    policyId: policy.id,
    description: policy.description,
    verdict,
    effectiveMode,
    durationMs
  };
}

export function toJson(report: PolicyReport): string {
  return JSON.stringify(report, null, 2);
}

export function toLine(report: PolicyReport): string {
  const counts = countByMode(report);
  return [
    `[policy-linter] outcome=${report.worstOutcome}`,
    `hard-fails=${counts['hard-fail']}`,
    `soft-fails=${counts['soft-fail']}`,
    `advisories=${counts.advisory}`,
    `passes=${counts.pass}`
  ].join(' ');
}

export function toMarkdown(report: PolicyReport): string {
  const lines: string[] = [];
  lines.push(`# Policy report`);
  lines.push('');
  lines.push(`- Generated: \`${report.generatedAt}\``);
  lines.push(`- Caller agent: \`${report.callerAgentId}\``);
  lines.push(`- Worst outcome: **${report.worstOutcome}**`);
  lines.push(`- Violations: ${report.violationCount}`);
  lines.push('');
  lines.push('| Policy | Mode | Outcome | Reason |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of report.results) {
    const reason = r.verdict.ok
      ? ''
      : escapePipes(r.verdict.reason);
    lines.push(
      `| \`${r.policyId}\` | ${r.effectiveMode} | ${r.verdict.ok ? 'pass' : 'fail'} | ${reason} |`
    );
  }
  // Per-violation remediation blocks.
  const violations = report.results.filter((r) => !r.verdict.ok);
  if (violations.length > 0) {
    lines.push('');
    lines.push('## Remediation');
    lines.push('');
    for (const r of violations) {
      if (r.verdict.ok) continue;
      lines.push(`### \`${r.policyId}\` (${r.effectiveMode})`);
      lines.push('');
      lines.push(`**Reason:** ${r.verdict.reason}`);
      if (r.verdict.suggestedFix) {
        lines.push('');
        lines.push(`**Fix:** ${r.verdict.suggestedFix}`);
      }
      if (r.verdict.evidence && r.verdict.evidence.length > 0) {
        lines.push('');
        lines.push('**Evidence:**');
        for (const e of r.verdict.evidence) {
          const loc = e.line ? `${e.source}:${e.line}` : e.source;
          lines.push(`- \`${loc}\` — \`${escapePipes(e.snippet)}\``);
        }
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function countByMode(report: PolicyReport): Record<PolicyResult['effectiveMode'], number> {
  const out: Record<PolicyResult['effectiveMode'], number> = {
    pass: 0,
    advisory: 0,
    'soft-fail': 0,
    'hard-fail': 0
  };
  for (const r of report.results) {
    out[r.effectiveMode]++;
  }
  return out;
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

/**
 * Determine the process exit code that matches `report.worstOutcome`.
 *
 *   - pass / advisory -> 0   (allow dispatch / merge)
 *   - soft-fail       -> 1   (surface INBOX; CLI exits 1 by convention)
 *   - hard-fail       -> 2   (block dispatch / fail CI)
 */
export function exitCodeFor(report: PolicyReport): 0 | 1 | 2 {
  switch (report.worstOutcome) {
    case 'pass':
    case 'advisory':
      return 0;
    case 'soft-fail':
      return 1;
    case 'hard-fail':
      return 2;
    default:
      return 0;
  }
}
