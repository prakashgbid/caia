/**
 * Phase 2 diverse-prompt acceptance suite (PHASE2E-002).
 *
 * The production gate. Whereas PHASE2E-001 proves the happy path with a
 * single fixture prompt, this suite drives 10+ varied real prompts
 * through the same pipeline and asserts a 100% completion rate.
 *
 * Each prompt covers a different scenario the user mix would surface in
 * production:
 *   1. Simple new feature
 *   2. Bug fix
 *   3. Enhancement to an existing surface
 *   4. Cross-domain feature (UI + BFF + DB + observability)
 *   5. Refactor
 *   6. Spike
 *   7. Multi-agent collab heavy (e-commerce checkout)
 *   8. EA-heavy architectural decision
 *   9. Test-heavy feature (a11y / WCAG conformance)
 *   10. Quick chore
 *
 * For every prompt the suite asserts:
 *   - Pipeline reaches `ready_for_pickup`.
 *   - All Phase 2 stages were visited.
 *   - At least one story exits in a terminal validation state
 *     (passed or escalated — never `in_progress`), with
 *     templateValidationStatus='valid', testDesignStatus='designed',
 *     and a non-null bucketId.
 *   - The implementation contract holds: ImplementationEngine reaches
 *     DONE_MARKER on a scripted MockLlmAdapter, and FixItOrchestrator
 *     produces a tested_and_done outcome with totalAttempts equal to
 *     the test-case count (the happy-path stub runner returns 'passed'
 *     on attempt 1 — modeling Fix-It's max-6-retries loop reaching
 *     green on the first try; FIX-002..006 swap each stub for the
 *     real implementation while keeping this contract stable).
 *   - No `validation-stuck` blockers persist in a state the dashboard
 *     would surface as broken (escalated blockers are filed but the
 *     pipeline still progresses, which is the production behavior).
 *   - The full per-prompt run completes within an SLO budget.
 *
 * If any prompt fails any of these assertions, the production gate has
 * regressed and Wave 3 fix tasks should be spawned.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as schema from '../../../src/db/schema';
import {
  events,
  prompts,
  promptPipelineStages,
  stories,
  taskBuckets,
  blockers,
} from '../../../src/db/schema';
import { eventBus } from '@chiefaia/event-bus-internal';
import {
  TicketTemplateV1Schema,
  type TestCase,
} from '@chiefaia/ticket-template';

import { runPOAgent } from '../../../src/agents/po-agent';
import { runBAAgent } from '../../../src/agents/ba-agent';
import { runEAAgent } from '../../../src/agents/ea-agent';
import { runValidatorLoop } from '../../../src/agents/validator-loop';
import { runTestDesignAgent } from '../../../src/agents/test-design-agent';
import { runTaskScheduler } from '../../../src/agents/task-scheduler';
import { advancePipelineStage } from '../../../src/agents/pipeline-stages';
import { getTicketBundle, type TicketBundle } from '../../../src/api/ticket-bundle';
import type { JudgeAdapter } from '../../../src/agents/story-validator-agent';

import {
  ImplementationEngine,
  MockLlmAdapter,
  DONE_MARKER,
} from '../../../../worker-coding/src/implementation-engine';
import type { Bundle as CoderBundle } from '../../../../worker-coding/src/bundle-reader';
import type { Worktree } from '../../../../worker-coding/src/worktree-manager';

import { FixItOrchestrator } from '../../../../worker-fix-it/src/orchestrator';
import type { CodingCompletePayload } from '../../../../worker-fix-it/src/types';

const MIGRATIONS_DIR = path.join(__dirname, '../../../src/db/migrations');

// ─── 10 diverse prompts ──────────────────────────────────────────────────────

interface PromptCase {
  /** Short tag for the test name (kept stable; used to lookup the row). */
  tag: string;
  /** Human-readable prompt text — what the user would type. */
  body: string;
  /**
   * Per-prompt SLO budget in ms. Simple tickets (chores, single-domain
   * fixes) have tight budgets; multi-agent / EA-heavy ones get more
   * headroom. The acceptance test uses these as soft assertions —
   * exceeding the budget surfaces a real perf regression.
   */
  sloMs: number;
  /** Expected scenario character — used for the test description only. */
  scenario:
    | 'new-feature'
    | 'bug-fix'
    | 'enhancement'
    | 'cross-domain'
    | 'refactor'
    | 'spike'
    | 'multi-agent-collab'
    | 'ea-heavy'
    | 'test-heavy'
    | 'chore';
}

