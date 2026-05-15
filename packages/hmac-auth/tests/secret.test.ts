import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MIN_SECRET_LENGTH, loadSecret } from '../src/secret.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hmac-auth-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadSecret', () => {
  it('throws when neither env var is set', () => {
    expect(() => loadSecret({})).toThrow(/refusing to run without auth/);
  });

  it('reads from CAIA_EVENT_BUS_SECRET_PATH when set', () => {
    const p = join(tmp, 'secret');
    const value = 'b'.repeat(MIN_SECRET_LENGTH);
    writeFileSync(p, `${value}\n`); // trailing newline is trimmed
    expect(loadSecret({ CAIA_EVENT_BUS_SECRET_PATH: p })).toBe(value);
  });

  it('throws when CAIA_EVENT_BUS_SECRET_PATH points at a missing file', () => {
    const p = join(tmp, 'does-not-exist');
    expect(() => loadSecret({ CAIA_EVENT_BUS_SECRET_PATH: p })).toThrow(
      /does not exist/,
    );
  });

  it('throws when the file is empty', () => {
    const p = join(tmp, 'empty');
    writeFileSync(p, '');
    expect(() => loadSecret({ CAIA_EVENT_BUS_SECRET_PATH: p })).toThrow(
      /is empty/,
    );
  });

  it('throws when the file contents are too short', () => {
    const p = join(tmp, 'short');
    writeFileSync(p, 'a'.repeat(MIN_SECRET_LENGTH - 1));
    expect(() => loadSecret({ CAIA_EVENT_BUS_SECRET_PATH: p })).toThrow(
      /secret too short/,
    );
  });

  it('falls back to CAIA_EVENT_BUS_SECRET env var', () => {
    const value = 'c'.repeat(MIN_SECRET_LENGTH);
    expect(loadSecret({ CAIA_EVENT_BUS_SECRET: value })).toBe(value);
  });

  it('rejects an env secret that is too short', () => {
    expect(() =>
      loadSecret({ CAIA_EVENT_BUS_SECRET: 'a'.repeat(MIN_SECRET_LENGTH - 1) }),
    ).toThrow(/too short/);
  });

  it('prefers path over env var when both are set', () => {
    const p = join(tmp, 'secret');
    const fileValue = 'p'.repeat(MIN_SECRET_LENGTH);
    const envValue = 'e'.repeat(MIN_SECRET_LENGTH);
    writeFileSync(p, fileValue);
    expect(
      loadSecret({
        CAIA_EVENT_BUS_SECRET_PATH: p,
        CAIA_EVENT_BUS_SECRET: envValue,
      }),
    ).toBe(fileValue);
  });
});
