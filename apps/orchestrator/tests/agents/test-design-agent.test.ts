/**
 * TEST-004 — unit tests for the Test-Design Agent.
 *
 * Covers:
 *   - Pure designTestCasesForTicket() — output shape, category coverage,
 *     bound enforcement, schema validity.
 *   - runTestDesignAgent() — DB round-trip, status transitions, event
 *     emissions, idempotency.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories, prompts, events as eventsTable } from '../../src/db/schema';
import {
  designTestCasesForTicket,
  runTestDesignAgent,
} from '../../src/agents/test-design-agent';
import {
  buildDraftTicket,
  TICKET_TEMPLATE_VERSION,
  type TicketTemplateV1,
  validateTicket,
} from '@chiefaia/ticket-template';
import { eventBus } from '../../src/events/bus-adapter';
import { wireEventBus } from '../../src/events/bus-adapter';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  wireEventBus(db);
  return db;
}

function isoNow() {
  return new Date().toISOString();
}

const ts = 1_700_000_000_000;

function makeEnrichedTicket(opts: {
  ui?: boolean;
  api?: boolean;
  database?: boolean;
  security?: boolean;
}): TicketTemplateV1 {
  const draft = buildDraftTicket({
    rootPromptId: 'prm_test_004',
    requirementId: 'req_test_004',
    domainPrimary: 'auth',
    domainAll: ['auth', 'ui-frontend'],
    nature: 'feature',
    complexity: 'medium',
    summary: 'Implement login form with rate-limit warning.',
    inScope: ['Login form', 'Rate-limit banner'],
    acceptanceCriteria: [
      'A user can log in with valid credentials and is redirected to /dashboard',
      'After 5 failed attempts the rate-limit banner appears',
      'The form is fully keyboard-navigable and meets WCAG 2.1 AA',
    ],
    verificationPlan: ['pnpm test:integration auth-login'],
    poDecomposedAt: ts,
  });

  const sections: TicketTemplateV1['agentSections'] = {};
  if (opts.ui) {
    sections.ui = {
      contributedBy: 'ui-agent',
      contributedAt: ts,
      components: ['LoginForm'],
      designSystemPattern: 'form/standard',
      accessibilityRequirements: [
        'All inputs have visible labels',
        'Errors are announced to screen readers',
      ],
    };
  }
  if (opts.api) {
    sections.api = {
      contributedBy: 'api-agent',
      contributedAt: ts,
      routes: [{ method: 'POST', path: '/api/auth/login' }],
      errorContract: '{ "error": string, "retryAfter"?: number }',
    };
  }
  if (opts.database) {
    sections.database = {
      contributedBy: 'dba-agent',
      contributedAt: ts,
      schemaChanges: ['CREATE INDEX user_email_idx ON users(email)'],
      reversibility: 'reversible',
      indexImpact: '<1ms additional write cost',
    };
  }
  if (opts.security) {
    sections.security = {
      contributedBy: 'security-agent',
      contributedAt: ts,
      threatModel: ['credential-stuffing'],
      requiredHeaders: ['Strict-Transport-Security', 'X-Content-Type-Options'],
      authzNotes: 'Public endpoint; rate-limited.',
    };
  }

  return {
    ...draft,
    agentSections: sections,
  };
}

let _id = 0;
const idFactory = () => `tc-${(_id += 1).toString(36)}`;

describe('designTestCasesForTicket', () => {
  beforeEach(() => {
    _id = 0;
  });

  it('produces at least one happy-path case per acceptance criterion', () => {
    const ticket = makeEnrichedTicket({ ui: true });
    const out = designTestCasesForTicket(ticket, {
      storyId: 'sty_a',
      promptId: 'prm_a',
      correlationId: 'cor_a',
      now: () => ts,
      idFactory,
    });
    const happyForAC = out.testCases.filter(
      (tc) => tc.category === 'happy' && typeof tc.linkedAcceptanceCriterionIndex === 'number',
    );
    expect(happyForAC.length).toBeGreaterThanOrEqual(ticket.acceptanceCriteria.length);
  });

  it('emits accessibility cases when the UI section is present', () => {
    const ticket = makeEnrichedTicket({ ui: true });
    const out = designTestCasesForTicket(ticket, {
      storyId: 'sty_b',
      promptId: 'prm_b',
      correlationId: 'cor_b',
      now: () => ts,
      idFactory,
    });
    expect(out.testCases.some((tc) => tc.category === 'accessibility')).toBe(true);
  });

  it('emits security cases when the security section is present', () => {
    const ticket = makeEnrichedTicket({ ui: true, api: true, security: true });
    const out = designTestCasesForTicket(ticket, {
      storyId: 'sty_c',
      promptId: 'prm_c',
      correlationId: 'cor_c',
      now: () => ts,
      idFactory,
    });
    expect(out.testCases.some((tc) => tc.category === 'security')).toBe(true);
  });

  it('emits visual cases only when a UI section is present', () => {
    const withUi = designTestCasesForTicket(makeEnrichedTicket({ ui: true }), {
      storyId: 'sty_d',
      promptId: 'prm_d',
      correlationId: 'cor_d',
      now: () => ts,
      idFactory,
    });
    const withoutUi = designTestCasesForTicket(makeEnrichedTicket({ api: true }), {
      storyId: 'sty_e',
      promptId: 'prm_e',
      correlationId: 'cor_e',
      now: () => ts,
      idFactory,
    });
    expect(withUi.testCases.some((tc) => tc.category === 'visual')).toBe(true);
    expect(withoutUi.testCases.some((tc) => tc.category === 'visual')).toBe(false);
  });

  it('produces a valid TicketTemplateV1 when folded into the ticket', () => {
    const ticket = makeEnrichedTicket({ ui: true, api: true, security: true });
    const out = designTestCasesForTicket(ticket, {
      storyId: 'sty_v',
      promptId: 'prm_v',
      correlationId: 'cor_v',
      now: () => ts,
      idFactory,
    });
    const folded: TicketTemplateV1 = {
      ...ticket,
      testCases: out.testCases,
      testDesign: out.testDesign,
      metadata: {
        ...ticket.metadata,
        templateVersion: TICKET_TEMPLATE_VERSION,
        testDesignedAt: ts,
        lastUpdatedAt: ts,
      },
    };
    const v = validateTicket(folded);
    expect(v.ok).toBe(true);
  });

  it('produces unique test case ids', () => {
    const ticket = makeEnrichedTicket({ ui: true, api: true, security: true });
    const out = designTestCasesForTicket(ticket, {
      storyId: 'sty_u',
      promptId: 'prm_u',
      correlationId: 'cor_u',
      now: () => ts,
      idFactory,
    });
    const ids = out.testCases.map((tc) => tc.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caps total cases at MAX_TEST_CASES (50)', () => {
    // Build a ticket with the max ACs to exercise the upper bound.
    const ticket = {
      ...makeEnrichedTicket({ ui: true, api: true, database: true, security: true }),
      acceptanceCriteria: Array.from({ length: 10 }, (_, i) => `AC ${i + 1}`),
    };
    const out = designTestCasesForTicket(ticket, {
      storyId: 'sty_max',
      promptId: 'prm_max',
      correlationId: 'cor_max',
      now: () => ts,
      idFactory,
    });
    expect(out.testCases.length).toBeLessThanOrEqual(50);
    expect(out.testDesign.totalCases).toBe(out.testCases.length);
  });

  it('stamps designedBy=test-design-agent on every case', () => {
    const ticket = makeEnrichedTicket({ ui: true });
    const out = designTestCasesForTicket(ticket, {
      storyId: 'sty_stamp',
      promptId: 'prm_stamp',
      correlationId: 'cor_stamp',
      now: () => ts,
      idFactory,
    });
    expect(out.testCases.every((tc) => tc.designedBy === 'test-design-agent')).toBe(true);
    expect(out.testDesign.designedBy).toBe('test-design-agent');
  });
});

// ─── runTestDesignAgent — DB integration ─────────────────────────────────────

function seedStory(
  db: ReturnType<typeof createTestDb>,
  opts: { id: string; promptId: string; ticket: TicketTemplateV1 },
) {
  // Make sure the prompt row exists; the TS schema requires it for FK refs
  // even though we don't enforce them in SQLite by default.
  db.insert(prompts)
    .values({
      id: opts.promptId,
      body: 'design-test-prompt',
      receivedAt: isoNow(),
      receivedVia: 'api',
      correlationId: `cor_${opts.promptId}`,
      hash: `hash_${opts.id}`,
      status: 'received',
    })
    .onConflictDoNothing()
    .run();

  db.insert(stories)
    .values({
      id: opts.id,
      kind: 'story',
      title: opts.ticket.scope.summary,
      description: '',
      acceptanceCriteriaJson: JSON.stringify(opts.ticket.acceptanceCriteria),
      verificationPlanJson: JSON.stringify(opts.ticket.verificationPlan),
      dependsOnJson: '[]',
      createdAt: isoNow(),
      rootPromptId: opts.promptId,
      parentEntityId: opts.ticket.context.requirementId,
      parentEntityType: 'requirement',
      agentContributionsJson: JSON.stringify(opts.ticket),
      templateVersion: 'v1',
      templateValidationStatus: 'valid',
    })
    .run();
}

describe('runTestDesignAgent', () => {
  it('designs tests for every valid story and persists them', async () => {
    const db = createTestDb();
    const ticket = makeEnrichedTicket({ ui: true, api: true });
    seedStory(db, { id: 'sty_run_1', promptId: 'prm_run_1', ticket });

    const out = await runTestDesignAgent(
      {
        promptId: 'prm_run_1',
        correlationId: 'cor_run_1',
        now: () => ts,
        idFactory,
      },
      db,
    );

    expect(out.designedStories).toBe(1);
    expect(out.totalTestCases).toBeGreaterThan(0);
    expect(out.storiesErrored).toBe(0);

    const row = db.select().from(stories).where(eq(stories.id, 'sty_run_1')).get();
    expect(row?.testDesignStatus).toBe('designed');
    expect(row?.testDesignedAt).toBe(ts);
    const persisted = JSON.parse(row!.testCasesJson);
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted.length).toBe(out.totalTestCases);
  });

  it('skips stories with templateValidationStatus != valid', async () => {
    const db = createTestDb();
    const ticket = makeEnrichedTicket({ ui: true });
    seedStory(db, { id: 'sty_skip', promptId: 'prm_skip', ticket });
    db.update(stories)
      .set({ templateValidationStatus: 'invalid' })
      .where(eq(stories.id, 'sty_skip'))
      .run();

    const out = await runTestDesignAgent(
      { promptId: 'prm_skip', correlationId: 'cor_skip', now: () => ts, idFactory },
      db,
    );

    expect(out.designedStories).toBe(0);
    expect(out.storiesSkipped).toBe(1);
  });

  it('is idempotent — re-running does not duplicate work', async () => {
    const db = createTestDb();
    const ticket = makeEnrichedTicket({ api: true });
    seedStory(db, { id: 'sty_idem', promptId: 'prm_idem', ticket });

    const first = await runTestDesignAgent(
      { promptId: 'prm_idem', correlationId: 'cor_idem', now: () => ts, idFactory },
      db,
    );
    expect(first.designedStories).toBe(1);

    const second = await runTestDesignAgent(
      { promptId: 'prm_idem', correlationId: 'cor_idem', now: () => ts, idFactory },
      db,
    );
    expect(second.designedStories).toBe(0);
    expect(second.storiesSkipped).toBe(1);
  });

  it('emits one test.cases_generated and N test.case_added per story', async () => {
    const db = createTestDb();
    const ticket = makeEnrichedTicket({ ui: true, api: true });
    seedStory(db, { id: 'sty_evt', promptId: 'prm_evt', ticket });

    const aggregateEvts: unknown[] = [];
    const perCaseEvts: unknown[] = [];
    const unsub1 = eventBus.subscribe('test.cases_generated', (e) => aggregateEvts.push(e));
    const unsub2 = eventBus.subscribe('test.case_added', (e) => perCaseEvts.push(e));

    const out = await runTestDesignAgent(
      { promptId: 'prm_evt', correlationId: 'cor_evt', now: () => ts, idFactory },
      db,
    );

    expect(aggregateEvts.length).toBe(1);
    expect(perCaseEvts.length).toBe(out.totalTestCases);

    unsub1();
    unsub2();
  });

  it('persists updatedTicket back into agentContributionsJson', async () => {
    const db = createTestDb();
    const ticket = makeEnrichedTicket({ ui: true });
    seedStory(db, { id: 'sty_payload', promptId: 'prm_payload', ticket });

    await runTestDesignAgent(
      { promptId: 'prm_payload', correlationId: 'cor_p', now: () => ts, idFactory },
      db,
    );

    const row = db.select().from(stories).where(eq(stories.id, 'sty_payload')).get();
    const parsed = JSON.parse(row!.agentContributionsJson) as TicketTemplateV1;
    expect(parsed.testCases.length).toBeGreaterThan(0);
    expect(parsed.testDesign?.designedBy).toBe('test-design-agent');
    expect(parsed.metadata.testDesignedAt).toBe(ts);
    expect(validateTicket(parsed).ok).toBe(true);
  });

  it('marks stories with malformed ticket payload as errored', async () => {
    const db = createTestDb();
    db.insert(prompts)
      .values({
        id: 'prm_bad',
        body: 'x',
        receivedAt: isoNow(),
        receivedVia: 'api',
        correlationId: 'cor_bad',
        hash: 'h_bad',
        status: 'received',
      })
      .run();
    db.insert(stories)
      .values({
        id: 'sty_bad',
        kind: 'story',
        title: 'broken',
        description: '',
        acceptanceCriteriaJson: '[]',
        verificationPlanJson: '[]',
        dependsOnJson: '[]',
        createdAt: isoNow(),
        rootPromptId: 'prm_bad',
        parentEntityId: 'req_bad',
        parentEntityType: 'requirement',
        agentContributionsJson: 'not-json{',
        templateVersion: 'v1',
        templateValidationStatus: 'valid',
      })
      .run();

    const out = await runTestDesignAgent(
      { promptId: 'prm_bad', correlationId: 'cor_bad', now: () => ts, idFactory },
      db,
    );
    expect(out.storiesErrored).toBe(1);

    const row = db.select().from(stories).where(eq(stories.id, 'sty_bad')).get();
    expect(row?.testDesignStatus).toBe('error');
  });

  it('routes design work strictly under the requested requirementId when provided', async () => {
    const db = createTestDb();
    const a = makeEnrichedTicket({ api: true });
    const b = makeEnrichedTicket({ ui: true });
    b.context.requirementId = 'req_other';

    seedStory(db, { id: 'sty_under', promptId: 'prm_filter', ticket: a });
    seedStory(db, { id: 'sty_other', promptId: 'prm_filter', ticket: b });

    const out = await runTestDesignAgent(
      {
        promptId: 'prm_filter',
        requirementId: 'req_test_004',
        correlationId: 'cor_filter',
        now: () => ts,
        idFactory,
      },
      db,
    );
    expect(out.designedStories).toBe(1);

    const designed = db.select().from(stories).where(eq(stories.id, 'sty_under')).get();
    const skipped = db.select().from(stories).where(eq(stories.id, 'sty_other')).get();
    expect(designed?.testDesignStatus).toBe('designed');
    expect(skipped?.testDesignStatus).toBe('pending');
  });

  it('persists test events to the events table', async () => {
    const db = createTestDb();
    const ticket = makeEnrichedTicket({ ui: true });
    seedStory(db, { id: 'sty_persist', promptId: 'prm_persist', ticket });

    await runTestDesignAgent(
      { promptId: 'prm_persist', correlationId: 'cor_persist', now: () => ts, idFactory },
      db,
    );

    const allEvents = db.select().from(eventsTable).all();
    const types = allEvents.map((e) => e.type);
    expect(types).toContain('test.cases_generated');
    expect(types).toContain('test.case_added');
  });
});
