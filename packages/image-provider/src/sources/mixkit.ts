import { createLogger } from '@chiefaia/logger';

import type { SourceVideo } from './types.js';

const logger = createLogger({ name: 'image-provider/sources/mixkit' });

// Mixkit rate limit: 1 req / 3s
let lastRequestTime = 0;
const RATE_LIMIT_MS = 3_000;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

interface JsonLdVideo {
  '@type'?: string;
  name?: string;
  description?: string;
  contentUrl?: string;
  thumbnailUrl?: string | string[];
  duration?: string;
  width?: number;
  height?: number;
  embedUrl?: string;
}

function parseDuration(iso?: string): number {
  if (!iso) return 0;
  // ISO 8601 duration: PT4S, PT1M30S, etc.
  const match = iso.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const minutes = parseInt(match[1] ?? '0', 10);
  const seconds = parseInt(match[2] ?? '0', 10);
  return minutes * 60 + seconds;
}

function extractJsonLdVideos(html: string): JsonLdVideo[] {
  const videos: JsonLdVideo[] = [];
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRe.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1]!);
      const items: unknown[] = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          if (obj['@type'] === 'VideoObject') {
            videos.push(obj as JsonLdVideo);
          }
          // Also check nested @graph
          if (Array.isArray(obj['@graph'])) {
            for (const node of obj['@graph'] as unknown[]) {
              if (typeof node === 'object' && node !== null) {
                const n = node as Record<string, unknown>;
                if (n['@type'] === 'VideoObject') {
                  videos.push(n as JsonLdVideo);
                }
              }
            }
          }
        }
      }
    } catch {
      // Malformed JSON-LD — skip
    }
  }

  return videos;
}

export async function searchMixkit(query: string): Promise<SourceVideo[]> {
  await rateLimit();

  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const pageUrl = `https://mixkit.co/free-stock-video/${slug}/`;

  let html: string;
  try {
    const resp = await fetch(pageUrl, {
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'image-provider/0.1.0 (structured-data-only)',
      },
    });

    if (!resp.ok) {
      logger.warn('HTTP non-OK; returning empty', {
        status: resp.status,
        query,
      });
      return [];
    }

    html = await resp.text();
  } catch (err) {
    logger.warn('fetch failed; returning empty', {
      query,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const jsonLdVideos = extractJsonLdVideos(html);

  if (jsonLdVideos.length === 0) {
    logger.warn('no JSON-LD VideoObject found; API may be unavailable', {
      query,
    });
    return [];
  }

  return jsonLdVideos.flatMap((v, idx) => {
    const contentUrl = v.contentUrl ?? v.embedUrl;
    if (!contentUrl) return [];

    const thumbnail = Array.isArray(v.thumbnailUrl)
      ? (v.thumbnailUrl[0] ?? '')
      : (v.thumbnailUrl ?? '');

    return [{
      id: `mixkit-${slug}-${idx}`,
      url: contentUrl,
      previewUrl: thumbnail,
      width: v.width ?? 1920,
      height: v.height ?? 1080,
      duration: parseDuration(v.duration),
      alt: v.name ?? v.description ?? query,
      license: {
        name: 'Mixkit Stock Video Free License',
        url: 'https://mixkit.co/license/',
        attributionRequired: false,
      },
      provider: 'mixkit',
      sourceUrl: pageUrl,
    } satisfies SourceVideo];
  });
}
