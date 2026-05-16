import { describe, it, expect, vi } from 'vitest';
import { gatherContext, deriveKeywords } from '../src/context.js';

describe('deriveKeywords', () => {
  it('splits id and title; preserves uniqueness', () => {
    const kws = deriveKeywords({
      id: 'rr1-adversarial-prefilter',
      title: 'RR-1 adversarial prefilter and ban-list',
      description: 'mitigation',
    });
    expect(kws).toContain('rr1');
    expect(kws).toContain('adversarial');
    expect(kws).toContain('prefilter');
    // dedupe (case-insensitive)
    expect(new Set(kws.map((s) => s.toLowerCase())).size).toBe(kws.length);
  });

  it('drops <3-char tokens', () => {
    const kws = deriveKeywords({ id: 'a-bc-def', title: 'a bc def', description: 'x' });
    expect(kws.every((k) => k.length >= 3)).toBe(true);
  });
});

describe('gatherContext', () => {
  it('reads context files, calls grepImpl, returns summary', async () => {
    const grepImpl = vi.fn(async (pat: string) => [`fake:${pat}:1: matched`]);
    const readFileImpl = vi.fn(async (p: string) => `content-of:${p}`);
    const semanticSearchImpl = vi.fn(async () => [{ path: 'x.ts', score: 0.9, snippet: 's' }]);
    const out = await gatherContext(
      {
        id: 'demo',
        title: 'Demo thing',
        description: 'x',
        file_paths: ['/tmp/this-file-does-not-exist-12345'],
      },
      {
        cwd: '/tmp',
        contextFiles: [],
        grepImpl,
        readFileImpl,
        semanticSearchImpl,
        routerBaseUrl: 'http://fake',
      },
    );
    expect(grepImpl).toHaveBeenCalled();
    expect(out.semantic_hits).toHaveLength(1);
    expect(out.summary).toMatch(/Gathered/);
  });

  it('continues when semantic search throws', async () => {
    const grepImpl = vi.fn(async () => []);
    const semanticSearchImpl = vi.fn(async () => {
      throw new Error('boom');
    });
    const out = await gatherContext(
      { id: 'demo', title: 'Demo thing', description: 'x' },
      { cwd: '/tmp', grepImpl, semanticSearchImpl, routerBaseUrl: 'http://fake' },
    );
    expect(out.semantic_hits).toHaveLength(0);
    expect(out.summary).toMatch(/semantic-search.*failed/);
  });

  it('disables semantic search when routerBaseUrl=null', async () => {
    const grepImpl = vi.fn(async () => []);
    const out = await gatherContext(
      { id: 'demo', title: 'Demo thing', description: 'x' },
      { cwd: '/tmp', grepImpl, routerBaseUrl: null },
    );
    expect(out.summary).toMatch(/disabled/);
  });
});
