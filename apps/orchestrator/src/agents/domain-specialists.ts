/**
 * Domain Specialists (EA Multi-Domain Decomposition PR 3 / EA-MESH-003).
 *
 * Stage 2 of the mesh pipeline (after domain-triage.ts). One specialist per
 * macro-domain: each one queries the AKG (architecture-registry) for
 * relevant artifacts within its slice, then asks a local LLM (via
 * @chiefaia/local-llm-router with forceLocal:true) to synthesize an
 * ArchitecturalInstructionV2 — including existingArtifactReferences[],
 * newArtifactSpecs[], integrationPoints[], risks[], testHooks[],
 * crossCuttingConcerns[].
 *
 * Each specialist degrades gracefully:
 * - AKG empty / unbootstrapped → fall back to a synthesized "create" instruction
 * - LLM call fails / returns non-JSON → fall back to a deterministic instruction
 *   built from the AKG hits alone
 * - Always returns at least one valid V2 instruction (Zod-parsed)
 *
 * Public API:
 *   runUiSpecialist(...)
 *   runBackendSpecialist(...)
 *   runDataSpecialist(...)
 *   runPlatformSpecialist(...)
 *   runQualitySecuritySpecialist(...)
 *   runIntegrationsSpecialist(...)
 *   runSpecialist(macroDomain, ...) — generic dispatch
 *
 * The DomainSpecialistMesh (PR 4) drives these in parallel via Promise.all.
 */

import type Database from 'better-sqlite3';
import {
  ArchitecturalInstructionV2Schema,
  type ArchitecturalInstructionV2,
  type ArtifactKind as TicketArtifactKind,
  type ArtifactRole,
  type CrossCuttingConcern,
  type RiskSeverity,
  type TestHookKind,
  type TechSubDomain,
} from '@chiefaia/ticket-template';
import {
  findUIArtifacts,
  findBackendArtifacts,
  findDBArtifacts,
  findIntegrationArtifacts,
  findAcrossDomains,
  type ArchSearchHit,
  type ArchSearchResult,
  type ArchSearchOpts,
  type EmbeddingClient,
} from '@chiefaia/architecture-registry';
import { route } from '@chiefaia/local-llm-router';
import type { TicketBundle } from '../api/ticket-bundle';
import type { MacroDomain } from './domain-triage';

// ─── Per-domain configuration ──────────────────────────────────────────────────

type SearchFn = (
  query: string,
  opts: ArchSearchOpts,
  deps: { db: Database.Database; embedder: EmbeddingClient },
) => Promise<ArchSearchResult>;

interface DomainConfig {
  /** AKG search function for this domain. */
  searchFn: SearchFn;
  /** Tech sub-domain to record on the V2 instruction. */
  primaryTechSubDomain: TechSubDomain;
  /** Override AKG `techSubDomains` filter — undefined = use AKG defaults. */
  techSubDomainsFilter?: readonly TechSubDomain[];
  /** Default V2 ARTIFACT_KIND when synthesizing newArtifactSpecs. */
  defaultArtifactKind: TicketArtifactKind;
  /** Default cross-cutting concerns this domain typically owns. */
  defaultConcerns: readonly CrossCuttingConcern[];
  /** Default test-hook kind for the domain's primary deliverable. */
  primaryTestHookKind: TestHookKind;
  /** Human-readable label for prompt + summary text. */
  label: string;
}

