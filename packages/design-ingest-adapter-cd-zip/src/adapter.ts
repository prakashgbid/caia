/**
 * `CdZipAdapter` — implements `DesignAdapter` for Claude Design ZIP
 * exports.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §2.1.
 *
 * Status: SCAFFOLD-ONLY. See README for the deferred 7-stage pipeline.
 */

import type {
  AdapterCapabilities,
  AdapterDeps,
  AdapterInput,
  DesignAdapter,
  ValidationResult,
} from '@caia/design-ingest';
import type {
  RenderableDesign,
  SourceName,
} from '@caia/design-ingest';
import {
  NotImplementedError,
  RefreshNotSupported,
} from '@caia/design-ingest';

export type CdZipAdapterDeps = AdapterDeps;

const CAPABILITIES: AdapterCapabilities = Object.freeze({
  supportsRefresh: false,
  supportsLiveWebhook: false,
  requiresCredential: false,
});

export class CdZipAdapter implements DesignAdapter {
  public readonly sourceName: SourceName = 'cd-zip';
  public readonly capabilities: AdapterCapabilities = CAPABILITIES;

  // The constructor accepts deps so production wiring matches the
  // framework's `DesignAdapterCtor` signature. We don't store them
  // yet — the full impl will.
  constructor(_deps: CdZipAdapterDeps) {
    // intentionally empty
  }

  async validate(_input: AdapterInput): Promise<ValidationResult> {
    throw new NotImplementedError('CdZipAdapter.validate', {
      followUp: 'spec §2.1 — implements 7-stage pipeline',
    });
  }

  async parse(_input: AdapterInput): Promise<RenderableDesign> {
    throw new NotImplementedError('CdZipAdapter.parse', {
      followUp: 'spec §2.1 — implements 7-stage pipeline',
    });
  }

  /**
   * CD ZIP is upload-only — re-pull is not meaningful. This
   * implementation is terminal: it does not change when the full
   * pipeline lands.
   */
  async refresh(_designVersionId: string): Promise<RenderableDesign> {
    throw new RefreshNotSupported(this.sourceName);
  }
}
