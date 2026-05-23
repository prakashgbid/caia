/**
 * Provider-specific API-token validators that are simple GETs to a
 * documented noop endpoint, grouped here to keep the file count sane.
 *
 * Naming convention: validateXxxToken — used by the dispatch map in
 * ./index.ts.
 */

import type { Validator } from '../types.js';
import {
  asResult,
  assertOkResponse,
  fail,
  ok,
  probeUrl,
  requireCredential,
} from './util.js';

function makeBearerValidator(
  endpoint: string,
  keyId = 'api_token',
  extraHeaders: Record<string, string> = {},
): Validator {
  return async (input, ctx) => {
    const cred = requireCredential(input, keyId);
    if ('ok' in cred && cred.ok !== true) return cred;
    const probe = await probeUrl(ctx, endpoint, {
      Authorization: `Bearer ${(cred as { value: string }).value}`,
      Accept: 'application/json',
      ...extraHeaders,
    });
    if (!probe.ok) return { ...probe, providerId: input.providerId };
    const httpFail = assertOkResponse(input.providerId, probe);
    if (httpFail) return httpFail;
    return asResult(ok(input.providerId, 'api_token', probe.json ?? {}));
  };
}

export const validateGitlabToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, 'https://gitlab.com/api/v4/user', {
    'PRIVATE-TOKEN': (cred as { value: string }).value,
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(
    ok(input.providerId, 'api_token', {
      username: probe.json?.['username'] ?? null,
    }),
  );
};

export const validateBitbucketToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, 'https://api.bitbucket.org/2.0/user', {
    Authorization: `Bearer ${(cred as { value: string }).value}`,
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(
    ok(input.providerId, 'api_token', {
      username: probe.json?.['username'] ?? null,
    }),
  );
};

export const validateCircleCiToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, 'https://circleci.com/api/v2/me', {
    'Circle-Token': (cred as { value: string }).value,
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(ok(input.providerId, 'api_token', probe.json ?? {}));
};

export const validateBuildkiteToken = makeBearerValidator(
  'https://api.buildkite.com/v2/user',
);

export const validateVercelToken = makeBearerValidator(
  'https://api.vercel.com/v2/user',
);

export const validateFlyToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const body = JSON.stringify({ query: '{ viewer { email } }' });
  const probe = await probeUrl(
    ctx,
    'https://api.fly.io/graphql',
    {
      Authorization: `Bearer ${(cred as { value: string }).value}`,
      'Content-Type': 'application/json',
    },
    'POST',
    body,
  );
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  const data = (probe.json?.['data'] as Record<string, unknown>) ?? null;
  if (!data || !(data['viewer'])) {
    return fail(input.providerId, 'token_invalid', 'fly.io did not return a viewer');
  }
  return asResult(ok(input.providerId, 'api_token', data));
};

export const validatePostmarkToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, 'https://api.postmarkapp.com/server', {
    'X-Postmark-Server-Token': (cred as { value: string }).value,
    Accept: 'application/json',
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(ok(input.providerId, 'api_token', probe.json ?? {}));
};

export const validateSendgridToken = makeBearerValidator(
  'https://api.sendgrid.com/v3/scopes',
);

export const validateSentryToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, 'https://sentry.io/api/0/organizations/', {
    Authorization: `Bearer ${(cred as { value: string }).value}`,
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  const orgs = Array.isArray(probe.json) ? probe.json : [];
  return asResult(
    ok(input.providerId, 'api_token', { orgCount: orgs.length }),
  );
};

export const validateLinearToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const body = JSON.stringify({ query: '{ viewer { id name } }' });
  const probe = await probeUrl(
    ctx,
    'https://api.linear.app/graphql',
    {
      Authorization: (cred as { value: string }).value,
      'Content-Type': 'application/json',
    },
    'POST',
    body,
  );
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  const data = (probe.json?.['data'] as Record<string, unknown>) ?? null;
  if (!data || !(data['viewer'])) {
    return fail(input.providerId, 'token_invalid', 'Linear did not return a viewer');
  }
  return asResult(ok(input.providerId, 'api_token', data));
};

