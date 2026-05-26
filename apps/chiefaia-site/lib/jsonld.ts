/**
 * schema.org JSON-LD payloads for ChiefAIA.
 *
 * Two graphs render in the root layout: `Organization` (publisher identity)
 * and `WebSite` (with `potentialAction` SearchAction for site search once
 * /search lands). Both reference the operator-confirmed `siteConfig`.
 */

import { siteConfig, siteUrl } from './site-config';

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: siteConfig.publisher,
    url: siteUrl,
    logo: {
      '@type': 'ImageObject',
      url: `${siteUrl}/og-default.svg`,
    },
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteUrl}/#website`,
    name: siteConfig.name,
    description: siteConfig.description,
    url: siteUrl,
    publisher: { '@id': `${siteUrl}/#organization` },
    inLanguage: 'en',
  };
}
