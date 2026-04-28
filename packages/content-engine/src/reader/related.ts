import type { Publication } from './types';

export function getRelatedArticles(
  current: Publication,
  all: Publication[],
  limit = 3
): Publication[] {
  const others = all.filter(p => p.slug !== current.slug);
  const scored = others.map(p => {
    let score = 0;
    if (p.domain === current.domain) score += 3;
    const overlap = p.tags.filter(t => current.tags.includes(t)).length;
    score += overlap * 2;
    return { pub: p, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.pub);
}
