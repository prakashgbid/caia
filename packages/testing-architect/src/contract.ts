/**
 * `TestingArchitectContract` — the canonical owned-fields declaration for
 * architect #16 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.16 (Testing Architect owns `testing.*`)
 *   - task brief (testingStrategy, testTypeMixPercentages,
 *     fixturesStrategy, mutationTestingThresholds, perfRegressionBudgets,
 *     e2ePatterns, coverageThresholds, flakeTolerance)
 *
 * Upstream dependencies (`dependsOn`): Frontend Architect
 * (`frontend.componentTree`, `frontend.interactionStates`,
 * `frontend.routeConfig`), Backend Architect (`backend.apiEndpoints`,
 * `backend.errorEnvelope`), and Database Architect
 * (`database.schemaDDL`, `database.rlsPolicies`). Testing is a
 * **wave-2** architect — it consumes what the wave-1 architects emit
 * and sets the testing strategy for the entire stack.
 *
 * Precedence rank **17** per spec §5.2 — Testing is the lowest-precedence
 * architect because it's strictly advisory: every other architect can
 * override its strategy if a higher-stakes concern fires. The Test
 * Author Agent later consumes this strategy verbatim; the Test Reviewer
 * Agent audits the resulting test set against it.
 *
 * DISTINCTION (per task brief): Testing Architect sets the STRATEGY.
 * It does NOT write test code or test cases. The Test Author Agent
 * writes the cases per story; the Test Reviewer Agent audits coverage.
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

export const TESTING_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'testing.testingStrategy':
    'Output the overall strategy as {pyramidShape: "broad-base"|"hourglass", rationale: "<= 240 chars", riskAreas: string[], owner: "<author-agent>", reviewer: "<reviewer-agent>"}. Default shape is broad-base. Diamond/trophy NOT permitted in V1.',
  'testing.testTypeMixPercentages':
    'Per-ticket-type mix as {<ticketType>: {unit, integration, e2e, visual, a11y, perf}} where each value is an integer percentage and the six values sum to 100. Default Story/Form/Widget split: {unit:60, integration:20, e2e:10, visual:5, a11y:3, perf:2}. Page tickets shift up the e2e share. Reject any sum != 100.',
  'testing.fixturesStrategy':
    'Output {goldenDatasets, factories, seedingDiscipline: "per-test"|"per-suite"|"per-worker", determinism: {clockMock: true, idGenerator, rngSeed}}. Per-test seeding is the default.',
  'testing.mutationTestingThresholds':
    'Output {tool: "stryker"|"pitest"|"mutmut", killScoreFloor: number, perScope, escalation}. Default killScoreFloor is 60 for units. Lower than 50 is forbidden in V1.',
  'testing.perfRegressionBudgets':
    'Output {tool: "lighthouse"|"webpagetest"|"custom", lighthouseDeltaPct, k6Thresholds, regressionAction}. Default lighthouseDeltaPct is 5.',
  'testing.e2ePatterns':
    'Output {runner: "playwright", playwrightVersion, pageObjects: true, fixtureScope, remoteBrowserless, retries, parallelism, traceOnFailure}. Page-object pattern is mandatory.',
  'testing.coverageThresholds':
    'Output {perTicketType, globalFloor}. Default globalFloor is {lines:80, branches:75, functions:80, statements:80}. Lower than 70 is forbidden in V1.',
  'testing.flakeTolerance':
    'Output {maxRetryRatePct, quarantinePolicy, flakeBudget, deflakeOwner, failOpenAt}. Default maxRetryRatePct is 0.5. Anything > 2 is forbidden in V1.'
};

export const TESTING_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'testing.testingStrategy',
    description:
      'Overall strategy: pyramid shape (broad-base default; hourglass acceptable for storybook-heavy frontends), rationale, risk areas, and who owns authoring + review. Test Author Agent consumes this verbatim.',
    required: true
  },
  {
    path: 'testing.testTypeMixPercentages',
    description:
      'Per-ticket-type mix of test types (unit / integration / e2e / visual / a11y / perf percentages summing to 100). Locks the pyramid balance for the Test Author Agent.',
    required: true
  },
  {
    path: 'testing.fixturesStrategy',
    description:
      'Fixture discipline: golden datasets, factory patterns, seeding scope (per-test default), determinism settings (clock mock, ID generator, RNG seed).',
    required: true
  },
  {
    path: 'testing.mutationTestingThresholds',
    description:
      'Mutation testing tool (Stryker default), kill-score floor (60% default), per-scope overrides, escalation policy (block-merge | warn | advisory).',
    required: true
  },
  {
    path: 'testing.perfRegressionBudgets',
    description:
      'Perf regression budgets: Lighthouse delta cap (5% default), k6 thresholds (p95 latency, error rate), regression action (block-deploy | open-issue | track-only).',
    required: true
  },
  {
    path: 'testing.e2ePatterns',
    description:
      'Playwright conventions: version pin, page-object mandate, fixture scope, Browserless integration, retry policy, parallelism, trace-on-failure.',
    required: true
  },
  {
    path: 'testing.coverageThresholds',
    description:
      'Per-ticket-type and global floor coverage thresholds (lines, branches, functions, statements). Globals default to {lines:80, branches:75, functions:80, statements:80}.',
    required: true
  },
  {
    path: 'testing.flakeTolerance',
    description:
      'Flake-tolerance posture: max retry rate (0.5% default), quarantine policy, flake budget per suite/day, deflake owner, fail-open threshold.',
    required: true
  }
];

export const TESTING_OWNED_FIELD_KEYS: readonly string[] = TESTING_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

export function testingArchitectAppliesPredicate(ticket: Ticket): boolean {
  return (
    ticket.type === 'Page' ||
    ticket.type === 'Widget' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List' ||
    ticket.type === 'Foundation'
  );
}

// ─── Architect meta ─────────────────────────────────────────────────────────

export const TESTING_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['frontend', 'backend', 'database'],
  precedenceLevel: 17,
  fanoutPolicy: 'always',
  appliesPredicate: testingArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const TestingArchitectContract: ArchitectSectionContract = {
  contractId: 'testing-architect.v1',
  architectName: 'testing',
  version: '0.1.0',
  sections: TESTING_OWNED_SECTIONS,
  architectMeta: TESTING_ARCHITECT_META
};

// ─── Reusable constants ─────────────────────────────────────────────────────

export const REQUIRED_TEST_TYPES: readonly string[] = [
  'unit',
  'integration',
  'e2e',
  'visual',
  'a11y',
  'perf'
];

export const ALLOWED_PYRAMID_SHAPES: readonly string[] = ['broad-base', 'hourglass'];

export const ALLOWED_MUTATION_TOOLS: readonly string[] = ['stryker', 'pitest', 'mutmut'];

export const ALLOWED_E2E_RUNNERS: readonly string[] = ['playwright'];

export const TESTING_HARD_FLOORS = {
  mutationKillScoreMin: 50,
  coverageFloorMin: 70,
  lighthouseDeltaMaxPct: 10,
  flakeRetryRateMaxPct: 2
} as const;
