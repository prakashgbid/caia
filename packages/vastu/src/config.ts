/**
 * @chiefaia/vastu — configuration schema + CAIA defaults.
 *
 * Per Option E (`agent_architecture_shape_2026-05-06.md`), every CAIA-specific
 * value (brand, palette, component library, target template) is a constructor
 * parameter with a CAIA default. Tests inject fixture configs; production wires
 * `defaultCaiaVastuConfig`.
 */

import { z } from 'zod';

export const BrandVoiceSchema = z.object({
  /** Tone descriptor (e.g. "professional, concise"). */
  tone: z.string(),
  /** Audience descriptor (e.g. "card-game players in regulated markets"). */
  audience: z.string(),
  /** Optional persona to write copy as. */
  persona: z.string().optional()
});
export type BrandVoice = z.infer<typeof BrandVoiceSchema>;

export const PaletteSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  background: z.string(),
  surface: z.string(),
  textPrimary: z.string(),
  textSecondary: z.string()
});
export type Palette = z.infer<typeof PaletteSchema>;

export const LibraryUrlsConfigSchema = z.object({
  basic: z.string(),
  business: z.string(),
  blueprints: z.string()
});
export type LibraryUrlsConfig = z.infer<typeof LibraryUrlsConfigSchema>;

export const ComponentMappingEntrySchema = z.object({
  libraryKey: z.enum(['L2', 'L3']),
  codeConnectKey: z.string(),
  nodeId: z.string().optional()
});
export type ComponentMappingEntry = z.infer<typeof ComponentMappingEntrySchema>;

export const VastuConfigSchema = z.object({
  /** Brand voice (overridable per pipeline run). */
  brandVoice: BrandVoiceSchema,
  /** Brand palette. */
  palette: PaletteSchema,
  /** Default content tone for missing copy (short marketing prose). */
  contentTone: z.string(),
  /** Figma library URLs. CAIA default uses placeholders until Phase 3 wires real keys. */
  libraryUrls: LibraryUrlsConfigSchema,
  /** Section-name → Figma component mapping (CAIA section catalogue). */
  componentLibrary: z.record(z.string(), ComponentMappingEntrySchema),
  /** Default desktop section height (px) when the formal doc omits it. */
  defaultSectionHeight: z.number().int().positive(),
  /** Desktop canvas width. */
  desktopWidth: z.number().int().positive(),
  /** Path of the scaffold target (relative to repo root). Stage C writes here. */
  scaffoldTargetTemplate: z.string(),
  /** Output directory for Stage B JSON payloads (relative to repo root). */
  payloadOutDir: z.string(),
  /** Optional approvals.json path. If present, Stage B verifies checksums against it. */
  approvalsPath: z.string().optional(),
  /** Whether MCP-driven Figma writes are allowed at all. CAIA default: false until ops opens it. */
  allowFigmaWrite: z.boolean()
});

export type VastuConfig = z.infer<typeof VastuConfigSchema>;

/**
 * CAIA-bonded default config. Bonds the website-factory pipeline:
 *
 * - Brand voice + palette: CAIA flagship marketing tone (overridable per site).
 * - Library URLs: placeholders (`FIGMA_*_PLACEHOLDER`) — Phase 3 swaps these for the
 *   real CAIA library keys once the operator has set up L1-L4 in Figma.
 * - Component library: empty in Phase 1 — section catalogue lands in Phase 4.
 * - Scaffold target: `templates/site/` — the canonical CAIA site template.
 * - allowFigmaWrite: false — Phase 1 is dry-run only. Flip to true when ops is ready.
 */
export const defaultCaiaVastuConfig: VastuConfig = {
  brandVoice: {
    tone: 'professional, concise, optimistic',
    audience: 'card-game players in regulated markets',
    persona: 'CAIA platform marketing'
  },
  palette: {
    primary: '#6d28d9',
    secondary: '#0ea5e9',
    background: '#0b0d12',
    surface: '#161922',
    textPrimary: '#f8fafc',
    textSecondary: '#cbd5e1'
  },
  contentTone: 'short, scannable marketing prose with action verbs and concrete claims',
  libraryUrls: {
    basic: 'https://www.figma.com/design/FIGMA_BASIC_PLACEHOLDER',
    business: 'https://www.figma.com/design/FIGMA_BUSINESS_PLACEHOLDER',
    blueprints: 'https://www.figma.com/design/FIGMA_BLUEPRINTS_PLACEHOLDER'
  },
  componentLibrary: {},
  defaultSectionHeight: 320,
  desktopWidth: 1440,
  scaffoldTargetTemplate: 'templates/site',
  payloadOutDir: '.vastu-out',
  allowFigmaWrite: false
};

/**
 * Parse a partial config and merge with the CAIA default.
 * Useful for per-site overrides while preserving the rest of the defaults.
 */
export function buildVastuConfig(overrides: Partial<VastuConfig> = {}): VastuConfig {
  const merged: VastuConfig = {
    ...defaultCaiaVastuConfig,
    ...overrides,
    brandVoice: { ...defaultCaiaVastuConfig.brandVoice, ...(overrides.brandVoice ?? {}) },
    palette: { ...defaultCaiaVastuConfig.palette, ...(overrides.palette ?? {}) },
    libraryUrls: { ...defaultCaiaVastuConfig.libraryUrls, ...(overrides.libraryUrls ?? {}) },
    componentLibrary: { ...defaultCaiaVastuConfig.componentLibrary, ...(overrides.componentLibrary ?? {}) }
  };
  return VastuConfigSchema.parse(merged);
}
