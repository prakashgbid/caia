import { requireKey } from '../../config/index.js';
import type { SourceImage } from './types.js';

interface PixabayResponse {
  hits: Array<{
    id: number;
    imageWidth: number;
    imageHeight: number;
    largeImageURL: string;
    webformatURL: string;
    tags: string;
    user: string;
    pageURL: string;
  }>;
}

export async function searchPixabay(query: string, perPage = 20): Promise<SourceImage[]> {
  const key = requireKey('PIXABAY_API_KEY');
  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', key);
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', String(Math.min(perPage, 200)));
  url.searchParams.set('orientation', 'horizontal');
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('safesearch', 'true');

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Pixabay ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as PixabayResponse;
  return data.hits.map(item => ({
    id: `pixabay-${item.id}`,
    url: item.largeImageURL,
    previewUrl: item.webformatURL,
    width: item.imageWidth,
    height: item.imageHeight,
    alt: item.tags || query,
    license: {
      name: 'Pixabay License',
      url: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      photographer: item.user,
    },
    provider: 'pixabay',
    sourceUrl: item.pageURL,
  }));
}
