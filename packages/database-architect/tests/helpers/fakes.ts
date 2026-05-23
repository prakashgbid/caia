/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari contact-form Story ticket. The golden test
 *     uses this. Includes a fake Backend Architect upstream output
 *     keyed at `upstream.outputs.backend` (since Backend Architect is
 *     not yet merged at the time of this PR, the upstream is fabricated
 *     to the contract shape Backend's PR will land).
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari contact-form fixture.
 *
 *   - `fakeBackendUpstreamOutput()` — the upstream Backend output the
 *     Database Architect consumes. This is the contract Backend will
 *     publish when its PR lands; see `research/17_architect_framework_spec_2026.md`
 *     §2.2 for the field list.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { DATABASE_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * Fabricated Backend Architect upstream output. Mirrors the contract
 * Backend's `@caia/backend-architect` PR will publish; the Database
 * Architect reads this to enumerate persistence touchpoints.
 */
export function fakeBackendUpstreamOutput(): ArchitectOutput {
  return {
    architectName: 'backend',
    architectureFields: {
      'backend.framework': { name: 'next', version: '15.x', runtime: 'edge+node' },
      'backend.apiEndpoints': [
        {
          method: 'POST',
          path: '/api/contacts',
          op: 'create',
          requestSchema: 'ContactCreate',
          responseSchema: 'Contact',
          persistsTo: 'contacts'
        },
        {
          method: 'GET',
          path: '/api/contacts/:id',
          op: 'read',
          responseSchema: 'Contact',
          readsFrom: 'contacts'
        },
        {
          method: 'GET',
          path: '/api/contacts',
          op: 'list',
          responseSchema: 'ContactList',
          readsFrom: 'contacts'
        },
        {
          method: 'DELETE',
          path: '/api/contacts/:id',
          op: 'delete',
          deletesFrom: 'contacts'
        }
      ],
      'backend.endpointEnumeration': [
        { route: 'POST /api/contacts', table: 'contacts', op: 'insert' },
        { route: 'GET /api/contacts/:id', table: 'contacts', op: 'select-by-pk' },
        { route: 'GET /api/contacts', table: 'contacts', op: 'select-by-tenant' },
        { route: 'DELETE /api/contacts/:id', table: 'contacts', op: 'delete-by-pk' }
      ],
      'backend.dataAccess': {
        orm: 'drizzle',
        tables: ['contacts'],
        queries: {
          contacts: ['by-id', 'by-tenant-paginated', 'by-email']
        }
      },
      'backend.businessRules': [
        'Contact email must be unique within tenant',
        'Contact submission emits a contact.created domain event'
      ]
    },
    confidence: 0.85,
    notes: 'Fake Backend upstream for Database Architect golden test.',
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
 * The canonical fixture — a Form Story ticket from the prakash-tiwari.com
 * marketing site (a contact form) with intake-derived design tokens +
 * business plan + a fake Backend upstream output.
 */
export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-002',
      type: 'Form',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'Submitting the contact form persists a contacts row in the tenant schema.',
        'Tenant isolation: tenant A cannot read tenant B\'s contacts even with SQL injection.',
        'GDPR delete: when a user account is deleted, their contacts rows are anonymised within 30 days.',
        'Email uniqueness is enforced per tenant.',
        'A Postgres GIN index exists on the contacts.payload JSONB column.'
      ],
      business_requirements: {
        title: 'Contact form persistence',
        description:
          'Schema, indexes, and RLS for the contact form on the artist profile page. One row per submission; tenant-scoped; queryable by id, by tenant (paginated), and by email.'
      },
      quality_tags: ['persists', 'database', 'gdpr']
    },
    upstream: { outputs: { backend: fakeBackendUpstreamOutput() } },
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
 * The known-good output for the prakash-tiwari contact-form fixture.
 *
 * Every Database invariant in `src/invariants.ts` must pass against this
 * output. If you change the invariants, update this fixture too.
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'database',
    architectureFields: {
      'database.engine': { name: 'postgres', version: '16.x', orm: 'drizzle' },
      'database.tables': [
        {
          name: 'tenants',
          primaryKey: 'id',
          scope: 'shared',
          comment: 'Shared catalog of tenants. Owned by the meta cluster.'
        },
        {
          name: 'contacts',
          primaryKey: 'id',
          scope: 'tenant',
          comment: 'Per-tenant contact-form submissions.'
        }
      ],
      'database.columns': {
        tenants: [
          { name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()' },
          { name: 'slug', type: 'text', nullable: false },
          { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' }
        ],
        contacts: [
          { name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()' },
          { name: 'tenant_id', type: 'uuid', nullable: false },
          {
            name: 'name',
            type: 'text',
            nullable: false,
            check: "char_length(name) between 1 and 200"
          },
          {
            name: 'email',
            type: 'text',
            nullable: false,
            check: "email ~ '^[^@]+@[^@]+\\.[^@]+$'"
          },
          {
            name: 'message',
            type: 'text',
            nullable: false,
            check: "char_length(message) between 1 and 5000"
          },
          { name: 'payload', type: 'jsonb', nullable: false, default: "'{}'::jsonb" },
          { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' }
        ]
      },
      'database.indexes': [
        {
          table: 'tenants',
          name: 'tenants_slug_uk',
          columns: ['slug'],
          unique: true,
          method: 'btree'
        },
        {
          table: 'contacts',
          name: 'contacts_tenant_id_idx',
          columns: ['tenant_id'],
          unique: false,
          method: 'btree'
        },
        {
          table: 'contacts',
          name: 'contacts_tenant_email_uk',
          columns: ['tenant_id', 'email'],
          unique: true,
          method: 'btree'
        },
        {
          table: 'contacts',
          name: 'contacts_payload_gin',
          columns: ['payload'],
          unique: false,
          method: 'gin'
        }
      ],
      'database.migrations': [
        {
          id: '0001_create_tenants',
          description: 'Create shared tenants catalog table.',
          up: 'CREATE TABLE tenants (id uuid primary key default gen_random_uuid(), slug text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()); CREATE UNIQUE INDEX tenants_slug_uk ON tenants (slug);',
          down: 'DROP TABLE tenants;',
          ordering: 1,
          requiresOperatorReview: false
        },
        {
          id: '0002_create_contacts',
          description:
            'Create per-tenant contacts table with email uniqueness + JSONB payload + RLS.',
          up: 'CREATE TABLE contacts (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete restrict, name text not null check (char_length(name) between 1 and 200), email text not null check (email ~ \'^[^@]+@[^@]+\\.[^@]+$\'), message text not null check (char_length(message) between 1 and 5000), payload jsonb not null default \'{}\'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()); CREATE INDEX contacts_tenant_id_idx ON contacts (tenant_id); CREATE UNIQUE INDEX contacts_tenant_email_uk ON contacts (tenant_id, email); CREATE INDEX contacts_payload_gin ON contacts USING GIN (payload); ALTER TABLE contacts ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON contacts USING (current_setting(\'app.tenant_id\')::uuid = tenant_id); CREATE POLICY service_role_bypass ON contacts USING (current_user = \'orchestrator\');',
          down: 'DROP TABLE contacts;',
          ordering: 2,
          requiresOperatorReview: false
        }
      ],
      'database.relationships': [
        {
          from: 'contacts.tenant_id',
          to: 'tenants.id',
          onDelete: 'restrict',
          onUpdate: 'cascade',
          deferrable: false
        }
      ],
      'database.rlsPolicies': {
        contacts: [
          {
            name: 'tenant_isolation',
            using: "current_setting('app.tenant_id')::uuid = tenant_id",
            kind: 'permissive',
            operation: 'all'
          },
          {
            name: 'service_role_bypass',
            using: "current_user = 'orchestrator'",
            kind: 'permissive',
            operation: 'all'
          }
        ]
      },
      'database.tenantIsolationStrategy': {
        model: 'schema-per-tenant',
        justification:
          'Matches CAIA meta cluster. One Postgres schema per tenant; shared catalog tables live in the public schema.',
        schemaNameTemplate: 'tenant_{{tenantId}}',
        sharedTables: ['tenants']
      },
      'database.dataLifecycle': [
        {
          table: 'tenants',
          retentionDays: -1,
          archivalSink: 'r2://archive/tenants',
          gdprDeleteStrategy: 'soft',
          cascadeOnUserDelete: false
        },
        {
          table: 'contacts',
          retentionDays: 730,
          archivalSink: 'r2://archive/contacts',
          gdprDeleteStrategy: 'anonymize',
          cascadeOnUserDelete: true
        }
      ],
      'database.jsonbShapes': {
        'contacts.payload': {
          shape:
            'z.object({ source: z.string().optional(), utm: z.record(z.string()).optional(), userAgent: z.string().optional() })'
        }
      },
      'database.queryHints': [
        {
          endpoint: 'POST /api/contacts',
          table: 'contacts',
          op: 'write',
          indexCandidate: 'contacts_tenant_email_uk',
          expectedQps: 2,
          p95LatencyTargetMs: 80
        },
        {
          endpoint: 'GET /api/contacts/:id',
          table: 'contacts',
          op: 'read',
          indexCandidate: 'contacts_pkey',
          expectedQps: 5,
          p95LatencyTargetMs: 20
        },
        {
          endpoint: 'GET /api/contacts',
          table: 'contacts',
          op: 'read',
          indexCandidate: 'contacts_tenant_id_idx',
          expectedQps: 1,
          p95LatencyTargetMs: 60
        },
        {
          endpoint: 'DELETE /api/contacts/:id',
          table: 'contacts',
          op: 'write',
          indexCandidate: 'contacts_pkey',
          expectedQps: 0.1,
          p95LatencyTargetMs: 40
        }
      ]
    },
    confidence: 0.87,
    notes:
      'Two tables: shared `tenants` catalog + per-tenant `contacts`. Composite unique index on (tenant_id, email) enforces per-tenant email uniqueness. GIN index on payload JSONB. RLS enabled on contacts with tenant_isolation + service_role_bypass policies. Schema-per-tenant matches CAIA meta cluster. GDPR delete strategy is anonymize for contacts (retain 730 days, then anonymize PII).',
    dependencies: ['backend'],
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
  for (const k of DATABASE_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
