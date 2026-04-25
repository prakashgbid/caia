export interface PublicationFrontmatter {
  title: string;
  description: string;
  author: string;
  published_at: string; // ISO date string
  updated_at?: string;
  tags: string[];
  domain: string; // e.g. "content" | "gameplay" | "seo"
  reading_time: number; // minutes
  hero_image?: string; // image id or URL
}

export interface Publication extends PublicationFrontmatter {
  slug: string;
  htmlContent: string;
  excerpt: string; // first 160 chars of stripped content
}

export interface TOCItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface SearchDoc {
  id: string;
  title: string;
  description: string;
  content: string;
  tags: string;
  domain: string;
}

export interface ArticleJsonLD {
  '@context': string;
  '@type': string;
  headline: string;
  description: string;
  author: { '@type': string; name: string };
  datePublished: string;
  dateModified: string;
  image?: string;
  mainEntityOfPage: { '@type': string; '@id': string };
}
