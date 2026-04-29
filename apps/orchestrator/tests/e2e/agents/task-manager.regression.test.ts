/**
 * Per-agent regression — Task Manager (Bucket Placer + Task Scheduler).
 *
 * Asserts the Task Manager's contract:
 *   - Every story is placed in a bucket (sequential or parallel).
 *   - Sequential buckets are keyed by (project_slug, tech_sub_domain).
 *   - The parallel bucket is per-prompt.
 *   - The `bucket_placed` and `ready_for_pickup` pipeline stages are
 *     advanced.
 *   - `ticket.ready-for-pickup` fires per story.
 *   - `task-scheduler.scheduling.complete` fires once per prompt.
 */

import { eq } from 'drizzle-orm';
import { stories, taskBuckets, events, promptPipelineStages } from '../../../src/db/schema';
import { createTestDb, wireBusToTestDb } from '../_helpers/db';
import { drivePipeline } from '../_helpers/pipeline';

describe('Per-agent regression — Task Manager (Bucket Placer + Task Scheduler)', () => {
  it('places every story in a bucket and advances ready_for_pickup', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_tm_place',
        promptBody: 'add a user profile page with avatar upload',
      },
      db,
    );

    const storyRows = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, 'prm_tm_place'))
      .all();
    expect(storyRows.length).toBeGreaterThan(0);
    for (const s of storyRows) {
      expect(s.bucketId).toBeTruthy();
    }

    const bucketsForPrompt = db
      .select()
      .from(taskBuckets)
      .where(eq(taskBuckets.promptId, 'prm_tm_place'))
      .all();
    expect(bucketsForPrompt.length).toBeGreaterThan(0);

    // Every bucket must be either sequential (with a domain) or parallel.
    for (const b of bucketsForPrompt) {
      if (b.kind === 'sequential') {
        expect(b.techSubDomain ?? b.domainSlug).toBeTruthy();
      } else {
        expect(b.kind).toBe('parallel');
      }
    }

    // Stages reached.
    const stages = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_tm_place'))
      .all()
      .map((r) => r.stage);
    expect(stages).toContain('bucket_placed');
    expect(stages).toContain('ready_for_pickup');
  }, 60_000);

  it('emits ticket.ready-for-pickup per story and scheduling.complete once', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_tm_events',
        promptBody: 'add a contact form',
      },
      db,
    );

    const storyRows = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, 'prm_tm_events'))
      .all();

    const allEvents = db.select().from(events).all();
    const ready = allEvents.filter(
      (e) => e.type === 'ticket.ready-for-pickup' && e.correlationId === 'prm_tm_events',
    );
    expect(ready.length).toBe(storyRows.length);

    const scheduling = allEvents.filter(
      (e) =>
        e.type === 'task-scheduler.scheduling.complete' &&
        e.correlationId === 'prm_tm_events',
    );
    expect(scheduling.length).toBe(1);
  }, 60_000);
});
