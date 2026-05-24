/**
 * Test fixtures + fake spawner factory for the Testing Architect.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { TESTING_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

function buildFrontendUpstreamFields(): Record<string, unknown> {
  return {
    'frontend.componentTree': [
      {
        id: 'contact-form',
        kind: 'form',
        children: [
          { id: 'contact-name', kind: 'Input' },
          { id: 'contact-email', kind: 'Input' },
          { id: 'contact-message', kind: 'Textarea' },
          { id: 'contact-submit', kind: 'Button' }
        ]
      }
    ],
    'frontend.interactionStates': {
      'contact-name': { hover: 'n/a', focus: 'visible ring', active: 'n/a', error: 'red border + error text', empty: 'placeholder shown', loading: 'n/a', disabled: '50% opacity' },
      'contact-email': { hover: 'n/a', focus: 'visible ring', active: 'n/a', error: 'red border + error text', empty: 'placeholder shown', loading: 'n/a', disabled: '50% opacity' },
      'contact-message': { hover: 'n/a', focus: 'visible ring', active: 'n/a', error: 'red border + error text', empty: 'placeholder shown', loading: 'n/a', disabled: '50% opacity' },
      'contact-submit': { hover: 'darker fill', focus: 'visible ring', active: 'inset shadow', error: 'n/a', empty: 'n/a', loading: 'inline spinner', disabled: '50% opacity' }
    },
    'frontend.routeConfig': {
      segment: 'app/contact',
      layoutSegment: 'app',
      loadingBoundary: true,
      errorBoundary: true,
      dynamicSegments: []
    }
  };
}

function buildBackendUpstreamFields(): Record<string, unknown> {
  return {
    'backend.apiEndpoints': [
      {
        method: 'POST',
        path: '/v1/contacts',
        op: 'createContact',
        requestSchemaRef: 'ContactCreate',
        responseSchemaRef: 'Contact',
        persistsTo: ['contacts']
      }
    ],
    'backend.errorEnvelope': {
      schema: { error: { code: 'string', message: 'string', requestId: 'string' } },
      mapping: { ValidationError: { httpStatus: 400, code: 'INVALID_BODY' } }
    }
  };
}

function buildDatabaseUpstreamFields(): Record<string, unknown> {
  return {
    'database.schemaDDL':
      "CREATE TABLE contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, name text NOT NULL, email text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());",
    'database.rlsPolicies': [
      { table: 'contacts', policy: 'tenant_isolation', check: "tenant_id = current_setting('app.tenant_id')" }
    ]
  };
}

export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-test-001',
      type: 'Story',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'Submitting valid contact data writes a row to the contacts table.',
        'Submitting invalid email shows the field-level error message.',
        'Submit button is disabled while the request is in-flight.',
        'After successful submission, the form clears and shows a success toast.'
      ],
      business_requirements: {
        title: 'Contact form story',
        description:
          'End-to-end contact-form story spanning the frontend form widget, the POST /v1/contacts API, and the contacts table.'
      },
      quality_tags: ['ui', 'api', 'persists']
    },
    upstream: {
      outputs: {
        frontend: {
          architectName: 'frontend',
          architectureFields: buildFrontendUpstreamFields(),
          confidence: 0.9,
          notes: 'Frontend fixture.',
          dependencies: [],
          risks: [],
          toolCalls: [],
          spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
          status: 'ok'
        },
        backend: {
          architectName: 'backend',
          architectureFields: buildBackendUpstreamFields(),
          confidence: 0.9,
          notes: 'Backend fixture.',
          dependencies: [],
          risks: [],
          toolCalls: [],
          spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
          status: 'ok'
        },
        database: {
          architectName: 'database',
          architectureFields: buildDatabaseUpstreamFields(),
          confidence: 0.9,
          notes: 'Database fixture.',
          dependencies: ['backend'],
          risks: [],
          toolCalls: [],
          spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
          status: 'ok'
        }
      }
    },
    businessPlan: {
      ventureName: 'Prakash Tiwari Studio',
      oneLiner: 'Bespoke artist session booking for the Prakash Tiwari portrait studio.',
      audience: "High-intent prospective sitters in the artist's metropolitan area.",
      goals: ['Drive contact-form submissions'],
      brandVoice: 'warm + grounded',
      constraints: []
    },
    designVersion: {
      versionId: 'design-pt-v3-2026-05-22',
      snapshotUri: 's3://atlas/designs/design-pt-v3-2026-05-22.png',
      anchors: [],
      tokens: {},
      breakpoints: ['sm', 'md', 'lg', 'xl']
    },
    tenantContext: {
      tenantId: 'tenant-prakash-tiwari',
      schemaName: 'pt_001',
      vaultNamespace: 'tenant/prakash-tiwari',
      billingPosture: 'subscription',
      creditBalance: { usdAvailable: 25 }
    },
    budget: {
      maxInputTokens: 60_000,
      maxOutputTokens: 8_000,
      maxWallClockMs: 60_000,
      preferredModel: 'sonnet',
      hardCostCeilingUsd: 0.5
    }
  };
}

export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'testing',
    architectureFields: {
      'testing.testingStrategy': {
        pyramidShape: 'broad-base',
        rationale:
          'Form story: heavy unit on input-validators, moderate integration on the POST /v1/contacts handler, light e2e covering submit-happy-path and one failure-path.',
        riskAreas: [
          'contact-email validation regex drift',
          'contact-submit double-submit race',
          'contact-form RLS-tenant-leakage in the contacts table'
        ],
        owner: 'test-author-agent',
        reviewer: 'test-reviewer-agent'
      },
      'testing.testTypeMixPercentages': {
        Story: { unit: 60, integration: 20, e2e: 10, visual: 5, a11y: 3, perf: 2 },
        Page: { unit: 50, integration: 20, e2e: 15, visual: 7, a11y: 5, perf: 3 },
        Form: { unit: 65, integration: 18, e2e: 8, visual: 4, a11y: 3, perf: 2 },
        Widget: { unit: 62, integration: 20, e2e: 8, visual: 5, a11y: 3, perf: 2 },
        List: { unit: 58, integration: 22, e2e: 10, visual: 4, a11y: 4, perf: 2 }
      },
      'testing.fixturesStrategy': {
        goldenDatasets: [{ id: 'contacts-baseline', scope: 'tenant', refreshPolicy: 'per-release' }],
        factories: [{ kind: 'Contact', library: 'fishery', scope: 'per-test' }],
        seedingDiscipline: 'per-test',
        determinism: { clockMock: true, idGenerator: 'uuid-v7-fixed-seed', rngSeed: 42 }
      },
      'testing.mutationTestingThresholds': {
        tool: 'stryker',
        killScoreFloor: 60,
        perScope: { 'validators/*': 75, 'handlers/*': 55, 'adapters/*': 50 },
        escalation: 'warn'
      },
      'testing.perfRegressionBudgets': {
        tool: 'lighthouse',
        lighthouseDeltaPct: 5,
        k6Thresholds: { p95LatencyMs: 1000, errorRatePct: 1.0 },
        regressionAction: 'open-issue'
      },
      'testing.e2ePatterns': {
        runner: 'playwright',
        playwrightVersion: '1.59.x',
        pageObjects: true,
        fixtureScope: 'test',
        remoteBrowserless: true,
        retries: { ci: 2, local: 0 },
        parallelism: { ci: 1, local: 3 },
        traceOnFailure: true
      },
      'testing.coverageThresholds': {
        perTicketType: {
          Story: { lines: 80, branches: 75, functions: 80, statements: 80 },
          Page: { lines: 85, branches: 80, functions: 85, statements: 85 },
          Form: { lines: 82, branches: 78, functions: 82, statements: 82 },
          Widget: { lines: 80, branches: 75, functions: 80, statements: 80 },
          List: { lines: 80, branches: 75, functions: 80, statements: 80 }
        },
        globalFloor: { lines: 80, branches: 75, functions: 80, statements: 80 }
      },
      'testing.flakeTolerance': {
        maxRetryRatePct: 0.5,
        quarantinePolicy: 'auto-skip-after-3-flakes',
        flakeBudget: { perSuite: 2, perDay: 5 },
        deflakeOwner: 'test-reviewer-agent',
        failOpenAt: '1pct'
      }
    },
    confidence: 0.88,
    notes:
      'Broad-base pyramid for a Form-typed Story. Stryker mutation 60% kill-score floor. Lighthouse delta budget 5%. Playwright + Browserless e2e with page-object pattern mandatory. 0.5% flake budget.',
    dependencies: ['frontend', 'backend', 'database'],
    risks: [],
    toolCalls: [],
    spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
    status: 'ok'
  };
}

export function goldenAssistantText(): string {
  return JSON.stringify(goldenExpectedOutput());
}

export interface FakeSpawner {
  fn: ArchitectSpawnerFn;
  calls: ArchitectSpawnInput[];
}

export function fakeSpawnerReturning(text: string, ok = true): FakeSpawner {
  const calls: ArchitectSpawnInput[] = [];
  const fn: ArchitectSpawnerFn = async (input: ArchitectSpawnInput): Promise<ArchitectSpawnOutput> => {
    calls.push(input);
    return {
      text,
      inputTokens: 1000,
      outputTokens: 500,
      usdCost: 0.01,
      wallClockMs: 1234,
      model: input.budget.preferredModel,
      ok,
      diagnostic: ok ? null : 'forced failure'
    };
  };
  return { fn, calls };
}

export function fakeGoldenSpawner(): FakeSpawner {
  return fakeSpawnerReturning(goldenAssistantText());
}

export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of TESTING_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
