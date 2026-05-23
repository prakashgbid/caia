/**
 * Section contract structural + registration tests.
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

import { ObservabilityArchitect } from '../src/architect.js';
import {
  OBSERVABILITY_ARCHITECT_META,
  OBSERVABILITY_OWNED_SECTIONS,
  OBSERVABILITY_OWNED_FIELD_KEYS,
  ObservabilityArchitectContract,
  observabilityArchitectAppliesPredicate
} from '../src/contract.js';

describe('ObservabilityArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(ObservabilityArchitectContract.contractId).toBe('observability-architect.v1');
  });

  it('architectName is `observability` (matches package suffix + ladder entry)', () => {
    expect(ObservabilityArchitectContract.architectName).toBe('observability');
  });

  it('version follows semver-ish shape', () => {
    expect(ObservabilityArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `observability.`', () => {
    for (const key of OBSERVABILITY_OWNED_FIELD_KEYS) {
      expect(key.startsWith('observability.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'observability.loggingStrategy',
      'observability.errorTrackingProvider',
      'observability.tracingStrategy',
      'observability.metricsEmitted',
      'observability.slis',
      'observability.slos',
      'observability.alertingRules',
      'observability.dashboardSpec',
      'observability.runbookReferences'
    ];
    for (const r of required) {
      expect(OBSERVABILITY_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owned-field set has exactly 9 fields', () => {
    expect(OBSERVABILITY_OWNED_FIELD_KEYS.length).toBe(9);
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of OBSERVABILITY_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(ObservabilityArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(ObservabilityArchitectContract).sort()).toEqual(
      [...OBSERVABILITY_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('ObservabilityArchitectContract — architectMeta', () => {
  it('declares Backend as the upstream dependency (wave-2 architect)', () => {
    expect(OBSERVABILITY_ARCHITECT_META.dependsOn).toEqual(['backend']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(OBSERVABILITY_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(OBSERVABILITY_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 9 per spec §5.2', () => {
    expect(OBSERVABILITY_ARCHITECT_META.precedenceLevel).toBe(9);
  });

  it('fanoutPolicy is `always`', () => {
    expect(OBSERVABILITY_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.9', () => {
    expect(OBSERVABILITY_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(OBSERVABILITY_ARCHITECT_META.appliesPredicate).toBe(
      observabilityArchitectAppliesPredicate
    );
  });

  it('matches the canonical precedence ladder for `observability`', () => {
    expect(precedenceRank('observability')).toBe(OBSERVABILITY_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('observability');
  });
});

describe('observabilityArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(observabilityArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Story', () => {
    expect(observabilityArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form', () => {
    expect(observabilityArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List', () => {
    expect(observabilityArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns true for Foundation', () => {
    expect(observabilityArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(
      true
    );
  });

  it('returns false for a vanilla Widget (no api/persists tags)', () => {
    expect(
      observabilityArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })
    ).toBe(false);
  });

  it('returns true for a Widget tagged `api`', () => {
    expect(
      observabilityArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Widget',
        quality_tags: ['api']
      })
    ).toBe(true);
  });

  it('returns true for a Widget tagged `observability`', () => {
    expect(
      observabilityArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Widget',
        quality_tags: ['observability']
      })
    ).toBe(true);
  });

  it('returns false for an unrecognised type', () => {
    expect(observabilityArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
  });
});

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

  it('registers the Observability architect cleanly', () => {
    expect(() => {
      registry.register(new ObservabilityArchitect());
    }).not.toThrow();
    expect(registry.get('observability')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new ObservabilityArchitect());
    for (const k of OBSERVABILITY_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('observability');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new ObservabilityArchitect());
    expect(() => registry.register(new ObservabilityArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new ObservabilityArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'observability.metricsEmitted',
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
    registry.register(new ObservabilityArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'backend-architect.v1',
      architectName: 'backend',
      version: '0.1.0',
      sections: [{ path: 'backend.apiEndpoints', description: 'API endpoints', required: true }],
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
    expect(registry.allPaths().length).toBe(OBSERVABILITY_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only Observability is present', () => {
    const conflicts = disjointness([ObservabilityArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Observability and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...ObservabilityArchitectContract,
      contractId: 'observability-clone.v1',
      architectName: 'observability-clone'
    };
    const conflicts = disjointness([ObservabilityArchitectContract, clone]);
    expect(conflicts.length).toBe(OBSERVABILITY_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() reports an unmet dependsOn when backend is not registered', () => {
    registry.register(new ObservabilityArchitect());
    const errors = registry.validate();
    expect(errors.some(e => e.includes("'backend'"))).toBe(true);
  });
});
