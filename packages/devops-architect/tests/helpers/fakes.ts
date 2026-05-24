/**
 * Test fixtures + fake spawner factory for the DevOps Architect.
 *
 * The canonical fixture is a prakash-tiwari contact-form Form Story
 * ticket with wave-1/2 Backend + Database + Security upstream outputs.
 *
 * The golden output is deliberately constructed so the deploy strategy
 * (canary) matches the declared infrastructure capabilities
 * (traffic-split + multi-instance). The realism invariant verifies
 * the match.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { DEVOPS_OWNED_FIELD_KEYS } from '../../src/contract.js';
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
      ]
    },
    confidence: 0.9,
    notes: 'Form Story.',
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
      'database.migrations': [
        {
          id: '0001_create_contacts',
          description: 'Create contacts table.',
          up: 'CREATE TABLE contacts (...);',
          down: 'DROP TABLE contacts;',
          ordering: 1,
          requiresOperatorReview: false
        }
      ],
      'database.tenantIsolationStrategy': {
        model: 'schema-per-tenant',
        justification: 'matches CAIA meta cluster',
        schemaNameTemplate: 'tenant_{{tenantId}}',
        sharedTables: ['tenants', 'plans']
      }
    },
    confidence: 0.9,
    notes: 'Single tenant-scoped table.',
    dependencies: ['backend'],
    risks: [],
    toolCalls: [],
    spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
    status: 'ok'
  };
}

function fakeSecurityUpstream(): ArchitectOutput {
  return {
    architectName: 'security',
    architectureFields: {
      'security.secretsHandling': {
        provider: 'vault',
        namespace: 'tenant/{{tenantId}}',
        rotationPolicy: { kind: 'scheduled', intervalDays: 90 },
        injection: 'env-at-runtime',
        neverLog: ['password', 'token', 'secret', 'authorization', 'cookie']
      },
      'security.auditLogRequirements': {
        sink: 'central-secure-store',
        retentionDays: 365,
        perEventType: {
          'auth.login.failure': { fields: ['ip', 'reason'], sensitivity: 'internal' },
          'authz.deny': { fields: ['userId', 'action', 'resource'], sensitivity: 'internal' },
          'secrets.access': { fields: ['actor', 'secretName'], sensitivity: 'sensitive' },
          'tenant.isolation.breach.attempt': { fields: ['actor'], sensitivity: 'sensitive' }
        },
        redactionRules: ['password', 'token', 'secret', 'authorization', 'cookie']
      },
      'security.tenantIsolationGuarantees': {
        model: 'schema-per-tenant',
        enforcement: ['scoped-db-credentials', 'rls-defence-in-depth', 'tenant-id-on-every-row'],
        credentialScope: 'per-tenant-app-role',
        crossTenantAccess: 'forbidden-without-operator-elevation'
      }
    },
    confidence: 0.9,
    notes: 'Security baseline.',
    dependencies: ['backend', 'database'],
    risks: [],
    toolCalls: [],
    spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
    status: 'ok'
  };
}

export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-devops-001',
      type: 'Form',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'Production deploy completes in <10 min p95.',
        'Failed deploys auto-revert within 5 min of healthcheck failure.',
        'Staging→prod requires manual operator click.',
        'Build artifact is deterministic (pinned lockfile).',
        'Secrets never appear in repo or build artifact.'
      ],
      business_requirements: {
        title: 'Contact form submission deploy',
        description: 'Ship the public marketing contact-form endpoint to production via canary.'
      },
      quality_tags: ['form', 'public', 'persists', 'deploy']
    },
    upstream: {
      outputs: {
        backend: fakeBackendUpstream(),
        database: fakeDatabaseUpstream(),
        security: fakeSecurityUpstream()
      }
    },
    businessPlan: {
      ventureName: 'Prakash Tiwari Studio',
      oneLiner: 'Bespoke artist session booking.',
      audience: 'High-intent prospective sitters.',
      goals: ['Drive contact-form submissions'],
      brandVoice: 'warm + grounded',
      // Customer onboarding choices live here in V1.
      infrastructure: {
        ciProvider: 'github-actions',
        cloudProvider: 'cloudflare',
        iacTool: 'terraform',
        repoProvider: 'github'
      }
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
 *
 * Deploy strategy is `canary`; infra capabilities include
 * `traffic-split` + `multi-instance` — strategy/infra realism MATCHES.
 */
