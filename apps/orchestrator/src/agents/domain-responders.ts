/**
 * Rule-based domain responders — synthesise per-agent ticket-template
 * sections for domains that don't yet have a full async runtime.
 *
 * Each responder takes a story summary + the classifier output and returns
 * the corresponding `agentSections.*` payload (sans `contributedBy` /
 * `contributedAt`, which the BA agent stamps when it merges).
 *
 * When a real LLM-backed domain agent comes online it can subscribe to
 * `ba-agent.input-requested` and reply via `replyToRequest()` — this module
 * is the deterministic fallback so every ticket is enriched even when the
 * model-backed paths are unavailable.
 */

import type {
  TicketTemplateV1,
  AgentSectionKey,
} from '@chiefaia/ticket-template';

export interface ResponderInput {
  title: string;
  description: string;
  primaryDomain: string;
  layer: string;
  complexity: string;
  nature: string;
  acceptanceCriteria: string[];
}

type AgentSections = TicketTemplateV1['agentSections'];

// Type helper: section payload without the audit fields the caller adds.
type Section<K extends AgentSectionKey> = Omit<
  NonNullable<AgentSections[K]>,
  'contributedBy' | 'contributedAt'
>;

// ─── Responders ──────────────────────────────────────────────────────────────

export function architectureResponder(input: ResponderInput): Section<'architecture'> {
  const constraints: string[] = [];
  if (input.primaryDomain === 'auth') {
    constraints.push('Use stateless tokens (JWT) — no server-side session table');
    constraints.push('Auth endpoints must be rate-limited (≤5 req/min/IP)');
  }
  if (input.primaryDomain === 'data-storage') {
    constraints.push('All migrations must ship reversible (or with explicit down-migration)');
  }
  if (input.complexity === 'high') {
    constraints.push('Surface a design doc before implementation begins');
  }
  return {
    adrReferences: [],
    constraints,
    notes: `Architecture defaults for primaryDomain=${input.primaryDomain}, complexity=${input.complexity}.`,
  };
}

export function databaseResponder(input: ResponderInput): Section<'database'> {
  const lower = `${input.title} ${input.description}`.toLowerCase();
  const touchesSchema =
    input.primaryDomain === 'data-storage' ||
    lower.includes('schema') ||
    lower.includes('migration') ||
    lower.includes('table') ||
    lower.includes('column');
  return {
    schemaChanges: touchesSchema
      ? [`Schema impact expected for ${input.title}; design migration before coding.`]
      : [],
    reversibility: 'reversible',
    indexImpact: touchesSchema
      ? 'Verify new columns are covered by appropriate indexes; check query plans before merge.'
      : 'No expected schema or index impact.',
  };
}

export function apiResponder(input: ResponderInput): Section<'api'> {
  const lower = `${input.title} ${input.description}`.toLowerCase();
  const exposesApi =
    input.primaryDomain === 'api-integration' ||
    lower.includes('api') ||
    lower.includes('endpoint') ||
    lower.includes('route');
  return {
    routes: exposesApi
      ? [
          {
            method: 'POST',
            path: '/TBD',
            requestSchema: 'TBD',
            responseSchema: 'TBD',
          },
        ]
      : [],
    errorContract: exposesApi
      ? '400 InvalidInput; 401 Unauthorized; 404 NotFound; 500 InternalError'
      : '',
  };
}

export function uiResponder(input: ResponderInput): Section<'ui'> {
  const lower = `${input.title} ${input.description}`.toLowerCase();
  const isUi =
    input.primaryDomain === 'ui-frontend' ||
    lower.includes('component') ||
    lower.includes('page') ||
    lower.includes('form') ||
    lower.includes('dashboard');
  return {
    components: isUi ? ['TBD'] : [],
    designSystemPattern: isUi
      ? 'Match dashboard dark-theme tokens; use existing primitives over bespoke styles.'
      : '',
    accessibilityRequirements: isUi
      ? [
          'WCAG 2.1 AA: visible focus indicators on all interactive elements',
          'Forms reachable via keyboard with appropriate aria-labels',
          'Live regions announce loading and error states',
        ]
      : [],
  };
}

