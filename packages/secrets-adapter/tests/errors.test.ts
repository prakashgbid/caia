import { describe, it, expect } from 'vitest';
import {
  SecretNotFoundError,
  SecretPolicyDeniedError,
  SecretRateLimitedError,
  SecretProviderError,
  SecretsAdapterError,
  SecretsAdapterConfigError,
  classifyError,
} from '../src/errors.js';

describe('SecretNotFoundError', () => {
  it('classifies as not_found', () => {
    const err = new SecretNotFoundError('missing', { tenantId: 't', key: 'k' });
    expect(err.errorClass).toBe('not_found');
    expect(err.tenantId).toBe('t');
    expect(err.key).toBe('k');
    expect(err).toBeInstanceOf(SecretsAdapterError);
    expect(err).toBeInstanceOf(Error);
  });
  it('preserves message', () => {
    expect(new SecretNotFoundError('nope').message).toBe('nope');
  });
  it('name reflects class', () => {
    expect(new SecretNotFoundError('x').name).toBe('SecretNotFoundError');
  });
});

describe('SecretPolicyDeniedError', () => {
  it('classifies as policy_denied', () => {
    expect(new SecretPolicyDeniedError('denied').errorClass).toBe('policy_denied');
  });
  it('preserves category', () => {
    expect(new SecretPolicyDeniedError('denied', { category: 'c' }).category).toBe('c');
  });
});

describe('SecretRateLimitedError', () => {
  it('classifies as rate_limited', () => {
    expect(new SecretRateLimitedError('429').errorClass).toBe('rate_limited');
  });
  it('captures retryAfterMs', () => {
    expect(new SecretRateLimitedError('429', { retryAfterMs: 1500 }).retryAfterMs).toBe(1500);
  });
  it('retryAfterMs undefined when omitted', () => {
    expect(new SecretRateLimitedError('429').retryAfterMs).toBeUndefined();
  });
});

describe('SecretProviderError', () => {
  it('classifies as provider_error', () => {
    expect(new SecretProviderError('boom').errorClass).toBe('provider_error');
  });
  it('captures cause', () => {
    const cause = new Error('underlying');
    expect(new SecretProviderError('boom', { cause }).cause).toBe(cause);
  });
});

describe('SecretsAdapterConfigError', () => {
  it('is a plain Error subclass', () => {
    const e = new SecretsAdapterConfigError('missing env');
    expect(e.message).toBe('missing env');
    expect(e.name).toBe('SecretsAdapterConfigError');
    expect(e).not.toBeInstanceOf(SecretsAdapterError);
  });
});

describe('classifyError', () => {
  it('classifies SecretNotFoundError', () => {
    expect(classifyError(new SecretNotFoundError('x'))).toBe('not_found');
  });
  it('classifies SecretPolicyDeniedError', () => {
    expect(classifyError(new SecretPolicyDeniedError('x'))).toBe('policy_denied');
  });
  it('classifies SecretRateLimitedError', () => {
    expect(classifyError(new SecretRateLimitedError('x'))).toBe('rate_limited');
  });
  it('classifies SecretProviderError', () => {
    expect(classifyError(new SecretProviderError('x'))).toBe('provider_error');
  });
  it('defaults to provider_error for plain Error', () => {
    expect(classifyError(new Error('x'))).toBe('provider_error');
  });
  it('defaults to provider_error for non-Error', () => {
    expect(classifyError('s')).toBe('provider_error');
    expect(classifyError(undefined)).toBe('provider_error');
    expect(classifyError(null)).toBe('provider_error');
    expect(classifyError({})).toBe('provider_error');
  });
});
