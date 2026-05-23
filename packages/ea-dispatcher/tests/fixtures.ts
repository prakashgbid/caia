/**
 * Shared dispatcher test fixtures.
 */

import { BaseArchitect } from '@caia/architect-kit';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  Ticket,
  BusinessPlan,
  RenderableDesign,
  TenantContext,
  SpecialistArchitect,
  FanoutPolicy,
} from '@caia/architect-kit';
import type { DispatchInput } from '../src/types.js';

export function makeContract(
  name: string,
  paths: readonly string[],
  meta: {
    dependsOn?: readonly string[];
    precedenceLevel?: number;
    fanoutPolicy?: FanoutPolicy;
    appliesPredicate?: (ticket: Ticket) => boolean;
    runtimeModel?: 'haiku' | 'sonnet' | 'opus';
  } = {},
): ArchitectSectionContract {
  return {
    contractId: `${name}-architect.v1`,
    architectName: name,
    version: '0.1.0',
    sections: paths.map((p) => ({ path: p, description: `${p}`, required: true })),
    architectMeta: {
      dependsOn: meta.dependsOn ?? [],
      precedenceLevel: meta.precedenceLevel ?? 99,
      fanoutPolicy: meta.fanoutPolicy ?? 'always',
      appliesPredicate: meta.appliesPredicate ?? (() => true),
      runtimeModel: meta.runtimeModel ?? 'sonnet',
    },
  };
}

/**
 * A configurable mock architect — pick which fields to populate, how long
 * to "take", whether to fail. Tests construct one per scenario.
 */
export class MockArchitect extends BaseArchitect implements SpecialistArchitect {
  constructor(
    readonly name: string,
    readonly sectionContract: ArchitectSectionContract,
    private opts: {
      output?: 'ok' | 'partial' | 'failed' | 'missing-required';
      fields?: Record<string, unknown>;
      latencyMs?: number;
      confidence?: number;
      throws?: boolean;
      onRun?: (input: ArchitectInput) => void;
    } = {},
  ) {
    super();
  }

  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    this.opts.onRun?.(input);
    if (this.opts.throws) throw new Error(`mock ${this.name} threw`);
    if (this.opts.latencyMs && this.opts.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    }
    const mode = this.opts.output ?? 'ok';
    const fields =
      this.opts.fields ??
      Object.fromEntries(
        this.sectionContract.sections.map((s) => [s.path, `val-${s.path}`]),
      );
    const confidence = this.opts.confidence ?? 0.85;

    switch (mode) {
      case 'ok':
        return this.okOutput(fields, { confidence, spend: this.zeroSpend('mock') });
      case 'partial':
        return this.partialOutput(fields, { confidence, spend: this.zeroSpend('mock') });
      case 'failed':
        return this.failedOutput('mock-fail-by-config');
      case 'missing-required': {
        // Strip one required path.
        const requiredPaths = this.sectionContract.sections
          .filter((s) => s.required)
          .map((s) => s.path);
        if (requiredPaths.length > 0) {
          const stripped = { ...fields };
          delete stripped[requiredPaths[0]!];
          return this.okOutput(stripped, { confidence, spend: this.zeroSpend('mock') });
        }
        return this.okOutput(fields, { confidence });
      }
    }
  }
}

export function stubTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't-1',
    type: 'Page',
    scope: 'story',
    parent_id: null,
    acceptance_criteria: ['user opens the page', 'page renders in <2s'],
    quality_tags: ['seo', 'accessibility', 'performance'],
    ...overrides,
  };
}

export function stubBusinessPlan(): BusinessPlan {
  return {
    ventureName: 'Acme Co',
    oneLiner: 'better widgets',
    audience: 'SMB owners',
    goals: ['10k mrr', '5% conv'],
  };
}

export function stubDesignVersion(): RenderableDesign {
  return { versionId: 'd-1', anchors: [{ anchorId: 'hero', kind: 'section' }] };
}

