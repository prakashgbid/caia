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
import { DevopsArchitect } from '../src/architect.js';
import {
  CICD_PROVIDERS,
  CLOUD_PROVIDERS,
  DEPLOY_STRATEGIES,
  DEVOPS_ARCHITECT_META,
  DEVOPS_FIELD_FIX_HINTS,
  DEVOPS_OWNED_SECTIONS,
  DEVOPS_OWNED_FIELD_KEYS,
  DevopsArchitectContract,
  IAC_TOOLS,
  REPO_PROVIDERS,
  STRATEGY_INFRA_REQUIREMENTS,
  devopsArchitectAppliesPredicate
} from '../src/contract.js';
import { FrontendArchitectContract, FRONTEND_OWNED_FIELD_KEYS } from '@caia/frontend-architect';
import { DatabaseArchitectContract, DATABASE_OWNED_FIELD_KEYS } from '@caia/database-architect';
import { SecurityArchitectContract, SECURITY_OWNED_FIELD_KEYS } from '@caia/security-architect';

describe('DevopsArchitectContract - structural', () => {
  it('contractId follows the canonical form', () => {
    expect(DevopsArchitectContract.contractId).toBe('devops-architect.v1');
  });
  it('architectName is `devops`', () => {
    expect(DevopsArchitectContract.architectName).toBe('devops');
  });
  it('version follows semver-ish shape', () => {
    expect(DevopsArchitectContract.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('all owned field paths begin with `devops.`', () => {
    for (const key of DEVOPS_OWNED_FIELD_KEYS) {
      expect(key.startsWith('devops.')).toBe(true);
    }
  });
  it('owned-field set covers all 7 task-brief mandatory fields', () => {
    const required = [
      'devops.cicdPipeline',
      'devops.deployStrategy',
      'devops.rollbackContract',
      'devops.infrastructureAsCode',
      'devops.environmentPromotion',
      'devops.deploymentObservability',
      'devops.secretsManagementInPipeline'
    ];
    for (const r of required) expect(DEVOPS_OWNED_FIELD_KEYS).toContain(r);
  });
  it('exposes exactly 7 owned fields', () => {
    expect(DEVOPS_OWNED_FIELD_KEYS.length).toBe(7);
  });
  it('every owned section has a non-empty description and is required', () => {
    for (const spec of DEVOPS_OWNED_SECTIONS) {
      expect(spec.description.trim().length).toBeGreaterThan(10);
      expect(spec.required).toBe(true);
      expect(spec.path.length).toBeGreaterThan(0);
    }
  });
  it('field keys are globally unique within the contract', () => {
    expect(findDuplicatePaths(DevopsArchitectContract)).toEqual([]);
  });
  it('contractPaths() returns the full owned field set', () => {
    expect(contractPaths(DevopsArchitectContract).sort()).toEqual([...DEVOPS_OWNED_FIELD_KEYS].sort());
  });
  it('every owned field has a matching fix-hint entry', () => {
    for (const key of DEVOPS_OWNED_FIELD_KEYS) {
      expect(DEVOPS_FIELD_FIX_HINTS[key]).toBeDefined();
      expect(DEVOPS_FIELD_FIX_HINTS[key].length).toBeGreaterThan(20);
    }
  });
});

describe('DevopsArchitectContract - architectMeta', () => {
  it('declares Backend, Database, AND Security as upstream dependencies (wave-3)', () => {
    expect(DEVOPS_ARCHITECT_META.dependsOn).toEqual(['backend', 'database', 'security']);
  });
  it('precedence level is in [1, 17]', () => {
    expect(DEVOPS_ARCHITECT_META.precedenceLevel).toBeGreaterThanOrEqual(1);
    expect(DEVOPS_ARCHITECT_META.precedenceLevel).toBeLessThanOrEqual(17);
  });
  it('precedence level is 2 (second-highest, only Security outranks)', () => {
    expect(DEVOPS_ARCHITECT_META.precedenceLevel).toBe(2);
  });
  it('fanoutPolicy is `always`', () => {
    expect(DEVOPS_ARCHITECT_META.fanoutPolicy).toBe('always');
  });
  it('runtimeModel is `sonnet`', () => {
    expect(DEVOPS_ARCHITECT_META.runtimeModel).toBe('sonnet');
  });
  it('appliesPredicate is the exported function reference', () => {
    expect(DEVOPS_ARCHITECT_META.appliesPredicate).toBe(devopsArchitectAppliesPredicate);
  });
  it('matches canonical precedence ladder for `devops`', () => {
    expect(precedenceRank('devops')).toBe(DEVOPS_ARCHITECT_META.precedenceLevel);
    expect(CANONICAL_PRECEDENCE_LADDER).toContain('devops');
    expect(CANONICAL_PRECEDENCE_LADDER[1]).toBe('devops');
  });
  it('only Security outranks DevOps', () => {
    const r = precedenceRank('devops');
    expect(precedenceRank('security')).toBeLessThan(r);
    for (const other of CANONICAL_PRECEDENCE_LADDER) {
      if (other === 'security' || other === 'devops') continue;
      expect(precedenceRank(other)).toBeGreaterThan(r);
    }
  });
});

describe('Onboarding-choice enumerations', () => {
  it('CICD_PROVIDERS includes github-actions as the default', () => {
    expect(CICD_PROVIDERS).toContain('github-actions');
    expect(CICD_PROVIDERS[0]).toBe('github-actions');
  });
  it('CICD_PROVIDERS includes the accepted alternatives', () => {
    for (const p of ['gitlab-ci', 'circleci', 'buildkite', 'azure-pipelines']) {
      expect(CICD_PROVIDERS).toContain(p);
    }
  });
  it('CLOUD_PROVIDERS includes cloudflare as the default', () => {
    expect(CLOUD_PROVIDERS).toContain('cloudflare');
    expect(CLOUD_PROVIDERS[0]).toBe('cloudflare');
  });
  it('CLOUD_PROVIDERS includes major alternatives', () => {
    for (const p of ['aws', 'gcp', 'azure']) {
      expect(CLOUD_PROVIDERS).toContain(p);
    }
  });
  it('IAC_TOOLS includes terraform as the default', () => {
    expect(IAC_TOOLS).toContain('terraform');
    expect(IAC_TOOLS[0]).toBe('terraform');
  });
  it('IAC_TOOLS includes pulumi + kubernetes-manifests', () => {
    expect(IAC_TOOLS).toContain('pulumi');
    expect(IAC_TOOLS).toContain('kubernetes-manifests');
  });
  it('REPO_PROVIDERS includes github as the default', () => {
    expect(REPO_PROVIDERS).toContain('github');
    expect(REPO_PROVIDERS[0]).toBe('github');
  });
  it('DEPLOY_STRATEGIES covers the canonical four + recreate', () => {
    for (const s of ['blue-green', 'canary', 'ring-deployment', 'rolling', 'recreate']) {
      expect(DEPLOY_STRATEGIES).toContain(s);
    }
  });
});

describe('STRATEGY_INFRA_REQUIREMENTS realism map', () => {
  it('blue-green requires two-identical-environments', () => {
    expect(STRATEGY_INFRA_REQUIREMENTS['blue-green']).toContain('two-identical-environments');
  });
  it('canary requires traffic-split capability', () => {
    expect(STRATEGY_INFRA_REQUIREMENTS['canary']).toContain('traffic-split');
  });
  it('ring-deployment requires multi-region', () => {
    expect(STRATEGY_INFRA_REQUIREMENTS['ring-deployment']).toContain('multi-region');
  });
  it('rolling requires multi-instance', () => {
    expect(STRATEGY_INFRA_REQUIREMENTS['rolling']).toContain('multi-instance');
  });
  it('recreate has no special infra requirement', () => {
    expect(STRATEGY_INFRA_REQUIREMENTS['recreate']).toEqual([]);
  });
  it('every deploy strategy has a realism entry', () => {
    for (const s of DEPLOY_STRATEGIES) {
      expect(STRATEGY_INFRA_REQUIREMENTS[s]).toBeDefined();
    }
  });
});

describe('devopsArchitectAppliesPredicate', () => {
  const base = { id: 't1', type: 'Page' };
  it('returns true for Page', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Page' })).toBe(true); });
  it('returns true for Story', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Story' })).toBe(true); });
  it('returns true for Form', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Form' })).toBe(true); });
  it('returns true for List', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'List' })).toBe(true); });
  it('returns true for Foundation', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Foundation' })).toBe(true); });
  it('returns false for un-tagged Widget', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Widget' })).toBe(false); });
  it('returns true for Widget tagged deploy', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Widget', quality_tags: ['deploy'] })).toBe(true); });
  it('returns true for Widget tagged infra', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Widget', quality_tags: ['infra'] })).toBe(true); });
  it('returns true for Widget tagged devops', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Widget', quality_tags: ['devops'] })).toBe(true); });
  it('returns true for Widget tagged persists', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Widget', quality_tags: ['persists'] })).toBe(true); });
  it('returns false for unrecognised type', () => { expect(devopsArchitectAppliesPredicate({ ...base, type: 'Cron' })).toBe(false); });
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

describe('ArchitectRegistry - registration & disjointness', () => {
  let registry: ArchitectRegistry;
  beforeEach(() => { registry = new ArchitectRegistry(); });

  it('registers the Devops architect cleanly', () => {
    expect(() => registry.register(new DevopsArchitect())).not.toThrow();
    expect(registry.get('devops')).toBeDefined();
  });
  it('claims every owned field path on the registry', () => {
    registry.register(new DevopsArchitect());
    for (const k of DEVOPS_OWNED_FIELD_KEYS) expect(registry.ownerOf(k)).toBe('devops');
  });
  it('rejects duplicate registration of same name', () => {
    registry.register(new DevopsArchitect());
    expect(() => registry.register(new DevopsArchitect())).toThrowError(ArchitectRegistryError);
  });
  it('rejects a second architect that overlaps owned paths', () => {
    registry.register(new DevopsArchitect());
    const colliding: ArchitectSectionContract = {
      contractId: 'colliding.v1', architectName: 'colliding', version: '0.1.0',
      sections: [{ path: 'devops.deployStrategy', description: 'colliding', required: true }],
      architectMeta: { dependsOn: [], precedenceLevel: 15, fanoutPolicy: 'always', appliesPredicate: () => true, runtimeModel: 'sonnet' }
    };
    expect(() => registry.register(new StubArchitect('colliding', colliding))).toThrowError(ArchitectRegistryError);
  });
  it('accepts a second architect with disjoint owned fields', () => {
    registry.register(new DevopsArchitect());
    const disjointContract: ArchitectSectionContract = {
      contractId: 'analytics-architect.v1', architectName: 'analytics', version: '0.1.0',
      sections: [{ path: 'analytics.eventTaxonomy', description: 'events', required: true }],
      architectMeta: { dependsOn: [], precedenceLevel: 10, fanoutPolicy: 'always', appliesPredicate: () => true, runtimeModel: 'sonnet' }
    };
    expect(() => registry.register(new StubArchitect('analytics', disjointContract))).not.toThrow();
    expect(registry.size()).toBe(2);
    expect(registry.allPaths().length).toBe(DEVOPS_OWNED_FIELD_KEYS.length + 1);
  });
  it('disjointness() returns no conflicts when only Devops is present', () => {
    expect(disjointness([DevopsArchitectContract])).toEqual([]);
  });
  it('disjointness() detects conflict between Devops and a clone', () => {
    const clone: ArchitectSectionContract = { ...DevopsArchitectContract, contractId: 'devops-clone.v1', architectName: 'devops-clone' };
    expect(disjointness([DevopsArchitectContract, clone]).length).toBe(DEVOPS_OWNED_FIELD_KEYS.length);
  });
  it('Devops and Frontend contracts have NO overlapping paths', () => {
    expect(disjointness([DevopsArchitectContract, FrontendArchitectContract])).toEqual([]);
  });
  it('Devops owned fields do not collide with Frontend owned fields', () => {
    const fset = new Set(FRONTEND_OWNED_FIELD_KEYS);
    for (const key of DEVOPS_OWNED_FIELD_KEYS) expect(fset.has(key)).toBe(false);
  });
  it('Devops and Database contracts have NO overlapping paths', () => {
    expect(disjointness([DevopsArchitectContract, DatabaseArchitectContract])).toEqual([]);
  });
  it('Devops owned fields do not collide with Database owned fields', () => {
    const dset = new Set(DATABASE_OWNED_FIELD_KEYS);
    for (const key of DEVOPS_OWNED_FIELD_KEYS) expect(dset.has(key)).toBe(false);
  });
  it('Devops and Security contracts have NO overlapping paths', () => {
    expect(disjointness([DevopsArchitectContract, SecurityArchitectContract])).toEqual([]);
  });
  it('Devops owned fields do not collide with Security owned fields', () => {
    const sset = new Set(SECURITY_OWNED_FIELD_KEYS);
    for (const key of DEVOPS_OWNED_FIELD_KEYS) expect(sset.has(key)).toBe(false);
  });
  it('four-way disjointness: Devops + Frontend + Database + Security', () => {
    expect(disjointness([
      DevopsArchitectContract, FrontendArchitectContract,
      DatabaseArchitectContract, SecurityArchitectContract
    ])).toEqual([]);
  });
  it('registry.validate() reports missing upstream deps before Backend+Database+Security register', () => {
    registry.register(new DevopsArchitect());
    const errors = registry.validate();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' | ')).toMatch(/backend/);
    expect(errors.join(' | ')).toMatch(/database/);
    expect(errors.join(' | ')).toMatch(/security/);
  });
  it('registry.validate() is empty when Backend+Database+Security are also registered', () => {
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
    const sec: ArchitectSectionContract = {
      contractId: 'security-architect.v1', architectName: 'security', version: '0.1.0',
      sections: [{ path: 'security.owaspMitigations', description: 'owasp', required: true }],
      architectMeta: { dependsOn: ['backend', 'database'], precedenceLevel: 1, fanoutPolicy: 'always', appliesPredicate: () => true, runtimeModel: 'sonnet' }
    };
    registry.register(new StubArchitect('backend', bk));
    registry.register(new StubArchitect('database', db));
    registry.register(new StubArchitect('security', sec));
    registry.register(new DevopsArchitect());
    expect(registry.validate()).toEqual([]);
  });
});
