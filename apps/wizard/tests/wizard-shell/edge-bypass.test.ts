/**
 * Pure unit tests for the `WIZARD_AUTH_MODE=cf-edge-only` guard.
 *
 * Validates each of the three defence-in-depth checks (Cf-Ray,
 * Cf-Connecting-Ip allow-list, X-Caia-Edge-Token secret) AND the
 * mode-string parser.
 */

import { describe, it, expect } from 'vitest';
import {
  readAuthMode,
  tryEdgeBypass,
  type EdgeBypassEnv,
  type ReadOnlyHeaders,
} from '../../lib/auth/edge-bypass';

function headers(map: Record<string, string>): ReadOnlyHeaders {
  return {
    get(name) {
      // Headers().get is case-insensitive — mirror that here so the
      // module under test can do whatever it likes with casing.
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === lower) return v;
      }
      return null;
    },
  };
}

const validEnv: EdgeBypassEnv = {
  BYPASS_ALLOWED_IPS: '69.118.44.175,1.2.3.4',
  EDGE_SHARED_SECRET: 'super-secret-32-char-hex-value',
  BYPASS_TENANT_EMAIL: 'prakash.stolution@gmail.com',
};

const validHeaders = headers({
  'cf-ray': '8d4a1e2b3c4d5e6f-IAD',
  'cf-connecting-ip': '69.118.44.175',
  'x-caia-edge-token': 'super-secret-32-char-hex-value',
});

describe('readAuthMode', () => {
  it('defaults to "cloudflare" when WIZARD_AUTH_MODE is unset', () => {
    expect(readAuthMode({} as NodeJS.ProcessEnv)).toBe('cloudflare');
  });

  it('parses "cloudflare", "cf-edge-only", "disabled" verbatim', () => {
    expect(readAuthMode({ WIZARD_AUTH_MODE: 'cloudflare' } as NodeJS.ProcessEnv)).toBe('cloudflare');
    expect(readAuthMode({ WIZARD_AUTH_MODE: 'cf-edge-only' } as NodeJS.ProcessEnv)).toBe('cf-edge-only');
    expect(readAuthMode({ WIZARD_AUTH_MODE: 'disabled' } as NodeJS.ProcessEnv)).toBe('disabled');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(readAuthMode({ WIZARD_AUTH_MODE: '  CF-EDGE-ONLY ' } as NodeJS.ProcessEnv)).toBe('cf-edge-only');
  });

  it('falls back to "cloudflare" on unknown values (fail-closed)', () => {
    expect(readAuthMode({ WIZARD_AUTH_MODE: 'wide-open' } as NodeJS.ProcessEnv)).toBe('cloudflare');
  });
});

describe('tryEdgeBypass', () => {
  it('returns the bypass email when all three checks pass', () => {
    const r = tryEdgeBypass(validHeaders, validEnv);
    expect(r).toEqual({ email: 'prakash.stolution@gmail.com' });
  });

  it('returns null when Cf-Ray is missing', () => {
    const h = headers({
      'cf-connecting-ip': '69.118.44.175',
      'x-caia-edge-token': 'super-secret-32-char-hex-value',
    });
    expect(tryEdgeBypass(h, validEnv)).toBeNull();
  });

  it('returns null when Cf-Connecting-Ip is not in BYPASS_ALLOWED_IPS', () => {
    const h = headers({
      'cf-ray': '8d4a1e2b3c4d5e6f-IAD',
      'cf-connecting-ip': '9.9.9.9',
      'x-caia-edge-token': 'super-secret-32-char-hex-value',
    });
    expect(tryEdgeBypass(h, validEnv)).toBeNull();
  });

  it('returns null when X-Caia-Edge-Token does not match EDGE_SHARED_SECRET', () => {
    const h = headers({
      'cf-ray': '8d4a1e2b3c4d5e6f-IAD',
      'cf-connecting-ip': '69.118.44.175',
      'x-caia-edge-token': 'wrong-token',
    });
    expect(tryEdgeBypass(h, validEnv)).toBeNull();
  });

  it('returns null when EDGE_SHARED_SECRET is unset (no secret to check against)', () => {
    expect(tryEdgeBypass(validHeaders, { ...validEnv, EDGE_SHARED_SECRET: undefined })).toBeNull();
  });

  it('returns null when BYPASS_ALLOWED_IPS is empty (no IPs allowed)', () => {
    expect(tryEdgeBypass(validHeaders, { ...validEnv, BYPASS_ALLOWED_IPS: '' })).toBeNull();
  });

  it('handles CSV with whitespace and the operator IP in the middle of the list', () => {
    expect(
      tryEdgeBypass(validHeaders, {
        ...validEnv,
        BYPASS_ALLOWED_IPS: '1.1.1.1 , 69.118.44.175 ,2.2.2.2',
      }),
    ).toEqual({ email: 'prakash.stolution@gmail.com' });
  });

  it('falls back to the default operator email when BYPASS_TENANT_EMAIL is unset', () => {
    expect(
      tryEdgeBypass(validHeaders, { ...validEnv, BYPASS_TENANT_EMAIL: undefined }),
    ).toEqual({ email: 'prakash.stolution@gmail.com' });
  });

  it('rejects a malformed fallback email (defence against env-var typo)', () => {
    expect(
      tryEdgeBypass(validHeaders, { ...validEnv, BYPASS_TENANT_EMAIL: 'not-an-email' }),
    ).toBeNull();
  });

  it('rejects a length-mismatched edge token without a timing-safe-throw', () => {
    const h = headers({
      'cf-ray': '8d4a1e2b3c4d5e6f-IAD',
      'cf-connecting-ip': '69.118.44.175',
      'x-caia-edge-token': 'short',
    });
    expect(() => tryEdgeBypass(h, validEnv)).not.toThrow();
    expect(tryEdgeBypass(h, validEnv)).toBeNull();
  });
});
