/**
 * `@caia/onboarding/categories` — the static catalog of all 19 categories.
 *
 * Each entry is the canonical description of one wizard screen: its
 * provider menu, the credential descriptors per provider, and whether
 * the category is required vs. optional. The wizard UI and the
 * validators both read this catalog.
 *
 * Reference: research/step1_onboarding_spec_2026.md §1.
 */

import type { CategoryDefinition, ProviderOption } from '../types.js';
import { CategoryDefinitionSchema } from '../types.js';

const noCredOption = (id: string, label: string): {
  id: string;
  label: string;
  archetype: 'api_token';
  credentialDescriptors: never[];
  metadata: Record<string, unknown>;
  noCredentials: true;
} => ({
  id,
  label,
  archetype: 'api_token',
  credentialDescriptors: [],
  metadata: {},
  noCredentials: true,
});

export const IDENTITY: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'identity',
  ordinal: 1,
  required: true,
  label: 'Identity & contact',
  description:
    "Full name, primary email, org, billing email, time zone, locale. The owner's email domain is DNS-MX-checked and disposable-email providers are rejected.",
  providers: [noCredOption('self', 'Customer-provided identity')],
});

export const AUTH: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'auth',
  ordinal: 2,
  required: true,
  label: 'Authentication provider',
  description:
    'Which identity provider does the customer use to sign into the CAIA dashboard?',
  providers: [
    {
      id: 'google',
      label: 'Google',
      archetype: 'oauth',
      credentialDescriptors: [
        {
          keyId: 'oauth_refresh_token',
          archetype: 'oauth',
          scopesRequired: ['openid', 'email', 'profile'],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    {
      id: 'github',
      label: 'GitHub',
      archetype: 'oauth',
      credentialDescriptors: [
        {
          keyId: 'oauth_refresh_token',
          archetype: 'oauth',
          scopesRequired: ['read:user', 'user:email'],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    {
      id: 'apple',
      label: 'Apple',
      archetype: 'oauth',
      credentialDescriptors: [
        {
          keyId: 'oauth_refresh_token',
          archetype: 'oauth',
          scopesRequired: ['name', 'email'],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    {
      id: 'microsoft',
      label: 'Microsoft',
      archetype: 'oauth',
      credentialDescriptors: [
        {
          keyId: 'oauth_refresh_token',
          archetype: 'oauth',
          scopesRequired: ['openid', 'email', 'profile'],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    {
      id: 'email-magic-link',
      label: 'Email magic-link (CAIA-hosted)',
      archetype: 'api_token',
      credentialDescriptors: [],
      metadata: {},
      noCredentials: true,
    },
  ],
});

export const PRICING: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'pricing',
  ordinal: 3,
  required: true,
  label: 'Pricing tier & LLM billing mode',
  description:
    'Choose tier and how Anthropic usage is billed: BYOK (bring your Anthropic key) or credits.',
  providers: [
    {
      id: 'byok',
      label: 'Bring your own Anthropic API key',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'anthropic_api_key',
          archetype: 'api_token',
          scopesRequired: ['messages'],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    {
      id: 'credits',
      label: 'Buy CAIA credits',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'stripe_payment_method_id',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
  ],
});

export const REPO: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'repo',
  ordinal: 4,
  required: true,
  label: 'Code repository',
  description:
    'Where will CAIA push generated code? Bring your own host or pick CAIA-managed.',
  providers: [
    {
      id: 'github',
      label: 'GitHub',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['repo', 'workflow'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/user' },
      noCredentials: false,
    },
    {
      id: 'gitlab',
      label: 'GitLab',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['api', 'write_repository'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/user' },
      noCredentials: false,
    },
    {
      id: 'bitbucket',
      label: 'Bitbucket',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['repository'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/user' },
      noCredentials: false,
    },
    noCredOption('caia-managed', 'CAIA-managed repo (default)'),
  ],
});

export const CI: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'ci',
  ordinal: 5,
  required: true,
  label: 'CI/CD provider',
  description:
    "Where will CI run? GitHub Actions, CircleCI, Buildkite, self-hosted Jenkins, or CAIA-managed.",
  providers: [
    {
      id: 'github-actions',
      label: 'GitHub Actions',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['actions:read'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/user' },
      noCredentials: false,
    },
    {
      id: 'circleci',
      label: 'CircleCI',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/me' },
      noCredentials: false,
    },
    {
      id: 'buildkite',
      label: 'Buildkite',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['read_user'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/user' },
      noCredentials: false,
    },
    noCredOption('caia-managed', 'CAIA-managed CI'),
  ],
});

export const CLOUD: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'cloud',
  ordinal: 6,
  required: true,
  label: 'Cloud provider for application runtime',
  description:
    'Where will the app run? Pages workers, AWS, GCP, Azure, Fly, Render, self-hosted.',
  providers: [
    {
      id: 'cloudflare-pages',
      label: 'Cloudflare Pages / Workers',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['Account:Read'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/user/tokens/verify' },
      noCredentials: false,
    },
    {
      id: 'aws',
      label: 'AWS',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'access_key_id',
          archetype: 'api_token',
          scopesRequired: ['sts:GetCallerIdentity'],
          storeSecret: true,
        },
        {
          keyId: 'secret_access_key',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyAction: 'sts:GetCallerIdentity' },
      noCredentials: false,
    },
    {
      id: 'vercel',
      label: 'Vercel',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/v2/user' },
      noCredentials: false,
    },
    {
      id: 'fly',
      label: 'Fly.io',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/graphql' },
      noCredentials: false,
    },
    noCredOption('caia-managed', 'CAIA-managed (k3s pool)'),
  ],
});

export const DOMAIN: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'domain',
  ordinal: 7,
  required: true, // promoted to required per the operator's BYO directive
  label: 'Domain registrar',
  description:
    'Registrar of record for apex domains. Cloudflare / Namecheap / Porkbun have programmatic APIs; others are manual.',
  providers: [
    {
      id: 'cloudflare-registrar',
      label: 'Cloudflare Registrar',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['Account:Read'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/user/tokens/verify' },
      noCredentials: false,
    },
    {
      id: 'namecheap',
      label: 'Namecheap',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    noCredOption('manual', 'Other registrar (manual)'),
    noCredOption('none', 'No custom domain (CAIA subdomain)'),
  ],
});

export const DNS: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'dns',
  ordinal: 8,
  required: true,
  label: 'DNS provider',
  description:
    'Authoritative DNS for the zones above. CAIA places a TXT record to prove control.',
  providers: [
    {
      id: 'cloudflare-dns',
      label: 'Cloudflare DNS',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['Zone:DNS:Edit'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/user/tokens/verify' },
      noCredentials: false,
    },
    {
      id: 'route53',
      label: 'AWS Route 53',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'access_key_id',
          archetype: 'api_token',
          scopesRequired: ['sts:GetCallerIdentity'],
          storeSecret: true,
        },
        {
          keyId: 'secret_access_key',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyAction: 'sts:GetCallerIdentity' },
      noCredentials: false,
    },
    {
      id: 'manual-dns-proof',
      label: 'Customer-controlled NS (TXT proof)',
      archetype: 'dns',
      credentialDescriptors: [
        {
          keyId: 'dns_proof_token',
          archetype: 'dns',
          scopesRequired: [],
          storeSecret: false,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    noCredOption('none', 'CAIA-managed DNS'),
  ],
});

export const CDN: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'cdn',
  ordinal: 9,
  required: true,
  label: 'CDN + asset/image hosting',
  description:
    'Where static assets + images live. R2, CloudFront, Cloudinary, Imgix, or self-hosted.',
  providers: [
    {
      id: 'cloudflare-r2',
      label: 'Cloudflare R2',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'access_key_id',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
        {
          keyId: 'secret_access_key',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    {
      id: 'aws-cloudfront-s3',
      label: 'AWS CloudFront + S3',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'access_key_id',
          archetype: 'api_token',
          scopesRequired: ['sts:GetCallerIdentity'],
          storeSecret: true,
        },
        {
          keyId: 'secret_access_key',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    {
      id: 'cloudinary',
      label: 'Cloudinary',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_key',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
        {
          keyId: 'api_secret',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    noCredOption('caia-managed', 'CAIA-managed R2'),
  ],
});

export const DATABASE: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'database',
  ordinal: 10,
  required: true,
  label: 'Database provider',
  description:
    'Postgres-flavoured DB for the app. Self-hosted, Supabase, Neon, RDS, or CAIA-managed.',
  providers: [
    {
      id: 'self-hosted-postgres',
      label: 'Self-hosted Postgres (DSN)',
      archetype: 'endpoint',
      credentialDescriptors: [
        {
          keyId: 'dsn',
          archetype: 'endpoint',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    {
      id: 'supabase',
      label: 'Supabase',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'service_role_key',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: {},
      noCredentials: false,
    },
    {
      id: 'neon',
      label: 'Neon',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/users/me' },
      noCredentials: false,
    },
    noCredOption('caia-managed', 'CAIA-managed Postgres'),
  ],
});

export const EMAIL: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'email',
  ordinal: 11,
  required: true,
  label: 'Email transactional provider',
  description:
    'Who sends magic-links and notification email. Resend, Postmark, SES, SendGrid, Mailgun, or customer SMTP.',
  providers: [
    {
      id: 'resend',
      label: 'Resend',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/domains' },
      noCredentials: false,
    },
    {
      id: 'postmark',
      label: 'Postmark',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/server' },
      noCredentials: false,
    },
    {
      id: 'sendgrid',
      label: 'SendGrid',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/scopes' },
      noCredentials: false,
    },
    noCredOption('caia-managed', 'CAIA bootstrap mail'),
  ],
});

export const ANALYTICS: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'analytics',
  ordinal: 12,
  required: true, // promoted: required + caia-managed default per operator
  label: 'Analytics provider',
  description:
    'Plausible, GA4, Mixpanel, PostHog, Cloudflare Web Analytics, or none.',
  providers: [
    {
      id: 'plausible-cloud',
      label: 'Plausible (cloud)',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/api/v1/sites' },
      noCredentials: false,
    },
    {
      id: 'posthog-cloud',
      label: 'PostHog (cloud)',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/api/users/@me' },
      noCredentials: false,
    },
    noCredOption('none', 'No analytics'),
  ],
});

export const ERRORS: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'errors',
  ordinal: 13,
  required: true,
  label: 'Error tracking provider',
  description:
    "Sentry, Rollbar, Datadog Errors, Bugsnag, Cloudflare Logpush, or none.",
  providers: [
    {
      id: 'sentry',
      label: 'Sentry',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['org:read'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/api/0/organizations/' },
      noCredentials: false,
    },
    noCredOption('cloudflare-logpush', 'Cloudflare Logpush (default)'),
  ],
});

export const OBSERVABILITY: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'observability',
  ordinal: 14,
  required: true, // promoted to required
  label: 'Observability / APM',
  description:
    'Datadog, Grafana Cloud, Honeycomb, Axiom, or none.',
  providers: [
    {
      id: 'honeycomb',
      label: 'Honeycomb',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/1/auth' },
      noCredentials: false,
    },
    {
      id: 'axiom',
      label: 'Axiom',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/v1/user' },
      noCredentials: false,
    },
    noCredOption('none', 'No APM'),
  ],
});

export const PM: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'pm',
  ordinal: 15,
  required: true,
  label: 'Issue tracker / project management',
  description:
    'Linear, Jira, GitHub Issues, GitLab Issues, Notion, Asana, ClickUp, etc.',
  providers: [
    {
      id: 'linear',
      label: 'Linear',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: 'https://api.linear.app/graphql' },
      noCredentials: false,
    },
    {
      id: 'jira-cloud',
      label: 'Jira Cloud',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/rest/api/3/myself' },
      noCredentials: false,
    },
    {
      id: 'github-issues',
      label: 'GitHub Issues',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: ['repo'],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: '/user' },
      noCredentials: false,
    },
    noCredOption('caia-managed', 'CAIA-managed tracker'),
  ],
});

// ============================================================
// Optional categories (4)
// ============================================================
export const DOCS: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'docs',
  ordinal: 16,
  required: false,
  label: 'Documentation host',
  description: 'Notion, GitBook, Confluence, ReadMe.io, Docusaurus, or none.',
  providers: [
    {
      id: 'notion',
      label: 'Notion',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'api_token',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: 'https://api.notion.com/v1/users/me' },
      noCredentials: false,
    },
    noCredOption('docusaurus-in-repo', 'Docusaurus inside the repo'),
    noCredOption('none', 'No docs host'),
  ],
});

