/**
 * Next.js App Router sitemap generator.
 *
 * Pulls the canonical route list from `lib/site-config` so /sitemap.xml is
 * always in sync with what the nav advertises. Blog posts and docs categories
 * are appended dynamically.
 */

import type { MetadataRoute } from 'next';
import { sitemapRoutes, siteUrl } from '../lib/site-config';
import { getAllPosts } from '../lib/blog';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const fixed: MetadataRoute.Sitemap = sitemapRoutes.map((r) => ({
    url: `${siteUrl}${r.path === '/' ? '' : r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const posts: MetadataRoute.Sitemap = getAllPosts().map((p) => ({
    url: `${siteUrl}/blog/${p.slug}`,
    lastModified: new Date(p.publishedAt),
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  // De-duplicate by URL — sitemapRoutes already lists /blog/hello-chiefaia so
  // the dynamic post loop would collide on it.
  const seen = new Set<string>();
  return [...fixed, ...posts].filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
