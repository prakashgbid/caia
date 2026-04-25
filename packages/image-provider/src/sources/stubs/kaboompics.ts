// Kaboompics — https://kaboompics.com/
//
// Kaboompics does not provide a public search API. Programmatic access would
// require scraping, which is intentionally deferred.
//
// TODO: If Kaboompics releases a public API, implement here and add to src/sources/index.ts.

import type { SourceImage } from '../types.js';

export async function searchKaboompics(_query: string): Promise<SourceImage[]> {
  return [];
}
