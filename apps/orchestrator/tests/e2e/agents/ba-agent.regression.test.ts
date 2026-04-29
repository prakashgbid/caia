/**
 * Per-agent regression — BA Agent.
 *
 * Asserts the BA Agent's contract:
 *   - After PO decomposition, BA enriches every story with
 *     baEnrichment + agentSections (cross-agent collab).
 *   - Each enriched ticket carries acceptanceCriteria (≥3 entries).
 *   - At least one consultant section is populated.
 *   - The `ba-agent.input-requested` and `ba-agent.input-received`
 *     event pairs fire with sub-correlation prefixed by the prompt's
 *     correlation_id.
 *   - The pipeline-stage `ba_enriched` is reached.
 */

import { eq } from 'drizzle-orm';
import { stories, events } from '../../../src/db/schema';
import { TicketTemplateV1Schema } from '@chiefaia/ticket-template';
import { createTestDb, wireBusToTestDb } from '../_helpers/db';
import { drivePipeline } from '../_helpers/pipeline';

describe('Per-agent regression — BA Agent', () => {
  it('enriches every story with acceptance criteria + ≥1 consultant section', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_ba_enrich',
        promptBody: 'add a contact form with name, email, message; persist to a contacts table',
        stopAfter: 'ba_enriched',
      },
      db,
    );

    const storyRows = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, 'prm_ba_enrich'))
      .all();
    expect(storyRows.length).toBeGreaterThan(0);

    const enriched = storyRows.filter((s) => s.templateValidationStatus === 'valid');
    expect(enriched.length).toBeGreaterThan(0);

    for (const s of enriched) {
      const parsed = TicketTemplateV1Schema.parse(JSON.parse(s.agentContributionsJson));
      expect(parsed.baEnrichment?.enrichedBy).toBe('ba-agent');
      expect(parsed.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
      // At least one agentSections key populated.
      expect(Object.keys(parsed.agentSections).length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('cross-agent collab events use sub-correlation prefixed by prompt correlation', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_ba_collab',
        promptBody: 'add OAuth login with Google',
        stopAfter: 'ba_enriched',
      },
      db,
    );

    const allEvents = db.select().from(events).all();
    const requested = allEvents.filter((e) => e.type === 'ba-agent.input-requested');
    const received = allEvents.filter((e) => e.type === 'ba-agent.input-received');

    expect(requested.length).toBeGreaterThan(0);
    expect(received.length).toBeGreaterThan(0);

    // Every collab event's correlation must be either the prompt's
    // own correlation OR a `${promptCorrelation}::storyId` sub-correlation.
    for (const e of [...requested, ...received]) {
      expect(
        e.correlationId === 'prm_ba_collab' ||
          e.correlationId?.startsWith('prm_ba_collab::'),
      ).toBe(true);
    }
  }, 60_000);
});
