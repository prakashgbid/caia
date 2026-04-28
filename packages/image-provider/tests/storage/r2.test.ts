import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AWS SDK before importing R2Storage
vi.mock('@aws-sdk/client-s3', () => {
  const send = vi.fn().mockResolvedValue({
    Contents: [{ Key: 'img-abc/desktop.webp' }, { Key: 'img-abc/mobile.webp' }],
  });
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send })),
    PutObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    ListObjectsV2Command: vi.fn(),
  };
});

beforeEach(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account-id';
  process.env.CLOUDFLARE_API_TOKEN = 'test-cloudflare-api-token';
  process.env.R2_ACCESS_KEY_ID = 'test-r2-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-r2-secret';
  process.env.R2_BUCKET = 'test-bucket';
  process.env.R2_PUBLIC_BASE_URL = 'https://pub.example.com';
});

describe('R2Storage', () => {
  it('constructs desktop WebP URL correctly', async () => {
    const { R2Storage } = await import('../../src/storage/r2.js');
    const storage = new R2Storage();
    expect(storage.getUrl('my-image-id', 'desktop')).toBe('https://pub.example.com/my-image-id/desktop.webp');
  });

  it('constructs mobile WebP URL correctly', async () => {
    const { R2Storage } = await import('../../src/storage/r2.js');
    const storage = new R2Storage();
    expect(storage.getUrl('my-image-id', 'mobile')).toBe('https://pub.example.com/my-image-id/mobile.webp');
  });

  it('constructs original JPEG URL correctly', async () => {
    const { R2Storage } = await import('../../src/storage/r2.js');
    const storage = new R2Storage();
    expect(storage.getUrl('my-image-id', 'original')).toBe('https://pub.example.com/my-image-id/original.jpg');
  });

  it('strips trailing slash from base URL', async () => {
    process.env.R2_PUBLIC_BASE_URL = 'https://pub.example.com/';
    const { R2Storage } = await import('../../src/storage/r2.js');
    const storage = new R2Storage();
    expect(storage.getUrl('img', 'desktop')).toBe('https://pub.example.com/img/desktop.webp');
  });

  it('list() deduplicates image IDs from object keys', async () => {
    const { R2Storage } = await import('../../src/storage/r2.js');
    const storage = new R2Storage();
    const ids = await storage.list();
    expect(ids).toContain('img-abc');
    expect(ids).toHaveLength(1); // both keys have same prefix
  });

  it.skip('upload() stores 5 files (1 original + 4 variants) — requires real S3 client', async () => {
    // Network test: run manually with real R2 credentials
    // CLOUDFLARE_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... npm test
  });
});
