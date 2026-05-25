import { describe, expect, it } from 'vitest';
import { Ingestor } from '../../src/ingestor.js';
import { UxUploadsRepo } from '../../src/persistence.js';
import { FakePool } from '../helpers/fake-pg.js';
import {
  StubAdapter,
  StubSnapshotter,
  asSnapshotter,
  minimalDesign,
} from '../helpers/fixtures.js';
import { IngestionError } from '../../src/errors.js';
import type { AdapterInput } from '../../src/types.js';

function setup() {
  const pg = new FakePool();
  const repo = new UxUploadsRepo(pg);
  const snap = new StubSnapshotter();
  const ingestor = new Ingestor({
    uxUploads: repo,
    snapshotter: asSnapshotter(snap),
  });
  return { pg, repo, snap, ingestor };
}

const INPUT: AdapterInput = { kind: 'upload', uploadId: 'u1', tenantId: 't1' };

describe('Ingestor.ingest', () => {
  it('happy path: parsed status + captures snapshot v1', async () => {
    const { ingestor, repo, snap } = setup();
    const id = await ingestor.createUpload({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    const adapter = new StubAdapter();
    const r = await ingestor.ingest(id, adapter, INPUT);
    expect(r.status).toBe('parsed');
    expect(r.versionNumber).toBe(1);
    expect(snap.captureCalls).toHaveLength(1);
    const row = await repo.getById(id);
    expect(row?.status).toBe('parsed');
  });

  it('short-circuits on adapter.validate({ok: false})', async () => {
    const { ingestor, repo, snap } = setup();
    const id = await ingestor.createUpload({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    const adapter = new StubAdapter({
      validateResult: {
        ok: false,
        warnings: [],
        errors: [{ code: 'missing-readme', message: 'README.md missing' }],
      },
    });
    await expect(ingestor.ingest(id, adapter, INPUT)).rejects.toThrow(IngestionError);
    expect(adapter.parseCalls).toBe(0);
    expect(snap.captureCalls).toHaveLength(0);
    const row = await repo.getById(id);
    expect(row?.status).toBe('failed');
  });

  it('translates parse timeout into failed', async () => {
    const { ingestor, repo } = setup();
    const id = await ingestor.createUpload({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    const adapter = new StubAdapter({ parseDelayMs: 60 });
    await expect(
      ingestor.ingest(id, adapter, INPUT, { parseTimeoutMs: 10 }),
    ).rejects.toThrow(IngestionError);
    const row = await repo.getById(id);
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toMatch(/timed out/i);
  });

  it('marks failed when adapter.parse throws', async () => {
    const { ingestor, repo } = setup();
    const id = await ingestor.createUpload({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    const adapter = new StubAdapter({ parseError: new Error('zip corrupt') });
    await expect(ingestor.ingest(id, adapter, INPUT)).rejects.toThrow(IngestionError);
    const row = await repo.getById(id);
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toMatch(/zip corrupt/);
  });

  it('rejects malformed RenderableDesign output', async () => {
    const { ingestor, repo } = setup();
    const id = await ingestor.createUpload({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    const adapter = new StubAdapter({
      parseResult: { designVersionId: '' } as unknown as ReturnType<typeof minimalDesign>,
    });
    await expect(ingestor.ingest(id, adapter, INPUT)).rejects.toThrow(IngestionError);
    const row = await repo.getById(id);
    expect(row?.status).toBe('failed');
  });

  it('passes notes through to snapshotter.captureSnapshot', async () => {
    const { ingestor, snap } = setup();
    const id = await ingestor.createUpload({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    const adapter = new StubAdapter();
    await ingestor.ingest(id, adapter, INPUT, { notes: 'initial import' });
    expect(snap.captureCalls).toHaveLength(1);
  });

  it('records non-zero parse_duration_ms', async () => {
    const { ingestor, repo } = setup();
    let n = 0;
    const ingestor2 = new Ingestor({
      uxUploads: new UxUploadsRepo(new FakePool()),
      snapshotter: asSnapshotter(new StubSnapshotter()),
      now: () => {
        n += 50;
        return n;
      },
    });
    void ingestor;
    void repo;
    const pg = new FakePool();
    const repo2 = new UxUploadsRepo(pg);
    const fastIngestor = new Ingestor({
      uxUploads: repo2,
      snapshotter: asSnapshotter(new StubSnapshotter()),
      now: () => {
        n += 100;
        return n;
      },
    });
    void ingestor2;
    const id = await fastIngestor.createUpload({
      tenantId: 't1',
      source: 'cd-zip',
      sourceMetadata: {},
    });
    const adapter = new StubAdapter();
    const r = await fastIngestor.ingest(id, adapter, INPUT);
    expect(r.parseDurationMs).toBeGreaterThan(0);
  });
});
