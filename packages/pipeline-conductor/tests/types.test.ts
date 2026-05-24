import { describe, expect, it } from 'vitest';
import { STAGE_NAMES, isStageName } from '../src/types.js';

describe('STAGE_NAMES', () => {
  it('contains 21 stage names', () => {
    expect(STAGE_NAMES.length).toBe(21);
  });

  it('starts with onboarding and ends with verified', () => {
    expect(STAGE_NAMES[0]).toBe('onboarding');
    expect(STAGE_NAMES[STAGE_NAMES.length - 1]).toBe('verified');
  });

  it('has unique entries', () => {
    expect(new Set(STAGE_NAMES).size).toBe(STAGE_NAMES.length);
  });
});

describe('isStageName', () => {
  it('returns true for canonical names', () => {
    expect(isStageName('coding-in-progress')).toBe(true);
    expect(isStageName('onboarding')).toBe(true);
    expect(isStageName('verified')).toBe(true);
  });

  it('returns false for failed states', () => {
    expect(isStageName('coding-failed')).toBe(false);
  });

  it('returns false for control states', () => {
    expect(isStageName('paused')).toBe(false);
    expect(isStageName('archived')).toBe(false);
    expect(isStageName('done')).toBe(false);
  });

  it('returns false for non-strings', () => {
    expect(isStageName(null)).toBe(false);
    expect(isStageName(undefined)).toBe(false);
    expect(isStageName(42)).toBe(false);
    expect(isStageName({})).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isStageName('')).toBe(false);
  });
});
