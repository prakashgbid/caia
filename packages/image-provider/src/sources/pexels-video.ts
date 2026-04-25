import { requireKey } from '../../config/index.js';
import type { SourceVideo } from './types.js';

interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  quality: string;
  file_type: string;
}

interface PexelsVideoItem {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  video_files: PexelsVideoFile[];
  video_pictures: Array<{ picture: string }>;
  user: { name: string; url: string };
}

interface PexelsVideosResponse {
  videos: PexelsVideoItem[];
}

let lastRequestTime = 0;
const RATE_LIMIT_MS = 2_000;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

function pickBestMp4(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4s = files.filter(f => f.file_type === 'video/mp4' || f.link.endsWith('.mp4'));
  if (mp4s.length === 0) return null;
  // Prefer hd quality, then fall back to largest by resolution
  const hd = mp4s.find(f => f.quality === 'hd');
  if (hd) return hd;
  return mp4s.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
}

export async function searchPexelsVideo(query: string, perPage = 15): Promise<SourceVideo[]> {
  await rateLimit();

  const key = requireKey('PEXELS_API_KEY');
  const url = new URL('https://api.pexels.com/videos/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(Math.min(perPage, 80)));
  url.searchParams.set('orientation', 'landscape');
  url.searchParams.set('min_duration', '3');
  url.searchParams.set('max_duration', '15');

  const resp = await fetch(url.toString(), { headers: { Authorization: key } });
  if (!resp.ok) {
    throw new Error(`Pexels Videos ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as PexelsVideosResponse;

  return data.videos.flatMap(item => {
    const best = pickBestMp4(item.video_files);
    if (!best) return [];

    const preview = item.video_pictures[0]?.picture ?? '';

    return [{
      id: `pexels-video-${item.id}`,
      url: best.link,
      previewUrl: preview,
      width: item.width,
      height: item.height,
      duration: item.duration,
      alt: query,
      license: {
        name: 'Pexels License',
        url: 'https://www.pexels.com/license/',
        attributionRequired: false,
        photographer: item.user.name,
        photographerUrl: item.user.url,
      },
      provider: 'pexels-video',
      sourceUrl: item.url,
    } satisfies SourceVideo];
  });
}
