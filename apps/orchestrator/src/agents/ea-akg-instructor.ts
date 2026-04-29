/**
 * EA Agent — AKG-driven architecturalInstructions (ARCH-006).
 *
 * Runs as the *second half* of the EA Agent pass, after the BUCKET-003
 * taxonomy classifier has assigned techSubDomains / risk / effort / claims.
 * For each story:
 *
 *   1. Read the BA-enriched ticket (acceptanceCriteria, scope, context).
 *   2. For every techSubDomain on the story, query the AKG:
 *      - frontend / design-system / accessibility / web-analytics → findUIArtifacts
 *      - bff / backend / api-gateway / agent-runtime / event-driven /
 *        auth / observability                                       → findBackendArtifacts
 *      - database / data-migration                                  → findDBArtifacts
 *      - integrations / observability_signal / domain_module        → findIntegrationArtifacts
 *      - everything else                                            → findAcrossDomains
 *   3. Convert the top-K hits into ArchitecturalInstruction entries:
 *      - score >= 0.85 → action='reuse', references the matched artifact
 *      - 0.65 <= score < 0.85 → action='enhance', references the closest match
 *      - score < 0.65 → action='create' with proposedPath / proposedSignature
 *        synthesized from the techSubDomain
 *   4. Persist instructions into stories.architectural_instructions_json.
 *   5. Stamp ea_decomposed_at + advance pipeline stage to ea_decomposed.
 *
 * Resilience: when the AKG embedder is unavailable (Ollama down, model
 * not pulled), search falls back to sparse-only via @chiefaia/architecture-
 * registry's archSearch. If the AKG itself is empty (e.g. fresh DB before
 * the backfill ran), we emit `create`-only instructions with synthesized
 * proposed paths — EA Agent never blocks a story on missing AKG data.
 */

import { eq } from 'drizzle-orm';
import {
  ArchitecturalInstructionSchema,
  type ArchitecturalInstruction,
  type TechSubDomain,
} from '@chiefaia/ticket-template';
import {
  archSearch,
  findUIArtifacts,
  findBackendArtifacts,
  findDBArtifacts,
  findIntegrationArtifacts,
  findAcrossDomains,
  StubEmbeddingClient,
  OllamaEmbeddingClient,
  type ArchSearchHit,
  type ArchSearchResult,
  type ArchSearchOpts,
  type EmbeddingClient,
} from '@chiefaia/architecture-registry';
import type { Db } from '../db/connection';
import { stories } from '../db/schema';
import { eventBus } from '../events/bus-adapter';
import { advancePipelineStage } from './pipeline-stages';

// ─── Thresholds ─────────────────────────────────────────────────────────────

export const ARCH_REUSE_THRESHOLD = 0.85;
export const ARCH_ENHANCE_THRESHOLD = 0.65;

// ─── Domain routing ─────────────────────────────────────────────────────────

const UI_DOMAINS: ReadonlyArray<TechSubDomain> = [
  'frontend',
  'design-system',
  'accessibility',
  'web-analytics',
  'localization-i18n',
];
const BACKEND_DOMAINS: ReadonlyArray<TechSubDomain> = [
  'bff',
  'backend',
  'api-gateway',
  'agent-runtime',
  'event-driven',
  'auth',
  'observability',
  'caching',
  'rate-limiting',
];
const DB_DOMAINS: ReadonlyArray<TechSubDomain> = ['database', 'data-migration'];
const INTEGRATION_DOMAINS: ReadonlyArray<TechSubDomain> = [
  'cms',
  'crm',
  'payments',
  'email',
  'search',
  'secrets-management',
  'monitoring-alerting',
  'feature-flags',
  'file-storage',
  'cron-scheduling',
];

type SearchFn = (
  query: string,
  opts: ArchSearchOpts,
  deps: { db: import('better-sqlite3').Database; embedder: EmbeddingClient },
) => Promise<ArchSearchResult>;

