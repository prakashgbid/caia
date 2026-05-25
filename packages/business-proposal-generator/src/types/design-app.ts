/**
 * DesignAppPromptOutput envelope. Per spec §2.3 — stable across all targets.
 */

import { z } from 'zod';

import { TARGET_NAMES, type TargetName } from './proposal.js';

export const designAppPromptFileSchema = z.object({
  name: z.string().min(1),
  content_b64: z.string(),
  mime_type: z.string().min(1),
});

export const designAppPromptMetadataSchema = z.object({
  palette: z.object({
    paper: z.string(),
    ink: z.string(),
    accent: z.string(),
  }),
  type_pairing: z.object({
    display: z.string(),
    body: z.string(),
    mono: z.string().optional(),
  }),
  accent_options: z.array(z.string()).default([]),
  layout_patterns: z.array(z.string()).default([]),
  reference_urls: z.array(z.string()).default([]),
  motion_preference: z.enum(['minimal', 'restrained', 'expressive']),
  platform_strategy: z.enum(['pwa-only', 'pwa-plus-platform-adaptive']).default('pwa-only'),
});

export const designAppPromptOutputSchema = z
  .object({
    target: z.enum(TARGET_NAMES),
    prompt_text: z.string().min(1),
    prompt_files: z.array(designAppPromptFileSchema).default([]),
    prompt_metadata: designAppPromptMetadataSchema,
    deep_link_url: z.string().url().optional(),
    instructions_for_customer: z.string().min(1),
  })
  .strict();

export type DesignAppPromptFile = z.infer<typeof designAppPromptFileSchema>;
export type DesignAppPromptMetadata = z.infer<typeof designAppPromptMetadataSchema>;
export type DesignAppPromptOutput = z.infer<typeof designAppPromptOutputSchema>;

export { TARGET_NAMES, type TargetName };
