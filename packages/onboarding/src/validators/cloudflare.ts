/**
 * Cloudflare validator — used by cloud / dns / cdn / domain categories.
 * Hits `GET https://api.cloudflare.com/client/v4/user/tokens/verify`
 * which returns 200 with `{ result: { status: 'active', id: ... } }`
 * when the token is valid. Inactive / expired tokens come back 401.
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

const CF_API = 'https://api.cloudflare.com/client/v4';

export const validateCloudflareToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, `${CF_API}/user/tokens/verify`, {
    Authorization: `Bearer ${(cred as { value: string }).value}`,
    'Content-Type': 'application/json',
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  const success = (probe.json?.['success'] as boolean) ?? false;
  if (!success) {
    return fail(
      input.providerId,
      'token_invalid',
      'Cloudflare reported the token is not active',
      'Create a new token at https://dash.cloudflare.com/profile/api-tokens',
    );
  }
  const result = (probe.json?.['result'] as Record<string, unknown>) ?? {};
  if (result['status'] !== 'active') {
    return fail(
      input.providerId,
      'token_expired',
      `Cloudflare token status: ${String(result['status'])}`,
    );
  }
  return asResult(
    ok(input.providerId, 'api_token', {
      tokenId: result['id'] ?? null,
      expiresOn: result['expires_on'] ?? null,
    }),
  );
};
