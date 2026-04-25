// Burst (by Shopify) — https://burst.shopify.com/
//
// Burst does not provide a public search API. Programmatic access would require
// scraping, which violates their Terms of Service.
//
// TODO: If Burst releases a public API, implement here and add to src/sources/index.ts.
// The API would likely follow a similar pattern to the other sources.

import type { SourceImage } from '../types.js';

export async function searchBurst(_query: string): Promise<SourceImage[]> {
  return [];
}
