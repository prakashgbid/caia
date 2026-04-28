import { requireKey } from '../../config/index.js';
import type { SourceImage } from './types.js';

interface UnsplashResponse {
  results: Array<{
    id: string;
    urls: { raw: string; regular: string };
    width: number;
    height: number;
    alt_description: string | null;
    description: string | null;
    links: { html: string };
    user: { name: string; links: { html: string } };
  }>;
}

export async function searchUnsplash(query: string, perPage = 20): Promise<SourceImage[]> {
  const key = requireKey('UNSPLASH_ACCESS_KEY');
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(Math.min(perPage, 30)));
  url.searchParams.set('orientation', 'landscape');

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${key}` },
  });
  if (!resp.ok) {
    throw new Error(`Unsplash ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as UnsplashResponse;
  return data.results.map(item => ({
    id: `unsplash-${item.id}`,
    url: `${item.urls.raw}&fm=jpg&q=90&w=3840`,
    previewUrl: item.urls.regular,
    width: item.width,
    height: item.height,
    alt: item.alt_description ?? item.description ?? query,
    license: {
      name: 'Unsplash License',
      url: 'https://unsplash.com/license',
      attributionRequired: false,
      photographer: item.user.name,
      photographerUrl: item.user.links.html,
    },
    provider: 'unsplash',
    sourceUrl: item.links.html,
  }));
}
