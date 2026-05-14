import { describe, it, expect } from 'vitest';
import { EVENT_TYPES } from '../src/types';
import { EVENT_SCHEMAS, assertEverySchemaPresent } from '../src/schemas';

describe('event taxonomy', () => {
  it('declares 30 event types (22 base + 8 A.10.4)', () => {
    expect(EVENT_TYPES.length).toBe(30);
  });

  it('event type names are unique', () => {
    const set = new Set(EVENT_TYPES);
    expect(set.size).toBe(EVENT_TYPES.length);
  });

  it('every event type has a registered Zod schema', () => {
    expect(() => assertEverySchemaPresent()).not.toThrow();
    for (const t of EVENT_TYPES) {
      expect(EVENT_SCHEMAS[t]).toBeDefined();
    }
  });
});
