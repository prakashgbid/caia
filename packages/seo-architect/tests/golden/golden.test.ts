/**
 * Golden test — the canonical known-good SEO-architect artifact for a
 * known prakash-tiwari Page ticket.
 *
 * This test serves four purposes:
 *
 *   1. Lock the architect's output shape against drift. Any change to
 *      the contract or run() must update this snapshot.
 *
 *   2. Demonstrate the architect produces a complete, validating output
 *      end-to-end given a realistic input.
 *
 *   3. Verify the JSON-LD payload validates against Google's Rich
 *      Results format — `@context = "https://schema.org"`, `@type`
 *      matches `pageType`, and every per-type required prop is populated.
 *
 *   4. Become the canonical fixture #4 references when wave-2 architects
 *      consume SEO outputs.
 *
 * Note: this test uses a deterministic fake spawner. It does NOT call
 * the real claude binary.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { SeoArchitect } from '../../src/architect.js';
import { SEO_OWNED_FIELD_KEYS } from '../../src/contract.js';
import {
  RICH_RESULTS_REQUIRED_PROPS,
  SEO_INVARIANTS,
  validateRichResults
} from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden — prakash-tiwari Person Page ticket', () => {
  it('input-ticket.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, 'input-ticket.json'), 'utf-8'));
    const fixture = buildFakeInput().ticket;
    expect(raw).toEqual(fixture);
  });

  it('input-businessplan.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-businessplan.json'), 'utf-8')
    );
    const fixture = buildFakeInput().businessPlan;
    expect(raw).toEqual(fixture);
  });

  it('input-designversion.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-designversion.json'), 'utf-8')
    );
    const fixture = buildFakeInput().designVersion;
    expect(raw).toEqual(fixture);
  });

  it('assistant text validates cleanly', () => {
    const result = validateArchitectOutput(goldenAssistantText(), SEO_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SeoArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    // Architect name, status, top-level shape
    expect(out.architectName).toBe('seo');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    // Every owned field present
    for (const k of SEO_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    // Field values match the known-good expectation (except spend, which
    // the run pipeline overwrites).
    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.dependencies).toEqual(expected.dependencies);
    expect(out.risks).toEqual(expected.risks);
  });

  it('output passes every SEO invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SeoArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of SEO_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SeoArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });

  // ─── Google Rich Results format validation (the spec's headline test) ─

  it('JSON-LD validates against Google Rich Results format', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SeoArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    const jsonLd = out.architectureFields['seo.schemaOrgJsonLd'];
    const pageType = out.architectureFields['seo.pageType'];

    // Golden output is a Person page — Rich Results requires `name`.
    expect(validateRichResults(jsonLd, pageType)).toBe(true);
  });

  it('JSON-LD declares the schema.org @context literal', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SeoArchitect({ spawner });
    const out = await arch.run(buildFakeInput());
    const jsonLd = out.architectureFields['seo.schemaOrgJsonLd'] as Record<string, unknown>;
    expect(jsonLd['@context']).toBe('https://schema.org');
  });

  it('JSON-LD @type matches pageType', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SeoArchitect({ spawner });
    const out = await arch.run(buildFakeInput());
    const jsonLd = out.architectureFields['seo.schemaOrgJsonLd'] as Record<string, unknown>;
    const pageType = out.architectureFields['seo.pageType'];
    expect(jsonLd['@type']).toBe(pageType);
  });

  it('JSON-LD has every per-type required prop populated', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SeoArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    const pageType = out.architectureFields['seo.pageType'] as string;
    const jsonLd = out.architectureFields['seo.schemaOrgJsonLd'] as Record<string, unknown>;
    const required = RICH_RESULTS_REQUIRED_PROPS[pageType] ?? [];

    expect(required.length).toBeGreaterThan(0);
    for (const prop of required) {
      const val = jsonLd[prop];
      expect(val, `Required Rich Results prop '${prop}' for @type='${pageType}' must be populated`).toBeTruthy();
    }
  });

  it('canonicalUrl is absolute and HTTPS (Rich Results / canonical hygiene)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SeoArchitect({ spawner });
    const out = await arch.run(buildFakeInput());
    const url = out.architectureFields['seo.canonicalUrl'] as string;
    expect(url.startsWith('https://')).toBe(true);
  });

  it('OG image URL is declared (so the upstream 1200×630 pipeline can verify)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SeoArchitect({ spawner });
    const out = await arch.run(buildFakeInput());
    const og = out.architectureFields['seo.ogTags'] as Record<string, unknown>;
    expect(og['og:image']).toBeTruthy();
    expect(String(og['og:image']).startsWith('https://')).toBe(true);
    // Smoke-check the filename hint encodes the floor dimensions.
    expect(String(og['og:image'])).toContain('1200x630');
  });
});
