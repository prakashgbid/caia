/**
 * Information Architect (IA) artifact types.
 *
 * MIRROR — replace with `import from '@caia/info-architect'` when the
 * upstream package merges. The shapes here are the minimal subset that
 * Stage 5 consumes; treat them as the contract the upstream must honor.
 *
 * See `research/info_architect_agent_spec_2026.md` for the canonical
 * spec.
 */

import { z } from 'zod';

// ---------- pages-catalogue.json ------------------------------------------

export const iaPageSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  primary_purpose: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  template: z.string().optional(),
});

export const iaPagesCatalogueSchema = z.object({
  schema_version: z.string().default('1.0'),
  pages: z.array(iaPageSchema).min(1),
  /** Optional sitemap metadata. */
  metadata: z.record(z.unknown()).optional(),
});

export type IaPage = z.infer<typeof iaPageSchema>;
export type IaPagesCatalogue = z.infer<typeof iaPagesCatalogueSchema>;

// ---------- design-system.json --------------------------------------------

export const iaPaletteSchema = z.object({
  paper: z.string(),
  ink: z.string(),
  accent: z.string(),
  /** Optional secondary swatches. */
  swatches: z.record(z.string()).optional(),
});

export const iaTypePairingSchema = z.object({
  display: z.string(),
  body: z.string(),
  mono: z.string().optional(),
});

export const iaDesignSystemSchema = z.object({
  schema_version: z.string().default('1.0'),
  palette: iaPaletteSchema,
  type_pairing: iaTypePairingSchema,
  /** Free-form motion preference: minimal | restrained | expressive. */
  motion_preference: z
    .enum(['minimal', 'restrained', 'expressive'])
    .default('restrained'),
  /** Free-form layout patterns. */
  layout_patterns: z.array(z.string()).default([]),
  reference_urls: z.array(z.string()).default([]),
});

export type IaDesignSystem = z.infer<typeof iaDesignSystemSchema>;

// ---------- components-library.json ---------------------------------------

export const iaComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().optional(),
  /** Optional prop summary the design tool can echo. */
  props: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional(),
});

export const iaComponentsLibrarySchema = z.object({
  schema_version: z.string().default('1.0'),
  components: z.array(iaComponentSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export type IaComponent = z.infer<typeof iaComponentSchema>;
export type IaComponentsLibrary = z.infer<typeof iaComponentsLibrarySchema>;

// ---------- Bundled IA artifact set ---------------------------------------

export const iaArtifactSetSchema = z.object({
  pages: iaPagesCatalogueSchema,
  designSystem: iaDesignSystemSchema,
  components: iaComponentsLibrarySchema,
});

export type IaArtifactSet = z.infer<typeof iaArtifactSetSchema>;
