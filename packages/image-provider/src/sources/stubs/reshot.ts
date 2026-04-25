// Reshot — https://www.reshot.com/
//
// Reshot does not provide a public search API. Their free commercial license
// is attractive but programmatic access requires scraping, which is intentionally deferred.
//
// TODO: If Reshot releases a public API, implement here and add to src/sources/index.ts.

import type { SourceImage } from '../types.js';

export async function searchReshot(_query: string): Promise<SourceImage[]> {
  return [];
}
