/**
 * BYOC (Bring-Your-Own-Cloud) blob-storage adapter contract used by
 * `@caia/atlas-design-snapshotter`.
 *
 * The CAIA v2/v3 plans (§6) describe an `ICloudAdapter` whose `putBlob`
 * method is optional — only `CloudflarePagesAdapter` (R2-backed) ships
 * it today. The snapshotter needs a slightly tighter contract: it must
 * be able to GET and DELETE blobs too, and check existence so that
 * content-hash dedup can short-circuit before re-uploading the same
 * bytes.
 *
 * This module declares the minimal interface the snapshotter consumes.
 * Concrete adapters (Cloudflare R2, AWS S3, GCP GCS, Azure Blob,
 * MinIO for tests) implement it. The interface is intentionally narrow
 * so it composes with the larger `ICloudAdapter` without conflict.
 */

import type { Readable } from 'node:stream';

/** Result of a blob put. */
export interface BYOCPutResult {
  /** Canonical URL the blob is now reachable at (s3://, r2://, http://...). */
  url: string;
  /** Bytes stored. */
  size: number;
}

/** Result of a HEAD request. */
export interface BYOCHeadResult {
  /** True if the object exists. */
  exists: boolean;
  /** Size in bytes when `exists`. */
  size?: number;
  /** Content-type when `exists`. */
  contentType?: string;
}

/**
 * Minimal blob-store contract — five methods.
 *
 * Implementations MUST be idempotent on `put` for the same `key` (re-PUT
 * yields the same URL; bytes are last-write-wins for a given key). The
 * snapshotter relies on this so re-uploading after a crash is safe.
 */
export interface BYOCBlobAdapter {
  /** Provider tag for logging / debugging. */
  readonly providerId: string;

  /** Upload `body` to `key`. Returns the canonical URL + size. */
  putBlob(
    tenantId: string,
    key: string,
    body: Buffer | Readable,
    opts?: { contentType?: string },
  ): Promise<BYOCPutResult>;

  /** Read a blob back. Returns a Buffer (whole-blob read is fine for the
   *  small structural payloads the snapshotter cares about). */
  getBlob(tenantId: string, key: string): Promise<Buffer>;

  /** Check whether `key` exists without downloading it. */
  headBlob(tenantId: string, key: string): Promise<BYOCHeadResult>;

  /** Delete a single object. Idempotent — must not throw on missing keys. */
  deleteBlob(tenantId: string, key: string): Promise<void>;

  /** Delete every object whose key starts with `prefix`. Used by
   *  `deleteAllForTenant` for GDPR Article 17 right-to-erasure. */
  deletePrefix(tenantId: string, prefix: string): Promise<{ deletedCount: number }>;
}

/**
 * In-memory `BYOCBlobAdapter` — used by unit tests. Keys are namespaced
 * by tenantId so cross-tenant leak attempts surface as misses. Production
 * code uses the real S3/R2/GCS adapter.
 */
export class InMemoryBYOCAdapter implements BYOCBlobAdapter {
  readonly providerId = 'in-memory';
  private readonly store = new Map<string, { body: Buffer; contentType?: string }>();
  /** Call counter — handy for asserting "we only uploaded once" in dedup tests. */
  public putCount = 0;

  private k(tenantId: string, key: string): string {
    return `${tenantId}::${key}`;
  }

  async putBlob(
    tenantId: string,
    key: string,
    body: Buffer | Readable,
    opts?: { contentType?: string },
  ): Promise<BYOCPutResult> {
    const buf = Buffer.isBuffer(body) ? body : await readableToBuffer(body);
    this.store.set(this.k(tenantId, key), {
      body: buf,
      ...(opts?.contentType !== undefined ? { contentType: opts.contentType } : {}),
    });
    this.putCount++;
    return { url: `mem://${tenantId}/${key}`, size: buf.byteLength };
  }

  async getBlob(tenantId: string, key: string): Promise<Buffer> {
    const row = this.store.get(this.k(tenantId, key));
    if (!row) throw new Error(`mem-byoc: not found ${tenantId}/${key}`);
    return row.body;
  }

  async headBlob(tenantId: string, key: string): Promise<BYOCHeadResult> {
    const row = this.store.get(this.k(tenantId, key));
    if (!row) return { exists: false };
    const result: BYOCHeadResult = { exists: true, size: row.body.byteLength };
    if (row.contentType !== undefined) result.contentType = row.contentType;
    return result;
  }

  async deleteBlob(tenantId: string, key: string): Promise<void> {
    this.store.delete(this.k(tenantId, key));
  }

  async deletePrefix(tenantId: string, prefix: string): Promise<{ deletedCount: number }> {
    const fullPrefix = this.k(tenantId, prefix);
    let deleted = 0;
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(fullPrefix)) {
        this.store.delete(k);
        deleted++;
      }
    }
    return { deletedCount: deleted };
  }

  /** Test-only — total number of objects in the store. */
  public size(): number {
    return this.store.size;
  }

  /** Test-only — list keys for assertions. */
  public listKeys(): string[] {
    return Array.from(this.store.keys());
  }
}

async function readableToBuffer(r: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of r) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
