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
  PROJECT_SLUGS,
  LIFECYCLE_VALUES,
  RISK_VALUES,
  EFFORT_VALUES,
  PRIORITY_VALUES,
  QUALITY_TAGS,
  TECH_SUB_DOMAINS,
  type InputDependency,
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
  taxonomy?: {
    project?: (typeof PROJECT_SLUGS)[number];
    businessSubDomains?: string[];
    techSubDomains?: {
      primary: (typeof TECH_SUB_DOMAINS)[number];
      all: ReadonlyArray<(typeof TECH_SUB_DOMAINS)[number]>;
    };
    lifecycle?: (typeof LIFECYCLE_VALUES)[number];
    qualityTags?: ReadonlyArray<(typeof QUALITY_TAGS)[number]>;
    risk?: (typeof RISK_VALUES)[number];
    effort?: (typeof EFFORT_VALUES)[number];
    priorityBucket?: (typeof PRIORITY_VALUES)[number];
    blockedBy?: string[];
    softDependsOn?: string[];
    conflictsWith?: string[];
  };
  claims?: {
    files?: string[];
    schemas?: string[];
    apiRoutes?: string[];
    domains?: string[];
  };
  /**
   * 0025 — declarative input dependencies. PO seeds with capability-kind
   * entries from the decomposer; EA / BA refine `kind` and fill in
   * `satisfiedBy` once a producing story is identified.
   */
  inputDependencies?: InputDependency[];
}

export function buildDraftTicket(input: DraftTicketInput): TicketTemplateV1 {
  const now = Date.now();
  const draft: TicketTemplateV1 = {
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
    inputDependencies: input.inputDependencies ?? [],
    agentSections: {},
    testCases: [],
    metadata: {
      templateVersion: TICKET_TEMPLATE_VERSION,
      poDecomposedAt: input.poDecomposedAt ?? now,
      lastUpdatedAt: now,
    },
  };

  if (input.taxonomy) {
    draft.taxonomy = {
      project: input.taxonomy.project,
      businessSubDomains: input.taxonomy.businessSubDomains ?? [],
      techSubDomains: input.taxonomy.techSubDomains
        ? {
            primary: input.taxonomy.techSubDomains.primary,
            all: [...input.taxonomy.techSubDomains.all],
          }
        : undefined,
      lifecycle: input.taxonomy.lifecycle,
      qualityTags: input.taxonomy.qualityTags
        ? [...input.taxonomy.qualityTags]
        : [],
      risk: input.taxonomy.risk,
      effort: input.taxonomy.effort,
      priorityBucket: input.taxonomy.priorityBucket,
      blockedBy: input.taxonomy.blockedBy ?? [],
      softDependsOn: input.taxonomy.softDependsOn ?? [],
      conflictsWith: input.taxonomy.conflictsWith ?? [],
    };
  }

  if (input.claims) {
    draft.claims = {
      files: input.claims.files ?? [],
      schemas: input.claims.schemas ?? [],
      apiRoutes: input.claims.apiRoutes ?? [],
      domains: input.claims.domains ?? [],
    };
  }

  return draft;
}
