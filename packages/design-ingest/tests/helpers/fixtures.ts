/**
 * Test fixtures shared across unit-test files.
 */

import type { RenderableDesign } from '../../src/schema.js';
import type {
  AdapterCapabilities,
  AdapterDeps,
  AdapterInput,
  DesignAdapter,
  ValidationResult,
} from '../../src/types.js';
import type { SourceName } from '../../src/schema.js';
import type {
  DesignSnapshotter,
  DesignVersion,
} from '@caia/atlas-design-snapshotter';
import type { SecretsAdapter } from '@caia/secrets-adapter';

export function minimalDesign(overrides?: Partial<RenderableDesign>): RenderableDesign {
  return {
    designVersionId: 'dv-test-1',
    routes: [
      {
        path: '/',
        componentTreeId: 'tree:home',
      },
    ],
    componentTrees: {
      'tree:home': {
        rootDomId: 'page-home',
        node: {
          domId: 'page-home',
          tag: 'main',
          role: 'page',
          children: [
            {
              domId: 'page-home>section-hero',
              tag: 'section',
              role: 'section',
              children: [
                {
                  domId: 'page-home>section-hero>widget-headline',
                  tag: 'h1',
                  role: 'widget',
                  copyRefs: ['page-home>section-hero>widget-headline>copy-0'],
                },
              ],
            },
          ],
        },
      },
    },
    copy: [
      {
        domId: 'page-home>section-hero>widget-headline>copy-0',
        text: 'Hello world',
      },
    ],
    designTokens: {
      colors: { '--ink': '#000', '--paper': '#fff' },
    },
    ...overrides,
  } as RenderableDesign;
}

export function stubCapabilities(
  overrides: Partial<AdapterCapabilities> = {},
): AdapterCapabilities {
  return {
    supportsRefresh: false,
    supportsLiveWebhook: false,
    requiresCredential: false,
    ...overrides,
  };
}

export interface StubAdapterOpts {
  sourceName?: SourceName;
  validateResult?: ValidationResult;
  parseResult?: RenderableDesign;
  parseError?: Error;
  parseDelayMs?: number;
  capabilities?: AdapterCapabilities;
}

export class StubAdapter implements DesignAdapter {
  public readonly sourceName: SourceName;
  public readonly capabilities: AdapterCapabilities;
  public validateCalls = 0;
  public parseCalls = 0;
  public refreshCalls = 0;
  private readonly opts: StubAdapterOpts;

  constructor(opts: StubAdapterOpts = {}) {
    this.opts = opts;
    this.sourceName = opts.sourceName ?? 'cd-zip';
    this.capabilities = opts.capabilities ?? stubCapabilities();
  }

  async validate(_input: AdapterInput): Promise<ValidationResult> {
    this.validateCalls++;
    return (
      this.opts.validateResult ?? {
        ok: true,
        warnings: [],
        errors: [],
      }
    );
  }

  async parse(_input: AdapterInput): Promise<RenderableDesign> {
    this.parseCalls++;
    if (this.opts.parseDelayMs !== undefined) {
      await new Promise((r) => setTimeout(r, this.opts.parseDelayMs));
    }
    if (this.opts.parseError) throw this.opts.parseError;
    return this.opts.parseResult ?? minimalDesign();
  }

  async refresh(_designVersionId: string): Promise<RenderableDesign> {
    this.refreshCalls++;
    return this.opts.parseResult ?? minimalDesign();
  }
}

// ---------------------------------------------------------------------------
// Stub snapshotter — returns a synthetic DesignVersion. The Ingestor only
// cares about `id` and `versionNumber` on the return, so we keep the
// rest minimal.
// ---------------------------------------------------------------------------

export class StubSnapshotter {
  public captureCalls: Array<{ uxUploadId: string; design: RenderableDesign }> = [];
  public deleteCalls: string[] = [];
  private nextVersion = 1;
  public deleteFails = false;

  async captureSnapshot(
    uxUploadId: string,
    design: RenderableDesign,
  ): Promise<DesignVersion> {
    this.captureCalls.push({ uxUploadId, design });
    const v = this.nextVersion++;
    return {
      id: `dv-${v}`,
      tenantId: 'tenant-1',
      uxUploadId,
      versionNumber: v,
      parentVersionId: v > 1 ? `dv-${v - 1}` : null,
      renderedDesign: design,
      renderedDesignHash: 'sha256:fake',
      diffFromParent: null,
      diffSummary: null,
      notes: null,
      createdAt: new Date(),
    };
  }

  async deleteAllForTenant(
    tenantId: string,
    _opts?: { dryRun?: boolean },
  ): Promise<{
    deletedVersionCount: number;
    deletedAssetCount: number;
    deletedBlobCount: number;
    tenantTombstoneRef: string;
  }> {
    this.deleteCalls.push(tenantId);
    if (this.deleteFails) throw new Error('boom: snapshotter delete failed');
    return {
      deletedVersionCount: 3,
      deletedAssetCount: 5,
      deletedBlobCount: 5,
      tenantTombstoneRef: `tombstone:${tenantId}:snap`,
    };
  }
}

export function asSnapshotter(s: StubSnapshotter): DesignSnapshotter {
  return s as unknown as DesignSnapshotter;
}

// ---------------------------------------------------------------------------
// Stub secrets adapter.
// ---------------------------------------------------------------------------

export class StubSecrets {
  public deleteCalls: string[] = [];
  public deleteFails = false;

  async deleteAllForTenant(
    tenantId: string,
    _opts?: { dryRun?: boolean },
  ): Promise<{ deletedCount: number; tenantTombstoneRef: string }> {
    this.deleteCalls.push(tenantId);
    if (this.deleteFails) throw new Error('boom: secrets delete failed');
    return {
      deletedCount: 4,
      tenantTombstoneRef: `tombstone:${tenantId}:secrets`,
    };
  }
}

export function asSecrets(s: StubSecrets): SecretsAdapter {
  return s as unknown as SecretsAdapter;
}

export function adapterDepsForTests(opts: {
  pg: AdapterDeps['pg'];
  snapshotter: DesignSnapshotter;
  secrets: SecretsAdapter;
  storage?: AdapterDeps['storage'];
}): AdapterDeps {
  return {
    pg: opts.pg,
    snapshotter: opts.snapshotter,
    secrets: opts.secrets,
    storage: (opts.storage ?? ({} as AdapterDeps['storage'])) as AdapterDeps['storage'],
    accessContext: {
      callerType: 'agent',
      callerId: 'test-agent',
      reason: 'unit-test',
    },
  };
}