const DOMAIN_CONFIG: Record<MacroDomain, DomainConfig> = {
  ui: {
    searchFn: findUIArtifacts,
    primaryTechSubDomain: 'frontend',
    defaultArtifactKind: 'component',
    defaultConcerns: ['xss', 'a11y', 'i18n'],
    primaryTestHookKind: 'a11y',
    label: 'UI / Frontend',
  },
  backend: {
    searchFn: findBackendArtifacts,
    primaryTechSubDomain: 'backend',
    defaultArtifactKind: 'service',
    defaultConcerns: ['auth', 'authz', 'error_handling', 'observability_log'],
    primaryTestHookKind: 'integration',
    label: 'Backend / Services',
  },
  data: {
    searchFn: findDBArtifacts,
    primaryTechSubDomain: 'database',
    defaultArtifactKind: 'schema',
    defaultConcerns: ['pii', 'audit_log'],
    primaryTestHookKind: 'integration',
    label: 'Data / Storage',
  },
  platform: {
    searchFn: findIntegrationArtifacts,
    primaryTechSubDomain: 'observability',
    techSubDomainsFilter: [
      'observability',
      'monitoring-alerting',
      'infra',
      'ci-cd',
      'cron-scheduling',
      'secrets-management',
      'dependency-management',
    ],
    defaultArtifactKind: 'config',
    defaultConcerns: ['observability_log', 'observability_metric', 'observability_trace'],
    primaryTestHookKind: 'integration',
    label: 'Platform / Infra',
  },
  'quality-security': {
    searchFn: findAcrossDomains,
    primaryTechSubDomain: 'security',
    techSubDomainsFilter: ['testing', 'security', 'performance', 'compliance'],
    defaultArtifactKind: 'middleware',
    defaultConcerns: ['authz', 'csrf', 'xss', 'sqli', 'rate_limit'],
    primaryTestHookKind: 'security',
    label: 'Quality / Security',
  },
  integrations: {
    searchFn: findIntegrationArtifacts,
    primaryTechSubDomain: 'crm',
    techSubDomainsFilter: ['crm', 'cms', 'search', 'payments', 'email', 'ml-ai'],
    defaultArtifactKind: 'integration',
    defaultConcerns: ['retry', 'idempotency', 'rate_limit', 'error_handling'],
    primaryTestHookKind: 'contract',
    label: 'Integrations',
  },
};

// ─── Thresholds ─────────────────────────────────────────────────────────────

/** Score floor at which we recommend `reuse` over `enhance`. */
export const SPECIALIST_REUSE_THRESHOLD = 0.85;
/** Score floor at which we recommend `enhance` over `create`. */
export const SPECIALIST_ENHANCE_THRESHOLD = 0.65;
/** Default top-K AKG hits to retrieve per specialist. */
export const SPECIALIST_DEFAULT_TOP_K = 5;

// ─── Public API ─────────────────────────────────────────────────────────────

export interface SpecialistDeps {
  db: Database.Database;
  embedder: EmbeddingClient;
}

export interface SpecialistOpts {
  /** Top-K AKG hits to retrieve. Default 5. */
  topK?: number;
  /** Skip the LLM refinement pass (deterministic-only). Useful for tests. */
  skipLlm?: boolean;
  /** Force local LLM (default true — specialists are local-first). */
  forceLocal?: boolean;
  /** Override task-type label sent to the router (defaults to `domain-specialist-<domain>`). */
  routerTaskType?: string;
}

export interface SpecialistResult {
  domain: MacroDomain;
  instructions: ArchitecturalInstructionV2[];
  /** Number of AKG hits considered. */
  akgHits: number;
  /** Whether the LLM pass succeeded (false → fell back to deterministic). */
  llmUsed: boolean;
  /** Wall-clock duration in ms. */
  durationMs: number;
}

/**
 * Run a single specialist for the given macro-domain. Returns at least one
 * V2 instruction; on errors the result still contains a synthesized
 * fallback instruction so callers always get a populated array.
 */
