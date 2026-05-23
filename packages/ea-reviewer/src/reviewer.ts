/**
 * @caia/ea-reviewer — reviewer.ts
 *
 * Sourced from research/17_architect_framework_spec_2026.md §6.
 *
 * Drives the three audit lenses, rolls findings into a single decision,
 * builds rerun directives for the dispatcher, and emits the final state
 * the orchestrator should transition to.
 *
 * The reviewer is intentionally DI-heavy: the critic adapter is injected,
 * the option set is injected, so tests can exercise every code path
 * deterministically without spawning an LLM.
 */

import {
  DEFAULT_REVIEWER_OPTIONS,
  type Advisory,
  type ArchitectAuditRow,
  type CorrectnessFinding,
  type CriticAdapter,
  type ReviewerDecision,
  type ReviewerFindings,
  type ReviewerInput,
  type ReviewerOptions,
  type RerunDirective,
  type Severity,
} from './types.js';
import { runCompletenessLens } from './completeness.js';
import { runConsistencyLens } from './invariants.js';
import { NullCriticAdapter } from './critic.js';

export interface ReviewerDeps {
  critic?: CriticAdapter;
}

export class Reviewer {
  private readonly opts: Required<ReviewerOptions>;
  private readonly critic: CriticAdapter;

  constructor(deps: ReviewerDeps = {}, opts: ReviewerOptions = {}) {
    this.opts = { ...DEFAULT_REVIEWER_OPTIONS, ...opts };
    this.critic = deps.critic ?? new NullCriticAdapter();
  }

  async review(input: ReviewerInput): Promise<ReviewerDecision> {
    // 1. Run the three lenses.
    const completeness = runCompletenessLens({
      composedArchitecture: input.composedArchitecture,
      auditRows: input.auditRows,
      contracts: input.contracts,
      missingRequiredSeverity: this.opts.missingRequiredSeverity,
    });
    const consistency = runConsistencyLens(input.composedArchitecture, {
      severity: this.opts.invariantViolationSeverity,
    });
    const correctness = input.acceptanceCriteria?.length
      ? await this.critic.judge({
          composedArchitecture: input.composedArchitecture,
          acceptanceCriteria: input.acceptanceCriteria,
          auditRows: input.auditRows,
        })
      : ([] as readonly CorrectnessFinding[]);

    const findings: ReviewerFindings = { completeness, consistency, correctness };

    // 2. Roll escalations into rerun directives.
    const escalationDirectives: RerunDirective[] = (input.escalations ?? []).flatMap(
      (e) =>
        e.architects.map((arch) => ({
          architect: arch,
          reason: `escalation: ${e.reason}`,
          severity: 'P0' as Severity,
        })),
    );

    // 3. Roll findings into rerun directives.
    const completenessRerun: RerunDirective[] = completeness.map((f) => ({
      architect: f.architect,
      reason: `missing required path '${f.missingPath}'`,
      severity: f.severity,
    }));
    const consistencyRerun: RerunDirective[] = consistency.flatMap((f) =>
      f.blameArchitects.map((arch) => ({
        architect: arch,
        reason: `invariant '${f.invariantId}' failed: ${f.description}`,
        severity: f.severity,
      })),
    );
    const correctnessRerun: RerunDirective[] = correctness
      .filter((f) => f.blameArchitect !== 'global')
      .map((f) => ({
        architect: f.blameArchitect as string,
        reason: `acceptance criterion not satisfied: ${f.reason}`,
        severity: f.severity,
      }));

    const allDirectives = [
      ...escalationDirectives,
      ...completenessRerun,
      ...consistencyRerun,
      ...correctnessRerun,
    ];

    // Dedup + take highest severity per architect.
    const blocking = new Set<Severity>(this.opts.blockingSeverities);
    const rerunByArch = new Map<string, RerunDirective>();
    for (const d of allDirectives) {
      if (!blocking.has(d.severity)) continue;
      const existing = rerunByArch.get(d.architect);
      if (!existing) {
        rerunByArch.set(d.architect, d);
      } else if (severityRank(d.severity) < severityRank(existing.severity)) {
        rerunByArch.set(d.architect, d);
      } else if (
        severityRank(d.severity) === severityRank(existing.severity) &&
        !existing.reason.includes(d.reason)
      ) {
        // Concatenate reasons so the architect sees all issues at once.
        rerunByArch.set(d.architect, {
          ...existing,
          reason: `${existing.reason}; ${d.reason}`,
        });
      }
    }
    const rerunArchitects = [...rerunByArch.values()];

    // 4. Build advisories — non-blocking, lower-severity issues.
    const advisories: Advisory[] = [];
    // Low-confidence advisories
    for (const a of input.auditRows) {
      if (a.confidence < this.opts.confidenceFloor && a.status !== 'failed') {
        advisories.push({
          architect: a.architectName,
          advisory: `confidence ${a.confidence.toFixed(2)} below floor ${this.opts.confidenceFloor}`,
          severity: 'P2',
        });
      }
    }
    // Global correctness findings (no specific architect) → advisory
    for (const f of correctness) {
      if (f.blameArchitect === 'global') {
        advisories.push({
          architect: 'global',
          advisory: f.reason,
          severity: f.severity,
        });
      }
    }
    // Non-blocking severity findings → advisories
    for (const d of allDirectives) {
      if (!blocking.has(d.severity)) {
        advisories.push({
          architect: d.architect,
          advisory: d.reason,
          severity: d.severity,
        });
      }
    }

    // 5. Decide.
    const decision: ReviewerDecision['decision'] =
      rerunArchitects.length > 0 ? 'fail' : 'pass';
    const finalState =
      decision === 'pass' ? 'ea-complete-verified' : 'ea-rejected';

    const summary = buildSummary(decision, findings, rerunArchitects);

    return {
      decision,
      finalState,
      rerunArchitects,
      advisories,
      findings,
      summary,
    };
  }
}

function severityRank(s: Severity): number {
  // Lower number = more severe
  return s === 'P0' ? 0 : s === 'P1' ? 1 : 2;
}

function buildSummary(
  decision: 'pass' | 'fail',
  findings: ReviewerFindings,
  rerunArchitects: readonly RerunDirective[],
): string {
  if (decision === 'pass') {
    const c = findings.consistency.length;
    const m = findings.completeness.length;
    if (c === 0 && m === 0) {
      return 'Audit passed: completeness, consistency, and correctness lenses all clean.';
    }
    return `Audit passed with ${m + c} non-blocking advisories.`;
  }
  const names = rerunArchitects.map((r) => r.architect).join(', ');
  return `Audit failed: re-run ${rerunArchitects.length} architect(s) — ${names}.`;
}

/** Functional flavour for tests + scripts. */
export async function review(
  input: ReviewerInput,
  deps: ReviewerDeps = {},
  opts: ReviewerOptions = {},
): Promise<ReviewerDecision> {
  return new Reviewer(deps, opts).review(input);
}

/** Agent id used in state-machine transitions. */
export const REVIEWER_AGENT_ID = 'ea-reviewer';
