import { describe, it, expect } from 'vitest';
import { runVastuPipeline } from '../src/pipeline.js';
import { textToDoc } from '../src/text-to-doc.js';
import { docToFigma, computeChecksum } from '../src/doc-to-figma.js';
import { figmaToScaffold } from '../src/figma-to-scaffold.js';
import { mockVastuConfig } from './fixtures/mock-config.js';

describe('runVastuPipeline (Phase 1 stub contract)', () => {
  it('returns formalDoc + figmaSpec + scaffold from raw inputText', async () => {
    const result = await runVastuPipeline({
      inputText: 'A hero, three feature cards, and a newsletter signup.',
      config: mockVastuConfig
    });

    expect(result.formalDoc.origin).toBe('stub');
    expect(result.formalDoc.sections.length).toBeGreaterThan(0);
    expect(result.figmaSpec.frames.length).toBe(result.formalDoc.sections.length);
    expect(result.figmaSpec.writeStatus).toBe('dry-run');
    expect(result.scaffold.files.length).toBeGreaterThan(0);
  });

  it('honours pageId override', async () => {
    const result = await runVastuPipeline({
      inputText: 'Content',
      config: mockVastuConfig,
      pageId: 'custom-page-id'
    });
    expect(result.formalDoc.id).toBe('custom-page-id');
    expect(result.figmaSpec.meta.pageId).toBe('custom-page-id');
    expect(result.scaffold.pageId).toBe('custom-page-id');
  });

  it('skips Stage A when a formalDoc is supplied', async () => {
    const result = await runVastuPipeline({
      inputText: 'ignored',
      config: mockVastuConfig,
      formalDoc: {
        id: 'pre-built',
        name: 'Pre-Built',
        audience: 'test',
        sections: [
          { id: 's1', section: 'HeroSection', intent: 'Hero', height: 400 }
        ],
        origin: 'hand-authored'
      }
    });
    expect(result.formalDoc.origin).toBe('hand-authored');
    expect(result.figmaSpec.frames[0]?.height).toBe(400);
  });

  it('emits unmappedSections for sections missing from componentLibrary', async () => {
    const result = await runVastuPipeline({
      inputText: 'a',
      config: mockVastuConfig,
      formalDoc: {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          { id: 's1', section: 'HeroSection', intent: 'mapped' },
          { id: 's2', section: 'UnknownSection', intent: 'unmapped' }
        ],
        origin: 'hand-authored'
      }
    });
    expect(result.figmaSpec.unmappedSections).toContain('UnknownSection');
    expect(result.figmaSpec.unmappedSections).not.toContain('HeroSection');
  });
});

describe('textToDoc (Phase 1 stub)', () => {
  it('throws on empty input', async () => {
    await expect(
      textToDoc({ inputText: '   ', config: mockVastuConfig })
    ).rejects.toThrow();
  });

  it('returns a single-section stub doc with origin=stub', async () => {
    const doc = await textToDoc({ inputText: 'Hello world', config: mockVastuConfig });
    expect(doc.origin).toBe('stub');
    expect(doc.sections.length).toBe(1);
    expect(doc.sections[0]?.intent).toBe('Hello world');
  });
});

describe('docToFigma (Phase 1 stub)', () => {
  it('produces a deterministic checksum for identical input', async () => {
    const doc = {
      id: 'p',
      name: 'P',
      audience: 'a',
      sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
      origin: 'hand-authored' as const
    };
    const a = await docToFigma({ formalDoc: doc, config: mockVastuConfig });
    const b = await docToFigma({ formalDoc: doc, config: mockVastuConfig });
    expect(a.meta.checksum).toBe(b.meta.checksum);
  });

  it('stacks frames with cumulative y-offsets', async () => {
    const result = await docToFigma({
      formalDoc: {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          { id: 'a', section: 'HeroSection', intent: 'a', height: 100 },
          { id: 'b', section: 'FeatureGrid', intent: 'b', height: 200 }
        ],
        origin: 'hand-authored'
      },
      config: mockVastuConfig
    });
    expect(result.frames[0]?.y).toBe(0);
    expect(result.frames[1]?.y).toBe(100);
    expect(result.height).toBe(300);
  });
});

describe('figmaToScaffold (Phase 1 stub)', () => {
  it('emits page.tsx and page.config.ts', async () => {
    const spec = await docToFigma({
      formalDoc: {
        id: 'demo',
        name: 'Demo',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored'
      },
      config: mockVastuConfig
    });
    const scaffold = await figmaToScaffold({ figmaSpec: spec, config: mockVastuConfig });
    expect(scaffold.files.find((f) => f.path.endsWith('page.tsx'))).toBeDefined();
    expect(scaffold.files.find((f) => f.path.endsWith('page.config.ts'))).toBeDefined();
  });
});

describe('computeChecksum', () => {
  it('produces sha256: prefixed hex', () => {
    const checksum = computeChecksum({ a: 1 });
    expect(checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
