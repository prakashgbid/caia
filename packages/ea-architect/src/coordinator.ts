/**
 * EaCoordinator — the multi-sub-agent orchestrator that replaces the
 * single-pass EaArchitectAgent for callers who want the full framework.
 *
 * The existing EaArchitectAgent class is preserved for backwards
 * compatibility (round-1 single-pass case). New callers should use
 * EaCoordinator with sub-agent adapters wired via config.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §4–§7.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { aggregateVerdicts } from './aggregation.js';
import type {
  CoordinatorContextDump,
  CoordinatorPlanSubmission,
  CoordinatorPlanType,
  CoordinatorReviewOutcome,
  CoordinatorValidationResult,
  DocStewardAdapter,
  DriftSentinelAdapter,
  PlanReviewerAdapter,
  ResearchConductorAdapter,
  SubAgentId,
  SubAgentVerdict,
  TicketAuditorAdapter
} from './coordinator-types.js';
import { defaultFsAdapter } from './fs-adapter.js';
import { loadRepository, selectRelevantContext } from './repository-loader.js';
import { routeFor } from './routing.js';
import { SignoffComposer } from './signoff-composer.js';
import { buildEvent, InProcessEventBus } from './state.js';
import type {
  Clock,
  EaArchitectConfig,
  EaEventBus,
  EaReviewState,
  FsAdapter
} from './types.js';

const HOME = homedir();
const DEFAULT_REPO_PATH = join(HOME, 'Documents', 'projects', 'caia-ea');
const DEFAULT_INBOX_PATH = join(HOME, 'Documents', 'projects', 'agent-memory', 'INBOX.md');
const DEFAULT_AGENT_MEMORY_PATH = join(HOME, 'Documents', 'projects', 'agent-memory');

/** Extends EaArchitectConfig with sub-agent adapter slots. */
export interface EaCoordinatorConfig extends EaArchitectConfig {
  planReviewer?: PlanReviewerAdapter;
  ticketAuditor?: TicketAuditorAdapter;
  docSteward?: DocStewardAdapter;
  researchConductor?: ResearchConductorAdapter;
  driftSentinel?: DriftSentinelAdapter;
  /** Override the default plan-defender spawner instance. */
  defenderSpawner?: unknown;
  /** Override the signoff dir relative to the repo. */
  signoffComposer?: SignoffComposer;
}

export class EaCoordinator {
  private readonly repositoryPath: string;
  private readonly inboxPath: string;
  private readonly agentMemoryPath: string;
  private readonly fs: FsAdapter;
  private readonly clock: Clock;
  private readonly eventBus: EaEventBus;
  private readonly generateSubmissionId: () => string;
  private readonly composer: SignoffComposer;
  private readonly planReviewer?: PlanReviewerAdapter;
  private readonly ticketAuditor?: TicketAuditorAdapter;
  private readonly docSteward?: DocStewardAdapter;
  private readonly researchConductor?: ResearchConductorAdapter;
  private readonly driftSentinel?: DriftSentinelAdapter;
  private readonly defenderSpawner?: unknown;
  /** Per-submission outcome cache (in-memory). */
  private readonly outcomes = new Map<string, CoordinatorReviewOutcome>();

  constructor(cfg: EaCoordinatorConfig = {}) {
    this.repositoryPath = cfg.repositoryPath ?? DEFAULT_REPO_PATH;
    this.inboxPath = cfg.inboxPath ?? DEFAULT_INBOX_PATH;
    this.agentMemoryPath = cfg.agentMemoryPath ?? DEFAULT_AGENT_MEMORY_PATH;
    this.fs = cfg.fs ?? defaultFsAdapter;
    this.clock = cfg.clock ?? ((): Date => new Date());
    this.eventBus = cfg.eventBus ?? new InProcessEventBus();
    this.generateSubmissionId = cfg.generateSubmissionId ?? defaultIdGenerator();
    this.composer =
      cfg.signoffComposer ??
      new SignoffComposer({ repositoryPath: this.repositoryPath, fs: this.fs, clock: this.clock });
    if (cfg.planReviewer !== undefined) this.planReviewer = cfg.planReviewer;
    if (cfg.ticketAuditor !== undefined) this.ticketAuditor = cfg.ticketAuditor;
    if (cfg.docSteward !== undefined) this.docSteward = cfg.docSteward;
    if (cfg.researchConductor !== undefined) this.researchConductor = cfg.researchConductor;
    if (cfg.driftSentinel !== undefined) this.driftSentinel = cfg.driftSentinel;
    if (cfg.defenderSpawner !== undefined) this.defenderSpawner = cfg.defenderSpawner;
  }

  /** Subscribe to coordinator events. */
  on(eventType: string, handler: (e: import('./types.js').EaReviewEvent) => void | Promise<void>): () => void {
    return this.eventBus.on(eventType, handler);
  }

  /** Get a previously-cached outcome by id. */
  getOutcome(submissionId: string): CoordinatorReviewOutcome | undefined {
    return this.outcomes.get(submissionId);
  }

