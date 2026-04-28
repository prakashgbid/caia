import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch for all source tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.resetAllMocks();
  process.env.UNSPLASH_ACCESS_KEY = 'test-unsplash-key';
});

describe('Unsplash source', () => {
  it('parses API response into SourceImage array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'abc123',
            urls: {
              raw: 'https://images.unsplash.com/photo-abc',
              regular: 'https://images.unsplash.com/photo-abc?w=1080',
            },
            width: 5000,
            height: 3333,
            alt_description: 'poker chips on green felt',
            description: null,
            links: { html: 'https://unsplash.com/photos/abc123' },
            user: { name: 'John Doe', links: { html: 'https://unsplash.com/@johndoe' } },
          },
        ],
      }),
    });

    const { searchUnsplash } = await import('../../src/sources/unsplash.js');
    const results = await searchUnsplash('poker chips');

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('unsplash-abc123');
    expect(results[0]!.provider).toBe('unsplash');
    expect(results[0]!.alt).toBe('poker chips on green felt');
    expect(results[0]!.width).toBe(5000);
    expect(results[0]!.license.attributionRequired).toBe(false);
    expect(results[0]!.license.photographer).toBe('John Doe');
    expect(results[0]!.url).toContain('fm=jpg');
  });

  it('throws a descriptive error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const { searchUnsplash } = await import('../../src/sources/unsplash.js');
    await expect(searchUnsplash('test')).rejects.toThrow('Unsplash 401');
  });

  it('uses alt_description with fallback to description then query', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'fallback1',
            urls: { raw: 'https://img.test', regular: 'https://img.test' },
            width: 3000, height: 2000,
            alt_description: null,
            description: 'A beautiful scene',
            links: { html: 'https://unsplash.com/photos/fallback1' },
            user: { name: 'Artist', links: { html: 'https://unsplash.com/@artist' } },
          },
        ],
      }),
    });

    const { searchUnsplash } = await import('../../src/sources/unsplash.js');
    const results = await searchUnsplash('poker');
    expect(results[0]!.alt).toBe('A beautiful scene');
  });
});