export const DESIGN: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'design',
  ordinal: 17,
  required: false,
  label: 'Design source',
  description: 'Figma, v0, Lovable, Bolt, Builder.io, or CAIA default.',
  providers: [
    {
      id: 'figma',
      label: 'Figma',
      archetype: 'api_token',
      credentialDescriptors: [
        {
          keyId: 'pat',
          archetype: 'api_token',
          scopesRequired: [],
          storeSecret: true,
        },
      ],
      metadata: { verifyEndpoint: 'https://api.figma.com/v1/me' },
      noCredentials: false,
    },
    noCredOption('claude-design', 'Claude Design (default)'),
  ],
});

export const COMPLIANCE: CategoryDefinition = CategoryDefinitionSchema.parse({
  id: 'compliance',
  ordinal: 18,
  required: false,
  label: 'Compliance / legal posture',
  description:
    'Jurisdiction, data-residency, regulatory scope flags, cookie consent strictness, DPA signed, incident contact.',
  providers: [noCredOption('self', 'Customer-declared posture')],
});

export const ANTHROPIC_PREFS: CategoryDefinition =
  CategoryDefinitionSchema.parse({
    id: 'anthropic_prefs',
    ordinal: 19,
    required: false,
    label: 'Anthropic model preferences',
    description:
      'Preferred Sonnet/Opus/Haiku ratio, hourly rate-limit cap, zero-retention flag.',
    providers: [noCredOption('preferences', 'Preferences only')],
  });

// ============================================================
// Catalog — ordered list, exported for the wizard + engine.
// ============================================================
export const ALL_CATEGORIES: readonly CategoryDefinition[] = [
  IDENTITY,
  AUTH,
  PRICING,
  REPO,
  CI,
  CLOUD,
  DOMAIN,
  DNS,
  CDN,
  DATABASE,
  EMAIL,
  ANALYTICS,
  ERRORS,
  OBSERVABILITY,
  PM,
  DOCS,
  DESIGN,
  COMPLIANCE,
  ANTHROPIC_PREFS,
];

export function getCategory(id: string): CategoryDefinition | undefined {
  return ALL_CATEGORIES.find((c) => c.id === id);
}

export function getProvider(
  categoryId: string,
  providerId: string,
): ProviderOption | undefined {
  const cat = getCategory(categoryId);
  if (!cat) return undefined;
  return cat.providers.find((p) => p.id === providerId);
}

// Re-export the ID constants so callers don't have to import from types.
export {
  MANDATORY_CATEGORY_IDS,
  OPTIONAL_CATEGORY_IDS,
  CATEGORY_IDS,
} from '../types.js';
