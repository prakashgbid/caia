/**
 * Root layout for the ChiefAIA marketing site.
 *
 * Ships the OG / Twitter card / canonical / robots metadata at the root level;
 * every page can override `metadata` to refine title + description but
 * inherits the open-graph image and Twitter handle from here.
 *
 * schema.org JSON-LD (Organization + WebSite) is injected as a single
 * <script> tag per Google's recommendation — keeps the markup clean and
 * lets the LD render before any client JavaScript loads.
 */

import type { Metadata, Viewport } from 'next';
import { SiteShell } from '../components/site-shell';
import { siteConfig, siteUrl } from '../lib/site-config';
import { organizationJsonLd, websiteJsonLd } from '../lib/jsonld';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.publisher }],
  generator: 'Next.js',
  keywords: [
    'AI agent',
    'Chief AI Agent',
    'ChiefAIA',
    'software pipeline',
    'AI-first development',
    'agentic engineering',
  ],
  referrer: 'origin-when-cross-origin',
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    locale: siteConfig.locale,
    images: [
      {
        url: siteConfig.ogImagePath,
        width: 1200,
        height: 630,
        alt: `${siteConfig.name} — ${siteConfig.tagline}`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: siteConfig.twitterHandle,
    creator: siteConfig.twitterHandle,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    images: [siteConfig.ogImagePath],
  },
  alternates: {
    canonical: siteUrl,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  // PWA — Next renders the manifest tag automatically from app/manifest.ts.
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0e14' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ldGraph = {
    '@context': 'https://schema.org',
    '@graph': [organizationJsonLd(), websiteJsonLd()],
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* schema.org JSON-LD — Organization + WebSite */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(ldGraph),
          }}
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
