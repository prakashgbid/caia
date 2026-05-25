/**
 * Blob storage interface. The caller injects the real BYOC adapter
 * (Cloudflare R2 / S3 / GCS / Azure Blob). The package never depends
 * on a specific cloud SDK.
 */

import { createHash } from 'node:crypto';

export interface PutBlobInput {
  /** Path key, e.g. caia/<tenant>/proposals/<project>/rev-<n>/exec.pdf. */
  path: string;
  body: Buffer;
  contentType: string;
}

export interface PutBlobResult {
  url: string;
  hash: string;
  bytes: number;
}

export interface IBlobStorage {
  put(input: PutBlobInput): Promise<PutBlobResult>;
}

/** sha256 hex of body. Used by both real and memory implementations. */
export function hashBytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
