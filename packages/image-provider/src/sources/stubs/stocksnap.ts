// StockSnap.io — https://stocksnap.io/
//
// StockSnap does not provide a public search API. Programmatic access would require
// scraping, which violates their Terms of Service.
//
// TODO: If StockSnap releases a public API, implement here and add to src/sources/index.ts.

import type { SourceImage } from '../types.js';

export async function searchStockSnap(_query: string): Promise<SourceImage[]> {
  return [];
}
