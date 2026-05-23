/**
 * Test helpers shared across the validator + engine specs.
 *
 * Provides a `mockFetch` that returns canned responses keyed by URL
 * prefix, plus a `fakeSecretsPutter` that records every put and
 * returns a deterministic secretRef.
 */

import { vi } from 'vitest';
import type { SecretsPutter } from '../src/engine/engine.js';
import type { ValidatorContext } from '../src/types.js';

export interface CannedResponse {
  status: number;
  body?: string | Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export function mockFetch(
  routes: Record<string, CannedResponse | ((url: string, init?: RequestInit) => CannedResponse)>,
): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, ...(init ? { init } : {}) });
      const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
      if (!route) {
        throw new Error(`mockFetch: no canned response for ${url}`);
      }
      const handler = typeof route[1] === 'function' ? route[1](url, init) : route[1];
      const body =
        typeof handler.body === 'string'
          ? handler.body
          : handler.body !== undefined
            ? JSON.stringify(handler.body)
            : '';
      const headers = new Headers(handler.headers ?? {});
      return new Response(body, { status: handler.status, headers });
    },
  ) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export function fixedContext(
  fetchImpl: typeof fetch,
  now = new Date('2026-05-23T12:00:00Z'),
): ValidatorContext {
  return { fetch: fetchImpl, now: () => now };
}

export function fakeSecretsPutter(): SecretsPutter & {
  puts: Array<{ tenantId: string; category: string; key: string; value: string }>;
} {
  const puts: Array<{ tenantId: string; category: string; key: string; value: string }> = [];
  return {
    puts,
    async put(tenantId, category, key, value) {
      puts.push({ tenantId, category, key, value });
      return {
        secretRef: `infisical://tenants/${tenantId}/${category}/${key}@v1`,
        version: 1,
      };
    },
  };
}
