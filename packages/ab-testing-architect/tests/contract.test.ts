/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `abTesting.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed (precedence in [1,17], etc).
 *   - The architect registers cleanly against the ArchitectRegistry.
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder lists `abTesting` at rank 6.
 *   - The `appliesPredicate` correctly opts in on experiment markers.
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

import { ABTestingArchitect } from '../src/architect.js';
import {
  AB_TESTING_ARCHITECT_META,
  AB_TESTING_OWNED_SECTIONS,
  AB_TESTING_OWNED_FIELD_KEYS,
  ABTestingArchitectContract,
  abTestingArchitectAppliesPredicate
} from '../src/contract.js';

describe('ABTestingArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(ABTestingArchitectContract.contractId).toBe('ab-testing-architect.v1');
  });

  it('architectName is `abTesting` (matches canonical ladder entry)', () => {
    expect(ABTestingArchitectContract.architectName).toBe('abTesting');
  });

  it('version follows semver-ish shape', () => {
    expect(ABTestingArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `abTesting.`', () => {
    for (const key of AB_TESTING_OWNED_FIELD_KEYS) {
      expect(key.startsWith('abTesting.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'abTesting.experimentDesign',
      'abTesting.variantRoutingStrategy',
      'abTesting.sampleSizeRequirements',
      'abTesting.randomizationUnit',
      'abTesting.holdoutAnalysisPlan',
      'abTesting.statisticalReadoutMethod',
      'abTesting.experimentLifecycle',
      'abTesting.featureFlagDependencies'
    ];
    for (const r of required) {
      expect(AB_TESTING_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owned-field set covers spec §2.13 mandatory fields', () => {
    const specMandatory = [
      'abTesting.primaryMetric',
      'abTesting.secondaryMetrics',
      'abTesting.allocation',
      'abTesting.winnerPromotionPolicy',
      'abTesting.durationCap',
      'abTesting.srmCheck'
    ];
    for (const k of specMandatory) {
      expect(AB_TESTING_OWNED_FIELD_KEYS).toContain(k);
    }
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of AB_TESTING_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(ABTestingArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(ABTestingArchitectContract).slice().sort()).toEqual(
      [...AB_TESTING_OWNED_FIELD_KEYS].sort()
    );
  });

  it('declares the 15 owned sections (no fewer)', () => {
    expect(AB_TESTING_OWNED_FIELD_KEYS.length).toBe(15);
  });
});

describe('ABTestingArchitectContract — architectMeta', () => {
  it('declares Analytics + Feature Flagging as upstream dependencies (wave-3 architect)', () => {
    expect(AB_TESTING_ARCHITECT_META.dependsOn).toEqual(['analytics', 'featureFlagging']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(AB_TESTING_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(AB_TESTING_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 6 per spec §2.13 + canonical ladder', () => {
    expect(AB_TESTING_ARCHITECT_META.precedenceLevel).toBe(6);
  });

  it('fanoutPolicy is `conditional` — only runs on experiment-marked tickets', () => {
    expect(AB_TESTING_ARCHITECT_META.fanoutPolicy).toBe('conditional');
  });

  it('runtimeModel is `sonnet` per spec', () => {
    expect(AB_TESTING_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(AB_TESTING_ARCHITECT_META.appliesPredicate).toBe(abTestingArchitectAppliesPredicate);
  });

  it('matches the canonical precedence ladder for `abTesting`', () => {
    expect(precedenceRank('abTesting')).toBe(AB_TESTING_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('abTesting');
  });
});

describe('abTestingArchitectAppliesPredicate', () => {
  it('returns true when ticket.experimental is true', () => {
    expect(abTestingArchitectAppliesPredicate({ id: 't1', type: 'Page', experimental: true })).toBe(
      true
    );
  });

  it('returns true when quality_tags contains "ab-test"', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Page',
        quality_tags: ['ui', 'ab-test']
      })
    ).toBe(true);
  });

  it('returns true when quality_tags contains "experiment"', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Widget',
        quality_tags: ['experiment']
      })
    ).toBe(true);
  });

  it('returns true when quality_tags contains "experimental"', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Story',
        quality_tags: ['experimental']
      })
    ).toBe(true);
  });

  it('returns true when business_requirements mention "A/B test"', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Page',
        business_requirements: { description: 'run an A/B test on the hero CTA' }
      })
    ).toBe(true);
  });

  it('returns true when business_requirements mention "experiment"', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Page',
        business_requirements: { description: 'we want an experiment on copy' }
      })
    ).toBe(true);
  });

  it('returns true when business_requirements mention "variant"', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Widget',
        business_requirements: { description: 'show variant copy for the CTA' }
      })
    ).toBe(true);
  });

  it('returns true when business_requirements mention "treatment"', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Widget',
        business_requirements: { description: 'compare treatment against baseline' }
      })
    ).toBe(true);
  });

  it('returns true when business_requirements mention "lift"', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Widget',
        business_requirements: { description: 'we want to measure lift on conversion' }
      })
    ).toBe(true);
  });

  it('returns false for a plain Page ticket with no experimental markers', () => {
    expect(abTestingArchitectAppliesPredicate({ id: 't1', type: 'Page' })).toBe(false);
  });

  it('returns false for a Widget with unrelated quality_tags', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Widget',
        quality_tags: ['ui', 'analytics']
      })
    ).toBe(false);
  });

  it('returns false when business_requirements has no relevant keywords', () => {
    expect(
      abTestingArchitectAppliesPredicate({
        id: 't1',
        type: 'Page',
        business_requirements: { description: 'a simple marketing page' }
      })
    ).toBe(false);
  });

  it('returns false for Foundation tickets without explicit marker', () => {
    expect(abTestingArchitectAppliesPredicate({ id: 't1', type: 'Foundation' })).toBe(false);
  });
});

/**
 * Minimal stub architect used to test disjointness rejection.
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

  it('registers the A/B Testing architect cleanly', () => {
    expect(() => {
      registry.register(new ABTestingArchitect());
    }).not.toThrow();
    expect(registry.get('abTesting')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new ABTestingArchitect());
    for (const k of AB_TESTING_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('abTesting');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new ABTestingArchitect());
    expect(() => registry.register(new ABTestingArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new ABTestingArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'abTesting.experimentDesign',
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
    registry.register(new ABTestingArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'analytics-architect.v1',
      architectName: 'analytics',
      version: '0.1.0',
      sections: [
        { path: 'analytics.eventTaxonomy', description: 'event taxonomy', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 10,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    expect(() => {
      registry.register(new StubArchitect('analytics', disjointContract));
    }).not.toThrow();
    expect(registry.size()).toBe(2);
    expect(registry.allPaths().length).toBe(AB_TESTING_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only A/B Testing is present', () => {
    const conflicts = disjointness([ABTestingArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between A/B Testing and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...ABTestingArchitectContract,
      contractId: 'ab-testing-clone.v1',
      architectName: 'abTesting-clone'
    };
    const conflicts = disjointness([ABTestingArchitectContract, clone]);
    expect(conflicts.length).toBe(AB_TESTING_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() reports the missing analytics + featureFlagging deps when alone', () => {
    registry.register(new ABTestingArchitect());
    const errors = registry.validate();
    expect(errors.some(e => e.includes('analytics'))).toBe(true);
    expect(errors.some(e => e.includes('featureFlagging'))).toBe(true);
  });

  it('registry.validate() is clean when analytics + featureFlagging are also registered', () => {
    registry.register(new ABTestingArchitect());
    const analyticsContract: ArchitectSectionContract = {
      contractId: 'analytics-architect.v1',
      architectName: 'analytics',
      version: '0.1.0',
      sections: [
        { path: 'analytics.eventTaxonomy', description: 'event taxonomy', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 10,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    const featureFlaggingContract: ArchitectSectionContract = {
      contractId: 'feature-flagging-architect.v1',
      architectName: 'featureFlagging',
      version: '0.1.0',
      sections: [
        { path: 'featureFlagging.flagsSchema', description: 'flag schema', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 7,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    registry.register(new StubArchitect('analytics', analyticsContract));
    registry.register(new StubArchitect('featureFlagging', featureFlaggingContract));
    expect(registry.validate()).toEqual([]);
  });
});
