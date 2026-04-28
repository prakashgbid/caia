import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.resetAllMocks();
  process.env.PEXELS_API_KEY = 'test-pexels-key';
});

describe('Pexels source', () => {
  it('parses API response into SourceImage array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        photos: [
          {
            id: 789,
            width: 4000,
            height: 3000,
            alt: 'roulette wheel casino',
            url: 'https://www.pexels.com/photo/789/',
            src: {
              original: 'https://images.pexels.com/photos/789/original.jpg',
              large2x: 'https://images.pexels.com/photos/789/large2x.jpg',
            },
            photographer: 'Jane Smith',
            photographer_url: 'https://www.pexels.com/@jane',
          },
        ],
      }),
    });

    const { searchPexels } = await import('../../src/sources/pexels.js');
    const results = await searchPexels('roulette wheel');

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('pexels-789');
    expect(results[0]!.provider).toBe('pexels');
    expect(results[0]!.alt).toBe('roulette wheel casino');
    expect(results[0]!.license.photographer).toBe('Jane Smith');
    expect(results[0]!.url).toContain('original');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    const { searchPexels } = await import('../../src/sources/pexels.js');
    await expect(searchPexels('test')).rejects.toThrow('Pexels 403');
  });
});
