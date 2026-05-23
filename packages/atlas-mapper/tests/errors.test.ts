import { describe, expect, it } from 'vitest';
import { AtlasMapperError } from '../src/errors.js';

describe('AtlasMapperError', () => {
  it('carries a code + context + message', () => {
    const err = new AtlasMapperError('duplicate_dom_id', 'oops', { domId: 'x' });
    expect(err.code).toBe('duplicate_dom_id');
    expect(err.message).toBe('oops');
    expect(err.context).toEqual({ domId: 'x' });
    expect(err.name).toBe('AtlasMapperError');
  });

  it('is an Error subclass — instanceof checks work', () => {
    const err = new AtlasMapperError('cycle_detected', 'nope');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AtlasMapperError);
  });

  it('defaults context to an empty object', () => {
    const err = new AtlasMapperError('cycle_detected', 'nope');
    expect(err.context).toEqual({});
  });

  it('preserves a stack trace', () => {
    const err = new AtlasMapperError('cycle_detected', 'nope');
    expect(typeof err.stack).toBe('string');
    expect(err.stack?.length ?? 0).toBeGreaterThan(0);
  });
});
