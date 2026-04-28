// Picography — https://picography.co/
//
// Picography does not provide a public search API. Scraping is intentionally deferred.
//
// TODO: If Picography releases a public API, implement here and add to src/sources/index.ts.

import type { SourceImage } from '../types.js';

export async function searchPicography(_query: string): Promise<SourceImage[]> {
  return [];
}
