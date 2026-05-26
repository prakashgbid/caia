/**
 * Page metadata smoke tests — every customer-facing route exports a
 * `metadata` object with the canonical alternate and a non-empty title.
 */

import { describe, expect, it } from 'vitest';
import { metadata as rootMetadata } from '../app/layout';
import { metadata as pricingMetadata } from '../app/pricing/page';
import { metadata as docsMetadata } from '../app/docs/page';
import { metadata as blogMetadata } from '../app/blog/page';
import { metadata as changelogMetadata } from '../app/changelog/page';
import { metadata as contactMetadata } from '../app/contact/page';
import { metadata as signinMetadata } from '../app/sign-in/page';

describe('root layout metadata', () => {
  it('has an OpenGraph payload with site name + image', () => {
    expect(rootMetadata.openGraph?.siteName).toBe('ChiefAIA');
    expect(rootMetadata.openGraph?.images).toBeTruthy();
  });

  it('has a Twitter card payload', () => {
    // Next's Twitter metadata is a discriminated union — narrow via cast.
    const twitter = rootMetadata.twitter as { card?: string } | null | undefined;
    expect(twitter?.card).toBe('summary_large_image');
  });

  it('sets robots index + follow on default', () => {
    expect(rootMetadata.robots).toMatchObject({ index: true, follow: true });
  });
});

describe('per-page metadata', () => {
  const cases = [
    { name: 'pricing', meta: pricingMetadata, canonical: '/pricing' },
    { name: 'docs', meta: docsMetadata, canonical: '/docs' },
    { name: 'blog', meta: blogMetadata, canonical: '/blog' },
    { name: 'changelog', meta: changelogMetadata, canonical: '/changelog' },
    { name: 'contact', meta: contactMetadata, canonical: '/contact' },
    { name: 'sign-in', meta: signinMetadata, canonical: '/sign-in' },
  ];

  it.each(cases)('$name page declares a canonical', ({ meta, canonical }) => {
    expect(meta.alternates?.canonical).toBe(canonical);
  });

  it.each(cases)('$name page has a non-empty title', ({ meta }) => {
    expect(typeof meta.title === 'string' ? meta.title : '').not.toBe('');
  });

  it('sign-in page is noindex (it redirects to a private surface)', () => {
    expect(signinMetadata.robots).toMatchObject({ index: false });
  });
});
