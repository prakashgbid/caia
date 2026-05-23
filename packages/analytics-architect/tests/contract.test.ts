/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `analytics.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed (precedence in [1,17], etc).
 *   - The architect registers cleanly against the ArchitectRegistry.
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder lists `analytics`.
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

import { AnalyticsArchitect } from '../src/architect.js';
import {
  ANALYTICS_ARCHITECT_META,
  ANALYTICS_OWNED_SECTIONS,
  ANALYTICS_OWNED_FIELD_KEYS,
  AnalyticsArchitectContract,
  analyticsArchitectAppliesPredicate
} from '../src/contract.js';

describe('AnalyticsArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(AnalyticsArchitectContract.contractId).toBe('analytics-architect.v1');
  });

  it('architectName is `analytics` (matches package suffix + ladder entry)', () => {
    expect(AnalyticsArchitectContract.architectName).toBe('analytics');
  });

  it('version follows semver-ish shape', () => {
    expect(AnalyticsArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `analytics.`', () => {
    for (const key of ANALYTICS_OWNED_FIELD_KEYS) {
      expect(key.startsWith('analytics.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'analytics.provider',
      'analytics.eventTaxonomy',
      'analytics.userIdentificationStrategy',
      'analytics.funnelDefinitions',
      'analytics.consentGatingRules',
      'analytics.customDimensions',
      'analytics.dataResidencyRequirements',
      'analytics.privacyCompliance'
    ];
    for (const r of required) {
      expect(ANALYTICS_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owned-field set covers spec §2.8 mandatory fields', () => {
    const specMandatory = [
      'analytics.provider',
      'analytics.eventTaxonomy',
      'analytics.consentMode',
      'analytics.noPiiRule',
      'analytics.conversionGoals',
      'analytics.dashboardLinks',
      'analytics.dataTrackAttributes',
      'analytics.sessionStrategy'
    ];
    for (const k of specMandatory) {
      expect(ANALYTICS_OWNED_FIELD_KEYS).toContain(k);
    }
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of ANALYTICS_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(AnalyticsArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(AnalyticsArchitectContract).slice().sort()).toEqual(
      [...ANALYTICS_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('AnalyticsArchitectContract — architectMeta', () => {
  it('declares Frontend as the upstream dependency (wave-2 architect)', () => {
    expect(ANALYTICS_ARCHITECT_META.dependsOn).toEqual(['frontend']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(ANALYTICS_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(ANALYTICS_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 10 per spec §2.8 + canonical ladder', () => {
    expect(ANALYTICS_ARCHITECT_META.precedenceLevel).toBe(10);
  });

  it('fanoutPolicy is `always`', () => {
    expect(ANALYTICS_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.8', () => {
    expect(ANALYTICS_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(ANALYTICS_ARCHITECT_META.appliesPredicate).toBe(analyticsArchitectAppliesPredicate);
  });

  it('matches the canonical precedence ladder for `analytics`', () => {
    expect(precedenceRank('analytics')).toBe(ANALYTICS_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('analytics');
  });
});

describe('analyticsArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(analyticsArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Widget', () => {
    expect(analyticsArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(true);
  });

  it('returns true for Story', () => {
    expect(analyticsArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form (Story sub-type)', () => {
    expect(analyticsArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List (Story sub-type)', () => {
    expect(analyticsArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns false for Foundation (no UI surfaces)', () => {
    expect(analyticsArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(false);
  });

  it('returns false for an unrecognised type', () => {
    expect(analyticsArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
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

  it('registers the Analytics architect cleanly', () => {
    expect(() => {
      registry.register(new AnalyticsArchitect());
    }).not.toThrow();
    expect(registry.get('analytics')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new AnalyticsArchitect());
    for (const k of ANALYTICS_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('analytics');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new AnalyticsArchitect());
    expect(() => registry.register(new AnalyticsArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new AnalyticsArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'analytics.eventTaxonomy',
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
    registry.register(new AnalyticsArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'frontend-architect.v1',
      architectName: 'frontend',
      version: '0.1.0',
      sections: [
        { path: 'frontend.componentTree', description: 'component tree', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 14,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    expect(() => {
      registry.register(new StubArchitect('frontend', disjointContract));
    }).not.toThrow();
    expect(registry.size()).toBe(2);
    expect(registry.allPaths().length).toBe(ANALYTICS_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only Analytics is present', () => {
    const conflicts = disjointness([AnalyticsArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Analytics and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...AnalyticsArchitectContract,
      contractId: 'analytics-clone.v1',
      architectName: 'analytics-clone'
    };
    const conflicts = disjointness([AnalyticsArchitectContract, clone]);
    expect(conflicts.length).toBe(ANALYTICS_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() reports the missing frontend dependency when alone', () => {
    registry.register(new AnalyticsArchitect());
    const errors = registry.validate();
    // Analytics depends on frontend; with no frontend registered, the
    // dependency soundness check fires.
    expect(errors.some(e => e.includes('frontend'))).toBe(true);
  });

  it('registry.validate() is clean when frontend is also registered', () => {
    registry.register(new AnalyticsArchitect());
    const frontendContract: ArchitectSectionContract = {
      contractId: 'frontend-architect.v1',
      architectName: 'frontend',
      version: '0.1.0',
      sections: [
        { path: 'frontend.componentTree', description: 'component tree', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 14,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    registry.register(new StubArchitect('frontend', frontendContract));
    expect(registry.validate()).toEqual([]);
  });
});
