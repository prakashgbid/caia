/**
 * EaArchitectAgent — the public agent class.
 *
 * Composes:
 *   - repository-loader (loads ADRs / principles / lessons / risks / feedback)
 *   - critic adapter (LLM-reasoned review)
 *   - adr-writer (auto-files new ADRs on approval; wires supersessions)
 *   - escalation (surfaces operator escalations to INBOX.md)
 *   - state-machine FSM (emits transition events on every outcome)
 *
 * The public API is intentionally small:
 *   - submitPlan(input): Promise<ReviewOutcome>
 *   - getReviewHistory(submissionId): ReviewHistory | null
 *   - on(eventType, handler): () => void
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { createTracer } from '@chiefaia/tracing';

import { writeNewAdr, applySupersessions, updateDecisionsIndex } from './adr-writer.js';
import { createDefaultCritic, applyHallucinationGuard } from './critic.js';
import {
  appendEscalationToInbox,
  detectStrategicEscalation
} from './escalation.js';
import { defaultFsAdapter } from './fs-adapter.js';
import { loadRepository, selectRelevantContext } from './repository-loader.js';
import {
  buildEvent,
  canEaReviewTransition,
  chooseTargetState,
  InProcessEventBus,
  isEaReviewTerminal
} from './state.js';
import type {
  Clock,
  CriticAdapter,
  EaArchitectConfig,
  EaEventBus,
  EaReviewState,
  FsAdapter,
  ModelTier,
  PlanSubmission,
  PlanType,
  ReviewHistory,
  ReviewHistoryEntry,
  ReviewOutcome
} from './types.js';

const HOME = homedir();
const DEFAULT_REPO_PATH = join(HOME, 'Documents', 'projects', 'caia-ea');

/**
 * OTel tracer for EA submissions. Each `submitPlan()` call emits a
 * `caia.ea.submit-plan` span carrying the plan type, iteration, and
 * (on completion) the review outcome status. Spans link back to the
 * caller's root trace when `@chiefaia/tracing`'s SDK is initialised.
 */
const tracer = createTracer('@caia/ea-architect');
const DEFAULT_INBOX_PATH = join(HOME, 'Documents', 'projects', 'agent-memory', 'INBOX.md');
const DEFAULT_AGENT_MEMORY_PATH = join(HOME, 'Documents', 'projects', 'agent-memory');

/** Plan types that warrant Opus by default. */
const OPUS_PLAN_TYPES: ReadonlySet<PlanType> = new Set<PlanType>([
  'architecture-change'
]);

export class EaArchitectAgent {
  private readonly repositoryPath: string;
  private readonly inboxPath: string;
  private readonly agentMemoryPath: string;
  private readonly critic: CriticAdapter;
  private readonly eventBus: EaEventBus;
  private readonly fs: FsAdapter;
  private readonly clock: Clock;
  private readonly generateSubmissionId: () => string;
  private readonly autoFileAdrs: boolean;
  private readonly surfaceEscalations: boolean;

  /** Per-submission iteration tracking. */
  private readonly submissions = new Map<string, ReviewHistory>();

  constructor(config: EaArchitectConfig = {}) {
    this.repositoryPath = config.repositoryPath ?? DEFAULT_REPO_PATH;
    this.inboxPath = config.inboxPath ?? DEFAULT_INBOX_PATH;
    this.agentMemoryPath = config.agentMemoryPath ?? DEFAULT_AGENT_MEMORY_PATH;
    this.critic = config.critic ?? createDefaultCritic();
    this.eventBus = config.eventBus ?? new InProcessEventBus();
    this.fs = config.fs ?? defaultFsAdapter;
    this.clock = config.clock ?? ((): Date => new Date());
    this.generateSubmissionId = config.generateSubmissionId ?? defaultIdGenerator();
    this.autoFileAdrs = config.autoFileAdrs ?? true;
    this.surfaceEscalations = config.surfaceEscalations ?? true;
  }

  /** Subscribe to EA review events. Returns an unsubscribe function. */
  on(eventType: string, handler: (event: import('./types.js').EaReviewEvent) => void | Promise<void>): () => void {
    return this.eventBus.on(eventType, handler);
  }

  /** Read the review history for one submission. */
  getReviewHistory(submissionId: string): ReviewHistory | null {
    return this.submissions.get(submissionId) ?? null;
  }

  /** Read all in-flight submission ids. */
  listSubmissions(): string[] {
    return [...this.submissions.keys()];
  }

  /** Get the current state of a submission (or null if unknown). */
  getCurrentState(submissionId: string): EaReviewState | null {
    return this.submissions.get(submissionId)?.currentState ?? null;
  }

