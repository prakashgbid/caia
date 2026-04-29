/**
 * Behavioural tests for getTicketBundle — the self-contained ticket bundle
 * assembler used by GET /stories/:id/bundle and the phase1-e2e test.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import {
  entityLabels,
  prompts,
  requirements,
  stories,
  taskBuckets,
} from '../../src/db/schema';
import { TicketTemplateV1Schema, buildDraftTicket } from '@chiefaia/ticket-template';
import { getTicketBundle } from '../../src/api/ticket-bundle';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function seedFixture(db: ReturnType<typeof createTestDb>) {
  const promptId = 'prm_bundle';
  const requirementId = 'req_bundle';
  const storyId = 'story_bundle_main';
  const upstreamStoryId = 'story_bundle_upstream';
  const downstreamStoryId = 'story_bundle_downstream';
  const bucketId = 'bkt_seq_auth_000';

  db.insert(prompts)
    .values({
      id: promptId,
      body: 'login',
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId: 'cor_bundle',
      hash: 'h_bundle',
      status: 'ready_for_pickup',
    })
    .run();

  db.insert(requirements)
    .values({
      id: requirementId,
      title: 'Login epic',
      description: 'epic',
      state: 'captured',
      priority: 3,
      labels: '[]',
      rootPromptId: promptId,
      parentEntityType: 'initiative',
      parentEntityId: 'init_1',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .run();

  db.insert(taskBuckets)
    .values({
      id: bucketId,
      kind: 'sequential',
      domainSlug: 'auth',
      promptId,
      createdAt: Date.now(),
      sequenceIndex: 0,
      status: 'open',
    })
    .run();

  // Build a valid ticket and store it as agent_contributions_json.
  const draft = buildDraftTicket({
    rootPromptId: promptId,
    requirementId,
    domainPrimary: 'auth',
    domainAll: ['auth', 'api-integration'],
    nature: 'feature',
    complexity: 'medium',
    summary: 'Add OAuth login',
    inScope: ['Google OAuth'],
    acceptanceCriteria: ['ac1', 'ac2', 'ac3'],
    verificationPlan: ['pnpm test'],
    upstream: [upstreamStoryId],
  });
  const ticket = {
    ...draft,
    agentSections: {
      architecture: {
        contributedBy: 'ea-agent',
        contributedAt: Date.now(),
        adrReferences: [],
        constraints: [],
        notes: 'arch notes',
      },
    },
    baEnrichment: {
      enrichedBy: 'ba-agent',
      enrichedAt: Date.now(),
      inputsRequested: [],
      completenessChecksPassed: true,
      notes: '',
    },
  };

  db.insert(stories)
    .values({
      id: upstreamStoryId,
      kind: 'story',
      title: 'Upstream story',
      description: '',
      dependsOnJson: '[]',
      status: 'pending',
      rootPromptId: promptId,
      createdAt: nowIso(),
    })
    .run();

  db.insert(stories)
    .values({
      id: storyId,
      kind: 'story',
      title: 'OAuth login story',
      description: 'Implement OAuth login.',
      acceptanceCriteriaJson: '[]',
      dependsOnJson: JSON.stringify([upstreamStoryId]),
      status: 'pending',
      rootPromptId: promptId,
      parentEntityType: 'requirement',
      parentEntityId: requirementId,
      createdAt: nowIso(),
      bucketId,
      templateVersion: 'v1',
      templateValidationStatus: 'valid',
      templateValidationErrors: null,
      agentContributionsJson: JSON.stringify(ticket),
      enrichedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();

  // Downstream story depends on the main one.
  db.insert(stories)
    .values({
      id: downstreamStoryId,
      kind: 'story',
      title: 'Downstream story',
      description: '',
      dependsOnJson: JSON.stringify([storyId]),
      status: 'pending',
      rootPromptId: promptId,
      createdAt: nowIso(),
    })
    .run();

  db.insert(entityLabels)
    .values({
      id: 'lbl_main_auth',
      entityKind: 'story',
      entityId: storyId,
      labelSlug: 'auth',
      labelType: 'domain',
      confidence: 0.95,
      source: 'classifier',
      createdAt: Date.now(),
    })
    .run();

  return { promptId, requirementId, storyId, upstreamStoryId, downstreamStoryId, bucketId };
}

describe('getTicketBundle', () => {
  it('returns null for an unknown story id', () => {
    const db = createTestDb();
    expect(getTicketBundle(db, 'missing')).toBeNull();
  });

  it('returns a fully-populated bundle for a placed, enriched story', () => {
    const db = createTestDb();
    const fx = seedFixture(db);
    const bundle = getTicketBundle(db, fx.storyId)!;
    expect(bundle).toBeTruthy();

    expect(bundle.story.id).toBe(fx.storyId);
    expect(bundle.story.bucketId).toBe(fx.bucketId);
    expect(bundle.story.templateValidationStatus).toBe('valid');
    expect(bundle.ticket).not.toBeNull();
    expect(bundle.ticketParseError).toBeNull();

    // Linked entities
    expect(bundle.prompt?.id).toBe(fx.promptId);
    expect(bundle.requirement?.id).toBe(fx.requirementId);
    expect(bundle.bucket?.id).toBe(fx.bucketId);
    expect(bundle.bucket?.kind).toBe('sequential');
    expect(bundle.bucket?.domainSlug).toBe('auth');

    // Labels
    expect(bundle.labels).toHaveLength(1);
    expect(bundle.labels[0]!.labelSlug).toBe('auth');

    // Dependencies
    expect(bundle.dependencies.upstream).toEqual([fx.upstreamStoryId]);
    expect(bundle.dependencies.downstream).toEqual([fx.downstreamStoryId]);
  });

  it('round-trips the embedded ticket through TicketTemplateV1Schema', () => {
    const db = createTestDb();
    const fx = seedFixture(db);
    const bundle = getTicketBundle(db, fx.storyId)!;
    const parsed = TicketTemplateV1Schema.safeParse(bundle.ticket);
    expect(parsed.success).toBe(true);
  });

  it('returns ticket=null with a parse error when agent_contributions_json is malformed', () => {
    const db = createTestDb();
    const fx = seedFixture(db);
    db.update(stories)
      .set({ agentContributionsJson: '{not json' })
      .where(eq(stories.id, fx.storyId))
      .run();
    const bundle = getTicketBundle(db, fx.storyId)!;
    expect(bundle.ticket).toBeNull();
    expect(bundle.ticketParseError).toMatch(/JSON\.parse failed/);
  });

  it('returns ticket=null with no parse error when agent_contributions_json is the default {}', () => {
    const db = createTestDb();
    db.insert(prompts)
      .values({
        id: 'prm_empty',
        body: 'x',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId: 'cor_empty',
        hash: 'h_empty',
        status: 'received',
      })
      .run();
    db.insert(stories)
      .values({
        id: 'story_empty',
        kind: 'story',
        title: 'Bare story',
        description: '',
        rootPromptId: 'prm_empty',
        createdAt: nowIso(),
      })
      .run();
    const bundle = getTicketBundle(db, 'story_empty')!;
    expect(bundle.ticket).toBeNull();
    expect(bundle.ticketParseError).toBeNull();
  });

  // ─── TEST-006 — testCases + testDesign flow through the bundle ────────
  it('round-trips testCases and testDesign on the parsed ticket payload', () => {
    const db = createTestDb();
    const fx = seedFixture(db);

    // Patch the embedded ticket payload to include a designed test_cases
    // array, mirroring what the Test-Design Agent persists.
    const story = db.select().from(stories).where(eq(stories.id, fx.storyId)).get();
    const ticket = JSON.parse(story!.agentContributionsJson);
    const designedAt = 1_700_000_001_000;
    ticket.testCases = [
      {
        id: 'tc-001',
        title: 'happy path',
        category: 'happy',
        layer: 'integration',
        given: 'a precondition',
        when: 'an action',
        then: 'an outcome',
        selectorHints: [],
        mocks: [],
        required: true,
        status: 'pending',
        designedBy: 'test-design-agent',
        designedAt,
      },
      {
        id: 'tc-002',
        title: 'error path',
        category: 'error',
        layer: 'integration',
        given: 'a bad request',
        when: 'it hits the API',
        then: 'a 400 is returned',
        selectorHints: [],
        mocks: [],
        required: true,
        status: 'pending',
        designedBy: 'test-design-agent',
        designedAt,
      },
    ];
    ticket.testDesign = {
      designedBy: 'test-design-agent',
      designedAt,
      totalCases: 2,
      categoryCounts: {
        happy: 1, edge: 0, error: 1,
        accessibility: 0, security: 0, performance: 0, visual: 0,
      },
      notes: 'unit test fixture',
    };
    ticket.metadata.testDesignedAt = designedAt;
    ticket.metadata.lastUpdatedAt = designedAt;

    db.update(stories)
      .set({
        agentContributionsJson: JSON.stringify(ticket),
        testCasesJson: JSON.stringify(ticket.testCases),
        testDesignedAt: designedAt,
        testDesignStatus: 'designed',
      })
      .where(eq(stories.id, fx.storyId))
      .run();

    const bundle = getTicketBundle(db, fx.storyId)!;
    expect(bundle.ticket).not.toBeNull();
    expect(bundle.ticket!.testCases).toHaveLength(2);
    expect(bundle.ticket!.testDesign?.totalCases).toBe(2);
    expect(bundle.ticket!.testDesign?.categoryCounts.happy).toBe(1);
    expect(bundle.ticket!.testDesign?.categoryCounts.error).toBe(1);

    const parsed = TicketTemplateV1Schema.safeParse(bundle.ticket);
    expect(parsed.success).toBe(true);
  });
});
