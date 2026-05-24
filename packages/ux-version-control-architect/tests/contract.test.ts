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

import { UxVersionControlArchitect } from '../src/architect.js';
import {
  UX_VERSION_CONTROL_ARCHITECT_META,
  UX_VERSION_CONTROL_OWNED_SECTIONS,
  UX_VERSION_CONTROL_OWNED_FIELD_KEYS,
  UxVersionControlArchitectContract,
  uxVersionControlArchitectAppliesPredicate
} from '../src/contract.js';

describe('UxVersionControlArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(UxVersionControlArchitectContract.contractId).toBe(
      'ux-version-control-architect.v1'
    );
  });

  it('architectName is `ux-version-control` (matches V2 task brief)', () => {
    expect(UxVersionControlArchitectContract.architectName).toBe('ux-version-control');
  });

  it('version follows semver-ish shape', () => {
    expect(UxVersionControlArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `uxVersionControl.`', () => {
    for (const key of UX_VERSION_CONTROL_OWNED_FIELD_KEYS) {
      expect(key.startsWith('uxVersionControl.')).toBe(true);
    }
  });

  it('owned-field set covers the V2 task-brief mandatory fields', () => {
    const required = [
      'uxVersionControl.designVersionRetention',
      'uxVersionControl.revertOperation',
      'uxVersionControl.diffVisualizationSpec',
      'uxVersionControl.branchingStrategy',
      'uxVersionControl.auditTrail'
    ];
    for (const r of required) {
      expect(UX_VERSION_CONTROL_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owns exactly the V2 task brief field set (no extras, no gaps)', () => {
    expect([...UX_VERSION_CONTROL_OWNED_FIELD_KEYS].sort()).toEqual(
      [
        'uxVersionControl.auditTrail',
        'uxVersionControl.branchingStrategy',
        'uxVersionControl.designVersionRetention',
        'uxVersionControl.diffVisualizationSpec',
        'uxVersionControl.revertOperation'
      ].sort()
    );
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of UX_VERSION_CONTROL_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(UxVersionControlArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(UxVersionControlArchitectContract).sort()).toEqual(
      [...UX_VERSION_CONTROL_OWNED_FIELD_KEYS].sort()
    );
  });

  it('owned namespace is disjoint from sibling `timeMachine.*`', () => {
    for (const key of UX_VERSION_CONTROL_OWNED_FIELD_KEYS) {
      expect(key.startsWith('timeMachine.')).toBe(false);
    }
  });
});

describe('UxVersionControlArchitectContract — architectMeta', () => {
  it('declares no upstream dependencies (wave-1)', () => {
    expect(UX_VERSION_CONTROL_ARCHITECT_META.dependsOn).toEqual([]);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(UX_VERSION_CONTROL_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(UX_VERSION_CONTROL_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 16 per spec §5.2', () => {
    expect(UX_VERSION_CONTROL_ARCHITECT_META.precedenceLevel).toBe(16);
  });

  it('fanoutPolicy is `always`', () => {
    expect(UX_VERSION_CONTROL_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.15', () => {
    expect(UX_VERSION_CONTROL_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(UX_VERSION_CONTROL_ARCHITECT_META.appliesPredicate).toBe(
      uxVersionControlArchitectAppliesPredicate
    );
  });

  it("canonical precedence ladder lists this architect under the 'uxVersionControl' alias", () => {
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('uxVersionControl');
    expect(precedenceRank('uxVersionControl')).toBe(
      UX_VERSION_CONTROL_ARCHITECT_META.precedenceLevel
    );
  });
});

describe('uxVersionControlArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(
      uxVersionControlArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })
    ).toBe(true);
  });

  it('returns true for Widget', () => {
    expect(
      uxVersionControlArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })
    ).toBe(true);
  });

  it('returns true for Story', () => {
    expect(
      uxVersionControlArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })
    ).toBe(true);
  });

  it('returns true for Form', () => {
    expect(
      uxVersionControlArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })
    ).toBe(true);
  });

  it('returns true for List', () => {
    expect(
      uxVersionControlArchitectAppliesPredicate({ ...baseTicket, type: 'List' })
    ).toBe(true);
  });

  it('returns true for Site (spec §2.15 scope)', () => {
    expect(
      uxVersionControlArchitectAppliesPredicate({ ...baseTicket, type: 'Site' })
    ).toBe(true);
  });

  it('returns false for Foundation (no UX upload)', () => {
    expect(
      uxVersionControlArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })
    ).toBe(false);
  });

  it('returns false for an unrecognised ticket type', () => {
    expect(
      uxVersionControlArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })
    ).toBe(false);
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

  it('registers the UX Version Control architect cleanly', () => {
    expect(() => {
      registry.register(new UxVersionControlArchitect());
    }).not.toThrow();
    expect(registry.get('ux-version-control')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new UxVersionControlArchitect());
    for (const k of UX_VERSION_CONTROL_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('ux-version-control');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new UxVersionControlArchitect());
    expect(() => registry.register(new UxVersionControlArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new UxVersionControlArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'uxVersionControl.revertOperation',
          description: 'colliding owner',
          required: true
        }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 17,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    expect(() => {
      registry.register(new StubArchitect('colliding', collidingContract));
    }).toThrowError(ArchitectRegistryError);
  });

  it('accepts a sibling architect with disjoint owned fields (timeMachine namespace)', () => {
    registry.register(new UxVersionControlArchitect());
    const tmContract: ArchitectSectionContract = {
      contractId: 'time-machine-architect.v1',
      architectName: 'time-machine',
      version: '0.1.0',
      sections: [
        {
          path: 'timeMachine.revertOperation',
          description: 'CODE-level revert',
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
      registry.register(new StubArchitect('time-machine', tmContract));
    }).not.toThrow();
    expect(registry.size()).toBe(2);
    expect(registry.allPaths().length).toBe(
      UX_VERSION_CONTROL_OWNED_FIELD_KEYS.length + 1
    );
  });

  it('disjointness() detects no conflicts when only UX Version Control is present', () => {
    const conflicts = disjointness([UxVersionControlArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between UX Version Control and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...UxVersionControlArchitectContract,
      contractId: 'ux-version-control-clone.v1',
      architectName: 'ux-version-control-clone'
    };
    const conflicts = disjointness([UxVersionControlArchitectContract, clone]);
    expect(conflicts.length).toBe(UX_VERSION_CONTROL_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() is empty when only UX Version Control is registered (wave-1, no deps)', () => {
    registry.register(new UxVersionControlArchitect());
    expect(registry.validate()).toEqual([]);
  });
});
