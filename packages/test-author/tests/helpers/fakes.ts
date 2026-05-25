/**
 * Test fixtures + fake spawner factory for the Test Author Agent.
 *
 * The `prakash-tiwari` ticket fixture (`ticket-pt-test-001`) mirrors
 * the one used by `@caia/testing-architect`'s golden suite, so we
 * exercise the same EA-approved canonical input across packages.
 */

import type { TestCase } from '@chiefaia/ticket-template';

import type {
  AuthorInput,
  AuthorOutput,
  AuthorTicket
} from '../../src/types.js';
import type {
  AuthorSpawnerFn,
  AuthorSpawnInput,
  AuthorSpawnOutput
} from '../../src/spawner.js';

export function buildFakeTicket(): AuthorTicket {
  return {
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
  };
}

export function buildFakeArchitecture(): Record<string, unknown> {
  return {
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
      Story: { unit: 60, integration: 20, e2e: 10, visual: 5, a11y: 3, perf: 2 }
    },
    'testing.perfRegressionBudgets': {
      tool: 'lighthouse',
      lighthouseDeltaPct: 5,
      k6Thresholds: { p95LatencyMs: 1000, errorRatePct: 1.0 },
      regressionAction: 'open-issue'
    },
    'testing.coverageThresholds': {
      globalFloor: { lines: 80, branches: 75, functions: 80, statements: 80 }
    },
    'testing.e2ePatterns': {
      runner: 'playwright',
      playwrightVersion: '1.59.x',
      pageObjects: true
    },
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
      'contact-email': { error: 'red border + error text' },
      'contact-submit': { disabled: '50% opacity', loading: 'inline spinner' }
    },
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
      mapping: { ValidationError: { httpStatus: 400, code: 'INVALID_BODY' } }
    },
    'database.schemaDDL':
      'CREATE TABLE contacts (id uuid PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL, email text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());',
    'a11y.wcagLevel': 'AA'
  };
}

export function buildFakeInput(): AuthorInput {
  const ticket = buildFakeTicket();
  return {
    ticket,
    composedArchitecture: buildFakeArchitecture(),
    acceptanceCriteria: ticket.acceptance_criteria,
    budget: {
      maxInputTokens: 60_000,
      maxOutputTokens: 8_000,
      maxWallClockMs: 60_000,
      preferredModel: 'sonnet',
      hardCostCeilingUsd: 0.5
    }
  };
}

/**
 * The deterministic golden test cases — 15 cases covering:
 *  - 4 unit happy on validators (one per AC)
 *  - 2 integration happy on POST /v1/contacts
 *  - 1 e2e happy on submit + success toast
 *  - 1 e2e error on ValidationError
 *  - 1 visual on form empty + error states
 *  - 1 accessibility on axe wcag2aa
 *  - 1 performance with Lighthouse threshold
 *  - 2 edge cases (empty submit, 10kb message body)
 *  - 1 security on RLS tenant isolation
 *  - 1 visual on submitting state
 */
