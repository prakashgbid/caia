import { describe, it, expect } from 'vitest';
import { validateGithubToken } from '../src/validators/github.js';
import { validateCloudflareToken } from '../src/validators/cloudflare.js';
import { validateResendToken } from '../src/validators/resend.js';
import {
  validateGitlabToken,
  validateBitbucketToken,
  validateCircleCiToken,
  validateBuildkiteToken,
  validateVercelToken,
  validateFlyToken,
  validatePostmarkToken,
  validateSendgridToken,
  validateSentryToken,
  validateLinearToken,
  validateJiraToken,
  validateNotionToken,
  validateFigmaToken,
  validateHoneycombToken,
  validateAxiomToken,
  validateNeonToken,
  validateSupabaseKey,
  validatePostHogToken,
  validatePlausibleToken,
  validateAnthropicKey,
  validateStripePaymentMethod,
  validateCloudinaryKey,
} from '../src/validators/api-tokens.js';
import { mockFetch, fixedContext } from './helpers.js';

const baseInput = {
  tenantId: 't1',
  category: 'repo' as const,
  providerId: 'github',
  choices: {},
  credentials: { api_token: 'gh_abc' },
};

describe('GitHub validator', () => {
  it('passes when /user returns 200 and required scopes are granted', async () => {
    const { fetch } = mockFetch({
      'https://api.github.com/user': {
        status: 200,
        body: { login: 'octocat', id: 1 },
        headers: { 'X-OAuth-Scopes': 'repo, workflow' },
      },
    });
    const r = await validateGithubToken(baseInput, fixedContext(fetch));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.metadata['login']).toBe('octocat');
      expect(r.scopesGranted).toContain('repo');
    }
  });

  it('fails with scope_insufficient when repo is missing', async () => {
    const { fetch } = mockFetch({
      'https://api.github.com/user': {
        status: 200,
        body: { login: 'octocat', id: 1 },
        headers: { 'X-OAuth-Scopes': 'read:user' },
      },
    });
    const r = await validateGithubToken(baseInput, fixedContext(fetch));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('scope_insufficient');
  });

  it('fails with token_invalid on 401', async () => {
    const { fetch } = mockFetch({
      'https://api.github.com/user': { status: 401, body: { message: 'bad' } },
    });
    const r = await validateGithubToken(baseInput, fixedContext(fetch));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('token_invalid');
  });

  it('fails with network_error when fetch throws', async () => {
    const fetchImpl = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const r = await validateGithubToken(baseInput, fixedContext(fetchImpl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('network_error');
  });

  it('rejects missing credential', async () => {
    const { fetch } = mockFetch({});
    const r = await validateGithubToken(
      { ...baseInput, credentials: {} },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('choice_invalid');
  });
});

describe('Cloudflare validator', () => {
  it('passes when verify returns active', async () => {
    const { fetch } = mockFetch({
      'https://api.cloudflare.com/client/v4/user/tokens/verify': {
        status: 200,
        body: { success: true, result: { id: 'tok1', status: 'active' } },
      },
    });
    const r = await validateCloudflareToken(
      { ...baseInput, category: 'cloud' as const, providerId: 'cloudflare-pages' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('fails with token_expired if status is expired', async () => {
    const { fetch } = mockFetch({
      'https://api.cloudflare.com/client/v4/user/tokens/verify': {
        status: 200,
        body: { success: true, result: { id: 'tok1', status: 'expired' } },
      },
    });
    const r = await validateCloudflareToken(
      { ...baseInput, category: 'cloud' as const },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('token_expired');
  });

  it('fails with token_invalid when API returns success: false', async () => {
    const { fetch } = mockFetch({
      'https://api.cloudflare.com/client/v4/user/tokens/verify': {
        status: 200,
        body: { success: false },
      },
    });
    const r = await validateCloudflareToken(
      { ...baseInput, category: 'cloud' as const },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('token_invalid');
  });

  it('fails on 401', async () => {
    const { fetch } = mockFetch({
      'https://api.cloudflare.com/client/v4/user/tokens/verify': {
        status: 401,
        body: {},
      },
    });
    const r = await validateCloudflareToken(
      { ...baseInput, category: 'cloud' as const },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });
});

describe('Resend validator', () => {
  it('passes with a domain list', async () => {
    const { fetch } = mockFetch({
      'https://api.resend.com/domains': {
        status: 200,
        body: { data: [{ id: 'd1' }, { id: 'd2' }] },
      },
    });
    const r = await validateResendToken(
      { ...baseInput, category: 'email' as const, providerId: 'resend' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.metadata['domainCount']).toBe(2);
  });

  it('fails on 401', async () => {
    const { fetch } = mockFetch({
      'https://api.resend.com/domains': { status: 401, body: {} },
    });
    const r = await validateResendToken(
      { ...baseInput, category: 'email' as const, providerId: 'resend' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('fails on 429 rate-limited', async () => {
    const { fetch } = mockFetch({
      'https://api.resend.com/domains': { status: 429, body: {} },
    });
    const r = await validateResendToken(
      { ...baseInput, category: 'email' as const, providerId: 'resend' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('rate_limited');
  });
});

describe('GitLab + Bitbucket validators', () => {
  it('GitLab passes with username', async () => {
    const { fetch } = mockFetch({
      'https://gitlab.com/api/v4/user': { status: 200, body: { username: 'gloria' } },
    });
    const r = await validateGitlabToken(
      { ...baseInput, providerId: 'gitlab' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Bitbucket fails on 403', async () => {
    const { fetch } = mockFetch({
      'https://api.bitbucket.org/2.0/user': { status: 403, body: {} },
    });
    const r = await validateBitbucketToken(
      { ...baseInput, providerId: 'bitbucket' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });
});

describe('CI validators', () => {
  it('CircleCI passes on /me 200', async () => {
    const { fetch } = mockFetch({
      'https://circleci.com/api/v2/me': { status: 200, body: { id: 'u' } },
    });
    const r = await validateCircleCiToken(
      { ...baseInput, providerId: 'circleci' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Buildkite passes on /user 200', async () => {
    const { fetch } = mockFetch({
      'https://api.buildkite.com/v2/user': { status: 200, body: { id: 'u' } },
    });
    const r = await validateBuildkiteToken(
      { ...baseInput, providerId: 'buildkite' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });
});

describe('Cloud validators', () => {
  it('Vercel passes', async () => {
    const { fetch } = mockFetch({
      'https://api.vercel.com/v2/user': { status: 200, body: { user: { id: 'u' } } },
    });
    const r = await validateVercelToken(
      { ...baseInput, providerId: 'vercel' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Fly.io requires a viewer in the GraphQL response', async () => {
    const { fetch } = mockFetch({
      'https://api.fly.io/graphql': {
        status: 200,
        body: { data: { viewer: { email: 'a@b' } } },
      },
    });
    const r = await validateFlyToken(
      { ...baseInput, providerId: 'fly' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Fly.io fails when GraphQL has no viewer', async () => {
    const { fetch } = mockFetch({
      'https://api.fly.io/graphql': { status: 200, body: { data: {} } },
    });
    const r = await validateFlyToken(
      { ...baseInput, providerId: 'fly' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });
});

describe('Email + error tracking validators', () => {
  it('Postmark passes', async () => {
    const { fetch } = mockFetch({
      'https://api.postmarkapp.com/server': { status: 200, body: { ID: 1 } },
    });
    const r = await validatePostmarkToken(
      { ...baseInput, category: 'email' as const, providerId: 'postmark' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('SendGrid passes on /scopes', async () => {
    const { fetch } = mockFetch({
      'https://api.sendgrid.com/v3/scopes': { status: 200, body: { scopes: [] } },
    });
    const r = await validateSendgridToken(
      { ...baseInput, category: 'email' as const, providerId: 'sendgrid' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Sentry passes when /organizations/ returns an array', async () => {
    const { fetch } = mockFetch({
      'https://sentry.io/api/0/organizations/': {
        status: 200,
        body: [{ slug: 'org-1' }],
      },
    });
    const r = await validateSentryToken(
      { ...baseInput, category: 'errors' as const, providerId: 'sentry' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });
});

describe('PM validators', () => {
  it('Linear passes with viewer', async () => {
    const { fetch } = mockFetch({
      'https://api.linear.app/graphql': {
        status: 200,
        body: { data: { viewer: { id: 'v', name: 'A' } } },
      },
    });
    const r = await validateLinearToken(
      { ...baseInput, category: 'pm' as const, providerId: 'linear' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Jira requires a site choice', async () => {
    const { fetch } = mockFetch({});
    const r = await validateJiraToken(
      { ...baseInput, category: 'pm' as const, providerId: 'jira-cloud' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('choice_invalid');
  });

  it('Jira passes when site + token resolve to /myself', async () => {
    const { fetch } = mockFetch({
      'https://my.atlassian.net/rest/api/3/myself': {
        status: 200,
        body: { accountId: '5f' },
      },
    });
    const r = await validateJiraToken(
      {
        ...baseInput,
        category: 'pm' as const,
        providerId: 'jira-cloud',
        choices: { site: 'my.atlassian.net' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });
});

describe('Docs / Design validators', () => {
  it('Notion passes', async () => {
    const { fetch } = mockFetch({
      'https://api.notion.com/v1/users/me': {
        status: 200,
        body: { type: 'person' },
      },
    });
    const r = await validateNotionToken(
      { ...baseInput, category: 'docs' as const, providerId: 'notion' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Figma requires the `pat` credential', async () => {
    const { fetch } = mockFetch({});
    const r = await validateFigmaToken(
      {
        ...baseInput,
        category: 'design' as const,
        providerId: 'figma',
        credentials: {},
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('choice_invalid');
  });

  it('Figma passes with /v1/me', async () => {
    const { fetch } = mockFetch({
      'https://api.figma.com/v1/me': { status: 200, body: { email: 'x@y' } },
    });
    const r = await validateFigmaToken(
      {
        ...baseInput,
        category: 'design' as const,
        providerId: 'figma',
        credentials: { pat: 'fig_xxx' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });
});

describe('Observability + analytics validators', () => {
  it('Honeycomb /1/auth passes', async () => {
    const { fetch } = mockFetch({
      'https://api.honeycomb.io/1/auth': { status: 200, body: { team: {} } },
    });
    const r = await validateHoneycombToken(
      { ...baseInput, category: 'observability' as const, providerId: 'honeycomb' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Axiom /v1/user passes', async () => {
    const { fetch } = mockFetch({
      'https://api.axiom.co/v1/user': { status: 200, body: { id: 'u' } },
    });
    const r = await validateAxiomToken(
      { ...baseInput, category: 'observability' as const, providerId: 'axiom' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('PostHog @me passes', async () => {
    const { fetch } = mockFetch({
      'https://app.posthog.com/api/users/@me/': { status: 200, body: { id: 'u' } },
    });
    const r = await validatePostHogToken(
      { ...baseInput, category: 'analytics' as const, providerId: 'posthog-cloud' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Plausible /sites passes', async () => {
    const { fetch } = mockFetch({
      'https://plausible.io/api/v1/sites': { status: 200, body: [] },
    });
    const r = await validatePlausibleToken(
      { ...baseInput, category: 'analytics' as const, providerId: 'plausible-cloud' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });
});

describe('Database validators', () => {
  it('Neon /users/me passes', async () => {
    const { fetch } = mockFetch({
      'https://console.neon.tech/api/v2/users/me': { status: 200, body: { id: 'u' } },
    });
    const r = await validateNeonToken(
      { ...baseInput, category: 'database' as const, providerId: 'neon' },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Supabase requires projectUrl', async () => {
    const { fetch } = mockFetch({});
    const r = await validateSupabaseKey(
      {
        ...baseInput,
        category: 'database' as const,
        providerId: 'supabase',
        credentials: { service_role_key: 'sb_x' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('Supabase passes with projectUrl + key', async () => {
    const { fetch } = mockFetch({
      'https://abc.supabase.co/rest/v1/': { status: 200, body: {} },
    });
    const r = await validateSupabaseKey(
      {
        ...baseInput,
        category: 'database' as const,
        providerId: 'supabase',
        choices: { projectUrl: 'https://abc.supabase.co' },
        credentials: { service_role_key: 'sb_x' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });
});

describe('Anthropic + Stripe + Cloudinary validators', () => {
  it('Anthropic API key passes on 200', async () => {
    const { fetch } = mockFetch({
      'https://api.anthropic.com/v1/messages': { status: 200, body: {} },
    });
    const r = await validateAnthropicKey(
      {
        ...baseInput,
        category: 'pricing' as const,
        providerId: 'byok',
        credentials: { anthropic_api_key: 'sk-ant-xx' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('Anthropic 401 → token_invalid', async () => {
    const { fetch } = mockFetch({
      'https://api.anthropic.com/v1/messages': { status: 401, body: {} },
    });
    const r = await validateAnthropicKey(
      {
        ...baseInput,
        category: 'pricing' as const,
        providerId: 'byok',
        credentials: { anthropic_api_key: 'bad' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('Stripe payment method format check', async () => {
    const { fetch } = mockFetch({});
    const ok = await validateStripePaymentMethod(
      {
        ...baseInput,
        category: 'pricing' as const,
        providerId: 'credits',
        credentials: { stripe_payment_method_id: 'pm_1abc' },
      },
      fixedContext(fetch),
    );
    expect(ok.ok).toBe(true);
    const bad = await validateStripePaymentMethod(
      {
        ...baseInput,
        category: 'pricing' as const,
        providerId: 'credits',
        credentials: { stripe_payment_method_id: 'not-it' },
      },
      fixedContext(fetch),
    );
    expect(bad.ok).toBe(false);
  });

  it('Cloudinary needs cloudName + key + secret', async () => {
    const { fetch } = mockFetch({});
    const r = await validateCloudinaryKey(
      {
        ...baseInput,
        category: 'cdn' as const,
        providerId: 'cloudinary',
        credentials: { api_key: 'a', api_secret: 'b' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('Cloudinary passes with /usage', async () => {
    const { fetch } = mockFetch({
      'https://api.cloudinary.com/v1_1/my/usage': {
        status: 200,
        body: { used_percent: 1.2 },
      },
    });
    const r = await validateCloudinaryKey(
      {
        ...baseInput,
        category: 'cdn' as const,
        providerId: 'cloudinary',
        choices: { cloudName: 'my' },
        credentials: { api_key: 'a', api_secret: 'b' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });
});
