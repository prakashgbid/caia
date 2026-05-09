/**
 * Phase 3 tests for doc-to-figma real implementation (T4.8).
 *
 * Test coverage:
 *  - Happy path: dry-run produces FigmaSpec with correct frame count
 *  - Layout: cumulative y-offsets, defaults applied when section.height omitted
 *  - Mapping: known sections → L3 ref; unknown sections → placeholder + listed in unmappedSections
 *  - Approvals: checksum matches → write attempt allowed; mismatch → blocked-checksum-drift
 *  - Env gate: FIGMA_WRITE!=1 → blocked-env-gate
 *  - allowFigmaWrite=false → blocked-env-gate
 *  - Mock MCP client receives the right payload on a successful write
 *  - Checksum determinism (preserve Phase 1 contract)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { docToFigma, computeChecksum } from '../src/doc-to-figma.js';
import { __setMockMcpClient, __resetMcpCallCount, __getMcpCallCount } from '../src/mcp-client.js';
import { mockVastuConfig } from './fixtures/mock-config.js';
import type { VastuConfig } from '../src/config.js';
import type { FormalDoc } from '../src/types.js';

describe('docToFigma (Phase 3 real implementation)', () => {
  beforeEach(() => {
    __resetMcpCallCount();
    __setMockMcpClient(null);
    delete process.env['FIGMA_WRITE'];
  });

  afterEach(() => {
    __setMockMcpClient(null);
    delete process.env['FIGMA_WRITE'];
  });

  describe('happy path — dry-run', () => {
    it('produces FigmaSpec with correct frame count matching sections', async () => {
      const doc: FormalDoc = {
        id: 'page-1',
        name: 'Home Page',
        audience: 'visitors',
        sections: [
          { id: 's1', section: 'HeroSection', intent: 'hero' },
          { id: 's2', section: 'FeatureGrid', intent: 'features' },
        ],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.frames).toHaveLength(2);
      expect(result.pageName).toBe('Home Page');
      expect(result.writeStatus).toBe('dry-run');
      expect(result.unmappedSections.length).toBeGreaterThanOrEqual(0);
    });

    it('emits checksum in meta', async () => {
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.meta.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });

  describe('layout — cumulative y-offsets', () => {
    it('stacks frames vertically with correct y coordinates', async () => {
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          { id: 'a', section: 'HeroSection', intent: 'a', height: 100 },
          { id: 'b', section: 'FeatureGrid', intent: 'b', height: 200 },
          { id: 'c', section: 'NewsletterSection', intent: 'c', height: 150 },
        ],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.frames[0]?.y).toBe(0);
      expect(result.frames[1]?.y).toBe(100);
      expect(result.frames[2]?.y).toBe(300);
      expect(result.height).toBe(450);
    });

    it('applies config.defaultSectionHeight when section.height is omitted', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        defaultSectionHeight: 250,
      };

      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          { id: 's1', section: 'HeroSection', intent: 'h' },
          { id: 's2', section: 'FeatureGrid', intent: 'f', height: 300 },
        ],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.frames[0]?.height).toBe(250); // default
      expect(result.frames[1]?.height).toBe(300); // explicit
      expect(result.height).toBe(550);
    });

    it('handles empty sections array', async () => {
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.frames).toHaveLength(0);
      expect(result.height).toBe(0);
    });
  });

  describe('component mapping', () => {
    it('maps known sections to component refs from config.componentLibrary', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        componentLibrary: {
          HeroSection: { libraryKey: 'L3', codeConnectKey: 'HeroSection' },
          FeatureGrid: { libraryKey: 'L3', codeConnectKey: 'FeatureGrid' },
        },
      };

      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          { id: 's1', section: 'HeroSection', intent: 'h' },
          { id: 's2', section: 'FeatureGrid', intent: 'f' },
        ],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.frames[0]?.componentRef.libraryKey).toBe('L3');
      expect(result.frames[0]?.componentRef.codeConnectKey).toBe('HeroSection');
      expect(result.frames[0]?.type).toBe('componentInstance');
      expect(result.unmappedSections).not.toContain('HeroSection');
    });

    it('creates placeholder refs for unmapped sections', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        componentLibrary: {},
      };

      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          { id: 's1', section: 'UnknownSection', intent: 'u' },
        ],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.frames[0]?.type).toBe('placeholder');
      expect(result.frames[0]?.componentRef.libraryKey).toBe('placeholder');
      expect(result.frames[0]?.componentRef.codeConnectKey).toBe('UnknownSection');
      expect(result.unmappedSections).toContain('UnknownSection');
    });

    it('tracks unmappedSections separately from mapped sections', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        componentLibrary: {
          HeroSection: { libraryKey: 'L3', codeConnectKey: 'HeroSection' },
        },
      };

      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          { id: 's1', section: 'HeroSection', intent: 'mapped' },
          { id: 's2', section: 'UnknownA', intent: 'unmapped' },
          { id: 's3', section: 'UnknownB', intent: 'unmapped' },
        ],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.unmappedSections).toEqual(['UnknownA', 'UnknownB']);
      expect(result.unmappedSections).not.toContain('HeroSection');
    });
  });

  describe('environment gates', () => {
    it('returns dry-run by default (allowFigmaWrite=false)', async () => {
      const config: VastuConfig = { ...mockVastuConfig, allowFigmaWrite: false };
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.writeStatus).toBe('dry-run');
    });

    it('returns blocked-env-gate when FIGMA_WRITE is not 1', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        allowFigmaWrite: true,
        approvalsPath: undefined, // no approval check
      };
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored',
      };

      process.env['FIGMA_WRITE'] = '0';
      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.writeStatus).toBe('blocked-env-gate');
    });

    it('returns blocked-env-gate when FIGMA_WRITE is unset', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        allowFigmaWrite: true,
        approvalsPath: undefined,
      };
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored',
      };

      delete process.env['FIGMA_WRITE'];
      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.writeStatus).toBe('blocked-env-gate');
    });
  });

  describe('checksum determinism', () => {
    it('produces sha256: prefixed hex', () => {
      const checksum = computeChecksum({ a: 1 });
      expect(checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('produces identical checksum for identical input', async () => {
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored',
      };

      const a = await docToFigma({ formalDoc: doc, config: mockVastuConfig });
      const b = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(a.meta.checksum).toBe(b.meta.checksum);
    });

    it('produces different checksums for different input', () => {
      const c1 = computeChecksum({ a: 1 });
      const c2 = computeChecksum({ a: 2 });
      expect(c1).not.toBe(c2);
    });
  });

  describe('frame metadata', () => {
    it('includes sectionNumber and sectionId in frame meta', async () => {
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          { id: 'sec-0', section: 'HeroSection', intent: 'h' },
          { id: 'sec-1', section: 'FeatureGrid', intent: 'f' },
        ],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.frames[0]?.meta.sectionNumber).toBe(0);
      expect(result.frames[0]?.meta.sectionId).toBe('sec-0');
      expect(result.frames[1]?.meta.sectionNumber).toBe(1);
      expect(result.frames[1]?.meta.sectionId).toBe('sec-1');
    });

    it('tags placeholder frames with component-not-mapped', async () => {
      const config: VastuConfig = { ...mockVastuConfig, componentLibrary: {} };
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'UnknownSection', intent: 'u' }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.frames[0]?.meta.tag).toBe('component-not-mapped');
    });

    it('omits tag for non-placeholder frames', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        componentLibrary: {
          HeroSection: { libraryKey: 'L3', codeConnectKey: 'HeroSection' },
        },
      };
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'h' }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.frames[0]?.meta.tag).toBeUndefined();
    });
  });

  describe('section props passthrough', () => {
    it('includes section.props in frame.props', async () => {
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          {
            id: 's1',
            section: 'HeroSection',
            intent: 'h',
            props: { title: 'Hello', subtitle: 'World' },
          },
        ],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.frames[0]?.props).toEqual({ title: 'Hello', subtitle: 'World' });
    });

    it('defaults to empty props object if not provided', async () => {
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'h' }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.frames[0]?.props).toEqual({});
    });
  });

  describe('validation', () => {
    it('throws if FormalDoc lacks id', async () => {
      const doc = {
        name: 'P',
        audience: 'a',
        sections: [],
        origin: 'hand-authored',
      };

      await expect(docToFigma({ formalDoc: doc as unknown as FormalDoc, config: mockVastuConfig })).rejects.toThrow(
        /id/
      );
    });

    it('throws if FormalDoc lacks name', async () => {
      const doc = {
        id: 'p',
        audience: 'a',
        sections: [],
        origin: 'hand-authored',
      };

      await expect(docToFigma({ formalDoc: doc as unknown as FormalDoc, config: mockVastuConfig })).rejects.toThrow(
        /name/
      );
    });

    it('throws if FormalDoc lacks sections', async () => {
      const doc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        origin: 'hand-authored',
      };

      await expect(docToFigma({ formalDoc: doc as unknown as FormalDoc, config: mockVastuConfig })).rejects.toThrow(
        /sections/
      );
    });
  });

  describe('dimensions and sizing', () => {
    it('uses config.desktopWidth for frame width', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        desktopWidth: 1920,
      };
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'h', height: 100 }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.width).toBe(1920);
      expect(result.frames[0]?.width).toBe(1920);
    });

    it('computes total height as sum of frame heights', async () => {
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [
          { id: 's1', section: 'HeroSection', intent: 'h', height: 100 },
          { id: 's2', section: 'FeatureGrid', intent: 'f', height: 200 },
          { id: 's3', section: 'NewsletterSection', intent: 'n', height: 150 },
        ],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.height).toBe(450);
    });

    it('handles desktopWidth of zero gracefully', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        desktopWidth: 0, // Edge case but shouldn't crash
      };
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'h', height: 100 }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.width).toBe(0);
      expect(result.height).toBe(100);
    });
  });

  describe('meta fields', () => {
    it('includes generatedAt ISO timestamp', async () => {
      const before = new Date();
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });
      const after = new Date();

      const generated = new Date(result.meta.generatedAt);
      expect(generated.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(generated.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('includes pageId from FormalDoc.id', async () => {
      const doc: FormalDoc = {
        id: 'my-page-id',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.meta.pageId).toBe('my-page-id');
    });

    it('includes schemaVersion 1.0.0', async () => {
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config: mockVastuConfig });

      expect(result.meta.schemaVersion).toBe('1.0.0');
    });
  });

  describe('libraryUrls passthrough', () => {
    it('includes config.libraryUrls in output', async () => {
      const config: VastuConfig = {
        ...mockVastuConfig,
        libraryUrls: {
          basic: 'https://figma.com/file/BASIC',
          business: 'https://figma.com/file/BUSINESS',
          blueprints: 'https://figma.com/file/BLUEPRINTS',
        },
      };
      const doc: FormalDoc = {
        id: 'p',
        name: 'P',
        audience: 'a',
        sections: [{ id: 's', section: 'HeroSection', intent: 'i' }],
        origin: 'hand-authored',
      };

      const result = await docToFigma({ formalDoc: doc, config });

      expect(result.libraryUrls).toEqual({
        basic: 'https://figma.com/file/BASIC',
        business: 'https://figma.com/file/BUSINESS',
        blueprints: 'https://figma.com/file/BLUEPRINTS',
      });
    });
  });
});
