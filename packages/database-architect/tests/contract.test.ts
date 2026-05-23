/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `database.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed (precedence in [1,17], depends on backend).
 *   - The architect registers cleanly against the local ArchitectRegistry.
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder lists `database` at rank 11.
 *   - Disjointness with `@caia/frontend-architect`'s contract (no overlap).
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

import { DatabaseArchitect } from '../src/architect.js';
import {
  DATABASE_ARCHITECT_META,
  DATABASE_FIELD_FIX_HINTS,
  DATABASE_OWNED_SECTIONS,
  DATABASE_OWNED_FIELD_KEYS,
  DatabaseArchitectContract,
  databaseArchitectAppliesPredicate
} from '../src/contract.js';
import {
  FrontendArchitectContract,
  FRONTEND_OWNED_FIELD_KEYS
} from '@caia/frontend-architect';

describe('DatabaseArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(DatabaseArchitectContract.contractId).toBe('database-architect.v1');
  });

  it('architectName is `database` (matches package suffix + ladder entry)', () => {
    expect(DatabaseArchitectContract.architectName).toBe('database');
  });

  it('version follows semver-ish shape', () => {
    expect(DatabaseArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `database.`', () => {
    for (const key of DATABASE_OWNED_FIELD_KEYS) {
      expect(key.startsWith('database.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'database.tables',
      'database.columns',
      'database.indexes',
      'database.migrations',
      'database.relationships',
      'database.rlsPolicies',
      'database.tenantIsolationStrategy',
      'database.dataLifecycle'
    ];
    for (const r of required) {
      expect(DATABASE_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owned-field set covers spec §2.3 stack-lock + structural fields', () => {
    const specMandatory = [
      'database.engine',
      'database.jsonbShapes',
      'database.queryHints'
    ];
    for (const k of specMandatory) {
      expect(DATABASE_OWNED_FIELD_KEYS).toContain(k);
    }
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of DATABASE_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(DatabaseArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(DatabaseArchitectContract).sort()).toEqual(
      [...DATABASE_OWNED_FIELD_KEYS].sort()
    );
  });

  it('every owned field has a matching fix-hint entry', () => {
    for (const key of DATABASE_OWNED_FIELD_KEYS) {
      expect(DATABASE_FIELD_FIX_HINTS[key]).toBeDefined();
      expect(DATABASE_FIELD_FIX_HINTS[key].length).toBeGreaterThan(20);
    }
  });
});

describe('DatabaseArchitectContract — architectMeta', () => {
  it('declares Backend as its only upstream dependency (wave-2 architect)', () => {
    expect(DATABASE_ARCHITECT_META.dependsOn).toEqual(['backend']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(DATABASE_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(DATABASE_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 11 per spec §5.2 (above Backend at 12)', () => {
    expect(DATABASE_ARCHITECT_META.precedenceLevel).toBe(11);
  });

  it('fanoutPolicy is `always`', () => {
    expect(DATABASE_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.3', () => {
    expect(DATABASE_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(DATABASE_ARCHITECT_META.appliesPredicate).toBe(databaseArchitectAppliesPredicate);
  });

  it('matches the canonical precedence ladder for `database`', () => {
    expect(precedenceRank('database')).toBe(DATABASE_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('database');
  });

  it('outranks Backend in the precedence ladder (schema correctness > functional correctness)', () => {
    expect(precedenceRank('database')).toBeLessThan(precedenceRank('backend'));
  });
});

describe('databaseArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(databaseArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Story', () => {
    expect(databaseArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form', () => {
    expect(databaseArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List', () => {
    expect(databaseArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns true for Foundation', () => {
    expect(databaseArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(true);
  });

  it('returns false for un-tagged Widget (UI-only, no persistence)', () => {
    expect(databaseArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(false);
  });

  it('returns true for a Widget explicitly tagged `persists`', () => {
    expect(
      databaseArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Widget',
        quality_tags: ['persists']
      })
    ).toBe(true);
  });

  it('returns true for a Widget explicitly tagged `database`', () => {
    expect(
      databaseArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Widget',
        quality_tags: ['database']
      })
    ).toBe(true);
  });

  it('returns false for an unrecognised type', () => {
    expect(databaseArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
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

  it('registers the Database architect cleanly', () => {
    expect(() => {
      registry.register(new DatabaseArchitect());
    }).not.toThrow();
    expect(registry.get('database')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new DatabaseArchitect());
    for (const k of DATABASE_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('database');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new DatabaseArchitect());
    expect(() => registry.register(new DatabaseArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new DatabaseArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'database.tables',
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
    registry.register(new DatabaseArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'security-architect.v1',
      architectName: 'security',
      version: '0.1.0',
      sections: [
        { path: 'security.cspPolicy', description: 'CSP', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 1,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    expect(() => {
      registry.register(new StubArchitect('security', disjointContract));
    }).not.toThrow();
    expect(registry.size()).toBe(2);
    expect(registry.allPaths().length).toBe(DATABASE_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only Database is present', () => {
    const conflicts = disjointness([DatabaseArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Database and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...DatabaseArchitectContract,
      contractId: 'database-clone.v1',
      architectName: 'database-clone'
    };
    const conflicts = disjointness([DatabaseArchitectContract, clone]);
    expect(conflicts.length).toBe(DATABASE_OWNED_FIELD_KEYS.length);
  });

  it('Database and Frontend contracts have NO overlapping field paths (disjoint namespaces)', () => {
    const conflicts = disjointness([DatabaseArchitectContract, FrontendArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('Database owned fields do not collide with Frontend owned fields', () => {
    const frontendSet = new Set(FRONTEND_OWNED_FIELD_KEYS);
    for (const key of DATABASE_OWNED_FIELD_KEYS) {
      expect(frontendSet.has(key)).toBe(false);
    }
  });

  it('registry.validate() is empty after a clean registration', () => {
    registry.register(new DatabaseArchitect());
    // dependsOn: ['backend'] — without Backend registered, validate reports it.
    const errors = registry.validate();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('backend');
  });

  it('registry.validate() is empty when Backend is also registered', () => {
    const backendContract: ArchitectSectionContract = {
      contractId: 'backend-architect.v1',
      architectName: 'backend',
      version: '0.1.0',
      sections: [
        { path: 'backend.apiEndpoints', description: 'API endpoints', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 12,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    registry.register(new StubArchitect('backend', backendContract));
    registry.register(new DatabaseArchitect());
    expect(registry.validate()).toEqual([]);
  });
});
