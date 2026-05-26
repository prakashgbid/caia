/**
 * Single source of truth for marketing-site copy that needs to be referenced
 * by multiple surfaces (layout meta, sitemap, JSON-LD, nav components).
 *
 * Operator-confirmed copy only — per
 * `agent-memory/feedback_action_research_outputs.md` no fabricated metrics,
 * testimonials, or authorship may appear on the site. Anything that isn't
 * confirmed yet is marked TBD.
 */

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://chiefaia.com';

export const dashboardUrl =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'https://dashboard.chiefaia.com';

export const siteConfig = {
  name: 'ChiefAIA',
  shortName: 'ChiefAIA',
  url: siteUrl,
  // Tagline — operator-confirmed in agent-memory > project_caia_locked.
  // Describes what the product DOES, not what it CLAIMS to do; no metrics.
  tagline: 'The Chief AI Agent that builds, ships, and operates software',
  description:
    'ChiefAIA is a Chief AI Agent platform: an opinionated 7-step pipeline that takes a product brief and produces shippable software with explicit gates, evidence, and reuse-first architecture.',
  // Author / publisher — the operator's company. ONLY the legal entity name.
  // No fabricated person, no fabricated testimonial. See operator memory.
  publisher: 'ChiefAIA',
  // Primary social handle — placeholder. Update once the handle is reserved.
  twitterHandle: '@chiefaia',
  locale: 'en_US',
  // Inline OG image — referenced from /api/og at runtime. Static fallback
  // ships from /public/og-default.svg.
  ogImagePath: '/og-default.svg',
} as const;

/**
 * Canonical top-level nav. Single source — used by Navbar + Footer + sitemap.
 */
export const primaryNav = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
  { href: '/blog', label: 'Blog' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/contact', label: 'Contact' },
] as const;

/**
 * Routes published in /sitemap.xml. Includes secondary routes that aren't in
 * primaryNav (sign-in, individual docs stubs).
 */
export const sitemapRoutes = [
  { path: '/', changeFrequency: 'weekly' as const, priority: 1.0 },
  { path: '/pricing', changeFrequency: 'monthly' as const, priority: 0.9 },
  { path: '/docs', changeFrequency: 'weekly' as const, priority: 0.8 },
  { path: '/docs/getting-started', changeFrequency: 'monthly' as const, priority: 0.7 },
  { path: '/docs/the-7-step-pipeline', changeFrequency: 'monthly' as const, priority: 0.7 },
  { path: '/docs/architecture', changeFrequency: 'monthly' as const, priority: 0.7 },
  { path: '/docs/agents', changeFrequency: 'monthly' as const, priority: 0.7 },
  { path: '/docs/evidence-gate', changeFrequency: 'monthly' as const, priority: 0.7 },
  { path: '/blog', changeFrequency: 'weekly' as const, priority: 0.7 },
  { path: '/blog/hello-chiefaia', changeFrequency: 'monthly' as const, priority: 0.5 },
  { path: '/changelog', changeFrequency: 'weekly' as const, priority: 0.6 },
  { path: '/contact', changeFrequency: 'yearly' as const, priority: 0.4 },
  { path: '/sign-in', changeFrequency: 'yearly' as const, priority: 0.3 },
] as const;

/**
 * Stub docs index — rendered on /docs as a card grid. Each card is a
 * "Coming soon" placeholder. Wiring is operator-confirmed; the content of
 * each guide is not yet written.
 */
export const docsCategories = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    description: 'Install the CLI, point it at a brief, watch the pipeline run.',
  },
  {
    slug: 'the-7-step-pipeline',
    title: 'The 7-step pipeline',
    description: 'How ChiefAIA decomposes a brief into shippable software.',
  },
  {
    slug: 'architecture',
    title: 'Architecture',
    description: 'Steward boundaries, agents, dispatch, the evidence gate.',
  },
  {
    slug: 'agents',
    title: 'Agents',
    description: 'The roster of specialist agents and what each one owns.',
  },
  {
    slug: 'evidence-gate',
    title: 'Evidence gate',
    description: 'Deterministic-evidence required-status-check policy.',
  },
] as const;

/**
 * Subscription tiers — copy is operator-confirmed.
 * Prices are TBD and rendered as such. Do NOT invent numbers.
 */
export const pricingTiers = [
  {
    slug: 'free',
    name: 'Free',
    priceLabel: 'TBD',
    description: 'Try the pipeline against a sample brief. No card required.',
    features: [
      'Run the pipeline on the operator-shared sample brief',
      'View the generated artifacts read-only',
      'Public roadmap + changelog access',
    ],
    ctaLabel: 'Get started',
    ctaHref: '/sign-in',
    highlighted: false,
  },
  {
    slug: 'professional',
    name: 'Professional',
    priceLabel: 'TBD',
    description: 'For solo operators shipping their own product.',
    features: [
      'Unlimited pipeline runs on your own briefs',
      'Subscription — Claude Max underlying (operator-confirmed)',
      'Private projects with the full agent roster',
      'Email support',
    ],
    ctaLabel: 'Start free trial',
    ctaHref: '/sign-in',
    highlighted: true,
  },
  {
    slug: 'team',
    name: 'Team',
    priceLabel: 'TBD',
    description: 'For small teams who want a shared agent fleet.',
    features: [
      'Everything in Professional',
      'Shared workspace + access control',
      'Higher concurrent-run cap',
      'Priority support',
    ],
    ctaLabel: 'Contact sales',
    ctaHref: '/contact',
    highlighted: false,
  },
] as const;