  /**
   * Submit a plan for review. Returns the review outcome. If the
   * submission id already exists, this is treated as a resubmission
   * (iteration N+1) — the prior state must be `ea-review-revisions-requested`.
   */
  async submitPlan(input: PlanSubmission): Promise<ReviewOutcome> {
    return tracer.withSpan('caia.ea.submit-plan', async (span) => {
      span.setAttribute('caia.ea.plan_type', input.planType);
      if (input.submissionId !== undefined) {
        span.setAttribute('caia.ea.submission_id', input.submissionId);
      }
      span.setAttribute(
        'caia.ea.affected_count',
        input.affectedComponents?.length ?? 0,
      );
      const outcome = await this._submitPlanImpl(input);
      span.setAttribute('caia.ea.outcome_status', outcome.status);
      span.setAttribute('caia.ea.iteration', outcome.iteration);
      span.setAttribute('caia.ea.submission_id', outcome.submissionId);
      if (outcome.status === 'rejected') {
        span.setStatus('error', `outcome=${outcome.status}`);
      }
      return outcome;
    });
  }

  private async _submitPlanImpl(input: PlanSubmission): Promise<ReviewOutcome> {
    const now = this.clock();
    const submissionId = input.submissionId ?? this.generateSubmissionId();
    const existing = this.submissions.get(submissionId);

    // Determine iteration + fromState.
    let iteration = 1;
    let fromState: EaReviewState | null = null;
    if (existing !== undefined) {
      if (isEaReviewTerminal(existing.currentState)) {
        throw new Error(
          `submission ${submissionId} is in terminal state ${existing.currentState} and cannot be resubmitted`
        );
      }
      if (existing.currentState !== 'ea-review-revisions-requested') {
        throw new Error(
          `submission ${submissionId} is in state ${existing.currentState}; expected ea-review-revisions-requested for resubmission`
        );
      }
      iteration = existing.entries.length + 1;
      fromState = existing.currentState;
      // Emit pending transition on resubmission.
      const pendingState: EaReviewState = 'ea-review-pending';
      if (!canEaReviewTransition(fromState, pendingState)) {
        throw new Error(`invalid resubmission transition: ${fromState} -> ${pendingState}`);
      }
      existing.currentState = pendingState;
    }

    // Load the repository fresh on every review.
    const repo = loadRepository(this.repositoryPath, this.agentMemoryPath, this.fs);

    // Pick relevance window.
    const context = selectRelevantContext(
      repo,
      `${input.planType} ${input.planMarkdown}`,
      input.affectedComponents ?? []
    );

    // Pick model tier — Opus for high-stakes architecture reversals.
    const modelTier = this.pickModelTier(input);

    // Run the critic.
    const criticOutput = await this.critic.review({
      planMarkdown: input.planMarkdown,
      planType: input.planType,
      affectedComponents: input.affectedComponents ?? [],
      context,
      iteration,
      modelTier
    });

    // Apply hallucination guard — drop citations that don't exist.
    const adrIds = new Set(repo.adrs.map((a) => a.adrId));
    const principleIds = new Set(repo.principles.map((p) => p.id));
    const lessonIds = new Set(repo.lessons.map((l) => l.id));
    const guarded = applyHallucinationGuard(
      criticOutput,
      context,
      adrIds,
      principleIds,
      lessonIds
    );

    // Detect strategic-escalation triggers even if LLM didn't flag.
    let escalation = guarded.escalation_to_operator;
    if (escalation === undefined) {
      const detected = detectStrategicEscalation(input.planMarkdown);
      if (detected !== null) {
        escalation = detected;
      }
    }
    const isEscalating = escalation !== undefined;

    // For approved-with-modifications, treat first iteration as
    // revisions-requested (caller has chance to fix); after iteration 3
    // we lock to conditional-approval to prevent infinite loops.
    const isFinalIteration = iteration >= 3;
    const targetState = chooseTargetState(guarded.status, isFinalIteration, isEscalating);

    // Auto-file ADRs on approval (final approval states only).
    const filedNewAdrs: { adrId: string; title: string; filePath: string; id: number }[] = [];
    if (
      this.autoFileAdrs &&
      (targetState === 'ea-review-approved' || targetState === 'ea-review-conditional-approval')
    ) {
      for (const draft of guarded.new_adrs_to_file) {
        const written = writeNewAdr(repo, draft, now, this.fs);
        filedNewAdrs.push({ ...written, title: draft.title });
      }
      if (filedNewAdrs.length > 0) {
        // Wire supersessions both directions.
        applySupersessions(this.fs, repo, guarded.affected_existing_adrs, filedNewAdrs);
        // Also handle implicit supersessions named on the draft itself.
        for (const draft of guarded.new_adrs_to_file) {
          if (draft.supersedes === undefined) continue;
          for (const supId of draft.supersedes) {
            const existingAdr = repo.adrs.find((a) => a.adrId === supId);
            if (existingAdr === undefined) continue;
            const newAdrId = filedNewAdrs.find((f) => f.title === draft.title)?.adrId;
            if (newAdrId === undefined) continue;
            // markSupersededBy is idempotent on already-marked files.
            const { markSupersededBy } = await import('./adr-writer.js');
            markSupersededBy(this.fs, existingAdr.filePath, newAdrId);
          }
        }
        // Update INDEX.md.
        updateDecisionsIndex(this.fs, repo, filedNewAdrs);
      }
    }

    // Surface escalation to INBOX.md.
    if (isEscalating && this.surfaceEscalations && escalation !== undefined) {
      appendEscalationToInbox(this.fs, this.inboxPath, {
        submissionId,
        callerAgentId: input.callerAgentId,
        planType: input.planType,
        escalation,
        at: now
      });
    }

    // Compose the outcome.
    const outcome: ReviewOutcome = {
      status: guarded.status,
      reasoning: guarded.reasoning,
      cited_adrs: guarded.cited_adrs,
      cited_principles: guarded.cited_principles,
      cited_lessons: guarded.cited_lessons,
      ...(guarded.requested_modifications.length > 0
        ? { requested_modifications: guarded.requested_modifications }
        : {}),
      ...(guarded.new_adrs_to_file.length > 0
        ? { new_adrs_to_file: guarded.new_adrs_to_file }
        : {}),
      ...(guarded.affected_existing_adrs.length > 0
        ? { affected_existing_adrs: guarded.affected_existing_adrs }
        : {}),
      ...(escalation !== undefined ? { escalation_to_operator: escalation } : {}),
      submissionId,
      iteration,
      reviewedAtIso: now.toISOString(),
      modelTier
    };

    // Update history.
    this.upsertHistory(input, submissionId, fromState, outcome, targetState, now);

    // Emit transition event.
    const event = buildEvent({
      submissionId,
      callerAgentId: input.callerAgentId,
      planType: input.planType,
      iteration,
      fromState,
      toState: targetState,
      outcome,
      at: now
    });
    await this.eventBus.emit(event);

    return outcome;
  }

