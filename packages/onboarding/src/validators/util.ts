/**
 * Shared validator helpers.
 *
 * Each provider validator follows the same shape: take credentials,
 * call a noop endpoint, classify the response into a ValidatorResult.
 *
 * Reference: research/step1_onboarding_spec_2026.md §2.
 */

import type {
  Archetype,
  ValidatorContext,
  ValidatorFailure,
  ValidatorResult,
  ValidatorSuccess,
} from '../types.js';

export function ok(
  providerId: string,
  archetype: Archetype,
  metadata: Record<string, unknown> = {},
  scopesGranted: string[] = [],
): ValidatorSuccess {
  return {
    ok: true,
    providerId,
    archetype,
    scopesGranted,
    metadata,
  };
}

export function fail(
  providerId: string,
  errorCode: ValidatorFailure['errorCode'],
  message: string,
  retryHint?: string,
): ValidatorFailure {
  return retryHint === undefined
    ? { ok: false, providerId, errorCode, message }
    : { ok: false, providerId, errorCode, message, retryHint };
}

export function classifyHttp(status: number): ValidatorFailure['errorCode'] {
  if (status === 401 || status === 403) return 'token_invalid';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_error';
  if (status === 400 || status === 422) return 'choice_invalid';
  return 'provider_error';
}

export async function safeJson(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const t = await response.text();
    if (!t) return null;
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type ProbeOk = {
  ok: true;
  res: Response;
  json: Record<string, unknown> | null;
};
export type ProbeOutcome = ProbeOk | ValidatorFailure;

export async function probeUrl(
  ctx: ValidatorContext,
  url: string,
  headers: Record<string, string>,
  method = 'GET',
  body?: string,
  providerId = 'unknown',
): Promise<ProbeOutcome> {
  let res: Response;
  try {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;
    res = await ctx.fetch(url, init);
  } catch (e) {
    return {
      ok: false,
      providerId,
      errorCode: 'network_error',
      message: `network error: ${(e as Error).message}`,
    };
  }
  const json = await safeJson(res);
  return { ok: true, res, json };
}

/** Verifies that every required scope appears in the granted list. */
export function scopesSatisfied(
  required: readonly string[],
  granted: readonly string[],
): boolean {
  return required.every((s) => granted.includes(s));
}

export function requireCredential(
  input: { credentials: Record<string, string> },
  keyId: string,
): { ok: true; value: string } | ValidatorFailure {
  const v = input.credentials[keyId];
  if (!v || v.trim().length === 0) {
    return {
      ok: false,
      providerId: 'unknown',
      errorCode: 'choice_invalid',
      message: `missing required credential: ${keyId}`,
    };
  }
  return { ok: true, value: v };
}

/** Build a default context using global fetch + system clock. */
export function defaultContext(): ValidatorContext {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
  };
}

/** Convenience: ensure a probe returned 2xx, else return a typed failure. */
export function assertOkResponse(
  providerId: string,
  probe: ProbeOk,
): ValidatorFailure | null {
  if (probe.res.status >= 200 && probe.res.status < 300) return null;
  return fail(
    providerId,
    classifyHttp(probe.res.status),
    `provider returned HTTP ${probe.res.status}`,
  );
}

/** Compose a discriminated ValidatorResult from common shapes. */
export function asResult(r: ValidatorFailure | ValidatorSuccess): ValidatorResult {
  return r;
}