function selectSearchFn(tsd: TechSubDomain): SearchFn {
  if (UI_DOMAINS.includes(tsd)) return findUIArtifacts;
  if (BACKEND_DOMAINS.includes(tsd)) return findBackendArtifacts;
  if (DB_DOMAINS.includes(tsd)) return findDBArtifacts;
  if (INTEGRATION_DOMAINS.includes(tsd)) return findIntegrationArtifacts;
  // fallback — search across all kinds for the long tail (testing, seo,
  // documentation, etc.)
  return findAcrossDomains;
}

// ─── Embedder selection ─────────────────────────────────────────────────────

/**
 * In production we use the Ollama-backed embedder; tests inject the stub.
 * Pass `embedder` explicitly via runEAAkgInstructor to override.
 */
function defaultEmbedder(): EmbeddingClient {
  if (process.env.AKG_USE_STUB_EMBEDDER === '1') {
    // Tests + CI use this to avoid a hard Ollama dependency.
    return new StubEmbeddingClient('stub-embed-text', 32);
  }
  return new OllamaEmbeddingClient({});
}

// ─── Per-story instruction synthesis ────────────────────────────────────────

/**
 * Convert one AKG search hit into an ArchitecturalInstruction.
 */
function hitToInstruction(
  id: string,
  techSubDomain: TechSubDomain,
  hit: ArchSearchHit,
): ArchitecturalInstruction {
  const score = Math.max(hit.scoreDense, hit.scoreSparse);
  const action: ArchitecturalInstruction['action'] =
    score >= ARCH_REUSE_THRESHOLD ? 'reuse' : 'enhance';
  const summary =
    action === 'reuse'
      ? `Use existing ${hit.row.kind} '${hit.row.name}'`
      : `Enhance existing ${hit.row.kind} '${hit.row.name}' for this story`;
  const detailLines: string[] = [
    `Match score: ${score.toFixed(3)} (${hit.matchType}).`,
    `Description: ${hit.row.description}`,
  ];
  if (hit.row.entryPath) detailLines.push(`Entry path: ${hit.row.entryPath}`);
  if (hit.row.routeSignature) detailLines.push(`Route: ${hit.row.routeSignature}`);
  if (hit.row.tableName) detailLines.push(`Table: ${hit.row.tableName}`);
  if (hit.row.packageName) detailLines.push(`Package: ${hit.row.packageName}`);
  if (hit.row.designSystemTier) detailLines.push(`Design-system tier: ${hit.row.designSystemTier}`);
  return ArchitecturalInstructionSchema.parse({
    id,
    techSubDomain,
    action,
    summary,
    details: detailLines.join('\n'),
    referencedArtifactIds: [hit.row.id],
    ...(action === 'enhance' ? { enhancementOfArtifactId: hit.row.id } : {}),
    confidence: score,
  });
}

/**
 * Synthesize a `create`-action instruction when no AKG match clears the
 * enhance threshold. The proposed path / signature follows convention for
 * the techSubDomain so the developer agent has a concrete target.
 */
