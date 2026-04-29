/**
 * Per-agent regression — Test-Design Agent.
 *
 * Asserts the Test-Design Agent's contract:
 *   - Every valid story gets `testDesignStatus = 'designed'`.
 *   - The persisted ticket carries `testCases[]` with ≥1 entry.
 *   - Every test case has a category (happy / edge / error /
 *     accessibility / security / performance / visual) and a layer
 *     (unit / integration / e2e / visual / accessibility).
 *   - Per-case `test.case_added` events fire and at least one
 *     aggregate `test.cases_generated` event fires.
 */

import { eq } from 'drizzle-orm';
import { stories, events } from '../../../src/db/schema';
import { TicketTemplateV1Schema } from '@chiefaia/ticket-template';
import { createTestDb, wireBusToTestDb } from '../_helpers/db';
import { drivePipeline } from '../_helpers/pipeline';
import { designTestCasesForTicket } from '../../../src/agents/test-design-agent';
import { TICKET_TEMPLATE_VERSION } from '@chiefaia/ticket-template';

describe('Per-agent regression — Test-Design Agent', () => {
  it('designs at least one test case per valid story', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_td_basic',
        promptBody: 'add a user profile page with avatar upload',
        stopAfter: 'test_designed',
      },
      db,
    );

    const valid = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, 'prm_td_basic'))
      .all()
      .filter((s) => s.templateValidationStatus === 'valid');
    expect(valid.length).toBeGreaterThan(0);

    for (const s of valid) {
      expect(s.testDesignStatus).toBe('designed');
      const ticket = TicketTemplateV1Schema.parse(JSON.parse(s.agentContributionsJson));
      expect(ticket.testCases?.length ?? 0).toBeGreaterThan(0);
      for (const tc of ticket.testCases ?? []) {
        expect([
          'happy',
          'edge',
          'error',
          'accessibility',
          'security',
          'performance',
          'visual',
        ]).toContain(tc.category);
        expect(['unit', 'integration', 'e2e', 'visual', 'accessibility']).toContain(tc.layer);
        expect(tc.title).toBeTruthy();
      }
    }
  }, 60_000);

  it('fires per-case test.case_added + aggregate test.cases_generated events', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    await drivePipeline(
      {
        promptId: 'prm_td_events',
        promptBody: 'add a contact form with name, email, message',
        stopAfter: 'test_designed',
      },
      db,
    );

    const allEvents = db.select().from(events).all();
    const cases = allEvents.filter((e) => e.type === 'test.case_added');
    const generated = allEvents.filter((e) => e.type === 'test.cases_generated');
    expect(cases.length).toBeGreaterThan(0);
    expect(generated.length).toBeGreaterThan(0);
  }, 60_000);

  // ─── Pure-function regressions ──────────────────────────────────────────

  it('designTestCasesForTicket returns a schema-conformant testDesign block', () => {
    const ticket = {
      acceptanceCriteria: [
        'User can upload an avatar',
        'Avatar is rendered on the profile page',
        'Avatar is < 5MB',
      ],
      scope: { summary: 'avatar upload' },
      agentSections: {
        ui: { framework: 'react' },
        api: { route: 'POST /api/avatar' },
        security: { requiredHeaders: ['X-CSRF-Token'] },
      },
      metadata: { templateVersion: TICKET_TEMPLATE_VERSION },
    };
    const out = designTestCasesForTicket(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ticket as any,
      {
        storyId: 'story_pure',
        promptId: 'prm_pure',
        correlationId: 'cor_pure',
        idFactory: (() => {
          let i = 0;
          return () => `tc-pure-${i++}`;
        })(),
      },
    );
    expect(out.testCases.length).toBeGreaterThan(0);
    expect(out.testDesign.designedBy).toBe('test-design-agent');
    // Category counts must sum to total test cases.
    const sum = Object.values(out.testDesign.categoryCounts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(out.testCases.length);
  });
});
