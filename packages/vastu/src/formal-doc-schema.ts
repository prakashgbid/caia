/**
 * @chiefaia/vastu — Zod schemas for FormalDoc, used to validate LLM output.
 *
 * Kept in a separate file from `types.ts` so the type-first contracts stay
 * clean (no Zod dependency in the public type surface) while we still get
 * runtime validation at the Stage A / LLM boundary.
 *
 * The schema mirrors the `FormalDoc` interface from `./types.ts`. If the
 * interface changes, update both. There's a TS-level structural check at
 * the bottom of this file that fails compilation if the two drift.
 */
'use strict';

import { z } from 'zod';
import type { FormalDoc, FormalDocSection } from './types.js';

export const FormalDocSectionSchema = z.object({
  id: z.string().min(1),
  section: z.string().min(1),
  intent: z.string().min(1),
  height: z.number().int().positive().optional(),
  props: z.record(z.string(), z.unknown()).optional()
});

export const FormalDocOriginSchema = z.enum([
  'heuristic',
  'llm',
  'hybrid',
  'hand-authored',
  'stub'
]);

export const FormalDocSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  audience: z.string().min(1),
  brandVoice: z.string().optional(),
  industry: z.string().optional(),
  primaryCtas: z.array(z.string()).optional(),
  sections: z.array(FormalDocSectionSchema).min(1),
  origin: FormalDocOriginSchema,
  metadata: z.record(z.string(), z.unknown()).optional()
});

/**
 * Lighter schema used for the second-pass retry. Only the structurally
 * required fields are enforced; everything else is patched in by the
 * caller from heuristic hints + config defaults.
 */
export const FormalDocMinimalSchema = z.object({
  sections: z
    .array(
      z.object({
        section: z.string().min(1),
        intent: z.string().min(1)
      })
    )
    .min(1)
});

export type FormalDocMinimal = z.infer<typeof FormalDocMinimalSchema>;

/* ─── Compile-time structural drift guard ─────────────────────────────── */
/* If `FormalDoc` (in types.ts) drifts away from `FormalDocSchema`, these
 * two `Equals` lines will fail to compile, alerting the developer to
 * realign the two surfaces. */
type _SchemaShape = z.infer<typeof FormalDocSchema>;
type _SectionShape = z.infer<typeof FormalDocSectionSchema>;
type _SchemaAssign = FormalDoc extends _SchemaShape ? true : never;
type _SectionAssign = FormalDocSection extends _SectionShape ? true : never;
const _schemaAssertion: _SchemaAssign = true;
const _sectionAssertion: _SectionAssign = true;
void _schemaAssertion;
void _sectionAssertion;
