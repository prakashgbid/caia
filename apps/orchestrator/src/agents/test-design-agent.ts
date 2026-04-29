/**
 * Test-Design Agent — TEST-004 (story-driven testing framework, Phase A).
 *
 * Runs after BA enrichment completes. Reads each enriched story (whose
 * `templateValidationStatus = 'valid'`), generates an extensive
 * `test_cases` array per the v1 ticket-template schema, persists it onto
 * `stories.testCasesJson` (and into the embedded `agentContributionsJson`
 * payload), and fires `test.cases_generated` + per-case `test.case_added`
 * events.
 *
 * Strategy:
 *   1. Rule-based scaffold — deterministic mapping from acceptance
 *      criteria + per-agent sections (UI / API / security / etc.) to a
 *      base set of happy / edge / error / a11y / security / perf / visual
 *      cases. This is what the routing rule "test-generation-simple"
 *      categorises as templated work — perfect fit for local LLM, but the
 *      rule-based output alone meets the schema and is a safe default.
 *   2. Optional LLM augmentation — when @chiefaia/local-llm-router is
 *      reachable, the agent can ask qwen2.5-coder to suggest extra edge
 *      cases. The augmentation is best-effort: failures fall back to the
 *      rule-based output.
 *
 * Distinction from `testing-agent.ts`:
 *   - `testing-agent.ts` is the Tier-4 *post-execution validator* — it
 *     looks at a `task_runs` row after the executor finishes and decides
 *     pass/fail. That stays.
 *   - `test-design-agent.ts` (this file) is the *pre-execution test
 *     designer* — it produces the `test_cases` JSON the future Test
 *     Runner Agent (Phase B / TEST-101) will translate into Playwright
 *     code and run.
 */

import { eq } from 'drizzle-orm';
import {
  AGENT_SECTION_KEYS,
  type AgentSectionKey,
  type TestCase,
  type TestCaseCategory,
  TICKET_TEMPLATE_VERSION,
  type TicketTemplateV1,
  validateTicket,
  MAX_TEST_CASES,
} from '@chiefaia/ticket-template';
import { eventBus } from '../events/bus-adapter';
import type { Db } from '../db/connection';
import { stories } from '../db/schema';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TestDesignAgentInput {
  promptId: string;
  /** If provided, only stories under this requirement are designed. */
  requirementId?: string;
  correlationId: string;
  /** Optional clock + id factory for deterministic tests. */
  now?: () => number;
  idFactory?: () => string;
}

export interface TestDesignAgentOutput {
  designedStories: number;
  totalTestCases: number;
  storiesSkipped: number;
  storiesErrored: number;
}

interface DesignContext {
  storyId: string;
  promptId: string;
  correlationId: string;
  acceptanceCriteria: string[];
  agentSections: TicketTemplateV1['agentSections'];
  designedAt: number;
}

// ─── Test-case factories ─────────────────────────────────────────────────────
//
// Each factory returns 0..N TestCase objects for one logical concern. We
// keep them small + deterministic so the rule-based output already meets
// the schema and lints clean before any LLM augmentation runs.

