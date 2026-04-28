import { requireKey } from '../../config/index.js';
import type { SourceImage } from './types.js';

interface PexelsResponse {
  photos: Array<{
    id: number;
    width: number;
    height: number;
    alt: string;
    url: string;
    src: { original: string; large2x: string };
    photographer: string;
    photographer_url: string;
  }>;
}

export async function searchPexels(query: string, perPage = 20): Promise<SourceImage[]> {
  const key = requireKey('PEXELS_API_KEY');
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(Math.min(perPage, 80)));
  url.searchParams.set('orientation', 'landscape');

  const resp = await fetch(url.toString(), { headers: { Authorization: key } });
  if (!resp.ok) {
    throw new Error(`Pexels ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as PexelsResponse;
  return data.photos.map(item => ({
    id: `pexels-${item.id}`,
    url: item.src.original,
    previewUrl: item.src.large2x,
    width: item.width,
    height: item.height,
    alt: item.alt || query,
    license: {
      name: 'Pexels License',
      url: 'https://www.pexels.com/license/',
      attributionRequired: false,
      photographer: item.photographer,
      photographerUrl: item.photographer_url,
    },
    provider: 'pexels',
    sourceUrl: item.url,
  }));
}