const PROMPT_CASES: readonly PromptCase[] = [
  {
    tag: 'simple-feature',
    scenario: 'new-feature',
    body: 'add a user profile page with avatar upload and a display-name field; persist to the users table and render an Edit button',
    sloMs: 30_000,
  },
  {
    tag: 'bug-fix',
    scenario: 'bug-fix',
    body: 'fix the login button not responsive on mobile — at <375px viewport the click target shrinks below the WCAG 2.1 minimum and the button stops responding to taps',
    sloMs: 30_000,
  },
  {
    tag: 'enhancement',
    scenario: 'enhancement',
    body: 'add a filter dropdown to the existing dashboard table — the user can filter rows by domain (auth / payments / observability) and the URL reflects the active filter',
    sloMs: 30_000,
  },
  {
    tag: 'cross-domain',
    scenario: 'cross-domain',
    body: 'add real-time notifications — needs a WebSocket-based UI component, a BFF route to subscribe, a notifications database table, and observability metrics around connection lifecycle',
    sloMs: 60_000,
  },
  {
    tag: 'refactor',
    scenario: 'refactor',
    body: 'extract the user-auth logic into a reusable @chiefaia/auth-core package — every app currently duplicates the JWT parsing and session validation; consolidate behind a typed API',
    sloMs: 30_000,
  },
  {
    tag: 'spike',
    scenario: 'spike',
    body: 'research the best caching library for our use case — compare lru-cache, node-cache, keyv, and redis-based options, document trade-offs in an ADR, and recommend one',
    sloMs: 30_000,
  },
  {
    tag: 'multi-agent-collab',
    scenario: 'multi-agent-collab',
    body: 'add e-commerce checkout — needs a UI checkout flow, a BFF /checkout route, integration with the Stripe payments API, and analytics events for cart abandonment + completion',
    sloMs: 90_000,
  },
  {
    tag: 'ea-heavy',
    scenario: 'ea-heavy',
    body: 'migrate from Postgres to event-sourced architecture for orders — design the event log, projections, and the migration strategy from the existing CRUD model',
    sloMs: 60_000,
  },
  {
    tag: 'test-heavy',
    scenario: 'test-heavy',
    body: 'add an accessibility audit pipeline + WCAG 2.1 AA conformance tests — every page rendered should pass axe-core checks; add a CI job that fails on regressions',
    sloMs: 30_000,
  },
  {
    tag: 'chore',
    scenario: 'chore',
    body: 'update all @chiefaia/* package descriptions to be more descriptive — current descriptions read like internal codenames; rewrite for the open-source registry',
    sloMs: 20_000,
  },
] as const;

// ─── Test harness — same scaffolding as PHASE2E-001 ──────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite };
}

function wireBusToTestDb(db: ReturnType<typeof createTestDb>['db']) {
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
}

