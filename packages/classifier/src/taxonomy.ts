export interface DomainDefinition {
  slug: string;
  label: string;
  description: string;
  keywords: string[];  // for keyword-based fallback classification
  subDomains?: DomainDefinition[];
}

export const FUNCTIONAL_DOMAINS: DomainDefinition[] = [
  {
    slug: 'auth',
    label: 'Authentication & Authorization',
    description: 'Login, logout, sessions, SSO, MFA, OAuth, permissions, roles, access control',
    keywords: ['auth', 'login', 'logout', 'session', 'sso', 'oauth', 'mfa', 'permission', 'role', 'access', 'token', 'jwt', 'password', 'credential', 'identity'],
    subDomains: [
      { slug: 'auth.sso', label: 'SSO / OAuth', description: 'Single sign-on and OAuth flows', keywords: ['sso', 'oauth', 'google login', 'social login', 'openid'] },
      { slug: 'auth.mfa', label: 'Multi-Factor Auth', description: 'TOTP, SMS, hardware keys', keywords: ['mfa', '2fa', 'totp', 'authenticator', 'otp'] },
      { slug: 'auth.rbac', label: 'Roles & Permissions', description: 'RBAC, permission management', keywords: ['rbac', 'role', 'permission', 'privilege', 'admin'] },
    ],
  },
  {
    slug: 'user-mgmt',
    label: 'User & Account Management',
    description: 'User profiles, account settings, onboarding, offboarding, user preferences',
    keywords: ['user', 'account', 'profile', 'onboarding', 'signup', 'registration', 'settings', 'preferences', 'avatar', 'display name'],
  },
  {
    slug: 'data-storage',
    label: 'Data & Storage',
    description: 'Database schema, migrations, data models, caching, backups, data integrity',
    keywords: ['database', 'schema', 'migration', 'table', 'model', 'cache', 'redis', 'backup', 'query', 'index', 'relation', 'foreign key', 'orm'],
    subDomains: [
      { slug: 'data-storage.schema', label: 'Schema & Migrations', description: 'DB schema design and migrations', keywords: ['schema', 'migration', 'alter table', 'add column'] },
      { slug: 'data-storage.cache', label: 'Caching', description: 'Redis, in-memory, CDN caching', keywords: ['cache', 'redis', 'memcached', 'ttl', 'invalidation'] },
    ],
  },
  {
    slug: 'api-integration',
    label: 'API & Integration',
    description: 'REST APIs, GraphQL, webhooks, third-party integrations, SDKs, API versioning',
    keywords: ['api', 'rest', 'graphql', 'webhook', 'endpoint', 'integration', 'sdk', 'http', 'request', 'response', 'openapi', 'swagger'],
  },
  {
    slug: 'ui-frontend',
    label: 'UI & Frontend',
    description: 'React components, pages, layouts, design system, responsive design, accessibility',
    keywords: ['ui', 'frontend', 'component', 'page', 'layout', 'react', 'nextjs', 'css', 'design', 'responsive', 'mobile', 'accessibility', 'a11y', 'form', 'modal', 'button'],
    subDomains: [
      { slug: 'ui-frontend.components', label: 'Components', description: 'Reusable UI components', keywords: ['component', 'button', 'input', 'modal', 'card', 'table', 'form'] },
      { slug: 'ui-frontend.pages', label: 'Pages & Routing', description: 'Page layout and navigation', keywords: ['page', 'route', 'navigation', 'router', 'layout'] },
      { slug: 'ui-frontend.design-system', label: 'Design System', description: 'Tokens, themes, shared styles', keywords: ['design system', 'token', 'theme', 'style', 'typography', 'color'] },
    ],
  },
  {
    slug: 'business-logic',
    label: 'Business Logic',
    description: 'Domain rules, workflows, state machines, calculations, business processes',
    keywords: ['business rule', 'workflow', 'state machine', 'calculation', 'process', 'logic', 'pricing', 'commission', 'algorithm'],
  },
  {
    slug: 'notifications',
    label: 'Notifications & Messaging',
    description: 'Email, SMS, push notifications, in-app notifications, message queues',
    keywords: ['notification', 'email', 'sms', 'push', 'alert', 'message', 'queue', 'webhook', 'sendgrid', 'twilio', 'firebase'],
  },
  {
    slug: 'search',
    label: 'Search & Discovery',
    description: 'Full-text search, filtering, recommendations, indexing, Meilisearch, Elasticsearch',
    keywords: ['search', 'filter', 'index', 'full-text', 'meilisearch', 'elasticsearch', 'recommendation', 'discovery', 'facet', 'query'],
  },
  {
    slug: 'analytics',
    label: 'Analytics & Reporting',
    description: 'Metrics, dashboards, exports, BI, event tracking, funnels, KPIs',
    keywords: ['analytics', 'metrics', 'dashboard', 'report', 'export', 'kpi', 'funnel', 'tracking', 'ga4', 'plausible', 'chart'],
  },
  {
    slug: 'devops',
    label: 'DevOps & Infrastructure',
    description: 'CI/CD, containerization, orchestration, environments, deployment, cloud',
    keywords: ['ci', 'cd', 'pipeline', 'docker', 'kubernetes', 'deploy', 'cloud', 'aws', 'gcp', 'cloudflare', 'environment', 'github actions', 'infrastructure'],
  },
  {
    slug: 'security',
    label: 'Security & Compliance',
    description: 'Input validation, rate limiting, GDPR, OWASP, auditing, encryption, CSP',
    keywords: ['security', 'validation', 'sanitize', 'rate limit', 'gdpr', 'compliance', 'encrypt', 'owasp', 'xss', 'csrf', 'audit', 'csp'],
  },
  {
    slug: 'performance',
    label: 'Performance & Scalability',
    description: 'Load time, Core Web Vitals, CDN, optimization, horizontal scaling, profiling',
    keywords: ['performance', 'speed', 'slow', 'optimize', 'cdn', 'lazy load', 'bundle', 'lighthouse', 'core web vitals', 'scalab'],
  },
  {
    slug: 'testing',
    label: 'Testing & Quality',
    description: 'Unit tests, integration tests, E2E tests, test data, coverage, TDD',
    keywords: ['test', 'unit test', 'integration test', 'e2e', 'playwright', 'vitest', 'jest', 'coverage', 'tdd', 'bdd', 'spec'],
  },
  {
    slug: 'observability',
    label: 'Observability & Monitoring',
    description: 'Logging, distributed tracing, alerting, health checks, error monitoring, Sentry',
    keywords: ['log', 'trace', 'monitor', 'alert', 'health', 'sentry', 'prometheus', 'grafana', 'error tracking', 'uptime', 'observability'],
  },
  {
    slug: 'documentation',
    label: 'Documentation',
    description: 'API docs, user guides, code comments, changelogs, README, OpenAPI',
    keywords: ['docs', 'documentation', 'readme', 'changelog', 'openapi', 'swagger', 'guide', 'tutorial', 'comment'],
  },
  {
    slug: 'ai-ml',
    label: 'AI & Machine Learning',
    description: 'LLM integration, prompt engineering, embeddings, fine-tuning, RAG, vector search',
    keywords: ['ai', 'ml', 'llm', 'gpt', 'claude', 'openai', 'embedding', 'vector', 'rag', 'prompt', 'fine-tuning', 'machine learning', 'neural'],
  },
];

