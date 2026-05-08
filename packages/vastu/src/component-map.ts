/**
 * Component map — resolves section name → Figma library + nodeId.
 *
 * Ported from Stolution's @stolution/vastu-figma-bridge/src/component-map.ts
 * with parameterization: the mapping table comes from `config.componentLibrary`
 * (typed Record<string, ComponentMappingEntry>) instead of a hard-coded constant.
 *
 * Priority order:
 *  1. Known mappings (from config.componentLibrary) — L2 or L3
 *  2. Placeholder — section name is in the registry but has no Figma mapping yet
 */

import type { ComponentRef } from './types.js';
import type { ComponentMappingEntry } from './config.js';

export interface ComponentMapperOpts {
  /** Section name → component mapping table (from config.componentLibrary). */
  componentLibrary: Record<string, ComponentMappingEntry>;
}

/**
 * Resolves section names to Figma component references.
 * Delegates to the injected componentLibrary; no hardcoded mappings.
 */
export class ComponentMapper {
  constructor(private readonly componentLibrary: Record<string, ComponentMappingEntry>) {}

  /**
   * Look up a section name in the component library.
   * Returns a ComponentRef if found, or null if unmapped.
   */
  lookup(sectionName: string): ComponentRef | null {
    const entry = this.componentLibrary[sectionName];
    if (!entry) return null;

    const ref: ComponentRef = {
      libraryKey: entry.libraryKey,
      codeConnectKey: entry.codeConnectKey,
    };
    if (entry.nodeId !== undefined) {
      ref.nodeId = entry.nodeId;
    }
    return ref;
  }

  /**
   * Create a placeholder ComponentRef for an unmapped section.
   * The codeConnectKey is the section name itself, allowing UI/approval tools
   * to surface unmapped sections for operator review.
   */
  placeholderRef(sectionName: string): ComponentRef {
    return {
      libraryKey: 'placeholder',
      codeConnectKey: sectionName,
    };
  }
}
