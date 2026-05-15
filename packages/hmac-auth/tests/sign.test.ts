import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REPLAY_WINDOW_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  hmacSign,
  hmacSignHex,
  signRequest,
} from '../src/sign.js';

const SECRET = 'a'.repeat(32);

describe('hmacSign / hmacSignHex', () => {
  it('matches the raw node:crypto digest byte-for-byte', () => {
    const data = 'hello-world';
    const expected = createHmac('sha256', SECRET).update(data).digest();
    expect(hmacSign(SECRET, data).equals(expected)).toBe(true);
  });

  it('hmacSignHex returns lower-case hex', () => {
    const hex = hmacSignHex(SECRET, 'payload');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHmac('sha256', SECRET).update('payload').digest('hex');
    expect(hex).toBe(expected);
  });

  it('accepts Buffer secret and Buffer data', () => {
    const secretBuf = Buffer.from(SECRET, 'utf8');
    const dataBuf = Buffer.from('x', 'utf8');
    expect(hmacSign(secretBuf, dataBuf).length).toBe(32);
  });

  it('throws on empty string secret', () => {
    expect(() => hmacSign('', 'data')).toThrow(/empty secret/);
  });
});

describe('signRequest', () => {
  it('returns the timestamp and signature headers', () => {
    const out = signRequest(SECRET, '{"hello":"world"}', 1_700_000_000_000);
    expect(out[TIMESTAMP_HEADER]).toBe('1700000000000');
    expect(out[SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses Date.now() when timestamp is omitted', () => {
    const before = Date.now();
    const out = signRequest(SECRET, 'body');
    const after = Date.now();
    const ts = Number(out[TIMESTAMP_HEADER]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('signature matches the canonical "<ts>:<body>" pre-image', () => {
    const body = 'A';
    const ts = 1_700_000_000_000;
    const out = signRequest(SECRET, body, ts);
    const expected = createHmac('sha256', SECRET)
      .update(`${ts}:${body}`)
      .digest('hex');
    expect(out[SIGNATURE_HEADER]).toBe(expected);
  });

  it('throws on empty secret', () => {
    expect(() => signRequest('', 'body', 1)).toThrow(/empty secret/);
  });
});

describe('exports', () => {
  it('TIMESTAMP_HEADER and SIGNATURE_HEADER are lower-cased', () => {
    expect(TIMESTAMP_HEADER).toBe('x-caia-timestamp');
    expect(SIGNATURE_HEADER).toBe('x-caia-signature');
  });

  it('DEFAULT_REPLAY_WINDOW_MS is 5 minutes', () => {
    expect(DEFAULT_REPLAY_WINDOW_MS).toBe(5 * 60_000);
  });
});
