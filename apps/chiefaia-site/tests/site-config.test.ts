/**
 * Unit tests for `lib/site-config` — guards the operator's no-fabrication rule.
 * Anything that asserts "TBD" or "no fabricated authorship" lives here so a
 * future careless edit fails CI rather than ships to production.
 */

import { describe, expect, it } from 'vitest';
import {
  pricingTiers,
  primaryNav,
  sitemapRoutes,
  siteConfig,
  siteUrl,
  docsCategories,
} from '../lib/site-config';

describe('site-config', () => {
  it('siteUrl is the canonical chiefaia.com origin (overridable via env)', () => {
    expect(siteUrl).toMatch(/^https?:\/\//);
  });

  it('siteConfig exposes operator-confirmed name + publisher (no fabricated author)', () => {
    expect(siteConfig.name).toBe('ChiefAIA');
    expect(siteConfig.publisher).toBe('ChiefAIA');
    expect(siteConfig.tagline).toContain('builds');
  });

  it('primaryNav covers exactly the canonical top-level routes', () => {
    const hrefs = primaryNav.map((n) => n.href);
    expect(hrefs).toEqual([
      '/',
      '/pricing',
      '/docs',
      '/blog',
      '/changelog',
      '/contact',
    ]);
  });

  it('pricingTiers ship Free + Professional + Team with TBD prices (no fabricated $)', () => {
    expect(pricingTiers.map((t) => t.slug)).toEqual([
      'free',
      'professional',
      'team',
    ]);
    for (const tier of pricingTiers) {
      expect(tier.priceLabel).toBe('TBD');
      expect(tier.features.length).toBeGreaterThan(0);
    }
  });

  it('docsCategories include the five operator-named guides', () => {
    const slugs = docsCategories.map((c) => c.slug);
    expect(slugs).toContain('getting-started');
    expect(slugs).toContain('the-7-step-pipeline');
    expect(slugs).toContain('architecture');
    expect(slugs).toContain('agents');
    expect(slugs).toContain('evidence-gate');
  });

  it('sitemapRoutes include every primaryNav target', () => {
    const paths = sitemapRoutes.map((r) => r.path);
    for (const nav of primaryNav) {
      expect(paths).toContain(nav.href);
    }
  });
});
