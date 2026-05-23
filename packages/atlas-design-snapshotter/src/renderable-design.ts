/**
 * Vendored `RenderableDesign` type contract.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §1 + §1.1.
 *
 * This file inlines the type contract every CAIA design adapter emits.
 * In the long run this lives in `@chiefaia/atlas-mapper`, but that
 * package was not yet on `develop` at the time this snapshotter merged,
 * and the snapshotter must build on a clean workspace. When
 * `@chiefaia/atlas-mapper` lands, this file can be replaced with a
 * re-export.
 *
 * Only the fields the snapshotter actually touches are required; every
 * other Step 5 §1 field is optional + pass-through so an adapter can
 * round-trip a full payload through `captureSnapshot` without losing
 * data.
 */

export type NodeRole = 'page' | 'section' | 'widget' | 'story-host' | 'leaf' | 'shared-ref';
export type NodeLevel = 'page' | 'section' | 'widget' | 'leaf';

export interface RenderableNode {
  domId?: string;
  tag: string;
  role: NodeRole;
  level?: NodeLevel;
  attrs?: Record<string, unknown>;
  resolvedStyle?: Record<string, unknown>;
  copyRefs?: string[];
  assetRefs?: string[];
  interactivityRefs?: string[];
  sharedRef?: string | null;
  bounds?: { x: number; y: number; w: number; h: number };
  provenance?: Record<string, unknown>;
  children?: RenderableNode[];
}

export interface RenderableComponentTree {
  rootDomId?: string;
  node: RenderableNode;
}

export interface RenderableCopy {
  domId: string;
  text: string;
  locale?: string;
  richText?: boolean;
}

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

export interface RenderableDesignTokens {
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  spacing?: Record<string, string>;
  radii?: Record<string, string>;
  shadows?: Record<string, string>;
  rawSource?: string;
}

export interface RenderableRoute {
  path: string;
  title?: string;
  componentTreeId: string;
  breakpoints?: string[];
  metadata?: Record<string, unknown>;
}

export interface RenderableSharedComponent {
  id: string;
  domIdPrefix?: string;
  node: RenderableNode;
  usedByDomIds?: string[];
}

export interface RenderableInteractivity {
  domId: string;
  kind: string;
  target?: string;
  ariaLabel?: string;
  rolesFromSource?: string[];
}

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

  sourceMetadata?: Record<string, unknown>;
  site?: Record<string, unknown>;
  rawSourceArtifacts?: Record<string, unknown>;
  ingestDiagnostics?: Record<string, unknown>;
  tenantId?: string;
  businessProposalId?: string;
  uploadedAt?: string;
}