export async function runSpecialist(
  domain: MacroDomain,
  bundle: TicketBundle,
  deps: SpecialistDeps,
  opts: SpecialistOpts = {},
): Promise<SpecialistResult> {
  const t0 = Date.now();
  const config = DOMAIN_CONFIG[domain];
  const topK = opts.topK ?? SPECIALIST_DEFAULT_TOP_K;
  const skipLlm = opts.skipLlm === true;
  const forceLocal = opts.forceLocal !== false; // default true
  const routerTaskType =
    opts.routerTaskType ?? `domain-specialist-${domain}`;

  const queryText = buildQueryText(bundle);

  // Stage 2a: AKG retrieval (bounded latency).
  let akgResult: ArchSearchResult | null = null;
  try {
    const searchOpts: ArchSearchOpts = { topK, minScore: 0 };
    if (config.techSubDomainsFilter) {
      searchOpts.techSubDomains = config.techSubDomainsFilter;
    }
    akgResult = await config.searchFn(queryText, searchOpts, deps);
  } catch (err) {
    // AKG empty / unbootstrapped — swallow + fall back below.
    void err;
    akgResult = null;
  }

  const hits: ArchSearchHit[] = akgResult?.hits ?? [];

  // Stage 2b: LLM synthesis (optional, refines the deterministic baseline).
  let llmInstructions: ArchitecturalInstructionV2[] = [];
  let llmUsed = false;
  if (!skipLlm) {
    try {
      const prompt = buildSpecialistPrompt(domain, bundle, hits, config);
      const response = await route(routerTaskType, prompt, { forceLocal });
      const parsed = tryParseLlmInstructions(response.response, domain, config);
      if (parsed.length > 0) {
        llmInstructions = parsed;
        llmUsed = true;
      }
    } catch (err) {
      // Local model unavailable / timed-out / non-JSON — fall back silently.
      void err;
    }
  }

  const instructions =
    llmInstructions.length > 0
      ? llmInstructions
      : [synthesizeBaseline(domain, bundle, hits, config)];

  return {
    domain,
    instructions,
    akgHits: hits.length,
    llmUsed,
    durationMs: Date.now() - t0,
  };
}

export const runUiSpecialist = (
  bundle: TicketBundle,
  deps: SpecialistDeps,
  opts?: SpecialistOpts,
) => runSpecialist('ui', bundle, deps, opts);

export const runBackendSpecialist = (
  bundle: TicketBundle,
  deps: SpecialistDeps,
  opts?: SpecialistOpts,
) => runSpecialist('backend', bundle, deps, opts);

export const runDataSpecialist = (
  bundle: TicketBundle,
  deps: SpecialistDeps,
  opts?: SpecialistOpts,
) => runSpecialist('data', bundle, deps, opts);

export const runPlatformSpecialist = (
  bundle: TicketBundle,
  deps: SpecialistDeps,
  opts?: SpecialistOpts,
) => runSpecialist('platform', bundle, deps, opts);

export const runQualitySecuritySpecialist = (
  bundle: TicketBundle,
  deps: SpecialistDeps,
  opts?: SpecialistOpts,
) => runSpecialist('quality-security', bundle, deps, opts);

export const runIntegrationsSpecialist = (
  bundle: TicketBundle,
  deps: SpecialistDeps,
  opts?: SpecialistOpts,
) => runSpecialist('integrations', bundle, deps, opts);

// ─── Internals ─────────────────────────────────────────────────────────────

function buildQueryText(bundle: TicketBundle): string {
  const title = bundle.story.title ?? '';
  const description = bundle.story.description ?? '';
  return [title, description].filter(Boolean).join('\n').trim();
}

