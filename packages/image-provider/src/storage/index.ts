import { getConfig } from '../../config/index.js';

export interface StorageVariants {
  mobile: string;
  tablet: string;
  desktop: string;
  '4k': string;
  original: string;
}

export interface UploadMeta {
  alt: string;
  query: string;
  site?: string;
}

export interface Storage {
  upload(buffer: Buffer, id: string, meta: UploadMeta): Promise<{ baseUrl: string; variants: StorageVariants }>;
  getUrl(id: string, variant?: keyof StorageVariants): string;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}

export async function getStorage(): Promise<Storage> {
  const cfg = getConfig();
  if (cfg.STORAGE_BACKEND === 'cloudflare-images') {
    const { CloudflareImagesStorage } = await import('./cloudflare-images.js');
    return new CloudflareImagesStorage();
  }
  const { R2Storage } = await import('./r2.js');
  return new R2Storage();
}