  /** The unrooted path of the would-be sign-off for a submission. */
  signoffPathFor(submissionId: string): string {
    return this.composer.signoffPath(submissionId);
  }

  /** Validate a submission before any sub-agent runs. */
  validateSubmission(submission: CoordinatorPlanSubmission): CoordinatorValidationResult {
    const route = routeFor(submission.planType);
    if (route.length === 0) {
      return { ok: false, reason: 'unknown-plan-type', detail: `no route for ${submission.planType}` };
    }
    // Context dump only required for plans that involve the Plan Reviewer.
    if (route.includes('ea-plan-reviewer')) {
      const dump = submission.contextDump;
      const dumpPath = submission.contextDumpPath;
      if (dump === undefined && (dumpPath === undefined || !this.fs.exists(dumpPath))) {
        return {
          ok: false,
          reason: 'needs-context-dump',
          detail: 'plan involves Plan Reviewer; an accompanying PlanContextDump is required'
        };
      }
    }
    return { ok: true };
  }

  /**
   * Main entry point — the Coordinator's review() takes a submission, routes
   * to sub-agents, aggregates verdicts, composes a sign-off, and emits state
   * transitions.
   */
  async review(submission: CoordinatorPlanSubmission): Promise<CoordinatorReviewOutcome> {
    const now = this.clock();
    const submissionId = submission.submissionId ?? this.generateSubmissionId();

    // 1. Validate.
    const validation = this.validateSubmission(submission);
    if (!validation.ok) {
      throw new ValidationFailure(validation);
    }

    // 2. Load context dump if path given but not inline.
    const contextDump = await this.resolveContextDump(submission);

    // 3. Route to sub-agents.
    const subAgentsInvoked = [...routeFor(submission.planType)];
    await this.emitTransition(submissionId, submission, null, 'ea-review-pending', now);

    // 4. Load EA repo + pick relevance window (once for all sub-agents).
    const repo = loadRepository(this.repositoryPath, this.agentMemoryPath, this.fs);
    const context = selectRelevantContext(
      repo,
      `${submission.planType} ${submission.planMarkdown}`,
      submission.affectedComponents ?? []
    );

    // 5. Invoke sub-agents in order.
    const verdicts: SubAgentVerdict[] = [];
    for (const subAgent of subAgentsInvoked) {
      const verdict = await this.invokeSubAgent(subAgent, {
        submissionId,
        submission,
        contextDump,
        context,
        iteration: 1,
        repo
      });
      if (verdict !== undefined) verdicts.push(verdict);
    }

    // 6. If approved, give the Steward a chance to file ADRs (if not already
    //    invoked).
    const reviewerVerdict = verdicts.find((v) => v.subAgent === 'ea-plan-reviewer');
    const stewardAlreadyRan = verdicts.some((v) => v.subAgent === 'ea-doc-steward');
    if (
      this.docSteward !== undefined &&
      !stewardAlreadyRan &&
      reviewerVerdict !== undefined &&
      (reviewerVerdict.status === 'approved' || reviewerVerdict.status === 'approved-with-modifications') &&
      ((reviewerVerdict.new_adrs_to_file?.length ?? 0) > 0)
    ) {
      const stewardVerdict = await this.docSteward.file({
        submissionId,
        repo,
        newAdrsToFile: reviewerVerdict.new_adrs_to_file ?? [],
        affectedExistingAdrs: reviewerVerdict.affected_existing_adrs ?? [],
        ...(reviewerVerdict.dialogueLogPath !== undefined ? { dialogueLogPath: reviewerVerdict.dialogueLogPath } : {})
      });
      verdicts.push(stewardVerdict);
      subAgentsInvoked.push('ea-doc-steward');
    }

    // 7. Aggregate.
    const signoffPath = this.composer.signoffPath(submissionId);
    const aggregated = aggregateVerdicts({
      submissionId,
      iteration: 1,
      verdicts,
      reviewedAtIso: this.clock().toISOString(),
      signoffPath
    });

    // 8. Compose + write sign-off.
    const planSlug = slugFromPath(submission.contextDumpPath ?? `${submissionId}.md`);
    this.composer.write({
      outcome: { ...aggregated, subAgentsInvoked } as CoordinatorReviewOutcome,
      planSlug,
      planPath: contextDump.plan_path,
      ...(submission.contextDumpPath !== undefined ? { contextDumpPath: submission.contextDumpPath } : {}),
      generatedAtIso: this.clock().toISOString()
    });

    const outcome: CoordinatorReviewOutcome = { ...aggregated, subAgentsInvoked };
    this.outcomes.set(submissionId, outcome);

    // 9. Emit terminal transition.
    const toState = this.toTerminalState(outcome);
    await this.emitTransition(submissionId, submission, 'ea-review-pending', toState, this.clock());

    return outcome;
  }

