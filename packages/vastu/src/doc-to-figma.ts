/**
 * Stage B — FormalDoc → FigmaSpec.
 *
 * Phase 1 STUB. Phase 3 will lift the bulk of Stolution's
 * `@stolution/vastu-figma-bridge` (component-map + layout + generate.ts)
 * into this module, parameterised against `VastuConfig`.
 *
 * The Phase 1 stub:
 *  - stacks the formal-doc sections vertically with the configured default height
 *  - resolves componentRef from `config.componentLibrary` (empty in Phase 1
 *    → every section becomes a placeholder frame)
 *  - emits a deterministic SHA-256 checksum over the stable JSON
 *  - never touches Figma — `writeStatus` is always `'dry-run'`
 *
 * The output already has the same shape as Stolution's FigmaPagePayload so
 * Phase 3 can swap the implementation without changing the type contract.
 */

import { createHash } from 'node:crypto';
import type { FormalDoc, FigmaSpec, FrameNode, ComponentRef } from './types.js';
import type { VastuConfig } from './config.js';

export interface DocToFigmaOptions {
  formalDoc: FormalDoc;
  config: VastuConfig;
}

export async function docToFigma(opts: DocToFigmaOptions): Promise<FigmaSpec> {
  const { formalDoc, config } = opts;
  const unmappedSections: string[] = [];
  const frames: FrameNode[] = [];

  let yCursor = 0;
  formalDoc.sections.forEach((sec, index) => {
    const height = sec.height ?? config.defaultSectionHeight;
    const mapping = config.componentLibrary[sec.section];
    const isPlaceholder = !mapping;
    if (isPlaceholder) unmappedSections.push(sec.section);

    const componentRef: ComponentRef = mapping
      ? { libraryKey: mapping.libraryKey, codeConnectKey: mapping.codeConnectKey, ...(mapping.nodeId ? { nodeId: mapping.nodeId } : {}) }
      : { libraryKey: 'placeholder', codeConnectKey: sec.section };

    frames.push({
      type: isPlaceholder ? 'placeholder' : 'componentInstance',
      name: `Section ${index} · ${sec.section} · ${sec.id}`,
      x: 0,
      y: yCursor,
      width: config.desktopWidth,
      height,
      componentRef,
      props: sec.props ?? {},
      meta: {
        sectionNumber: index,
        sectionId: sec.id,
        ...(isPlaceholder ? { tag: 'component-not-mapped' } : {})
      }
    });

    yCursor += height;
  });

  const totalHeight = frames.length === 0 ? 0 : (frames[frames.length - 1]!.y + frames[frames.length - 1]!.height);

  const spec: FigmaSpec = {
    pageName: formalDoc.name,
    width: config.desktopWidth,
    height: totalHeight,
    libraryUrls: config.libraryUrls,
    frames,
    meta: {
      generatedAt: new Date().toISOString(),
      pageId: formalDoc.id,
      schemaVersion: '1.0.0',
      checksum: computeChecksum(formalDoc)
    },
    unmappedSections,
    writeStatus: 'dry-run'
  };

  return spec;
}

/** SHA-256 over canonical JSON (sorted top-level keys). Mirrors Stolution shape. */
export function computeChecksum(value: unknown): string {
  const canonical = JSON.stringify(value, value && typeof value === 'object' ? Object.keys(value as object).sort() : undefined);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}
