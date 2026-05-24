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

import { TestingArchitect } from '../src/architect.js';
import {
  TESTING_ARCHITECT_META,
  TESTING_OWNED_SECTIONS,
  TESTING_OWNED_FIELD_KEYS,
  TestingArchitectContract,
  testingArchitectAppliesPredicate
} from '../src/contract.js';

describe('TestingArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(TestingArchitectContract.contractId).toBe('testing-architect.v1');
  });

  it('architectName is `testing` (matches precedence ladder slot)', () => {
    expect(TestingArchitectContract.architectName).toBe('testing');
  });

  it('version follows semver-ish shape', () => {
    expect(TestingArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `testing.`', () => {
    for (const key of TESTING_OWNED_FIELD_KEYS) {
      expect(key.startsWith('testing.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'testing.testingStrategy',
      'testing.testTypeMixPercentages',
      'testing.fixturesStrategy',
      'testing.mutationTestingThresholds',
      'testing.perfRegressionBudgets',
      'testing.e2ePatterns',
      'testing.coverageThresholds',
      'testing.flakeTolerance'
    ];
    for (const r of required) {
      expect(TESTING_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('exposes exactly 8 owned fields per the task brief', () => {
    expect(TESTING_OWNED_FIELD_KEYS.length).toBe(8);
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of TESTING_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(TestingArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(TestingArchitectContract).sort()).toEqual(
      [...TESTING_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('TestingArchitectContract — architectMeta', () => {
  it('declares Frontend + Backend + Database as upstream dependencies', () => {
    expect(TESTING_ARCHITECT_META.dependsOn).toEqual(['frontend', 'backend', 'database']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(TESTING_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(TESTING_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 17 per spec §5.2 (Testing is lowest, advisory)', () => {
    expect(TESTING_ARCHITECT_META.precedenceLevel).toBe(17);
  });

  it('fanoutPolicy is `always`', () => {
    expect(TESTING_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.16', () => {
    expect(TESTING_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(TESTING_ARCHITECT_META.appliesPredicate).toBe(testingArchitectAppliesPredicate);
  });

  it('matches the canonical precedence ladder for `testing`', () => {
    expect(precedenceRank('testing')).toBe(TESTING_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('testing');
  });
});

describe('testingArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(testingArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Story', () => {
    expect(testingArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form', () => {
    expect(testingArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List', () => {
    expect(testingArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns true for Widget', () => {
    expect(testingArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(true);
  });

  it('returns true for Foundation', () => {
    expect(testingArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(true);
  });

  it('returns false for an unrecognised type', () => {
    expect(testingArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
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

  it('registers the Testing architect cleanly', () => {
    expect(() => {
      registry.register(new TestingArchitect());
    }).not.toThrow();
    expect(registry.get('testing')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new TestingArchitect());
    for (const k of TESTING_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('testing');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new TestingArchitect());
    expect(() => registry.register(new TestingArchitect())).toThrowError(ArchitectRegistryError);
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new TestingArchitect());
    const colliding: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        { path: 'testing.testingStrategy', description: 'colliding owner', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 16,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    expect(() => {
      registry.register(new StubArchitect('colliding', colliding));
    }).toThrowError(ArchitectRegistryError);
  });

  it('accepts a second architect with disjoint owned fields', () => {
    registry.register(new TestingArchitect());
    const disjoint: ArchitectSectionContract = {
      contractId: 'frontend-architect.v1',
      architectName: 'frontend',
      version: '0.1.0',
      sections: [{ path: 'frontend.componentTree', description: 'tree', required: true }],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 14,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    expect(() => {
      registry.register(new StubArchitect('frontend', disjoint));
    }).not.toThrow();
    expect(registry.size()).toBe(2);
    expect(registry.allPaths().length).toBe(TESTING_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only Testing is present', () => {
    const conflicts = disjointness([TestingArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Testing and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...TestingArchitectContract,
      contractId: 'testing-clone.v1',
      architectName: 'testing-clone'
    };
    const conflicts = disjointness([TestingArchitectContract, clone]);
    expect(conflicts.length).toBe(TESTING_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() is empty after a clean registration with upstream stubs', () => {
    const stubMeta = {
      dependsOn: [],
      precedenceLevel: 12,
      fanoutPolicy: 'always' as const,
      appliesPredicate: () => true,
      runtimeModel: 'sonnet' as const
    };
    registry.register(
      new StubArchitect('frontend', {
        contractId: 'frontend-architect.v1',
        architectName: 'frontend',
        version: '0.1.0',
        sections: [{ path: 'frontend.componentTree', description: 'tree', required: true }],
        architectMeta: { ...stubMeta, precedenceLevel: 14 }
      })
    );
    registry.register(
      new StubArchitect('backend', {
        contractId: 'backend-architect.v1',
        architectName: 'backend',
        version: '0.1.0',
        sections: [{ path: 'backend.framework', description: 'fw', required: true }],
        architectMeta: { ...stubMeta, precedenceLevel: 12 }
      })
    );
    registry.register(
      new StubArchitect('database', {
        contractId: 'database-architect.v1',
        architectName: 'database',
        version: '0.1.0',
        sections: [{ path: 'database.schemaDDL', description: 'ddl', required: true }],
        architectMeta: { ...stubMeta, precedenceLevel: 11 }
      })
    );
    registry.register(new TestingArchitect());
    expect(registry.validate()).toEqual([]);
  });

  it('registry.validate() flags missing upstream frontend + backend + database when Testing is registered alone', () => {
    registry.register(new TestingArchitect());
    const errors = registry.validate();
    expect(errors.length).toBeGreaterThanOrEqual(3);
    const joined = errors.join('|');
    expect(joined).toContain('frontend');
    expect(joined).toContain('backend');
    expect(joined).toContain('database');
  });
});
