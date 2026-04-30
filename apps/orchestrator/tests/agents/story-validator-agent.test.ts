/**
 * VAL-004 — unit + integration tests for the Story Validator Agent.
 *
 * Uses a deterministic stub JudgeAdapter so tests are stable + fast (no
 * network or local-llm calls). Asserts:
 *   - Schema-invalid story → hard fail, no LLM steps run.
 *   - Section-presence missing → hard fail.
 *   - Detail-sufficiency placeholders ("TBD") trigger forbidden-snippet.
 *   - Acceptance-criteria too short / fluff phrasing detected.
 *   - Content-relevance low score from judge → soft fail.
 *   - Cross-section consistency low score → soft fail.
 *   - Completeness gestalt low readiness → soft fail.
 *   - All deterministic + LLM steps green ⇒ pass clean ⇒ stage advances.
 *   - On fail, report is persisted + status = 'failed'.
 *   - On second-pass attempt with attempt counter, escalation triggers.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, asc } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import {
  events,
  prompts,
  promptPipelineStages,
  stories,
} from '../../src/db/schema';
import {
  buildDraftTicket,
  TICKET_TEMPLATE_VERSION,
  type TicketTemplateV1,
} from '@chiefaia/ticket-template';
import { eventBus } from '@chiefaia/event-bus-internal';
import {
  type JudgeAdapter,
  type JudgeResponse,
  runStoryValidatorAgent,
} from '../../src/agents/story-validator-agent';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

// ─── Test harness ────────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  // Wire bus so we can assert events fired.
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

function nowIso() {
  return new Date().toISOString();
}

function seedPromptAndStory(
  db: ReturnType<typeof createTestDb>,
  ticketJson: string,
  storyId = 'stry_val',
  promptId = 'prm_val',
) {
  db.insert(prompts)
    .values({
      id: promptId,
      body: 'test',
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId: `cor_${promptId}`,
      hash: `hash_${promptId}`,
      status: 'received',
    })
    .run();
  db.insert(stories)
    .values({
      id: storyId,
      title: 'Test story',
      kind: 'story',
      createdAt: nowIso(),
      rootPromptId: promptId,
      agentContributionsJson: ticketJson,
      templateValidationStatus: 'valid',
    })
    .run();
}

/** Build a ticket payload with overrides — used to produce both pass and fail variants. */
function buildTicket(overrides: Partial<TicketTemplateV1> = {}): TicketTemplateV1 {
  const base = buildDraftTicket({
    rootPromptId: 'prm_val',
    requirementId: 'req_val',
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
  });
  return { ...base, ...overrides };
}

/** Fully-populated ticket with all sections filled to pass deterministic checks. */
function buildHighQualityTicket(): TicketTemplateV1 {
  const t = buildTicket({
    agentSections: {
      architecture: {
        contributedBy: 'ea-agent',
        contributedAt: Date.now(),
        adrReferences: ['ADR-007', 'ADR-012'],
        constraints: [
          'must reuse the existing session middleware in packages/auth/src/session.ts',
          'must not introduce a new identity provider abstraction layer for the dashboard',
        ],
        notes:
          'Approach is to extend the existing session middleware located at packages/auth/src/session.ts so that it accepts Google OAuth tokens in addition to the local password flow. The OAuth client secret should be fetched at runtime via @chiefaia/secrets rather than being baked into the bundle. The integration point is the verifyToken helper which currently handles password sessions and will dispatch on token shape going forward to keep the change minimal and backwards compatible.',
      },
      ui: {
        contributedBy: 'ui-agent',
        contributedAt: Date.now(),
        components: ['SignInButton', 'OAuthCallback', 'AuthErrorBanner'],
        designSystemPattern: 'primary-cta button anchored in the top navigation bar',
        accessibilityRequirements: [
          'Button must be reachable via keyboard navigation with a visible focus ring at all times',
          'Loading and error states must announce their status to screen readers via aria-live polite region',
        ],
      },
      security: {
        contributedBy: 'security-agent',
        contributedAt: Date.now(),
        threatModel: [
          'CSRF via the OAuth callback endpoint must be mitigated with a cryptographic state parameter that is cookie-bound and verified on the callback handler.',
          'Access token leakage via the HTTP Referer header must be prevented by setting Referrer-Policy no-referrer on the callback page so downstream sites never see the token.',
        ],
        requiredHeaders: ['Strict-Transport-Security', 'Referrer-Policy'],
        authzNotes:
          'Only authenticated users can access dashboard routes; unauthenticated users are redirected to the OAuth prompt and never see protected resources at any point during the flow.',
      },
      testing: {
        contributedBy: 'testing-agent',
        contributedAt: Date.now(),
        unitTestPaths: [
          'packages/auth/src/oauth.test.ts',
          'packages/auth/src/session-google.test.ts',
        ],
        integrationTestPaths: [
          'apps/dashboard/tests/oauth-flow.test.ts',
          'apps/dashboard/tests/oauth-callback-error.test.ts',
        ],
        coverageTarget: 0.85,
        behaviorTestPath: 'apps/dashboard/tests/oauth-e2e.spec.ts',
      },
    },
  });
  return t;
}

