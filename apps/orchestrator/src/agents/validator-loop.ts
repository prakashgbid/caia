/**
 * Validator orchestration loop — VAL-005.
 *
 * Wires the BA → Validator → re-invoke-BA cycle into the pipeline. Called
 * by the scaffolder between BA enrichment and Test-Design.
 *
 * For each story enriched by BA:
 *   1. Run the Story Validator agent.
 *   2. If passed, advance the prompt-level pipeline stage to `validated`
 *      and continue.
 *   3. If failed and attempts remain, re-invoke BA on this story alone
 *      with the validation report as feedback context, then re-run the
 *      validator. Max attempts capped by VERDICT_THRESHOLDS.maxAttempts.
 *   4. If still failed after retries, file a `validation-stuck` blocker
 *      and mark the story `validation_status = 'escalated'`. Subsequent
 *      stages (Test-Design, Task Scheduler) skip escalated stories.
 *
 * Per-story decisions, cumulative pass/fail counts, and escalation events
 * are emitted on the bus so the dashboard can surface live progress.
 */

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { VERDICT_THRESHOLDS } from '@chiefaia/ticket-template';
import { eventBus } from '../events/bus-adapter';
import type { Db } from '../db/connection';
import { blockers, stories } from '../db/schema';
import { runBAAgent } from './ba-agent';
import {
  STAGE_VALIDATED,
  advancePipelineStage,
} from './pipeline-stages';
import {
  runStoryValidatorAgent,
  type JudgeAdapter,
  type StoryValidatorOutput,
} from './story-validator-agent';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ValidatorLoopInput {
  promptId: string;
  correlationId: string;
}

export interface ValidatorLoopOutput {
  storiesValidated: number;
  storiesPassed: number;
  storiesFailed: number;
  storiesEscalated: number;
  perStoryAttempts: Array<{
    storyId: string;
    attempts: number;
    finalStatus: 'passed' | 'escalated';
    score: number;
  }>;
}

