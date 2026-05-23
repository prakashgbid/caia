/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari Widget ticket (an `ArtistContactForm`
 *     widget — a hero-adjacent contact form that exposes its own POST
 *     endpoint, so Backend Architect applies). The golden test uses
 *     this. Backend is a wave-1 architect, so `upstream.outputs` is
 *     empty.
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari Widget fixture.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { BACKEND_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * The canonical fixture — a Widget ticket from the prakash-tiwari.com
 * marketing site (an `ArtistContactForm` widget — a hero-adjacent
 * contact form that exposes its own POST endpoint). Tagged with `api`
 * + `persists` so the Backend `appliesPredicate` admits it.
 */
export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-bk-001',
      type: 'Widget',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'POST /api/contacts persists a contacts row in the tenant schema.',
        'Request body validated with Zod (name 1-200 chars, RFC-5321 email, message 1-5000 chars).',
        'Response is the canonical Contact JSON with id, tenantId, createdAt.',
        'Validation failures return 422 with the canonical error envelope.',
        'Tenant-scoped routes require a Cloudflare Access JWT issued by the tenant\'s configured issuer.',
        'Rate-limited at 10 req/min per IP for the public submit path.'
      ],
      business_requirements: {
        title: 'Contact form submission API',
        description:
          'POST endpoint that accepts a name/email/message contact submission from the public Artist profile page, validates it with Zod, persists to the contacts table, and returns the canonical Contact response. Includes paginated list + by-id read + delete for the operator dashboard.'
      },
      quality_tags: ['api', 'backend', 'persists']
    },
    upstream: { outputs: {} },
    businessPlan: {
      ventureName: 'Prakash Tiwari Studio',
      oneLiner: 'Bespoke artist session booking for the Prakash Tiwari portrait studio.',
      audience: 'High-intent prospective sitters in the artist\'s metropolitan area.',
      goals: [
        'Drive contact-form submissions',
        'Project warm + grounded brand voice',
        'Make the booking CTA the page\'s primary action'
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
      tokens: {
        'color.brand.primary': '#0f3057'
      },
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
 * The known-good output for the prakash-tiwari Widget fixture.
 *
 * Every Backend invariant in `src/invariants.ts` must pass against this
 * output. If you change the invariants, update this fixture too.
 */
export function goldenExpectedOutput(): ArchitectOutput {
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
        modules: [
          {
            name: 'contacts',
            routes: [
              '/api/contacts',
              '/api/contacts/[id]'
            ],
            owns: ['contacts']
          }
        ]
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
      'backend.requestSchemas': {
        ContactCreate: {
          shape:
            'z.object({ name: z.string().min(1).max(200), email: z.string().email().max(320), message: z.string().min(1).max(5000) })'
        },
        ContactReadParams: {
          shape: 'z.object({ id: z.string().uuid() })'
        },
        ContactListQuery: {
          shape:
            'z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) })'
        },
        ContactDeleteParams: {
          shape: 'z.object({ id: z.string().uuid() })'
        }
      },
      'backend.responseSchemas': {
        Contact: {
          shape:
            'z.object({ id: z.string().uuid(), tenantId: z.string().uuid(), name: z.string(), email: z.string().email(), message: z.string(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })'
        },
        ContactList: {
          shape: 'z.object({ items: z.array(Contact), nextCursor: z.string().uuid().nullable() })'
        },
        ContactDeleted: {
          shape: 'z.object({ id: z.string().uuid(), deletedAt: z.string().datetime() })'
        }
      },
      'backend.errorEnvelope': {
        schema:
          'z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.record(z.unknown()).optional(), requestId: z.string().uuid() }) })',
        examples: [
          {
            status: 422,
            body: {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Request body failed Zod validation.',
                details: { email: 'Invalid email format' },
                requestId: '00000000-0000-0000-0000-000000000000'
              }
            }
          },
          {
            status: 401,
            body: {
              error: {
                code: 'UNAUTHORIZED',
                message: 'Missing or invalid Cloudflare Access JWT.',
                requestId: '00000000-0000-0000-0000-000000000000'
              }
            }
          }
        ],
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
      'backend.validationRules': [
        {
          endpoint: 'POST /api/contacts',
          rule: 'email unique within tenant',
          source: 'database',
          failureMode: '409 CONFLICT'
        },
        {
          endpoint: 'POST /api/contacts',
          rule: 'message must not contain control characters',
          source: 'zod',
          failureMode: '422 VALIDATION_ERROR'
        },
        {
          endpoint: 'GET /api/contacts/:id',
          rule: 'requester must belong to the contact\'s tenant',
          source: 'business',
          failureMode: '403 FORBIDDEN'
        },
        {
          endpoint: 'DELETE /api/contacts/:id',
          rule: 'requester must hold contacts:delete scope',
          source: 'business',
          failureMode: '403 FORBIDDEN'
        }
      ],
      'backend.authRequirements': {
        default: {
          scheme: 'cloudflare-access',
          issuer: 'tenant-jwt-issuer',
          scopes: ['tenant:rw']
        },
        perEndpoint: {
          'POST /api/contacts': {
            scheme: 'public'
          }
        }
      },
      'backend.rateLimits': {
        default: {
          windowMs: 60_000,
          max: 120,
          scope: 'tenant'
        },
        perEndpoint: {
          'POST /api/contacts': {
            windowMs: 60_000,
            max: 10,
            scope: 'ip',
            burst: 3
          }
        }
      },
      'backend.dataAccess': {
        orm: 'drizzle',
        tables: ['contacts'],
        queries: {
          contacts: ['by-id', 'by-tenant-paginated', 'by-email']
        }
      },
      'backend.businessRules': [
        'Contact email must be unique within tenant',
        'Contact submission emits a contact.created domain event',
        'Contact rows are soft-deleted (deleted_at timestamp) before hard-delete after 30 days',
        'POST /api/contacts is public + IP rate-limited; all other routes require tenant auth'
      ]
    },
    confidence: 0.86,
    notes:
      'Four endpoints for the contacts module: public POST for the marketing form (IP rate-limited 10/min), tenant-auth GET/list/delete for the operator dashboard. Canonical error envelope with mapping for the 7 standard error classes. Drizzle ORM declared; Database Architect will lift `dataAccess.tables` into table schemas. Public submit path is the only auth-override; defaults to Cloudflare Access otherwise.',
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
 * Asserts that the input covers every required owned field. Sanity check
 * for fixtures.
 */
export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of BACKEND_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
