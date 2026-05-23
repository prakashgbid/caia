/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `a11y.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed (precedence in [1,17], dependsOn declared).
 *   - The architect registers cleanly against the shared ArchitectRegistry.
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder accounts for a11y.
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

import { AccessibilityArchitect } from '../src/architect.js';
import {
  ACCESSIBILITY_ARCHITECT_META,
  A11Y_OWNED_SECTIONS,
  A11Y_OWNED_FIELD_KEYS,
  AccessibilityArchitectContract,
  accessibilityArchitectAppliesPredicate
} from '../src/contract.js';

describe('AccessibilityArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(AccessibilityArchitectContract.contractId).toBe('accessibility-architect.v1');
  });

  it('architectName is `accessibility` (matches package suffix)', () => {
    expect(AccessibilityArchitectContract.architectName).toBe('accessibility');
  });

  it('version follows semver-ish shape', () => {
    expect(AccessibilityArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `a11y.`', () => {
    for (const key of A11Y_OWNED_FIELD_KEYS) {
      expect(key.startsWith('a11y.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'a11y.wcagLevel',
      'a11y.ariaRoles',
      'a11y.ariaLabels',
      'a11y.keyboardNavigationPlan',
      'a11y.focusManagementNotes',
      'a11y.colorContrastRequirements',
      'a11y.screenReaderAnnouncementPoints',
      'a11y.reducedMotionConsiderations',
      'a11y.formAccessibilitySpec'
    ];
    for (const r of required) {
      expect(A11Y_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owns exactly 9 fields per spec §2.5', () => {
    expect(A11Y_OWNED_FIELD_KEYS.length).toBe(9);
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of A11Y_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(AccessibilityArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(AccessibilityArchitectContract).sort()).toEqual(
      [...A11Y_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('AccessibilityArchitectContract — architectMeta', () => {
  it('declares Frontend as an upstream dependency (wave-2 architect)', () => {
    expect(ACCESSIBILITY_ARCHITECT_META.dependsOn).toEqual(['frontend']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(ACCESSIBILITY_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(ACCESSIBILITY_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 3 per spec §5.2 (legal-exposure concern)', () => {
    expect(ACCESSIBILITY_ARCHITECT_META.precedenceLevel).toBe(3);
  });

  it('precedence ranks above Frontend (architects below A11y in legal exposure)', () => {
    // 'frontend' is at rank 14 in the canonical ladder; A11y is rank 3.
    expect(ACCESSIBILITY_ARCHITECT_META.precedenceLevel).toBeLessThan(
      precedenceRank('frontend')
    );
  });

  it('precedence ranks below Security and DevOps (operator-on-hook beats legal exposure)', () => {
    expect(ACCESSIBILITY_ARCHITECT_META.precedenceLevel).toBeGreaterThan(
      precedenceRank('security')
    );
    expect(ACCESSIBILITY_ARCHITECT_META.precedenceLevel).toBeGreaterThan(
      precedenceRank('devops')
    );
  });

  it('fanoutPolicy is `always`', () => {
    expect(ACCESSIBILITY_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.5', () => {
    expect(ACCESSIBILITY_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(ACCESSIBILITY_ARCHITECT_META.appliesPredicate).toBe(
      accessibilityArchitectAppliesPredicate
    );
  });

  it('canonical precedence ladder includes `a11y` alias for accessibility', () => {
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('a11y');
    expect(precedenceRank('a11y')).toBe(ACCESSIBILITY_ARCHITECT_META.precedenceLevel);
  });
});

describe('accessibilityArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(accessibilityArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Widget', () => {
    expect(accessibilityArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(
      true
    );
  });

  it('returns true for Story', () => {
    expect(accessibilityArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form (Story sub-type)', () => {
    expect(accessibilityArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List (Story sub-type)', () => {
    expect(accessibilityArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns false for Foundation (no UI)', () => {
    expect(accessibilityArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(
      false
    );
  });

  it('returns false for an unrecognised type', () => {
    expect(accessibilityArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
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

  it('registers the Accessibility architect cleanly', () => {
    expect(() => {
      registry.register(new AccessibilityArchitect());
    }).not.toThrow();
    expect(registry.get('accessibility')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new AccessibilityArchitect());
    for (const k of A11Y_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('accessibility');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new AccessibilityArchitect());
    expect(() => registry.register(new AccessibilityArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new AccessibilityArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'a11y.wcagLevel',
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
    registry.register(new AccessibilityArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'backend-architect.v1',
      architectName: 'backend',
      version: '0.1.0',
      sections: [{ path: 'backend.apiShape', description: 'API shape', required: true }],
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
    expect(registry.allPaths().length).toBe(A11Y_OWNED_FIELD_KEYS.length + 1);
  });

  it('is disjoint with Frontend\'s namespace (no overlap with `frontend.*`)', () => {
    for (const k of A11Y_OWNED_FIELD_KEYS) {
      expect(k.startsWith('frontend.')).toBe(false);
    }
  });

  it('disjointness() detects no conflicts when only Accessibility is present', () => {
    const conflicts = disjointness([AccessibilityArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between Accessibility and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...AccessibilityArchitectContract,
      contractId: 'accessibility-clone.v1',
      architectName: 'accessibility-clone'
    };
    const conflicts = disjointness([AccessibilityArchitectContract, clone]);
    expect(conflicts.length).toBe(A11Y_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() reports an unmet dependsOn when frontend is not registered', () => {
    registry.register(new AccessibilityArchitect());
    const errors = registry.validate();
    expect(errors.some(e => e.includes("'frontend'"))).toBe(true);
  });
});
