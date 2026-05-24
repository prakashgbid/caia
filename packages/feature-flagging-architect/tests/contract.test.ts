/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `featureFlags.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed (precedence in [1,17], etc).
 *   - The architect registers cleanly against the ArchitectRegistry.
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder lists `featureFlagging`.
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

import { FeatureFlaggingArchitect } from '../src/architect.js';
import {
  FEATURE_FLAGGING_ARCHITECT_META,
  FEATURE_FLAGGING_FIELD_FIX_HINTS,
  FEATURE_FLAGGING_OWNED_FIELD_KEYS,
  FEATURE_FLAGGING_OWNED_SECTIONS,
  FeatureFlaggingArchitectContract,
  featureFlaggingArchitectAppliesPredicate
} from '../src/contract.js';

describe('FeatureFlaggingArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(FeatureFlaggingArchitectContract.contractId).toBe('feature-flagging-architect.v1');
  });

  it('architectName is `featureFlagging` (matches ladder entry)', () => {
    expect(FeatureFlaggingArchitectContract.architectName).toBe('featureFlagging');
  });

  it('version follows semver-ish shape', () => {
    expect(FeatureFlaggingArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `featureFlags.`', () => {
    for (const key of FEATURE_FLAGGING_OWNED_FIELD_KEYS) {
      expect(key.startsWith('featureFlags.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'featureFlags.flagsSchema',
      'featureFlags.rolloutStrategies',
      'featureFlags.killSwitches',
      'featureFlags.experimentationLinkage',
      'featureFlags.auditRequirements'
    ];
    for (const r of required) {
      expect(FEATURE_FLAGGING_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owns exactly 5 fields (the task brief target)', () => {
    expect(FEATURE_FLAGGING_OWNED_FIELD_KEYS.length).toBe(5);
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of FEATURE_FLAGGING_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(FeatureFlaggingArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(FeatureFlaggingArchitectContract).sort()).toEqual(
      [...FEATURE_FLAGGING_OWNED_FIELD_KEYS].sort()
    );
  });

  it('every owned field has a fix-hint entry', () => {
    for (const key of FEATURE_FLAGGING_OWNED_FIELD_KEYS) {
      expect(FEATURE_FLAGGING_FIELD_FIX_HINTS[key]).toBeTruthy();
      expect(FEATURE_FLAGGING_FIELD_FIX_HINTS[key].length).toBeGreaterThan(20);
    }
  });
});

describe('FeatureFlaggingArchitectContract — architectMeta', () => {
  it('declares Frontend + Backend dependencies (wave-2 architect per task brief)', () => {
    expect(FEATURE_FLAGGING_ARCHITECT_META.dependsOn).toEqual(['frontend', 'backend']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(FEATURE_FLAGGING_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(FEATURE_FLAGGING_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 7 per spec §5.2', () => {
    expect(FEATURE_FLAGGING_ARCHITECT_META.precedenceLevel).toBe(7);
  });

  it('fanoutPolicy is `always`', () => {
    expect(FEATURE_FLAGGING_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.12', () => {
    expect(FEATURE_FLAGGING_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(FEATURE_FLAGGING_ARCHITECT_META.appliesPredicate).toBe(
      featureFlaggingArchitectAppliesPredicate
    );
  });

  it('matches the canonical precedence ladder for `featureFlagging`', () => {
    expect(precedenceRank('featureFlagging')).toBe(
      FEATURE_FLAGGING_ARCHITECT_META.precedenceLevel
    );
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('featureFlagging');
  });
});

describe('featureFlaggingArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Story' };

  it('returns true for any ticket tagged `flag`', () => {
    expect(
      featureFlaggingArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Foundation',
        quality_tags: ['flag']
      })
    ).toBe(true);
  });

  it('returns true for `feature-flag` tag', () => {
    expect(
      featureFlaggingArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Foundation',
        quality_tags: ['feature-flag']
      })
    ).toBe(true);
  });

  it('returns true for `experimental` tag', () => {
    expect(
      featureFlaggingArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Foundation',
        quality_tags: ['experimental']
      })
    ).toBe(true);
  });

  it('returns true for `rollout` tag', () => {
    expect(
      featureFlaggingArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Foundation',
        quality_tags: ['rollout']
      })
    ).toBe(true);
  });

  it('returns true for `canary` tag', () => {
    expect(
      featureFlaggingArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Foundation',
        quality_tags: ['canary']
      })
    ).toBe(true);
  });

  it('returns true for `kill-switch` tag', () => {
    expect(
      featureFlaggingArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Foundation',
        quality_tags: ['kill-switch']
      })
    ).toBe(true);
  });

  it('returns true for `ab` / `ab-test` / `ring-deployment` tags', () => {
    for (const tag of ['ab', 'ab-test', 'ring-deployment']) {
      expect(
        featureFlaggingArchitectAppliesPredicate({
          ...baseTicket,
          type: 'Foundation',
          quality_tags: [tag]
        })
      ).toBe(true);
    }
  });

  it('returns true for Page tickets (user-facing default)', () => {
    expect(featureFlaggingArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(
      true
    );
  });

  it('returns true for Widget, Story, Form, List tickets', () => {
    for (const t of ['Widget', 'Story', 'Form', 'List']) {
      expect(featureFlaggingArchitectAppliesPredicate({ ...baseTicket, type: t })).toBe(true);
    }
  });

  it('returns false for plain Foundation tickets without any opt-in tag', () => {
    expect(
      featureFlaggingArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Foundation',
        quality_tags: ['infra']
      })
    ).toBe(false);
  });

  it('returns true for Foundation with `deployment` tag', () => {
    expect(
      featureFlaggingArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Foundation',
        quality_tags: ['deployment']
      })
    ).toBe(true);
  });

  it('returns false for an unrecognised type with no tags', () => {
    expect(featureFlaggingArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(
      false
    );
  });

  it('returns false for tickets with neither type match nor opt-in tag', () => {
    expect(
      featureFlaggingArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Unknown',
        quality_tags: []
      })
    ).toBe(false);
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

  it('registers the Feature Flagging architect cleanly', () => {
    expect(() => {
      registry.register(new FeatureFlaggingArchitect());
    }).not.toThrow();
    expect(registry.get('featureFlagging')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new FeatureFlaggingArchitect());
    for (const k of FEATURE_FLAGGING_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('featureFlagging');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new FeatureFlaggingArchitect());
    expect(() => registry.register(new FeatureFlaggingArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new FeatureFlaggingArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'featureFlags.flagsSchema',
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
    registry.register(new FeatureFlaggingArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'frontend-architect.v1',
      architectName: 'frontend',
      version: '0.1.0',
      sections: [
        { path: 'frontend.componentTree', description: 'frontend tree', required: true }
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
    expect(registry.allPaths().length).toBe(FEATURE_FLAGGING_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only Feature Flagging is present', () => {
    const conflicts = disjointness([FeatureFlaggingArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Feature Flagging and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...FeatureFlaggingArchitectContract,
      contractId: 'feature-flagging-clone.v1',
      architectName: 'feature-flagging-clone'
    };
    const conflicts = disjointness([FeatureFlaggingArchitectContract, clone]);
    expect(conflicts.length).toBe(FEATURE_FLAGGING_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() reports the unregistered upstream deps (frontend + backend) when this architect is the only one registered', () => {
    registry.register(new FeatureFlaggingArchitect());
    const errs = registry.validate();
    // Feature Flagging depends on frontend + backend; with neither
    // registered the validator should surface both as missing-dep errors.
    expect(errs.length).toBe(2);
    expect(errs.join(' ')).toMatch(/frontend/);
    expect(errs.join(' ')).toMatch(/backend/);
  });

  it('registry.validate() is empty once both upstream architects are registered', () => {
    const stubFrontend: ArchitectSectionContract = {
      contractId: 'frontend-architect.v1',
      architectName: 'frontend',
      version: '0.1.0',
      sections: [
        { path: 'frontend.componentTree', description: 'tree', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 14,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    const stubBackend: ArchitectSectionContract = {
      contractId: 'backend-architect.v1',
      architectName: 'backend',
      version: '0.1.0',
      sections: [
        { path: 'backend.apiEndpoints', description: 'endpoints', required: true }
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 12,
        fanoutPolicy: 'always',
        appliesPredicate: () => true,
        runtimeModel: 'sonnet'
      }
    };
    registry.register(new StubArchitect('frontend', stubFrontend));
    registry.register(new StubArchitect('backend', stubBackend));
    registry.register(new FeatureFlaggingArchitect());
    expect(registry.validate()).toEqual([]);
  });
});
