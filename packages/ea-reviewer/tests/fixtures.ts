/**
 * Reviewer test fixtures — composed architectures + audit rows.
 */
import type { ArchitectSectionContract, Ticket } from '@caia/architect-kit';
import type { ArchitectAuditRow, ReviewerInput } from '../src/types.js';

export function makeContract(
  name: string,
  paths: readonly string[],
): ArchitectSectionContract {
  return {
    contractId: `${name}-architect.v1`,
    architectName: name,
    version: '0.1.0',
    sections: paths.map((p) => ({ path: p, description: p, required: true })),
    architectMeta: {
      dependsOn: [],
      precedenceLevel: 99,
      fanoutPolicy: 'always',
      appliesPredicate: () => true,
      runtimeModel: 'sonnet',
    },
  };
}

export function audit(
  name: string,
  overrides: Partial<ArchitectAuditRow> = {},
): ArchitectAuditRow {
  return {
    architectName: name,
    status: 'ok',
    confidence: 0.9,
    notes: '',
    risks: [],
    ...overrides,
  };
}

export function stubTicket(): Ticket {
  return {
    id: 't-1',
    type: 'Page',
    acceptance_criteria: ['user can sign up via form'],
  };
}

/**
 * A fully clean composed architecture — every invariant holds, every
 * required path populated. The completeness lens and consistency lens
 * should both pass.
 */
export function cleanComposedArchitecture(): Record<string, unknown> {
  return {
    'frontend.framework': 'next',
    'frontend.componentTree': [
      { id: 'btn-1', interactive: true },
    ],
    'frontend.tokens': { colors: {} },
    'backend.framework': 'express',
    'backend.endpointEnumeration': [{ path: '/api/signup' }],
    'database.engine': 'postgres',
    'database.schemaDDL': 'CREATE TABLE users (...);',
    'a11y.wcagLevel': 'AA',
    'a11y.keyboardSpec': [{ componentId: 'btn-1' }],
    'performance.lighthouseTargets': { perf: 95, a11y: 100 },
    'analytics.eventTaxonomy': [{ name: 'signup' }],
    'analytics.consentMode': 'deny-by-default',
    'observability.logShape': { format: 'json' },
    'observability.metricsExport': [{ event: 'signup' }],
    'security.cspPolicy': { frameSrc: "'self'" },
    'security.dataClassification': 'public',
    'apiGateway.rateLimit': [{ path: '/api/signup', perMinute: 60 }],
    'featureFlags.flagStore': [{ name: 'newSignup' }],
    'featureFlags.killSwitch': [{ name: 'newSignup' }],
    'abTesting.variantRouter': [{ flag: 'newSignup' }],
    'devops.deployStrategy': 'canary',
    'timeMachine.revertCommand': 'git revert HEAD',
    'testing.fixtures': [{ path: '/api/signup' }],
    'seo.canonical': 'https://example.com/signup',
  };
}

export function cleanContracts(): readonly ArchitectSectionContract[] {
  return [
    makeContract('frontend', ['frontend.framework', 'frontend.componentTree', 'frontend.tokens']),
    makeContract('backend', ['backend.framework', 'backend.endpointEnumeration']),
    makeContract('database', ['database.engine', 'database.schemaDDL']),
    makeContract('a11y', ['a11y.wcagLevel', 'a11y.keyboardSpec']),
    makeContract('performance', ['performance.lighthouseTargets']),
    makeContract('analytics', ['analytics.eventTaxonomy', 'analytics.consentMode']),
    makeContract('observability', ['observability.logShape', 'observability.metricsExport']),
    makeContract('security', ['security.cspPolicy', 'security.dataClassification']),
    makeContract('apiGateway', ['apiGateway.rateLimit']),
    makeContract('featureFlagging', ['featureFlags.flagStore', 'featureFlags.killSwitch']),
    makeContract('abTesting', ['abTesting.variantRouter']),
    makeContract('devops', ['devops.deployStrategy']),
    makeContract('timeMachine', ['timeMachine.revertCommand']),
    makeContract('testing', ['testing.fixtures']),
    makeContract('seo', ['seo.canonical']),
  ];
}

export function cleanAudit(): readonly ArchitectAuditRow[] {
  return cleanContracts().map((c) => audit(c.architectName));
}

export function cleanReviewerInput(): ReviewerInput {
  const ac = stubTicket().acceptance_criteria;
  return {
    ticket: stubTicket(),
    composedArchitecture: cleanComposedArchitecture(),
    auditRows: cleanAudit(),
    contracts: cleanContracts(),
    ...(ac ? { acceptanceCriteria: ac } : {}),
  };
}
