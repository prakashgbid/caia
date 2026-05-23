/**
 * Resend transactional-email validator.
 * Hits `GET https://api.resend.com/domains` which lists verified sender
 * domains; 200 confirms the token is valid, 401 invalidates.
 */

import type { Validator } from '../types.js';
import {
  asResult,
  assertOkResponse,
  ok,
  probeUrl,
  requireCredential,
} from './util.js';

const RESEND_API = 'https://api.resend.com';

export const validateResendToken: Validator = async (input, ctx) => {
  const cred = requireCredential(input, 'api_token');
  if ('ok' in cred && cred.ok !== true) return cred;
  const probe = await probeUrl(ctx, `${RESEND_API}/domains`, {
    Authorization: `Bearer ${(cred as { value: string }).value}`,
    'Content-Type': 'application/json',
  });
  if (!probe.ok) return { ...probe, providerId: input.providerId };
  const httpFail = assertOkResponse(input.providerId, probe);
  if (httpFail) return httpFail;
  const data = (probe.json?.['data'] as Array<Record<string, unknown>>) ?? [];
  return asResult(
    ok(input.providerId, 'api_token', { domainCount: data.length }),
  );
};
