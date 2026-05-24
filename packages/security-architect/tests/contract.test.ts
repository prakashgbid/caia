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
import { SecurityArchitect } from '../src/architect.js';
import {
  OWASP_TOP_10_KEYS,
  OWASP_TOP_10_NAMES,
  SECURITY_ARCHITECT_META,
  SECURITY_FIELD_FIX_HINTS,
  SECURITY_OWNED_SECTIONS,
  SECURITY_OWNED_FIELD_KEYS,
  SecurityArchitectContract,
  securityArchitectAppliesPredicate
} from '../src/contract.js';
import { FrontendArchitectContract, FRONTEND_OWNED_FIELD_KEYS } from '@caia/frontend-architect';
import { DatabaseArchitectContract, DATABASE_OWNED_FIELD_KEYS } from '@caia/database-architect';

describe('SecurityArchitectContract — structural', () => {
  it('contractId follows the canonical form', () => {
    expect(SecurityArchitectContract.contractId).toBe('security-architect.v1');
  });
  it('architectName is `security`', () => {
    expect(SecurityArchitectContract.architectName).toBe('security');
  });
  it('version follows semver-ish shape', () => {
    expect(SecurityArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('all owned field paths begin with `security.`', () => {
    for (const key of SECURITY_OWNED_FIELD_KEYS) {
      expect(key.startsWith('security.')).toBe(true);
    }
  });
  it('owned-field set covers all 9 task-brief mandatory fields', () => {
    const required = [
      'security.authenticationStrategy', 'security.authorizationRules',
      'security.secretsHandling', 'security.owaspMitigations',
      'security.securityHeaders', 'security.inputValidation',
      'security.rateLimitingRules', 'security.auditLogRequirements',
      'security.tenantIsolationGuarantees'
    ];
    for (const r of required) expect(SECURITY_OWNED_FIELD_KEYS).toContain(r);
  });
  it('exposes exactly 9 owned fields', () => {
    expect(SECURITY_OWNED_FIELD_KEYS.length).toBe(9);
  });
  it('every owned section has a non-empty description and is required', () => {
    for (const spec of SECURITY_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });
  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(SecurityArchitectContract)).toEqual([]);
  });
  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(SecurityArchitectContract).sort()).toEqual([...SECURITY_OWNED_FIELD_KEYS].sort());
  });
  it('every owned field has a matching fix-hint entry', () => {
    for (const key of SECURITY_OWNED_FIELD_KEYS) {
      expect(SECURITY_FIELD_FIX_HINTS[key]).toBeDefined();
      expect(SECURITY_FIELD_FIX_HINTS[key].length).toBeGreaterThan(20);
    }
  });
});