function createInstruction(
  id: string,
  techSubDomain: TechSubDomain,
  storyTitle: string,
  storySummary: string,
): ArchitecturalInstruction {
  const slug = storyTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  let proposedPath: string | undefined;
  let proposedSignature: string | undefined;
  let summary = `Create new ${techSubDomain} artifact for '${storyTitle}'`;

  switch (techSubDomain) {
    case 'frontend':
    case 'design-system':
      proposedPath = `apps/dashboard/components/${slug}.tsx`;
      proposedSignature = `export function ${pascal(slug)}(props: { /* TBD */ }): JSX.Element`;
      break;
    case 'bff':
    case 'backend':
    case 'api-gateway':
      proposedPath = `apps/orchestrator/src/api/routes/${slug}.ts`;
      proposedSignature = `app.<METHOD>('/<path>', ...)`;
      break;
    case 'database':
    case 'data-migration':
      proposedPath = `apps/orchestrator/src/db/migrations/NNNN_${slug.replace(/-/g, '_')}.sql`;
      proposedSignature = `CREATE TABLE / ALTER TABLE — see story acceptance criteria`;
      break;
    case 'event-driven':
      proposedPath = `packages/events-taxonomy-internal/registry.yaml (add event)`;
      proposedSignature = `eventBus.publish({ type: '<namespace>.<event>', ... })`;
      break;
    case 'observability':
    case 'monitoring-alerting':
      proposedSignature = `Add log + metric per @chiefaia/logger + @chiefaia/metrics conventions`;
      break;
    case 'testing':
      proposedPath = `<package>/tests/${slug}.test.ts`;
      proposedSignature = `Vitest + Playwright per acceptance criteria`;
      break;
    default:
      proposedSignature = `Per acceptance criteria; see ADRs in caia/docs/architecture-registry.md`;
  }

  const details = [
    `No close AKG match for techSubDomain='${techSubDomain}'.`,
    `Story summary: ${storySummary || storyTitle}`,
    `Proposed path: ${proposedPath ?? '(domain has no canonical path convention)'}`,
    `Proposed signature: ${proposedSignature ?? '(see acceptance criteria)'}`,
  ].join('\n');

  return ArchitecturalInstructionSchema.parse({
    id,
    techSubDomain,
    action: 'create',
    summary,
    details,
    ...(proposedPath ? { proposedPath } : {}),
    ...(proposedSignature ? { proposedSignature } : {}),
    confidence: 1.0,
  });
}

function pascal(s: string): string {
  return s
    .split('-')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join('');
}

// ─── Public entry point ─────────────────────────────────────────────────────

export interface EaAkgInstructorInput {
  promptId: string;
  correlationId: string;
}

export interface EaAkgInstructorOutput {
  promptId: string;
  storiesProcessed: number;
  instructionsTotal: number;
  reuseCount: number;
  enhanceCount: number;
  createCount: number;
}

export interface EaAkgInstructorOpts {
  /**
   * AKG embedder. Defaults to OllamaEmbeddingClient (or
   * StubEmbeddingClient when AKG_USE_STUB_EMBEDDER=1).
   */
  embedder?: EmbeddingClient;
  /** Top-K AKG hits per techSubDomain per story (default 1). */
  topK?: number;
  /** Override threshold for `reuse` (default 0.85). */
  reuseThreshold?: number;
  /** Override threshold for `enhance` (default 0.65). */
  enhanceThreshold?: number;
}

