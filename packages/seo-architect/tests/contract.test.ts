/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `seo.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed.
 *   - The architect registers cleanly against the ArchitectRegistry.
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder lists `seo`.
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

import { SeoArchitect } from '../src/architect.js';
import {
  SEO_ARCHITECT_META,
  SEO_OWNED_SECTIONS,
  SEO_OWNED_FIELD_KEYS,
  SeoArchitectContract,
  seoArchitectAppliesPredicate
} from '../src/contract.js';

describe('SeoArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(SeoArchitectContract.contractId).toBe('seo-architect.v1');
  });

  it('architectName is `seo` (matches package suffix + ladder entry)', () => {
    expect(SeoArchitectContract.architectName).toBe('seo');
  });

  it('version follows semver-ish shape', () => {
    expect(SeoArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `seo.`', () => {
    for (const key of SEO_OWNED_FIELD_KEYS) {
      expect(key.startsWith('seo.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'seo.schemaOrgJsonLd',
      'seo.canonicalUrl',
      'seo.metaTags',
      'seo.ogTags',
      'seo.twitterCard',
      'seo.sitemapEntry',
      'seo.robotsDirective',
      'seo.keywordTargets',
      'seo.pageType'
    ];
    for (const r of required) {
      expect(SEO_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('declares exactly 9 owned fields (per task brief)', () => {
    expect(SEO_OWNED_FIELD_KEYS.length).toBe(9);
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of SEO_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(SeoArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(SeoArchitectContract).sort()).toEqual(
      [...SEO_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('SeoArchitectContract — architectMeta', () => {
  it('declares zero dependencies (wave-1 architect)', () => {
    expect(SEO_ARCHITECT_META.dependsOn).toEqual([]);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(SEO_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(SEO_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 4 per spec §5.2 (locked playbook non-negotiable)', () => {
    expect(SEO_ARCHITECT_META.precedenceLevel).toBe(4);
  });

  it('fanoutPolicy is `always`', () => {
    expect(SEO_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.4', () => {
    expect(SEO_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(SEO_ARCHITECT_META.appliesPredicate).toBe(seoArchitectAppliesPredicate);
  });

  it('matches the canonical precedence ladder for `seo`', () => {
    expect(precedenceRank('seo')).toBe(SEO_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('seo');
  });
});

describe('seoArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page (spec §3.3: SEO only applies to Page tickets)', () => {
    expect(seoArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns false for Widget (Widgets inherit SEO from their Page)', () => {
    expect(seoArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(false);
  });

  it('returns false for Story', () => {
    expect(seoArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(false);
  });

  it('returns false for Form', () => {
    expect(seoArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(false);
  });

  it('returns false for List', () => {
    expect(seoArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(false);
  });

  it('returns false for Foundation (no UI)', () => {
    expect(seoArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(false);
  });

  it('returns false for an unrecognised type', () => {
    expect(seoArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
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

  it('registers the SEO architect cleanly', () => {
    expect(() => {
      registry.register(new SeoArchitect());
    }).not.toThrow();
    expect(registry.get('seo')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new SeoArchitect());
    for (const k of SEO_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('seo');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new SeoArchitect());
    expect(() => registry.register(new SeoArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new SeoArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'seo.schemaOrgJsonLd',
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
    registry.register(new SeoArchitect());
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
    expect(registry.allPaths().length).toBe(SEO_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only SEO is present', () => {
    const conflicts = disjointness([SeoArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between SEO and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...SeoArchitectContract,
      contractId: 'seo-clone.v1',
      architectName: 'seo-clone'
    };
    const conflicts = disjointness([SeoArchitectContract, clone]);
    expect(conflicts.length).toBe(SEO_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() is empty after a clean registration', () => {
    registry.register(new SeoArchitect());
    expect(registry.validate()).toEqual([]);
  });
});