/** Stub judge that returns scores per task type — exhaustive control for tests. */
function stubJudge(scoresByTaskType: Record<string, unknown>): JudgeAdapter {
  return {
    judge: async ({ taskType }): Promise<JudgeResponse> => {
      const json = scoresByTaskType[taskType] ?? {};
      return {
        json,
        raw: JSON.stringify(json),
        provider: 'local',
        model: 'qwen2.5-coder:7b',
        durationMs: 1,
      };
    },
  };
}

const allGreenJudge = stubJudge({
  'validation-content-relevance': { score: 5, relevant: true, concerns: [] },
  'validation-cross-section': { score: 5, consistent: true, contradictions: [] },
  'validation-completeness': {
    testingAgentReady: 5,
    codingAgentReady: 5,
    blockers: [],
    rationale: 'Ticket is complete.',
  },
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runStoryValidatorAgent — deterministic checks', () => {
  it('hard-fails when the ticket fails Zod parse', async () => {
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify({ not: 'a ticket' }));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    expect(out.passed).toBe(false);
    expect(out.report.steps.schema.passed).toBe(false);
    expect(out.report.failedChecks.some((f) => f.step === 'schema')).toBe(true);
    expect(out.nextAction).toBe('return_to_ba');
  });

  it('hard-fails when scope.summary is empty', async () => {
    const t = buildTicket();
    t.scope.summary = '';
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    // Zod will catch this as min(1) — schema fails first.
    expect(out.passed).toBe(false);
  });

  it('flags forbidden snippets ("TBD") in scope', async () => {
    const t = buildTicket({
      scope: {
        summary: 'Add Google OAuth login (TBD details)',
        inScope: ['TBD scope item'],
        outOfScope: [],
      },
    });
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    const tbdFinding = out.report.failedChecks.find((f) =>
      f.ruleId?.includes('forbidden_snippet'),
    );
    expect(tbdFinding).toBeTruthy();
    expect(out.passed).toBe(false);
  });

  it('flags acceptance-criteria items shorter than the rubric minimum', async () => {
    const t = buildTicket({
      acceptanceCriteria: [
        'short ac one here',
        'another short one ok',
        'works', // too short — 1 word, fails AC_ITEM_RULES.minWordsPerItem
      ],
    });
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    const acShort = out.report.failedChecks.find(
      (f) => f.ruleId === 'detail:ac_min_words',
    );
    expect(acShort).toBeTruthy();
  });

  it('flags acceptance-criteria fluff phrasing ("works correctly")', async () => {
    const t = buildTicket({
      acceptanceCriteria: [
        'Given a user, when they click sign-in, then it works correctly always',
        'Given OAuth succeeds, when the callback returns, then I land on the dashboard',
        'Given OAuth fails, when the callback returns, then I see an error message',
      ],
    });
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    const fluff = out.report.failedChecks.find((f) => f.ruleId === 'detail:ac_fluff');
    expect(fluff).toBeTruthy();
  });
});

