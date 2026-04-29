/**
 * Taxonomy classifier — BUCKET-002.
 *
 * Pure, dependency-free keyword-driven helpers that PO Agent uses to
 * populate the new 9-axis taxonomy fields (`project_slug`,
 * `business_sub_domains`, `lifecycle`, `priority_bucket`) on every story
 * during decomposition.
 *
 * These intentionally mirror the canonical enums in
 * `@chiefaia/ticket-template`. We don't import them here to keep
 * `@chiefaia/classifier` self-contained — but the slug strings MUST stay in
 * sync, so the table below is checked in `taxonomy-classifier.test.ts`
 * against the ticket-template enums.
 */

// ─── Project classification ──────────────────────────────────────────────────

/**
 * Project keyword map. Order matters — first match wins. Use highly
 * specific keywords first (e.g. "pokerzeno" before "poker") so partial
 * matches don't capture the wrong project.
 */
const PROJECT_KEYWORDS: Array<{ slug: string; keywords: string[] }> = [
  // Personal sites — most specific names first.
  { slug: 'ankitatiwari', keywords: ['ankita', 'ankita tiwari', 'ankitatiwari'] },
  { slug: 'prakash-tiwari', keywords: ['prakash tiwari', 'prakash-tiwari', 'prakash personal'] },
  { slug: 'chiefaia.com', keywords: ['chiefaia.com', 'chiefaia marketing', 'chiefaia site'] },
  // Consumer sites.
  { slug: 'pokerzeno', keywords: ['pokerzeno', 'poker zeno', 'poker-zeno', 'poker site'] },
  { slug: 'roulettecommunity', keywords: ['roulettecommunity', 'roulette community', 'roulette-community', 'roulette site', 'roulette advisor'] },
  { slug: 'edisoncricket', keywords: ['edisoncricket', 'edison cricket', 'edison-cricket', 'cricket site'] },
  // Plugin packages.
  { slug: 'image-provider', keywords: ['image-provider', 'image provider'] },
  { slug: 'cast-bridge', keywords: ['cast-bridge', 'cast bridge'] },
  { slug: 'dev-inspector', keywords: ['dev-inspector', 'dev inspector'] },
  { slug: 'backend-core', keywords: ['backend-core'] },
  { slug: 'content-engine', keywords: ['content-engine', 'content engine'] },
  { slug: 'integrity-check', keywords: ['integrity-check', 'integrity check'] },
  { slug: 'seo-program', keywords: ['seo-program', 'seo program'] },
  { slug: 'analytics', keywords: ['analytics package', 'analytics plugin'] },
  // Framework / templates.
  { slug: 'framework', keywords: ['framework', 'caia framework'] },
  { slug: 'site-template', keywords: ['site-template', 'site template'] },
  // Default platform — broad match on common platform terms (LAST so it
  // doesn't shadow the more specific matches above).
  {
    slug: 'caia',
    keywords: [
      'caia',
      'orchestrator',
      'agent platform',
      'pipeline',
      'dashboard',
      'task manager',
      'po agent',
      'ba agent',
      'ea agent',
      'task scheduler',
      'bucket placer',
      'executor',
      'observability',
      'event bus',
      'classifier',
      'decomposer',
      'ticket template',
      'event taxonomy',
    ],
  },
];

export interface ProjectClassification {
  /** Best-fit project slug; `unassigned` if nothing matches. */
  slug: string;
  /** 0..1, fraction of keywords matched in the winning entry. */
  confidence: number;
  /** All keyword matches across all projects, for debug / audit. */
  matches: Array<{ slug: string; matchedKeywords: string[] }>;
}

/**
 * Classify a piece of text (a prompt body or a story title+description) to
 * one of the canonical project slugs. Returns `unassigned` with confidence 0
 * when nothing matches; the PO Agent should surface a question in that case.
 */
export function classifyProject(text: string): ProjectClassification {
  const lower = text.toLowerCase();
  const matches: ProjectClassification['matches'] = [];

  for (const entry of PROJECT_KEYWORDS) {
    const matched = entry.keywords.filter((k) => lower.includes(k));
    if (matched.length > 0) matches.push({ slug: entry.slug, matchedKeywords: matched });
  }

  if (matches.length === 0) {
    return { slug: 'unassigned', confidence: 0, matches: [] };
  }

  // Winner: most matches; ties broken by appearance order in PROJECT_KEYWORDS.
  matches.sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);
  const winner = matches[0]!;
  const totalKeywords =
    PROJECT_KEYWORDS.find((e) => e.slug === winner.slug)?.keywords.length ?? 1;

  return {
    slug: winner.slug,
    confidence: Math.min(winner.matchedKeywords.length / totalKeywords, 1),
    matches,
  };
}

