/**
 * TypeScript projection of the canonical `RenderableDesign` shape from
 * `research/step5_design_ingest_spec_2026.md` §1 and the Atlas spec §7.
 *
 * This is the input contract for `buildDomIdMap`, `assignStableDomIds`,
 * and `diffDesigns`. Atlas's parent shell deserialises a
 * `RenderableDesign` from object storage and passes it into this
 * package; nothing here reads the filesystem or network at runtime
 * (the JSX adapter in `parse-jsx.ts` does, but only when invoked
 * explicitly — and even then only via ts-morph, no network).
 *
 * The full §1 shape is broader than what atlas-mapper consumes —
 * adapters may carry `sourceMetadata`, `rawSourceArtifacts`,
 * `ingestDiagnostics`, etc. We declare only the fields atlas-mapper
 * touches; everything else is permitted via optional pass-through
 * extensions so adapters can serialise a full §1 payload through
 * atlas-mapper without losing data.
 */

/** A node role tag, mirroring the step-5 §1.1 enum. */
export type NodeRole = 'page' | 'section' | 'widget' | 'story-host' | 'leaf' | 'shared-ref';

/** A node level tag, mirroring the Stream-B taxonomy enum. */
export type NodeLevel = 'page' | 'section' | 'widget' | 'leaf';

/**
 * The recursive `Node` shape — the unit of a `componentTree`.
 *
 * `domId` MAY be supplied by the adapter (preferred when adapters have
 * a stable source-derived ID — CD-ZIP via Babel transform, Figma via
 * node-ids). When omitted, atlas-mapper derives one deterministically
 * from the AST shape via the fingerprint algorithm.
 *
 * `attrs` is the verbatim props bag — `className`, `style`, `href`,
 * etc. Preserved into the emitted `DomIdEntry` so diff can detect
 * attribute deltas.
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
  attrs?: Record<string, unknown>;

  /** Resolved style after token lookup. */
  resolvedStyle?: Record<string, unknown>;

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
  provenance?: Record<string, unknown>;

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
  metadata?: Record<string, unknown>;
}

/** A shared-component declaration. */
export interface RenderableSharedComponent {
  id: string;
  domIdPrefix?: string;
  node: RenderableNode;
  usedByDomIds?: string[];
}

/** An interactivity-table entry. */
export interface RenderableInteractivity {
  domId: string;
  kind: string;
  target?: string;
  ariaLabel?: string;
  rolesFromSource?: string[];
}

/**
 * The canonical `RenderableDesign` — exactly what step-5 adapters emit
 * and what atlas-mapper consumes. Only the fields atlas-mapper actually
 * reads are required; everything else is optional + pass-through so
 * adapters can round-trip a full §1 payload without losing data.
 */
export interface RenderableDesign {
  designVersionId: string;
  source?: string;
  routes: RenderableRoute[];
  componentTrees: Record<string, RenderableComponentTree>;
  sharedComponents?: RenderableSharedComponent[];
  copy?: RenderableCopy[];
  assets?: RenderableAsset[];
  interactivity?: RenderableInteractivity[];
  designTokens?: RenderableDesignTokens;

  /** Adapter-provided extras — pass-through. */
  sourceMetadata?: Record<string, unknown>;
  site?: Record<string, unknown>;
  rawSourceArtifacts?: Record<string, unknown>;
  ingestDiagnostics?: Record<string, unknown>;
  tenantId?: string;
  businessProposalId?: string;
  uploadedAt?: string;
}
