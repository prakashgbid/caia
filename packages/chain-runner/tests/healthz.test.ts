import { describe, expect, it } from 'vitest';
import {
  checkHealthz,
  checkHealthzAll,
  summarizeHealthz,
  type FetchLike,
} from '../src/bootstrap.js';

const okFetch: FetchLike = async (url) => ({ ok: true, status: 200 });
const fail500: FetchLike = async () => ({ ok: false, status: 500 });

describe('checkHealthz', () => {
  it('reports ok=true on 2xx', async () => {
    const r = await checkHealthz(
      { name: 'mentor', url: 'http://127.0.0.1:5180/v1/healthz' },
      { fetchImpl: okFetch },
    );
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.error).toBeNull();
  });

  it('reports ok=false with http_<status> error on non-2xx', async () => {
    const r = await checkHealthz(
      { name: 'router', url: 'http://127.0.0.1:7411/healthz' },
      { fetchImpl: fail500 },
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.error).toBe('http_500');
  });

  it('reports timeout when fetch never resolves', async () => {
    const hangingFetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const r = await checkHealthz(
      { name: 'mentor', url: 'http://127.0.0.1:5180/v1/healthz' },
      { timeoutMs: 25, fetchImpl: hangingFetch },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe('timeout_25ms');
  });

  it('reports refused error message verbatim', async () => {
    const refusedFetch: FetchLike = async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:7411');
    };
    const r = await checkHealthz(
      { name: 'router', url: 'http://127.0.0.1:7411/healthz' },
      { fetchImpl: refusedFetch },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });
});

describe('checkHealthzAll + summarizeHealthz', () => {
  it('returns one result per endpoint in declaration order', async () => {
    const results = await checkHealthzAll(
      [
        { name: 'a', url: 'http://x/a' },
        { name: 'b', url: 'http://x/b' },
      ],
      { fetchImpl: okFetch },
    );
    expect(results.map((r) => r.name)).toEqual(['a', 'b']);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('summary renders OK + FAIL legibly', async () => {
    const ab: FetchLike = async (url) =>
      url.endsWith('/a')
        ? { ok: true, status: 200 }
        : { ok: false, status: 503 };
    const results = await checkHealthzAll(
      [
        { name: 'mentor', url: 'http://x/a' },
        { name: 'router', url: 'http://x/b' },
      ],
      { fetchImpl: ab },
    );
    const s = summarizeHealthz(results);
    expect(s).toMatch(/mentor=OK\(200/);
    expect(s).toMatch(/router=FAIL\(http_503\)/);
  });
});
