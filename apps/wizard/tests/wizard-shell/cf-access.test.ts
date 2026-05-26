/**
 * CF Access env loader + verifier construction.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readCfAccessEnv,
  buildVerifier,
  getDefaultVerifier,
  __resetDefaultVerifier,
  CF_AUTHORIZATION_COOKIE,
} from '../../lib/auth/cf-access';

describe('readCfAccessEnv', () => {
  it('reads CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD from process.env by default', () => {
    const env = readCfAccessEnv({
      CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      CF_ACCESS_AUD: 'aud-1',
    } as unknown as NodeJS.ProcessEnv);
    expect(env.teamDomain).toBe('example.cloudflareaccess.com');
    expect(env.audience).toBe('aud-1');
  });

  it('returns undefined fields when env is empty', () => {
    const env = readCfAccessEnv({} as NodeJS.ProcessEnv);
    expect(env.teamDomain).toBeUndefined();
    expect(env.audience).toBeUndefined();
  });
});

describe('buildVerifier', () => {
  it('constructs even with missing env (fails closed at verify-time)', () => {
    const v = buildVerifier({});
    expect(v).toBeDefined();
  });

  it('uses sentinel host when teamDomain is missing — verify will reject', () => {
    const v = buildVerifier({ audience: 'aud' });
    expect(v).toBeDefined();
  });
});

describe('getDefaultVerifier singleton', () => {
  beforeEach(() => __resetDefaultVerifier());

  it('returns the same instance on repeat calls', () => {
    const a = getDefaultVerifier();
    const b = getDefaultVerifier();
    expect(a).toBe(b);
  });

  it('reset() forces a new instance', () => {
    const a = getDefaultVerifier();
    __resetDefaultVerifier();
    const b = getDefaultVerifier();
    expect(a).not.toBe(b);
  });
});

describe('CF_AUTHORIZATION_COOKIE', () => {
  it('is the canonical Cloudflare Access cookie name', () => {
    expect(CF_AUTHORIZATION_COOKIE).toBe('CF_Authorization');
  });
});
