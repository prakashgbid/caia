/**
 * VAL-005 — tests for the validator orchestration loop.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, asc } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import {
  blockers,
  events,
  prompts,
  promptPipelineStages,
  stories,
  requirements,
} from '../../src/db/schema';
import { buildDraftTicket } from '@chiefaia/ticket-template';
import { eventBus } from '@chiefaia/event-bus-internal';
import { runValidatorLoop } from '../../src/agents/validator-loop';
import {
  type JudgeAdapter,
  type JudgeResponse,
} from '../../src/agents/story-validator-agent';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function nowIso() {
  return new Date().toISOString();
}

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  eventBus.wireDb({
    insertEvent: (row) => {
      db.insert(events)
        .values({
          id: row.id,
          type: row.type,
          occurredAt: row.occurred_at,
          actor: row.actor,
          correlationId: row.correlation_id ?? undefined,
          causationId: row.causation_id ?? undefined,
          traceId: row.trace_id ?? undefined,
          spanId: row.span_id ?? undefined,
          entityType: row.entity_type ?? undefined,
          entityId: row.entity_id ?? undefined,
          projectSlug: row.project_slug ?? undefined,
          domainSlugsJson: row.domain_slugs_json,
          payloadJson: row.payload_json,
          metadataJson: row.metadata_json,
          severity: row.severity,
        })
        .run();
    },
    queryEvents: () => [],
  });
  return db;
}

function buildHighQualityTicket() {
  const t = buildDraftTicket({
    rootPromptId: 'prm_loop',
    requirementId: 'req_loop',
    domainPrimary: 'auth',
    domainAll: ['auth', 'frontend'],
    nature: 'feature',
    complexity: 'medium',
    summary:
      'Add Google OAuth sign-in button to the dashboard top navigation so unauthenticated users can authenticate via Google and land on the dashboard',
    inScope: [
      'Render an OAuth sign-in button on the dashboard top navigation bar for unauthenticated users to begin the Google authentication flow end to end',
    ],
    outOfScope: [
      'Other identity providers such as GitHub or Microsoft are out of scope for this story',
    ],
    acceptanceCriteria: [
      'Given I am logged out, when I click "Sign in with Google", then the OAuth flow begins',
      'Given OAuth succeeds, when the callback returns, then I land on the dashboard signed in',
      'Given OAuth fails, when the callback returns, then I see a clear error message',
    ],
    verificationPlan: ['pnpm test --filter=auth', 'manual smoke against staging'],
  }) as Record<string, unknown>;
  t.agentSections = {
    architecture: {
      contributedBy: 'ea-agent',
      contributedAt: Date.now(),
      adrReferences: ['ADR-007'],
      constraints: [
        'must reuse the existing session middleware in packages/auth/src/session.ts',
      ],
      notes:
        'Approach is to extend the existing session middleware to accept Google OAuth tokens in addition to the local password flow. The OAuth client secret is fetched at runtime via @chiefaia/secrets. The integration point is the verifyToken helper in packages/auth/src/session.ts.',
    },
    testing: {
      contributedBy: 'testing-agent',
      contributedAt: Date.now(),
      unitTestPaths: ['packages/auth/src/oauth.test.ts'],
      integrationTestPaths: ['apps/dashboard/tests/oauth-flow.test.ts'],
      coverageTarget: 0.85,
    },
  };
  return t;
}

function buildBrokenTicket() {
  const t = buildHighQualityTicket();
  (t as Record<string, unknown>).scope = {
    summary: 'Add OAuth login (TBD details)',
    inScope: ['TBD'],
    outOfScope: [],
  };
  return t;
}

function seedRequirementAndStory(
  db: ReturnType<typeof createTestDb>,
  ticketJson: string,
  storyId: string,
  promptId: string,
) {
  db.insert(requirements)
    .values({
      id: `req_${storyId}`,
      title: storyId,
      description: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .run();
  db.insert(stories)
    .values({
      id: storyId,
      title: storyId,
      kind: 'story',
      createdAt: nowIso(),
      rootPromptId: promptId,
      parentEntityType: 'requirement',
      parentEntityId: `req_${storyId}`,
      agentContributionsJson: ticketJson,
      templateValidationStatus: 'valid',
    })
    .run();
}

const allGreenJudge: JudgeAdapter = {
  judge: async ({ taskType }: { taskType: string }): Promise<JudgeResponse> => {
    const json =
      taskType === 'validation-content-relevance'
        ? { score: 5, concerns: [] }
        : taskType === 'validation-cross-section'
          ? { score: 5, contradictions: [] }
          : { testingAgentReady: 5, codingAgentReady: 5, blockers: [], rationale: 'fine' };
    return {
      json,
      raw: JSON.stringify(json),
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      durationMs: 1,
    };
  },
};

describe('runValidatorLoop — happy path', () => {
  it('passes a high-quality story on first attempt and advances the pipeline', async () => {
    const db = createTestDb();
    db.insert(prompts)
      .values({
        id: 'prm_loop',
        body: 'test',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId: 'cor_loop',
        hash: 'hash_loop',
        status: 'received',
      })
      .run();
    seedRequirementAndStory(db, JSON.stringify(buildHighQualityTicket()), 'stry_a', 'prm_loop');

    const out = await runValidatorLoop(
      { promptId: 'prm_loop', correlationId: 'cor_loop' },
      db,
      { judge: allGreenJudge, maxAttempts: 2, reInvokeOnFail: false },
    );

    expect(out.storiesValidated).toBe(1);
    expect(out.storiesPassed).toBe(1);
    expect(out.storiesEscalated).toBe(0);
    expect(out.perStoryAttempts[0]?.attempts).toBe(1);
    expect(out.perStoryAttempts[0]?.finalStatus).toBe('passed');

    const row = db.select().from(stories).where(eq(stories.id, 'stry_a')).get();
    expect(row!.validationStatus).toBe('passed');
    expect(row!.validationAttempts).toBe(1);

    const stageRows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_loop'))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();
    const validatedStages = stageRows.filter((r) => r.stage === 'validated');
    expect(validatedStages).toHaveLength(1);
  });

  it('skips stories that are already passed (idempotent re-invocation)', async () => {
    const db = createTestDb();
    db.insert(prompts)
      .values({
        id: 'prm_loop',
        body: 'test',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId: 'cor_loop',
        hash: 'hash_loop',
        status: 'received',
      })
      .run();
    seedRequirementAndStory(db, JSON.stringify(buildHighQualityTicket()), 'stry_a', 'prm_loop');
    db.update(stories)
      .set({ validationStatus: 'passed', validationAttempts: 1 })
      .where(eq(stories.id, 'stry_a'))
      .run();

    const out = await runValidatorLoop(
      { promptId: 'prm_loop', correlationId: 'cor_loop' },
      db,
      { judge: allGreenJudge, maxAttempts: 2, reInvokeOnFail: false },
    );

    expect(out.storiesValidated).toBe(0);
    expect(out.storiesPassed).toBe(0);
    expect(out.storiesEscalated).toBe(0);
  });
});

describe('runValidatorLoop — escalation path', () => {
  it('escalates a story that keeps failing after maxAttempts and files a blocker', async () => {
    const db = createTestDb();
    db.insert(prompts)
      .values({
        id: 'prm_loop',
        body: 'test',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId: 'cor_loop',
        hash: 'hash_loop',
        status: 'received',
      })
      .run();
    seedRequirementAndStory(db, JSON.stringify(buildBrokenTicket()), 'stry_b', 'prm_loop');

    const out = await runValidatorLoop(
      { promptId: 'prm_loop', correlationId: 'cor_loop' },
      db,
      { judge: allGreenJudge, maxAttempts: 2, reInvokeOnFail: false },
    );

    expect(out.storiesEscalated).toBe(1);
    expect(out.perStoryAttempts[0]?.finalStatus).toBe('escalated');

    const row = db.select().from(stories).where(eq(stories.id, 'stry_b')).get();
    expect(row!.validationStatus).toBe('escalated');

    const blockerRows = db
      .select()
      .from(blockers)
      .where(eq(blockers.parentEntityId, 'stry_b'))
      .all();
    expect(blockerRows).toHaveLength(1);
    expect(blockerRows[0]?.kind).toBe('validation-stuck');
    expect(blockerRows[0]?.severity).toBe('high');
    expect(blockerRows[0]?.state).toBe('open');

    const eventTypes = db
      .select()
      .from(events)
      .all()
      .map((e) => e.type);
    expect(eventTypes).toContain('story.validation_escalated');
  });

  it('successfully recovers when BA re-invocation produces a passing ticket on second attempt', async () => {
    // This test verifies the closed-loop behaviour: validator fails →
    // re-invoke BA → re-validate → pass. We use a judge that fails the
    // first call but passes the second.
    const db = createTestDb();
    db.insert(prompts)
      .values({
        id: 'prm_loop',
        body: 'test',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId: 'cor_loop',
        hash: 'hash_loop',
        status: 'received',
      })
      .run();
    seedRequirementAndStory(db, JSON.stringify(buildHighQualityTicket()), 'stry_recover', 'prm_loop');

    let gestaltCallCount = 0;
    const evolvingJudge: JudgeAdapter = {
      judge: async ({ taskType }: { taskType: string }): Promise<JudgeResponse> => {
        let json: unknown;
        if (taskType === 'validation-content-relevance') {
          json = { score: 5, concerns: [] };
        } else if (taskType === 'validation-cross-section') {
          json = { score: 5, contradictions: [] };
        } else {
          // Gestalt: first call returns testingAgentReady=3 (fail), second call returns 5.
          gestaltCallCount++;
          json =
            gestaltCallCount === 1
              ? { testingAgentReady: 3, codingAgentReady: 5, blockers: ['weak'], rationale: 'first call' }
              : { testingAgentReady: 5, codingAgentReady: 5, blockers: [], rationale: 'second call' };
        }
        return {
          json,
          raw: JSON.stringify(json),
          provider: 'local',
          model: 'qwen2.5-coder:7b',
          durationMs: 1,
        };
      },
    };

    const out = await runValidatorLoop(
      { promptId: 'prm_loop', correlationId: 'cor_loop' },
      db,
      { judge: evolvingJudge, maxAttempts: 2, reInvokeOnFail: false },
    );

    // After 2 attempts (no BA re-invocation in test mode), 2nd one passes.
    expect(out.storiesPassed).toBe(1);
    expect(out.storiesEscalated).toBe(0);
    expect(out.perStoryAttempts[0]?.attempts).toBe(2);
    expect(out.perStoryAttempts[0]?.finalStatus).toBe('passed');

    const row = db.select().from(stories).where(eq(stories.id, 'stry_recover')).get();
    expect(row!.validationStatus).toBe('passed');
    expect(row!.validationAttempts).toBe(2);
  });
});

describe('runValidatorLoop — multi-story prompt', () => {
  it('validates each eligible story independently and aggregates counts', async () => {
    const db = createTestDb();
    db.insert(prompts)
      .values({
        id: 'prm_loop',
        body: 'test',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId: 'cor_loop',
        hash: 'hash_loop',
        status: 'received',
      })
      .run();
    seedRequirementAndStory(db, JSON.stringify(buildHighQualityTicket()), 'stry_good_1', 'prm_loop');
    seedRequirementAndStory(db, JSON.stringify(buildHighQualityTicket()), 'stry_good_2', 'prm_loop');
    seedRequirementAndStory(db, JSON.stringify(buildBrokenTicket()), 'stry_bad', 'prm_loop');

    const out = await runValidatorLoop(
      { promptId: 'prm_loop', correlationId: 'cor_loop' },
      db,
      { judge: allGreenJudge, maxAttempts: 2, reInvokeOnFail: false },
    );

    expect(out.storiesValidated).toBe(3);
    expect(out.storiesPassed).toBe(2);
    expect(out.storiesEscalated).toBe(1);

    const validatedRows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_loop'))
      .all()
      .filter((r) => r.stage === 'validated');
    expect(validatedRows).toHaveLength(1);

    const meta = JSON.parse(validatedRows[0]!.metadata!);
    expect(meta.storiesPassed).toBe(2);
    expect(meta.storiesEscalated).toBe(1);
    expect(meta.totalEligible).toBe(3);
  });
});