  /** Resolve the context dump — inline > path. */
  private async resolveContextDump(submission: CoordinatorPlanSubmission): Promise<CoordinatorContextDump> {
    if (submission.contextDump !== undefined) return submission.contextDump;
    if (submission.contextDumpPath !== undefined && this.fs.exists(submission.contextDumpPath)) {
      const raw = this.fs.readFile(submission.contextDumpPath);
      return JSON.parse(raw) as CoordinatorContextDump;
    }
    // Sub-agents that don't need a dump get a stub.
    return {
      schema_version: 1,
      plan_path: '',
      plan_slug: '',
      producer_agent_id: submission.callerAgentId,
      producer_session_id: '',
      produced_at: this.clock().toISOString(),
      models_used: [],
      reasoning_summary: '',
      decision_points: [],
      sources_consulted: [],
      open_questions: [],
      alternatives_dropped: [],
      invitations_to_scrutiny: [],
      assumptions: []
    };
  }

  /** Dispatch one sub-agent. Returns undefined if the adapter isn't wired. */
  private async invokeSubAgent(
    id: SubAgentId,
    args: {
      submissionId: string;
      submission: CoordinatorPlanSubmission;
      contextDump: CoordinatorContextDump;
      context: import('./types.js').RelevantContext;
      iteration: number;
      repo: import('./types.js').EaRepository;
    }
  ): Promise<SubAgentVerdict | undefined> {
    switch (id) {
      case 'ea-plan-reviewer':
        if (this.planReviewer === undefined) return undefined;
        return this.planReviewer.review({
          submission: args.submission,
          contextDump: args.contextDump,
          submissionId: args.submissionId,
          iteration: args.iteration,
          spawner: this.defenderSpawner
        });
      case 'ea-ticket-auditor':
        if (this.ticketAuditor === undefined) return undefined;
        return this.ticketAuditor.audit({
          submissionId: args.submissionId,
          ticketId: args.submission.affectedComponents?.[0] ?? 'unknown-ticket',
          ticketBody: args.submission.planMarkdown
        });
      case 'ea-doc-steward':
        if (this.docSteward === undefined) return undefined;
        return this.docSteward.file({
          submissionId: args.submissionId,
          repo: args.repo,
          newAdrsToFile: [],
          affectedExistingAdrs: []
        });
      case 'ea-research-conductor':
        if (this.researchConductor === undefined) return undefined;
        return this.researchConductor.request({
          submissionId: args.submissionId,
          topic: args.submission.planMarkdown.split('\n')[0] ?? 'untitled',
          brief: args.submission.planMarkdown,
          requesterAgentId: args.submission.callerAgentId
        });
      case 'ea-drift-sentinel':
        if (this.driftSentinel === undefined) return undefined;
        return this.driftSentinel.processSubmission({
          submissionId: args.submissionId,
          planMarkdown: args.submission.planMarkdown
        });
      default:
        return undefined;
    }
  }

  private toTerminalState(outcome: CoordinatorReviewOutcome): EaReviewState {
    if (outcome.escalation_to_operator !== undefined) return 'ea-review-escalated-to-operator';
    if (outcome.status === 'approved') return 'ea-review-approved';
    if (outcome.status === 'rejected') return 'ea-review-rejected';
    if (outcome.status === 'approved-with-modifications') return 'ea-review-conditional-approval';
    return 'ea-review-revisions-requested';
  }

  private async emitTransition(
    submissionId: string,
    submission: CoordinatorPlanSubmission,
    fromState: EaReviewState | null,
    toState: EaReviewState,
    at: Date
  ): Promise<void> {
    const stubOutcome: import('./types.js').ReviewOutcome = {
      status: 'approved',
      reasoning: '',
      cited_adrs: [],
      cited_principles: [],
      cited_lessons: [],
      submissionId,
      iteration: 1,
      reviewedAtIso: at.toISOString(),
      modelTier: 'sonnet'
    };
    const planTypeProj: import('./types.js').PlanType = projectPlanType(submission.planType);
    const event = buildEvent({
      submissionId,
      callerAgentId: submission.callerAgentId,
      planType: planTypeProj,
      iteration: 1,
      fromState,
      toState,
      outcome: stubOutcome,
      at
    });
    await this.eventBus.emit(event);
  }
}

export class ValidationFailure extends Error {
  constructor(public readonly result: CoordinatorValidationResult) {
    super(`Coordinator validation failed: ${result.reason} — ${result.detail ?? ''}`);
  }
}

function projectPlanType(t: CoordinatorPlanType): import('./types.js').PlanType {
  switch (t) {
    case 'research':
    case 'spec':
    case 'implementation':
    case 'architecture-change':
    case 'process-change':
      return t;
    case 'implementation-plan':
      return 'implementation';
    case 'ticket-completeness-check':
    case 'repository-maintenance':
    case 'drift-alert':
      return 'process-change';
    case 'research-request':
      return 'research';
    default:
      return 'research';
  }
}

function slugFromPath(p: string): string {
  const base = p.replace(/\\/g, '/').split('/').pop() ?? p;
  return base.replace(/\.[^.]+$/, '');
}

function defaultIdGenerator(): () => string {
  let counter = 0;
  return (): string => {
    counter += 1;
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `eareview-${ts}-${counter}-${rand}`;
  };
}
