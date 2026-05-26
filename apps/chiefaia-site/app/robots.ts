/**
 * Next.js App Router robots.txt generator.
 *
 * Allows everything except `/api/*` (internal endpoints — no crawl value)
 * and points the sitemap at the canonical site URL.
 */

import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site-config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
