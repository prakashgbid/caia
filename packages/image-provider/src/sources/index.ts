import { searchUnsplash } from './unsplash.js';
import { searchPexels } from './pexels.js';
import { searchPixabay } from './pixabay.js';
import type { SourceImage } from './types.js';
import pc from 'picocolors';

export type { SourceImage } from './types.js';

interface SourceDef {
  name: string;
  fn: () => Promise<SourceImage[]>;
}

export async function searchAllSources(query: string, perPage = 20): Promise<SourceImage[]> {
  const sources: SourceDef[] = [
    { name: 'Unsplash', fn: () => searchUnsplash(query, perPage) },
    { name: 'Pexels', fn: () => searchPexels(query, perPage) },
    { name: 'Pixabay', fn: () => searchPixabay(query, perPage) },
  ];

  const settled = await Promise.allSettled(
    sources.map(async s => {
      try {
        return await s.fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Missing required env var')) {
          console.error(pc.yellow(`  ⚠ Skipping ${s.name}: ${msg}`));
        } else {
          console.error(pc.red(`  ✗ ${s.name} failed: ${msg}`));
        }
        return [] as SourceImage[];
      }
    }),
  );

  const seen = new Set<string>();
  const all: SourceImage[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      for (const img of result.value) {
        if (!seen.has(img.id)) {
          seen.add(img.id);
          all.push(img);
        }
      }
    }
  }

  // Sort by resolution (largest area first) as proxy for quality
  return all.sort((a, b) => b.width * b.height - a.width * a.height);
}
