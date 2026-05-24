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

import { ApiGatewayArchitect } from '../src/architect.js';
import {
  API_GATEWAY_ARCHITECT_META,
  API_GATEWAY_OWNED_SECTIONS,
  API_GATEWAY_OWNED_FIELD_KEYS,
  ApiGatewayArchitectContract,
  apiGatewayArchitectAppliesPredicate
} from '../src/contract.js';

describe('ApiGatewayArchitectContract — structural', () => {
  it('contractId follows the canonical `<name>-architect.v<major>` form', () => {
    expect(ApiGatewayArchitectContract.contractId).toBe('api-gateway-architect.v1');
  });

  it('architectName is `apiGateway` (matches precedence ladder slot)', () => {
    expect(ApiGatewayArchitectContract.architectName).toBe('apiGateway');
  });

  it('version follows semver-ish shape', () => {
    expect(ApiGatewayArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('all owned field paths begin with `apiGateway.`', () => {
    for (const key of API_GATEWAY_OWNED_FIELD_KEYS) {
      expect(key.startsWith('apiGateway.')).toBe(true);
    }
  });

  it('owned-field set covers the task-brief mandatory fields', () => {
    const required = [
      'apiGateway.rateLimits',
      'apiGateway.authGates',
      'apiGateway.versioningStrategy',
      'apiGateway.errorEnvelope',
      'apiGateway.requestResponseTransforms',
      'apiGateway.corsPolicy',
      'apiGateway.webhookSecrets',
      'apiGateway.apiQuotas'
    ];
    for (const r of required) {
      expect(API_GATEWAY_OWNED_FIELD_KEYS).toContain(r);
    }
  });

  it('exposes exactly 8 owned fields per the task brief', () => {
    expect(API_GATEWAY_OWNED_FIELD_KEYS.length).toBe(8);
  });

  it('every owned section has a non-empty description and is required', () => {
    for (const spec of API_GATEWAY_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });

  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(ApiGatewayArchitectContract)).toEqual([]);
  });

  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(ApiGatewayArchitectContract).sort()).toEqual(
      [...API_GATEWAY_OWNED_FIELD_KEYS].sort()
    );
  });
});

