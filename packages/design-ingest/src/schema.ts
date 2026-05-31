/**
 * Zod schemas + source-name enum for `@caia/design-ingest`.
 *
 * The canonical TypeScript shape for `RenderableDesign` lives in
 * `@chiefaia/atlas-mapper` (the spec calls the property `props`; the
 * existing atlas-mapper code calls it `attrs` — atlas-mapper is
 * authoritative because every downstream consumer already reads
 * `attrs`). We re-export those types here so adapter authors have a
 * single import surface.
 *
 * Beyond the structural types, Step 5 §3 requires a runtime validation
 * layer so a misbehaving adapter (or a malicious upload that bypassed
 * `validate`) cannot scribble garbage into `ux_uploads.rendered_design`.
 * That's what the Zod schemas in this file are for — callers run
 * `RenderableDesignSchema.parse(value)` before persistence.
 */

import { z } from 'zod';

// Re-export the structural types so adapter authors only need one
// import. Adapters can also import directly from `@chiefaia/atlas-mapper`
// if they want — the two are interchangeable.
export type {
  NodeLevel,
  NodeRole,
  RenderableAsset,
  RenderableComponentTree,
  RenderableCopy,
  RenderableDesign,
  RenderableDesignTokens,
  RenderableInteractivity,
  RenderableNode,
  RenderableRoute,
  RenderableSharedComponent,
} from '@chiefaia/atlas-mapper';

// ---------------------------------------------------------------------------
// SourceName — the closed enum of adapters Step 5 supports.
// ---------------------------------------------------------------------------

export const SOURCE_NAMES = [
  'cd-zip',
  'claude-design',
  'figma-json',
  'v0',
  'lovable',
  'bolt',
  'builder-io',
  'webflow',
  'framer',
  'anima',
] as const;

export const SourceNameSchema = z.enum(SOURCE_NAMES);
export type SourceName = z.infer<typeof SourceNameSchema>;

// ---------------------------------------------------------------------------
// Node-role / level enums — mirror atlas-mapper's structural types so
// the runtime validator rejects out-of-vocabulary values.
// ---------------------------------------------------------------------------

export const NodeRoleSchema = z.enum([
  'page',
  'section',
  'widget',
  'story-host',
  'leaf',
  'shared-ref',
]);

export const NodeLevelSchema = z.enum(['page', 'section', 'widget', 'leaf']);

// ---------------------------------------------------------------------------
// Recursive Node schema.
//
// We declare it via `z.lazy` because `children` references the same
// shape recursively. The Zod docs warn that recursive schemas need
// an explicit annotation on the helper so TypeScript doesn't bail.
// ---------------------------------------------------------------------------

const PropBag = z.record(z.unknown());

const Bounds = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

/**
 * Zod-inferred recursive shape -- Zod's `.optional()` produces
 * `T | undefined`, which under `exactOptionalPropertyTypes: true` is
 * NOT assignable to `T?`. We declare the recursive interface with
 * explicit `| undefined` for every optional field so the lazy ref
 * round-trips through `ZodType<...>` cleanly.
 */
interface RenderableNodeShape {
  domId?: string | undefined;
  tag: string;
  role: z.infer<typeof NodeRoleSchema>;
  level?: z.infer<typeof NodeLevelSchema> | undefined;
  attrs?: Record<string, unknown> | undefined;
  resolvedStyle?: Record<string, unknown> | undefined;
  copyRefs?: string[] | undefined;
  assetRefs?: string[] | undefined;
  interactivityRefs?: string[] | undefined;
  sharedRef?: string | null | undefined;
  bounds?: { x: number; y: number; w: number; h: number } | undefined;
  provenance?: Record<string, unknown> | undefined;
  children?: RenderableNodeShape[] | undefined;
}

export const RenderableNodeSchema: z.ZodType<RenderableNodeShape> = z.lazy(() =>
  z.object({
    domId: z.string().min(1).optional(),
    tag: z.string().min(1),
    role: NodeRoleSchema,
    level: NodeLevelSchema.optional(),
    attrs: PropBag.optional(),
    resolvedStyle: PropBag.optional(),
    copyRefs: z.array(z.string()).optional(),
    assetRefs: z.array(z.string()).optional(),
    interactivityRefs: z.array(z.string()).optional(),
    sharedRef: z.string().nullable().optional(),
    bounds: Bounds.optional(),
    provenance: PropBag.optional(),
    children: z.array(RenderableNodeSchema).optional(),
  }),
);

