import type { SourceVideo } from './types.js';

interface CoverrVideoItem {
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
  mp4_url?: string;
  preview_url?: string;
  width?: number;
  height?: number;
  duration?: number;
  url?: string;
}

interface CoverrResponse {
  hits?: CoverrVideoItem[];
  data?: CoverrVideoItem[];
  results?: CoverrVideoItem[];
}

let lastRequestTime = 0;
const RATE_LIMIT_MS = 500; // 2 req/s

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export async function searchCoverr(query: string): Promise<SourceVideo[]> {
  await rateLimit();

  const url = new URL('https://coverr.co/api/videos');
  url.searchParams.set('keywords', query);
  url.searchParams.set('page', '1');

  const resp = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'image-provider/0.1.0',
    },
  });

  if (!resp.ok) {
    throw new Error(`Coverr ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as CoverrResponse;
  const items: CoverrVideoItem[] = data.hits ?? data.data ?? data.results ?? [];

  return items.flatMap(item => {
    const mp4Url = item.mp4_url ?? item.url;
    if (!mp4Url) return [];

    return [{
      id: `coverr-${item.id}`,
      url: mp4Url,
      previewUrl: item.preview_url ?? mp4Url,
      width: item.width ?? 1920,
      height: item.height ?? 1080,
      duration: item.duration ?? 0,
      alt: item.title ?? item.description ?? query,
      license: {
        name: 'Coverr Free License',
        url: 'https://coverr.co/license',
        attributionRequired: false,
      },
      provider: 'coverr',
      sourceUrl: `https://coverr.co`,
    } satisfies SourceVideo];
  });
}
