import type { Publication, SearchDoc } from './types';

export function buildSearchIndex(publications: Publication[]): SearchDoc[] {
  return publications.map(pub => ({
    id: pub.slug,
    title: pub.title,
    description: pub.description,
    content: pub.excerpt,
    tags: pub.tags.join(' '),
    domain: pub.domain,
  }));
}

export function searchPublications(
  index: SearchDoc[],
  query: string
): SearchDoc[] {
  const q = query.toLowerCase();
  return index.filter(
    doc =>
      doc.title.toLowerCase().includes(q) ||
      doc.description.toLowerCase().includes(q) ||
      doc.content.toLowerCase().includes(q) ||
      doc.tags.toLowerCase().includes(q)
  );
}
