/**
 * The 10 PHASE2E-002 prompts — vendored from
 * `packages/decomposer-recursive/tests/diverse-prompts-validation.test.ts`
 * so the eval set can be emitted without depending on a test file.
 *
 * Keep in sync. The validation suite imports `PROMPT_FIXTURES` from the
 * test file; here we re-encode the same data with `tolerance` already
 * resolved per row so the JSONL eval rows are flat.
 *
 * Source of truth: `SCOPE_DETECTION_TOLERANCE` + `PROMPT_FIXTURES` in
 * the validation test. PRs that mutate one MUST mutate both — covered
 * by a sync test in PR4.
 */

import type { TrainsetRow } from '../trainset.js';

export interface Phase2e002Fixture {
  tag: string;
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
  body: string;
  /** The single "primary" expected scope per the proposal heuristics. */
  expectedScope:
    | 'initiative' | 'epic' | 'module' | 'story' | 'task' | 'subtask';
  /** All scopes the proposal accepts as "correct" for this prompt. */
  tolerance: ReadonlyArray<
    'initiative' | 'epic' | 'module' | 'story' | 'task' | 'subtask'
  >;
}

export const PHASE2E_002_FIXTURES: readonly Phase2e002Fixture[] = [
  {
    tag: 'simple-feature',
    scenario: 'new-feature',
    body:
      'add a user profile page with avatar upload and a display-name field; persist to the users table and render an Edit button',
    expectedScope: 'story',
    tolerance: ['story', 'epic'],
  },
  {
    tag: 'bug-fix',
    scenario: 'bug-fix',
    body:
      'fix the login button not responsive on mobile — at <375px viewport the click target shrinks below the WCAG 2.1 minimum and the button stops responding to taps',
    expectedScope: 'task',
    tolerance: ['task', 'story', 'subtask'],
  },
  {
    tag: 'enhancement',
    scenario: 'enhancement',
    body:
      'add a filter dropdown to the existing dashboard table — the user can filter rows by domain (auth / payments / observability) and the URL reflects the active filter',
    expectedScope: 'story',
    tolerance: ['story', 'epic'],
  },
  {
    tag: 'cross-domain',
    scenario: 'cross-domain',
    body:
      'add real-time notifications — needs a WebSocket-based UI component, a BFF route to subscribe, a notifications database table, and observability metrics around connection lifecycle',
    expectedScope: 'epic',
    tolerance: ['epic', 'module'],
  },
  {
    tag: 'refactor',
    scenario: 'refactor',
    body:
      'extract the user-auth logic into a reusable @chiefaia/auth-core package — every app currently duplicates the JWT parsing and session validation; consolidate behind a typed API',
    expectedScope: 'module',
    tolerance: ['module', 'epic'],
  },
  {
    tag: 'spike',
    scenario: 'spike',
    body:
      'research the best caching library for our use case — compare lru-cache, node-cache, keyv, and redis-based options, document trade-offs in an ADR, and recommend one',
    expectedScope: 'task',
    tolerance: ['task', 'story'],
  },
  {
    tag: 'multi-agent-collab',
    scenario: 'multi-agent-collab',
    body:
      'add e-commerce checkout — needs a UI checkout flow, a BFF /checkout route, integration with the Stripe payments API, and analytics events for cart abandonment + completion',
    expectedScope: 'epic',
    tolerance: ['epic', 'module', 'initiative'],
  },
  {
    tag: 'ea-heavy',
    scenario: 'ea-heavy',
    body:
      'migrate from Postgres to event-sourced architecture for orders — design the event log, projections, and the migration strategy from the existing CRUD model',
    expectedScope: 'epic',
    tolerance: ['epic', 'module', 'initiative'],
  },
  {
    tag: 'test-heavy',
    scenario: 'test-heavy',
    body:
      'add an accessibility audit pipeline + WCAG 2.1 AA conformance tests — every page rendered should pass axe-core checks; add a CI job that fails on regressions',
    expectedScope: 'epic',
    tolerance: ['epic', 'module', 'story'],
  },
  {
    tag: 'chore',
    scenario: 'chore',
    body:
      'update all @chiefaia/* package descriptions to be more descriptive — current descriptions read like internal codenames; rewrite for the open-source registry',
    expectedScope: 'task',
    tolerance: ['task', 'story', 'subtask'],
  },
] as const;

/**
 * Convert the fixtures to JSONL-ready trainset rows. Used by the cron
 * to persist the eval set the Python compile reads.
 *
 * Shape mirrors the Python side — `target_scope` (snake_case) and
 * `tolerance` are the label keys the compile metric reads.
 */
export function fixturesToEvalsetRows(): TrainsetRow[] {
  return PHASE2E_002_FIXTURES.map((f) => ({
    input: { promptText: f.body },
    label: {
      target_scope: f.expectedScope,
      tolerance: [...f.tolerance],
    },
  }));
}
