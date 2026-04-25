// Cloudflare Images storage backend (stub).
//
// Switch to this by setting STORAGE_BACKEND=cloudflare-images in .env.
// Requires: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_IMAGES_TOKEN
//
// Cloudflare Images API reference:
//   https://developers.cloudflare.com/images/cloudflare-images/upload-images/
//
// Key endpoints:
//   POST   /accounts/{account_id}/images/v1        — upload (multipart/form-data)
//   GET    /accounts/{account_id}/images/v1/{id}   — metadata
//   DELETE /accounts/{account_id}/images/v1/{id}   — delete
//   GET    /accounts/{account_id}/images/v1         — list
//
// Cloudflare Images generates variants automatically via URL transform params,
// so you don't need to generate WebP variants manually — just configure them
// in the Cloudflare dashboard and reference them here.
//
// TODO: Implement this class when user decides to switch to Cloudflare Images.

import type { Storage, StorageVariants, UploadMeta } from './index.js';

export class CloudflareImagesStorage implements Storage {
  constructor() {
    throw new Error(
      'CloudflareImagesStorage is not yet implemented. ' +
      'Set STORAGE_BACKEND=r2 to use the default R2 backend.',
    );
  }

  async upload(_buffer: Buffer, _id: string, _meta: UploadMeta): Promise<{ baseUrl: string; variants: StorageVariants }> {
    throw new Error('Not implemented');
  }

  getUrl(_id: string, _variant?: keyof StorageVariants): string {
    throw new Error('Not implemented');
  }

  async delete(_id: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async list(): Promise<string[]> {
    throw new Error('Not implemented');
  }
}
