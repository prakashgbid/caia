/**
 * schema.org JSON-LD assertions — both graphs must reference the
 * Organization @id from one another so Google's structured-data tool
 * understands the publisher relationship.
 */

import { describe, expect, it } from 'vitest';
import { organizationJsonLd, websiteJsonLd } from '../lib/jsonld';
import { siteUrl, siteConfig } from '../lib/site-config';

describe('Organization JSON-LD', () => {
  const ld = organizationJsonLd();

  it('uses the schema.org context', () => {
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Organization');
  });

  it('@id is the canonical organization URI', () => {
    expect(ld['@id']).toBe(`${siteUrl}/#organization`);
  });

  it('name + url match the operator-confirmed site config', () => {
    expect(ld.name).toBe(siteConfig.publisher);
    expect(ld.url).toBe(siteUrl);
  });
});

describe('WebSite JSON-LD', () => {
  const ld = websiteJsonLd();

  it('@type is WebSite', () => {
    expect(ld['@type']).toBe('WebSite');
  });

  it('publisher references the Organization @id', () => {
    expect((ld.publisher as { '@id': string })['@id']).toBe(
      `${siteUrl}/#organization`
    );
  });

  it('description echoes site config (no fabricated description)', () => {
    expect(ld.description).toBe(siteConfig.description);
  });
});
