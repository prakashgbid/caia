/**
 * Shared test fixtures for @caia/architect-kit.
 *
 * Builds the 17-architect contract set per spec §2 + a minimal
 * SpecialistArchitect harness for tests that need polymorphic behavior.
 */

import { BaseArchitect } from '../src/base-architect.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  Ticket,
  BusinessPlan,
  RenderableDesign,
  TenantContext,
} from '../src/types.js';
import type {
  ArchitectSectionContract,
  ArchitectMeta,
  FanoutPolicy,
} from '../src/architect-section-contract.js';

export function stubTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't-1',
    type: 'Page',
    scope: 'story',
    parent_id: null,
    architecture: {},
    acceptance_criteria: ['user can view homepage', 'page loads in <2s'],
    business_requirements: { goal: 'capture leads' },
    quality_tags: ['seo', 'accessibility'],
    ...overrides,
  };
}

export function stubBusinessPlan(): BusinessPlan {
  return {
    ventureName: 'Acme Co',
    oneLiner: 'better mousetraps',
    audience: 'small business owners',
    goals: ['10k visitors/month', '5% conversion'],
    brandVoice: 'friendly-expert',
  };
}

export function stubDesignVersion(): RenderableDesign {
  return {
    versionId: 'design-v1',
    anchors: [
      { anchorId: 'hero', kind: 'section' },
      { anchorId: 'cta', kind: 'button' },
    ],
  };
}

export function stubTenantContext(): TenantContext {
  return {
    tenantId: 'tnt-1',
    schemaName: 'tenant_acme',
    vaultNamespace: 'caia/acme',
    billingPosture: 'subscription',
    creditBalance: { usdAvailable: 100 },
  };
}

export function stubInput(overrides: Partial<ArchitectInput> = {}): ArchitectInput {
  return {
    ticket: stubTicket(),
    upstream: { outputs: {} },
    businessPlan: stubBusinessPlan(),
    designVersion: stubDesignVersion(),
    tenantContext: stubTenantContext(),
    budget: {
      maxInputTokens: 60_000,
      maxOutputTokens: 8_000,
      maxWallClockMs: 60_000,
      preferredModel: 'sonnet',
      hardCostCeilingUsd: 1,
    },
    ...overrides,
  };
}

// ─── Synthetic architects for tests ──────────────────────────────────────

export function makeMeta(opts: Partial<ArchitectMeta> & { dependsOn?: readonly string[] } = {}): ArchitectMeta {
  return {
    dependsOn: opts.dependsOn ?? [],
    precedenceLevel: opts.precedenceLevel ?? 99,
    fanoutPolicy: (opts.fanoutPolicy as FanoutPolicy) ?? 'always',
    appliesPredicate: opts.appliesPredicate ?? (() => true),
    runtimeModel: opts.runtimeModel ?? 'sonnet',
  };
}

export function makeContract(
  name: string,
  paths: readonly string[],
  meta: Partial<ArchitectMeta> = {},
): ArchitectSectionContract {
  return {
    contractId: `${name}-architect.v1`,
    architectName: name,
    version: '0.1.0',
    sections: paths.map((p) => ({ path: p, description: `path ${p}`, required: true })),
    architectMeta: makeMeta(meta),
  };
}

export class StubArchitect extends BaseArchitect {
  constructor(
    readonly name: string,
    readonly sectionContract: ArchitectSectionContract,
    private readonly impl?: (input: ArchitectInput) => Promise<ArchitectOutput>,
  ) {
    super();
  }

  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    if (this.impl) return this.impl(input);
    // Default: return ok with empty fields for declared paths.
    const fields: Record<string, unknown> = {};
    for (const s of this.sectionContract.sections) {
      fields[s.path] = `placeholder-for-${s.path}`;
    }
    return this.okOutput(fields, {
      confidence: 0.8,
      spend: this.zeroSpend(`${this.name}-stub`),
    });
  }
}

// ─── The canonical 17-architect dependency graph (spec §2) ───────────────

export function canonicalContractSet(): readonly ArchitectSectionContract[] {
  return [
    // Wave 1 — no architect deps
    makeContract('frontend', ['frontend.framework', 'frontend.componentTree', 'frontend.tokens'], {
      precedenceLevel: 14,
    }),
    makeContract('backend', ['backend.framework', 'backend.endpointEnumeration'], {
      precedenceLevel: 12,
    }),
    makeContract('seo', ['seo.title', 'seo.jsonLd', 'seo.canonical'], { precedenceLevel: 4 }),
    makeContract('featureFlagging', ['featureFlags.flagStore', 'featureFlags.killSwitch'], {
      precedenceLevel: 7,
    }),
    makeContract('timeMachine', ['timeMachine.snapshotKey', 'timeMachine.revertCommand'], {
      precedenceLevel: 15,
    }),
    makeContract('uxVersionControl', ['uxVersionControl.uploadVersionId', 'uxVersionControl.diffSummary'], {
      precedenceLevel: 16,
    }),
    // Wave 2 — depends on wave 1
    makeContract('database', ['database.engine', 'database.schemaDDL'], {
      dependsOn: ['backend'],
      precedenceLevel: 11,
    }),
    makeContract('a11y', ['a11y.wcagLevel', 'a11y.keyboardSpec'], {
      dependsOn: ['frontend'],
      precedenceLevel: 3,
    }),
    makeContract('performance', ['performance.lighthouseTargets', 'performance.bundleBudget'], {
      dependsOn: ['frontend'],
      precedenceLevel: 5,
    }),
    makeContract('analytics', ['analytics.provider', 'analytics.eventTaxonomy'], {
      dependsOn: ['frontend'],
      precedenceLevel: 10,
    }),
    makeContract('aiml', ['aiml.model', 'aiml.evalSuite'], {
      dependsOn: ['backend'],
      precedenceLevel: 13,
    }),
    makeContract('observability', ['observability.logShape', 'observability.metricsExport'], {
      dependsOn: ['backend', 'frontend'],
      precedenceLevel: 9,
    }),
    makeContract('security', ['security.authnFlow', 'security.cspPolicy'], {
      dependsOn: ['backend', 'database'],
      precedenceLevel: 1,
    }),
    makeContract('apiGateway', ['apiGateway.rateLimit', 'apiGateway.errorEnvelope'], {
      dependsOn: ['backend', 'security'],
      precedenceLevel: 8,
    }),
    makeContract('testing', ['testing.strategy', 'testing.pyramidRatios'], {
      dependsOn: ['frontend', 'backend'],
      precedenceLevel: 17,
    }),
    makeContract('devops', ['devops.ciPipeline', 'devops.deployStrategy'], {
      dependsOn: ['backend', 'database'],
      precedenceLevel: 2,
    }),
    // Wave 3 — depends on wave 2
    makeContract('abTesting', ['abTesting.variantRouter', 'abTesting.allocation'], {
      dependsOn: ['analytics', 'featureFlagging'],
      precedenceLevel: 6,
    }),
  ];
}

export function canonicalArchitectSet(): readonly StubArchitect[] {
  return canonicalContractSet().map((c) => new StubArchitect(c.architectName, c));
}
