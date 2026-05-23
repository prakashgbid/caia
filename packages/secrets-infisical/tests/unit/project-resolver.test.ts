import { describe, it, expect } from 'vitest';
import {
  ConfigMapProjectResolver,
  FunctionProjectResolver,
} from '../../src/project-resolver.js';
import { SecretPolicyDeniedError } from '@caia/secrets-adapter';

describe('ConfigMapProjectResolver', () => {
  it('resolves known tenant', async () => {
    const r = new ConfigMapProjectResolver({ t1: 'wsk-1', t2: 'wsk-2' });
    expect(await r.resolve('t1')).toBe('wsk-1');
    expect(await r.resolve('t2')).toBe('wsk-2');
  });
  it('throws SecretPolicyDeniedError on unknown', async () => {
    const r = new ConfigMapProjectResolver({ t1: 'wsk-1' });
    await expect(r.resolve('unknown')).rejects.toBeInstanceOf(
      SecretPolicyDeniedError,
    );
  });
  it('accepts a Map directly', async () => {
    const r = new ConfigMapProjectResolver(new Map([['t1', 'wsk-1']]));
    expect(await r.resolve('t1')).toBe('wsk-1');
  });
});

describe('FunctionProjectResolver', () => {
  it('delegates to the function', async () => {
    const r = new FunctionProjectResolver(async (t) => `proj-of-${t}`);
    expect(await r.resolve('alpha')).toBe('proj-of-alpha');
  });
  it('throws on undefined return', async () => {
    const r = new FunctionProjectResolver(async () => undefined);
    await expect(r.resolve('t')).rejects.toBeInstanceOf(
      SecretPolicyDeniedError,
    );
  });
  it('propagates inner async errors as-is', async () => {
    const r = new FunctionProjectResolver(async () => {
      throw new Error('boom');
    });
    await expect(r.resolve('t')).rejects.toThrow('boom');
  });
});