describe('ApiGatewayArchitectContract — architectMeta', () => {
  it('declares Backend + Security as upstream dependencies', () => {
    expect(API_GATEWAY_ARCHITECT_META.dependsOn).toEqual(['backend', 'security']);
  });

  it('precedence level is in the legal [1, 17] range', () => {
    expect(API_GATEWAY_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(API_GATEWAY_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });

  it('precedence level is 8 per spec §2.11', () => {
    expect(API_GATEWAY_ARCHITECT_META.precedenceLevel).toBe(8);
  });

  it('fanoutPolicy is `always`', () => {
    expect(API_GATEWAY_ARCHITECT_META.fanoutPolicy).toBe('always');
  });

  it('runtimeModel is `sonnet` per spec §2.11', () => {
    expect(API_GATEWAY_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });

  it('appliesPredicate is the exported function reference', () => {
    expect(API_GATEWAY_ARCHITECT_META.appliesPredicate).toBe(apiGatewayArchitectAppliesPredicate);
  });

  it('matches the canonical precedence ladder for `apiGateway`', () => {
    expect(precedenceRank('apiGateway')).toBe(API_GATEWAY_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('apiGateway');
  });
});

describe('apiGatewayArchitectAppliesPredicate', () => {
  const baseTicket = { id: 't1', type: 'Page' };

  it('returns true for Page', () => {
    expect(apiGatewayArchitectAppliesPredicate({ ...baseTicket, type: 'Page' })).toBe(true);
  });

  it('returns true for Story', () => {
    expect(apiGatewayArchitectAppliesPredicate({ ...baseTicket, type: 'Story' })).toBe(true);
  });

  it('returns true for Form', () => {
    expect(apiGatewayArchitectAppliesPredicate({ ...baseTicket, type: 'Form' })).toBe(true);
  });

  it('returns true for List', () => {
    expect(apiGatewayArchitectAppliesPredicate({ ...baseTicket, type: 'List' })).toBe(true);
  });

  it('returns true for Foundation', () => {
    expect(apiGatewayArchitectAppliesPredicate({ ...baseTicket, type: 'Foundation' })).toBe(true);
  });

  it('returns false for Widget without API tags', () => {
    expect(apiGatewayArchitectAppliesPredicate({ ...baseTicket, type: 'Widget' })).toBe(false);
  });

  it('returns true for Widget tagged with `api`', () => {
    expect(
      apiGatewayArchitectAppliesPredicate({ ...baseTicket, type: 'Widget', quality_tags: ['api'] })
    ).toBe(true);
  });

  it('returns true for Widget tagged with `webhook`', () => {
    expect(
      apiGatewayArchitectAppliesPredicate({ ...baseTicket, type: 'Widget', quality_tags: ['webhook'] })
    ).toBe(true);
  });

  it('returns false for an unrecognised type', () => {
    expect(apiGatewayArchitectAppliesPredicate({ ...baseTicket, type: 'Cron' })).toBe(false);
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

  it('registers the API Gateway architect cleanly', () => {
    expect(() => {
      registry.register(new ApiGatewayArchitect());
    }).not.toThrow();
    expect(registry.get('apiGateway')).toBeDefined();
  });

  it('claims every owned field path on the registry', () => {
    registry.register(new ApiGatewayArchitect());
    for (const k of API_GATEWAY_OWNED_FIELD_KEYS) {
      expect(registry.ownerOf(k)).toBe('apiGateway');
    }
  });

  it('rejects a duplicate registration of the same architect name', () => {
    registry.register(new ApiGatewayArchitect());
    expect(() => registry.register(new ApiGatewayArchitect())).toThrowError(ArchitectRegistryError);
  });

  it('rejects a second architect that overlaps owned field paths', () => {
    registry.register(new ApiGatewayArchitect());
    const colliding: ArchitectSectionContract = {
      contractId: 'colliding.v1',
      architectName: 'colliding',
      version: '0.1.0',
      sections: [
        { path: 'apiGateway.rateLimits', description: 'colliding owner', required: true }
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
      registry.register(new StubArchitect('colliding', colliding));
    }).toThrowError(ArchitectRegistryError);
  });

  it('accepts a second architect with disjoint owned fields', () => {
    registry.register(new ApiGatewayArchitect());
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
    expect(registry.allPaths().length).toBe(API_GATEWAY_OWNED_FIELD_KEYS.length + 1);
  });

  it('disjointness() detects no conflicts when only API Gateway is present', () => {
    const conflicts = disjointness([ApiGatewayArchitectContract]);
    expect(conflicts).toEqual([]);
  });

  it('disjointness() detects a conflict between API Gateway and a clone', () => {
    const clone: ArchitectSectionContract = {
      ...ApiGatewayArchitectContract,
      contractId: 'api-gateway-clone.v1',
      architectName: 'apiGateway-clone'
    };
    const conflicts = disjointness([ApiGatewayArchitectContract, clone]);
    expect(conflicts.length).toBe(API_GATEWAY_OWNED_FIELD_KEYS.length);
  });

  it('registry.validate() is empty after a clean registration (with upstream stubs)', () => {
    // API Gateway depends on backend + security; the registry's validate()
    // complains about missing upstream deps. Register stub upstreams so
    // the registry is internally consistent.
    const stubMeta = {
      dependsOn: [],
      precedenceLevel: 12,
      fanoutPolicy: 'always' as const,
      appliesPredicate: () => true,
      runtimeModel: 'sonnet' as const
    };
    registry.register(
      new StubArchitect('backend', {
        contractId: 'backend-architect.v1',
        architectName: 'backend',
        version: '0.1.0',
        sections: [{ path: 'backend.framework', description: 'fw', required: true }],
        architectMeta: stubMeta
      })
    );
    registry.register(
      new StubArchitect('security', {
        contractId: 'security-architect.v1',
        architectName: 'security',
        version: '0.1.0',
        sections: [{ path: 'security.authenticationStrategy', description: 'auth', required: true }],
        architectMeta: { ...stubMeta, precedenceLevel: 1 }
      })
    );
    registry.register(new ApiGatewayArchitect());
    expect(registry.validate()).toEqual([]);
  });

  it('registry.validate() flags missing upstream backend + security when API Gateway is registered alone', () => {
    registry.register(new ApiGatewayArchitect());
    const errors = registry.validate();
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const joined = errors.join('|');
    expect(joined).toContain('backend');
    expect(joined).toContain('security');
  });
});