export const validateJiraToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const site = (input.choices['site'] as string) ?? '';
  if (!site) {
    return fail(input.providerId, 'choice_invalid', 'jira site (e.g. mycorp.atlassian.net) is required');
  }
  const probe = await probeUrl(ctx, `https://${site}/rest/api/3/myself`, {
    Authorization: `Basic ${(cred as { value: string }).value}`,
    Accept: 'application/json',
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(
    ok(input.providerId, 'api_token', {
      accountId: probe.json?.['accountId'] ?? null,
    }),
  );
};

export const validateNotionToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, 'https://api.notion.com/v1/users/me', {
    Authorization: `Bearer ${(cred as { value: string }).value}`,
    'Notion-Version': '2022-06-28',
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(ok(input.providerId, 'api_token', probe.json ?? {}));
};

export const validateFigmaToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'pat');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, 'https://api.figma.com/v1/me', {
    'X-Figma-Token': (cred as { value: string }).value,
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(ok(input.providerId, 'api_token', probe.json ?? {}));
};

export const validateHoneycombToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, 'https://api.honeycomb.io/1/auth', {
    'X-Honeycomb-Team': (cred as { value: string }).value,
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(ok(input.providerId, 'api_token', probe.json ?? {}));
};

export const validateAxiomToken = makeBearerValidator(
  'https://api.axiom.co/v1/user',
);

export const validateNeonToken = makeBearerValidator(
  'https://console.neon.tech/api/v2/users/me',
);

export const validateSupabaseKey: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'service_role_key');
  if ('ok' in cred && cred.ok !== true) return cred;
  const projectUrl = (input.choices['projectUrl'] as string) ?? '';
  if (!projectUrl) {
    return fail(input.providerId, 'choice_invalid', 'projectUrl is required');
  }
  const probe = await probeUrl(ctx, `${projectUrl}/rest/v1/`, {
    apikey: (cred as { value: string }).value,
    Authorization: `Bearer ${(cred as { value: string }).value}`,
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(ok(input.providerId, 'api_token', {}));
};

export const validatePostHogToken = makeBearerValidator(
  'https://app.posthog.com/api/users/@me/',
);

export const validatePlausibleToken = makeBearerValidator(
  'https://plausible.io/api/v1/sites',
);

export const validateAnthropicKey: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'anthropic_api_key');
  if ('ok' in cred && cred.ok !== true) return cred;
  // Use the 1-token ping pattern from the spec — POST /v1/messages with
  // max_tokens=1. A 400 with "invalid api key" obviously fails; a 200
  // or 200-shaped error from the model means the key is good.
  const probe = await probeUrl(
    ctx,
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key': (cred as { value: string }).value,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    'POST',
    JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  );
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  // Both 200 and 200-shaped errors from the model imply the key was
  // accepted; only 401/403 indicate a bad key.
  if (probe.res.status === 401 || probe.res.status === 403) {
    return fail(input.providerId, 'token_invalid', 'Anthropic rejected the API key');
  }
  if (probe.res.status >= 500) {
    return fail(input.providerId, 'provider_error', `Anthropic ${probe.res.status}`);
  }
  return asResult(ok(input.providerId, 'api_token', {}));
};

export const validateStripePaymentMethod: Validator = async (input, ctx) => {
  // Stripe payment method ids are validated by attaching them to a
  // customer; here we just confirm the format (`pm_...`) before
  // accepting. Real attachment happens at provisioning time.
  const cred = requireCredential(input, 'stripe_payment_method_id');
  if ('ok' in cred && cred.ok !== true) return cred;
  const v = (cred as { value: string }).value;
  if (!/^pm_[A-Za-z0-9_]+$/.test(v)) {
    return fail(input.providerId, 'choice_invalid', 'not a Stripe payment_method id (expected pm_...)');
  }
  // No external probe — silent ok; engine still writes audit row.
  // Use `ctx.now()` to keep the signature parameter referenced.
  void ctx.now();
  return asResult(ok(input.providerId, 'api_token', {}));
};

export const validateCloudinaryKey: Validator = async (input, ctx) => {
  const ak = requireCredential(input, 'api_key');
  if ('ok' in ak && ak.ok !== true) return ak;
  const sk = requireCredential(input, 'api_secret');
  if ('ok' in sk && sk.ok !== true) return sk;
  const cloud = (input.choices['cloudName'] as string) ?? '';
  if (!cloud) {
    return fail(input.providerId, 'choice_invalid', 'cloudName is required');
  }
  const auth = Buffer.from(
    `${(ak as { value: string }).value}:${(sk as { value: string }).value}`,
  ).toString('base64');
  const probe = await probeUrl(
    ctx,
    `https://api.cloudinary.com/v1_1/${cloud}/usage`,
    { Authorization: `Basic ${auth}` },
  );
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  return asResult(ok(input.providerId, 'api_token', probe.json ?? {}));
};
