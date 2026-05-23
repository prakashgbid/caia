/**
 * Section contract structural + registration tests.
 *
 * Verifies per spec §1.3:
 *   - All declared fields use the `aiml.*` namespace.
 *   - Every owned field has a non-empty description and is required.
 *   - `architectMeta` is well-formed (precedence in [1,17], etc).
 *   - The architect registers cleanly against the local ArchitectRegistry.
 *   - A second architect with overlapping paths is rejected.
 *   - The canonical precedence ladder lists `ai-ml`.
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

import { AIMLArchitect } from '../src/architect.js';
import {
  AIML_ARCHITECT_META,
  AIML_OWNED_SECTIONS,
  AIML_OWNED_FIELD_KEYS,
  AIMLArchitectContract,
  aimlArchitectAppliesPredicate
} from '../src/contract.js';

describe('AIMLArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(AIMLArchitectContract.contractId).toBe('aiml-architect.v1');
  });

  it('architectName is `ai-ml` (matches V2 brief + ladder entry)', () => {
    expect(AIMLArchitectContract.architectName).toBe('ai-ml');
  });

  it('version follows semver-ish shape', () => {
    expect(AIMLArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `aiml.`', () => {
    for (const key of AIML_OWNED_FIELD_KEYS) {
      expect(key.startsWith('aiml.')).toBe(true);
    }
  });

  it('owned-field set covers the V2 brief mandatory fields', () => {
    const required = [
      'aiml.modelSelection',
      'aiml.promptPatterns',
      'aiml.evalSuite',
      'aiml.costAttribution',
      'aiml.aiSafetyChecks',
      'aiml.temperaturePresets',
      'aiml.outputSchemas',
      'aiml.cacheStrategy'
    ];
    for (const r of required) {
      expect(AIML_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('owned-field set has exactly 8 fields per the V2 brief', () => {
    expect(AIML_OWNED_FIELD_KEYS.length).toBe(8);
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of AIML_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(AIMLArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(AIMLArchitectContract).sort()).toEqual(
      [...AIML_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('AIMLArchitectContract — architectMeta', () => {
  it('declares zero dependencies (wave-1 architect per V2 brief)', () => {
    expect(AIML_ARCHITECT_META.dependsOn).toEqual([]);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(AIML_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(AIML_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 13 per spec §5.2', () => {
    expect(AIML_ARCHITECT_META.precedenceLevel).toBe(13);
  });

  it('fanoutPolicy is `always`', () => {
    expect(AIML_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.7', () => {
    expect(AIML_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(AIML_ARCHITECT_META.appliesPredicate).toBe(aimlArchitectAppliesPredicate);
  });

  it('matches the canonical precedence ladder for `ai-ml`', () => {
    expect(precedenceRank('ai-ml')).toBe(AIML_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('ai-ml');
  });
});

describe('aimlArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Story' };

  it('returns true when business_requirements mentions LLM', () => {
    expect(
      aimlArchitectAppliesPredicate({
        ...baseTicket,
        business_requirements: { description: 'Add an LLM-powered classifier.' }
      })
    ).toBe(true);
  });

  it('returns true when business_requirements mentions chatbot', () => {
    expect(
      aimlArchitectAppliesPredicate({
        ...baseTicket,
        business_requirements: { description: 'Build a customer-support chatbot.' }
      })
    ).toBe(true);
  });

  it('returns true when business_requirements mentions Claude', () => {
    expect(
      aimlArchitectAppliesPredicate({
        ...baseTicket,
        business_requirements: { description: 'Wire a Claude call for tagging.' }
      })
    ).toBe(true);
  });

  it('returns true for AICall ticket type', () => {
    expect(aimlArchitectAppliesPredicate({ ...baseTicket, type: 'AICall' })).toBe(true);
  });

  it('returns true for LLMFlow ticket type', () => {
    expect(aimlArchitectAppliesPredicate({ ...baseTicket, type: 'LLMFlow' })).toBe(true);
  });

  it('returns true when quality_tags contains `ai`', () => {
    expect(
      aimlArchitectAppliesPredicate({ ...baseTicket, quality_tags: ['ai'] })
    ).toBe(true);
  });

  it('returns true when quality_tags contains `ml`', () => {
    expect(
      aimlArchitectAppliesPredicate({ ...baseTicket, quality_tags: ['ml'] })
    ).toBe(true);
  });

  it('returns true when quality_tags contains `llm`', () => {
    expect(
      aimlArchitectAppliesPredicate({ ...baseTicket, quality_tags: ['llm'] })
    ).toBe(true);
  });

  it('returns true on the `search` keyword (recommendation/search-as-service workloads)', () => {
    expect(
      aimlArchitectAppliesPredicate({
        ...baseTicket,
        business_requirements: { description: 'Build semantic search over docs.' }
      })
    ).toBe(true);
  });

  it('returns false for a vanilla Page ticket with no AI signals', () => {
    expect(
      aimlArchitectAppliesPredicate({
        ...baseTicket,
        type: 'Page',
        business_requirements: { description: 'Static marketing page.' },
        quality_tags: ['seo']
      })
    ).toBe(false);
  });

  it('returns false for an unrelated ticket', () => {
    expect(
      aimlArchitectAppliesPredicate({
        id: 't2',
        type: 'Widget',
        business_requirements: { description: 'Add a date picker.' }
      })
    ).toBe(false);
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

  it('registers the AI/ML architect cleanly', () => {
    expect(() => {
      registry.register(new AIMLArchitect());
    }).not.toThrow();
    expect(registry.get('ai-ml')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new AIMLArchitect());
    for (const k of AIML_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('ai-ml');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new AIMLArchitect());
    expect(() => registry.register(new AIMLArchitect())).toThrowError(
      ArchitectRegistryError
    );
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new AIMLArchitect());

    const collidingContract: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        {
          path: 'aiml.modelSelection',
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
    registry.register(new AIMLArchitect());
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
    expect(registry.allPaths().length).toBe(AIML_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only AI/ML is present', () => {
    const conflicts = disjointness([AIMLArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between AI/ML and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...AIMLArchitectContract,
      contractId: 'aiml-clone.v1',
      architectName: 'aiml-clone'
    };
    const conflicts = disjointness([AIMLArchitectContract, clone]);
    expect(conflicts.length).toBe(AIML_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() is empty after a clean registration', () => {
    registry.register(new AIMLArchitect());
    expect(registry.validate()).toEqual([]);
  });
});