describe('SecurityArchitectContract — architectMeta', () => {
  it('declares Backend AND Database as upstream dependencies (wave-2)', () => {
    expect(SECURITY_ARCHITECT_META.dependsOn).toEqual(['backend', 'database']);
  });
  it('precedence level is in [1, 17]', () => {
    expect(SECURITY_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(SECURITY_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });
  it('precedence level is 1 (highest)', () => {
    expect(SECURITY_ARCHITECT_META.precedenceLevel).toBe(1);
  });
  it('fanoutPolicy is `always`', () => {
    expect(SECURITY_ARCHITECT_META.fanoutPolicy).toBe('always');
  });
  it('runtimeModel is `sonnet`', () => {
    expect(SECURITY_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });
  it('appliesPredicate is the exported function reference', () => {
    expect(SECURITY_ARCHITECT_META.appliesPredicate).toBe(securityArchitectAppliesPredicate);
  });
  it('matches canonical precedence ladder for `security`', () => {
    expect(precedenceRank('security')).toBe(SECURITY_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('security');
    expect(CANONICAL_PRECEDENCE_LADDER[0]).toBe('security');
  });
  it('outranks every other architect in the ladder', () => {
    const r = precedenceRank('security');
    for (const other of CANONICAL_PRECEDENCE_LADDER) {
      if (other === 'security') continue;
      expect(r).toBeLessThan(precedenceRank(other));
    }
  });
});

describe('OWASP_TOP_10 constants', () => {
  it('declares exactly 10 keys', () => {
    expect(OWASP_TOP_10_KEYS.length).toBe(10);
  });
  it('keys are unique', () => {
    expect(new Set(OWASP_TOP_10_KEYS).size).toBe(OWASP_TOP_10_KEYS.length);
  });
  it('every key has a matching name (A##:2021 format)', () => {
    for (const k of OWASP_TOP_10_KEYS) {
      expect(OWASP_TOP_10_NAMES[k]).toBeDefined();
      expect(OWASP_TOP_10_NAMES[k]).toMatch(/^A\d{2}:2021/);
    }
  });
  it('keys in canonical A01..A10 order', () => {
    expect(OWASP_TOP_10_KEYS[0]).toBe('a01_brokenAccessControl');
    expect(OWASP_TOP_10_KEYS[9]).toBe('a10_ssrf');
  });
});

describe('securityArchitectAppliesPredicate', () => {
  const base = { id: 't1', type: 'Page' };
  it('returns true for Page', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Page' })).toBe(true); });
  it('returns true for Story', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Story' })).toBe(true); });
  it('returns true for Form', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Form' })).toBe(true); });
  it('returns true for List', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'List' })).toBe(true); });
  it('returns true for Foundation', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Foundation' })).toBe(true); });
  it('returns false for un-tagged Widget', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Widget' })).toBe(false); });
  it('returns true for Widget tagged api', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Widget', quality_tags: ['api'] })).toBe(true); });
  it('returns true for Widget tagged auth', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Widget', quality_tags: ['auth'] })).toBe(true); });
  it('returns true for Widget tagged security', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Widget', quality_tags: ['security'] })).toBe(true); });
  it('returns true for Widget tagged persists', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Widget', quality_tags: ['persists'] })).toBe(true); });
  it('returns false for unrecognised type', () => { expect(securityArchitectAppliesPredicate({ ...base, type: 'Cron' })).toBe(false); });
});

class StubArchitect implements SpecialistArchitect {
  readonly tools: readonly ToolDefinition[] = [];
  constructor(readonly name: string, readonly sectionContract: ArchitectSectionContract) {}
  systemPrompt(): string { return 'stub'; }
  async run(_input: ArchitectInput): Promise<ArchitectOutput> {
    return {
      architectName: this.name, architectureFields: {}, confidence: 0, notes: 'stub',
      dependencies: [], risks: [], toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'none' },
      status: 'failed', failureReason: 'stub'
    };
  }
}

describe('ArchitectRegistry — registration & disjointness', () => {
  let registry: ArchitectRegistry;
  beforeEach(() => { registry = new ArchitectRegistry(); });

  it('registers the Security architect cleanly', () => {
    expect(() => registry.register(new SecurityArchitect())).not.toThrow();
    expect(registry.get('security')).toBeDefined();
  });
  it('claims every owned field path on the registry', () => {
    registry.register(new SecurityArchitect());
    for (const k of SECURITY_OWNED_FIELD_KEYS) expect(registry.ownerOf(k)).toBe('security');
  });
  it('rejects duplicate registration of same name', () => {
    registry.register(new SecurityArchitect());
    expect(() => registry.register(new SecurityArchitect())).toThrowError(ArchitectRegistryError);
  });
  it('rejects a second architect that overlaps owned paths', () => {
    registry.register(new SecurityArchitect());
    const colliding: ArchitectSectionContract = {
      contractId: 'colliding.v1', architectName: 'colliding', version: '0.1.0',
      sections: [{ path: 'security.owaspMitigations', description: 'colliding', required: true }],
      architectMeta: { dependsOn: [], precedenceLevel: 15, fanoutPolicy: 'always', appliesPredicate: () => true, runtimeModel: 'sonnet' }
    };
    expect(() => registry.register(new StubArchitect('colliding', colliding))).toThrowError(ArchitectRegistryError);
  });
  it('accepts a second architect with disjoint owned fields', () => {
    registry.register(new SecurityArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'devops-architect.v1', architectName: 'devops', version: '0.1.0',
      sections: [{ path: 'devops.cicdPipeline', description: 'CI/CD', required: true }],
      architectMeta: { dependsOn: [], precedenceLevel: 2, fanoutPolicy: 'always', appliesPredicate: () => true, runtimeModel: 'sonnet' }
    };
    expect(() => registry.register(new StubArchitect('devops', disjointContract))).not.toThrow();
    expect(registry.size()).toBe(2);
    expect(registry.allPaths().length).toBe(SECURITY_OWNED_FIELD_KEYS.length + 1);
  });
  it('disjointness() returns no conflicts when only Security is present', () => {
    expect(disjointness([SecurityArchitectContract])).toEqual([]);
  });
  it('disjointness() detects conflict between Security and a clone', () => {
    const clone: ArchitectSectionContract = { ...SecurityArchitectContract, contractId: 'security-clone.v1', architectName: 'security-clone' };
    expect(disjointness([SecurityArchitectContract, clone]).length).toBe(SECURITY_OWNED_FIELD_KEYS.length);
  });
  it('Security and Frontend contracts have NO overlapping paths', () => {
    expect(disjointness([SecurityArchitectContract, FrontendArchitectContract])).toEqual([]);
  });
  it('Security owned fields do not collide with Frontend owned fields', () => {
    const fset = new Set(FRONTEND_OWNED_FIELD_KEYS);
    for (const key of SECURITY_OWNED_FIELD_KEYS) expect(fset.has(key)).toBe(false);
  });
  it('Security and Database contracts have NO overlapping paths', () => {
    expect(disjointness([SecurityArchitectContract, DatabaseArchitectContract])).toEqual([]);
  });
  it('Security owned fields do not collide with Database owned fields', () => {
    const dset = new Set(DATABASE_OWNED_FIELD_KEYS);
    for (const key of SECURITY_OWNED_FIELD_KEYS) expect(dset.has(key)).toBe(false);
  });
  it('Security, Frontend, Database three-way disjointness', () => {
    expect(disjointness([SecurityArchitectContract, FrontendArchitectContract, DatabaseArchitectContract])).toEqual([]);
  });
  it('registry.validate() reports missing upstream deps before Backend+Database register', () => {
    registry.register(new SecurityArchitect());
    const errors = registry.validate();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' | ')).toMatch(/backend/);
    expect(errors.join(' | ')).toMatch(/database/);
  });
  it('registry.validate() is empty when Backend + Database are also registered', () => {
    const bk: ArchitectSectionContract = {
      contractId: 'backend-architect.v1', architectName: 'backend', version: '0.1.0',
      sections: [{ path: 'backend.apiEndpoints', description: 'apis', required: true }],
      architectMeta: { dependsOn: [], precedenceLevel: 12, fanoutPolicy: 'always', appliesPredicate: () => true, runtimeModel: 'sonnet' }
    };
    const db: ArchitectSectionContract = {
      contractId: 'database-architect.v1', architectName: 'database', version: '0.1.0',
      sections: [{ path: 'database.tables', description: 'tables', required: true }],
      architectMeta: { dependsOn: ['backend'], precedenceLevel: 11, fanoutPolicy: 'always', appliesPredicate: () => true, runtimeModel: 'sonnet' }
    };
    registry.register(new StubArchitect('backend', bk));
    registry.register(new StubArchitect('database', db));
    registry.register(new SecurityArchitect());
    expect(registry.validate()).toEqual([]);
  });
});
