import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MANIFEST_PATH = resolve(__dirname, '../../manifest/images.json');

function resetManifest() {
  writeFileSync(MANIFEST_PATH, '[]', 'utf-8');
}

function makeRecord(id: string, query = 'test query') {
  return {
    id,
    createdAt: new Date().toISOString(),
    query,
    source: { kind: 'web' as const, provider: 'unsplash', sourceUrl: 'https://unsplash.com/p/1' },
    license: { name: 'Unsplash License', url: 'https://unsplash.com/license', attributionRequired: false, photographer: 'Test User' },
    storage: {
      backend: 'r2',
      baseUrl: 'https://pub.example.com',
      variants: { mobile: 'https://pub.example.com/id/mobile.webp', tablet: 'https://pub.example.com/id/tablet.webp', desktop: 'https://pub.example.com/id/desktop.webp', '4k': 'https://pub.example.com/id/4k.webp', original: 'https://pub.example.com/id/original.jpg' },
    },
    alt: 'a test image',
    tags: ['test'],
    validation: { relevance: 0.8, sharpness: 150, aesthetic: 0.7 },
    usages: [] as Array<{ site: string; slot: string; addedAt: string }>,
    cost: 0,
  };
}

describe('Manifest', () => {
  beforeEach(() => resetManifest());

  it('getAllImages returns empty array initially', async () => {
    const { getAllImages } = await import('../../src/manifest/index.js');
    expect(getAllImages()).toEqual([]);
  });

  it('addImage stores a record and getImageById retrieves it', async () => {
    const { addImage, getImageById } = await import('../../src/manifest/index.js');
    const rec = makeRecord('test-add-aa11');
    addImage(rec);
    const found = getImageById('test-add-aa11');
    expect(found?.id).toBe('test-add-aa11');
    expect(found?.query).toBe('test query');
  });

  it('addImage updates existing record (upsert)', async () => {
    const { addImage, getImageById } = await import('../../src/manifest/index.js');
    const rec = makeRecord('upsert-bb22');
    addImage(rec);
    addImage({ ...rec, alt: 'updated alt' });
    const found = getImageById('upsert-bb22');
    expect(found?.alt).toBe('updated alt');
  });

  it('appendUsage adds a usage entry', async () => {
    const { addImage, appendUsage, getImageById } = await import('../../src/manifest/index.js');
    const rec = makeRecord('usage-cc33');
    addImage(rec);
    appendUsage('usage-cc33', { site: 'poker-zeno', slot: 'hero', addedAt: '2026-01-01T00:00:00Z' });
    const found = getImageById('usage-cc33');
    expect(found?.usages).toHaveLength(1);
    expect(found?.usages[0]?.site).toBe('poker-zeno');
  });

  it('appendUsage is idempotent for same site+slot', async () => {
    const { addImage, appendUsage, getImageById } = await import('../../src/manifest/index.js');
    const rec = makeRecord('idem-dd44');
    addImage(rec);
    const usage = { site: 'poker-zeno', slot: 'hero', addedAt: '2026-01-01T00:00:00Z' };
    appendUsage('idem-dd44', usage);
    appendUsage('idem-dd44', usage);
    const found = getImageById('idem-dd44');
    expect(found?.usages.filter(u => u.site === 'poker-zeno' && u.slot === 'hero').length).toBe(1);
  });

  it('getImagesBySite returns only images for that site', async () => {
    const { addImage, appendUsage, getImagesBySite } = await import('../../src/manifest/index.js');
    const r1 = makeRecord('site-ee55');
    const r2 = makeRecord('site-ff66');
    addImage(r1);
    addImage(r2);
    appendUsage('site-ee55', { site: 'poker-zeno', slot: 'hero', addedAt: '2026-01-01T00:00:00Z' });
    appendUsage('site-ff66', { site: 'roulette-community', slot: 'hero', addedAt: '2026-01-01T00:00:00Z' });
    const pz = getImagesBySite('poker-zeno');
    expect(pz).toHaveLength(1);
    expect(pz[0]?.id).toBe('site-ee55');
  });

  it('findSimilarByQuery returns record with high Jaccard similarity', async () => {
    const { addImage, findSimilarByQuery } = await import('../../src/manifest/index.js');
    const rec = makeRecord('similar-gg77', 'poker chips stacked green felt');
    addImage(rec);
    const found = findSimilarByQuery('poker chips stacked green felt');
    expect(found?.id).toBe('similar-gg77');
  });

  it('findSimilarByQuery returns null when similarity is below threshold', async () => {
    const { addImage, findSimilarByQuery } = await import('../../src/manifest/index.js');
    addImage(makeRecord('nomatch-hh88', 'abstract art painting'));
    const found = findSimilarByQuery('poker chips casino gambling roulette wheel');
    expect(found).toBeNull();
  });

  it('generateId produces a slug with random suffix', async () => {
    const { generateId } = await import('../../src/manifest/index.js');
    const id = generateId('poker chips on green felt');
    expect(id).toMatch(/^poker-chips-on-green-felt-[a-z0-9]{4}$/);
  });
});
