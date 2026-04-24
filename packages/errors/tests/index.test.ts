import { describe, it, expect } from 'vitest';
import {
  CaiaError, ValidationError, NotFoundError, UnauthorizedError,
  ConfigurationError, isCaiaError, serializeError,
} from '../src/index.js';

describe('CaiaError', () => {
  it('carries code and serializes', () => {
    const e = new CaiaError('oops', 'MY_CODE');
    expect(e.code).toBe('MY_CODE');
    expect(isCaiaError(e)).toBe(true);
    expect(serializeError(e)).toMatchObject({ name: 'CaiaError', code: 'MY_CODE' });
  });

  it('sets name to CaiaError', () => {
    const e = new CaiaError('msg', 'CODE');
    expect(e.name).toBe('CaiaError');
  });

  it('is an instance of Error', () => {
    const e = new CaiaError('msg', 'CODE');
    expect(e).toBeInstanceOf(Error);
  });

  it('serialize includes cause when cause is CaiaError', () => {
    const cause = new CaiaError('root cause', 'ROOT');
    const e = new CaiaError('outer', 'OUTER', { cause });
    const serialized = e.serialize();
    expect(serialized.cause).toBeDefined();
    expect(serialized.cause?.code).toBe('ROOT');
  });

  it('serialize omits cause when cause is not CaiaError', () => {
    const e = new CaiaError('outer', 'OUTER', { cause: new Error('plain') });
    const serialized = e.serialize();
    expect(serialized.cause).toBeUndefined();
  });
});

describe('NotFoundError', () => {
  it('includes resource and id in message', () => {
    const e = new NotFoundError('User', 'u-1');
    expect(e.message).toBe("User 'u-1' not found");
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
  });

  it('works without id', () => {
    const e = new NotFoundError('Record');
    expect(e.message).toBe('Record not found');
    expect(e.statusCode).toBe(404);
  });

  it('is a CaiaError', () => {
    expect(isCaiaError(new NotFoundError('X'))).toBe(true);
  });
});

describe('ValidationError', () => {
  it('carries field errors', () => {
    const e = new ValidationError('Invalid', { email: ['must be valid'] });
    expect(e.fields.email).toEqual(['must be valid']);
    expect(e.code).toBe('VALIDATION_ERROR');
  });

  it('defaults to empty fields', () => {
    const e = new ValidationError('Invalid');
    expect(e.fields).toEqual({});
  });

  it('name is ValidationError', () => {
    const e = new ValidationError('bad');
    expect(e.name).toBe('ValidationError');
  });
});

describe('UnauthorizedError', () => {
  it('defaults message and statusCode', () => {
    const e = new UnauthorizedError();
    expect(e.statusCode).toBe(401);
    expect(e.message).toBe('Unauthorized');
  });

  it('accepts custom message', () => {
    const e = new UnauthorizedError('Token expired');
    expect(e.message).toBe('Token expired');
  });
});

describe('ConfigurationError', () => {
  it('has CONFIGURATION_ERROR code', () => {
    const e = new ConfigurationError('bad config');
    expect(e.code).toBe('CONFIGURATION_ERROR');
    expect(e.name).toBe('ConfigurationError');
  });
});

describe('serializeError', () => {
  it('handles non-Error values', () => {
    expect(serializeError('something bad')).toMatchObject({ name: 'UnknownError', message: 'something bad' });
  });

  it('handles plain Error', () => {
    const e = new Error('plain');
    e.name = 'TypeError';
    const s = serializeError(e);
    expect(s.name).toBe('TypeError');
    expect(s.message).toBe('plain');
  });

  it('handles null', () => {
    const s = serializeError(null);
    expect(s.name).toBe('UnknownError');
    expect(s.message).toBe('null');
  });

  it('handles CaiaError', () => {
    const e = new NotFoundError('User', '42');
    const s = serializeError(e);
    expect(s.code).toBe('NOT_FOUND');
  });
});

describe('isCaiaError', () => {
  it('returns false for plain Error', () => {
    expect(isCaiaError(new Error('plain'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isCaiaError('string')).toBe(false);
    expect(isCaiaError(null)).toBe(false);
    expect(isCaiaError(42)).toBe(false);
  });

  it('returns true for subclasses', () => {
    expect(isCaiaError(new ValidationError('v'))).toBe(true);
    expect(isCaiaError(new ConfigurationError('c'))).toBe(true);
  });
});