export function goldenTestCases(designedAt = 1_716_624_000_000): TestCase[] {
  const base = (
    id: string,
    title: string,
    category: TestCase['category'],
    layer: TestCase['layer'],
    given: string,
    when: string,
    then: string,
    extras: Partial<TestCase> = {}
  ): TestCase => ({
    id,
    title,
    category,
    layer,
    given,
    when,
    then,
    selectorHints: extras.selectorHints ?? [],
    mocks: extras.mocks ?? [],
    required: extras.required ?? true,
    status: extras.status ?? 'pending',
    designedBy: 'test-author',
    designedAt,
    ...(typeof extras.linkedAcceptanceCriterionIndex === 'number'
      ? { linkedAcceptanceCriterionIndex: extras.linkedAcceptanceCriterionIndex }
      : {})
  });

  return [
    base(
      'tc-pt-001-1',
      'email validator accepts RFC-5322 happy address',
      'happy',
      'unit',
      'a contact-email validator and the address "alice@example.com"',
      'validate is called',
      'the validator returns { valid: true }',
      { linkedAcceptanceCriterionIndex: 0 }
    ),
    base(
      'tc-pt-001-2',
      'name validator rejects empty string',
      'happy',
      'unit',
      'a contact-name validator',
      'validate is called with ""',
      'the validator returns { valid: false, reason: "required" }',
      { linkedAcceptanceCriterionIndex: 0 }
    ),
    base(
      'tc-pt-001-3',
      'message validator accepts up to 10000 chars',
      'happy',
      'unit',
      'a contact-message validator',
      'validate is called with a 10000-character string',
      'the validator returns { valid: true }',
      { linkedAcceptanceCriterionIndex: 0 }
    ),
    base(
      'tc-pt-001-4',
      'submit handler disables button while in-flight',
      'happy',
      'unit',
      'the form handler with status="idle"',
      'submit is invoked',
      'the button transitions to status="submitting" and is disabled',
      { linkedAcceptanceCriterionIndex: 2 }
    ),
    base(
      'tc-pt-001-5',
      'POST /v1/contacts persists a row',
      'happy',
      'integration',
      'a clean contacts table and tenant context tenant-pt',
      'POST /v1/contacts {name,email,message} is invoked',
      'a row exists in contacts with tenant_id = "tenant-pt"',
      { linkedAcceptanceCriterionIndex: 0, mocks: [] }
    ),
    base(
      'tc-pt-001-6',
      'POST /v1/contacts rejects invalid email with 400',
      'happy',
      'integration',
      'a clean contacts table',
      'POST /v1/contacts is invoked with email="not-an-email"',
      'the response is 400 with error.code="INVALID_BODY"',
      { linkedAcceptanceCriterionIndex: 1 }
    ),
    base(
      'tc-pt-001-7',
      'submitting valid form shows success toast',
      'happy',
      'e2e',
      'the /contact page rendered',
      'the user fills the form with valid data and clicks Submit',
      'a success toast appears and the form clears',
      {
        linkedAcceptanceCriterionIndex: 3,
        selectorHints: [
          '[data-testid="contact-form"]',
          '[data-testid="contact-submit"]',
          'role=alert[name="success-toast"]'
        ],
        mocks: [{ method: 'POST', url: '/v1/contacts', status: 200, body: '{"id":"abc"}' }]
      }
    ),
    base(
      'tc-pt-001-8',
      'invalid email displays inline error and 400 envelope',
      'error',
      'e2e',
      'the /contact page rendered',
      'the user enters "not-an-email" and clicks Submit',
      'an inline error appears under the email field and the toast says "Please check your email"',
      {
        linkedAcceptanceCriterionIndex: 1,
        selectorHints: ['[data-testid="contact-email-error"]'],
        mocks: [
          {
            method: 'POST',
            url: '/v1/contacts',
            status: 400,
            body: '{"error":{"code":"INVALID_BODY","message":"email invalid"}}'
          }
        ]
      }
    ),
    base(
      'tc-pt-001-9',
      'empty form + filled-error states render correctly',
      'visual',
      'visual',
      'the /contact page rendered',
      'a snapshot is taken in empty + error states',
      'both screenshots match the pinned golden',
      { selectorHints: ['[data-testid="contact-form"]'] }
    ),
    base(
      'tc-pt-001-10',
      'submit-pending state renders disabled button + spinner',
      'visual',
      'visual',
      'the /contact page rendered with status="submitting"',
      'a snapshot is taken',
      'the snapshot matches the pinned golden and the button is visibly disabled',
      { selectorHints: ['[data-testid="contact-submit"]'] }
    ),
    base(
      'tc-pt-001-11',
      'axe wcag2aa clean on contact form',
      'accessibility',
      'accessibility',
      'the /contact page rendered',
      'axe is run with tags=["wcag2a","wcag2aa","best-practice"]',
      'axe reports zero violations against wcag2aa',
      { selectorHints: ['[data-testid="contact-form"]'] }
    ),
    base(
      'tc-pt-001-12',
      'Lighthouse perf + a11y budgets met on contact route',
      'performance',
      'e2e',
      'the /contact route',
      'Lighthouse is run with the desktop preset',
      'Lighthouse performance score >= 90 AND LCP <= 2500ms AND CLS <= 0.1 AND TBT <= 300ms (Lighthouse delta budget 5%)'
    ),
    base(
      'tc-pt-001-13',
      'edge: empty submit shows required-field errors for every input',
      'edge',
      'e2e',
      'the /contact page rendered',
      'the user clicks Submit without entering any data',
      'inline required-field errors appear on contact-name, contact-email, and contact-message',
      {
        linkedAcceptanceCriterionIndex: 1,
        selectorHints: ['[data-testid="contact-submit"]']
      }
    ),
    base(
      'tc-pt-001-14',
      'edge: 10kb message body is accepted and persisted',
      'edge',
      'integration',
      'a clean contacts table',
      'POST /v1/contacts is invoked with a 10000-character message',
      'the response is 200 and the row has message_length=10000',
      { linkedAcceptanceCriterionIndex: 0 }
    ),
    base(
      'tc-pt-001-15',
      'RLS isolates contacts across tenants',
      'security',
      'integration',
      'two tenants tenant-pt and tenant-x with rows in contacts',
      'tenant-pt selects from contacts',
      'only tenant-pt rows are returned (RLS policy "tenant_isolation" enforced)'
    )
  ];
}

