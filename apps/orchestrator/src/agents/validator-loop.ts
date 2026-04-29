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
  judge?: JudgeAdapter;
  maxAttempts?: number;
  /** Re-invoke BA between attempts? Default true; tests use false to avoid mutating fixtures. */
  reInvokeBA?: boolean;
}

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

export async function runValidatorLoop(
  input: ValidatorLoopInput,
  db: Db,
  options: ValidatorLoopOptions = {},
): Promise<ValidatorLoopOutput> {
  const { promptId, correlationId } = input;
  const maxAttempts = options.maxAttempts ?? VERDICT_THRESHOLDS.maxAttempts;
  const reInvokeBA = options.reInvokeBA ?? true;

  const allStories = db
    .select()
    .from(stories)
    .where(eq(stories.rootPromptId, promptId))
    .all();

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

      if (attempt < maxAttempts) {
        if (reInvokeBA) {
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
            /* swallow; next attempt's validator will surface */
          }
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

    if (!outcome) continue;
  }

  // Advance the prompt-level `validated` stage once per loop.
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
