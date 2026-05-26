/**
 * PWA web app manifest for ChiefAIA.
 *
 * Minimal install-target metadata — the site is not a full PWA yet, but the
 * manifest gives Lighthouse the SEO/best-practice signals and lets browsers
 * offer "Add to Home Screen".
 */

import type { MetadataRoute } from 'next';
import { siteConfig } from '../lib/site-config';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.shortName,
    description: siteConfig.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0b0e14',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