export function goldenExpectedOutput(designedAt = 1_716_624_000_000): AuthorOutput {
  const cases = goldenTestCases(designedAt);
  const categoryCounts = {
    happy: 0,
    edge: 0,
    error: 0,
    accessibility: 0,
    security: 0,
    performance: 0,
    visual: 0
  };
  const layerCounts = {
    unit: 0,
    integration: 0,
    e2e: 0,
    visual: 0,
    accessibility: 0
  };
  for (const tc of cases) {
    categoryCounts[tc.category] += 1;
    layerCounts[tc.layer] += 1;
  }
  return {
    agentName: 'test-author',
    testCases: cases,
    testDesign: {
      designedBy: 'test-author',
      designedAt,
      totalCases: cases.length,
      categoryCounts,
      layerCounts
    },
    confidence: 0.86,
    notes:
      'Broad-base pyramid (Story mix unit:60/integration:20/e2e:10/visual:5/a11y:3/perf:2). All 4 AC covered. 2 edge, 1 error, 1 a11y wcag2aa, 1 Lighthouse perf with the architect-declared 5% delta budget.',
    dependencies: ['testing', 'frontend', 'backend', 'database'],
    risks: [],
    toolCalls: [],
    spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
    status: 'ok'
  };
}

export function goldenAssistantText(designedAt = 1_716_624_000_000): string {
  return JSON.stringify(goldenExpectedOutput(designedAt));
}

export interface FakeSpawner {
  fn: AuthorSpawnerFn;
  calls: AuthorSpawnInput[];
}

export function fakeSpawnerReturning(text: string, ok = true): FakeSpawner {
  const calls: AuthorSpawnInput[] = [];
  const fn: AuthorSpawnerFn = async (input: AuthorSpawnInput): Promise<AuthorSpawnOutput> => {
    calls.push(input);
    return {
      text,
      inputTokens: 1234,
      outputTokens: 567,
      usdCost: 0.012,
      wallClockMs: 4321,
      model: input.budget.preferredModel,
      ok,
      diagnostic: ok ? null : 'forced failure'
    };
  };
  return { fn, calls };
}

export function fakeGoldenSpawner(designedAt?: number): FakeSpawner {
  return fakeSpawnerReturning(goldenAssistantText(designedAt));
}

/** In-memory state-machine recorder. */
export class RecordingStateMachine {
  readonly transitions: Array<{
    ticketId: string;
    from: string;
    to: string;
    triggeredBy: { kind: string; id: string };
    intermediate?: boolean;
    decision: string;
  }> = [];

  async transition(input: {
    ticketId: string;
    from: string;
    to: string;
    triggeredBy: { kind: string; id: string };
    payload: { intermediate?: boolean; decision: 'pass' | 'fail' };
  }): Promise<void> {
    this.transitions.push({
      ticketId: input.ticketId,
      from: input.from,
      to: input.to,
      triggeredBy: input.triggeredBy,
      ...(input.payload.intermediate !== undefined ? { intermediate: input.payload.intermediate } : {}),
      decision: input.payload.decision
    });
  }
}
