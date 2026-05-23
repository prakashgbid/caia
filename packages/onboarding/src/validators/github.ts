/**
 * GitHub validators.
 *
 * Two flavours:
 *  - `validateGithubToken` — used by repo / ci / pm-issues categories.
 *    Hits `GET https://api.github.com/user` and reads the
 *    `X-OAuth-Scopes` header to confirm granted scopes.
 *  - `validateGithubOAuth` — same endpoint, treated as an OAuth refresh
 *    token (the wizard already exchanged code for token before calling
 *    the engine). The two are kept distinct so the audit log records the
 *    archetype the customer chose.
 */

import type { Validator } from '../types.js';
import {
  asResult,
  assertOkResponse,
  fail,
  ok,
  probeUrl,
  requireCredential,
  scopesSatisfied,
} from './util.js';

const GITHUB_API = 'https://api.github.com';

function parseScopes(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const validateGithubToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, `${GITHUB_API}/user`, {
    Authorization: `token ${(cred as { value: string }).value}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'caia-onboarding/0.1',
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  const scopes = parseScopes(probe.res.headers.get('X-OAuth-Scopes'));
  const required = ['repo'];
  if (!scopesSatisfied(required, scopes)) {
    return fail(
      input.providerId,
      'scope_insufficient',
      `missing required GitHub scopes: ${required.join(',')}`,
      'Create a new token at https://github.com/settings/tokens/new?scopes=repo,workflow',
    );
  }
  const login = (probe.json?.['login'] as string) ?? null;
  const id = (probe.json?.['id'] as number) ?? null;
  return asResult(
    ok(input.providerId, 'api_token', { login, id }, scopes),
  );
};

export const validateGithubOAuth: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'oauth_refresh_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, `${GITHUB_API}/user`, {
    Authorization: `Bearer ${(cred as { value: string }).value}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'caia-onboarding/0.1',
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  const scopes = parseScopes(probe.res.headers.get('X-OAuth-Scopes'));
  return asResult(
    ok(input.providerId, 'oauth', { login: probe.json?.['login'] ?? null }, scopes),
  );
};
