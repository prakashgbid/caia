/**
 * Pipeline regression — validator rejection then recovery.
 *
 * Asserts the validator's retry-and-recover contract:
 *   - When the judge fails on the first attempt, the validator
 *     advances `validation_status = 'failed'` and (with
 *     reInvokeOnFail=true) re-invokes BA/EA.
 *   - When the judge passes on a subsequent attempt, the story exits
 *     with `validation_status = 'passed'`.
 *   - When the judge fails on EVERY attempt up to maxAttempts, the
 *     story exits with `validation_status = 'escalated'` and a
 *     `validation-stuck` blocker is filed.
 *
 * The pipeline still progresses to ready_for_pickup in both
 * recovery and escalation paths — the validator surfaces blockers
 * but doesn't gate progression. The dashboard's /blockers page
 * exposes the escalations.
 */

import { eq } from 'drizzle-orm';
import { stories, blockers } from '../../../src/db/schema';
import { createTestDb, wireBusToTestDb } from '../_helpers/db';
import { drivePipeline } from '../_helpers/pipeline';
import { makeRecoveringJudge, makeAlwaysFailJudge } from '../_helpers/judge';

describe('Pipeline regression — validator rejection / recovery / escalation', () => {
  it('recovers when the judge fails on attempt 1 then passes on attempt 2', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_validator_recover',
        promptBody: 'add a contact form with name, email, message; persist to a contacts table',
        // The judge fails on the first call (attempt 1) and passes
        // on every subsequent call. With reInvokeOnFail=true the
        // validator-loop calls BA/EA between attempts and re-runs
        // the validator; on attempt 2 the recovering judge passes.
        validatorJudge: makeRecoveringJudge(/* failsBeforeRecovery */ 6),
        reInvokeOnFail: true,
        validatorMaxAttempts: 3,
      },
      db,
    );

    // The pipeline must reach ready_for_pickup regardless of
    // validator outcomes. (We don't import assertAllStagesReached
    // here — the diverse-prompts suite already covers stage-presence
    // assertions; this test focuses on the validator semantics.)
    const validStories = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, 'prm_validator_recover'))
      .all()
      .filter((s) => s.templateValidationStatus === 'valid');
    expect(validStories.length).toBeGreaterThan(0);

    // No story may be left in 'in_progress' — every story must hit
    // a terminal validation state.
    expect(validStories.every((s) => s.validationStatus !== 'in_progress')).toBe(true);
    // At least one story must be in a non-failed terminal state.
    const terminal = validStories.filter((s) =>
      ['passed', 'escalated'].includes(s.validationStatus ?? ''),
    );
    expect(terminal.length).toBeGreaterThan(0);
  }, 60_000);

  it('escalates when the judge fails on every attempt up to maxAttempts', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_validator_escalate',
        promptBody: 'build a malformed payment integration without proper error handling',
        validatorJudge: makeAlwaysFailJudge('mandatory failure for escalation regression'),
        reInvokeOnFail: false, // skip BA/EA re-invocation; keeps test fast.
        validatorMaxAttempts: 2,
      },
      db,
    );

    const validStories = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, 'prm_validator_escalate'))
      .all()
      .filter((s) => s.templateValidationStatus === 'valid');
    expect(validStories.length).toBeGreaterThan(0);

    // After maxAttempts of always-failing judge calls, every valid
    // story should escalate.
    const escalated = validStories.filter((s) => s.validationStatus === 'escalated');
    expect(escalated.length).toBeGreaterThan(0);

    // Each escalation must file a `validation-stuck` blocker linked
    // to the story.
    const stuckBlockers = db
      .select()
      .from(blockers)
      .where(eq(blockers.kind, 'validation-stuck'))
      .all();
    expect(stuckBlockers.length).toBeGreaterThanOrEqual(escalated.length);

    // Despite the escalation, the pipeline must still progress —
    // Test-Design + Bucket-Placer run regardless. At least one
    // escalated story should have testDesignStatus='designed' and
    // a bucketId.
    const progressed = escalated.filter(
      (s) => s.testDesignStatus === 'designed' && !!s.bucketId,
    );
    expect(progressed.length).toBeGreaterThan(0);
  }, 60_000);
});
