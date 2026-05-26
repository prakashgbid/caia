/**
 * sitemap.ts correctness — the generator must:
 *   1. Include every canonical route from site-config
 *   2. Include every blog post URL
 *   3. Emit no duplicate URLs
 *   4. Use absolute URLs (so search engines accept them)
 *   5. Set valid changeFrequency + priority on every entry
 */

import { describe, expect, it } from 'vitest';
import sitemap from '../app/sitemap';
import { sitemapRoutes, siteUrl } from '../lib/site-config';
import { getAllPosts } from '../lib/blog';

describe('app/sitemap.ts', () => {
  const entries = sitemap();

  it('emits at least one entry per canonical route', () => {
    const urls = new Set(entries.map((e) => e.url));
    for (const r of sitemapRoutes) {
      const expected = `${siteUrl}${r.path === '/' ? '' : r.path}`;
      expect(urls.has(expected)).toBe(true);
    }
  });

  it('includes every blog post', () => {
    const urls = new Set(entries.map((e) => e.url));
    for (const p of getAllPosts()) {
      expect(urls.has(`${siteUrl}/blog/${p.slug}`)).toBe(true);
    }
  });

  it('emits no duplicate URLs', () => {
    const urls = entries.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('every URL is absolute', () => {
    for (const entry of entries) {
      expect(entry.url.startsWith('http')).toBe(true);
    }
  });

  it('every entry has a valid changeFrequency', () => {
    const allowed = new Set([
      'always',
      'hourly',
      'daily',
      'weekly',
      'monthly',
      'yearly',
      'never',
    ]);
    for (const entry of entries) {
      expect(allowed.has(entry.changeFrequency as string)).toBe(true);
    }
  });

  it('every entry has a priority between 0 and 1', () => {
    for (const entry of entries) {
      expect(entry.priority).toBeGreaterThanOrEqual(0);
      expect(entry.priority).toBeLessThanOrEqual(1);
    }
  });
});
