/**
 * robots.ts + manifest.ts shape tests.
 */

import { describe, expect, it } from 'vitest';
import robots from '../app/robots';
import manifest from '../app/manifest';
import { siteUrl, siteConfig } from '../lib/site-config';

describe('app/robots.ts', () => {
  const out = robots();

  it('allows the root path and disallows /api/', () => {
    const rule = Array.isArray(out.rules) ? out.rules[0] : out.rules;
    expect(rule?.userAgent).toBe('*');
    expect(rule?.allow).toBe('/');
    expect(rule?.disallow).toEqual(['/api/']);
  });

  it('points the sitemap at the canonical origin', () => {
    expect(out.sitemap).toBe(`${siteUrl}/sitemap.xml`);
  });
});

describe('app/manifest.ts', () => {
  const out = manifest();

  it('declares the operator-confirmed product name', () => {
    expect(out.name).toBe(siteConfig.name);
    expect(out.short_name).toBe(siteConfig.shortName);
  });

  it('starts at the root scope', () => {
    expect(out.start_url).toBe('/');
    expect(out.scope).toBe('/');
  });

  it('ships an installable display mode', () => {
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(out.display);
  });

  it('ships at least one icon entry', () => {
    expect(out.icons?.length ?? 0).toBeGreaterThan(0);
  });
});
