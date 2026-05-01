// schemas.ts for skills-registry
import { z } from 'zod';

export const SkillIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, { message: 'invalid skill id' });

export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/, { message: 'invalid semver' });

export const CapabilitySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9._:-]*$/, { message: 'invalid capability' });

export const TagSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, { message: 'invalid tag' });

export const CostClassSchema = z.enum(['free', 'cheap', 'standard', 'premium']);
export type CostClass = z.infer<typeof CostClassSchema>;

// ─── manifest variants ───────────────────────────────────────────────

const ManifestBase = z.object({
  id: SkillIdSchema,
  version: SemverSchema,
  description: z.string().min(1).max(512),
  capabilities: z.array(CapabilitySchema).min(1),
  tags: z.array(TagSchema).default([]),
  costClass: CostClassSchema.default('standard'),
  deprecated: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const AgentManifestSchema = ManifestBase.extend({
  kind: z.literal('agent'),
  runnerId: z.string().min(1),
});
export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export const ToolManifestSchema = ManifestBase.extend({
  kind: z.literal('tool'),
  transport: z.enum(['mcp', 'http', 'cli', 'function']),
  endpoint: z.string().min(1),
});
export type ToolManifest = z.infer<typeof ToolManifestSchema>;

export const JudgeManifestSchema = ManifestBase.extend({
  kind: z.literal('judge'),
  scoreRange: z
    .object({ min: z.number(), max: z.number() })
    .refine((r) => r.min < r.max, { message: 'min must be < max' }),
});
export type JudgeManifest = z.infer<typeof JudgeManifestSchema>;

export const SkillManifestSchema = z.discriminatedUnion('kind', [
  AgentManifestSchema,
  ToolManifestSchema,
  JudgeManifestSchema,
]);
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

// ─── query schemas ───────────────────────────────────────────────────

export const SkillQuerySchema = z
  .object({
    capability: CapabilitySchema.optional(),
    capabilities: z.array(CapabilitySchema).optional(),
    capabilitiesMatch: z.enum(['any', 'all']).default('any'),
    kind: z.enum(['agent', 'tool', 'judge']).optional(),
    tag: TagSchema.optional(),
    tags: z.array(TagSchema).optional(),
    tagsMatch: z.enum(['any', 'all']).default('any'),
    costClass: CostClassSchema.optional(),
    maxCostClass: CostClassSchema.optional(),
    includeDeprecated: z.boolean().default(false),
  })
  .strict();
export type SkillQuery = z.infer<typeof SkillQuerySchema>;
