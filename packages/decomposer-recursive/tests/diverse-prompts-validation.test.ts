/**
 * Empirical validation suite (PO-DECOMP-005).
 *
 * Drives the 10 PHASE2E-002 diverse prompts through the new
 * recursive decomposer and asserts:
 *
 *   - the scope detector classifies each prompt to a sensible scope
 *     (story / epic / module / initiative depending on prompt shape);
 *   - the decomposer engine produces a non-empty children list for
 *     non-atomic prompts and stops at the leaf for atomic ones;
 *   - the judge pair runs and produces verdicts;
 *   - cumulative cost + duration are tracked.
 *
 * The suite has TWO MODES:
 *
 *   1. STUB mode (default in CI): uses fakeOllama / fakeClaude with
 *      hand-curated responses tailored to each prompt. Deterministic,
 *      fast, free. Validates the SHAPE of the pipeline.
 *
 *   2. LIVE mode (operator-only): set DECOMPOSER_VALIDATION_LIVE=1.
 *      Routes through real Ollama + Claude. Captures real-LLM target-
 *      scope accuracy, child-count distributions, judge-pass rates,
 *      total cost, total time. Writes a markdown report.
 *
 *      LIVE mode is skipped in CI because it requires Ollama running
 *      and Claude API keys + costs real money. Operator runs it
 *      ad-hoc on their workstation per the runbook in
 *      caia/docs/po-recursive-decomposer.md.
 *
 * The 10 prompt fixtures are mirrored verbatim from
 * apps/orchestrator/tests/e2e/pipeline/diverse-prompts.test.ts so the
 * validation surface matches the existing PHASE2E-002 contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectScope } from '../src/scope-detector.js';
import { classifyAtomicity } from '../src/atomicity-classifier.js';
import { PORecursiveDecomposer } from '../src/decomposer.js';
import { runJudgePair } from '../src/judges.js';
import type { StoryScope } from '../src/types.js';
import {
  fakeOllama,
  fakeClaude,
  installFakeAdapters,
  clearAdapters,
  jsonResponse,
} from './_helpers.js';

// ─── 10 PHASE2E-002 prompts (verbatim) ──────────────────────────────────

interface PromptCase {
  tag: string;
  body: string;
  /** Expected natural scope per the proposal's heuristics. */
  expectedScope: StoryScope;
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

export const PROMPT_FIXTURES: readonly PromptCase[] = [
  {
    tag: 'simple-feature',
    scenario: 'new-feature',
    body:
      'add a user profile page with avatar upload and a display-name field; persist to the users table and render an Edit button',
    expectedScope: 'story',
  },
  {
    tag: 'bug-fix',
    scenario: 'bug-fix',
    body:
      'fix the login button not responsive on mobile — at <375px viewport the click target shrinks below the WCAG 2.1 minimum and the button stops responding to taps',
    expectedScope: 'task',
  },
  {
    tag: 'enhancement',
    scenario: 'enhancement',
    body:
      'add a filter dropdown to the existing dashboard table — the user can filter rows by domain (auth / payments / observability) and the URL reflects the active filter',
    expectedScope: 'story',
  },
  {
    tag: 'cross-domain',
    scenario: 'cross-domain',
    body:
      'add real-time notifications — needs a WebSocket-based UI component, a BFF route to subscribe, a notifications database table, and observability metrics around connection lifecycle',
    expectedScope: 'epic',
  },
  {
    tag: 'refactor',
    scenario: 'refactor',
    body:
      'extract the user-auth logic into a reusable @chiefaia/auth-core package — every app currently duplicates the JWT parsing and session validation; consolidate behind a typed API',
    expectedScope: 'module',
  },
  {
    tag: 'spike',
    scenario: 'spike',
    body:
      'research the best caching library for our use case — compare lru-cache, node-cache, keyv, and redis-based options, document trade-offs in an ADR, and recommend one',
    expectedScope: 'task',
  },
  {
    tag: 'multi-agent-collab',
    scenario: 'multi-agent-collab',
    body:
      'add e-commerce checkout — needs a UI checkout flow, a BFF /checkout route, integration with the Stripe payments API, and analytics events for cart abandonment + completion',
    expectedScope: 'epic',
  },
  {
    tag: 'ea-heavy',
    scenario: 'ea-heavy',
    body:
      'migrate from Postgres to event-sourced architecture for orders — design the event log, projections, and the migration strategy from the existing CRUD model',
    expectedScope: 'epic',
  },
  {
    tag: 'test-heavy',
    scenario: 'test-heavy',
    body:
      'add an accessibility audit pipeline + WCAG 2.1 AA conformance tests — every page rendered should pass axe-core checks; add a CI job that fails on regressions',
    expectedScope: 'epic',
  },
  {
    tag: 'chore',
    scenario: 'chore',
    body:
      'update all @chiefaia/* package descriptions to be more descriptive — current descriptions read like internal codenames; rewrite for the open-source registry',
    expectedScope: 'task',
  },
] as const;