function buildSpecialistPrompt(
  domain: MacroDomain,
  bundle: TicketBundle,
  hits: ArchSearchHit[],
  config: DomainConfig,
): string {
  const title = bundle.story.title ?? '(untitled)';
  const description = bundle.story.description ?? '';
  const hitLines = hits.length === 0
    ? '(no AKG matches found for this domain — propose new artifacts)'
    : hits
        .slice(0, 5)
        .map((h, i) => {
          const score = Math.max(h.scoreDense, h.scoreSparse).toFixed(3);
          return `${i + 1}. [${h.row.kind}] ${h.row.name} (id=${h.row.id}, score=${score})\n   ${h.row.description ?? ''}`;
        })
        .join('\n');

  return `You are the ${config.label} specialist on a software architecture team.

Ticket title: ${title}
Ticket description: ${description}

AKG (architecture knowledge graph) hits for this domain:
${hitLines}

Produce ONE JSON object describing the architectural instruction for THIS domain only.
Return STRICT JSON with NO prose, NO markdown fences. Schema:

{
  "summary": string (max 500 chars, one-sentence directive),
  "details": string (max 4000 chars, multi-line rationale + plan),
  "action": "reuse" | "enhance" | "create" | "no_op",
  "existingArtifactReferences": [
    { "artifactId": "<arch_id from AKG hit>", "role": "use_as_is" | "compose_with" | "replace" | "follow_pattern", "note": string }
  ],
  "newArtifactSpecs": [
    { "proposedKind": "${config.defaultArtifactKind}", "proposedName": string, "proposedPath": string, "proposedSignature": string }
  ],
  "risks": [
    { "severity": "low" | "medium" | "high" | "critical", "summary": string, "mitigation": string }
  ],
  "testHooks": [
    { "kind": "${config.primaryTestHookKind}" | "unit" | "integration" | "e2e", "target": string, "rationale": string }
  ],
  "crossCuttingConcerns": ["auth" | "authz" | "audit_log" | ...],
  "confidence": number between 0 and 1
}

Choose action="reuse" only if a hit scores ≥ ${SPECIALIST_REUSE_THRESHOLD}.
Choose action="enhance" if the closest hit scores ≥ ${SPECIALIST_ENHANCE_THRESHOLD} but < ${SPECIALIST_REUSE_THRESHOLD}.
Otherwise action="create".
JSON only.`;
}

function tryParseLlmInstructions(
  raw: string,
  domain: MacroDomain,
  config: DomainConfig,
): ArchitecturalInstructionV2[] {
  // Local models sometimes wrap JSON in ```json fences — strip them.
  const cleaned = stripCodeFences(raw).trim();
  if (!cleaned) return [];

  // Find the first { ... } in the response — robust against leading prose.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  const jsonText = cleaned.slice(start, end + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return [];
  }

  if (!obj || typeof obj !== 'object') return [];
  const candidate = obj as Record<string, unknown>;

  // Apply defaults + map onto V2 schema with deterministic id + tech sub-domain.
  const id = `arch_inst_${domain}_${Date.now().toString(36)}`;

  // Coerce the action field to one of the allowed enum members.
  const rawAction = typeof candidate.action === 'string' ? candidate.action : 'create';
  const allowedActions = ['reuse', 'enhance', 'create', 'no_op'] as const;
  const action: (typeof allowedActions)[number] = (allowedActions as readonly string[]).includes(
    rawAction,
  )
    ? (rawAction as (typeof allowedActions)[number])
    : 'create';

  const v2Object = {
    id,
    techSubDomain: config.primaryTechSubDomain,
    action,
    summary:
      typeof candidate.summary === 'string' && candidate.summary.length > 0
        ? candidate.summary.slice(0, 500)
        : `${config.label} instruction for this story`,
    details:
      typeof candidate.details === 'string' && candidate.details.length > 0
        ? candidate.details.slice(0, 4000)
        : `LLM did not return a details field. AKG hits: ${(candidate.existingArtifactReferences as unknown[] | undefined)?.length ?? 0}.`,
    referencedArtifactIds: extractReferencedIds(candidate.existingArtifactReferences),
    confidence:
      typeof candidate.confidence === 'number' ? clamp01(candidate.confidence) : 0.7,
    existingArtifactReferences: extractExistingRefs(candidate.existingArtifactReferences),
    newArtifactSpecs: extractNewSpecs(candidate.newArtifactSpecs, config.defaultArtifactKind),
    integrationPoints: extractIntegrationPoints(candidate.integrationPoints),
    risks: extractRisks(candidate.risks),
    testHooks: extractTestHooks(candidate.testHooks),
    crossCuttingConcerns: extractConcerns(candidate.crossCuttingConcerns, config.defaultConcerns),
  };

  // Validate via the Zod schema. If parsing fails, abandon the LLM output and
  // let the caller fall back to the deterministic baseline.
  const result = ArchitecturalInstructionV2Schema.safeParse(v2Object);
  if (!result.success) return [];
  return [result.data];
}

