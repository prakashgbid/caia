/**
 * Test fixtures + fake spawner factory.
 *
 *   - `buildFakeInput()` — produces a deterministic `ArchitectInput` for
 *     a known prakash-tiwari Site/Page ticket. The golden test uses this.
 *
 *   - `fakeSpawnerReturning(text)` — fabricates an `ArchitectSpawnerFn`
 *     that returns the given text deterministically.
 *
 *   - `goldenExpectedOutput()` — the canonical known-good
 *     `ArchitectOutput` for the prakash-tiwari fixture.
 */

import type { ArchitectInput, ArchitectOutput } from '../../src/types.js';

import { UX_VERSION_CONTROL_OWNED_FIELD_KEYS } from '../../src/contract.js';
import type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from '../../src/spawner.js';

/**
 * The canonical fixture — a Site-scope ticket for the prakash-tiwari.com
 * marketing site, focused on a UX upload (the design IR + anchors map).
 * The UX Version Control architect spec'd here governs how every uploaded
 * version of this design is preserved, diffed, reverted, and audited.
 */
export function buildFakeInput(): ArchitectInput {
  return {
    ticket: {
      id: 'ticket-pt-015',
      type: 'Page',
      scope: 'story',
      parent_id: null,
      acceptance_criteria: [
        'Every UX upload for /artists/[slug] is preserved forever in immutable R2 storage.',
        'Operator can revert the page design to any past upload in one CLI invocation.',
        'Design revert is forward-creating: a revert is itself a new design version at the chain tip.',
        'Diff between any two design versions narrates as "added X sections, modified Y widgets, removed Z anchors".',
        'Audit trail records who uploaded/reverted, when, versionId, parentVersionId, eventKind, and reason.',
        'GDPR delete on a design-asset anonymizes the matching version field; never hard-deletes the version row.'
      ],
      business_requirements: {
        title: 'Artist booking page with UX version control',
        description:
          'The /artists/[slug] page is the conversion surface for prakash-tiwari.com. Designers iterate on it weekly. UX Version Control preserves every uploaded design forever in immutable R2, supports forward-creating revert to any prior version, and renders semantic diffs across the five canonical layers (tree/token/copy/asset/interactivity).'
      },
      quality_tags: ['versioned', 'ux-version-control']
    },
    upstream: { outputs: {} },
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
          anchorId: 'hero',
          kind: 'section',
          bbox: { x: 0, y: 0, w: 1440, h: 720 },
          meta: { variant: 'hero' }
        },
        {
          anchorId: 'hero-cta-primary',
          kind: 'button',
          bbox: { x: 600, y: 320, w: 200, h: 56 },
          meta: { variant: 'primary' }
        },
        {
          anchorId: 'booking-form',
          kind: 'form',
          bbox: { x: 0, y: 720, w: 1440, h: 600 },
          meta: { fields: ['name', 'email', 'date'] }
        }
      ]
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
    architectName: 'ux-version-control',
    architectureFields: {
      'uxVersionControl.designVersionRetention': {
        maxVersionsKept: 'unlimited',
        retentionDays: 'forever',
        archivalSink: 'r2://tenant-prakash-tiwari-design-versions-cold/',
        archivalAfterDays: 90,
        gdprInteraction: 'anonymize-in-version',
        tenantOverrideAllowed: true,
        preservationGuarantee: 'immutable-r2-storage'
      },
      'uxVersionControl.revertOperation': {
        invocation: 'caia ux-version-control revert --version <versionId>',
        scope: 'design',
        idempotencyKey: 'artists-slug-page:<targetVersionId>',
        forwardCreating: true,
        replayMode: 'selective',
        selectiveRevertScope: ['hero', 'hero-cta-primary', 'booking-form'],
        postCondition:
          'design returns to upload captured at version V; a new version V+N is appended documenting the revert'
      },
      'uxVersionControl.diffVisualizationSpec': {
        renderSurface: 'atlas-design-snapshotter',
        diffLayers: ['tree', 'token', 'copy', 'asset', 'interactivity'],
        narrationStyle: 'semantic',
        anchorRefs: ['hero', 'hero-cta-primary', 'booking-form']
      },
      'uxVersionControl.branchingStrategy': {
        forkAllowed: false,
        mergeStrategy: 'manual-merge',
        abandonmentPolicy: 'auto-archive-after-30-days',
        namingTemplate: '<parent-versionId>-fork-<ulid>',
        maxConcurrentBranches: 5
      },
      'uxVersionControl.auditTrail': {
        logSink: ['stdout-structured', 'postgres:audit_ux_version_events'],
        attributedFields: [
          'who',
          'when',
          'versionId',
          'parentVersionId',
          'eventKind',
          'reason'
        ],
        retentionDays: 2555,
        immutability: 'append-only',
        queryability: {
          byOperator: true,
          byVersion: true,
          byTimeRange: true,
          byEventKind: true
        }
      }
    },
    confidence: 0.9,
    notes:
      'Page-scope UX version control for /artists/[slug]. Preservation forever in immutable R2; archive cold after 90 days. Forward-creating revert at design scope; replayMode=selective so only tickets touching the reverted anchors are re-architected. Diff renders via atlas-design-snapshotter across all five canonical layers with semantic narration. Branching OFF in V1 (forkAllowed=false). Audit trail at 7-year regulatory floor, append-only, attributed to operator + UTC time + versionId + parentVersionId + eventKind + reason.',
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
  for (const k of UX_VERSION_CONTROL_OWNED_FIELD_KEYS) {
    if (!have.has(k)) throw new Error(`fixture missing owned field: ${k}`);
  }
}