export async function runEaAkgInstructor(
  input: EaAkgInstructorInput,
  db: Db,
  opts: EaAkgInstructorOpts = {},
): Promise<EaAkgInstructorOutput> {
  const { promptId, correlationId } = input;
  const embedder = opts.embedder ?? defaultEmbedder();
  const topK = opts.topK ?? 1;
  const reuseThreshold = opts.reuseThreshold ?? ARCH_REUSE_THRESHOLD;
  void reuseThreshold;
  const enhanceThreshold = opts.enhanceThreshold ?? ARCH_ENHANCE_THRESHOLD;

  // The orchestrator's better-sqlite3 connection is wrapped by drizzle in
  // `Db`. The AKG search functions need the raw better-sqlite3 instance;
  // drizzle exposes it via `.session.client` (BetterSQLite3Session) — but
  // this can vary by drizzle version, so we use `getRawDb()` if available
  // or a local fallback.
  const rawDb = getRawSqliteFromDrizzle(db);

  const allStories = db
    .select()
    .from(stories)
    .where(eq(stories.rootPromptId, promptId))
    .all();

  let storiesProcessed = 0;
  let instructionsTotal = 0;
  let reuseCount = 0;
  let enhanceCount = 0;
  let createCount = 0;
  const now = Date.now();

  for (const story of allStories) {
    try {
      const techSubDomains: TechSubDomain[] = JSON.parse(
        story.techSubDomainsJson ?? '[]',
      ) as TechSubDomain[];
      // Fall back to story.techSubDomainPrimary if the all[] is empty.
      const domainSet = new Set<TechSubDomain>(techSubDomains);
      if (domainSet.size === 0 && story.techSubDomainPrimary) {
        domainSet.add(story.techSubDomainPrimary as TechSubDomain);
      }
      if (domainSet.size === 0) {
        // Default to backend so EA always emits at least one instruction.
        domainSet.add('backend');
      }

      const instructions: ArchitecturalInstruction[] = [];
      const queryText = `${story.title}\n${story.description ?? ''}`;
      let instructionIdx = 0;

      for (const tsd of domainSet) {
        const searchFn = selectSearchFn(tsd);
        let result: ArchSearchResult;
        try {
          result = await searchFn(
            queryText,
            { topK, minScore: 0, techSubDomains: [tsd] },
            { db: rawDb, embedder },
          );
        } catch (err) {
          // AKG empty / not bootstrapped — fall back to create-only
          void err;
          const id = `arch_inst_${story.id}_${instructionIdx++}`;
          const synth = createInstruction(id, tsd, story.title, story.description ?? '');
          instructions.push(synth);
          createCount++;
          instructionsTotal++;
          continue;
        }

        const top = result.topMatch;
        if (!top) {
          const id = `arch_inst_${story.id}_${instructionIdx++}`;
          const synth = createInstruction(id, tsd, story.title, story.description ?? '');
          instructions.push(synth);
          createCount++;
          instructionsTotal++;
          continue;
        }
        const score = Math.max(top.scoreDense, top.scoreSparse);
        if (score < enhanceThreshold) {
          const id = `arch_inst_${story.id}_${instructionIdx++}`;
          const synth = createInstruction(id, tsd, story.title, story.description ?? '');
          instructions.push(synth);
          createCount++;
        } else {
          const id = `arch_inst_${story.id}_${instructionIdx++}`;
          const inst = hitToInstruction(id, tsd, top);
          instructions.push(inst);
          if (inst.action === 'reuse') reuseCount++;
          else if (inst.action === 'enhance') enhanceCount++;
        }
        instructionsTotal++;
      }

      db.update(stories)
        .set({
          architecturalInstructionsJson: JSON.stringify(instructions),
          eaDecomposedAt: now,
        })
        .where(eq(stories.id, story.id))
        .run();

      storiesProcessed++;
    } catch (err) {
      // Per-story failure is non-fatal: we want a story without AKG
      // instructions to still flow through Validator + Test-Design.
      console.warn('[ea-akg-instructor] story failed', story.id, err);
    }
  }

  // Advance pipeline stage to ea_decomposed.
  advancePipelineStage(
    {
      promptId,
      stage: 'ea_decomposed',
      correlationId,
      metadata: {
        storiesProcessed,
        instructionsTotal,
        reuseCount,
        enhanceCount,
        createCount,
      },
    },
    db,
  );

  eventBus.publish({
    type: 'ea-agent.akg.complete',
    actor: 'ea-agent',
    correlation_id: correlationId,
    entity_type: 'prompt',
    entity_id: promptId,
    payload: {
      promptId,
      storiesProcessed,
      instructionsTotal,
      reuseCount,
      enhanceCount,
      createCount,
    },
  });

  return {
    promptId,
    storiesProcessed,
    instructionsTotal,
    reuseCount,
    enhanceCount,
    createCount,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the underlying better-sqlite3 Database from drizzle's wrapper.
 * The internal field is stable across drizzle 0.x but technically not part
 * of the public API. If a future drizzle upgrade breaks this, we'll need
 * to thread the raw connection through the orchestrator's connection layer.
 */
function getRawSqliteFromDrizzle(db: Db): import('better-sqlite3').Database {
  // drizzle stores the underlying client at session.client for
  // better-sqlite3 (drizzle-orm/better-sqlite3). Cast through unknown to
  // sidestep the structural-typing wall.
  const session = (db as unknown as { session?: { client?: unknown } }).session;
  if (session?.client) {
    return session.client as import('better-sqlite3').Database;
  }
  // Fallback: sometimes the raw db is exposed as `db.$client` (newer
  // drizzle versions).
  const dollar = (db as unknown as { $client?: unknown }).$client;
  if (dollar) return dollar as import('better-sqlite3').Database;
  throw new Error(
    'ea-akg-instructor: could not locate raw better-sqlite3 instance on drizzle wrapper',
  );
}
