/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (FLAT dotted keys), or
 *   - the composed `tickets.architecture` JSONB blob (nested paths).
 *
 * Cross-architect invariants treat absent foreign data as "cannot
 * verify" and pass trivially.
 */

import {
  TESTING_HARD_FLOORS,
  REQUIRED_TEST_TYPES,
  ALLOWED_PYRAMID_SHAPES,
  ALLOWED_MUTATION_TOOLS,
  ALLOWED_E2E_RUNNERS
} from './contract.js';

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  contributor: string;
  reads: readonly string[];
  severity: InvariantSeverity;
  description: string;
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export const TESTING_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'testing.strategy-pyramid-shape-allowed',
    contributor: 'testing',
    reads: ['testing.testingStrategy'],
    severity: 'fail',
    description:
      `Pyramid shape must be one of ${ALLOWED_PYRAMID_SHAPES.join(' | ')}. Diamond and trophy shapes are forbidden in V1.`,
    detect(arch): boolean {
      const strategy = readField(arch, 'testing.testingStrategy');
      if (typeof strategy !== 'object' || strategy === null) return false;
      const shape = (strategy as Record<string, unknown>).pyramidShape;
      if (typeof shape !== 'string') return false;
      return ALLOWED_PYRAMID_SHAPES.includes(shape);
    }
  },
  {
    id: 'testing.mix-covers-all-six-types',
    contributor: 'testing',
    reads: ['testing.testTypeMixPercentages'],
    severity: 'fail',
    description:
      `Every ticket-type entry in testTypeMixPercentages must declare all six required test types: ${REQUIRED_TEST_TYPES.join(', ')}.`,
    detect(arch): boolean {
      const mix = readField(arch, 'testing.testTypeMixPercentages');
      if (typeof mix !== 'object' || mix === null) return false;
      for (const perType of Object.values(mix as Record<string, unknown>)) {
        if (typeof perType !== 'object' || perType === null) return false;
        const keys = new Set(Object.keys(perType as Record<string, unknown>));
        for (const r of REQUIRED_TEST_TYPES) {
          if (!keys.has(r)) return false;
        }
      }
      return true;
    }
  },
  {
    id: 'testing.mix-sums-to-100',
    contributor: 'testing',
    reads: ['testing.testTypeMixPercentages'],
    severity: 'fail',
    description:
      'The six per-ticket-type test-type percentages must sum to exactly 100 — anything else is a misconfigured pyramid.',
    detect(arch): boolean {
      const mix = readField(arch, 'testing.testTypeMixPercentages');
      if (typeof mix !== 'object' || mix === null) return false;
      for (const perType of Object.values(mix as Record<string, unknown>)) {
        if (typeof perType !== 'object' || perType === null) return false;
        let sum = 0;
        for (const v of Object.values(perType as Record<string, unknown>)) {
          if (typeof v !== 'number') return false;
          sum += v;
        }
        if (sum !== 100) return false;
      }
      return true;
    }
  },
  {
    id: 'testing.mix-is-realistic-not-100-pct-unit',
    contributor: 'testing',
    reads: ['testing.testTypeMixPercentages'],
    severity: 'fail',
    description:
      'The test pyramid must be REALISTIC. A 100% unit / 0% e2e split is forbidden — without integration + e2e the suite cannot catch wiring bugs. Likewise a >50% e2e split produces unmaintainable, slow suites.',
    detect(arch): boolean {
      const mix = readField(arch, 'testing.testTypeMixPercentages');
      if (typeof mix !== 'object' || mix === null) return false;
      for (const perType of Object.values(mix as Record<string, unknown>)) {
        if (typeof perType !== 'object' || perType === null) return false;
        const p = perType as Record<string, unknown>;
        const unit = typeof p.unit === 'number' ? p.unit : 0;
        const integration = typeof p.integration === 'number' ? p.integration : 0;
        const e2e = typeof p.e2e === 'number' ? p.e2e : 0;
        if (unit >= 100) return false;
        if (e2e <= 0) return false;
        if (integration <= 0) return false;
        if (e2e > 50) return false;
        if (unit < 30) return false;
      }
      return true;
    }
  },
  {
    id: 'testing.mutation-kill-floor-meets-min',
    contributor: 'testing',
    reads: ['testing.mutationTestingThresholds'],
    severity: 'fail',
    description:
      `Mutation kill-score floor must be >= ${TESTING_HARD_FLOORS.mutationKillScoreMin}.`,
    detect(arch): boolean {
      const thresholds = readField(arch, 'testing.mutationTestingThresholds');
      if (typeof thresholds !== 'object' || thresholds === null) return false;
      const floor = (thresholds as Record<string, unknown>).killScoreFloor;
      if (typeof floor !== 'number') return false;
      return floor >= TESTING_HARD_FLOORS.mutationKillScoreMin;
    }
  },
  {
    id: 'testing.mutation-tool-allowed',
    contributor: 'testing',
    reads: ['testing.mutationTestingThresholds'],
    severity: 'fail',
    description:
      `Mutation testing tool must be one of ${ALLOWED_MUTATION_TOOLS.join(' | ')}.`,
    detect(arch): boolean {
      const thresholds = readField(arch, 'testing.mutationTestingThresholds');
      if (typeof thresholds !== 'object' || thresholds === null) return false;
      const tool = (thresholds as Record<string, unknown>).tool;
      if (typeof tool !== 'string') return false;
      return ALLOWED_MUTATION_TOOLS.includes(tool);
    }
  },
  {
    id: 'testing.perf-lighthouse-delta-bounded',
    contributor: 'testing',
    reads: ['testing.perfRegressionBudgets'],
    severity: 'fail',
    description:
      `Lighthouse delta budget must be <= ${TESTING_HARD_FLOORS.lighthouseDeltaMaxPct}%.`,
    detect(arch): boolean {
      const budgets = readField(arch, 'testing.perfRegressionBudgets');
      if (typeof budgets !== 'object' || budgets === null) return false;
      const delta = (budgets as Record<string, unknown>).lighthouseDeltaPct;
      if (typeof delta !== 'number') return false;
      return delta <= TESTING_HARD_FLOORS.lighthouseDeltaMaxPct;
    }
  },
  {
    id: 'testing.e2e-runner-allowed',
    contributor: 'testing',
    reads: ['testing.e2ePatterns'],
    severity: 'fail',
    description:
      `e2e runner must be one of ${ALLOWED_E2E_RUNNERS.join(' | ')}.`,
    detect(arch): boolean {
      const patterns = readField(arch, 'testing.e2ePatterns');
      if (typeof patterns !== 'object' || patterns === null) return false;
      const runner = (patterns as Record<string, unknown>).runner;
      if (typeof runner !== 'string') return false;
      return ALLOWED_E2E_RUNNERS.includes(runner);
    }
  },
  {
    id: 'testing.e2e-page-objects-mandatory',
    contributor: 'testing',
    reads: ['testing.e2ePatterns'],
    severity: 'fail',
    description:
      'Page-object pattern is mandatory for all e2e tests.',
    detect(arch): boolean {
      const patterns = readField(arch, 'testing.e2ePatterns');
      if (typeof patterns !== 'object' || patterns === null) return false;
      const pageObjects = (patterns as Record<string, unknown>).pageObjects;
      return pageObjects === true;
    }
  },
  {
    id: 'testing.coverage-floor-meets-min',
    contributor: 'testing',
    reads: ['testing.coverageThresholds'],
    severity: 'fail',
    description:
      `Every coverage threshold (lines, branches, functions, statements) on globalFloor and every per-ticket-type entry must be >= ${TESTING_HARD_FLOORS.coverageFloorMin}.`,
    detect(arch): boolean {
      const thresholds = readField(arch, 'testing.coverageThresholds');
      if (typeof thresholds !== 'object' || thresholds === null) return false;
      const t = thresholds as Record<string, unknown>;
      const required = ['lines', 'branches', 'functions', 'statements'];

      const globalFloor = t.globalFloor;
      if (typeof globalFloor !== 'object' || globalFloor === null) return false;
      for (const axis of required) {
        const v = (globalFloor as Record<string, unknown>)[axis];
        if (typeof v !== 'number') return false;
        if (v < TESTING_HARD_FLOORS.coverageFloorMin) return false;
      }

      const perTicket = t.perTicketType;
      if (typeof perTicket === 'object' && perTicket !== null) {
        for (const entry of Object.values(perTicket as Record<string, unknown>)) {
          if (typeof entry !== 'object' || entry === null) return false;
          for (const axis of required) {
            const v = (entry as Record<string, unknown>)[axis];
            if (typeof v !== 'number') return false;
            if (v < TESTING_HARD_FLOORS.coverageFloorMin) return false;
          }
        }
      }

      return true;
    }
  },
  {
    id: 'testing.flake-retry-rate-bounded',
    contributor: 'testing',
    reads: ['testing.flakeTolerance'],
    severity: 'fail',
    description:
      `Max retry rate must be <= ${TESTING_HARD_FLOORS.flakeRetryRateMaxPct}%.`,
    detect(arch): boolean {
      const flake = readField(arch, 'testing.flakeTolerance');
      if (typeof flake !== 'object' || flake === null) return false;
      const rate = (flake as Record<string, unknown>).maxRetryRatePct;
      if (typeof rate !== 'number') return false;
      return rate <= TESTING_HARD_FLOORS.flakeRetryRateMaxPct;
    }
  },
  {
    id: 'testing.fixtures-determinism-mandates-clock-mock',
    contributor: 'testing',
    reads: ['testing.fixturesStrategy'],
    severity: 'fail',
    description:
      'Fixtures strategy must set `determinism.clockMock = true`.',
    detect(arch): boolean {
      const fixtures = readField(arch, 'testing.fixturesStrategy');
      if (typeof fixtures !== 'object' || fixtures === null) return false;
      const det = (fixtures as Record<string, unknown>).determinism;
      if (typeof det !== 'object' || det === null) return false;
      const clockMock = (det as Record<string, unknown>).clockMock;
      return clockMock === true;
    }
  },
  {
    id: 'testing.covers-frontend-interactive-components',
    contributor: 'testing',
    reads: ['testing.testingStrategy', 'frontend.interactionStates'],
    severity: 'advisory',
    description:
      'When Frontend declares interactive components, Testing.testingStrategy.riskAreas should mention at least one of them. Trivially passes if Frontend output is absent.',
    detect(arch): boolean {
      const strategy = readField(arch, 'testing.testingStrategy');
      const interactions = readField(arch, 'frontend.interactionStates');
      if (typeof interactions !== 'object' || interactions === null) return true;
      if (typeof strategy !== 'object' || strategy === null) return false;
      const riskAreas = (strategy as Record<string, unknown>).riskAreas;
      if (!Array.isArray(riskAreas) || riskAreas.length === 0) return true;
      const componentIds = Object.keys(interactions as Record<string, unknown>);
      if (componentIds.length === 0) return true;
      const joined = riskAreas
        .filter((r): r is string => typeof r === 'string')
        .join(' | ')
        .toLowerCase();
      return componentIds.some(id => joined.includes(id.toLowerCase()));
    }
  }
];