export function goldenExpectedOutput(): ArchitectOutput {
  return {
    architectName: 'devops',
    architectureFields: {
      'devops.cicdPipeline': {
        provider: 'github-actions',
        triggers: ['push', 'pull_request'],
        stages: [
          {
            name: 'lint',
            runs: ['pnpm install --frozen-lockfile', 'pnpm lint'],
            qualityGates: ['eslint-no-errors']
          },
          {
            name: 'typecheck',
            runs: ['pnpm typecheck'],
            qualityGates: ['tsc-no-errors']
          },
          {
            name: 'test',
            runs: ['pnpm test'],
            qualityGates: ['vitest-pass', 'coverage>=80']
          },
          {
            name: 'build',
            runs: ['pnpm build'],
            qualityGates: ['deterministic-artifact', 'lockfile-pinned']
          },
          {
            name: 'deploy',
            runs: ['pnpm deploy:canary'],
            qualityGates: [
              'lighthouse>=95',
              'axe-zero-violations',
              'csp-strict-dynamic',
              'healthcheck-passes'
            ]
          }
        ],
        retryPolicy: { maxRetries: 2, backoffSec: 30 }
      },
      'devops.deployStrategy': {
        kind: 'canary',
        trafficShift: [
          { phase: 'p10', pct: 10, dwellMin: 10 },
          { phase: 'p50', pct: 50, dwellMin: 10 },
          { phase: 'p100', pct: 100, dwellMin: 10 }
        ],
        healthcheckGate: {
          path: '/_health',
          timeoutSec: 30,
          expectStatus: 200
        },
        abortConditions: ['healthcheck-failure', 'error-rate>1%', 'p95-latency>2s']
      },
      'devops.rollbackContract': {
        trigger: { kind: 'healthcheck-failure', windowMin: 5 },
        method: 'hybrid',
        timeMachineSnapshotKey: 'ticket-pt-devops-001@pre-deploy',
        rtoMin: 5,
        dataMigrationRollback: {
          additive: 'auto',
          destructive: 'operator-forward-fix'
        }
      },
      'devops.infrastructureAsCode': {
        tool: 'terraform',
        modules: [
          {
            name: 'cloudflare-pages',
            source: 'caia-modules/cloudflare-pages',
            version: '1.x',
            purpose: 'Pages project + DNS routing'
          },
          {
            name: 'cloudflare-workers',
            source: 'caia-modules/cloudflare-workers',
            version: '1.x',
            purpose: 'API route handlers'
          },
          {
            name: 'vault-tenant-namespace',
            source: 'caia-modules/vault-tenant-namespace',
            version: '1.x',
            purpose: 'Per-tenant Vault AppRole + namespace provisioning'
          },
          {
            name: 'r2-archive',
            source: 'caia-modules/r2-archive',
            version: '1.x',
            purpose: 'GDPR archival sink for contacts table'
          }
        ],
        capabilities: ['traffic-split', 'multi-instance', 'multi-region']
      },
      'devops.environmentPromotion': {
        environments: [
          {
            name: 'dev',
            purpose: 'Feature-branch previews',
            autoPromote: true,
            gateKind: 'none'
          },
          {
            name: 'staging',
            purpose: 'Pre-prod integration',
            autoPromote: true,
            gateKind: 'none'
          },
          {
            name: 'prod',
            purpose: 'Production traffic',
            autoPromote: false,
            gateKind: 'manual',
            gateOwner: 'operator',
            perTenant: true
          }
        ],
        promotionFlow: [
          { from: 'dev', to: 'staging', condition: 'auto-on-merge-to-main' },
          { from: 'staging', to: 'prod', condition: 'manual-operator-click' }
        ],
        blockers: [
          'fail-on-test',
          'fail-on-lighthouse',
          'fail-on-security-deny',
          'fail-on-database-review'
        ]
      },
      'devops.deploymentObservability': {
        sinkRef: 'security.auditLogRequirements.sink',
        events: [
          {
            name: 'deploy.started',
            attributes: ['tenantId', 'ticketId', 'gitSha', 'environment', 'strategy'],
            retentionDays: 365
          },
          {
            name: 'deploy.succeeded',
            attributes: ['tenantId', 'ticketId', 'gitSha', 'environment', 'strategy', 'durationMs', 'healthcheckLatencyMs'],
            retentionDays: 365
          },
          {
            name: 'deploy.failed',
            attributes: ['tenantId', 'ticketId', 'gitSha', 'environment', 'strategy', 'durationMs', 'reason'],
            retentionDays: 365,
            alertThreshold: { count: 1, windowSec: 60 }
          },
          {
            name: 'deploy.rollback.triggered',
            attributes: ['tenantId', 'ticketId', 'gitSha', 'environment', 'rollbackReason'],
            retentionDays: 365,
            alertThreshold: { count: 1, windowSec: 60 }
          },
          {
            name: 'deploy.healthcheck.failed',
            attributes: ['tenantId', 'ticketId', 'environment', 'healthcheckLatencyMs', 'status'],
            retentionDays: 365,
            alertThreshold: { count: 3, windowSec: 300 }
          }
        ]
      },
      'devops.secretsManagementInPipeline': {
        provider: 'vault-via-security-architect',
        securityArchitectRef: 'security.secretsHandling',
        injectionPoint: 'env-at-runtime',
        tokenLifetimeMin: 60,
        neverInArtifact: ['password', 'token', 'secret', 'authorization', 'api-key'],
        rotationOnRoleChange: true
      }
    },
    confidence: 0.9,
    notes:
      'Canary deploy strategy locked to GitHub Actions + Terraform + Cloudflare per onboarding. Traffic shift 10%→50%→100% with /_health gate + 5-min auto-revert window using Time Machine snapshot key. Manual operator gate at staging→prod. Secrets forward-referenced to Security Architect; never in artifact. All 5 deploy event types emit to Security audit sink with 365-day retention.',
    dependencies: ['backend', 'database', 'security'],
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
  for (const k of DEVOPS_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
