/**
 * Cross-architect invariants — verifies SEO's contributions to the
 * EA Reviewer's invariant registry (per spec §6.2).
 */

import { describe, it, expect } from 'vitest';

import {
  RICH_RESULTS_REQUIRED_PROPS,
  SEO_INVARIANTS,
  validateRichResults
} from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('SEO_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(SEO_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of SEO_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `seo`', () => {
    for (const inv of SEO_INVARIANTS) {
      expect(inv.contributor).toBe('seo');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of SEO_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of SEO_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of SEO_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('SEO_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of SEO_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('schemaOrgJsonLd-validates-rich-results fails when @context is wrong', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.schemaOrgJsonLd-validates-rich-results');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'seo.schemaOrgJsonLd': {
        '@context': 'http://schema.org',
        '@type': 'Person',
        name: 'X'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('schemaOrgJsonLd-validates-rich-results fails when @type mismatches pageType', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.schemaOrgJsonLd-validates-rich-results');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'seo.pageType': 'Article',
      'seo.schemaOrgJsonLd': {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: 'X'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('canonicalUrl-is-https-absolute fails on http://', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.canonicalUrl-is-https-absolute');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'seo.canonicalUrl': 'http://example.com/'
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('canonicalUrl-is-https-absolute fails on a relative URL', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.canonicalUrl-is-https-absolute');
    expect(inv).toBeDefined();
    const corrupted = { ...goldenArch, 'seo.canonicalUrl': '/about' };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('metaTags-has-title-and-description fails when title is missing', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.metaTags-has-title-and-description');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'seo.metaTags': { description: 'present' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('ogTags-include-required-keys fails when og:image is missing', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.ogTags-include-required-keys');
    expect(inv).toBeDefined();
    const golden = goldenArch['seo.ogTags'] as Record<string, unknown>;
    const tags: Record<string, unknown> = { ...golden };
    delete tags['og:image'];
    const corrupted = { ...goldenArch, 'seo.ogTags': tags };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('twitterCard-mirrors-og fails on an unknown card type', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.twitterCard-mirrors-og');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'seo.twitterCard': { 'twitter:card': 'bananas' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('robotsDirective-has-index-and-follow fails when missing follow', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.robotsDirective-has-index-and-follow');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'seo.robotsDirective': { index: 'index' }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('sitemapEntry-present-when-indexable fails on a blank entry when indexable', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.sitemapEntry-present-when-indexable');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'seo.sitemapEntry': {}
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('sitemapEntry-present-when-indexable passes when noindex (entry optional)', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.sitemapEntry-present-when-indexable');
    expect(inv).toBeDefined();
    const variant = {
      ...goldenArch,
      'seo.robotsDirective': { index: 'noindex', follow: 'follow' },
      'seo.sitemapEntry': {}
    };
    expect(inv!.detect(variant)).toBe(true);
  });

  it('keywordTargets-has-primary fails when primary keyword is empty', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.keywordTargets-has-primary');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'seo.keywordTargets': { primary: { keyword: '' }, secondary: [] }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('keywordTargets-has-primary fails when secondary > 5', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.keywordTargets-has-primary');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'seo.keywordTargets': {
        primary: { keyword: 'x', intent: 'informational' },
        secondary: [
          { keyword: 'a' },
          { keyword: 'b' },
          { keyword: 'c' },
          { keyword: 'd' },
          { keyword: 'e' },
          { keyword: 'f' }
        ]
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('pageType-is-known-rich-results-type fails on an unknown @type', () => {
    const inv = SEO_INVARIANTS.find(i => i.id === 'seo.pageType-is-known-rich-results-type');
    expect(inv).toBeDefined();
    const corrupted = { ...goldenArch, 'seo.pageType': 'MadeUpType' };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});

describe('validateRichResults — direct unit checks', () => {
  it('passes a minimal Article payload', () => {
    expect(
      validateRichResults(
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'X',
          datePublished: '2026-01-01',
          author: 'Y',
          image: 'https://x/y.jpg'
        },
        'Article'
      )
    ).toBe(true);
  });

  it('rejects an Article missing headline', () => {
    expect(
      validateRichResults(
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          datePublished: '2026-01-01',
          author: 'Y',
          image: 'https://x/y.jpg'
        },
        'Article'
      )
    ).toBe(false);
  });

  it('passes a well-formed FAQPage payload', () => {
    expect(
      validateRichResults(
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'How long is a session?',
              acceptedAnswer: { '@type': 'Answer', text: '60 minutes.' }
            }
          ]
        },
        'FAQPage'
      )
    ).toBe(true);
  });

  it('rejects a FAQPage whose mainEntity entry lacks acceptedAnswer.text', () => {
    expect(
      validateRichResults(
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'How long is a session?',
              acceptedAnswer: { '@type': 'Answer' }
            }
          ]
        },
        'FAQPage'
      )
    ).toBe(false);
  });

  it('rejects a Product missing offers', () => {
    expect(
      validateRichResults(
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'X',
          image: 'https://x/y.jpg',
          description: 'desc'
        },
        'Product'
      )
    ).toBe(false);
  });

  it('rejects when @type does not match pageType', () => {
    expect(
      validateRichResults(
        {
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: 'X'
        },
        'Article'
      )
    ).toBe(false);
  });

  it('rejects on a non-object payload', () => {
    expect(validateRichResults('not an object', 'Person')).toBe(false);
    expect(validateRichResults(null, 'Person')).toBe(false);
    expect(validateRichResults(['array'], 'Person')).toBe(false);
  });

  it('rejects on an unknown @type', () => {
    expect(
      validateRichResults(
        { '@context': 'https://schema.org', '@type': 'NotARealType' },
        'NotARealType'
      )
    ).toBe(false);
  });

  it('exports RICH_RESULTS_REQUIRED_PROPS for the 11 supported types', () => {
    expect(Object.keys(RICH_RESULTS_REQUIRED_PROPS).sort()).toEqual(
      [
        'Article',
        'BlogPosting',
        'CollectionPage',
        'Event',
        'FAQPage',
        'LocalBusiness',
        'Organization',
        'Person',
        'Product',
        'Recipe',
        'WebSite'
      ].sort()
    );
  });
});
