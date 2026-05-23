/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `performance.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed (precedence in [1,17], dependsOn declared).
 *   - The architect registers cleanly against the shared ArchitectRegistry.
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder accounts for performance.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  ArchitectRegistry,
  ArchitectRegistryError,
  CANONICAL_PRECEDENCE_LADDER,
  contractPaths,
  disjointness,
  findDuplicatePaths,
  precedenceRank,
  type ArchitectInput,
  type ArchitectOutput,
  type ArchitectSectionContract,
  type SpecialistArchitect,
  type ToolDefinition
} from '../src/types.js';

import { PerformanceArchitect } from '../src/architect.js';
import {
  PERFORMANCE_ARCHITECT_META,
  PERFORMANCE_OWNED_SECTIONS,
  PERFORMANCE_OWNED_FIELD_KEYS,
  PerformanceArchitectContract,
  performanceArchitectAppliesPredicate
} from '../src/contract.js';

describe('PerformanceArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(PerformanceArchitectContract.contractId).toBe('performance-architect.v1');
  });

  it('architectName is `performance` (matches package suffix)', () => {
    expect(PerformanceArchitectContract.architectName).toBe('performance');
  });

  it('version follows semver-ish shape', () => {
    expect(PerformanceArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `performance.`', () => {
    for (const key of PERFORMANCE_OWNED_FIELD_KEYS) {
      expect(key.startsWith('performance.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'performance.coreWebVitalsBudgets',
      'performance.bundleSizeBudget',
      'performance.imageOptimizationPlan',
      'performance.fontOptimizationPlan',
      'performance.lazyLoadStrategy',
      'performance.cacheStrategy',
      'performance.criticalRenderPath',
      'performance.lighthouseBudgets'
    ];
    for (const r of required) {
      expect(PERFORMANCE_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owns exactly 8 fields per the task brief', () => {
    expect(PERFORMANCE_OWNED_FIELD_KEYS.length).toBe(8);
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of PERFORMANCE_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(PerformanceArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(PerformanceArchitectContract).sort()).toEqual(
      [...PERFORMANCE_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('PerformanceArchitectContract — architectMeta', () => {
  it('declares Frontend as an upstream dependency (wave-2 architect)', () => {
    expect(PERFORMANCE_ARCHITECT_META.dependsOn).toEqual(['frontend']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(PERFORMANCE_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(PERFORMANCE_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 5 per spec §5.2 (Lighthouse ≥95 gate)', () => {
    expect(PERFORMANCE_ARCHITECT_META.precedenceLevel).toBe(5);
  });

  it('precedence ranks above Frontend (Lighthouse perf gate overrides visual decisions)', () => {
    // 'frontend' is rank 14 in the canonical ladder; performance is rank 5.
    expect(PERFORMANCE_ARCHITECT_META.precedenceLevel).toBeLessThan(
      precedenceRank('frontend')
    );
  });

  it('precedence ranks below Security, DevOps, A11y, and SEO', () => {
    expect(PERFORMANCE_ARCHITECT_META.precedenceLevel).toBeGreaterThan(
      precedenceRank('security')
    );
    expect(PERFORMANCE_ARCHITECT_META.precedenceLevel).toBeGreaterThan(
      precedenceRank('devops')
    );
    expect(PERFORMANCE_ARCHITECT_META.precedenceLevel).toBeGreaterThan(
      precedenceRank('a11y')
    );
    expect(PERFORMANCE_ARCHITECT_META.precedenceLevel).toBeGreaterThan(
      precedenceRank('seo')
    );
  });

  it('fanoutPolicy is `always`', () => {
    expect(PERFORMANCE_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per task brief', () => {
    expect(PERFORMANCE_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(PERFORMANCE_ARCHITECT_META.appliesPredicate).toBe(
      performanceArchitectAppliesPredicate
    );
  });

  it('canonical precedence ladder includes `performance`', () => {
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('performance');
    expect(precedenceRank('performance')).toBe(PERFORMANCE_ARCHITECT_META.precedenceLevel);
  });
});

describe('performanceArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(performanceArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Widget', () => {
    expect(performanceArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(true);
  });

  it('returns true for Story', () => {
    expect(performanceArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form (Story sub-type)', () => {
    expect(performanceArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List (Story sub-type)', () => {
    expect(performanceArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns false for Foundation (no UI)', () => {
    expect(performanceArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(
      false
    );
  });

  it('returns false for an unrecognised type', () => {
    expect(performanceArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
  });
});

/**
 * Minimal stub architect used to test disjointness rejection — implements
 * the bare `SpecialistArchitect` interface directly.
 */
class StubArchitect implements SpecialistArchitect {
  readonly tools: readonly ToolDefinition[] = [];
  constructor(
    readonly name: string,
    readonly sectionContract: ArchitectSectionContract
  ) {}
  systemPrompt(): string {
    return 'stub';
  }
  async run(_input: ArchitectInput): Promise<ArchitectOutput> {
    return {
      architectName: this.name,
      architectureFields: {},
      confidence: 0,
      notes: 'stub does not implement run',
      dependencies: [],
      risks: [],
      toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'none' },
      status: 'failed',
      failureReason: 'stub'
    };
  }
}

describe('ArchitectRegistry — registration & disjointness', () => {
  let registry: ArchitectRegistry;

  beforeEach(() => {
    registry = new ArchitectRegistry();
  });

  it('registers the Performance architect cleanly', () => {
    expect(() => {
      registry.register(new PerformanceArchitect());
    }).not.toThrow();
    expect(registry.get('performance')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new PerformanceArchitect());
    for (const k of PERFORMANCE_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('performance');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new PerformanceArchitect());
    expect(() => registry.register(new PerformanceArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new PerformanceArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'performance.lighthouseBudgets',
          description: 'colliding owner',
          required: true
        }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 15,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    expect(() => {
      registry.register(new StubArchitect('colliding', collidingContract));
    }).toThrowError(ArchitectRegistryError);
  });

  it('accepts a second architect with disjoint owned fields', () => {
    registry.register(new PerformanceArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'backend-architect.v1',
      architectName: 'backend',
      version: '0.1.0',
      sections: [{ path: 'backend.apiShape', description: 'API shape', required: true }],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 12,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    expect(() => {
      registry.register(new StubArchitect('backend', disjointContract));
    }).not.toThrow();
    expect(registry.size()).toBe(2);
    expect(registry.allPaths().length).toBe(PERFORMANCE_OWNED_FIELD_KEYS.length + 1);
  });

  it("is disjoint with Frontend's namespace (no overlap with `frontend.*`)", () => {
    for (const k of PERFORMANCE_OWNED_FIELD_KEYS) {
      expect(k.startsWith('frontend.')).toBe(false);
    }
  });

  it("is disjoint with A11y's namespace (no overlap with `a11y.*`)", () => {
    for (const k of PERFORMANCE_OWNED_FIELD_KEYS) {
      expect(k.startsWith('a11y.')).toBe(false);
    }
  });

  it('disjointness() detects no conflicts when only Performance is present', () => {
    const conflicts = disjointness([PerformanceArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Performance and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...PerformanceArchitectContract,
      contractId: 'performance-clone.v1',
      architectName: 'performance-clone'
    };
    const conflicts = disjointness([PerformanceArchitectContract, clone]);
    expect(conflicts.length).toBe(PERFORMANCE_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() reports an unmet dependsOn when frontend is not registered', () => {
    registry.register(new PerformanceArchitect());
    const errors = registry.validate();
    expect(errors.some(e => e.includes("'frontend'"))).toBe(true);
  });
});