export interface ValidatorLoopOptions {
  /** Pluggable judge — mainly for tests. Production uses the default localLlmRouterJudge. */
  judge?: JudgeAdapter;
  /** Max attempts. Defaults to VERDICT_THRESHOLDS.maxAttempts. */
  maxAttempts?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * File a blocker row capturing the failed validation report, so the
 * dashboard's `/blockers` page surfaces a human-actionable item and
 * the orchestrator's audit log records the escalation.
 */
function fileEscalationBlocker(args: {
  db: Db;
  promptId: string;
  storyId: string;
  correlationId: string;
  validatorOutput: StoryValidatorOutput;
}): string {
  const { db, promptId, storyId, correlationId, validatorOutput } = args;
  const blockerId = `blk_${nanoid(12)}`;
  const now = new Date().toISOString();

  const summary =
    validatorOutput.report.failedChecks
      .slice(0, 5)
      .map((f) => `[${f.severity}] ${f.section ?? ''}: ${f.message}`)
      .join('\n') || 'Validator escalated this story after exhausting retry attempts.';

  db.insert(blockers)
    .values({
      id: blockerId,
      title: `Validator escalation: story ${storyId.slice(0, 12)} after ${validatorOutput.attemptNumber} attempts`,
      severity: 'high',
      kind: 'validation-stuck',
      description: summary,
      resolutionSteps: JSON.stringify(
        validatorOutput.report.fixSuggestions.slice(0, 5),
      ),
      links: JSON.stringify([{ kind: 'story', id: storyId }]),
      state: 'open',
      rootPromptId: promptId,
      parentEntityType: 'story',
      parentEntityId: storyId,
      createdAt: now,
    })
    .run();

  // Patch the story row with the blocker id (visible from the bundle viewer).
  // We don't fail loudly here — escalation is the primary outcome.
  try {
    eventBus.publish({
      type: 'story.validation_escalated',
      actor: 'story-validator',
      correlation_id: correlationId,
      entity_type: 'story',
      entity_id: storyId,
      payload: {
        storyId,
        promptId,
        correlationId,
        attemptNumber: validatorOutput.attemptNumber,
        blockerId,
      },
    });
  } catch {
    /* event bus may not be wired in tests */
  }

  return blockerId;
}

// ─── Main loop ──────────────────────────────────────────────────────────────

/**
 * Run the validator orchestration loop for every story under a prompt.
 * Called from the scaffolder chain between `runBAAgent` and the
 * test-design / task-scheduler stages.
 */
export async function runValidatorLoop(
  input: ValidatorLoopInput,
  db: Db,
  options: ValidatorLoopOptions = {},
): Promise<ValidatorLoopOutput> {
  const { promptId, correlationId } = input;
  const maxAttempts = options.maxAttempts ?? VERDICT_THRESHOLDS.maxAttempts;

  const allStories = db
    .select()
    .from(stories)
    .where(eq(stories.rootPromptId, promptId))
    .all();

  // Skip stories that aren't BA-enriched yet (template_validation_status != valid)
  // — they can't pass the validator anyway. Also skip already-passed stories
  // (idempotency safeguard if the loop is invoked twice).
  const eligibleStories = allStories.filter(
    (s) =>
      s.templateValidationStatus === 'valid' &&
      s.validationStatus !== 'passed' &&
      s.validationStatus !== 'escalated',
  );

  let passed = 0;
  let failed = 0;
  let escalated = 0;
  const perStoryAttempts: ValidatorLoopOutput['perStoryAttempts'] = [];

  for (const story of eligibleStories) {
    let attempt = 1;
    let outcome: StoryValidatorOutput | null = null;

    while (attempt <= maxAttempts) {
      // Per-story pass: run validator with skipStageAdvancement so we
      // advance the prompt-level stage exactly once at the end.
      outcome = await runStoryValidatorAgent(
        {
          storyId: story.id,
          promptId,
          correlationId,
          attemptNumber: attempt,
        },
        db,
        { judge: options.judge, skipStageAdvancement: true },
      );

      if (outcome.passed) {
        passed++;
        perStoryAttempts.push({
          storyId: story.id,
          attempts: attempt,
          finalStatus: 'passed',
          score: outcome.score,
        });
        break;
      }

      // Failed. If attempts left → re-invoke BA on this story with the
      // validation report as feedback. The BA agent's existing entry
      // point doesn't accept "feedback" yet (TODO follow-up VAL-005a:
      // teach BA to consume previousValidationReport from the story
      // record). For now we simply re-run BA over the requirement —
      // the BA picks up the latest story state and re-enriches.
      if (attempt < maxAttempts) {
        try {
          await runBAAgent(
            {
              promptId,
              requirementId: story.parentEntityId ?? undefined,
              correlationId: `${correlationId}::retry-${attempt}::${story.id}`,
              collabTimeoutMs: 1_500,
            },
            db,
          );
        } catch {
          // BA failure during retry — let next attempt's validator surface it.
        }
        attempt++;
        continue;
      }

      // Out of attempts → escalate.
      escalated++;
      failed++;
      fileEscalationBlocker({
        db,
        promptId,
        storyId: story.id,
        correlationId,
        validatorOutput: outcome,
      });
      perStoryAttempts.push({
        storyId: story.id,
        attempts: attempt,
        finalStatus: 'escalated',
        score: outcome.score,
      });
      break;
    }

    if (!outcome) continue; // defensive — loop ran zero iterations
  }

  // Advance the prompt-level `validated` stage once per loop, regardless of
  // per-story outcomes (escalated stories don't gate the prompt — Test-Design
  // and Task-Scheduler skip them based on `validation_status`).
  advancePipelineStage(
    {
      promptId,
      stage: STAGE_VALIDATED,
      correlationId,
      metadata: {
        storiesPassed: passed,
        storiesFailed: failed,
        storiesEscalated: escalated,
        totalEligible: eligibleStories.length,
      },
    },
    db,
  );

  return {
    storiesValidated: eligibleStories.length,
    storiesPassed: passed,
    storiesFailed: failed,
    storiesEscalated: escalated,
    perStoryAttempts,
  };
}
