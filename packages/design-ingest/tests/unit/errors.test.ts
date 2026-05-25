import { describe, expect, it } from 'vitest';
import {
  DesignIngestError,
  IngestionError,
  NotImplementedError,
  ProviderNotSupported,
  RefreshNotSupported,
} from '../../src/errors.js';

describe('errors', () => {
  it('ProviderNotSupported carries the source code', () => {
    const e = new ProviderNotSupported('cd-zip', { tenantId: 't1' });
    expect(e.code).toBe('provider_not_supported');
    expect(e.context).toMatchObject({ source: 'cd-zip', tenantId: 't1' });
    expect(e.name).toBe('ProviderNotSupported');
  });

  it('RefreshNotSupported carries the source name', () => {
    const e = new RefreshNotSupported('cd-zip');
    expect(e.code).toBe('refresh_not_supported');
    expect(e.context).toMatchObject({ sourceName: 'cd-zip' });
  });

  it('NotImplementedError carries the "what"', () => {
    const e = new NotImplementedError('CD ZIP parse');
    expect(e.code).toBe('not_implemented');
    expect(e.context).toMatchObject({ what: 'CD ZIP parse' });
  });

  it('IngestionError carries cause when supplied', () => {
    const cause = new Error('boom');
    const e = new IngestionError('parse failed', { uxUploadId: 'u1' }, cause);
    expect(e.code).toBe('ingestion_failed');
    expect(e.cause).toBe(cause);
  });

  it('DesignIngestError is the common base', () => {
    const e = new ProviderNotSupported('cd-zip');
    expect(e).toBeInstanceOf(DesignIngestError);
    expect(e).toBeInstanceOf(Error);
  });
});