describe('runStoryValidatorAgent — LLM-judged steps', () => {
  it('soft-fails when content-relevance judge returns score < 3 for any section', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      {
        judge: stubJudge({
          'validation-content-relevance': { score: 2, concerns: ['off-topic'] },
          'validation-cross-section': { score: 5, consistent: true },
          'validation-completeness': {
            testingAgentReady: 5,
            codingAgentReady: 5,
            blockers: [],
          },
        }),
      },
    );
    expect(out.passed).toBe(false);
    expect(
      out.report.failedChecks.some((f) => f.step === 'contentRelevance'),
    ).toBe(true);
  });

  it('soft-fails when cross-section consistency judge returns score < 3', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      {
        judge: stubJudge({
          'validation-content-relevance': { score: 5 },
          'validation-cross-section': {
            score: 2,
            consistent: false,
            contradictions: ['ac mentions OAuth but api section omits route'],
          },
          'validation-completeness': {
            testingAgentReady: 5,
            codingAgentReady: 5,
            blockers: [],
          },
        }),
      },
    );
    expect(out.passed).toBe(false);
    expect(
      out.report.failedChecks.some((f) => f.step === 'crossSectionConsistency'),
    ).toBe(true);
  });

  it('soft-fails when completeness gestalt has testingAgentReady < 4', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      {
        judge: stubJudge({
          'validation-content-relevance': { score: 5 },
          'validation-cross-section': { score: 5 },
          'validation-completeness': {
            testingAgentReady: 3,
            codingAgentReady: 5,
            blockers: ['no error path AC'],
            rationale: 'AC missing edge cases',
          },
        }),
      },
    );
    expect(out.passed).toBe(false);
    expect(
      out.report.failedChecks.some(
        (f) => f.step === 'completenessGestalt' && f.ruleId === 'gestalt:testing_unready',
      ),
    ).toBe(true);
  });
});

describe('runStoryValidatorAgent — happy path', () => {
  it('passes a high-quality ticket cleanly + advances the pipeline stage + persists report', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));

    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );

    expect(out.passed).toBe(true);
    expect(out.nextAction).toBe('proceed');
    expect(out.score).toBeGreaterThan(80);
    expect(out.report.judgeProvider).toBe('local');

    // Persistence.
    const row = db.select().from(stories).where(eq(stories.id, 'stry_val')).get();
    expect(row!.validationStatus).toBe('passed');
    expect(row!.validationAttempts).toBe(1);
    expect(row!.validationReport).toBeTruthy();
    const persistedReport = JSON.parse(row!.validationReport!);
    expect(persistedReport.rubricVersion).toBe('v1');

    // Pipeline stage advanced.
    const stageRows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_val'))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();
    expect(stageRows.map((r) => r.stage)).toContain('validated');

    // Events fired.
    const eventRows = db.select().from(events).all();
    const types = eventRows.map((e) => e.type);
    expect(types).toContain('story.validation_started');
    expect(types).toContain('story.validation_passed');
    expect(types).toContain('ticket.validating');
    expect(types).toContain('ticket.validated');
  });

  it('does NOT advance the pipeline stage when skipStageAdvancement=true', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));

    await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge, skipStageAdvancement: true },
    );

    const stageRows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_val'))
      .all();
    expect(stageRows.map((r) => r.stage)).not.toContain('validated');
  });
});

describe('runStoryValidatorAgent — escalation on attempt cap', () => {
  it('escalates instead of returning to BA when attemptNumber reaches the cap', async () => {
    // Seed a story with a deterministic-failure ticket (forbidden snippet)
    // and supply attemptNumber = 2 (= maxAttempts) — verdict should escalate.
    const t = buildTicket({
      scope: { summary: 'Add OAuth (TBD)', inScope: ['TBD'], outOfScope: [] },
    });
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));

    const out = await runStoryValidatorAgent(
      {
        storyId: 'stry_val',
        promptId: 'prm_val',
        correlationId: 'cor_val',
        attemptNumber: 2,
      },
      db,
      { judge: allGreenJudge },
    );

    expect(out.passed).toBe(false);
    expect(out.nextAction).toBe('escalate');

    const row = db.select().from(stories).where(eq(stories.id, 'stry_val')).get();
    expect(row!.validationStatus).toBe('escalated');
    expect(row!.validationAttempts).toBe(2);

    const eventTypes = db
      .select()
      .from(events)
      .all()
      .map((e) => e.type);
    expect(eventTypes).toContain('story.validation_escalated');
  });
});

describe('runStoryValidatorAgent — increments attempt counter naturally', () => {
  it('reads existing validation_attempts and increments by 1 on next run', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));

    // Pre-set attempts to 1 (simulating a previous validator run).
    db.update(stories)
      .set({ validationAttempts: 1 })
      .where(eq(stories.id, 'stry_val'))
      .run();

    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    expect(out.attemptNumber).toBe(2);

    const row = db.select().from(stories).where(eq(stories.id, 'stry_val')).get();
    expect(row!.validationAttempts).toBe(2);
  });
});