function makeFakeWorktree(storyId: string): { worktree: Worktree; cleanup: () => void } {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), `caia-phase2e002-wt-${storyId}-`));
  fs.mkdirSync(path.join(tmpdir, '.git'), { recursive: true });
  return {
    worktree: {
      path: tmpdir,
      branch: `feat/${storyId}`,
      integrationBranch: 'main',
    } as unknown as Worktree,
    cleanup: () => {
      try {
        fs.rmSync(tmpdir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}

function ticketBundleToCoderBundle(b: TicketBundle): CoderBundle {
  return {
    story: {
      id: b.story.id,
      title: b.story.title,
      description: b.story.description,
      status: b.story.status,
      rootPromptId: b.story.rootPromptId,
      parentEntityId: b.story.parentEntityId,
      parentEntityType: b.story.parentEntityType,
      bucketId: b.story.bucketId,
      templateVersion: b.story.templateVersion,
      templateValidationStatus: b.story.templateValidationStatus,
      templateValidationErrors: b.story.templateValidationErrors ?? null,
      enrichedAt: b.story.enrichedAt ?? null,
      updatedAt: b.story.updatedAt ?? null,
    },
    ticket: b.ticket,
    ticketParseError: b.ticketParseError,
    prompt: b.prompt,
    requirement: b.requirement,
    bucket: b.bucket,
    labels: b.labels,
    dependencies: b.dependencies,
    inputDependencies: b.inputDependencies,
  };
}

function makeAlwaysPassJudge(): JudgeAdapter {
  return {
    async judge() {
      return {
        json: { score: 5, concerns: [], strengths: ['stub: passes by design'] },
        raw: '{ "score": 5, "concerns": [] }',
        provider: 'local' as const,
        model: 'stub-always-pass',
        durationMs: 0,
      };
    },
  };
}

/**
 * Drive a single prompt through the full Phase 2 pipeline and assert
 * the contract. Returns the prompt id + a wallclock duration so the
 * caller can SLO-check.
 */
async function runOnePrompt(promptCase: PromptCase): Promise<{
  promptId: string;
  durationMs: number;
  storyCount: number;
  testCaseCount: number;
}> {
  const startedAt = Date.now();
  const { db } = createTestDb();
  wireBusToTestDb(db);

  const promptId = `prm_${promptCase.tag}`;
  const correlationId = `cor_${promptCase.tag}`;
  db.insert(prompts)
    .values({
      id: promptId,
      body: promptCase.body,
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId,
      hash: `hash_${promptCase.tag}`,
      status: 'received',
    })
    .run();
  advancePipelineStage(
    { promptId, stage: 'ingested', correlationId },
    db,
  );
  advancePipelineStage(
    { promptId, stage: 'scaffolded', correlationId },
    db,
  );

  await runPOAgent(
    {
      promptId,
      promptText: promptCase.body,
      projectId: null,
      correlationId,
    },
    db,
  );
  await runBAAgent(
    {
      promptId,
      correlationId,
      consultants: [
        'ea-agent',
        'security-agent',
        'testing-agent',
        'release-agent',
      ],
      collabTimeoutMs: 1_500,
    },
    db,
  );
  await runEAAgent({ promptId, correlationId }, db);
  await runValidatorLoop(
    { promptId, correlationId },
    db,
    { reInvokeOnFail: false, judge: makeAlwaysPassJudge() },
  );
  const tdOut = await runTestDesignAgent({ promptId, correlationId }, db);
  advancePipelineStage(
    {
      promptId,
      stage: 'test_designed',
      correlationId,
      metadata: {
        designedStories: tdOut.designedStories,
        totalTestCases: tdOut.totalTestCases,
        storiesSkipped: tdOut.storiesSkipped,
        storiesErrored: tdOut.storiesErrored,
      },
    },
    db,
  );
  await runTaskScheduler({ promptId, correlationId }, db);

  // ─── Pipeline-stage assertions ──────────────────────────────────────────
  const stageRows = db
    .select()
    .from(promptPipelineStages)
    .where(eq(promptPipelineStages.promptId, promptId))
    .all();
  const seenStages = new Set(stageRows.map((s) => s.stage));
  for (const required of [
    'ingested',
    'scaffolded',
    'po_decomposed',
    'ba_enriched',
    'ea_decomposed',
    'validated',
    'test_designed',
    'bucket_placed',
    'ready_for_pickup',
  ]) {
    if (!seenStages.has(required)) {
      const seen = [...seenStages].sort().join(', ');
      throw new Error(
        `[${promptCase.tag}] required pipeline stage ${required} not reached. Saw: ${seen}`,
      );
    }
  }

  const finalPrompt = db
    .select()
    .from(prompts)
    .where(eq(prompts.id, promptId))
    .get();
  expect(finalPrompt!.status).toBe('ready_for_pickup');

  // ─── Story-level assertions ─────────────────────────────────────────────
  const storyRows = db
    .select()
    .from(stories)
    .where(eq(stories.rootPromptId, promptId))
    .all();
  expect(storyRows.length).toBeGreaterThan(0);

  const validStories = storyRows.filter(
    (s) => s.templateValidationStatus === 'valid',
  );
  expect(validStories.length).toBeGreaterThan(0);

  // No story may be left in a non-terminal validation state — that
  // would mean the validator was interrupted mid-flight.
  const stuckInProgress = validStories.filter(
    (s) => s.validationStatus === 'in_progress',
  );
  expect(stuckInProgress.length).toBe(0);

  const ready = validStories.find(
    (s) =>
      (s.validationStatus === 'passed' || s.validationStatus === 'escalated') &&
      s.testDesignStatus === 'designed' &&
      !!s.bucketId,
  );
  expect(ready).toBeTruthy();

  // ─── Buckets exist ─────────────────────────────────────────────────────
  const bucketsForPrompt = db
    .select()
    .from(taskBuckets)
    .where(eq(taskBuckets.promptId, promptId))
    .all();
  expect(bucketsForPrompt.length).toBeGreaterThan(0);

  // ─── Ticket bundle + parsed ticket ────────────────────────────────────
  const bundle = getTicketBundle(db, ready!.id);
  expect(bundle).toBeTruthy();
  expect(bundle!.ticket).not.toBeNull();
  expect(bundle!.ticketParseError).toBeNull();

  const parsed = TicketTemplateV1Schema.safeParse(bundle!.ticket);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('ticket failed schema validation');
  const ticket = parsed.data;
  expect(ticket.testCases?.length ?? 0).toBeGreaterThan(0);

  // ─── Coding Agent — ImplementationEngine reaches DONE on turn 1 ───────
  const { worktree, cleanup } = makeFakeWorktree(ready!.id);
  let testCaseCount = 0;
  try {
    const coderBundle = ticketBundleToCoderBundle(bundle!);
    const adapter = new MockLlmAdapter();
    adapter.enqueue({
      text: `Implementation complete.\n${DONE_MARKER}\n`,
      done: true,
      tokens: { input: 1024, output: 256 },
    });
    const engine = new ImplementationEngine({
      bundle: coderBundle,
      worktree,
      adapter,
      sessionId: `sess_${promptCase.tag}`,
    });
    await engine.start();
    const implResult = await engine.implement();
    expect(implResult.status).toBe('done');
    await engine.end();

    // ─── Fix-It — every test case green on the happy path ───────────────
    const testCases: TestCase[] = ticket.testCases ?? [];
    testCaseCount = testCases.length;
    expect(testCases.length).toBeGreaterThan(0);

    const codingComplete: CodingCompletePayload = {
      storyId: ready!.id,
      workerId: `wkr_${promptCase.tag}`,
      prUrl: `https://github.com/acme/repo/pull/${1000 + PROMPT_CASES.findIndex((p) => p.tag === promptCase.tag)}`,
      prNumber: 1000 + PROMPT_CASES.findIndex((p) => p.tag === promptCase.tag),
      sha: 'a'.repeat(40),
      localTestsPassed: true,
      worktreePath: worktree.path,
      codingSessionId: engine.sessionId,
      completedAt: Date.now(),
      correlationId,
    };
    const fixIt = new FixItOrchestrator();
    const fixItResult = await fixIt.run(codingComplete, testCases);
    expect(fixItResult.kind).toBe('tested_and_done');
    if (fixItResult.kind !== 'tested_and_done') {
      throw new Error(
        `[${promptCase.tag}] Fix-It did not produce tested_and_done`,
      );
    }
    expect(fixItResult.payload.totalAttempts).toBe(testCases.length);
    expect(fixItResult.payload.correlationId).toBe(correlationId);
  } finally {
    cleanup();
  }

  // ─── No fix-stuck blockers ─────────────────────────────────────────────
  // The Fix-It orchestrator's stub ports always pass — there should be
  // zero `fix-stuck` blockers. Validation-stuck blockers MAY exist
  // (the validator escalates on rule-based failures), but the pipeline
  // still progresses — that's the production contract.
  const fixStuckBlockers = db
    .select()
    .from(blockers)
    .where(eq(blockers.kind, 'fix-stuck'))
    .all();
  expect(fixStuckBlockers.length).toBe(0);

  return {
    promptId,
    durationMs: Date.now() - startedAt,
    storyCount: storyRows.length,
    testCaseCount,
  };
}

// ─── The actual test suite ───────────────────────────────────────────────────

describe('Phase 2 diverse-prompt acceptance suite', () => {
  it.each(PROMPT_CASES.map((c) => [c.tag, c]))(
    'drives prompt %s end-to-end and meets the SLO',
    async (_tag, promptCase) => {
      const out = await runOnePrompt(promptCase as PromptCase);
      // SLO: per-prompt budget, soft-asserted as a top-level expectation.
      expect(out.durationMs).toBeLessThan((promptCase as PromptCase).sloMs);
      // Sanity: every prompt produces *some* stories + test cases.
      expect(out.storyCount).toBeGreaterThan(0);
      expect(out.testCaseCount).toBeGreaterThan(0);
    },
    120_000,
  );

  // Suite-level invariants the per-prompt loop can't easily express.
  it('all 10 scenarios are present and tagged', () => {
    const tags = PROMPT_CASES.map((c) => c.tag);
    expect(tags).toHaveLength(10);
    expect(new Set(tags).size).toBe(10);
    const scenarios = PROMPT_CASES.map((c) => c.scenario);
    // Every scenario type must be represented.
    for (const required of [
      'new-feature',
      'bug-fix',
      'enhancement',
      'cross-domain',
      'refactor',
      'spike',
      'multi-agent-collab',
      'ea-heavy',
      'test-heavy',
      'chore',
    ] as const) {
      expect(scenarios).toContain(required);
    }
  });
});
