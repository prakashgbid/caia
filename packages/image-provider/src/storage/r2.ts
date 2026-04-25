import sharp from 'sharp';
import { requireKey } from '../../config/index.js';
import type { Storage, StorageVariants, UploadMeta } from './index.js';

const VARIANTS: Array<{ name: keyof StorageVariants; width: number }> = [
  { name: 'mobile', width: 640 },
  { name: 'tablet', width: 1024 },
  { name: 'desktop', width: 1920 },
  { name: '4k', width: 3840 },
];

export class R2Storage implements Storage {
  private accountId: string;
  private token: string;
  private bucket: string;
  private baseUrl: string;

  constructor() {
    this.accountId = requireKey('CLOUDFLARE_ACCOUNT_ID');
    this.token = requireKey('CLOUDFLARE_API_TOKEN');
    this.bucket = requireKey('R2_BUCKET');
    this.baseUrl = requireKey('R2_PUBLIC_BASE_URL').replace(/\/$/, '');
  }

  private objectUrl(key: string): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/r2/buckets/${this.bucket}/objects/${key}`;
  }

  private async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const resp = await fetch(this.objectUrl(key), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': contentType,
      },
      body,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`R2 PUT ${key}: ${resp.status} ${text.slice(0, 300)}`);
    }
  }

  private async deleteObject(key: string): Promise<void> {
    const resp = await fetch(this.objectUrl(key), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!resp.ok && resp.status !== 404) {
      throw new Error(`R2 DELETE ${key}: ${resp.status}`);
    }
  }

  async upload(
    buffer: Buffer,
    id: string,
    _meta: UploadMeta,
  ): Promise<{ baseUrl: string; variants: StorageVariants }> {
    const variants: Partial<StorageVariants> = {};

    await this.putObject(`${id}/original.jpg`, buffer, 'image/jpeg');
    variants.original = `${this.baseUrl}/${id}/original.jpg`;

    for (const { name, width } of VARIANTS) {
      const webp = await sharp(buffer)
        .resize(width, undefined, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      await this.putObject(`${id}/${name}.webp`, webp, 'image/webp');
      variants[name] = `${this.baseUrl}/${id}/${name}.webp`;
    }

    return { baseUrl: this.baseUrl, variants: variants as StorageVariants };
  }

  getUrl(id: string, variant: keyof StorageVariants = 'desktop'): string {
    const ext = variant === 'original' ? 'jpg' : 'webp';
    return `${this.baseUrl}/${id}/${variant}.${ext}`;
  }

  async delete(id: string): Promise<void> {
    const keys = ['original.jpg', ...VARIANTS.map(v => `${v.name}.webp`)];
    await Promise.all(keys.map(k => this.deleteObject(`${id}/${k}`)));
  }

  async list(): Promise<string[]> {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/r2/buckets/${this.bucket}/objects`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (!resp.ok) throw new Error(`R2 LIST: ${resp.status}`);
    const data = (await resp.json()) as {
      result?: { objects?: Array<{ key: string }> };
    };
    const ids = new Set<string>();
    for (const obj of data.result?.objects ?? []) {
      const id = obj.key?.split('/')[0];
      if (id) ids.add(id);
    }
    return [...ids];
  }
}