describe('runStoryValidatorAgent — input template version', () => {
  it('rejects tickets with the wrong template version (Zod literal)', async () => {
    const t = buildHighQualityTicket();
    (t as Record<string, unknown>).version = 'v2'; // wrong literal
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    expect(out.passed).toBe(false);
    expect(out.report.steps.schema.passed).toBe(false);
  });

  it('still passes tickets with the canonical template version', async () => {
    const t = buildHighQualityTicket();
    expect(t.version).toBe(TICKET_TEMPLATE_VERSION);
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    expect(out.passed).toBe(true);
  });
});

// ─── VAL-2026-04-30 enhancement tests ────────────────────────────────────────

describe('runStoryValidatorAgent — error: story not found', () => {
  it('throws when storyId does not exist in the database', async () => {
    const db = createTestDb();
    await expect(
      runStoryValidatorAgent(
        { storyId: 'nonexistent_id', promptId: 'prm_val', correlationId: 'cor_val' },
        db,
        { judge: allGreenJudge },
      ),
    ).rejects.toThrow('Story not found: nonexistent_id');
  });
});

describe('runStoryValidatorAgent — malformed agentContributionsJson', () => {
  it('falls back to empty object and hard-fails schema when JSON is unparseable', async () => {
    const db = createTestDb();
    seedPromptAndStory(db, '{ invalid json here :::');
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    expect(out.passed).toBe(false);
    expect(out.report.steps.schema.passed).toBe(false);
    expect(out.nextAction).toBe('return_to_ba');
  });
});

describe('runStoryValidatorAgent — judge failure resilience', () => {
  it('treats cross-section judge throw as non-blocking (passed=true, score=0, judgeError in details)', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));

    const crossThrowJudge: JudgeAdapter = {
      judge: async ({ taskType }): Promise<JudgeResponse> => {
        if (taskType === 'validation-cross-section') {
          throw new Error('cross-section judge unavailable');
        }
        return {
          json:
            taskType === 'validation-content-relevance'
              ? { score: 5, concerns: [] }
              : { testingAgentReady: 5, codingAgentReady: 5, blockers: [], rationale: 'ok' },
          raw: '{}',
          provider: 'local',
          model: 'qwen2.5-coder:7b',
          durationMs: 1,
        };
      },
    };

    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: crossThrowJudge },
    );
    expect(out.report.steps.crossSectionConsistency.passed).toBe(true);
    expect(out.report.steps.crossSectionConsistency.score).toBe(0);
    expect(out.report.steps.crossSectionConsistency.details).toMatchObject({
      judgeError: expect.any(String),
    });
  });

  it('treats completeness-gestalt judge throw as non-blocking (passed=true)', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));

    const gestaltThrowJudge: JudgeAdapter = {
      judge: async ({ taskType }): Promise<JudgeResponse> => {
        if (taskType === 'validation-completeness') {
          throw new Error('gestalt judge unavailable');
        }
        return {
          json:
            taskType === 'validation-content-relevance'
              ? { score: 5, concerns: [] }
              : { score: 5, contradictions: [] },
          raw: '{}',
          provider: 'local',
          model: 'qwen2.5-coder:7b',
          durationMs: 1,
        };
      },
    };

    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: gestaltThrowJudge },
    );
    expect(out.report.steps.completenessGestalt.passed).toBe(true);
    expect(out.passed).toBe(true);
  });

  it('sets judgeProvider="none" when all judge steps throw — overall verdict still passes deterministic checks', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));

    const allThrowJudge: JudgeAdapter = {
      judge: async (): Promise<JudgeResponse> => {
        throw new Error('all judges unavailable');
      },
    };

    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allThrowJudge },
    );
    expect(out.report.judgeProvider).toBe('none');
    expect(out.report.judgeModelTouchpoints).toHaveLength(0);
    // All LLM steps gracefully pass (no failures pushed to allFailures) so
    // deterministic steps alone decide the verdict → pass on a quality ticket.
    expect(out.passed).toBe(true);
  });
});