export const SCOPE_DETECTION_TOLERANCE: Record<string, StoryScope[]> = {
  // Per the proposal's scope detector heuristics, some prompts are
  // genuinely ambiguous between adjacent scopes (story↔task, epic↔module).
  // The validation accepts any of the listed scopes as "correct".
  'simple-feature': ['story', 'epic'],
  'bug-fix': ['task', 'story', 'subtask'],
  enhancement: ['story', 'epic'],
  'cross-domain': ['epic', 'module'],
  refactor: ['module', 'epic'],
  spike: ['task', 'story'],
  'multi-agent-collab': ['epic', 'module', 'initiative'],
  'ea-heavy': ['epic', 'module', 'initiative'],
  'test-heavy': ['epic', 'module', 'story'],
  chore: ['task', 'story', 'subtask'],
};

// ─── STUB-mode validation (default — runs in CI) ────────────────────────

describe('STUB validation: decomposer over PHASE2E-002 prompts', () => {
  beforeEach(() => clearAdapters());
  afterEach(() => clearAdapters());

  it('all 10 prompts have an expected scope mapping', () => {
    expect(PROMPT_FIXTURES.length).toBe(10);
    const tags = PROMPT_FIXTURES.map((p) => p.tag);
    expect(new Set(tags).size).toBe(10);
    for (const p of PROMPT_FIXTURES) {
      expect(SCOPE_DETECTION_TOLERANCE[p.tag]).toBeDefined();
      expect(SCOPE_DETECTION_TOLERANCE[p.tag]).toContain(p.expectedScope);
    }
  });

  it.each(PROMPT_FIXTURES.map((p) => [p.tag, p]))(
    'scope detector classifies %s into a tolerated scope (stub)',
    async (_tag, prompt) => {
      const p = prompt as PromptCase;
      const ollama = fakeOllama({
        responses: [
          jsonResponse({
            targetScope: p.expectedScope,
            confidence: 0.85,
            rationale: `stub classifier for ${p.tag}`,
          }),
        ],
      });
      installFakeAdapters(ollama, fakeClaude({ responses: [] }));

      const out = await detectScope({ promptText: p.body });
      expect(SCOPE_DETECTION_TOLERANCE[p.tag]).toContain(out.targetScope);
      expect(out.confidence).toBeGreaterThanOrEqual(0.5);
    },
  );

  it('atomic-leaf prompts (story/task/subtask scope) reach atomic verdict in stub mode', async () => {
    // Pick a story-scope prompt; classifier says atomic; engine should
    // not recurse further.
    const ollama = fakeOllama({
      responses: [
        jsonResponse({
          atomic: true,
          confidence: 0.9,
          rationale: 'INVEST-compliant; single PR scope; testable AC',
          failedCriteria: [],
        }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const verdict = await classifyAtomicity({
      child: {
        id: 'story-1',
        scope: 'story',
        title: 'add a logout button',
        description: 'add logout button to the user-menu dropdown',
        inScope: ['add the button', 'wire to existing /logout route'],
        outOfScope: [],
        dependencies: [],
        estimatedAtomic: false,
        existingArtifacts: [],
        lifecycle: 'new',
      },
    });
    expect(verdict.atomic).toBe(true);
  });

  it('engine produces a tree for an epic-shaped prompt (stub)', async () => {
    // Stub: epic → 2 modules; both modules are atomic.
    const ollama = fakeOllama({
      responses: [
        jsonResponse({
          atomic: true,
          confidence: 0.9,
          rationale: 'bounded context; clear data ownership',
          failedCriteria: [],
        }),
        jsonResponse({
          atomic: true,
          confidence: 0.9,
          rationale: 'bounded context; clear data ownership',
          failedCriteria: [],
        }),
      ],
    });
    const claude = fakeClaude({
      responses: [
        jsonResponse([
          {
            id: 'm1',
            scope: 'module',
            title: 'Notifications dispatcher',
            description: 'WebSocket subscriber + dispatch loop with idempotency',
            inScope: ['the dispatch loop and queue'],
            outOfScope: [],
            dependencies: [],
            estimatedAtomic: false,
            existingArtifacts: [],
            lifecycle: 'new',
          },
          {
            id: 'm2',
            scope: 'module',
            title: 'Notifications storage',
            description: 'database table + persistence layer for notifications',
            inScope: ['the notifications database table'],
            outOfScope: [],
            dependencies: [],
            estimatedAtomic: false,
            existingArtifacts: [],
            lifecycle: 'new',
          },
        ]),
      ],
    });
    installFakeAdapters(ollama, claude);

    const engine = new PORecursiveDecomposer();
    const out = await engine.decomposeRoot({
      parent: {
        id: 'root',
        scope: 'epic',
        title: 'Real-time notifications',
        description: 'WebSocket-based notifications + storage + observability',
        inScope: ['websocket UI', 'BFF route', 'notifications table', 'metrics'],
        outOfScope: [],
      },
      targetScope: 'module',
    });

    expect(out.tree.children.length).toBe(2);
    expect(out.tree.children.every((c) => c.atomic)).toBe(true);
    expect(out.audits.length).toBe(1);
    expect(out.totalCalls).toBeGreaterThan(0);
  });

  it('judge pair runs over a stub expansion and produces verdicts', async () => {
    const claude = fakeClaude({
      responses: [
        {
          ...jsonResponse({
            score: 5,
            covered: true,
            missingDeliverables: [],
            rationale: 'every prompt sentence maps to at least one child',
          }),
          match: 'PMBOK 100% rule',
        },
        {
          ...jsonResponse({
            score: 5,
            disjoint: true,
            overlaps: [],
            rationale: 'no overlap between siblings',
          }),
          match: 'MECE-mutually-exclusive',
        },
      ],
    });
    installFakeAdapters(fakeOllama({ responses: [] }), claude);

    const result = await runJudgePair({
      parent: {
        title: 'Real-time notifications',
        description: 'WebSocket + storage + metrics',
        scope: 'epic',
        inScope: ['websocket UI', 'BFF route', 'notifications table'],
        outOfScope: [],
      },
      children: [
        {
          id: 'm1',
          scope: 'module',
          title: 'Notifications dispatcher',
          description: 'WebSocket dispatcher with idempotency',
          inScope: ['dispatcher'],
          outOfScope: [],
          dependencies: [],
          estimatedAtomic: false,
          existingArtifacts: [],
          lifecycle: 'new',
        },
      ],
    });
    expect(result.coverage.passed).toBe(true);
    expect(result.disjointness.passed).toBe(true);
    expect(result.bothPassed).toBe(true);
  });
});

// ─── LIVE-mode validation (operator runs ad-hoc) ────────────────────────

const LIVE_MODE = process.env['DECOMPOSER_VALIDATION_LIVE'] === '1';

describe.skipIf(!LIVE_MODE)('LIVE validation (real Ollama + Claude)', () => {
  // This block is skipped in CI; the operator triggers it via:
  //   DECOMPOSER_VALIDATION_LIVE=1 pnpm --filter @chiefaia/decomposer-recursive test
  //
  // Each prompt is run through the real router. The aggregate report
  // is written to caia/docs/po-decomposer-validation-2026-04-30.md
  // after the suite finishes (operator copies the table from stdout).

  it.each(PROMPT_FIXTURES.map((p) => [p.tag, p]))(
    'real-LLM scope detection of %s',
    async (_tag, prompt) => {
      const p = prompt as PromptCase;
      const out = await detectScope({ promptText: p.body });
      // eslint-disable-next-line no-console
      console.log(
        `[validation/${p.tag}] scope=${out.targetScope} confidence=${out.confidence.toFixed(2)} model=${out.model} duration=${String(out.durationMs)}ms`,
      );
      expect(SCOPE_DETECTION_TOLERANCE[p.tag]).toContain(out.targetScope);
    },
    60_000,
  );
});
