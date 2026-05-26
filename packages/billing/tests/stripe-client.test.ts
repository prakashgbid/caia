import { describe, expect, it } from 'vitest';

import { BillingConfigError, createStripeClient } from '../src/index.js';

describe('createStripeClient', () => {
  it('throws BillingConfigError when given an empty key', () => {
    expect(() => createStripeClient({ apiKey: '' })).toThrow(BillingConfigError);
  });

  it('throws BillingConfigError when given a publishable key', () => {
    expect(() => createStripeClient({ apiKey: 'pk_test_oops' })).toThrow(
      BillingConfigError,
    );
  });

  it('accepts an sk_test_ key', () => {
    const client = createStripeClient({ apiKey: 'sk_test_1234567890' });
    expect(client).toBeTruthy();
    expect(typeof client.webhooks.constructEvent).toBe('function');
  });

  it('accepts an sk_live_ key', () => {
    const client = createStripeClient({ apiKey: 'sk_live_1234567890' });
    expect(client).toBeTruthy();
  });
});