export function securityResponder(input: ResponderInput): Section<'security'> {
  const isSecurity =
    input.primaryDomain === 'auth' ||
    input.nature === 'security' ||
    `${input.title} ${input.description}`.toLowerCase().includes('security');
  return {
    threatModel: isSecurity
      ? [
          'CSRF: mitigated by same-site cookies + state parameter on OAuth flows',
          'Replay attacks: nonce/timestamp validation on token use',
        ]
      : [],
    requiredHeaders: isSecurity
      ? ['X-Content-Type-Options: nosniff', 'Strict-Transport-Security: max-age=31536000']
      : [],
    authzNotes: isSecurity
      ? 'All auth-bearing endpoints rate-limited; no token sharing across users.'
      : 'No security-sensitive surface introduced by this story.',
  };
}

export function testingResponder(input: ResponderInput): Section<'testing'> {
  const baseSlug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return {
    unitTestPaths: [`tests/unit/${baseSlug || 'story'}.test.ts`],
    integrationTestPaths: [`tests/integration/${baseSlug || 'story'}.spec.ts`],
    coverageTarget: input.complexity === 'high' ? 0.9 : 0.8,
  };
}

export function releaseResponder(input: ResponderInput): Section<'release'> {
  const featureFlag =
    input.complexity === 'high' || input.nature === 'feature'
      ? `flag_${input.primaryDomain.replace(/-/g, '_')}_${(input.title || 'feature')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .slice(0, 32)}`
      : undefined;
  return {
    featureFlag,
    rolloutPlan: featureFlag
      ? '10% → 25% → 100% gradual rollout while monitoring error rate and latency.'
      : 'Standard direct rollout — change is low-risk.',
    rollbackPlan: featureFlag
      ? 'Disable feature flag immediately; recovery requires no migration rollback.'
      : 'Revert merge commit; rerun CI.',
  };
}

export function observabilityResponder(_input: ResponderInput): Section<'observability'> {
  return {
    metrics: [],
    traces: [],
    logs: ['Structured logs via @chiefaia/logger child({ agent: <name> })'],
    alertRules: [],
  };
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const DOMAIN_RESPONDERS = {
  'ea-agent': { sectionKey: 'architecture', responder: architectureResponder },
  'dba-agent': { sectionKey: 'database', responder: databaseResponder },
  'bff-agent': { sectionKey: 'api', responder: apiResponder },
  'ui-agent': { sectionKey: 'ui', responder: uiResponder },
  'security-agent': { sectionKey: 'security', responder: securityResponder },
  'testing-agent': { sectionKey: 'testing', responder: testingResponder },
  'release-agent': { sectionKey: 'release', responder: releaseResponder },
  'observability-agent': { sectionKey: 'observability', responder: observabilityResponder },
} as const satisfies Record<
  string,
  {
    sectionKey: AgentSectionKey;
    responder: (input: ResponderInput) => Section<AgentSectionKey>;
  }
>;

export type DomainResponderName = keyof typeof DOMAIN_RESPONDERS;

/**
 * Default set of consultants the BA agent reaches out to. The BA can override
 * this per-prompt based on classifier output (e.g. drop `bff-agent` for a
 * pure UI story).
 */
export const DEFAULT_BA_CONSULTANTS: DomainResponderName[] = [
  'ea-agent',
  'dba-agent',
  'bff-agent',
  'ui-agent',
  'security-agent',
  'testing-agent',
  'release-agent',
  'observability-agent',
];

/**
 * Pick a domain-relevant consultant subset based on the classifier's
 * primaryDomain. Conservative — when in doubt, keep the consultant in.
 */
export function selectConsultants(primaryDomain: string): DomainResponderName[] {
  // Always include cross-cutting consultants.
  const always: DomainResponderName[] = [
    'ea-agent',
    'security-agent',
    'testing-agent',
    'release-agent',
    'observability-agent',
  ];
  const domainSpecific: Record<string, DomainResponderName[]> = {
    'ui-frontend': ['ui-agent'],
    'api-integration': ['bff-agent'],
    'data-storage': ['dba-agent'],
    auth: ['bff-agent', 'dba-agent'],
  };
  const extra = domainSpecific[primaryDomain] ?? [];
  return [...new Set([...always, ...extra])];
}
