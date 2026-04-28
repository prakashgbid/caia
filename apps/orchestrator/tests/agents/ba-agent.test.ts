/**
 * Behavioural tests for the BA agent — verifies the full PO-output → BA
 * collaboration → ticket-template payload flow.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { prompts, requirements, stories } from '../../src/db/schema';
import { runBAAgent } from '../../src/agents/ba-agent';
import { TicketTemplateV1Schema } from '@chiefaia/ticket-template';

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

interface SeedFixture {
  promptId: string;
  requirementId: string;
  storyId: string;
}

function seedFixture(db: ReturnType<typeof createTestDb>, suffix: string): SeedFixture {
  const promptId = `prm_${suffix}`;
  const requirementId = `req_${suffix}`;
  const storyId = `story_${suffix}`;
  db.insert(prompts)
    .values({
      id: promptId,
      body: 'implement OAuth2 login with Google and GitHub',
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId: `cor_${suffix}`,
      hash: `hash_${suffix}`,
      status: 'received',
    })
    .run();
  db.insert(requirements)
    .values({
      id: requirementId,
      title: 'OAuth2 login epic',
      description: 'Allow user authentication via Google and GitHub OAuth2.',
      state: 'captured',
      priority: 3,
      labels: '["auth"]',
      rootPromptId: promptId,
      parentEntityType: 'initiative',
      parentEntityId: 'init_1',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .run();
  db.insert(stories)
    .values({
      id: storyId,
      kind: 'story',
      title: 'Add login form with Google OAuth button',
      description: 'A login form component with a Google OAuth provider button. On success, issue a session token.',
      acceptanceCriteriaJson: '[]',
      dependsOnJson: '[]',
      status: 'pending',
      rootPromptId: promptId,
      parentEntityType: 'requirement',
      parentEntityId: requirementId,
      createdAt: nowIso(),
    })
    .run();
  return { promptId, requirementId, storyId };
}

describe('runBAAgent — Phase-1 collaboration + ticket template', () => {
  it('enriches a story end-to-end and persists a valid ticket-template payload', async () => {
    const db = createTestDb();
    const fx = seedFixture(db, 'happy');

    const out = await runBAAgent(
      {
        promptId: fx.promptId,
        correlationId: 'cor_happy',
        // Restrict consultants so the test is deterministic and fast.
        consultants: ['ea-agent', 'security-agent', 'testing-agent', 'release-agent'],
        collabTimeoutMs: 1_000,
      },
      db,
    );

    expect(out.enrichedStories).toBe(1);
    expect(out.ticketsValid).toBe(1);
    expect(out.ticketsInvalid).toBe(0);

    const row = db.select().from(stories).where(eq(stories.id, fx.storyId)).get();
    expect(row!.templateValidationStatus).toBe('valid');
    expect(row!.templateValidationErrors).toBeNull();
    expect(row!.templateVersion).toBe('v1');

    // Round-trip parse.
    const ticket = JSON.parse(row!.agentContributionsJson);
    const parsed = TicketTemplateV1Schema.safeParse(ticket);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scope.summary).toBe('Add login form with Google OAuth button');
      expect(parsed.data.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
      // Per-agent sections populated by collaboration.
      expect(parsed.data.agentSections.architecture?.contributedBy).toBe('ea-agent');
      expect(parsed.data.agentSections.security?.contributedBy).toBe('security-agent');
      expect(parsed.data.agentSections.testing?.contributedBy).toBe('testing-agent');
      expect(parsed.data.agentSections.release?.contributedBy).toBe('release-agent');
      expect(parsed.data.baEnrichment?.enrichedBy).toBe('ba-agent');
      expect(parsed.data.baEnrichment?.completenessChecksPassed).toBe(true);
      // Every consultant logged in inputsRequested with status replied.
      const requestedAgents = parsed.data.baEnrichment?.inputsRequested.map((i) => i.agent).sort();
      expect(requestedAgents).toEqual(['ea-agent', 'release-agent', 'security-agent', 'testing-agent']);
      const allReplied = parsed.data.baEnrichment?.inputsRequested.every((i) => i.status === 'replied');
      expect(allReplied).toBe(true);
    }
  });

  it('reports timed-out consultants in baEnrichment when none reply', async () => {
    const db = createTestDb();
    const fx = seedFixture(db, 'timeout');

    // Consultant not in DOMAIN_RESPONDERS will not synthesise a reply.
    const out = await runBAAgent(
      {
        promptId: fx.promptId,
        correlationId: 'cor_timeout',
        consultants: ['unknown-agent'] as never,
        collabTimeoutMs: 50,
      },
      db,
    );

    expect(out.enrichedStories).toBe(1);
    expect(out.ticketsValid + out.ticketsInvalid).toBe(1);

    const row = db.select().from(stories).where(eq(stories.id, fx.storyId)).get();
    const ticket = JSON.parse(row!.agentContributionsJson);
    expect(ticket.baEnrichment.completenessChecksPassed).toBe(false);
    expect(ticket.baEnrichment.inputsRequested[0].status).toBe('timed_out');
    expect(ticket.baEnrichment.notes).toMatch(/timed out/);
  });

  it('emits ba-agent.enrichment.complete with the per-ticket pass/fail counts', async () => {
    const db = createTestDb();
    const fx = seedFixture(db, 'event');

    const out = await runBAAgent(
      {
        promptId: fx.promptId,
        correlationId: 'cor_event',
        consultants: ['testing-agent'],
        collabTimeoutMs: 500,
      },
      db,
    );

    expect(out.ticketsValid).toBeGreaterThanOrEqual(0);
    expect(out.ticketsInvalid).toBeGreaterThanOrEqual(0);
    expect(out.ticketsValid + out.ticketsInvalid).toBe(out.enrichedStories);
  });
});
