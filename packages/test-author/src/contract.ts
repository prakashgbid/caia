/**
 * @caia/test-author — contract.
 *
 * The Test Author is NOT a specialist architect (it does not register
 * with `@caia/architect-kit`'s ArchitectRegistry). It is a Stage-10
 * subagent in the canonical pipeline that writes to `tickets.testCases`
 * and `tickets.testDesign` — both OUTSIDE `tickets.architecture`.
 *
 * What we export from here:
 *
 *  1. The canonical agent ID + state-machine pre/pass/fail states. The
 *     api.ts wrapper hands these to `@caia/state-machine` so transitions
 *     are typed end-to-end.
 *
 *  2. A `TestAuthorSectionContract` — describes the OWNED ticket columns
 *     (`testCases`, `testDesign`) for documentation purposes. This is
 *     structurally compatible with `@caia/architect-kit`'s
 *     `ArchitectSectionContract` but is NOT registered with the
 *     dispatcher. The dispatcher's disjointness check is across
 *     `tickets.architecture` only; the author writes outside that
 *     namespace.
 *
 *  3. Default per-ticket-type pyramid mixes used when the Testing
 *     Architect ran in `partial` mode and `architecture.testing.
 *     testTypeMixPercentages` is missing. Mirrors
 *     `@caia/testing-architect`'s defaults.
 */

import type { ProjectState } from '@caia/state-machine';
import type {
  TestCaseCategory,
  TestCaseLayer
} from '@chiefaia/ticket-template';

import type { PassFinalState, FailFinalState } from './types.js';

// ─── State-machine integration ─────────────────────────────────────────────

/** Canonical agent ID used in state-machine `triggeredBy.id`. */
export const AUTHOR_AGENT_ID = 'test-author' as const;

/** Pre-state the orchestrator guarantees before invoking the author. */
export const AUTHOR_PRE_STATE: ProjectState = 'ea-complete';

/** Pass target. Single transition: `ea-complete → tests-authored`. */
export const AUTHOR_PASS_STATE: PassFinalState = 'tests-authored';

/**
 * Intermediate state on the fail chain. Per the canonical transition
 * table (`@caia/state-machine`), `tests-authoring-failed` is only
 * reachable FROM `tests-authored`, so the fail path chains through it.
 */
export const AUTHOR_FAIL_INTERMEDIATE_STATE: PassFinalState = 'tests-authored';

/** Fail target. */
export const AUTHOR_FAIL_STATE: FailFinalState = 'tests-authoring-failed';

// ─── Owned ticket columns (not in tickets.architecture) ────────────────────

/**
 * A `SectionContract`-shaped descriptor of what columns this agent
 * writes. The dispatcher's disjointness check is over
 * `tickets.architecture`, which we deliberately don't touch — these
 * paths live on the ticket root.
 */
export interface AuthorSectionSpec {
  path: string;
  description: string;
  required: boolean;
}

export const AUTHOR_OWNED_SECTIONS: readonly AuthorSectionSpec[] = [
  {
    path: 'ticket.testCases',
    description:
      "Array of TestCase objects (Gherkin given/when/then, category, layer, selector hints, mocks). Bounded to MAX_TEST_CASES=50 per @chiefaia/ticket-template. The Test Runner (@caia/per-story-tester, Stage 14) translates these to vitest + Playwright + axe + Lighthouse source.",
    required: true
  },
  {
    path: 'ticket.testDesign',
    description:
      'Metadata block: { designedBy, designedAt, totalCases, categoryCounts, layerCounts }. `totalCases === testCases.length` invariant is enforced by the ticket-template Zod schema (super-refine).',
    required: true
  }
] as const;

export const AUTHOR_OWNED_FIELD_PATHS: readonly string[] = AUTHOR_OWNED_SECTIONS.map(
  s => s.path
);

/**
 * Contract identifier. Bumped on schema-breaking changes; the storage
 * layer carries this so historical rows can be migrated.
 */
export const AUTHOR_CONTRACT_ID = 'test-author.v1' as const;

export const TestAuthorSectionContract = {
  contractId: AUTHOR_CONTRACT_ID,
  agentId: AUTHOR_AGENT_ID,
  version: '0.1.0',
  sections: AUTHOR_OWNED_SECTIONS,
  preState: AUTHOR_PRE_STATE,
  passState: AUTHOR_PASS_STATE,
  failIntermediateState: AUTHOR_FAIL_INTERMEDIATE_STATE,
  failState: AUTHOR_FAIL_STATE
} as const;

// ─── Default pyramid mix (used when testing-architect ran partial) ─────────

/**
 * Default category mix per ticket type, in percent. Mirrors the
 * fallback emitted by `@caia/testing-architect` when its strategy is
 * unavailable. The six values must sum to 100.
 */
export const DEFAULT_MIX_PERCENTAGES: Record<
  string,
  Record<'unit' | 'integration' | 'e2e' | 'visual' | 'a11y' | 'perf', number>
> = {
  Story: { unit: 60, integration: 20, e2e: 10, visual: 5, a11y: 3, perf: 2 },
  Page: { unit: 50, integration: 20, e2e: 15, visual: 7, a11y: 5, perf: 3 },
  Form: { unit: 65, integration: 18, e2e: 8, visual: 4, a11y: 3, perf: 2 },
  Widget: { unit: 62, integration: 20, e2e: 8, visual: 5, a11y: 3, perf: 2 },
  List: { unit: 58, integration: 22, e2e: 10, visual: 4, a11y: 4, perf: 2 },
  Foundation: { unit: 70, integration: 15, e2e: 5, visual: 3, a11y: 4, perf: 3 }
};

/**
 * Mapping from the `architecture.testing.testTypeMixPercentages` axis
 * names to the canonical `TestCase['category']` values.
 *  - unit/integration/e2e → category: 'happy' (with the layer differing)
 *  - visual              → category: 'visual'
 *  - a11y                → category: 'accessibility'
 *  - perf                → category: 'performance'
 *
 * The author treats `unit`/`integration`/`e2e` as layer-axes that all
 * carry the same default `category: 'happy'`; `category: 'edge'` /
 * `'error'` is independent of the layer mix and is driven by the
 * AC/edge/error floors instead.
 */
export const MIX_AXIS_TO_LAYER: Record<
  'unit' | 'integration' | 'e2e' | 'visual' | 'a11y' | 'perf',
  TestCaseLayer
> = {
  unit: 'unit',
  integration: 'integration',
  e2e: 'e2e',
  visual: 'visual',
  a11y: 'accessibility',
  perf: 'e2e'
};

export const MIX_AXIS_TO_CATEGORY: Record<
  'unit' | 'integration' | 'e2e' | 'visual' | 'a11y' | 'perf',
  TestCaseCategory
> = {
  unit: 'happy',
  integration: 'happy',
  e2e: 'happy',
  visual: 'visual',
  a11y: 'accessibility',
  perf: 'performance'
};

// ─── Hard floors / ceilings ────────────────────────────────────────────────

/**
 * Hard bounds enforced by validation.ts after the LLM responds. The
 * Test Reviewer enforces softer policy floors on top of these.
 */
export const AUTHOR_HARD_BOUNDS = {
  /** Minimum total cases the agent will emit if `softFloor` is unset. */
  defaultSoftFloor: 3,
  /** Mirrors `@chiefaia/ticket-template`'s `MAX_TEST_CASES`. */
  maxCases: 50,
  /** Notes are truncated to this length before persistence. */
  maxNotesChars: 800,
  /** Risks array is truncated to this length. */
  maxRisks: 5
} as const;