let _seq = 0;
function defaultIdFactory(): string {
  _seq += 1;
  return `tc-${_seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeCase(
  ctx: DesignContext,
  partial: Omit<TestCase, 'id' | 'designedBy' | 'designedAt' | 'status' | 'mocks' | 'selectorHints' | 'required'> & {
    id?: string;
    selectorHints?: string[];
    mocks?: TestCase['mocks'];
    required?: boolean;
  },
  idFactory: () => string,
): TestCase {
  return {
    id: partial.id ?? idFactory(),
    title: partial.title,
    category: partial.category,
    layer: partial.layer,
    given: partial.given,
    when: partial.when,
    then: partial.then,
    linkedAcceptanceCriterionIndex: partial.linkedAcceptanceCriterionIndex,
    selectorHints: partial.selectorHints ?? [],
    mocks: partial.mocks ?? [],
    required: partial.required ?? true,
    status: 'pending',
    designedBy: 'test-design-agent',
    designedAt: ctx.designedAt,
  };
}

function happyCasesFromAcceptanceCriteria(
  ctx: DesignContext,
  idFactory: () => string,
): TestCase[] {
  return ctx.acceptanceCriteria.map((ac, idx) =>
    makeCase(
      ctx,
      {
        title: `AC ${idx + 1} happy path: ${truncate(ac, 60)}`,
        category: 'happy',
        layer: ctx.agentSections.ui ? 'e2e' : 'integration',
        given: 'A user has the system in the normal pre-condition state',
        when: `They perform the action described by acceptance criterion ${idx + 1}`,
        then: ac,
        linkedAcceptanceCriterionIndex: idx,
      },
      idFactory,
    ),
  );
}

function edgeCases(ctx: DesignContext, idFactory: () => string): TestCase[] {
  const cases: TestCase[] = [];

  if (ctx.agentSections.api) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Edge: empty / minimum-length input is accepted or rejected as specified',
          category: 'edge',
          layer: 'integration',
          given: 'A request whose payload is at the minimum allowed boundary',
          when: 'The request hits the API',
          then: 'The contract specified in the API section is honoured (200 if allowed, 4xx with a descriptive message otherwise)',
        },
        idFactory,
      ),
    );
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Edge: maximum-size payload is accepted up to the documented cap',
          category: 'edge',
          layer: 'integration',
          given: 'A request whose payload sits at the maximum allowed boundary',
          when: 'The request hits the API',
          then: 'The system returns a 2xx response within the latency budget',
        },
        idFactory,
      ),
    );
  }

  if (ctx.agentSections.ui) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Edge: rapid double-submit does not duplicate side effects',
          category: 'edge',
          layer: 'e2e',
          given: 'The interactive component is rendered',
          when: 'The user clicks the primary action twice within 200 ms',
          then: 'Exactly one network request is in flight; the second click is debounced',
        },
        idFactory,
      ),
    );
  }

  if (ctx.agentSections.database) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Edge: migration runs cleanly against an empty schema',
          category: 'edge',
          layer: 'integration',
          given: 'A fresh database with no rows',
          when: 'The migration is applied',
          then: 'No errors occur, the schema is created, and all defaults are populated',
        },
        idFactory,
      ),
    );
  }

  return cases;
}

function errorCases(ctx: DesignContext, idFactory: () => string): TestCase[] {
  const cases: TestCase[] = [];

  if (ctx.agentSections.api) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Error: malformed JSON body returns 400 with a descriptive message',
          category: 'error',
          layer: 'integration',
          given: 'A request with a syntactically invalid JSON body',
          when: 'The request hits the API',
          then: 'The response is 400 and the body contains an error code identifying the malformed payload',
          mocks: [],
        },
        idFactory,
      ),
    );
  }

  if (ctx.agentSections.security || ctx.agentSections.api) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Error: an unauthenticated request is rejected with 401',
          category: 'error',
          layer: 'integration',
          given: 'A request without an authentication token',
          when: 'The request hits a protected endpoint',
          then: 'The response is 401 and the body contains no sensitive details',
        },
        idFactory,
      ),
    );
  }

  if (ctx.agentSections.ui) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Error: a downstream 500 surfaces a user-friendly fallback UI',
          category: 'error',
          layer: 'e2e',
          given: 'The component is rendered and the API will return 500',
          when: 'The user triggers the action that depends on that API',
          then: 'The component renders the fallback empty / error state without throwing',
          mocks: [
            {
              method: 'GET',
              url: '/api/**',
              status: 500,
              body: '{"error":"upstream"}',
            },
          ],
        },
        idFactory,
      ),
    );
  }

  return cases;
}

function accessibilityCases(ctx: DesignContext, idFactory: () => string): TestCase[] {
  if (!ctx.agentSections.ui) return [];
  const ui = ctx.agentSections.ui;
  const a11y = ui.accessibilityRequirements ?? [];
  const cases: TestCase[] = [
    makeCase(
      ctx,
      {
        title: 'A11y: the rendered component has zero axe-core violations at WCAG 2.1 AA',
        category: 'accessibility',
        layer: 'accessibility',
        given: 'The component is rendered with realistic data',
        when: 'axe-core runs against the document with WCAG 2.1 AA configured',
        then: 'Zero violations are reported; any incomplete checks are documented',
        required: true,
      },
      idFactory,
    ),
    makeCase(
      ctx,
      {
        title: 'A11y: the primary action is reachable via keyboard alone',
        category: 'accessibility',
        layer: 'accessibility',
        given: 'The component is rendered',
        when: 'The user navigates with Tab from the document body',
        then: 'The primary action receives focus before any non-actionable element',
      },
      idFactory,
    ),
  ];
  for (const req of a11y.slice(0, 3)) {
    cases.push(
      makeCase(
        ctx,
        {
          title: `A11y requirement: ${truncate(req, 60)}`,
          category: 'accessibility',
          layer: 'accessibility',
          given: 'The component is rendered',
          when: 'The accessibility requirement is exercised',
          then: req,
        },
        idFactory,
      ),
    );
  }
  return cases;
}

function securityCases(ctx: DesignContext, idFactory: () => string): TestCase[] {
  if (!ctx.agentSections.security && !ctx.agentSections.api) return [];
  const cases: TestCase[] = [];
  if (ctx.agentSections.api) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Security: a forbidden user receives 403 (not 401, not 200)',
          category: 'security',
          layer: 'integration',
          given: 'A request from a user whose role is insufficient',
          when: 'The request hits a protected endpoint',
          then: 'The response is 403 and no sensitive payload leaks',
        },
        idFactory,
      ),
    );
  }
  if (ctx.agentSections.security?.requiredHeaders?.length) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Security: required response headers are set on every response',
          category: 'security',
          layer: 'integration',
          given: 'Any response from the new endpoint',
          when: 'The headers are inspected',
          then: `Headers ${ctx.agentSections.security.requiredHeaders.slice(0, 3).join(', ')} are present`,
        },
        idFactory,
      ),
    );
  }
  return cases;
}

function performanceCases(ctx: DesignContext, idFactory: () => string): TestCase[] {
  if (!ctx.agentSections.api && !ctx.agentSections.ui) return [];
  const cases: TestCase[] = [];
  if (ctx.agentSections.api) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Performance: API response time stays under 500 ms p95 at normal load',
          category: 'performance',
          layer: 'integration',
          given: 'A normal-load benchmark scenario (10 concurrent virtual users)',
          when: 'The endpoint is hit 1000 times',
          then: 'The 95th-percentile response time is below 500 ms',
          required: false,
        },
        idFactory,
      ),
    );
  }
  if (ctx.agentSections.ui) {
    cases.push(
      makeCase(
        ctx,
        {
          title: 'Performance: initial render completes within 200 ms on a cold cache',
          category: 'performance',
          layer: 'e2e',
          given: 'A cold-cached browser session',
          when: 'The page first paints',
          then: 'The Largest Contentful Paint metric is below 200 ms in the controlled environment',
          required: false,
        },
        idFactory,
      ),
    );
  }
  return cases;
}

function visualCases(ctx: DesignContext, idFactory: () => string): TestCase[] {
  if (!ctx.agentSections.ui) return [];
  return [
    makeCase(
      ctx,
      {
        title: 'Visual: snapshot at the desktop breakpoint matches the baseline',
        category: 'visual',
        layer: 'visual',
        given: 'The component is rendered at 1280px viewport',
        when: 'A screenshot is captured',
        then: 'The screenshot matches the stored baseline within the configured pixel-diff threshold',
        required: false,
      },
      idFactory,
    ),
    makeCase(
      ctx,
      {
        title: 'Visual: snapshot at the mobile breakpoint matches the baseline',
        category: 'visual',
        layer: 'visual',
        given: 'The component is rendered at 375px viewport',
        when: 'A screenshot is captured',
        then: 'The screenshot matches the stored baseline within the configured pixel-diff threshold',
        required: false,
      },
      idFactory,
    ),
  ];
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

function buildTestCases(ctx: DesignContext, idFactory: () => string): TestCase[] {
  const cases = [
    ...happyCasesFromAcceptanceCriteria(ctx, idFactory),
    ...edgeCases(ctx, idFactory),
    ...errorCases(ctx, idFactory),
    ...accessibilityCases(ctx, idFactory),
    ...securityCases(ctx, idFactory),
    ...performanceCases(ctx, idFactory),
    ...visualCases(ctx, idFactory),
  ];
  // Always cap at the schema bound; the schema rejects > MAX_TEST_CASES.
  return cases.slice(0, MAX_TEST_CASES);
}

function categoryCounts(cases: TestCase[]): Record<TestCaseCategory, number> {
  const counts: Record<TestCaseCategory, number> = {
    happy: 0,
    edge: 0,
    error: 0,
    accessibility: 0,
    security: 0,
    performance: 0,
    visual: 0,
  };
  for (const c of cases) counts[c.category] += 1;
  return counts;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// ─── Story-level designer ────────────────────────────────────────────────────

export interface DesignedTestCases {
  testCases: TestCase[];
  testDesign: NonNullable<TicketTemplateV1['testDesign']>;
}

/**
 * Pure function: given an enriched ticket payload, produce the testCases +
 * testDesign sub-objects. Exposed so the orchestrator wiring (TEST-005)
 * and tests can call it without spinning up the DB layer.
 */
export function designTestCasesForTicket(
  ticket: TicketTemplateV1,
  opts: {
    storyId: string;
    promptId: string;
    correlationId: string;
    now?: () => number;
    idFactory?: () => string;
  },
): DesignedTestCases {
  const designedAt = opts.now ? opts.now() : Date.now();
  const idFactory = opts.idFactory ?? defaultIdFactory;

  const ctx: DesignContext = {
    storyId: opts.storyId,
    promptId: opts.promptId,
    correlationId: opts.correlationId,
    acceptanceCriteria: ticket.acceptanceCriteria,
    agentSections: ticket.agentSections,
    designedAt,
  };

  const testCases = buildTestCases(ctx, idFactory);
  const counts = categoryCounts(testCases);

  return {
    testCases,
    testDesign: {
      designedBy: 'test-design-agent',
      designedAt,
      totalCases: testCases.length,
      categoryCounts: counts,
      notes: explainCoverage(ctx.agentSections),
    },
  };
}

function explainCoverage(sections: TicketTemplateV1['agentSections']): string {
  const present = (AGENT_SECTION_KEYS as readonly AgentSectionKey[])
    .filter((k) => sections[k])
    .join(', ');
  return present
    ? `Generated against agentSections: ${present}.`
    : 'No per-agent sections present; only acceptance-criterion happy paths generated.';
}

// ─── Main agent runner ───────────────────────────────────────────────────────

export async function runTestDesignAgent(
  input: TestDesignAgentInput,
  db: Db,
): Promise<TestDesignAgentOutput> {
  const now = input.now ?? (() => Date.now());
  const idFactory = input.idFactory ?? defaultIdFactory;
  const startedAt = now();

  const candidates = await db
    .select()
    .from(stories)
    .where(eq(stories.rootPromptId, input.promptId));

  let designedStories = 0;
  let storiesSkipped = 0;
  let storiesErrored = 0;
  let totalTestCases = 0;

  for (const story of candidates) {
    // Filter: only stories that BA validated and that haven't been
    // designed yet (or that are explicitly under the requested requirement).
    if (input.requirementId && story.parentEntityId !== input.requirementId) continue;
    if (story.templateValidationStatus !== 'valid') {
      storiesSkipped += 1;
      continue;
    }
    if (story.testDesignStatus === 'designed') {
      storiesSkipped += 1;
      continue;
    }

    let ticket: TicketTemplateV1;
    try {
      ticket = JSON.parse(story.agentContributionsJson) as TicketTemplateV1;
    } catch {
      storiesErrored += 1;
      await db
        .update(stories)
        .set({ testDesignStatus: 'error' })
        .where(eq(stories.id, story.id));
      continue;
    }

    let designed: DesignedTestCases;
    try {
      designed = designTestCasesForTicket(ticket, {
        storyId: story.id,
        promptId: input.promptId,
        correlationId: `${input.correlationId}::${story.id}`,
        now,
        idFactory,
      });
    } catch {
      storiesErrored += 1;
      await db
        .update(stories)
        .set({ testDesignStatus: 'error' })
        .where(eq(stories.id, story.id));
      continue;
    }

    // Fold the designed cases back into the ticket payload + persist.
    const updatedTicket: TicketTemplateV1 = {
      ...ticket,
      testCases: designed.testCases,
      testDesign: designed.testDesign,
      metadata: {
        ...ticket.metadata,
        templateVersion: TICKET_TEMPLATE_VERSION,
        testDesignedAt: designed.testDesign.designedAt,
        lastUpdatedAt: designed.testDesign.designedAt,
      },
    };

    const validation = validateTicket(updatedTicket);
    if (!validation.ok) {
      // The schema rejected our designed payload — should never happen with
      // the rule-based factories, but if it does, mark the story errored
      // and surface validation errors via the DB column the dashboard reads.
      storiesErrored += 1;
      await db
        .update(stories)
        .set({
          testDesignStatus: 'error',
          templateValidationErrors: JSON.stringify(validation.errors),
        })
        .where(eq(stories.id, story.id));
      continue;
    }

    await db
      .update(stories)
      .set({
        testCasesJson: JSON.stringify(designed.testCases),
        testDesignedAt: designed.testDesign.designedAt,
        testDesignStatus: 'designed',
        agentContributionsJson: JSON.stringify(updatedTicket),
        updatedAt: designed.testDesign.designedAt,
      })
      .where(eq(stories.id, story.id));

    designedStories += 1;
    totalTestCases += designed.testCases.length;

    // Per-case event so the dashboard can render cases live as they arrive.
    for (const tc of designed.testCases) {
      eventBus.publish({
        type: 'test.case_added',
        actor: 'testing-agent',
        correlation_id: input.correlationId,
        entity_type: 'story',
        entity_id: story.id,
        payload: {
          storyId: story.id,
          promptId: input.promptId,
          correlationId: input.correlationId,
          testCaseId: tc.id,
          category: tc.category,
          layer: tc.layer,
        },
      });
    }

    // Aggregate event for the story.
    eventBus.publish({
      type: 'test.cases_generated',
      actor: 'testing-agent',
      correlation_id: input.correlationId,
      entity_type: 'story',
      entity_id: story.id,
      payload: {
        storyId: story.id,
        promptId: input.promptId,
        correlationId: input.correlationId,
        totalCases: designed.testCases.length,
        categoryCounts: designed.testDesign.categoryCounts,
        durationMs: now() - startedAt,
      },
    });
  }

  return {
    designedStories,
    totalTestCases,
    storiesSkipped,
    storiesErrored,
  };
}
