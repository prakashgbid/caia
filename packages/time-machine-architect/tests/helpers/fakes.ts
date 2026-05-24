/**
 * Test fixtures + fake spawner factory.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { TIME_MACHINE_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

function fakeBackendUpstream(): ArchitectOutput {
  return {
    architectName: 'backend',
    architectureFields: {
      'backend.endpointEnumeration': [
        {
          path: '/api/artists/[slug]/book',
          method: 'POST',
          handler: 'createBookingRequest',
          mutates: true
        },
        {
          path: '/api/artists/[slug]/contact',
          method: 'POST',
          handler: 'submitContactForm',
          mutates: true
        }
      ],
      'backend.handlerShape': {
        createBookingRequest: { reads: ['artists'], writes: ['booking_requests'] },
        submitContactForm: { reads: [], writes: ['contact_submissions'] }
      },
      'backend.errorEnvelope': { shape: { code: 'string', message: 'string' } }
    },
    confidence: 0.9,
    notes: 'fake upstream backend output for time-machine fixture',
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
      'database.tables': [
        { name: 'booking_requests', primaryKey: 'id', scope: 'tenant-scoped' },
        { name: 'contact_submissions', primaryKey: 'id', scope: 'tenant-scoped' }
      ],
      'database.dataLifecycle': [
        {
          table: 'booking_requests',
          retentionDays: 1825,
          archivalSink: 'r2://pt-archive/',
          gdprDeleteStrategy: 'anonymize',
          cascadeOnUserDelete: true
        },
        {
          table: 'contact_submissions',
          retentionDays: 365,
          archivalSink: 'r2://pt-archive/',
          gdprDeleteStrategy: 'anonymize',
          cascadeOnUserDelete: true
        }
      ],
      'database.tenantIsolationStrategy': {
        model: 'schema-per-tenant',
        schemaNameTemplate: 'pt_<tenant_id>'
      },
      'database.jsonbShapes': {}
    },
    confidence: 0.9,
    notes: 'fake upstream database output for time-machine fixture',
    dependencies: [],
    risks: [],
    toolCalls: [],
    spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
    status: 'ok'
  };
}

export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-014',
      type: 'Page',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'Every deploy of /artists/[slug] is snapshotted before traffic flips.',
        'Operator can revert the page to any of the last 90 days of snapshots in one CLI invocation.',
        'Revert is forward-creating: a revert is itself a new snapshot at the chain tip.',
        'Audit trail records who reverted, when, and from/to snapshot keys.',
        'GDPR delete on a booking_requests row anonymizes the matching snapshot field; never hard-deletes the snapshot.'
      ],
      business_requirements: {
        title: 'Artist booking page with rollback',
        description:
          'The /artists/[slug] page is the conversion surface for prakash-tiwari.com. Operators must be able to safely roll back a broken deploy without losing the historical chain. Time Machine wires snapshot + revert into the deploy pipeline.'
      },
      quality_tags: ['versioned', 'rollback']
    },
    upstream: {
      outputs: {
        backend: fakeBackendUpstream(),
        database: fakeDatabaseUpstream()
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
      anchors: [{ anchorId: 'page-root', kind: 'page' }]
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
    architectName: 'time-machine',
    architectureFields: {
      'timeMachine.versioningStrategy': {
        snapshotKeyTemplate: '<tenant>/<feature>/<commit-sha>',
        commitGraph: 'linear',
        immutability: 'append-only',
        snapshotStorage: {
          provider: 'r2',
          pathTemplate:
            'r2://tenant-prakash-tiwari-snapshots/artists-slug-page/<commit-sha>.json'
        }
      },
      'timeMachine.snapshotRetention': {
        retentionDays: 90,
        archivalSink: 'r2://tenant-prakash-tiwari-snapshots-cold/',
        archivalAfterDays: 30,
        gdprInteraction: 'anonymize-in-snapshot',
        tenantOverrideAllowed: true
      },
      'timeMachine.revertOperation': {
        invocation: 'caia time-machine revert --snapshot <key>',
        scope: 'feature',
        idempotencyKey: 'artists-slug-page:<targetSnapshot>',
        forwardCreating: true,
        postCondition:
          'feature returns to behavior captured at snapshot S; a new snapshot S+N is appended documenting the revert'
      },
      'timeMachine.descriptionGeneration': {
        styleGuide: 'action-first verb phrase',
        minWords: 5,
        maxWords: 15,
        tense: 'present',
        regenerationPolicy: 'on-revert-only'
      },
      'timeMachine.dataConsistency': {
        transactionalPosture: 'atomic',
        dbStateSnapshot: {
          tables: ['booking_requests', 'contact_submissions'],
          jsonbShapesRef: 'database.jsonbShapes'
        },
        applicationStateSnapshot: {
          caches: ['edge-cache:/artists/[slug]'],
          queues: []
        },
        cascadeOnRevert: [
          {
            table: 'booking_requests',
            action: 'leave',
            reason:
              'user-submitted booking requests outlive the page schema; reverting the page does not unwind real customer commitments'
          },
          {
            table: 'contact_submissions',
            action: 'leave',
            reason: 'same rationale as booking_requests'
          }
        ],
        dependsOnDatabaseLifecycle: true
      },
      'timeMachine.auditTrail': {
        logSink: ['stdout-structured', 'postgres:audit_revert_events'],
        attributedFields: ['who', 'when', 'fromSnapshot', 'toSnapshot', 'scope', 'reason'],
        retentionDays: 2555,
        immutability: 'append-only',
        queryability: { byOperator: true, bySnapshot: true, byTimeRange: true }
      }
    },
    confidence: 0.88,
    notes:
      'Page-scope time-machine spec for /artists/[slug]. Linear commit graph, 90-day active retention with 7-year audit floor. Forward-creating revert: every revert appends a new snapshot. cascadeOnRevert leaves booking_requests + contact_submissions untouched because real customer data outlives the page schema. GDPR delete uses anonymize-in-snapshot to match database.dataLifecycle for both tables.',
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
  for (const k of TIME_MACHINE_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
