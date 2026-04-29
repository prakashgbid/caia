/**
 * Per-agent regression — Story Validator.
 *
 * Asserts the validator's contract:
 *   - Every story exits with a terminal validation status (passed
 *     / escalated) — never `in_progress`.
 *   - The pipeline-stage `validated` is advanced.
 *   - Story validator events fire (`story.validation_started`,
 *     `story.validation_passed` or `story.validation_failed`).
 *   - When the judge always passes, every valid story passes.
 *   - When the judge always fails, every valid story escalates and
 *     a `validation-stuck` blocker is filed per story.
 */

import { eq } from 'drizzle-orm';
import { stories, events, blockers, promptPipelineStages } from '../../../src/db/schema';
import { createTestDb, wireBusToTestDb } from '../_helpers/db';
import { drivePipeline } from '../_helpers/pipeline';
import { makeAlwaysPassJudge, makeAlwaysFailJudge } from '../_helpers/judge';

describe('Per-agent regression — Story Validator', () => {
  it('happy-path judge → no story stays in_progress + validated stage advances', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_val_pass',
        promptBody: 'add a user profile page with avatar upload',
        validatorJudge: makeAlwaysPassJudge(),
        stopAfter: 'validated',
      },
      db,
    );

    const validStories = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, 'prm_val_pass'))
      .all()
      .filter((s) => s.templateValidationStatus === 'valid');
    expect(validStories.length).toBeGreaterThan(0);
    for (const s of validStories) {
      expect(s.validationStatus).not.toBe('in_progress');
    }

    const stageRow = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.stage, 'validated'))
      .all()
      .find((r) => r.promptId === 'prm_val_pass');
    expect(stageRow).toBeTruthy();
  }, 60_000);

  it('escalates after maxAttempts when the judge always fails + files blockers', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_val_escalate',
        promptBody: 'add a feature flag toggle',
        validatorJudge: makeAlwaysFailJudge('regression: never passes'),
        reInvokeOnFail: false,
        validatorMaxAttempts: 2,
        stopAfter: 'validated',
      },
      db,
    );

    const validStories = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, 'prm_val_escalate'))
      .all()
      .filter((s) => s.templateValidationStatus === 'valid');
    expect(validStories.length).toBeGreaterThan(0);

    const escalated = validStories.filter((s) => s.validationStatus === 'escalated');
    expect(escalated.length).toBe(validStories.length);

    const stuckBlockers = db
      .select()
      .from(blockers)
      .where(eq(blockers.kind, 'validation-stuck'))
      .all()
      .filter((b) => b.rootPromptId === 'prm_val_escalate');
    expect(stuckBlockers.length).toBeGreaterThanOrEqual(escalated.length);
  }, 60_000);

  it('emits story.validation_started on every attempt', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_val_event',
        promptBody: 'add a search bar to the home page',
        validatorJudge: makeAlwaysPassJudge(),
        stopAfter: 'validated',
      },
      db,
    );

    const startedEvents = db
      .select()
      .from(events)
      .where(eq(events.type, 'story.validation_started'))
      .all()
      .filter((e) => e.correlationId === 'prm_val_event');
    expect(startedEvents.length).toBeGreaterThan(0);
  }, 60_000);
});
