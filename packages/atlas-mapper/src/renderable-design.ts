/**
 * Type projection of the canonical `RenderableDesign` shape from
 * research/step5_design_ingest_spec_2026.md §1.
 *
 * This is the input contract for `buildDomIdMap` and `diffDesigns`.
 * Atlas's parent shell deserialises a `RenderableDesign` from object
 * storage and passes it into this package; nothing here reads the
 * filesystem or network.
 *
 * The §1 shape is broader than what atlas-mapper actually needs —
 * adapters may carry `sourceMetadata`, `rawSourceArtifacts`,
 * `ingestDiagnostics`, etc. We declare only the fields atlas-mapper
 * touches, with everything else permitted via optional/any-record
 * extensions so adapters can pass full payloads without TS friction.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A node role tag, mirroring the step-5 §1.1 enum. */
export type NodeRole = 'page' | 'section' | 'widget' | 'story-host' | 'leaf' | 'shared-ref';

/** A node level tag, mirroring the Stream-B taxonomy enum. */
export type NodeLevel = 'page' | 'section' | 'widget' | 'leaf';

/**
 * The recursive `Node` shape — the unit of a `componentTree`.
 *
 * `domId` MAY be supplied by the adapter (preferred — adapters that have
 * a stable source-derived ID should set it). When omitted, atlas-mapper
 * derives one deterministically from the AST shape (`tag + role +
 * parent-path + sibling-position`). Either way the result is canonical.
 *
 * `attrs` is the verbatim props bag — `className`, `style`, `href`, etc.
 * It's preserved into the emitted `DomIdEntry` so downstream diff
 * comparisons can detect attribute changes.
 */
export interface RenderableNode {
  /**
   * Stable DOM-ID. Optional on input — atlas-mapper derives one when
   * absent. Adapters that already emit a stable ID (CD-ZIP via the
   * Babel transform; Figma via the node-id mapping) MUST set this.
   */
  domId?: string;

  /** HTML tag or component name, e.g. `section`, `<HomeHeroSlider>`. */
  tag: string;

  /** Role tag — §1.1 enum. */
  role: NodeRole;

  /** Level tag — Stream-B taxonomy. */
  level?: NodeLevel;

  /** Verbatim props bag. Adapters preserve the source attribute set. */
  attrs?: Record<string, any>;

  /** Resolved style after token lookup. */
  resolvedStyle?: Record<string, any>;

  /** FK references into the flat `copy[]` table. */
  copyRefs?: string[];

  /** FK references into the flat `assets[]` table. */
  assetRefs?: string[];

  /** FK references into the flat `interactivity[]` table. */
  interactivityRefs?: string[];

  /** Shared-component reference (e.g. `shared:monogram`). */
  sharedRef?: string | null;

  /** Optional bounds — adapters that screenshot at ingest time can set this. */
  bounds?: { x: number; y: number; w: number; h: number };

  /** Provenance for traceability — passed through verbatim. */
  provenance?: Record<string, any>;

  /** Children — recursive. */
  children?: RenderableNode[];
}

/** A component-tree entry keyed by id in `componentTrees`. */
export interface RenderableComponentTree {
  rootDomId?: string;
  node: RenderableNode;
}

/** A copy-table entry. */
export interface RenderableCopy {
  domId: string;
  text: string;
  locale?: string;
  richText?: boolean;
}

/** An asset-table entry. */
export interface RenderableAsset {
  path: string;
  uploadedSourcePath?: string;
  kind?: string;
  alt?: string;
  contentHash?: string;
  byteSize?: number;
  intrinsicSize?: { w: number; h: number };
  storageUrl?: string;
  isPlaceholder?: boolean;
}

/** Design tokens block. */
export interface RenderableDesignTokens {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  spacing?: Record<string, string>;
  radii?: Record<string, string>;
  shadows?: Record<string, string>;
  rawSource?: string;
}

/** A route entry referencing a component-tree id. */
export interface RenderableRoute {
  path: string;
  title?: string;
  componentTreeId: string;
  breakpoints?: string[];
  metadata?: Record<string, any>;
}

/**
 * The canonical `RenderableDesign` — exactly what step-5 adapters emit and
 * what atlas-mapper consumes. Only the fields atlas-mapper actually reads
 * are required; everything else is optional + pass-through so adapters can
 * round-trip a full §1 payload without losing data.
 */
export interface RenderableDesign {
  designVersionId: string;
  source?: string;
  routes: RenderableRoute[];
  componentTrees: Record<string, RenderableComponentTree>;
  sharedComponents?: Array<{
    id: string;
    domIdPrefix?: string;
    node: RenderableNode;
    usedByDomIds?: string[];
  }>;
  copy?: RenderableCopy[];
  assets?: RenderableAsset[];
  interactivity?: Array<{
    domId: string;
    kind: string;
    target?: string;
    ariaLabel?: string;
    rolesFromSource?: string[];
  }>;
  designTokens?: RenderableDesignTokens;

  /** Adapter-provided extras — pass-through. */
  sourceMetadata?: Record<string, any>;
  site?: Record<string, any>;
  rawSourceArtifacts?: Record<string, any>;
  ingestDiagnostics?: Record<string, any>;
  tenantId?: string;
  businessProposalId?: string;
  uploadedAt?: string;
}
