/**
 * BundleReader — CODING-001 unit tests.
 *
 * Mocks the fetch impl to exercise every error kind plus the happy path.
 *
 * 8 cases.
 */

import { BundleReader, BundleReaderError } from '../src/bundle-reader';

function happyBundle() {
  return {
    story: {
      id: 's1',
      title: 'a story',
      description: '',
      status: 'pending',
      rootPromptId: null,
      parentEntityId: null,
      parentEntityType: null,
      bucketId: 'bkt_a',
      templateVersion: 'v1',
      templateValidationStatus: 'pending',
      templateValidationErrors: null,
      enrichedAt: null,
      updatedAt: null,
    },
    ticket: null,
    ticketParseError: null,
    prompt: {
      id: 'p1',
      body: 'do the thing',
      receivedAt: new Date().toISOString(),
      correlationId: 'corr_x',
      status: 'received',
    },
    requirement: null,
    bucket: {
      id: 'bkt_a',
      kind: 'parallel' as const,
      domainSlug: null,
      sequenceIndex: null,
      status: 'open',
    },
    labels: [],
    dependencies: { upstream: [], downstream: [] },
    inputDependencies: [],
  };
}

function makeFetch(impl: () => Promise<Response> | Response): typeof globalThis.fetch {
  return (async () => impl()) as unknown as typeof globalThis.fetch;
}

describe('BundleReader — construction', () => {
  it('rejects empty baseUrl', () => {
    expect(() => new BundleReader({ baseUrl: '' })).toThrow(/baseUrl/);
  });

  it('strips trailing slash from baseUrl', async () => {
    let calledUrl = '';
    const fetchImpl = makeFetch(() => {
      // capture
      return new Response(JSON.stringify(happyBundle()), { status: 200 });
    });
    const reader = new BundleReader({
      baseUrl: 'http://localhost:9800/',
      fetchImpl: ((url: string) => {
        calledUrl = url;
        return Promise.resolve(new Response(JSON.stringify(happyBundle()), { status: 200 }));
      }) as unknown as typeof globalThis.fetch,
    });
    void fetchImpl;
    await reader.read('s1');
    expect(calledUrl).toBe('http://localhost:9800/stories/s1/bundle');
  });
});

describe('BundleReader — happy path', () => {
  it('returns a fully-typed Bundle on a 200 response', async () => {
    const fetchImpl = makeFetch(() =>
      new Response(JSON.stringify(happyBundle()), { status: 200 }),
    );
    const reader = new BundleReader({ baseUrl: 'http://x', fetchImpl });
    const b = await reader.read('s1');
    expect(b.story.id).toBe('s1');
    expect(b.bucket?.kind).toBe('parallel');
    expect(b.dependencies.upstream).toEqual([]);
  });
});

describe('BundleReader — error kinds', () => {
  it('throws not-found on 404', async () => {
    const fetchImpl = makeFetch(() => new Response('', { status: 404 }));
    const reader = new BundleReader({ baseUrl: 'http://x', fetchImpl });
    await expect(reader.read('s_nope')).rejects.toMatchObject({
      kind: 'not-found',
    });
  });

  it('throws http-error on non-2xx (e.g. 500)', async () => {
    const fetchImpl = makeFetch(() => new Response('boom', { status: 500 }));
    const reader = new BundleReader({ baseUrl: 'http://x', fetchImpl });
    const err = await reader.read('s1').catch((e) => e);
    expect(err).toBeInstanceOf(BundleReaderError);
    expect(err.kind).toBe('http-error');
    expect(err.retryable).toBe(true);
  });

  it('throws parse-error on invalid JSON body', async () => {
    const fetchImpl = makeFetch(() => new Response('not-json', { status: 200 }));
    const reader = new BundleReader({ baseUrl: 'http://x', fetchImpl });
    const err = await reader.read('s1').catch((e) => e);
    expect(err.kind).toBe('parse-error');
    expect(err.retryable).toBe(false);
  });

  it('throws schema-error when body parses but fails Zod', async () => {
    const fetchImpl = makeFetch(() =>
      new Response(JSON.stringify({ story: { id: 's1' } }), { status: 200 }),
    );
    const reader = new BundleReader({ baseUrl: 'http://x', fetchImpl });
    const err = await reader.read('s1').catch((e) => e);
    expect(err.kind).toBe('schema-error');
    expect(err.retryable).toBe(false);
  });

  it('throws network-error when fetch itself rejects', async () => {
    const fetchImpl = (() =>
      Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch;
    const reader = new BundleReader({ baseUrl: 'http://x', fetchImpl });
    const err = await reader.read('s1').catch((e) => e);
    expect(err.kind).toBe('network-error');
    expect(err.retryable).toBe(true);
  });
});

describe('BundleReader — readOrNull', () => {
  it('returns null on not-found', async () => {
    const fetchImpl = makeFetch(() => new Response('', { status: 404 }));
    const reader = new BundleReader({ baseUrl: 'http://x', fetchImpl });
    expect(await reader.readOrNull('s_gone')).toBeNull();
  });

  it('rethrows non-not-found errors', async () => {
    const fetchImpl = makeFetch(() => new Response('boom', { status: 500 }));
    const reader = new BundleReader({ baseUrl: 'http://x', fetchImpl });
    await expect(reader.readOrNull('s1')).rejects.toMatchObject({
      kind: 'http-error',
    });
  });
});
