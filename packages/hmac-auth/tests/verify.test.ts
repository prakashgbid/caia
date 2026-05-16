import { describe, expect, it } from 'vitest';

import {
  hmacSign,
  hmacSignHex,
  signRequest,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '../src/sign.js';
import { hmacVerify, verifyRequest } from '../src/verify.js';

const SECRET = 'a'.repeat(32);

describe('hmacVerify', () => {
  it('accepts a matching Buffer signature', () => {
    const data = 'hello';
    const sig = hmacSign(SECRET, data);
    expect(hmacVerify(SECRET, data, sig)).toBe(true);
  });

  it('accepts a matching hex signature', () => {
    const data = 'hello';
    const hex = hmacSignHex(SECRET, data);
    expect(hmacVerify(SECRET, data, hex)).toBe(true);
  });

  it('rejects a mismatched signature without throwing', () => {
    expect(hmacVerify(SECRET, 'hello', 'a'.repeat(64))).toBe(false);
  });

  it('rejects an odd-length hex string', () => {
    expect(hmacVerify(SECRET, 'hello', 'abc')).toBe(false);
  });

  it('rejects a non-hex string', () => {
    expect(hmacVerify(SECRET, 'hello', 'zz'.repeat(32))).toBe(false);
  });

  it('rejects a length-mismatched Buffer', () => {
    const data = 'hello';
    expect(hmacVerify(SECRET, data, Buffer.from('xx', 'hex'))).toBe(false);
  });

  it('rejects an empty secret without throwing', () => {
    expect(hmacVerify('', 'data', 'a'.repeat(64))).toBe(false);
  });

  it('round-trips with hmacSign for arbitrary data', () => {
    for (const data of ['', 'a', '{"key":"value"}', 'unicode-ünicode-✓']) {
      const sig = hmacSign(SECRET, data);
      expect(hmacVerify(SECRET, data, sig)).toBe(true);
      expect(hmacVerify(SECRET, `${data}-tampered`, sig)).toBe(false);
    }
  });
});

describe('verifyRequest', () => {
  it('verifies a freshly-signed request', () => {
    const body = '{"hello":"world"}';
    const now = 1_700_000_000_000;
    const headers = signRequest(SECRET, body, now);
    expect(verifyRequest(SECRET, body, headers, now)).toEqual({ ok: true });
  });

  it('verifies inside the replay window', () => {
    const body = 'body';
    const signedAt = 1_700_000_000_000;
    const headers = signRequest(SECRET, body, signedAt);
    // Verifying 2 minutes later is fine (default window is 5 min).
    expect(
      verifyRequest(SECRET, body, headers, signedAt + 2 * 60_000),
    ).toEqual({ ok: true });
  });

  it('rejects expired timestamps', () => {
    const body = 'body';
    const signedAt = 1_700_000_000_000;
    const headers = signRequest(SECRET, body, signedAt);
    const r = verifyRequest(SECRET, body, headers, signedAt + 10 * 60_000);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects future timestamps', () => {
    const body = 'body';
    const signedAt = 1_700_000_000_000;
    const headers = signRequest(SECRET, body, signedAt);
    const r = verifyRequest(SECRET, body, headers, signedAt - 10 * 60_000);
    expect(r).toEqual({ ok: false, reason: 'future' });
  });

  it('rejects bad signature', () => {
    const body = 'body';
    const now = 1_700_000_000_000;
    const headers = {
      [TIMESTAMP_HEADER]: String(now),
      [SIGNATURE_HEADER]: 'a'.repeat(64),
    };
    expect(verifyRequest(SECRET, body, headers, now)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('detects body tampering', () => {
    const signedAt = 1_700_000_000_000;
    const headers = signRequest(SECRET, 'original', signedAt);
    const r = verifyRequest(SECRET, 'tampered', headers, signedAt);
    expect(r).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects missing timestamp header', () => {
    const r = verifyRequest(
      SECRET,
      'body',
      { [SIGNATURE_HEADER]: 'a'.repeat(64) },
      1,
    );
    expect(r).toEqual({ ok: false, reason: 'missing-timestamp' });
  });

  it('rejects missing signature header', () => {
    const r = verifyRequest(SECRET, 'body', { [TIMESTAMP_HEADER]: '1' }, 1);
    expect(r).toEqual({ ok: false, reason: 'missing-signature' });
  });

  it('rejects non-numeric timestamp', () => {
    const r = verifyRequest(
      SECRET,
      'body',
      {
        [TIMESTAMP_HEADER]: 'not-a-number',
        [SIGNATURE_HEADER]: 'a'.repeat(64),
      },
      1,
    );
    expect(r).toEqual({ ok: false, reason: 'bad-timestamp' });
  });

  it('handles upper-case header names from hand-rolled callers', () => {
    const signedAt = 1_700_000_000_000;
    const lower = signRequest(SECRET, 'body', signedAt);
    const upper = {
      'X-Caia-Timestamp': lower[TIMESTAMP_HEADER],
      'X-Caia-Signature': lower[SIGNATURE_HEADER],
    };
    expect(verifyRequest(SECRET, 'body', upper, signedAt)).toEqual({
      ok: true,
    });
  });

  it('handles array-valued headers (picks first)', () => {
    const signedAt = 1_700_000_000_000;
    const headers = signRequest(SECRET, 'body', signedAt);
    const arrayed: Record<string, string | string[]> = {
      [TIMESTAMP_HEADER]: [headers[TIMESTAMP_HEADER], 'spurious'],
      [SIGNATURE_HEADER]: [headers[SIGNATURE_HEADER]],
    };
    expect(verifyRequest(SECRET, 'body', arrayed, signedAt)).toEqual({
      ok: true,
    });
  });

  it('respects a custom replay window', () => {
    const body = 'body';
    const signedAt = 1_700_000_000_000;
    const headers = signRequest(SECRET, body, signedAt);
    // 30s window — 2 min later is expired.
    const r = verifyRequest(SECRET, body, headers, signedAt + 120_000, 30_000);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });
});
