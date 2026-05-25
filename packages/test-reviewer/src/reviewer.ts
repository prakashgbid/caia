/**
 * @caia/test-reviewer — reviewer.ts
 *
 * Drives the four deterministic lenses (AC coverage, pyramid, edge,
 * error) plus the LLM-judge correctness lens. Rolls every finding into
 * a single decision envelope: a `RerunDirective` list for the Test
 * Author and an `Advisory` list for the dashboard.
 *
 * Mirrors `@caia/ea-reviewer`'s `Reviewer` class verbatim in shape and
 * behaviour. The only differences:
 *   - reruns target `'test-author'` (single agent), not architects.
 *   - finalState is `tests-reviewed` / `tests-review-failed`, not
 *     `ea-complete-verified` / `ea-rejected`.
 *   - lens set is AC-coverage / pyramid / edge / error / correctness.
 *
 * The reviewer is intentionally DI-heavy: the critic adapter is
 * injected, the option set is injected, so tests can exercise every
 * code path deterministically without spawning an LLM.
 */

import { NullCriticAdapter } from './critic.js';
import { runAcCoverageLens } from './lenses/ac-coverage.js';
import { runEdgeLens } from './lenses/edge.js';
import { runErrorLens } from './lenses/error.js';
import { runPyramidLens } from './lenses/pyramid.js';
import {
  DEFAULT_REVIEWER_OPTIONS,
  REVIEWER_AGENT_ID,
  type Advisory,
  type CorrectnessFinding,
  type CriticAdapter,
  type LensName,
  type RerunDirective,
  type ReviewerDecision,
  type ReviewerFindings,
  type ReviewerInput,
  type ReviewerOptions,
  type Severity,
} from './types.js';

export interface ReviewerDeps {
  critic?: CriticAdapter;
}

export class TestReviewer {
  private readonly opts: Required<ReviewerOptions>;
  private readonly critic: CriticAdapter;

  constructor(deps: ReviewerDeps = {}, opts: ReviewerOptions = {}) {
    this.opts = { ...DEFAULT_REVIEWER_OPTIONS, ...opts };
    this.critic = deps.critic ?? new NullCriticAdapter();
  }