// ─── Business sub-domain classification (per-project) ───────────────────────

/**
 * Per-project keyword map for business sub-domains. The keys are project
 * slugs; the values are { sub-domain → keywords[] }. PO Agent calls
 * `classifyBusinessSubDomains(text, project)` after pinning the project.
 */
const BUSINESS_SUB_DOMAIN_KEYWORDS: Record<string, Record<string, string[]>> = {
  caia: {
    orchestration: ['orchestrator', 'orchestration'],
    'agent-platform': ['agent platform', 'agent runtime', 'po agent', 'ba agent', 'ea agent'],
    dashboard: ['dashboard', '/queue', '/buckets', '/timeline', 'sidebar'],
    observability: ['observability', 'logging', 'tracing', 'metric'],
    'public-api': ['public api', '/api/'],
    pipeline: ['pipeline', 'pipeline stage'],
    executor: ['executor'],
    scheduler: ['scheduler', 'task scheduler'],
    'ticket-template': ['ticket template', 'ticket-template'],
    'events-taxonomy': ['event taxonomy', 'events-taxonomy'],
    'secrets-broker': ['secrets broker', 'secrets-broker', 'vault'],
    'integrity-check': ['integrity check'],
    'behavior-suite': ['behavior suite', 'behavior test'],
    cli: [' cli ', 'command line'],
    documentation: ['readme', 'adr', 'runbook'],
    'testing-infra': ['testing infra', 'test infrastructure', 'vitest', 'playwright config'],
  },
  pokerzeno: {
    gameplay: ['gameplay', 'poker hand', 'deal cards', ' seat ', 'poker table'],
    leaderboard: ['leaderboard', 'ranking', 'standing'],
    tournaments: ['tournament', 'sit and go'],
    profile: ['profile', 'avatar', 'username'],
    billing: ['billing', 'invoice', 'subscription'],
    payments: ['payment', 'stripe', 'checkout', 'paypal'],
    content: ['article', 'strategy', 'guide'],
    engagement: ['notification', 'streak', 'badge'],
    marketing: ['marketing', 'promo', 'campaign'],
    retention: ['retention', 'churn'],
    onboarding: ['onboarding', 'sign up', 'signup'],
    settings: ['setting', 'preference'],
    social: ['chat', 'friend', 'social'],
    reviews: ['review', 'rating'],
    affiliate: ['affiliate', 'referral'],
    compliance: ['kyc', 'aml', 'compliance'],
    support: ['support', 'help center', 'ticket support'],
  },
  roulettecommunity: {
    forum: ['forum', 'thread', 'reply'],
    education: ['course', 'lesson', 'tutorial'],
    advisor: ['advisor', 'ai advice', 'recommendation engine'],
    community: ['community', 'profile', 'post'],
    content: ['article', 'news'],
    marketing: ['marketing', 'campaign'],
    onboarding: ['onboarding', 'signup'],
    settings: ['setting', 'preference'],
    social: ['social', 'follow'],
    reviews: ['review', 'rating'],
    affiliate: ['affiliate', 'referral'],
    compliance: ['kyc', 'aml', 'compliance'],
    support: ['support', 'help'],
  },
  edisoncricket: {
    scores: ['score', 'scorecard'],
    'live-coverage': ['live coverage', 'live update'],
    news: ['news', 'article'],
    analysis: ['analysis', 'commentary'],
    fantasy: ['fantasy', 'team selection'],
    community: ['community', 'forum'],
    content: ['content'],
    marketing: ['marketing'],
    onboarding: ['onboarding'],
    settings: ['setting'],
  },
  ankitatiwari: {
    portfolio: ['portfolio', 'project', 'work'],
    blog: ['blog', 'post', 'article'],
    about: ['about'],
    contact: ['contact'],
    seo: ['seo'],
    cms: ['cms'],
  },
  'prakash-tiwari': {
    portfolio: ['portfolio'],
    blog: ['blog'],
    about: ['about'],
    contact: ['contact'],
    seo: ['seo'],
    cms: ['cms'],
  },
  'chiefaia.com': {
    marketing: ['marketing', 'landing'],
    'case-studies': ['case study', 'case-studies'],
    pricing: ['pricing', 'plan'],
    docs: ['docs', 'documentation'],
    signup: ['signup', 'sign up'],
    'dashboard-marketing': ['dashboard preview'],
    legal: ['legal', 'terms', 'privacy'],
    seo: ['seo'],
  },
  framework: {
    scaffolding: ['scaffolding', 'scaffold'],
    templates: ['template'],
    boilerplate: ['boilerplate'],
    documentation: ['readme', 'docs'],
    examples: ['example'],
  },
  'site-template': {
    scaffolding: ['scaffolding'],
    templates: ['template'],
    boilerplate: ['boilerplate'],
    documentation: ['readme', 'docs'],
    examples: ['example'],
  },
  // Plugin projects share a common sub-domain shape.
  'image-provider': { api: ['api'], internals: ['internal'], documentation: ['readme'], examples: ['example'], testing: ['test'] },
  'cast-bridge': { api: ['api'], internals: ['internal'], documentation: ['readme'], examples: ['example'], testing: ['test'] },
  'dev-inspector': { api: ['api'], internals: ['internal'], documentation: ['readme'], examples: ['example'], testing: ['test'] },
  'backend-core': { api: ['api'], internals: ['internal'], documentation: ['readme'], examples: ['example'], testing: ['test'] },
  'content-engine': { api: ['api'], internals: ['internal'], documentation: ['readme'], examples: ['example'], testing: ['test'] },
  'integrity-check': { api: ['api'], internals: ['internal'], documentation: ['readme'], examples: ['example'], testing: ['test'] },
  'seo-program': { api: ['api'], internals: ['internal'], documentation: ['readme'], examples: ['example'], testing: ['test'] },
  analytics: { api: ['api'], internals: ['internal'], documentation: ['readme'], examples: ['example'], testing: ['test'] },
};

