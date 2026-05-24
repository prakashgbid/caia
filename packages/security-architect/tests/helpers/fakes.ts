/**
 * Test fixtures + fake spawner factory for the Security Architect.
 *
 * The canonical fixture is a prakash-tiwari contact-form Form Story
 * ticket with wave-1 Backend + Database upstream outputs. The golden
 * output covers ALL OWASP Top-10 2021 categories with verdict +
 * mitigations + cross-architect evidenceRefs.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { SECURITY_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

function fakeBackendUpstream(): ArchitectOutput {
  return {
    architectName: 'backend',
    architectureFields: {
      'backend.framework': {
        name: 'next', version: '15.x', runtime: 'edge+node',
        handlerStyle: 'app-router-route-handlers+server-actions'
      },
      'backend.serviceBoundaries': { style: 'monolith-with-modules', modules: ['contacts'] },
      'backend.apiEndpoints': [
        {
          method: 'POST', path: '/api/contacts', op: 'create',
          requestSchemaRef: 'ContactCreate', responseSchemaRef: 'Contact',
          persistsTo: ['contacts'], auth: 'public',
          rateLimit: { windowSec: 60, max: 10, scope: 'ip' }
        }
      ],
      'backend.endpointEnumeration': [
        { route: 'POST /api/contacts', table: 'contacts', op: 'write' }
      ],
      'backend.requestSchemas': { ContactCreate: 'z.object({ name, email, message })' },
      'backend.responseSchemas': { Contact: 'z.object({ id, createdAt })' },
      'backend.errorEnvelope': { schema: '{ error: { code, message, requestId } }' },
      'backend.validationRules': [
        { endpoint: 'POST /api/contacts', rule: 'email is unique within tenant', source: 'database', failureMode: '409-conflict' }
      ],
      'backend.authRequirements': {
        default: 'cloudflare-access',
        perEndpoint: { 'POST /api/contacts': { scheme: 'public' } }
      },
      'backend.rateLimits': {
        default: { windowMs: 60000, max: 60, scope: 'tenant' },
        perEndpoint: { 'POST /api/contacts': { windowMs: 60000, max: 10, scope: 'ip' } }
      },
      'backend.dataAccess': { orm: 'drizzle', tables: ['contacts'], queries: { contacts: ['insert'] } },
      'backend.businessRules': ['Contact email unique within tenant']
    },
    confidence: 0.9,
    notes: 'Form Story: single POST endpoint, public auth, IP-scoped rate limit.',
    dependencies: [],
    risks: [],
    toolCalls: [],
    spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
    status: 'ok'
  };
}

function fakeDatabaseUpstream(): ArchitectOutput {
  return {
    architectName: 'database',
    architectureFields: {
      'database.engine': { name: 'postgres', version: '16.x', orm: 'drizzle' },
      'database.tables': [
        { name: 'contacts', primaryKey: 'id', scope: 'tenant', comment: 'Contact form submissions.' }
      ],
      'database.columns': {
        contacts: [
          { name: 'id', type: 'uuid', nullable: false },
          { name: 'tenant_id', type: 'uuid', nullable: false },
          { name: 'created_at', type: 'timestamptz', nullable: false },
          { name: 'updated_at', type: 'timestamptz', nullable: false }
        ]
      },
      'database.indexes': [
        { table: 'contacts', name: 'contacts_tenant_email_uk', columns: ['tenant_id', 'email'], unique: true, method: 'btree' }
      ],
      'database.migrations': [
        { id: '0001_create_contacts', description: 'Create contacts table.', up: 'CREATE TABLE contacts (...);', down: 'DROP TABLE contacts;', ordering: 1, requiresOperatorReview: false }
      ],
      'database.relationships': [
        { from: 'contacts.tenant_id', to: 'tenants.id', onDelete: 'restrict', onUpdate: 'cascade', deferrable: false }
      ],
      'database.rlsPolicies': {
        contacts: [
          { name: 'tenant_isolation', using: "current_setting('app.tenant_id')::uuid = tenant_id", kind: 'permissive', operation: 'all' },
          { name: 'service_role_bypass', using: "current_user = 'orchestrator'", kind: 'permissive', operation: 'all' }
        ]
      },
      'database.tenantIsolationStrategy': {
        model: 'schema-per-tenant',
        justification: 'matches CAIA meta cluster',
        schemaNameTemplate: 'tenant_{{tenantId}}',
        sharedTables: ['tenants', 'plans']
      },
      'database.dataLifecycle': [
        { table: 'contacts', retentionDays: 730, archivalSink: 'r2://archive/contacts', gdprDeleteStrategy: 'anonymize', cascadeOnUserDelete: true }
      ],
      'database.jsonbShapes': {
        'contacts.payload': { shape: 'z.object({ source: z.string() })' }
      },
      'database.queryHints': [
        { endpoint: 'POST /api/contacts', table: 'contacts', op: 'write', indexCandidate: 'contacts_tenant_email_uk', expectedQps: 5, p95LatencyTargetMs: 50 }
      ]
    },
    confidence: 0.9,
    notes: 'Single tenant-scoped table with RLS.',
    dependencies: ['backend'],
    risks: [],
    toolCalls: [],
    spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
    status: 'ok'
  };
}

export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-sec-001',
      type: 'Form',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'Form submission round-trips in <500ms p95.',
        'Submissions are tenant-isolated; tenant A cannot read tenant B rows.',
        'Rate-limited to 10 req/min per IP for public submission.',
        'CSP allows the form to submit only to same-origin.',
        'Failed-auth attempts trigger an alert at 5 failures in 60s.'
      ],
      business_requirements: {
        title: 'Contact form submission',
        description: 'Public marketing contact form on the artist profile page.'
      },
      quality_tags: ['form', 'public', 'persists']
    },
    upstream: { outputs: { backend: fakeBackendUpstream(), database: fakeDatabaseUpstream() } },
    businessPlan: {
      ventureName: 'Prakash Tiwari Studio',
      oneLiner: 'Bespoke artist session booking.',
      audience: 'High-intent prospective sitters.',
      goals: ['Drive contact-form submissions'],
      brandVoice: 'warm + grounded'
    },
    designVersion: {
      versionId: 'design-pt-v3-2026-05-22',
      anchors: [{ anchorId: 'contact-form', kind: 'form' }],
      tokens: {}
    },
    tenantContext: {
      tenantId: 'tenant-prakash-tiwari',
      schemaName: 'tenant_prakash_tiwari',
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
 * Covers ALL OWASP Top-10 2021 categories with verdict + mitigations + evidenceRefs.
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'security',
    architectureFields: {
      'security.authenticationStrategy': {
        default: 'cloudflare-access',
        perEndpoint: {
          'POST /api/contacts': { scheme: 'public', reason: 'marketing contact form' }
        },
        sessionModel: {
          kind: 'jwt', issuer: 'caia-auth', algorithm: 'RS256',
          accessTtlMin: 15, refreshTtlDays: 30, rotation: 'sliding'
        },
        mfa: { required: 'admin', method: 'totp' },
        oauthProviders: [
          { name: 'github', scopes: ['user:email'] },
          { name: 'google', scopes: ['openid', 'email', 'profile'] }
        ]
      },
      'security.authorizationRules': {
        model: 'rbac+abac',
        roles: ['owner', 'admin', 'member', 'viewer'],
        permissions: [
          { role: 'admin', action: 'read', resource: 'contacts', condition: 'row.tenant_id == ctx.tenantId' },
          { role: 'member', action: 'read', resource: 'contacts', condition: 'row.tenant_id == ctx.tenantId' }
        ],
        resourceOwnership: { contacts: { ownerColumn: 'created_by', tenantColumn: 'tenant_id' } },
        denyByDefault: true
      },
      'security.secretsHandling': {
        provider: 'vault',
        namespace: 'tenant/{{tenantId}}',
        rotationPolicy: { kind: 'scheduled', intervalDays: 90 },
        perSecret: {
          'db.password': { accessRole: 'app', rotationDays: 30, scope: 'per-tenant' },
          'oauth.github.clientSecret': { accessRole: 'auth', rotationDays: 90, scope: 'global' }
        },
        injection: 'env-at-runtime',
        neverLog: ['password', 'token', 'secret', 'authorization', 'cookie']
      },
      'security.owaspMitigations': {
        a01_brokenAccessControl: {
          verdict: 'mitigated',
          mitigations: [
            'Deny-by-default authorization with explicit per-resource grants',
            'RLS on every tenant-scoped table',
            'tenant_id condition on every authorization rule'
          ],
          evidenceRefs: ['security.authorizationRules', 'database.rlsPolicies']
        },
        a02_cryptographicFailures: {
          verdict: 'mitigated',
          mitigations: [
            'JWT signed with RS256/EdDSA asymmetric keys',
            'HSTS preload forces TLS for the entire eTLD+1',
            'Secrets rotated on 90-day schedule via Vault'
          ],
          evidenceRefs: ['security.authenticationStrategy', 'security.securityHeaders', 'security.secretsHandling']
        },
        a03_injection: {
          verdict: 'mitigated',
          mitigations: [
            'Zod schema validation on every endpoint body',
            'Drizzle parameterised queries — no raw string SQL',
            'sanitization.stripHtml on all string inputs'
          ],
          evidenceRefs: ['security.inputValidation', 'backend.requestSchemas']
        },
        a04_insecureDesign: {
          verdict: 'mitigated',
          mitigations: [
            'Deny-by-default everywhere',
            'Defence in depth on tenant isolation (schema + credentials + RLS + tenant_id column)',
            'Locked stack defaults reviewed by EA Reviewer'
          ],
          evidenceRefs: ['security.tenantIsolationGuarantees', 'security.authorizationRules']
        },
        a05_securityMisconfiguration: {
          verdict: 'mitigated',
          mitigations: [
            'Locked HTTP security headers (CSP/HSTS/XFO/COOP/COEP/CORP)',
            'rejectUnknownKeys=true on input validation',
            'Architect contract enforces locked defaults; overrides flagged'
          ],
          evidenceRefs: ['security.securityHeaders', 'security.inputValidation']
        },
        a06_vulnerableComponents: {
          verdict: 'mitigated',
          mitigations: [
            'Pinned lockfiles (pnpm-lock.yaml)',
            'Dependabot enabled at repo level',
            'Renovate/Dependabot SBOM scan in CI'
          ],
          evidenceRefs: ['devops.cicdPipeline']
        },
        a07_authFailures: {
          verdict: 'mitigated',
          mitigations: [
            'MFA required for admin + BYOK + operator roles',
            'JWT 15-min access TTL with sliding refresh',
            'Failed-login alert at 5 attempts in 60s'
          ],
          evidenceRefs: ['security.authenticationStrategy', 'security.auditLogRequirements']
        },
        a08_softwareDataIntegrity: {
          verdict: 'mitigated',
          mitigations: [
            'Subresource Integrity on any external script',
            'Signed CI artifacts (DevOps Architect owns the implementation)',
            'Audit log captures every deploy event'
          ],
          evidenceRefs: ['security.securityHeaders', 'security.auditLogRequirements']
        },
        a09_loggingMonitoringFailures: {
          verdict: 'mitigated',
          mitigations: [
            '365-day retention on the central secure audit sink',
            'Required event types include auth.login.failure, authz.deny, secrets.access, tenant.isolation.breach.attempt',
            'Alert thresholds defined for high-signal events'
          ],
          evidenceRefs: ['security.auditLogRequirements']
        },
        a10_ssrf: {
          verdict: 'mitigated',
          mitigations: [
            'No user-controlled URL is fetched server-side from this endpoint',
            'When server-side fetch is required, IP allowlist via egress proxy',
            'Block RFC1918 + link-local + metadata IPs at the edge'
          ],
          evidenceRefs: ['security.inputValidation']
        }
      },
      'security.securityHeaders': {
        csp: {
          directive: 'strict-dynamic',
          nonceSource: 'middleware',
          defaultSrc: ["'self'"],
          frameSrc: ["'none'"],
          scriptSrc: ["'self'", "'strict-dynamic'"],
          styleSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          reportUri: '/_security/csp-report'
        },
        hsts: { maxAgeSec: 31536000, includeSubDomains: true, preload: true },
        xFrameOptions: 'DENY',
        xContentTypeOptions: 'nosniff',
        referrerPolicy: 'strict-origin-when-cross-origin',
        permissionsPolicy: { geolocation: '()', camera: '()', microphone: '()' },
        coop: 'same-origin',
        coep: 'require-corp',
        corp: 'same-origin'
      },
      'security.inputValidation': {
        perEndpoint: {
          'POST /api/contacts': {
            requestSchemaRef: 'ContactCreate',
            sanitization: {
              trim: true, stripHtml: true, canonicalize: 'NFC',
              maxBodyBytes: 65536, allowedContentTypes: ['application/json']
            }
          }
        },
        globalDefaults: {
          maxBodyBytes: 1048576,
          allowedContentTypes: ['application/json'],
          rejectUnknownKeys: true
        }
      },
      'security.rateLimitingRules': {
        default: { windowSec: 60, max: 60, scope: 'tenant', burst: 10 },
        perEndpoint: {
          'POST /api/contacts': {
            windowSec: 60, max: 10, scope: 'ip', burst: 2,
            onLimit: '429-retry-after', penaltySec: 300
          }
        },
        perAuthTier: {
          public: { windowSec: 60, max: 20, scope: 'ip' },
          authenticated: { windowSec: 60, max: 120, scope: 'user' },
          service: { windowSec: 60, max: 600, scope: 'tenant' }
        }
      },
      'security.auditLogRequirements': {
        sink: 'central-secure-store',
        retentionDays: 365,
        perEventType: {
          'auth.login.success': { fields: ['userId', 'tenantId', 'ip', 'userAgent'], sensitivity: 'internal' },
          'auth.login.failure': { fields: ['attemptedUser', 'ip', 'reason'], sensitivity: 'internal', alertThreshold: { count: 5, windowSec: 60 } },
          'authz.deny': { fields: ['userId', 'tenantId', 'action', 'resource', 'reason'], sensitivity: 'internal' },
          'secrets.access': { fields: ['actor', 'secretName', 'operation'], sensitivity: 'sensitive' },
          'role.change': { fields: ['actor', 'target', 'fromRole', 'toRole'], sensitivity: 'internal' },
          'tenant.isolation.breach.attempt': { fields: ['actor', 'attemptedTenantId', 'actualTenantId'], sensitivity: 'sensitive', alertThreshold: { count: 1, windowSec: 1 } }
        },
        redactionRules: ['password', 'token', 'secret', 'authorization', 'cookie', 'ssn', 'creditCard']
      },
      'security.tenantIsolationGuarantees': {
        model: 'schema-per-tenant',
        enforcement: [
          'schema-search-path',
          'scoped-db-credentials',
          'rls-defence-in-depth',
          'tenant-id-on-every-row',
          'query-fingerprint-audit'
        ],
        credentialScope: 'per-tenant-app-role',
        crossTenantAccess: 'forbidden-without-operator-elevation',
        breachDetection: { queryFingerprintsLog: true, unexpectedSchemaTouchAlert: true },
        testingHooks: [
          'tenant-fence-property-test',
          'cross-tenant-leak-test',
          'rls-bypass-attempt-test'
        ]
      }
    },
    confidence: 0.9,
    notes:
      'Public contact-form endpoint locked to IP-scoped 10/min rate limit + CSP strict-dynamic + HSTS preload + tenant-isolated schema-per-tenant. OWASP top-10 fully covered with concrete mitigations cross-referenced to Backend + Database upstream outputs.',
    dependencies: ['backend', 'database'],
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
      text, inputTokens: 1000, outputTokens: 500, usdCost: 0.01,
      wallClockMs: 1234, model: input.budget.preferredModel,
      ok, diagnostic: ok ? null : 'forced failure'
    };
  };
  return { fn, calls };
}

export function fakeGoldenSpawner(): FakeSpawner {
  return fakeSpawnerReturning(goldenAssistantText());
}

export function assertCoversAllOwnedFields(output: ArchitectOutput): void {
  const have = new Set(Object.keys(output.architectureFields));
  for (const k of SECURITY_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
