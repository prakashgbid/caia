import type { Publication, ArticleJsonLD } from './types';

export function generateArticleJsonLD(
  pub: Publication,
  siteUrl: string
): ArticleJsonLD {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: pub.title,
    description: pub.description,
    author: { '@type': 'Person', name: pub.author },
    datePublished: pub.published_at,
    dateModified: pub.updated_at ?? pub.published_at,
    ...(pub.hero_image ? { image: pub.hero_image } : {}),
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${siteUrl}/publications/${pub.slug}`,
    },
  };
}