export type NatureLabel = 'feature' | 'bug' | 'enhancement' | 'refactor' | 'chore' | 'spike' | 'migration' | 'deprecation';
export type ComplexityLabel = 'trivial' | 'small' | 'medium' | 'large' | 'xl';
export type RiskLabel = 'low-risk' | 'medium-risk' | 'high-risk' | 'needs-review';
export type LayerLabel = 'frontend' | 'backend' | 'database' | 'infrastructure' | 'shared-lib' | 'config' | 'full-stack';
export type LifecycleLabel = 'new' | 'existing-extension' | 'existing-replacement' | 'deprecating';
export type ImpactLabel = 'breaking-change' | 'additive' | 'internal-only';

export const NATURE_KEYWORDS: Record<NatureLabel, string[]> = {
  'feature': ['add', 'create', 'build', 'implement', 'new', 'introduce'],
  'bug': ['bug', 'fix', 'broken', 'error', 'issue', 'wrong', 'incorrect', 'crash', 'fail'],
  'enhancement': ['improve', 'enhance', 'upgrade', 'update', 'better', 'extend', 'expand'],
  'refactor': ['refactor', 'clean', 'restructure', 'reorganize', 'simplify', 'rewrite'],
  'chore': ['chore', 'dependency', 'update package', 'bump', 'maintenance', 'cleanup'],
  'spike': ['spike', 'research', 'investigate', 'explore', 'poc', 'prototype'],
  'migration': ['migrate', 'migration', 'move from', 'switch to', 'replace'],
  'deprecation': ['deprecate', 'remove', 'drop support', 'sunset'],
};