  async review(input: ReviewerInput): Promise<ReviewerDecision> {
    const testCases = input.ticket.testCases ?? [];
    const acceptanceCriteria =
      input.acceptanceCriteria ?? input.ticket.acceptance_criteria ?? [];

    // 1. Run the four deterministic lenses.
    const acCoverage = runAcCoverageLens({
      testCases,
      acceptanceCriteria,
      severity: this.opts.acCoverageMissSeverity,
    });
    const pyramid = runPyramidLens({
      testCases,
      ticketType: input.ticket.type,
      composedArchitecture: input.composedArchitecture,
      underfillSeverity: this.opts.pyramidUnderfillSeverity,
      overfillSeverity: this.opts.pyramidOverfillSeverity,
      unitFloorPct: this.opts.unitFloorPct,
      e2eCeilingPct: this.opts.e2eCeilingPct,
    });
    const edge = runEdgeLens({
      testCases,
      floor: this.opts.edgeCaseFloor,
      severity: this.opts.edgeCaseMissSeverity,
    });
    const error = runErrorLens({
      testCases,
      composedArchitecture: input.composedArchitecture,
      severity: this.opts.errorMissSeverity,
    });

    // 2. Run the LLM-judge correctness lens — only if there are ACs.
    const correctness: readonly CorrectnessFinding[] =
      acceptanceCriteria.length > 0
        ? await this.critic.judge({
            testCases,
            acceptanceCriteria,
            composedArchitecture: input.composedArchitecture,
          })
        : [];

    const findings: ReviewerFindings = {
      acCoverage,
      pyramid,
      edge,
      error,
      correctness,
    };

    // 3. Roll each lens's findings into rerun directives + advisories.
    const blocking = new Set<Severity>(this.opts.blockingSeverities);

    const allDirectives: RerunDirective[] = [];
    const allAdvisories: Advisory[] = [];

    // AC coverage — always blames test-author.
    for (const f of acCoverage) {
      const d: RerunDirective = {
        agent: 'test-author',
        reason: f.reason,
        severity: f.severity,
        lens: 'acCoverage',
      };
      if (blocking.has(f.severity)) allDirectives.push(d);
      else
        allAdvisories.push({
          agent: 'test-author',
          advisory: d.reason,
          severity: d.severity,
          lens: 'acCoverage',
        });
    }

    // Pyramid — under-fill blames test-author; over-fill is advisory.
    for (const f of pyramid) {
      const d: RerunDirective = {
        agent: 'test-author',
        reason: f.reason,
        severity: f.severity,
        lens: 'pyramid',
      };
      if (blocking.has(f.severity)) allDirectives.push(d);
      else
        allAdvisories.push({
          agent:
            f.targetPct === null
              ? 'test-author' // hard-floor violation — author's fault
              : 'testing-architect', // strategy-target mismatch — architect could rebalance
          advisory: d.reason,
          severity: d.severity,
          lens: 'pyramid',
        });
    }

    // Edge — always blames test-author.
    for (const f of edge) {
      const d: RerunDirective = {
        agent: 'test-author',
        reason: f.reason,
        severity: f.severity,
        lens: 'edge',
      };
      if (blocking.has(f.severity)) allDirectives.push(d);
      else
        allAdvisories.push({
          agent: 'test-author',
          advisory: d.reason,
          severity: d.severity,
          lens: 'edge',
        });
    }

    // Error — always blames test-author.
    for (const f of error) {
      const d: RerunDirective = {
        agent: 'test-author',
        reason: f.reason,
        severity: f.severity,
        lens: 'error',
      };
      if (blocking.has(f.severity)) allDirectives.push(d);
      else
        allAdvisories.push({
          agent: 'test-author',
          advisory: d.reason,
          severity: d.severity,
          lens: 'error',
        });
    }

    // Correctness — blames test-author if a specific case id is named,
    // else routes to advisory (global). Critic findings default to P2;
    // we honour their severity verbatim.
    for (const f of correctness) {
      if (f.testCaseId && blocking.has(f.severity)) {
        allDirectives.push({
          agent: 'test-author',
          reason: f.reason,
          severity: f.severity,
          lens: 'correctness',
        });
      } else {
        allAdvisories.push({
          agent: f.testCaseId ? 'test-author' : 'global',
          advisory: f.reason,
          severity: f.severity,
          lens: 'correctness',
        });
      }
    }

    // 4. Dedup directives: collapse to ONE entry per (agent, lens),
    // keeping the highest severity and concatenating reasons. We don't
    // bother per-architect dedup like ea-reviewer because there's one
    // author — but per-lens dedup makes the feedback navigable.
    const rerunByLens = new Map<LensName, RerunDirective>();
    for (const d of allDirectives) {
      const existing = rerunByLens.get(d.lens);
      if (!existing) {
        rerunByLens.set(d.lens, d);
      } else if (severityRank(d.severity) < severityRank(existing.severity)) {
        rerunByLens.set(d.lens, {
          ...d,
          reason: `${existing.reason}; ${d.reason}`,
        });
      } else if (severityRank(d.severity) === severityRank(existing.severity)) {
        rerunByLens.set(d.lens, {
          ...existing,
          reason: existing.reason.includes(d.reason)
            ? existing.reason
            : `${existing.reason}; ${d.reason}`,
        });
      } else {
        // existing is more severe — append d's reason to it
        rerunByLens.set(d.lens, {
          ...existing,
          reason: existing.reason.includes(d.reason)
            ? existing.reason
            : `${existing.reason}; ${d.reason}`,
        });
      }
    }
    const rerunAuthor = [...rerunByLens.values()];

    // 5. Decide.
    const decision: ReviewerDecision['decision'] =
      rerunAuthor.length > 0 ? 'fail' : 'pass';
    const finalState =
      decision === 'pass'
        ? ('tests-reviewed' as const)
        : ('tests-review-failed' as const);

    const summary = buildSummary(decision, findings, rerunAuthor);

    return {
      decision,
      finalState,
      rerunAuthor,
      advisories: allAdvisories,
      findings,
      summary,
    };
  }
}

function severityRank(s: Severity): number {
  // Lower number = more severe (matches ea-reviewer).
  return s === 'P0' ? 0 : s === 'P1' ? 1 : 2;
}

function buildSummary(
  decision: 'pass' | 'fail',
  findings: ReviewerFindings,
  rerunAuthor: readonly RerunDirective[],
): string {
  if (decision === 'pass') {
    const m =
      findings.acCoverage.length +
      findings.pyramid.length +
      findings.edge.length +
      findings.error.length +
      findings.correctness.length;
    if (m === 0) {
      return 'Audit passed: AC-coverage, pyramid, edge, error, and correctness lenses all clean.';
    }
    return `Audit passed with ${m} non-blocking advisor${m === 1 ? 'y' : 'ies'}.`;
  }
  const lenses = rerunAuthor.map((r) => r.lens).join(', ');
  return `Audit failed: ${rerunAuthor.length} lens(es) fired — ${lenses}. Test Author must re-run.`;
}

/** Functional flavour for tests + scripts. */
export async function review(
  input: ReviewerInput,
  deps: ReviewerDeps = {},
  opts: ReviewerOptions = {},
): Promise<ReviewerDecision> {
  return new TestReviewer(deps, opts).review(input);
}

export { REVIEWER_AGENT_ID };
