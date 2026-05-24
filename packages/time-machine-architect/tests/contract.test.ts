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

import { TimeMachineArchitect } from '../src/architect.js';
import {
  TIME_MACHINE_ARCHITECT_META,
  TIME_MACHINE_OWNED_SECTIONS,
  TIME_MACHINE_OWNED_FIELD_KEYS,
  TimeMachineArchitectContract,
  timeMachineArchitectAppliesPredicate
} from '../src/contract.js';

describe('TimeMachineArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(TimeMachineArchitectContract.contractId).toBe('time-machine-architect.v1');
  });

  it('architectName is `time-machine` (matches V2 task brief)', () => {
    expect(TimeMachineArchitectContract.architectName).toBe('time-machine');
  });

  it('version follows semver-ish shape', () => {
    expect(TimeMachineArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `timeMachine.`', () => {
    for (const key of TIME_MACHINE_OWNED_FIELD_KEYS) {
      expect(key.startsWith('timeMachine.')).toBe(true);
    }
  });

  it('owned-field set covers the V2 task-brief mandatory fields', () => {
    const required = [
      'timeMachine.versioningStrategy',
      'timeMachine.snapshotRetention',
      'timeMachine.revertOperation',
      'timeMachine.descriptionGeneration',
      'timeMachine.dataConsistency',
      'timeMachine.auditTrail'
    ];
    for (const r of required) {
      expect(TIME_MACHINE_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owns exactly the V2 task brief field set (no extras, no gaps)', () => {
    expect([...TIME_MACHINE_OWNED_FIELD_KEYS].sort()).toEqual(
      [
        'timeMachine.auditTrail',
        'timeMachine.dataConsistency',
        'timeMachine.descriptionGeneration',
        'timeMachine.revertOperation',
        'timeMachine.snapshotRetention',
        'timeMachine.versioningStrategy'
      ].sort()
    );
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of TIME_MACHINE_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(TimeMachineArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(TimeMachineArchitectContract).sort()).toEqual(
      [...TIME_MACHINE_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('TimeMachineArchitectContract — architectMeta', () => {
  it('declares Backend + Database as upstream dependencies (wave-2)', () => {
    expect(TIME_MACHINE_ARCHITECT_META.dependsOn).toEqual(['backend', 'database']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(TIME_MACHINE_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(TIME_MACHINE_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 15 per spec §5.2', () => {
    expect(TIME_MACHINE_ARCHITECT_META.precedenceLevel).toBe(15);
  });

  it('fanoutPolicy is `always`', () => {
    expect(TIME_MACHINE_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.14', () => {
    expect(TIME_MACHINE_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(TIME_MACHINE_ARCHITECT_META.appliesPredicate).toBe(
      timeMachineArchitectAppliesPredicate
    );
  });

  it("canonical precedence ladder lists this architect under the 'timeMachine' alias", () => {
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('timeMachine');
    expect(precedenceRank('timeMachine')).toBe(
      TIME_MACHINE_ARCHITECT_META.precedenceLevel
    );
  });
});

describe('timeMachineArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(timeMachineArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Story', () => {
    expect(timeMachineArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form', () => {
    expect(timeMachineArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List', () => {
    expect(timeMachineArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns true for Foundation', () => {
    expect(
      timeMachineArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })
    ).toBe(true);
  });

  it('returns false for an untagged Widget', () => {
    expect(timeMachineArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(false);
  });

  it('returns true for a Widget tagged `versioned`', () => {
    expect(
      timeMachineArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Widget',
        quality_tags: ['versioned']
      })
    ).toBe(true);
  });

  it('returns true for a Widget tagged `time-machine`', () => {
    expect(
      timeMachineArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Widget',
        quality_tags: ['time-machine']
      })
    ).toBe(true);
  });

  it('returns false for an unrecognised ticket type', () => {
    expect(timeMachineArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
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

  it('registers the Time Machine architect cleanly', () => {
    expect(() => {
      registry.register(new TimeMachineArchitect());
    }).not.toThrow();
    expect(registry.get('time-machine')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new TimeMachineArchitect());
    for (const k of TIME_MACHINE_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('time-machine');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new TimeMachineArchitect());
    expect(() => registry.register(new TimeMachineArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new TimeMachineArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'timeMachine.revertOperation',
          description: 'colliding owner',
          required: true
        }
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
      registry.register(new StubArchitect('colliding', collidingContract));
    }).toThrowError(ArchitectRegistryError);
  });

  it('accepts a second architect with disjoint owned fields', () => {
    registry.register(new TimeMachineArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'backend-architect.v1',
      architectName: 'backend',
      version: '0.1.0',
      sections: [
        { path: 'backend.apiShape', description: 'API shape', required: true }
      ],
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
    expect(registry.allPaths().length).toBe(TIME_MACHINE_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only Time Machine is present', () => {
    const conflicts = disjointness([TimeMachineArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Time Machine and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...TimeMachineArchitectContract,
      contractId: 'time-machine-clone.v1',
      architectName: 'time-machine-clone'
    };
    const conflicts = disjointness([TimeMachineArchitectContract, clone]);
    expect(conflicts.length).toBe(TIME_MACHINE_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() reports its declared upstream deps as unresolved when only Time Machine is registered', () => {
    registry.register(new TimeMachineArchitect());
    const errors = registry.validate();
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.join(' ')).toContain('backend');
    expect(errors.join(' ')).toContain('database');
  });

  it('registry.validate() is empty after registering Time Machine + its declared upstream stubs', () => {
    registry.register(new TimeMachineArchitect());
    const backendContract: ArchitectSectionContract = {
      contractId: 'backend-architect.v1',
      architectName: 'backend',
      version: '0.1.0',
      sections: [{ path: 'backend.apiShape', description: 'API', required: true }],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 12,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    const databaseContract: ArchitectSectionContract = {
      contractId: 'database-architect.v1',
      architectName: 'database',
      version: '0.1.0',
      sections: [{ path: 'database.tables', description: 'tables', required: true }],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 11,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    registry.register(new StubArchitect('backend', backendContract));
    registry.register(new StubArchitect('database', databaseContract));
    expect(registry.validate()).toEqual([]);
  });
});
