/**
 * Validator orchestration loop — VAL-005 + VAL-009.
 *
 * Wires the BA → EA → Validator → re-invoke-(BA|EA) cycle into the
 * pipeline. Called by the scaffolder between EA enrichment and
 * Test-Design.
 *
 * For each story enriched by BA + EA:
 *   1. Run the Story Validator agent.
 *   2. If passed, count and continue.
 *   3. If failed and attempts remain, classify the failed checks by
 *      ownership:
 *        - All BA-owned (scope, acceptanceCriteria, agentSections.* except
 *          architecture/architecturalInstructions/taxonomy) → re-invoke BA.
 *        - All EA-owned (architecturalInstructions, taxonomy/risk/effort
 *          choices, agentSections.architecture) → re-invoke EA.
 *        - Mixed → re-invoke BOTH (BA first since it changes scope, then EA
 *          re-classifies on the updated scope).
 *      Then re-run the validator. Capped at VERDICT_THRESHOLDS.maxAttempts.
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
import { runEAAgent } from './ea-agent';
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
    reInvokedAgents?: Array<'ba-agent' | 'ea-agent'>;
  }>;
}

export interface ValidatorLoopOptions {
  judge?: JudgeAdapter;
  maxAttempts?: number;
  /** Re-invoke BA / EA between attempts? Default true; tests use false to avoid mutating fixtures. */
  reInvokeOnFail?: boolean;
}

// ─── Failed-check ownership classification (VAL-009) ───────────────────────

/**
 * Sections that are populated/owned by the EA agent. If a validator failure
 * lands on one of these, re-invoke EA on the next attempt.
 *
 * We use prefix matching so e.g. `agentSections.architecture.notes` is
 * correctly attributed to EA (architecture section is EA-owned), and
 * `architecturalInstructions.<domain>` (when ARCH-### lands the field)
 * is also EA-owned.
 *
 * The taxonomy block (risk/effort/lifecycle/techSubDomains) is also EA
 * territory — EA classifies these in BUCKET-003. Failures there route to EA.
 */
const EA_OWNED_PREFIXES = [
  'agentSections.architecture',
  'architecturalInstructions',
  'taxonomy',
] as const;

/** Anything not classified as EA-owned defaults to BA (BA owns the bulk of the ticket). */
function classifyFailureOwner(section: string | undefined): 'ba' | 'ea' {
  if (!section) return 'ba';
  for (const prefix of EA_OWNED_PREFIXES) {
    if (section === prefix || section.startsWith(`${prefix}.`) || section.startsWith(`${prefix}[`)) {
      return 'ea';
    }
  }
  return 'ba';
}

/**
 * Decide which agent(s) to re-invoke given a list of failed checks.
 * Returns an ordered list — BA before EA when both fire, since BA changes
 * scope/AC and EA re-classifies on top of the updated scope.
 */
export function selectAgentsToReinvoke(
  failedChecks: Array<{ section?: string }>,
): Array<'ba-agent' | 'ea-agent'> {
  const owners = new Set<'ba' | 'ea'>();
  for (const f of failedChecks) {
    owners.add(classifyFailureOwner(f.section));
  }
  const out: Array<'ba-agent' | 'ea-agent'> = [];
  if (owners.has('ba')) out.push('ba-agent');
  if (owners.has('ea')) out.push('ea-agent');
  // If neither matched (shouldn't happen — failedChecks would be empty), fall back to BA.
  if (out.length === 0) out.push('ba-agent');
  return out;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

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

async function reInvokeAgents(
  agents: Array<'ba-agent' | 'ea-agent'>,
  args: { promptId: string; requirementId?: string; correlationId: string },
  db: Db,
): Promise<void> {
  for (const agent of agents) {
    try {
      if (agent === 'ba-agent') {
        await runBAAgent(
          {
            promptId: args.promptId,
            requirementId: args.requirementId,
            correlationId: `${args.correlationId}::ba`,
            collabTimeoutMs: 1_500,
          },
          db,
        );
      } else {
        // EA Agent doesn't currently accept requirementId scoping — it
        // re-classifies all stories under the prompt. That's acceptable
        // here: the loop is per-story anyway, and the validator runs after
        // EA so cross-story EA changes are caught on the next iteration.
        await runEAAgent(
          {
            promptId: args.promptId,
            correlationId: `${args.correlationId}::ea`,
          },
          db,
        );
      }
    } catch {
      /* swallow; the next attempt's validator will surface the consequence */
    }
  }
}

// ─── Main loop ─────────────────────────────────────────────────────────────

export async function runValidatorLoop(
  input: ValidatorLoopInput,
  db: Db,
  options: ValidatorLoopOptions = {},
): Promise<ValidatorLoopOutput> {
  const { promptId, correlationId } = input;
  const maxAttempts = options.maxAttempts ?? VERDICT_THRESHOLDS.maxAttempts;
  const reInvokeOnFail = options.reInvokeOnFail ?? true;

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
    const reInvokedAgents: Array<'ba-agent' | 'ea-agent'> = [];

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
          ...(reInvokedAgents.length > 0 && { reInvokedAgents }),
        });
        break;
      }

      if (attempt < maxAttempts) {
        // VAL-009: classify failures and re-invoke owning agent(s).
        if (reInvokeOnFail) {
          const agents = selectAgentsToReinvoke(outcome.report.failedChecks);
          for (const a of agents) reInvokedAgents.push(a);
          await reInvokeAgents(
            agents,
            {
              promptId,
              requirementId: story.parentEntityId ?? undefined,
              correlationId: `${correlationId}::retry-${attempt}::${story.id}`,
            },
            db,
          );
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
        ...(reInvokedAgents.length > 0 && { reInvokedAgents }),
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
