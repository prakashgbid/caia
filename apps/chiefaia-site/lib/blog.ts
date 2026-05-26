/**
 * Blog data source — static, code-resident posts for now. A markdown/MDX
 * loader can replace this without touching pages once content authoring
 * starts. Each post explicitly omits a fabricated author name; the byline
 * is the publisher entity per the operator's no-fabricated-authorship rule.
 */

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  publishedAt: string; // ISO date
  body: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'hello-chiefaia',
    title: 'Hello, ChiefAIA',
    description:
      'Why we built ChiefAIA as a 7-step pipeline with reuse-first guardrails and a deterministic evidence gate.',
    publishedAt: '2026-05-25',
    body: [
      'ChiefAIA is a Chief AI Agent platform — an opinionated 7-step pipeline that takes a product brief and produces shippable software.',
      'The pipeline is the same every time: brief intake, decomposition, architecture, implementation, verification, evidence gate, ship.',
      'Every step has a named owner agent, deterministic gates, and explicit acceptance criteria. The reuse-first doctrine (ADR-065) forbids one-off code when a reusable workspace package exists. The evidence gate (typecheck + tests + lint + lighthouse + axe + visual + size) is a required status check on every PR.',
      'This launch post is intentionally light — there is no fabricated metric, anecdote, or testimonial here. Future posts will explain individual agents, the dispatch model, and the evidence-gate philosophy as the work lands.',
    ].join('\n\n'),
  },
];

export function getAllPosts(): BlogPost[] {
  return [...blogPosts].sort((a, b) =>
    a.publishedAt < b.publishedAt ? 1 : -1
  );
}

export function getPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
