import { describe, expect, it } from 'vitest';
import {
  RenderableDesignSchema,
  RenderableNodeSchema,
  SourceNameSchema,
  SOURCE_NAMES,
  assertRenderableDesign,
  AdapterCapabilitiesSchema,
  ValidationResultSchema,
} from '../../src/schema.js';
import { minimalDesign } from '../helpers/fixtures.js';

describe('RenderableDesignSchema', () => {
  it('accepts a minimal valid design', () => {
    const parsed = RenderableDesignSchema.parse(minimalDesign());
    expect(parsed.designVersionId).toBe('dv-test-1');
    expect(parsed.routes).toHaveLength(1);
  });

  it('rejects missing designVersionId', () => {
    const bad = { ...minimalDesign(), designVersionId: undefined };
    expect(() => RenderableDesignSchema.parse(bad)).toThrow();
  });

  it('rejects empty routes when an empty array is provided as undefined', () => {
    const bad = { ...minimalDesign(), routes: undefined };
    expect(() => RenderableDesignSchema.parse(bad)).toThrow();
  });

  it('rejects a node with an unknown role', () => {
    expect(() =>
      RenderableNodeSchema.parse({ tag: 'div', role: 'not-a-role' }),
    ).toThrow();
  });

  it('accepts recursive children', () => {
    const node = {
      tag: 'main',
      role: 'page' as const,
      children: [
        {
          tag: 'section',
          role: 'section' as const,
          children: [{ tag: 'h1', role: 'widget' as const }],
        },
      ],
    };
    const parsed = RenderableNodeSchema.parse(node);
    expect(parsed.children?.[0]?.children?.[0]?.tag).toBe('h1');
  });

  it('accepts pass-through extras (sourceMetadata, site, ingestDiagnostics)', () => {
    const d = {
      ...minimalDesign(),
      sourceMetadata: { adapterVersion: '0.1.0' },
      site: { name: 'pt.com' },
      ingestDiagnostics: { warnings: [] },
    };
    const parsed = RenderableDesignSchema.parse(d);
    expect(parsed.sourceMetadata).toEqual({ adapterVersion: '0.1.0' });
  });

  it('assertRenderableDesign throws on garbage input', () => {
    expect(() => assertRenderableDesign({})).toThrow();
  });
});

describe('SourceNameSchema', () => {
  it('lists all 9 spec sources', () => {
    expect(SOURCE_NAMES).toHaveLength(9);
    expect(SOURCE_NAMES).toContain('cd-zip');
    expect(SOURCE_NAMES).toContain('figma-json');
  });

  it('rejects unknown source', () => {
    expect(() => SourceNameSchema.parse('weglow')).toThrow();
  });
});

describe('AdapterCapabilitiesSchema', () => {
  it('accepts minimal capabilities', () => {
    const c = AdapterCapabilitiesSchema.parse({
      supportsRefresh: false,
      supportsLiveWebhook: false,
      requiresCredential: false,
    });
    expect(c.supportsRefresh).toBe(false);
  });

  it('rejects unknown credentialKind', () => {
    expect(() =>
      AdapterCapabilitiesSchema.parse({
        supportsRefresh: false,
        supportsLiveWebhook: false,
        requiresCredential: true,
        credentialKind: 'magic',
      }),
    ).toThrow();
  });
});

describe('ValidationResultSchema', () => {
  it('accepts a clean validation', () => {
    const r = ValidationResultSchema.parse({
      ok: true,
      warnings: [],
      errors: [],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a warning with an unknown severity', () => {
    expect(() =>
      ValidationResultSchema.parse({
        ok: false,
        warnings: [{ code: 'foo', severity: 'p5', message: 'bad' }],
        errors: [],
      }),
    ).toThrow();
  });
});
