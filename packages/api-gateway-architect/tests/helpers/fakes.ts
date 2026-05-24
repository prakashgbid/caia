/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput`
 *     for a known prakash-tiwari Form Story ticket (POST /v1/contacts).
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari Form fixture.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { API_GATEWAY_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

function buildBackendUpstreamFields(): Record<string, unknown> {
  return {
    'backend.framework': {
      name: 'next',
      version: '15.x',
      runtime: 'edge+node',
      handlerStyle: 'app-router-route-handlers+server-actions'
    },
    'backend.apiEndpoints': [
      {
        method: 'POST',
        path: '/v1/contacts',
        op: 'createContact',
        requestSchemaRef: 'ContactCreate',
        responseSchemaRef: 'Contact',
        persistsTo: ['contacts'],
        auth: { scheme: 'public' },
        rateLimit: { windowMs: 60_000, max: 10, scope: 'ip' }
      },
      {
        method: 'GET',
        path: '/v1/contacts',
        op: 'listContacts',
        responseSchemaRef: 'ContactList',
        readsFrom: ['contacts'],
        auth: { scheme: 'jwt-bearer' },
        rateLimit: { windowMs: 60_000, max: 60, scope: 'tenant' }
      }
    ],
    'backend.authRequirements': {
      default: 'cloudflare-access',
      perEndpoint: {
        'POST /v1/contacts': { scheme: 'public' },
        'GET /v1/contacts': { scheme: 'jwt-bearer', issuer: 'caia', scopes: ['contacts:read'] }
      }
    },
    'backend.rateLimits': {
      default: { windowMs: 60_000, max: 60, scope: 'tenant' },
      perEndpoint: {
        'POST /v1/contacts': { windowMs: 60_000, max: 10, scope: 'ip' }
      }
    },
    'backend.errorEnvelope': {
      schema: {
        error: {
          code: 'string',
          message: 'string',
          details: 'object?',
          requestId: 'string'
        }
      },
      examples: [
        {
          status: 400,
          body: { error: { code: 'INVALID_BODY', message: 'Invalid request body', requestId: 'req_…' } }
        }
      ],
      mapping: {
        ValidationError: { httpStatus: 400, code: 'INVALID_BODY' }
      }
    }
  };
}

function buildSecurityUpstreamFields(): Record<string, unknown> {
  return {
    'security.authenticationStrategy': {
      default: 'cloudflare-access',
      perEndpoint: {
        'POST /v1/contacts': { scheme: 'public' },
        'GET /v1/contacts': { scheme: 'jwt-bearer', issuer: 'caia' }
      },
      sessionModel: { kind: 'jwt', alg: 'RS256', accessTtlSec: 900, refreshTtlSec: 2_592_000 }
    },
    'security.authorizationRules': {
      model: 'rbac+abac',
      roles: ['owner', 'admin', 'member', 'viewer'],
      denyByDefault: true
    },
    'security.rateLimitingRules': {
      perAuthTier: {
        public: { windowMs: 60_000, max: 20 },
        authenticated: { windowMs: 60_000, max: 60 },
        service: { windowMs: 60_000, max: 600 }
      },
      perEndpoint: {
        'POST /v1/contacts': { windowMs: 60_000, max: 10, scope: 'ip', onLimit: { status: 429 } }
      }
    }
  };
}

export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-api-001',
      type: 'Form',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'POST /v1/contacts is rate-limited to 10 req/min per IP.',
        'X-Request-Id is propagated through to the response.',
        'No Server / X-Powered-By headers leak in any response.',
        'Free-tier API quota overage rejects the request.',
        'CORS allowlist is same-origin by default.'
      ],
      business_requirements: {
        title: 'Contact form submission endpoint',
        description:
          'Public POST endpoint that accepts a contact-form payload and writes to the tenant\'s contacts table. Backs the marketing site\'s "Book a session" widget.'
      },
      quality_tags: ['api', 'persists', 'backend']
    },
    upstream: {
      outputs: {
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
        security: {
          architectName: 'security',
          architectureFields: buildSecurityUpstreamFields(),
          confidence: 0.9,
          notes: 'Security fixture.',
          dependencies: ['backend', 'database'],
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
      audience: 'High-intent prospective sitters in the artist\'s metropolitan area.',
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
    architectName: 'apiGateway',
    architectureFields: {
      'apiGateway.rateLimits': {
        perRoute: {
          'POST /v1/contacts': {
            windowMs: 60_000,
            max: 10,
            scope: 'ip',
            onLimit: { status: 429, retryAfterSec: 60 }
          },
          'GET /v1/contacts': {
            windowMs: 60_000,
            max: 60,
            scope: 'tenant',
            onLimit: { status: 429, retryAfterSec: 30 }
          }
        },
        perTenant: {
          free: { windowMs: 60_000, max: 100, onLimit: { status: 429, retryAfterSec: 60 } },
          pro: { windowMs: 60_000, max: 600, onLimit: { status: 429, retryAfterSec: 30 } },
          enterprise: { windowMs: 60_000, max: 6_000, onLimit: { status: 429, retryAfterSec: 15 } }
        },
        defaults: {
          public: { windowMs: 60_000, max: 20, scope: 'ip', onLimit: { status: 429, retryAfterSec: 60 } },
          authenticated: { windowMs: 60_000, max: 60, scope: 'tenant', onLimit: { status: 429, retryAfterSec: 30 } },
          service: { windowMs: 60_000, max: 600, scope: 'apiKey', onLimit: { status: 429, retryAfterSec: 5 } }
        }
      },
      'apiGateway.authGates': {
        'POST /v1/contacts': { authType: 'public', gateAt: 'edge', required: false },
        'GET /v1/contacts': { authType: 'jwt-bearer', gateAt: 'edge', required: true }
      },
      'apiGateway.versioningStrategy': {
        kind: 'url-prefix',
        prefix: '/v1',
        currentVersion: 'v1',
        deprecatedVersions: [],
        sunsetPolicy: {
          advanceNoticeDays: 180,
          headerName: 'Sunset',
          deprecationHeaderName: 'Deprecation'
        }
      },
      'apiGateway.errorEnvelope': {
        extends: 'backend.errorEnvelope',
        addedFields: {
          requestId: 'string',
          gatewayCode: 'string',
          retryable: 'boolean',
          upstream: 'object?'
        },
        mapping: {
          rateLimited: { httpStatus: 429, gatewayCode: 'GATEWAY_RATE_LIMITED', retryable: true },
          authFailed: { httpStatus: 401, gatewayCode: 'GATEWAY_AUTH_FAILED', retryable: false },
          upstreamTimeout: { httpStatus: 504, gatewayCode: 'GATEWAY_UPSTREAM_TIMEOUT', retryable: true },
          upstreamUnavailable: { httpStatus: 503, gatewayCode: 'GATEWAY_UPSTREAM_UNAVAILABLE', retryable: true },
          badRequest: { httpStatus: 400, gatewayCode: 'GATEWAY_BAD_REQUEST', retryable: false }
        }
      },
      'apiGateway.requestResponseTransforms': {
        request: [
          { op: 'inject-header', header: 'X-Request-Id', generator: 'uuid-v7-if-absent' },
          { op: 'canonicalize-query', target: '*' }
        ],
        response: [
          { op: 'strip-header', header: 'Server' },
          { op: 'strip-header', header: 'X-Powered-By' },
          { op: 'inject-header', header: 'X-Request-Id', source: 'request:X-Request-Id' }
        ],
        cacheRules: [
          { path: '/v1/contacts', scope: 'tenant', ttlSec: 0, vary: ['Authorization', 'Accept-Language'] }
        ]
      },
      'apiGateway.corsPolicy': {
        default: {
          allowedOrigins: ['same-origin'],
          allowedMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
          exposedHeaders: ['X-Request-Id', 'Sunset', 'Deprecation', 'Retry-After', 'X-Quota-Remaining', 'X-Quota-Reset'],
          allowCredentials: false,
          maxAgeSec: 600
        },
        perTenant: {
          'tenant-prakash-tiwari': {
            allowedOrigins: ['https://prakashtiwari.com', 'https://www.prakashtiwari.com'],
            allowCredentials: false
          }
        }
      },
      'apiGateway.webhookSecrets': {
        provider: 'vault',
        namespace: 'tenant/{{tenantId}}/webhooks',
        signing: {
          algorithm: 'HMAC-SHA256',
          headerName: 'X-CAIA-Signature',
          timestampHeaderName: 'X-CAIA-Timestamp',
          timestampToleranceSec: 300
        },
        replayProtection: { kind: 'nonce-store', ttlSec: 600 },
        rotation: { kind: 'scheduled', intervalDays: 90 },
        perWebhook: {}
      },
      'apiGateway.apiQuotas': {
        perTier: {
          free: { monthlyRequests: 1_000, dailyRequests: 100, overage: 'reject' },
          pro: { monthlyRequests: 100_000, dailyRequests: 10_000, overage: 'throttle' },
          enterprise: { monthlyRequests: 10_000_000, dailyRequests: 1_000_000, overage: 'bill' }
        },
        perEndpoint: {
          'POST /v1/contacts': { costMultiplier: 1 },
          'GET /v1/contacts': { costMultiplier: 1 }
        },
        surfacing: {
          headerName: 'X-Quota-Remaining',
          resetHeaderName: 'X-Quota-Reset'
        }
      }
    },
    confidence: 0.9,
    notes:
      'Per-route auth + rate-limit derived from Backend\'s apiEndpoints and cross-validated against Security\'s rateLimitingRules + authenticationStrategy. URL versioning at /v1 with 180-day sunset window. Error envelope extends Backend\'s; adds requestId + gatewayCode + retryable. X-Request-Id injected at the edge; Server + X-Powered-By stripped on response. Same-origin CORS default; HMAC-SHA256 webhook signing with 300s tolerance and 90d rotation. Free tier rejects on overage; pro + enterprise throttle/bill.',
    dependencies: ['backend', 'security'],
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

export function goldenAssistantText(): string {
  return JSON.stringify(goldenExpectedOutput());
}

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

export function fakeGoldenSpawner(): FakeSpawner {
  return fakeSpawnerReturning(goldenAssistantText());
}

export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of API_GATEWAY_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