/**
 * Classify the business sub-domains a piece of text touches inside a given
 * project. Returns all matching sub-domains; never returns more than the
 * cap (default 4) — we want sharp signals, not noise.
 */
export function classifyBusinessSubDomains(
  text: string,
  projectSlug: string,
  cap = 4,
): string[] {
  const map = BUSINESS_SUB_DOMAIN_KEYWORDS[projectSlug];
  if (!map) return [];
  const lower = text.toLowerCase();
  const hits: Array<{ subDomain: string; score: number }> = [];
  for (const [subDomain, keywords] of Object.entries(map)) {
    const score = keywords.filter((k) => lower.includes(k)).length;
    if (score > 0) hits.push({ subDomain, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, cap).map((h) => h.subDomain);
}

// ─── Lifecycle classification ───────────────────────────────────────────────

const LIFECYCLE_KEYWORDS: Record<string, string[]> = {
  hotfix: ['hotfix', 'urgent fix', 'production down', 'prod down', 'critical fix'],
  bug: ['bug', 'broken', 'error', 'issue', 'wrong', 'incorrect', 'crash', 'fail', 'fix '],
  refactor: ['refactor', 'restructure', 'reorganize', 'simplify', 'rewrite', 'clean up'],
  chore: ['chore', 'bump', 'dependency', 'dep update', 'tooling', 'maintenance'],
  docs: ['document', 'docs ', 'readme', 'doc only', 'docs only'],
  spike: ['spike', 'research', 'investigate', 'explore', 'poc', 'prototype', 'proof of concept'],
  enhance: ['enhance', 'improve', 'extend', 'upgrade', 'better', 'optimize'],
  new: ['add', 'create', 'build', 'implement', 'introduce', 'new feature'],
};

/**
 * Classify the lifecycle of a piece of text. Order: hotfix > bug > refactor
 * > chore > docs > spike > enhance > new (default). Returns the highest-
 * priority bucket that matches any keyword; default `new` if nothing fires.
 */
export function classifyLifecycle(text: string): string {
  const lower = text.toLowerCase();
  // Order is important — earlier entries win when ambiguous.
  const ORDER = ['hotfix', 'bug', 'refactor', 'chore', 'docs', 'spike', 'enhance', 'new'] as const;
  for (const lifecycle of ORDER) {
    const keywords = LIFECYCLE_KEYWORDS[lifecycle]!;
    if (keywords.some((k) => lower.includes(k))) return lifecycle;
  }
  return 'new';
}

// ─── Priority classification ────────────────────────────────────────────────

const PRIORITY_KEYWORDS: Record<string, string[]> = {
  P0: ['p0', 'critical', 'production down', 'asap', 'drop everything', 'urgent'],
  P1: ['p1', 'this week', 'high priority', 'important'],
  P3: ['p3', 'nice to have', 'eventually', 'low priority', 'someday', 'backlog'],
};

/**
 * Classify priority. P0 > P1 > P3 keyword wins; default P2 (this quarter).
 */
export function classifyPriority(text: string): string {
  const lower = text.toLowerCase();
  if (PRIORITY_KEYWORDS.P0!.some((k) => lower.includes(k))) return 'P0';
  if (PRIORITY_KEYWORDS.P1!.some((k) => lower.includes(k))) return 'P1';
  if (PRIORITY_KEYWORDS.P3!.some((k) => lower.includes(k))) return 'P3';
  return 'P2';
}
