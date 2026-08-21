/**
 * Mock-auth helpers (STOL-5003) — localStorage flag roundtrip.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_AUTH_KEY, isMockLoggedIn, setMockAuth } from '../lib/mock-auth';

afterEach(() => {
  window.localStorage.clear();
});

describe('mock auth', () => {
  it('defaults to signed out', () => {
    expect(isMockLoggedIn()).toBe(false);
  });

  it('setMockAuth(true) signs the mock user in via localStorage', () => {
    setMockAuth(true);
    expect(isMockLoggedIn()).toBe(true);
    expect(window.localStorage.getItem(MOCK_AUTH_KEY)).toBe('true');
  });

  it('setMockAuth(false) clears the flag', () => {
    setMockAuth(true);
    setMockAuth(false);
    expect(isMockLoggedIn()).toBe(false);
    expect(window.localStorage.getItem(MOCK_AUTH_KEY)).toBeNull();
  });

  it('operator devtools flow works: raw localStorage set is honoured', () => {
    window.localStorage.setItem(MOCK_AUTH_KEY, 'true');
    expect(isMockLoggedIn()).toBe(true);
  });
});
