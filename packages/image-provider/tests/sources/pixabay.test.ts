import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.resetAllMocks();
  process.env.PIXABAY_API_KEY = 'test-pixabay-key';
});

describe('Pixabay source', () => {
  it('parses API response into SourceImage array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hits: [
          {
            id: 456,
            imageWidth: 5000,
            imageHeight: 3333,
            largeImageURL: 'https://pixabay.com/get/456_large.jpg',
            webformatURL: 'https://pixabay.com/get/456_web.jpg',
            tags: 'casino, chips, gambling',
            user: 'PixUser123',
            pageURL: 'https://pixabay.com/photos/casino-456',
          },
        ],
      }),
    });

    const { searchPixabay } = await import('../../src/sources/pixabay.js');
    const results = await searchPixabay('casino chips');

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('pixabay-456');
    expect(results[0]!.provider).toBe('pixabay');
    expect(results[0]!.alt).toBe('casino, chips, gambling');
    expect(results[0]!.license.name).toBe('Pixabay License');
    expect(results[0]!.width).toBe(5000);
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    });

    const { searchPixabay } = await import('../../src/sources/pixabay.js');
    await expect(searchPixabay('test')).rejects.toThrow('Pixabay 429');
  });
});
