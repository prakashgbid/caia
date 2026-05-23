/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `backend.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed (precedence in [1,17], etc).
 *   - The architect registers cleanly against the local ArchitectRegistry.
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder lists `backend`.
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

import { BackendArchitect } from '../src/architect.js';
import {
  BACKEND_ARCHITECT_META,
  BACKEND_OWNED_SECTIONS,
  BACKEND_OWNED_FIELD_KEYS,
  BackendArchitectContract,
  backendArchitectAppliesPredicate
} from '../src/contract.js';

describe('BackendArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(BackendArchitectContract.contractId).toBe('backend-architect.v1');
  });

  it('architectName is `backend` (matches package suffix + ladder entry)', () => {
    expect(BackendArchitectContract.architectName).toBe('backend');
  });

  it('version follows semver-ish shape', () => {
    expect(BackendArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `backend.`', () => {
    for (const key of BACKEND_OWNED_FIELD_KEYS) {
      expect(key.startsWith('backend.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'backend.apiEndpoints',
      'backend.requestSchemas',
      'backend.responseSchemas',
      'backend.errorEnvelope',
      'backend.validationRules',
      'backend.authRequirements',
      'backend.rateLimits',
      'backend.serviceBoundaries'
    ];
    for (const r of required) {
      expect(BACKEND_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owned-field set covers spec §2.2 mandatory fields (framework, dataAccess, businessRules, endpointEnumeration, errorEnvelope)', () => {
    const specMandatory = [
      'backend.framework',
      'backend.dataAccess',
      'backend.businessRules',
      'backend.endpointEnumeration',
      'backend.errorEnvelope'
    ];
    for (const k of specMandatory) {
      expect(BACKEND_OWNED_FIELD_KEYS).toContain(k);
    }
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of BACKEND_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(BackendArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(BackendArchitectContract).sort()).toEqual(
      [...BACKEND_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('BackendArchitectContract — architectMeta', () => {
  it('declares zero dependencies (wave-1 architect)', () => {
    expect(BACKEND_ARCHITECT_META.dependsOn).toEqual([]);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(BACKEND_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(BACKEND_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 12 per spec §5.2', () => {
    expect(BACKEND_ARCHITECT_META.precedenceLevel).toBe(12);
  });

  it('fanoutPolicy is `always`', () => {
    expect(BACKEND_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.2', () => {
    expect(BACKEND_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(BACKEND_ARCHITECT_META.appliesPredicate).toBe(backendArchitectAppliesPredicate);
  });

  it('matches the canonical precedence ladder for `backend`', () => {
    expect(precedenceRank('backend')).toBe(BACKEND_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('backend');
  });
});

describe('backendArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page (server-side data loading)', () => {
    expect(backendArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Story', () => {
    expect(backendArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form', () => {
    expect(backendArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List', () => {
    expect(backendArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns true for Foundation (cross-cutting service modules)', () => {
    expect(backendArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(true);
  });

  it('returns false for Widget by default (re-uses parent-Page handlers)', () => {
    expect(backendArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(false);
  });

  it('returns true for Widget when tagged `api`', () => {
    expect(
      backendArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Widget',
        quality_tags: ['api']
      })
    ).toBe(true);
  });

  it('returns true for Widget when tagged `backend`', () => {
    expect(
      backendArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Widget',
        quality_tags: ['backend']
      })
    ).toBe(true);
  });

  it('returns true for Widget when tagged `persists`', () => {
    expect(
      backendArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Widget',
        quality_tags: ['persists']
      })
    ).toBe(true);
  });

  it('returns false for an unrecognised type', () => {
    expect(backendArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
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

  it('registers the Backend architect cleanly', () => {
    expect(() => {
      registry.register(new BackendArchitect());
    }).not.toThrow();
    expect(registry.get('backend')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new BackendArchitect());
    for (const k of BACKEND_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('backend');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new BackendArchitect());
    expect(() => registry.register(new BackendArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new BackendArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'backend.apiEndpoints',
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

  it('accepts a second architect with disjoint owned fields (frontend simulation)', () => {
    registry.register(new BackendArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'frontend-architect.v1',
      architectName: 'frontend',
      version: '0.1.0',
      sections: [
        { path: 'frontend.componentTree', description: 'Component tree', required: true }
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
    expect(registry.allPaths().length).toBe(BACKEND_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only Backend is present', () => {
    const conflicts = disjointness([BackendArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Backend and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...BackendArchitectContract,
      contractId: 'backend-clone.v1',
      architectName: 'backend-clone'
    };
    const conflicts = disjointness([BackendArchitectContract, clone]);
    expect(conflicts.length).toBe(BACKEND_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() is empty after a clean registration', () => {
    registry.register(new BackendArchitect());
    expect(registry.validate()).toEqual([]);
  });

  it('coexists with the merged database-architect contract (no field overlap)', () => {
    // The merged @caia/database-architect owns database.* — disjoint from backend.*.
    // We simulate it here without importing it (avoid cross-package test coupling).
    const databaseContract: ArchitectSectionContract = {
      contractId: 'database-architect.v1',
      architectName: 'database',
      version: '0.1.0',
      sections: [
        { path: 'database.tables', description: 'Tables', required: true },
        { path: 'database.columns', description: 'Columns', required: true }
      ],
      architectMeta: {
        dependsOn: ['backend'],
        precedenceLevel: 11,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    registry.register(new BackendArchitect());
    expect(() => {
      registry.register(new StubArchitect('database', databaseContract));
    }).not.toThrow();
  });
});