function synthesizeBaseline(
  domain: MacroDomain,
  bundle: TicketBundle,
  hits: ArchSearchHit[],
  config: DomainConfig,
): ArchitecturalInstructionV2 {
  const id = `arch_inst_${domain}_${Date.now().toString(36)}_baseline`;
  const title = bundle.story.title ?? 'untitled story';
  const topHit = hits[0] ?? null;
  const topScore = topHit ? Math.max(topHit.scoreDense, topHit.scoreSparse) : 0;

  let action: 'reuse' | 'enhance' | 'create';
  if (topScore >= SPECIALIST_REUSE_THRESHOLD) {
    action = 'reuse';
  } else if (topScore >= SPECIALIST_ENHANCE_THRESHOLD) {
    action = 'enhance';
  } else {
    action = 'create';
  }

  const summary =
    action === 'reuse'
      ? `Reuse existing ${topHit?.row.kind ?? 'artifact'} '${topHit?.row.name}' for ${config.label}`
      : action === 'enhance'
        ? `Enhance existing ${topHit?.row.kind ?? 'artifact'} '${topHit?.row.name}' for ${config.label}`
        : `Create new ${config.defaultArtifactKind} for ${config.label} per '${title}'`;

  const detailLines: string[] = [
    `Specialist: ${config.label}`,
    `Story: ${title}`,
    `AKG hits considered: ${hits.length}`,
  ];
  if (topHit) {
    detailLines.push(
      `Top match: ${topHit.row.kind} '${topHit.row.name}' (id=${topHit.row.id}, score=${topScore.toFixed(3)})`,
    );
  } else {
    detailLines.push('No AKG matches — fallback to create-only baseline.');
  }

  const existingRefs = hits.slice(0, 3).map<{
    artifactId: string;
    role: ArtifactRole;
    note: string;
  }>((h) => ({
    artifactId: h.row.id,
    role: action === 'reuse' && h === topHit ? 'use_as_is' : 'follow_pattern',
    note: `${h.row.kind} '${h.row.name}' — score ${Math.max(h.scoreDense, h.scoreSparse).toFixed(3)}`,
  }));

  const newArtifactSpecs =
    action === 'create'
      ? [
          {
            proposedKind: config.defaultArtifactKind,
            proposedName: slugify(title).slice(0, 80) || 'pending',
            proposedPath: defaultProposedPath(domain, title),
            proposedSignature: `// ${config.label} surface for: ${title}`,
          },
        ]
      : [];

  const risks: Array<{
    severity: RiskSeverity;
    summary: string;
    mitigation: string;
  }> = [
    {
      severity: 'medium',
      summary: `${config.label} risk: requirements may shift during implementation`,
      mitigation: `Capture acceptance criteria in the ticket, run ${config.primaryTestHookKind} tests pre-merge`,
    },
  ];

  const testHooks: Array<{
    kind: TestHookKind;
    target: string;
    rationale: string;
  }> = [
    {
      kind: config.primaryTestHookKind,
      target: topHit?.row.entryPath ?? topHit?.row.routeSignature ?? `${config.label} surface`,
      rationale: `Verify the ${config.label.toLowerCase()} contract holds under realistic load`,
    },
  ];

  const v2 = ArchitecturalInstructionV2Schema.parse({
    id,
    techSubDomain: config.primaryTechSubDomain,
    action,
    summary: summary.slice(0, 500),
    details: detailLines.join('\n').slice(0, 4000),
    referencedArtifactIds: existingRefs.map((r) => r.artifactId),
    ...(action === 'enhance' && topHit ? { enhancementOfArtifactId: topHit.row.id } : {}),
    confidence: action === 'reuse' ? topScore : action === 'enhance' ? topScore : 0.6,
    existingArtifactReferences: existingRefs,
    newArtifactSpecs,
    integrationPoints: [],
    risks,
    testHooks,
    crossCuttingConcerns: [...config.defaultConcerns],
  });

  return v2;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function stripCodeFences(s: string): string {
  return s.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function extractReferencedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (entry && typeof entry === 'object' && 'artifactId' in entry) {
        const id = (entry as { artifactId: unknown }).artifactId;
        return typeof id === 'string' ? id : null;
      }
      return null;
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function extractExistingRefs(raw: unknown): Array<{
  artifactId: string;
  role: ArtifactRole;
  note?: string;
}> {
  if (!Array.isArray(raw)) return [];
  const allowedRoles: readonly ArtifactRole[] = [
    'use_as_is',
    'compose_with',
    'replace',
    'follow_pattern',
  ];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as Record<string, unknown>;
      const artifactId = typeof obj.artifactId === 'string' ? obj.artifactId : null;
      if (!artifactId) return null;
      const roleRaw = typeof obj.role === 'string' ? (obj.role as ArtifactRole) : 'follow_pattern';
      const role: ArtifactRole = allowedRoles.includes(roleRaw) ? roleRaw : 'follow_pattern';
      const note = typeof obj.note === 'string' ? obj.note.slice(0, 500) : undefined;
      return note !== undefined ? { artifactId, role, note } : { artifactId, role };
    })
    .filter((x): x is { artifactId: string; role: ArtifactRole; note?: string } => x !== null);
}

