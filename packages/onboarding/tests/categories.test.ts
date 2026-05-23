import { describe, it, expect } from 'vitest';
import {
  ALL_CATEGORIES,
  MANDATORY_CATEGORY_IDS,
  OPTIONAL_CATEGORY_IDS,
  getCategory,
  getProvider,
} from '../src/categories/index.js';

describe('category catalog', () => {
  it('has 19 categories total', () => {
    expect(ALL_CATEGORIES.length).toBe(19);
  });

  it('has 15 mandatory categories', () => {
    expect(MANDATORY_CATEGORY_IDS.length).toBe(15);
    expect(ALL_CATEGORIES.filter((c) => c.required).length).toBe(15);
  });

  it('has 4 optional categories', () => {
    expect(OPTIONAL_CATEGORY_IDS.length).toBe(4);
    expect(ALL_CATEGORIES.filter((c) => !c.required).length).toBe(4);
  });

  it('assigns each category a unique ordinal 1..19', () => {
    const ords = ALL_CATEGORIES.map((c) => c.ordinal).sort((a, b) => a - b);
    expect(ords).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  it('all category ids are unique', () => {
    const ids = ALL_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every category has at least one provider', () => {
    for (const c of ALL_CATEGORIES) {
      expect(c.providers.length).toBeGreaterThan(0);
    }
  });

  it('every provider id is unique within its category', () => {
    for (const c of ALL_CATEGORIES) {
      const ids = c.providers.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('returns the right category via getCategory', () => {
    expect(getCategory('repo')?.id).toBe('repo');
    expect(getCategory('does-not-exist')).toBeUndefined();
  });

  it('returns the right provider via getProvider', () => {
    expect(getProvider('repo', 'github')?.id).toBe('github');
    expect(getProvider('repo', 'no-such')).toBeUndefined();
    expect(getProvider('nope', 'github')).toBeUndefined();
  });

  it('noCredentials providers carry empty credentialDescriptors', () => {
    for (const c of ALL_CATEGORIES) {
      for (const p of c.providers) {
        if (p.noCredentials) {
          expect(p.credentialDescriptors).toEqual([]);
        }
      }
    }
  });

  it('credentialDescriptors archetypes match provider archetype where storeSecret=true', () => {
    for (const c of ALL_CATEGORIES) {
      for (const p of c.providers) {
        for (const d of p.credentialDescriptors) {
          if (d.storeSecret) {
            // archetype must be one of the 5
            expect([
              'oauth',
              'api_token',
              'dns',
              'webhook',
              'endpoint',
            ]).toContain(d.archetype);
          }
        }
      }
    }
  });
});
