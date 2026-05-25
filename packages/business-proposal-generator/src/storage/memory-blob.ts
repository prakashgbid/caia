/** In-memory IBlobStorage implementation for tests + fixtures. */

import { hashBytes, type IBlobStorage, type PutBlobInput, type PutBlobResult } from './blob.js';

export class MemoryBlobStorage implements IBlobStorage {
  private readonly bucket: string;
  private readonly store = new Map<string, { body: Buffer; contentType: string; hash: string }>();

  public constructor(opts: { bucket?: string } = {}) {
    this.bucket = opts.bucket ?? 'memblob';
  }

  public async put(input: PutBlobInput): Promise<PutBlobResult> {
    const hash = hashBytes(input.body);
    this.store.set(input.path, { body: input.body, contentType: input.contentType, hash });
    return {
      url: `memblob://${this.bucket}/${input.path}`,
      hash,
      bytes: input.body.byteLength,
    };
  }

  /** Test helper. */
  public read(path: string): { body: Buffer; contentType: string; hash: string } | undefined {
    return this.store.get(path);
  }

  public list(): string[] {
    return [...this.store.keys()].sort();
  }

  public size(): number {
    return this.store.size;
  }
}