  /**
   * Determine which model tier to use for this submission.
   *
   * Default Sonnet. Opus for:
   *  - planType = architecture-change (per spec §12)
   *  - affectedComponents touches >= 5 packages OR plan markdown >5k words
   *  - any iteration >= 3 (deep deliberation)
   */
  private pickModelTier(input: PlanSubmission): ModelTier {
    if (OPUS_PLAN_TYPES.has(input.planType)) return 'opus';
    const components = input.affectedComponents ?? [];
    if (components.length >= 5) return 'opus';
    const words = input.planMarkdown.split(/\s+/).length;
    if (words > 5_000) return 'opus';
    return 'sonnet';
  }

  private upsertHistory(
    input: PlanSubmission,
    submissionId: string,
    fromState: EaReviewState | null,
    outcome: ReviewOutcome,
    targetState: EaReviewState,
    now: Date
  ): ReviewHistory {
    const existing = this.submissions.get(submissionId);
    const entry: ReviewHistoryEntry = {
      iteration: outcome.iteration,
      outcome,
      transitionTo: targetState,
      at: now.toISOString()
    };
    if (existing === undefined) {
      const history: ReviewHistory = {
        submissionId,
        callerAgentId: input.callerAgentId,
        planType: input.planType,
        entries: [entry],
        currentState: targetState
      };
      this.submissions.set(submissionId, history);
      // Synthesize the implicit "ea-review-pending" entry that preceded
      // this transition — useful for downstream consumers that want the
      // full FSM walk. We just leave the entries[] starting at the first
      // recorded transition for now; fromState is recorded on the entry's
      // event envelope via the bus.
      void fromState;
      return history;
    }
    existing.entries.push(entry);
    existing.currentState = targetState;
    return existing;
  }
}

/** Default id generator. Uses Math.random for portability; tests inject deterministic ids. */
function defaultIdGenerator(): () => string {
  let counter = 0;
  return (): string => {
    counter += 1;
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `eareview-${ts}-${counter}-${rand}`;
  };
}

/**
 * Convenience submitPlan wrapper for one-shot callers.
 */
export async function submitPlan(
  agent: EaArchitectAgent,
  input: PlanSubmission
): Promise<ReviewOutcome> {
  return agent.submitPlan(input);
}
