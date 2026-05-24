/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari Story ticket (the ArtistContactForm POST
 *     endpoint family) WITH a synthesised Backend upstream output
 *     (since Observability is wave-2 and depends on Backend).
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari Story fixture.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { OBSERVABILITY_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * The known-good Backend upstream output for the prakash-tiwari contact
 * form Story. Pinned here so the Observability architect's tests don't
 * depend on the Backend package being importable from tests (the
 * workspace symlink would work, but pinning is cheaper to maintain).
 */
function buildBackendUpstreamOutput(): ArchitectOutput {
  return {
    architectName: 'backend',
    architectureFields: {
      'backend.framework': {
        name: 'next',
        version: '15.x',
        runtime: 'edge+node',
        handlerStyle: 'app-router-route-handlers+server-actions'
      },
      'backend.serviceBoundaries': {
        style: 'monolith-with-modules',
        modules: [{ name: 'contacts', routes: ['/api/contacts'], owns: ['contacts'] }]
      },
      'backend.apiEndpoints': [
        {
          method: 'POST',
          path: '/api/contacts',
          op: 'create',
          runtime: 'node',
          requestSchemaRef: 'ContactCreate',
          responseSchemaRef: 'Contact',
          persistsTo: 'contacts',
          auth: 'public',
          rateLimit: 'public-strict'
        },
        {
          method: 'GET',
          path: '/api/contacts/:id',
          op: 'read',
          runtime: 'edge',
          requestSchemaRef: 'ContactReadParams',
          responseSchemaRef: 'Contact',
          readsFrom: 'contacts',
          auth: 'cloudflare-access',
          rateLimit: 'tenant-default'
        },
        {
          method: 'GET',
          path: '/api/contacts',
          op: 'list',
          runtime: 'edge',
          requestSchemaRef: 'ContactListQuery',
          responseSchemaRef: 'ContactList',
          readsFrom: 'contacts',
          auth: 'cloudflare-access',
          rateLimit: 'tenant-default'
        },
        {
          method: 'DELETE',
          path: '/api/contacts/:id',
          op: 'delete',
          runtime: 'node',
          requestSchemaRef: 'ContactDeleteParams',
          responseSchemaRef: 'ContactDeleted',
          deletesFrom: 'contacts',
          auth: 'cloudflare-access',
          rateLimit: 'tenant-default'
        }
      ],
      'backend.endpointEnumeration': [
        { route: 'POST /api/contacts', table: 'contacts', op: 'insert' },
        { route: 'GET /api/contacts/:id', table: 'contacts', op: 'select-by-pk' },
        { route: 'GET /api/contacts', table: 'contacts', op: 'select-by-tenant' },
        { route: 'DELETE /api/contacts/:id', table: 'contacts', op: 'delete-by-pk' }
      ],
      'backend.requestSchemas': {},
      'backend.responseSchemas': {},
      'backend.errorEnvelope': {
        schema:
          'z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.record(z.unknown()).optional(), requestId: z.string().uuid() }) })',
        examples: [],
        mapping: {
          ValidationError: { status: 422, code: 'VALIDATION_ERROR' },
          AuthError: { status: 401, code: 'UNAUTHORIZED' },
          ForbiddenError: { status: 403, code: 'FORBIDDEN' },
          NotFoundError: { status: 404, code: 'NOT_FOUND' },
          ConflictError: { status: 409, code: 'CONFLICT' },
          RateLimitError: { status: 429, code: 'RATE_LIMITED' },
          InternalError: { status: 500, code: 'INTERNAL' }
        }
      },
      'backend.validationRules': [],
      'backend.authRequirements': {
        default: { scheme: 'cloudflare-access', issuer: 'tenant-jwt-issuer', scopes: ['tenant:rw'] },
        perEndpoint: { 'POST /api/contacts': { scheme: 'public' } }
      },
      'backend.rateLimits': {
        default: { windowMs: 60_000, max: 120, scope: 'tenant' },
        perEndpoint: {
          'POST /api/contacts': { windowMs: 60_000, max: 10, scope: 'ip', burst: 3 }
        }
      },
      'backend.dataAccess': { orm: 'drizzle', tables: ['contacts'], queries: {} },
      'backend.businessRules': []
    },
    confidence: 0.86,
    notes: 'Backend golden output for prakash-tiwari contact form story.',
    dependencies: [],
    risks: [],
    toolCalls: [],
    spend: {
      inputTokens: 0,
      outputTokens: 0,
      usdCost: 0,
      wallClockMs: 0,
      model: 'sonnet'
    },
    status: 'ok'
  };
}

/**
 * The canonical fixture — a Story ticket from the prakash-tiwari.com
 * marketing site (the ArtistContactForm endpoint family) with Backend
 * upstream output already populated.
 */
export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-obs-001',
      type: 'Story',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'Every API request emits a structured JSON log line with request_id, tenant_id, route, status_code, duration_ms.',
        'OpenTelemetry spans cover the route handler + db query + outbound fetches.',
        'SLI/SLO defined: 99.5% availability over 30 days, p95 latency < 500ms for reads, < 1000ms for writes.',
        'P0 page fires within 5 minutes when availability drops below 99% over a 5-minute window.',
        'Runbook reference is wired for every alert rule.'
      ],
      business_requirements: {
        title: 'Observability for contact form endpoints',
        description:
          'Logs, metrics, traces, and alerts for the contacts module — public POST, tenant-auth GET-by-id, GET-list, DELETE.'
      },
      quality_tags: ['observability', 'sre', 'backend']
    },
    upstream: {
      outputs: {
        backend: buildBackendUpstreamOutput()
      }
    },
    businessPlan: {
      ventureName: 'Prakash Tiwari Studio',
      oneLiner: 'Bespoke artist session booking for the Prakash Tiwari portrait studio.',
      audience: "High-intent prospective sitters in the artist's metropolitan area.",
      goals: [
        'Drive contact-form submissions',
        'Project warm + grounded brand voice',
        "Make the booking CTA the page's primary action"
      ],
      brandVoice: 'warm + grounded',
      constraints: ['No third-party fonts beyond next/font defaults']
    },
    designVersion: {
      versionId: 'design-pt-v3-2026-05-22',
      snapshotUri: 's3://atlas/designs/design-pt-v3-2026-05-22.png',
      anchors: [
        {
          anchorId: 'contact-form',
          kind: 'form',
          bbox: { x: 0, y: 800, w: 1440, h: 480 },
          meta: { fields: ['name', 'email', 'message'] }
        }
      ],
      tokens: { 'color.brand.primary': '#0f3057' },
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

/**
 * The known-good output for the prakash-tiwari contact form Story
 * fixture. Covers exactly the 9 owned `observability.*` fields. Every
 * Observability invariant in `src/invariants.ts` must pass.
 *
 * Realistic SLI/SLO numbers:
 *   - availability target: 99.5% over 30 days (industry SaaS default)
 *   - latency_p95 target: < 500ms for reads, < 1000ms for writes
 *   - error_rate target: < 0.5% over 7 days
 *   - P0 alert: availability < 99% over 5min (pages on-call human)
 *   - P0 alert: error_rate > 5% over 5min (pages on-call human)
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'observability',
    architectureFields: {
      'observability.loggingStrategy': {
        format: 'json',
        logger: '@chiefaia/logger',
        topLevelKeys: [
          'timestamp',
          'level',
          'message',
          'request_id',
          'tenant_id',
          'route',
          'status_code',
          'duration_ms'
        ],
        perEndpoint: {
          'POST /api/contacts': {
            levelOnSuccess: 'info',
            levelOn4xx: 'warn',
            levelOn5xx: 'error',
            piiRedaction: ['email', 'message']
          },
          'GET /api/contacts/:id': {
            levelOnSuccess: 'info',
            levelOn4xx: 'warn',
            levelOn5xx: 'error',
            piiRedaction: ['email', 'message']
          },
          'GET /api/contacts': {
            levelOnSuccess: 'info',
            levelOn4xx: 'warn',
            levelOn5xx: 'error',
            piiRedaction: ['email', 'message']
          },
          'DELETE /api/contacts/:id': {
            levelOnSuccess: 'info',
            levelOn4xx: 'warn',
            levelOn5xx: 'error',
            piiRedaction: []
          }
        },
        routing: { sink: 'stdout', forwarder: 'cloudflare-tail' }
      },
      'observability.errorTrackingProvider': {
        provider: 'sentry',
        fingerprint: 'errorEnvelope.code',
        release: 'git-sha',
        tenantScope: 'tenant_id',
        sourceMaps: true
      },
      'observability.tracingStrategy': {
        system: 'opentelemetry',
        spanNaming: '<METHOD> <route>',
        semanticConventions: [
          'http.request.method',
          'http.route',
          'http.response.status_code',
          'db.system',
          'db.statement'
        ],
        childSpans: ['db.query', 'cache.get', 'external.fetch'],
        propagation: 'w3c-traceparent',
        sampling: { head: 0.1, tail: { on5xx: 1.0 } }
      },
      'observability.metricsEmitted': [
        {
          name: 'http_requests_total',
          type: 'counter',
          labels: ['method', 'route', 'status_code', 'tenant_id'],
          unit: 'total',
          help: 'Count of HTTP requests handled, labeled by method/route/status_code/tenant_id.'
        },
        {
          name: 'http_request_duration_seconds',
          type: 'histogram',
          labels: ['method', 'route', 'status_class'],
          unit: 'seconds',
          help: 'Latency histogram of HTTP requests in seconds.'
        },
        {
          name: 'http_request_size_bytes',
          type: 'histogram',
          labels: ['method', 'route'],
          unit: 'bytes',
          help: 'Request body size distribution in bytes.'
        },
        {
          name: 'http_response_size_bytes',
          type: 'histogram',
          labels: ['method', 'route', 'status_class'],
          unit: 'bytes',
          help: 'Response body size distribution in bytes.'
        }
      ],
      'observability.slis': {
        availability: {
          reads: ['http_requests_total'],
          formula:
            'sum(rate(http_requests_total{status_class!="5xx"}[5m])) / sum(rate(http_requests_total[5m]))'
        },
        latency_p95: {
          reads: ['http_request_duration_seconds'],
          formula: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))'
        },
        error_rate: {
          reads: ['http_requests_total'],
          formula:
            'sum(rate(http_requests_total{status_class="5xx"}[5m])) / sum(rate(http_requests_total[5m]))'
        }
      },
      'observability.slos': [
        { sli: 'availability', target: 0.995, window: '30d', scope: 'global' },
        { sli: 'latency_p95', target: '<500ms', window: '7d', scope: 'reads' },
        { sli: 'latency_p95', target: '<1000ms', window: '7d', scope: 'writes' },
        { sli: 'error_rate', target: '<0.005', window: '7d', scope: 'global' }
      ],
      'observability.alertingRules': [
        {
          id: 'availability-burn-fast',
          sli: 'availability',
          threshold: '<0.99',
          window: '5m',
          severity: 'P0',
          pageWithin: '5m',
          runbookRef: 'rb-contacts-availability'
        },
        {
          id: 'error-rate-spike',
          sli: 'error_rate',
          threshold: '>0.05',
          window: '5m',
          severity: 'P0',
          pageWithin: '5m',
          runbookRef: 'rb-contacts-error-rate'
        },
        {
          id: 'latency-p95-degradation',
          sli: 'latency_p95',
          threshold: '>1500ms',
          window: '15m',
          severity: 'P1',
          ticketWithin: '60m',
          runbookRef: 'rb-contacts-latency'
        },
        {
          id: 'slo-burn-rate-availability',
          sli: 'availability',
          threshold: 'burnRate > 10x',
          window: '1h',
          severity: 'P1',
          ticketWithin: '60m',
          runbookRef: 'rb-contacts-slo-burn'
        }
      ],
      'observability.dashboardSpec': {
        layout: 'grafana-iframe',
        panels: [
          {
            title: 'Request rate by status class',
            type: 'timeseries',
            query: 'sum by (status_class) (rate(http_requests_total[1m]))'
          },
          {
            title: 'Latency p50/p95/p99',
            type: 'timeseries',
            query: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))'
          },
          {
            title: 'Error rate (5xx / total)',
            type: 'timeseries',
            query:
              'sum(rate(http_requests_total{status_class="5xx"}[5m])) / sum(rate(http_requests_total[5m]))'
          },
          {
            title: 'SLO burn rate (availability)',
            type: 'stat',
            query: '(1 - 0.995) * 24 * 30 - increase(http_requests_total{status_class="5xx"}[30d])'
          }
        ]
      },
      'observability.runbookReferences': {
        'rb-contacts-availability': {
          stepsMarkdown: 'https://runbooks.caia.dev/contacts/availability.md',
          escalationOwner: 'on-call-platform',
          expectedMttrMinutes: 15
        },
        'rb-contacts-error-rate': {
          stepsMarkdown: 'https://runbooks.caia.dev/contacts/error-rate.md',
          escalationOwner: 'on-call-platform',
          expectedMttrMinutes: 20
        },
        'rb-contacts-latency': {
          stepsMarkdown: 'https://runbooks.caia.dev/contacts/latency.md',
          escalationOwner: 'on-call-platform',
          expectedMttrMinutes: 30
        },
        'rb-contacts-slo-burn': {
          stepsMarkdown: 'https://runbooks.caia.dev/contacts/slo-burn.md',
          escalationOwner: 'on-call-platform',
          expectedMttrMinutes: 60
        }
      }
    },
    confidence: 0.88,
    notes:
      'Observability spec for contacts module. Four endpoints instrumented: log/metric/trace coverage for each, structured JSON logs with PII redaction on email+message, OpenTelemetry tracing with tail-100%-on-5xx sampling, four Prometheus metrics, three SLIs with four SLOs, four alert rules (two P0, two P1) each wired to a runbook.',
    dependencies: [],
    risks: [],
    toolCalls: [],
    spend: {
      inputTokens: 0,
      outputTokens: 0,
      usdCost: 0,
      wallClockMs: 0,
      model: 'sonnet'
    },
    status: 'ok'
  };
}

/** The canonical assistant text — `JSON.stringify(goldenExpectedOutput())`. */
export function goldenAssistantText(): string {
  return JSON.stringify(goldenExpectedOutput());
}

/**
 * Fabricate an `ArchitectSpawnerFn` that returns the given text on every
 * call. Records every call for assertions.
 */
export interface FakeSpawner {
  fn: ArchitectSpawnerFn;
  calls: ArchitectSpawnInput[];
}

export function fakeSpawnerReturning(text: string, ok = true): FakeSpawner {
  const calls: ArchitectSpawnInput[] = [];
  const fn: ArchitectSpawnerFn = async (
    input: ArchitectSpawnInput
  ): Promise<ArchitectSpawnOutput> => {
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

/** Fabricate a spawner that returns the canonical golden assistant text. */
export function fakeGoldenSpawner(): FakeSpawner {
  return fakeSpawnerReturning(goldenAssistantText());
}

/**
 * Compose the Observability output's architectureFields with a
 * synthesised Backend slice so the cross-architect invariants can be
 * exercised against a "composed" view. Used by the invariants test pass.
 */
export function composedArchitectureForInvariants(): Readonly<Record<string, unknown>> {
  const obs = goldenExpectedOutput().architectureFields;
  const backend = buildBackendUpstreamOutput().architectureFields;
  return { ...obs, ...backend };
}

/**
 * Asserts that the input covers every required owned field. Sanity check
 * for fixtures.
 */
export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of OBSERVABILITY_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
