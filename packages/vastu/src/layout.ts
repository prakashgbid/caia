/**
 * Layout — deterministic y-offset stacking for section frames.
 *
 * Ported from Stolution's @stolution/vastu-figma-bridge/src/layout.ts
 * with parameterization for desktopWidth + defaultSectionHeight from VastuConfig.
 */

import type { FrameNode, ComponentRef } from './types.js';

export interface SectionLayoutInput {
  sectionNumber: number;
  sectionId: string;
  sectionName: string;
  height: number;
  props: Record<string, unknown>;
  componentRef: ComponentRef;
  isPlaceholder?: boolean;
}

/**
 * Stack frames vertically with cumulative y-offsets.
 * Pure function: deterministic output for identical inputs.
 */
export function stackFrames(
  sections: SectionLayoutInput[],
  desktopWidth: number
): FrameNode[] {
  let yCursor = 0;
  const frames: FrameNode[] = [];

  for (const sec of sections) {
    const meta: FrameNode['meta'] = {
      sectionNumber: sec.sectionNumber,
      sectionId: sec.sectionId
    };
    if (sec.isPlaceholder) {
      meta.tag = 'component-not-mapped';
    }
    frames.push({
      type: sec.isPlaceholder ? 'placeholder' : 'componentInstance',
      name: `Section ${sec.sectionNumber} · ${sec.sectionName} · ${sec.sectionId}`,
      x: 0,
      y: yCursor,
      width: desktopWidth,
      height: sec.height,
      componentRef: sec.componentRef,
      props: sec.props,
      meta
    });
    yCursor += sec.height;
  }

  return frames;
}

/**
 * Compute total page height from stacked frames.
 */
export function totalHeight(frames: FrameNode[]): number {
  if (frames.length === 0) return 0;
  const last = frames[frames.length - 1]!;
  return last.y + last.height;
}