describe('runStoryValidatorAgent — judgeProvider aggregation', () => {
  it('records judgeProvider="mixed" when content-relevance uses local and cross-section uses claude', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));

    const mixedJudge: JudgeAdapter = {
      judge: async ({ taskType }): Promise<JudgeResponse> => ({
        json:
          taskType === 'validation-content-relevance'
            ? { score: 5, concerns: [] }
            : taskType === 'validation-cross-section'
              ? { score: 5, contradictions: [] }
              : { testingAgentReady: 5, codingAgentReady: 5, blockers: [] },
        raw: '{}',
        provider: taskType === 'validation-content-relevance' ? 'local' : 'claude',
        model:
          taskType === 'validation-content-relevance' ? 'qwen2.5-coder:7b' : 'claude-3-haiku',
        durationMs: 1,
      }),
    };

    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: mixedJudge },
    );
    expect(out.report.judgeProvider).toBe('mixed');
    expect(out.report.judgeModelTouchpoints).toContain('qwen2.5-coder:7b');
    expect(out.report.judgeModelTouchpoints).toContain('claude-3-haiku');
  });

  it('records judgeProvider="claude" when all three judge steps use claude', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));

    const claudeOnlyJudge: JudgeAdapter = {
      judge: async ({ taskType }): Promise<JudgeResponse> => ({
        json:
          taskType === 'validation-content-relevance'
            ? { score: 5, concerns: [] }
            : taskType === 'validation-cross-section'
              ? { score: 5, contradictions: [] }
              : { testingAgentReady: 5, codingAgentReady: 5, blockers: [] },
        raw: '{}',
        provider: 'claude',
        model: 'claude-3-haiku',
        durationMs: 1,
      }),
    };

    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: claudeOnlyJudge },
    );
    expect(out.report.judgeProvider).toBe('claude');
    expect(out.report.judgeModelTouchpoints).toContain('claude-3-haiku');
  });
});

describe('runStoryValidatorAgent — BDD fraction warning', () => {
  it('generates a warning (not a hard fail) when fewer than threshold ACs use BDD phrasing', async () => {
    // 1 of 3 ACs uses Given/When/Then → fraction ≈ 0.33, below threshold → warning only.
    const t = buildTicket({
      acceptanceCriteria: [
        'Given I am logged out, when I click sign-in, then the OAuth flow begins for the user',
        'The system renders the button when the user is unauthenticated in the navigation area',
        'An error message is displayed to the user when the OAuth callback fails with detail',
      ],
    });
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    const bddWarning = out.report.warnings.find(
      (w) => w.section === 'acceptanceCriteria' && w.message.includes('BDD'),
    );
    expect(bddWarning).toBeTruthy();
    // Should NOT produce a hard-fail ruleId for the BDD fraction (zero case is different).
    const bddZeroFail = out.report.failedChecks.find(
      (f) => f.ruleId === 'detail:ac_bdd_fraction_zero',
    );
    expect(bddZeroFail).toBeUndefined();
  });
});

describe('runStoryValidatorAgent — forceLegacyRubric', () => {
  it('passes a high-quality ticket when the legacy rubric is forced via option', async () => {
    const t = buildHighQualityTicket();
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge, forceLegacyRubric: true },
    );
    expect(out.passed).toBe(true);
    expect(out.nextAction).toBe('proceed');
  });

  it('hard-fails a schema-invalid ticket even when the legacy rubric is forced', async () => {
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify({ broken: true }));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge, forceLegacyRubric: true },
    );
    expect(out.passed).toBe(false);
    expect(out.report.steps.schema.passed).toBe(false);
  });
});

describe('runStoryValidatorAgent — fix-suggestion deduplication', () => {
  it('deduplicates identical fix suggestions across multiple fluff failures in the same run', async () => {
    // 3 ACs all containing "works correctly" → 3 fluff failedChecks, 1 deduped fixSuggestion.
    const t = buildTicket({
      acceptanceCriteria: [
        'Given I am logged out, when I click sign-in, then it works correctly as expected for users',
        'Given OAuth succeeds, when the callback returns, then the flow works correctly and I land on dashboard',
        'Given OAuth fails, when an error occurs, then the system works correctly and shows a message',
      ],
    });
    const db = createTestDb();
    seedPromptAndStory(db, JSON.stringify(t));
    const out = await runStoryValidatorAgent(
      { storyId: 'stry_val', promptId: 'prm_val', correlationId: 'cor_val' },
      db,
      { judge: allGreenJudge },
    );
    const fluffChecks = out.report.failedChecks.filter(
      (f) => f.ruleId === 'detail:ac_fluff',
    );
    expect(fluffChecks.length).toBeGreaterThanOrEqual(2);
    const fluffFixSuggestion =
      `Replace fluff phrase "works correctly" with a concrete observable behaviour.`;
    const matchesInSuggestions = out.report.fixSuggestions.filter(
      (s) => s === fluffFixSuggestion,
    );
    // Same fix suggestion appears exactly once despite multiple identical fluff failures.
    expect(matchesInSuggestions).toHaveLength(1);
  });
});
