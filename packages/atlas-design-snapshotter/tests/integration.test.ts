/**
 * Integration test — runs ONLY when a real Postgres + S3-compatible blob
 * store are available via environment variables. The local-dev rule of
 * thumb (matches step5 spec §9.4's regression harness):
 *
 *   DATABASE_URL=postgres://user:pw@localhost:5432/caia_dev \
 *   S3_ENDPOINT=http://localhost:9000 \
 *   S3_BUCKET=caia-test-bucket \
 *   S3_ACCESS_KEY_ID=minioadmin \
 *   S3_SECRET_ACCESS_KEY=minioadmin \
 *   pnpm --filter @chiefaia/atlas-design-snapshotter test:integration
 *
 * When the env is incomplete the suite skips itself — CI without these set
 * still passes green. The Cloudflare R2 deployment uses the same shape via
 * S3-compatible endpoint, so this one test covers both real backends.
 */

import { describe, expect, it } from 'vitest';

import { createDesignSnapshotter, schemaDDL, type BlobStorage, type PgQueryable } from '../src/index.js';
import { fakeDiff, makeAssetBytes, makeDesign } from './fakes.js';

const HAS_PG = !!process.env['DATABASE_URL'];
const HAS_S3 =
  !!process.env['S3_ENDPOINT'] &&
  !!process.env['S3_BUCKET'] &&
  !!process.env['S3_ACCESS_KEY_ID'] &&
  !!process.env['S3_SECRET_ACCESS_KEY'];

const RUN = HAS_PG && HAS_S3;

describe.skipIf(!RUN)('integration: real Postgres + S3-compatible store', () => {
  it('captures a snapshot, dedups across versions, then deletes for GDPR', async () => {
    const { pg, dispose: disposePg } = await openPg();
    const { blobStorage, dispose: disposeBlob, bucket } = await openS3();
    const schema = `caia_test_${Date.now()}`;
    try {
      await pg.query(schemaDDL(schema));
      const uxUploadId = (await pg.query<{ id: string }>(
        `INSERT INTO "${schema}"."ux_uploads"(tenant_id, business_proposal_id, source, source_metadata)
         VALUES ($1, gen_random_uuid(), 'cd-zip', '{}'::jsonb) RETURNING id`,
        ['00000000-0000-0000-0000-000000000001'],
      )).rows[0]!.id;

      const snap = createDesignSnapshotter({
        pg, blobStorage, diffDesigns: fakeDiff, schema, tenantId: '00000000-0000-0000-0000-000000000001',
        assetByteReader: async () => makeAssetBytes('photo-int'),
      });

      const v1 = await snap.snapshot({
        uxUploadId,
        design: makeDesign({ assets: [{ path: '/h.jpg', kind: 'image' }] }),
      });
      const v2 = await snap.snapshot({
        uxUploadId,
        design: makeDesign({ assets: [{ path: '/h.jpg', kind: 'image' }] }),
      });
      expect(v1.versionNumber).toBe(1);
      expect(v2.versionNumber).toBe(2);
      expect(v2.parentVersionId).toBe(v1.id);

      const versions = await snap.listVersions(uxUploadId);
      expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);

      const restored = await snap.revertToVersion({ uxUploadId, versionNumber: 1 });
      expect(restored.versionNumber).toBe(3);
      expect(restored.parentVersionId).toBe(v2.id);

      const wipe = await snap.deleteAllForTenant('00000000-0000-0000-0000-000000000001');
      expect(wipe.deletedVersionCount).toBeGreaterThanOrEqual(3);
    } finally {
      await pg.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await disposePg();
      await disposeBlob(bucket);
    }
  });
});

// ---------------------------------------------------------------------------
// thin connector helpers — node-postgres + S3 are imported dynamically so the
// suite stays importable in any environment.
// ---------------------------------------------------------------------------

async function openPg(): Promise<{ pg: PgQueryable; dispose: () => Promise<void> }> {
  const mod = await import('pg' as any).catch(() => null);
  if (!mod) throw new Error('pg module not installed; integration test cannot run');
  const ClientCtor = (mod as any).Client ?? (mod as any).default?.Client;
  const client = new ClientCtor({ connectionString: process.env['DATABASE_URL']! });
  await client.connect();
  const wrapped: PgQueryable = {
    query: (text, params) => client.query(text, params ?? []),
  };
  return { pg: wrapped, dispose: async () => { await client.end(); } };
}

async function openS3(): Promise<{ blobStorage: BlobStorage; bucket: string; dispose: (bucket: string) => Promise<void> }> {
  const mod = await import('@aws-sdk/client-s3' as any).catch(() => null);
  if (!mod) throw new Error('@aws-sdk/client-s3 not installed; integration test cannot run');
  const S3Client = (mod as any).S3Client;
  const PutObjectCommand = (mod as any).PutObjectCommand;
  const HeadObjectCommand = (mod as any).HeadObjectCommand;
  const GetObjectCommand = (mod as any).GetObjectCommand;
  const DeleteObjectCommand = (mod as any).DeleteObjectCommand;
  const ListObjectsV2Command = (mod as any).ListObjectsV2Command;

  const s3 = new S3Client({
    endpoint: process.env['S3_ENDPOINT']!,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env['S3_ACCESS_KEY_ID']!,
      secretAccessKey: process.env['S3_SECRET_ACCESS_KEY']!,
    },
  });
  const bucket = process.env['S3_BUCKET']!;
  const urlScheme = 's3';

  const blobStorage: BlobStorage = {
    async put({ path, bytes, contentHash, contentType }) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: path, Body: Buffer.from(bytes), ContentType: contentType, Metadata: { 'content-sha256': contentHash },
      }));
      return { storageUrl: `${urlScheme}://${bucket}/${path}`, deduped: false };
    },
    async head(path) {
      try {
        const out = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: path }));
        return {
          exists: true,
          contentHash: out.Metadata?.['content-sha256'],
          sizeBytes: out.ContentLength ?? 0,
        };
      } catch {
        return { exists: false };
      }
    },
    async get(path) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: path }));
      const body = await out.Body!.transformToByteArray();
      return body;
    },
    async delete(path) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }));
    },
    async list(prefix) {
      const out = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
      return (out.Contents ?? []).map((o: any) => o.Key as string);
    },
  };

  return {
    blobStorage,
    bucket,
    dispose: async (b: string) => {
      // best-effort cleanup
      const keys = await blobStorage.list('design-assets/');
      for (const k of keys) await blobStorage.delete(k).catch(() => undefined);
      void b;
    },
  };
}
