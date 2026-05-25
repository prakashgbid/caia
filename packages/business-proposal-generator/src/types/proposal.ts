/**
 * Business-proposal core types.
 *
 * The `BusinessPlanV2` shape comes from `@caia/interviewer`. We mirror
 * the minimal subset Stage 5 needs here (no transitive runtime dep on
 * interviewer's full surface).
 */

import { z } from 'zod';

import { iaArtifactSetSchema } from './ia.js';

// ---------- BusinessPlanV2 (subset) ---------------------------------------

/** Loose shape — the orchestrator does not introspect every nested field. */
export const businessPlanV2LooseSchema = z
  .object({
    schemaVersion: z.string().default('2.0'),
    sections: z.record(z.unknown()).default({}),
    rubricScores: z
      .object({
        aggregateScore: z.number().min(0).max(100),
      })
      .passthrough(),
  })
  .passthrough();

export type BusinessPlanV2 = z.infer<typeof businessPlanV2LooseSchema>;

// ---------- Storage row shapes --------------------------------------------

export interface FormatsManifestEntry {
  url: string;
  hash: string;
  bytes?: number;
  contentType?: string;
}

export interface FormatsManifest {
  exec_summary?: { pdf?: FormatsManifestEntry; docx?: FormatsManifestEntry; md?: FormatsManifestEntry };
  full_proposal?: { pdf?: FormatsManifestEntry; docx?: FormatsManifestEntry; md?: FormatsManifestEntry };
  one_pager?: { pdf?: FormatsManifestEntry; docx?: FormatsManifestEntry; md?: FormatsManifestEntry };
}

export interface BusinessProposalRow {
  id: string;
  tenantProjectId: string;
  revisionNumber: number;
  businessPlanHash: string;
  execSummaryMd: string;
  fullProposalMd: string;
  onePagerMd: string;
  formatsManifest: FormatsManifest;
  docHost: 'notion' | 'gitbook' | 'confluence' | 'gdrive' | 'none' | null;
  docHostUrls: Record<string, string> | null;
  generatedAtIso: string;
  generatorRunId: string | null;
  status: 'draft' | 'reviewed' | 'approved' | 'archived';
}

export interface DesignAppPromptRow {
  id: string;
  businessProposalId: string;
  target: TargetName;
  promptText: string;
  promptMetadata: Readonly<Record<string, unknown>>;
  reviewerScore: number | null;
  reviewerFindings: Readonly<Record<string, unknown>> | null;
  reviewerBadge: 'ship' | 'caution' | null;
  generatedAtIso: string;
  generatorRunId: string | null;
  supersededBy: string | null;
}

export interface ProposalRevisionRow {
  id: string;
  tenantProjectId: string;
  revisionNumber: number;
  businessProposalId: string;
  parentRevisionId: string | null;
  reason: string | null;
  diffSummary: Readonly<Record<string, unknown>> | null;
  createdAtIso: string;
}

// ---------- Generator inputs / outputs ------------------------------------

export const TARGET_NAMES = [
  'claude_design',
  'figma',
  'v0',
  'lovable',
  'bolt',
  'builderio',
  'webflow',
] as const;

export type TargetName = (typeof TARGET_NAMES)[number];

export function isTargetName(value: unknown): value is TargetName {
  return typeof value === 'string' && (TARGET_NAMES as readonly string[]).includes(value);
}

export interface GenerateProposalInput {
  tenantProjectId: string;
  plan: BusinessPlanV2;
  ia: z.infer<typeof iaArtifactSetSchema>;
  designAppTarget?: TargetName;
  /** Free-form why-am-I-rerunning note from the operator. */
  revisionReason?: string;
}

export interface GenerationResult {
  revision: BusinessProposalRow;
  prompt: DesignAppPromptRow;
  proposalRevision: ProposalRevisionRow;
  cacheHit: boolean;
  reviewerBadge: 'ship' | 'caution';
  reviewerScore: number;
}

export const generateProposalInputSchema = z.object({
  tenantProjectId: z.string().uuid(),
  plan: businessPlanV2LooseSchema,
  ia: iaArtifactSetSchema,
  designAppTarget: z.enum(TARGET_NAMES).optional(),
  revisionReason: z.string().optional(),
});
