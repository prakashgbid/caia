/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `frontend.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed (precedence in [1,17], etc).
 *   - The architect registers cleanly against the local ArchitectRegistry
 *     (vendored from `@caia/architect-kit` until the kit lands on develop).
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder lists `frontend`.
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

import { FrontendArchitect } from '../src/architect.js';
import {
  FRONTEND_ARCHITECT_META,
  FRONTEND_OWNED_SECTIONS,
  FRONTEND_OWNED_FIELD_KEYS,
  FrontendArchitectContract,
  frontendArchitectAppliesPredicate
} from '../src/contract.js';

describe('FrontendArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(FrontendArchitectContract.contractId).toBe('frontend-architect.v1');
  });

  it('architectName is `frontend` (matches package suffix + ladder entry)', () => {
    expect(FrontendArchitectContract.architectName).toBe('frontend');
  });

  it('version follows semver-ish shape', () => {
    expect(FrontendArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `frontend.`', () => {
    for (const key of FRONTEND_OWNED_FIELD_KEYS) {
      expect(key.startsWith('frontend.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'frontend.componentTree',
      'frontend.propsContract',
      'frontend.stateModel',
      'frontend.designTokenReferences',
      'frontend.a11yNotesForUI',
      'frontend.routingNotes',
      'frontend.interactionStates'
    ];
    for (const r of required) {
      expect(FRONTEND_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owned-field set covers spec §2.1 mandatory fields', () => {
    const specMandatory = [
      'frontend.framework',
      'frontend.componentLibrary',
      'frontend.stateMgmt',
      'frontend.routeConfig',
      'frontend.tokens',
      'frontend.breakpoints',
      'frontend.a11yFloor',
      'frontend.motionPreference',
      'frontend.componentTree'
    ];
    for (const k of specMandatory) {
      expect(FRONTEND_OWNED_FIELD_KEYS).toContain(k);
    }
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of FRONTEND_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(FrontendArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(FrontendArchitectContract).sort()).toEqual(
      [...FRONTEND_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('FrontendArchitectContract — architectMeta', () => {
  it('declares zero dependencies (wave-1 architect)', () => {
    expect(FRONTEND_ARCHITECT_META.dependsOn).toEqual([]);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(FRONTEND_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(FRONTEND_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 14 per spec §5.2', () => {
    expect(FRONTEND_ARCHITECT_META.precedenceLevel).toBe(14);
  });

  it('fanoutPolicy is `always`', () => {
    expect(FRONTEND_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.1', () => {
    expect(FRONTEND_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(FRONTEND_ARCHITECT_META.appliesPredicate).toBe(frontendArchitectAppliesPredicate);
  });

  it('matches the canonical precedence ladder for `frontend`', () => {
    expect(precedenceRank('frontend')).toBe(FRONTEND_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('frontend');
  });
});

describe('frontendArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(frontendArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Widget', () => {
    expect(frontendArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(true);
  });

  it('returns true for Story', () => {
    expect(frontendArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form (Story sub-type)', () => {
    expect(frontendArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List (Story sub-type)', () => {
    expect(frontendArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns false for Foundation (no UI)', () => {
    expect(frontendArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(false);
  });

  it('returns false for an unrecognised type', () => {
    expect(frontendArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
  });
});

/**
 * Minimal stub architect used to test disjointness rejection — implements
 * the bare `SpecialistArchitect` interface directly. When `@caia/architect-kit`
 * lands on develop, swap to `extends BaseArchitect`.
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

  it('registers the Frontend architect cleanly', () => {
    expect(() => {
      registry.register(new FrontendArchitect());
    }).not.toThrow();
    expect(registry.get('frontend')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new FrontendArchitect());
    for (const k of FRONTEND_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('frontend');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new FrontendArchitect());
    expect(() => registry.register(new FrontendArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new FrontendArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'frontend.componentTree',
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
    registry.register(new FrontendArchitect());
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
    expect(registry.allPaths().length).toBe(FRONTEND_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only Frontend is present', () => {
    const conflicts = disjointness([FrontendArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Frontend and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...FrontendArchitectContract,
      contractId: 'frontend-clone.v1',
      architectName: 'frontend-clone'
    };
    const conflicts = disjointness([FrontendArchitectContract, clone]);
    expect(conflicts.length).toBe(FRONTEND_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() is empty after a clean registration', () => {
    registry.register(new FrontendArchitect());
    expect(registry.validate()).toEqual([]);
  });
});
