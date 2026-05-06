import { describe, it, expect } from 'vitest';
import {
  createDefaultWebFetcher,
  createFixtureWebFetcher,
  htmlToText,
  extractTitle
} from '../src/fetchers/web-fetcher.js';
import type { FetchedPage } from '../src/types.js';

describe('htmlToText', () => {
  it('strips tags, scripts, styles', () => {
    const html =
      '<html><head><title>T</title><style>.x{}</style></head><body><script>x=1</script><p>hello <strong>world</strong></p></body></html>';
    const t = htmlToText(html);
    expect(t).toContain('hello');
    expect(t).toContain('world');
    expect(t).not.toContain('<');
    expect(t).not.toContain('x=1');
  });
  it('decodes entities', () => {
    expect(htmlToText('5 &lt; 10 &amp; ok')).toBe('5 < 10 & ok');
  });
});

describe('extractTitle', () => {
  it('uses <title> when present', () => {
    expect(extractTitle('<title>My Page</title>', 'https://x.com')).toBe(
      'My Page'
    );
  });
  it('falls back to <h1>', () => {
    expect(
      extractTitle('<h1>Header One</h1>', 'https://x.com')
    ).toBe('Header One');
  });
  it('falls back to host', () => {
    expect(extractTitle('no markers', 'https://example.com/path')).toBe(
      'example.com'
    );
  });
});

describe('createDefaultWebFetcher', () => {
  it('reads HTML, strips it, sets metadata', async () => {
    const fetcher = createDefaultWebFetcher({
      httpFetch: {
        async fetch() {
          return {
            ok: true,
            status: 200,
            body: '<html><title>Hi</title><body><p>Body</p></body></html>'
          };
        }
      },
      clock: () => new Date('2026-05-06T00:00:00Z')
    });
    const p = await fetcher.fetch('https://docs.bun.sh/runtime');
    expect(p.title).toBe('Hi');
    expect(p.text).toContain('Body');
    expect(p.trust).toBe('primary');
    expect(p.fetchedAtIso).toBe('2026-05-06T00:00:00.000Z');
  });

  it('throws on non-ok response', async () => {
    const fetcher = createDefaultWebFetcher({
      httpFetch: {
        async fetch() {
          return { ok: false, status: 404, body: '' };
        }
      }
    });
    await expect(fetcher.fetch('https://x.com/missing')).rejects.toThrow();
  });
});

describe('createFixtureWebFetcher', () => {
  it('returns canned page', async () => {
    const page: FetchedPage = {
      url: 'https://x.com',
      title: 't',
      fetchedAtIso: '2026-05-06T00:00:00Z',
      bytesFetched: 5,
      text: 'body',
      trust: 'tertiary'
    };
    const fetcher = createFixtureWebFetcher(new Map([['https://x.com', page]]));
    const out = await fetcher.fetch('https://x.com');
    expect(out.title).toBe('t');
  });
  it('throws on missing fixture', async () => {
    const fetcher = createFixtureWebFetcher(new Map());
    await expect(fetcher.fetch('https://x.com')).rejects.toThrow(/fixture missing/);
  });
});
