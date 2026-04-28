/**
 * Builder helpers — small utilities to construct partial tickets in a
 * structured way as the pipeline progresses (PO creates the skeleton, BA
 * fills sections, etc.) without having to remember the entire schema.
 */

import {
  TICKET_TEMPLATE_VERSION,
  TicketTemplateV1,
  COMPLEXITY_VALUES,
  NATURE_VALUES,
} from './schema';

export interface DraftTicketInput {
  rootPromptId: string;
  requirementId: string;
  parentEpic?: string;
  domainPrimary: string;
  domainAll: string[];
  nature: (typeof NATURE_VALUES)[number];
  complexity: (typeof COMPLEXITY_VALUES)[number];
  summary: string;
  inScope: string[];
  outOfScope?: string[];
  acceptanceCriteria: string[];
  verificationPlan: string[];
  upstream?: string[];
  downstream?: string[];
  files?: string[];
  poDecomposedAt?: number;
}

/**
 * Build a draft ticket payload from the minimum required inputs the PO
 * agent has after decomposition. Returns a fully-typed TicketTemplateV1
 * with empty `agentSections` ready for BA to enrich.
 */
export function buildDraftTicket(input: DraftTicketInput): TicketTemplateV1 {
  const now = Date.now();
  return {
    version: TICKET_TEMPLATE_VERSION,
    scope: {
      summary: input.summary,
      inScope: input.inScope,
      outOfScope: input.outOfScope ?? [],
    },
    context: {
      rootPromptId: input.rootPromptId,
      requirementId: input.requirementId,
      parentEpic: input.parentEpic,
      domainPrimary: input.domainPrimary,
      domainAll: input.domainAll,
      nature: input.nature,
      complexity: input.complexity,
    },
    acceptanceCriteria: input.acceptanceCriteria,
    verificationPlan: input.verificationPlan,
    dependencies: {
      upstream: input.upstream ?? [],
      downstream: input.downstream ?? [],
      files: input.files ?? [],
    },
    agentSections: {},
    metadata: {
      templateVersion: TICKET_TEMPLATE_VERSION,
      poDecomposedAt: input.poDecomposedAt ?? now,
      lastUpdatedAt: now,
    },
  };
}
