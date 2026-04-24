import { describe, it, expect } from 'vitest';
import {
  CaiaError, ValidationError, NotFoundError, UnauthorizedError,
  isCaiaError, serializeError,
} from '../src/index.js';

describe('CaiaError', () => {
  it('carries code and serializes', () => {
    const e = new CaiaError('oops', 'MY_CODE');
    expect(e.code).toBe('MY_CODE');
    expect(isCaiaError(e)).toBe(true);
    expect(serializeError(e)).toMatchObject({ name: 'CaiaError', code: 'MY_CODE' });
  });
});

describe('NotFoundError', () => {
  it('includes resource and id in message', () => {
    const e = new NotFoundError('User', 'u-1');
    expect(e.message).toBe("User 'u-1' not found");
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
  });
});

describe('ValidationError', () => {
  it('carries field errors', () => {
    const e = new ValidationError('Invalid', { email: ['must be valid'] });
    expect(e.fields.email).toEqual(['must be valid']);
    expect(e.code).toBe('VALIDATION_ERROR');
  });
});

describe('UnauthorizedError', () => {
  it('defaults message and statusCode', () => {
    const e = new UnauthorizedError();
    expect(e.statusCode).toBe(401);
    expect(e.message).toBe('Unauthorized');
  });
});

describe('serializeError', () => {
  it('handles non-Error values', () => {
    expect(serializeError('something bad')).toMatchObject({ name: 'UnknownError', message: 'something bad' });
  });
});
