import type { MetadataRoute } from 'next';

// Required for `output: export` (static export). Without this, Next.js treats
// the metadata route as on-demand and fails the build with:
//   "export const dynamic = \"force-static\"/export const revalidate not configured"
export const dynamic = 'force-static';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://example.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