function extractNewSpecs(
  raw: unknown,
  fallbackKind: TicketArtifactKind,
): Array<{
  proposedKind: TicketArtifactKind;
  proposedName: string;
  proposedPath?: string;
  proposedSignature?: string;
}> {
  if (!Array.isArray(raw)) return [];
  const allowedKinds: readonly TicketArtifactKind[] = [
    'component',
    'service',
    'function',
    'api',
    'schema',
    'migration',
    'package',
    'config',
    'template',
    'hook',
    'middleware',
    'integration',
  ];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as Record<string, unknown>;
      const proposedName =
        typeof obj.proposedName === 'string' ? obj.proposedName.slice(0, 255) : null;
      if (!proposedName) return null;
      const kindRaw = typeof obj.proposedKind === 'string'
        ? (obj.proposedKind as TicketArtifactKind)
        : fallbackKind;
      const proposedKind: TicketArtifactKind = allowedKinds.includes(kindRaw)
        ? kindRaw
        : fallbackKind;
      const result: {
        proposedKind: TicketArtifactKind;
        proposedName: string;
        proposedPath?: string;
        proposedSignature?: string;
      } = { proposedKind, proposedName };
      if (typeof obj.proposedPath === 'string') result.proposedPath = obj.proposedPath;
      if (typeof obj.proposedSignature === 'string')
        result.proposedSignature = obj.proposedSignature;
      return result;
    })
    .filter(
      (x): x is {
        proposedKind: TicketArtifactKind;
        proposedName: string;
        proposedPath?: string;
        proposedSignature?: string;
      } => x !== null,
    );
}

function extractIntegrationPoints(raw: unknown): Array<{
  direction: 'inbound' | 'outbound' | 'bidirectional';
  protocol: 'http' | 'ws' | 'event' | 'sql' | 'cli' | 'fs' | 'rpc';
  contract: string;
  targetArtifactId?: string;
}> {
  if (!Array.isArray(raw)) return [];
  const dirs = ['inbound', 'outbound', 'bidirectional'] as const;
  const protos = ['http', 'ws', 'event', 'sql', 'cli', 'fs', 'rpc'] as const;
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as Record<string, unknown>;
      const dir = typeof obj.direction === 'string' ? obj.direction : '';
      const proto = typeof obj.protocol === 'string' ? obj.protocol : '';
      const contract = typeof obj.contract === 'string' ? obj.contract.slice(0, 2000) : '';
      if (!(dirs as readonly string[]).includes(dir)) return null;
      if (!(protos as readonly string[]).includes(proto)) return null;
      if (!contract) return null;
      const result: {
        direction: 'inbound' | 'outbound' | 'bidirectional';
        protocol: 'http' | 'ws' | 'event' | 'sql' | 'cli' | 'fs' | 'rpc';
        contract: string;
        targetArtifactId?: string;
      } = {
        direction: dir as 'inbound' | 'outbound' | 'bidirectional',
        protocol: proto as 'http' | 'ws' | 'event' | 'sql' | 'cli' | 'fs' | 'rpc',
        contract,
      };
      if (typeof obj.targetArtifactId === 'string')
        result.targetArtifactId = obj.targetArtifactId;
      return result;
    })
    .filter(
      (x): x is {
        direction: 'inbound' | 'outbound' | 'bidirectional';
        protocol: 'http' | 'ws' | 'event' | 'sql' | 'cli' | 'fs' | 'rpc';
        contract: string;
        targetArtifactId?: string;
      } => x !== null,
    );
}

