import { describe, expect, it } from 'vitest';
import { CdZipAdapter } from '../../src/index.js';
import {
  NotImplementedError,
  RefreshNotSupported,
} from '@caia/design-ingest';
import type { AdapterDeps, AdapterInput } from '@caia/design-ingest';

const fakeDeps = {
  pg: {} as AdapterDeps['pg'],
  snapshotter: {} as AdapterDeps['snapshotter'],
  secrets: {} as AdapterDeps['secrets'],
  storage: {} as AdapterDeps['storage'],
  accessContext: {
    callerType: 'agent' as const,
    callerId: 'test',
    reason: 'unit-test',
  },
};

const INPUT: AdapterInput = { kind: 'upload', uploadId: 'u1', tenantId: 't1' };

describe('CdZipAdapter (scaffold)', () => {
  it('declares sourceName = cd-zip', () => {
    const a = new CdZipAdapter(fakeDeps);
    expect(a.sourceName).toBe('cd-zip');
  });

  it('declares non-refresh, non-webhook, no-credential capabilities', () => {
    const a = new CdZipAdapter(fakeDeps);
    expect(a.capabilities.supportsRefresh).toBe(false);
    expect(a.capabilities.supportsLiveWebhook).toBe(false);
    expect(a.capabilities.requiresCredential).toBe(false);
  });

  it('validate throws NotImplementedError', async () => {
    const a = new CdZipAdapter(fakeDeps);
    await expect(a.validate(INPUT)).rejects.toThrow(NotImplementedError);
  });

  it('parse throws NotImplementedError', async () => {
    const a = new CdZipAdapter(fakeDeps);
    await expect(a.parse(INPUT)).rejects.toThrow(NotImplementedError);
  });

  it('refresh throws RefreshNotSupported (terminal — will stay this way)', async () => {
    const a = new CdZipAdapter(fakeDeps);
    await expect(a.refresh('dv-1')).rejects.toThrow(RefreshNotSupported);
  });
});