// ---------------------------------------------------------------------------
// Top-level RenderableDesign schema.
//
// Mirrors `@chiefaia/atlas-mapper`'s `RenderableDesign` interface plus
// the Step 5 §1 pass-through fields (`sourceMetadata`, `site`,
// `rawSourceArtifacts`, `ingestDiagnostics`).
// ---------------------------------------------------------------------------

export const RenderableComponentTreeSchema = z.object({
  rootDomId: z.string().min(1).optional(),
  node: RenderableNodeSchema,
});

export const RenderableCopySchema = z.object({
  domId: z.string().min(1),
  text: z.string(),
  locale: z.string().optional(),
  richText: z.boolean().optional(),
});

export const RenderableAssetSchema = z.object({
  path: z.string().min(1),
  uploadedSourcePath: z.string().optional(),
  kind: z.string().optional(),
  alt: z.string().optional(),
  contentHash: z.string().optional(),
  byteSize: z.number().int().nonnegative().optional(),
  intrinsicSize: z.object({ w: z.number(), h: z.number() }).optional(),
  storageUrl: z.string().optional(),
  isPlaceholder: z.boolean().optional(),
});

export const RenderableDesignTokensSchema = z.object({
  colors: z.record(z.string()).optional(),
  fonts: z.record(z.string()).optional(),
  spacing: z.record(z.string()).optional(),
  radii: z.record(z.string()).optional(),
  shadows: z.record(z.string()).optional(),
  rawSource: z.string().optional(),
});

export const RenderableRouteSchema = z.object({
  path: z.string().min(1),
  title: z.string().optional(),
  componentTreeId: z.string().min(1),
  breakpoints: z.array(z.string()).optional(),
  metadata: PropBag.optional(),
});

export const RenderableSharedComponentSchema = z.object({
  id: z.string().min(1),
  domIdPrefix: z.string().optional(),
  node: RenderableNodeSchema,
  usedByDomIds: z.array(z.string()).optional(),
});

export const RenderableInteractivitySchema = z.object({
  domId: z.string().min(1),
  kind: z.string().min(1),
  target: z.string().optional(),
  ariaLabel: z.string().optional(),
  rolesFromSource: z.array(z.string()).optional(),
});

export const RenderableDesignSchema = z.object({
  designVersionId: z.string().min(1),
  source: SourceNameSchema.optional(),
  routes: z.array(RenderableRouteSchema),
  componentTrees: z.record(RenderableComponentTreeSchema),
  sharedComponents: z.array(RenderableSharedComponentSchema).optional(),
  copy: z.array(RenderableCopySchema).optional(),
  assets: z.array(RenderableAssetSchema).optional(),
  interactivity: z.array(RenderableInteractivitySchema).optional(),
  designTokens: RenderableDesignTokensSchema.optional(),

  // Pass-through extras — Step 5 §1.
  sourceMetadata: PropBag.optional(),
  site: PropBag.optional(),
  rawSourceArtifacts: PropBag.optional(),
  ingestDiagnostics: PropBag.optional(),
  tenantId: z.string().optional(),
  businessProposalId: z.string().optional(),
  uploadedAt: z.string().optional(),
});

// ---------------------------------------------------------------------------
// AdapterCapabilities + ValidationResult — Zod for completeness so a
// stub adapter that returns malformed values surfaces a clean error.
// ---------------------------------------------------------------------------

export const AdapterCapabilitiesSchema = z.object({
  supportsRefresh: z.boolean(),
  supportsLiveWebhook: z.boolean(),
  requiresCredential: z.boolean(),
  credentialKind: z
    .enum(['oauth', 'api-token', 'personal-access-token'])
    .optional(),
});

export const ValidationSeveritySchema = z.enum(['p0', 'p1', 'p2', 'p3']);

export const ValidationWarningSchema = z.object({
  code: z.string().min(1),
  severity: ValidationSeveritySchema,
  message: z.string().min(1),
});

export const ValidationErrorEntrySchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const ValidationResultSchema = z.object({
  ok: z.boolean(),
  warnings: z.array(ValidationWarningSchema),
  errors: z.array(ValidationErrorEntrySchema),
});

// ---------------------------------------------------------------------------
// Helper — defensive parse with rich error context.
// ---------------------------------------------------------------------------

/**
 * Validate a `RenderableDesign` blob. Throws a Zod error on failure.
 * Use this from the framework's persistence boundary (`Ingestor.ingest`
 * calls it on every adapter output).
 */
export function assertRenderableDesign(
  value: unknown,
): z.infer<typeof RenderableDesignSchema> {
  return RenderableDesignSchema.parse(value);
}