function extractRisks(raw: unknown): Array<{
  severity: RiskSeverity;
  summary: string;
  mitigation: string;
}> {
  if (!Array.isArray(raw)) return [];
  const allowed: readonly RiskSeverity[] = ['low', 'medium', 'high', 'critical'];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as Record<string, unknown>;
      const sev = typeof obj.severity === 'string' ? (obj.severity as RiskSeverity) : 'medium';
      const summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 500) : '';
      const mitigation = typeof obj.mitigation === 'string' ? obj.mitigation.slice(0, 1000) : '';
      if (!summary || !mitigation) return null;
      const severity: RiskSeverity = allowed.includes(sev) ? sev : 'medium';
      return { severity, summary, mitigation };
    })
    .filter((x): x is { severity: RiskSeverity; summary: string; mitigation: string } => x !== null);
}

function extractTestHooks(raw: unknown): Array<{
  kind: TestHookKind;
  target: string;
  rationale: string;
}> {
  if (!Array.isArray(raw)) return [];
  const allowed: readonly TestHookKind[] = [
    'unit',
    'integration',
    'e2e',
    'contract',
    'load',
    'a11y',
    'security',
    'visual',
  ];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const obj = entry as Record<string, unknown>;
      const k = typeof obj.kind === 'string' ? (obj.kind as TestHookKind) : 'integration';
      const target = typeof obj.target === 'string' ? obj.target.slice(0, 500) : '';
      const rationale = typeof obj.rationale === 'string' ? obj.rationale.slice(0, 500) : '';
      if (!target || !rationale) return null;
      const kind: TestHookKind = allowed.includes(k) ? k : 'integration';
      return { kind, target, rationale };
    })
    .filter((x): x is { kind: TestHookKind; target: string; rationale: string } => x !== null);
}

function extractConcerns(
  raw: unknown,
  fallback: readonly CrossCuttingConcern[],
): CrossCuttingConcern[] {
  const allowed: readonly CrossCuttingConcern[] = [
    'auth',
    'authz',
    'audit_log',
    'rate_limit',
    'idempotency',
    'retry',
    'caching',
    'csrf',
    'xss',
    'sqli',
    'pii',
    'i18n',
    'a11y',
    'observability_log',
    'observability_metric',
    'observability_trace',
    'feature_flag',
    'error_handling',
  ];
  if (!Array.isArray(raw)) return [...fallback];
  const out = raw
    .filter((c): c is string => typeof c === 'string')
    .filter((c): c is CrossCuttingConcern => allowed.includes(c as CrossCuttingConcern));
  return out.length > 0 ? out : [...fallback];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultProposedPath(domain: MacroDomain, storyTitle: string): string {
  const slug = slugify(storyTitle).slice(0, 60) || 'pending';
  switch (domain) {
    case 'ui':
      return `apps/dashboard/components/${slug}.tsx`;
    case 'backend':
      return `apps/orchestrator/src/api/routes/${slug}.ts`;
    case 'data':
      return `apps/orchestrator/src/db/migrations/NNNN_${slug.replace(/-/g, '_')}.sql`;
    case 'platform':
      return `infra/${slug}.config.yaml`;
    case 'quality-security':
      return `apps/orchestrator/src/middleware/${slug}.ts`;
    case 'integrations':
      return `apps/orchestrator/src/integrations/${slug}.ts`;
    default:
      return `apps/orchestrator/${slug}`;
  }
}
