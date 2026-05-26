/**
 * Legal-route sitemap presence — locks in the operator-required addition
 * of /legal/privacy, /legal/terms, and /legal/aup to the sitemap.
 *
 * The pre-existing `tests/sitemap.test.ts` iterates over all entries in
 * `sitemapRoutes` and verifies each one shows up in the rendered sitemap;
 * adding the legal routes to `sitemapRoutes` is therefore self-covering.
 * This file adds a more explicit, route-specific assertion so a future
 * accidental removal of any legal route from sitemapRoutes is caught with
 * a named failure rather than a generic loop failure.
 */

import { describe, expect, it } from 'vitest';
import sitemap from '../app/sitemap';
import { siteUrl } from '../lib/site-config';

const LEGAL_PATHS = ['/legal/privacy', '/legal/terms', '/legal/aup'] as const;

describe('app/sitemap.ts — legal routes', () => {
  const urls = new Set(sitemap().map((e) => e.url));

  for (const path of LEGAL_PATHS) {
    it(`includes ${path}`, () => {
      expect(urls.has(`${siteUrl}${path}`)).toBe(true);
    });
  }
});
