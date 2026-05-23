import { describe, expect, it } from 'vitest';
import { composeDomId, nodeFingerprint, slugifyTag } from '../src/fingerprint.js';

describe('slugifyTag', () => {
  it('strips angle brackets from JSX-style component names', () => {
    expect(slugifyTag('<HomeHeroSlider>')).toBe('home-hero-slider');
  });

  it('kebab-cases PascalCase tags', () => {
    expect(slugifyTag('WorkedWithWall')).toBe('worked-with-wall');
  });

  it('keeps lowercase HTML tags intact', () => {
    expect(slugifyTag('section')).toBe('section');
    expect(slugifyTag('div')).toBe('div');
  });

  it('returns "unknown" for empty / nullish input', () => {
    expect(slugifyTag('')).toBe('unknown');
    expect(slugifyTag(undefined)).toBe('unknown');
    expect(slugifyTag(null)).toBe('unknown');
  });

  it('collapses runs of non-alphanumerics into single hyphens', () => {
    expect(slugifyTag('foo___bar!!!baz')).toBe('foo-bar-baz');
  });

  it('handles consecutive uppercase letters (e.g. acronyms) sensibly', () => {
    // `URLShortener` → `url-shortener` (we keep the acronym together).
    expect(slugifyTag('URLShortener')).toBe('url-shortener');
  });

  it('is idempotent on already-kebab-case input', () => {
    expect(slugifyTag('already-kebab')).toBe('already-kebab');
  });
});

describe('nodeFingerprint', () => {
  it('joins slug + role + position with colons', () => {
    expect(nodeFingerprint('HomeHeroSlider', 'widget', 0)).toBe('home-hero-slider:widget:0');
  });

  it('ignores attrs / style — fingerprint is structural only', () => {
    // No way to "pass attrs" to nodeFingerprint — that's the point.
    // Calling it twice with the same structural inputs returns the
    // same string, regardless of whatever ambient attrs we pretend to
    // have.
    expect(nodeFingerprint('div', 'leaf', 3)).toBe('div:leaf:3');
    expect(nodeFingerprint('div', 'leaf', 3)).toBe('div:leaf:3');
  });
});

describe('composeDomId', () => {
  it('returns the segment as-is for root nodes', () => {
    expect(composeDomId(null, 'home-page:page:0')).toBe('home-page:page:0');
  });

  it('joins parent + child with ">" for non-roots', () => {
    expect(composeDomId('home-page:page:0', 'pt-nav:widget:0')).toBe(
      'home-page:page:0>pt-nav:widget:0',
    );
  });

  it('chains deeply without losing segments', () => {
    const a = composeDomId(null, 'a:page:0');
    const b = composeDomId(a, 'b:section:0');
    const c = composeDomId(b, 'c:leaf:0');
    expect(c).toBe('a:page:0>b:section:0>c:leaf:0');
  });
});
