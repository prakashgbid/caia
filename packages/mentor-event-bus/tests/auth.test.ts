import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  signRequest,
  verifyRequest,
  loadSecret,
  TIMESTAMP_HEADER,
  SIGNATURE_HEADER,
  DEFAULT_REPLAY_WINDOW_MS
} from '../src/auth';

const SECRET = 'a'.repeat(64); // 64 chars, well above the ≥32 minimum

describe('signRequest', () => {
  it('throws on empty secret', () => {
    expect(() => signRequest('', 'body')).toThrow(/empty secret/);
  });

  it('returns the timestamp + signature headers', () => {
    const headers = signRequest(SECRET, '{"hello":"world"}', 1_000_000_000_000);
    expect(headers[TIMESTAMP_HEADER]).toBe('1000000000000');
    expect(headers[SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces deterministic signatures (same body+ts+secret => same sig)', () => {
    const a = signRequest(SECRET, '{"hello":"world"}', 1_000);
    const b = signRequest(SECRET, '{"hello":"world"}', 1_000);
    expect(a).toEqual(b);
  });
});

describe('verifyRequest — happy path', () => {
  it('accepts a valid signature within the replay window', () => {
    const body = '{"events":[]}';
    const now = 1_000_000_000_000;
    const headers = signRequest(SECRET, body, now);
    const r = verifyRequest(SECRET, body, headers, now);
    expect(r).toEqual({ ok: true });
  });

  it('accepts at the edge of the replay window', () => {
    const body = '{}';
    const now = 1_000_000_000_000;
    const headers = signRequest(SECRET, body, now - DEFAULT_REPLAY_WINDOW_MS);
    const r = verifyRequest(SECRET, body, headers, now);
    expect(r.ok).toBe(true);
  });

  it('handles uppercase-cased headers passed by Node http', () => {
    const body = '{}';
    const headers = signRequest(SECRET, body, 1_000_000);
    const upper: Record<string, string> = {
      'X-Caia-Timestamp': headers[TIMESTAMP_HEADER],
      'X-Caia-Signature': headers[SIGNATURE_HEADER]
    };
    const r = verifyRequest(SECRET, body, upper, 1_000_000);
    expect(r.ok).toBe(true);
  });
});

describe('verifyRequest — failure paths', () => {
  it('rejects when timestamp header is missing', () => {
    const r = verifyRequest(SECRET, '{}', { [SIGNATURE_HEADER]: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing-timestamp');
  });

  it('rejects when signature header is missing', () => {
    const r = verifyRequest(SECRET, '{}', { [TIMESTAMP_HEADER]: '123' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing-signature');
  });

  it('rejects when timestamp is not a number', () => {
    const r = verifyRequest(SECRET, '{}', {
      [TIMESTAMP_HEADER]: 'not-a-number',
      [SIGNATURE_HEADER]: 'a'.repeat(64)
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-timestamp');
  });

  it('rejects an expired timestamp', () => {
    const body = '{}';
    const headers = signRequest(SECRET, body, 1_000);
    const r = verifyRequest(SECRET, body, headers, 1_000 + DEFAULT_REPLAY_WINDOW_MS + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired');
  });

  it('rejects a future timestamp', () => {
    const body = '{}';
    const headers = signRequest(SECRET, body, 1_000_000);
    const r = verifyRequest(SECRET, body, headers, 1_000_000 - DEFAULT_REPLAY_WINDOW_MS - 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('future');
  });

  it('rejects a tampered body (sig mismatch)', () => {
    const headers = signRequest(SECRET, '{"events":[]}', 1_000);
    const r = verifyRequest(SECRET, '{"events":[1]}', headers, 1_000); // body changed
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-signature');
  });

  it('rejects with a wrong secret', () => {
    const headers = signRequest(SECRET, '{}', 1_000);
    const r = verifyRequest('b'.repeat(64), '{}', headers, 1_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-signature');
  });

  it('rejects a malformed hex signature', () => {
    const r = verifyRequest(SECRET, '{}', {
      [TIMESTAMP_HEADER]: '1000',
      [SIGNATURE_HEADER]: 'not-hex-at-all'
    }, 1_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-signature');
  });

  it('rejects a truncated signature', () => {
    const headers = signRequest(SECRET, '{}', 1_000);
    headers[SIGNATURE_HEADER] = headers[SIGNATURE_HEADER].slice(0, 32);
    const r = verifyRequest(SECRET, '{}', headers, 1_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-signature');
  });
});

describe('loadSecret', () => {
  it('throws when neither env var is set', () => {
    expect(() => loadSecret({})).toThrow(/refusing to run without auth/);
  });

  it('throws when CAIA_EVENT_BUS_SECRET is too short', () => {
    expect(() =>
      loadSecret({ CAIA_EVENT_BUS_SECRET: 'short' })
    ).toThrow(/too short/);
  });

  it('returns env secret when ≥32 chars', () => {
    expect(loadSecret({ CAIA_EVENT_BUS_SECRET: SECRET })).toBe(SECRET);
  });

  it('reads from path file when CAIA_EVENT_BUS_SECRET_PATH is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caia-secret-'));
    const file = join(dir, 'secret');
    writeFileSync(file, SECRET);
    expect(loadSecret({ CAIA_EVENT_BUS_SECRET_PATH: file })).toBe(SECRET);
  });

  it('throws when the path file does not exist', () => {
    expect(() =>
      loadSecret({ CAIA_EVENT_BUS_SECRET_PATH: '/nonexistent/path' })
    ).toThrow(/does not exist/);
  });

  it('throws when the path file is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caia-secret-empty-'));
    const file = join(dir, 'empty');
    writeFileSync(file, '');
    expect(() =>
      loadSecret({ CAIA_EVENT_BUS_SECRET_PATH: file })
    ).toThrow(/empty/);
  });

  it('throws when the path file has too few chars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caia-secret-short-'));
    const file = join(dir, 'short');
    writeFileSync(file, 'short');
    expect(() =>
      loadSecret({ CAIA_EVENT_BUS_SECRET_PATH: file })
    ).toThrow(/too short/);
  });

  it('prefers the path file over the env var when both are set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caia-secret-pref-'));
    const file = join(dir, 'secret');
    writeFileSync(file, SECRET);
    const result = loadSecret({
      CAIA_EVENT_BUS_SECRET_PATH: file,
      CAIA_EVENT_BUS_SECRET: 'b'.repeat(64) // different
    });
    expect(result).toBe(SECRET);
  });

  it('trims whitespace from the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caia-secret-ws-'));
    const file = join(dir, 'secret');
    writeFileSync(file, `\n  ${SECRET}\n  `);
    expect(loadSecret({ CAIA_EVENT_BUS_SECRET_PATH: file })).toBe(SECRET);
  });
});