export function stubTenant(): TenantContext {
  return {
    tenantId: 'tnt-1',
    schemaName: 's1',
    vaultNamespace: 'caia/acme',
    billingPosture: 'subscription',
    creditBalance: { usdAvailable: 100 },
  };
}

export function stubDispatch(overrides: Partial<DispatchInput> = {}): DispatchInput {
  return {
    ticket: stubTicket(),
    businessPlan: stubBusinessPlan(),
    designVersion: stubDesignVersion(),
    tenantContext: stubTenant(),
    iteration: 1,
    ...overrides,
  };
}

// ─── A 3-architect tri-wave fixture used in the integration test ──────────

export function threeArchitectSet(): readonly MockArchitect[] {
  const frontend = new MockArchitect(
    'frontend',
    makeContract('frontend', ['frontend.framework', 'frontend.tokens'], {
      precedenceLevel: 14,
    }),
    { confidence: 0.9 },
  );
  const a11y = new MockArchitect(
    'a11y',
    makeContract('a11y', ['a11y.wcagLevel'], {
      dependsOn: ['frontend'],
      precedenceLevel: 3,
    }),
    { confidence: 0.85 },
  );
  const performance = new MockArchitect(
    'performance',
    makeContract('performance', ['performance.lighthouseTargets'], {
      dependsOn: ['frontend'],
      precedenceLevel: 5,
    }),
    { confidence: 0.8 },
  );
  return [frontend, a11y, performance];
}

// ─── Full 17-architect mock set ────────────────────────────────────────────

export function seventeenArchitectSet(): readonly MockArchitect[] {
  const specs: Array<{
    name: string;
    paths: readonly string[];
    deps?: readonly string[];
    prec: number;
  }> = [
    { name: 'frontend', paths: ['frontend.framework', 'frontend.tokens'], prec: 14 },
    { name: 'backend', paths: ['backend.framework', 'backend.endpointEnumeration'], prec: 12 },
    { name: 'seo', paths: ['seo.title', 'seo.jsonLd'], prec: 4 },
    { name: 'featureFlagging', paths: ['featureFlags.flagStore', 'featureFlags.killSwitch'], prec: 7 },
    { name: 'timeMachine', paths: ['timeMachine.snapshotKey'], prec: 15 },
    { name: 'uxVersionControl', paths: ['uxVersionControl.uploadVersionId'], prec: 16 },
    { name: 'database', paths: ['database.engine', 'database.schemaDDL'], deps: ['backend'], prec: 11 },
    { name: 'a11y', paths: ['a11y.wcagLevel', 'a11y.keyboardSpec'], deps: ['frontend'], prec: 3 },
    { name: 'performance', paths: ['performance.lighthouseTargets'], deps: ['frontend'], prec: 5 },
    { name: 'analytics', paths: ['analytics.provider', 'analytics.eventTaxonomy'], deps: ['frontend'], prec: 10 },
    { name: 'aiml', paths: ['aiml.model'], deps: ['backend'], prec: 13 },
    { name: 'observability', paths: ['observability.logShape', 'observability.metricsExport'], deps: ['backend', 'frontend'], prec: 9 },
    { name: 'security', paths: ['security.authnFlow', 'security.cspPolicy'], deps: ['backend', 'database'], prec: 1 },
    { name: 'apiGateway', paths: ['apiGateway.rateLimit', 'apiGateway.errorEnvelope'], deps: ['backend', 'security'], prec: 8 },
    { name: 'testing', paths: ['testing.strategy', 'testing.fixtures'], deps: ['frontend', 'backend'], prec: 17 },
    { name: 'devops', paths: ['devops.ciPipeline', 'devops.deployStrategy'], deps: ['backend', 'database'], prec: 2 },
    { name: 'abTesting', paths: ['abTesting.variantRouter'], deps: ['analytics', 'featureFlagging'], prec: 6 },
  ];
  return specs.map(
    (s) =>
      new MockArchitect(
        s.name,
        makeContract(s.name, s.paths, {
          ...(s.deps ? { dependsOn: s.deps } : {}),
          precedenceLevel: s.prec,
        }),
      ),
  );
}
