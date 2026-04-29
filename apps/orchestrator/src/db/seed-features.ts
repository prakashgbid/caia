/**
 * DASH-302 — features backfill seeder.
 *
 * Inserts a representative set of `business_features` rows so the
 * dashboard's `/features` page is non-empty out of the box. The seed is
 * idempotent: runs match by `slug` (encoded into `description` since the
 * schema lacks a unique slug column) and skip on subsequent boots.
 *
 * Once the prompt-decomposer / agent pipeline starts producing real
 * features, those will simply be appended on top of these seeds.
 */
import { nanoid } from 'nanoid';
import type { Db } from './connection';
import { businessFeatures, projects } from './schema';

interface SeedFeature {
  slug: string;
  title: string;
  description: string;
  phase: '0' | '1' | '2' | '3';
  status: 'planned' | 'in_progress' | 'shipped' | 'archived';
  projectSlug: string | null;
}

const SEED_MARKER = '[caia-seed-feature:';

const SEEDS: ReadonlyArray<SeedFeature> = [
  { slug: 'caia-dashboard-canonical', title: 'CAIA Dashboard — canonical platform UI', description: 'Repurpose conductor/dashboard into the CAIA dashboard. Every nav-visible page loads with real orchestrator data via /api proxies + the WS event stream.', phase: '1', status: 'shipped', projectSlug: null },
  { slug: 'realtime-ws-event-stream', title: 'Real-time WS event stream end-to-end', description: 'Canonical ConductorEvent envelope shape between orchestrator and dashboard, correlation_id propagation across the executor boundary, live updates on /timeline /task-runs /platform-status.', phase: '1', status: 'shipped', projectSlug: null },
  { slug: 'priority-queue-live', title: 'Priority queue with continuous reprioritization', description: 'Reprioritizer subscribes to task and completeness events; emits priority.scored / rebucketed / reordered. /queue page subscribes to those events and re-fetches in real time.', phase: '1', status: 'shipped', projectSlug: null },
  { slug: 'completeness-trust-nothing', title: 'Trust-nothing completeness verification', description: 'Sentinel re-verifies entities and files re-execution requirements on fail. /completeness page shows scores + findings; live via completeness.* events.', phase: '1', status: 'shipped', projectSlug: null },
  { slug: 'agent-artifacts-review-gates', title: 'Agent artifact review gates', description: 'Strategic agents (PO/BA/Architect/etc.) emit drafts as agent_artifacts. /gates page lets a human approve or reject; emits artifact.* events into the timeline.', phase: '1', status: 'shipped', projectSlug: null },
  { slug: 'phase1-bucket-placement', title: 'Phase-1 bucket placement (sequential + parallel)', description: 'Task Manager partitions tickets into per-(project_slug, tech_sub_domain) sequential buckets plus a single parallel bucket per prompt. /buckets page renders them as Kanban with WCC levels.', phase: '1', status: 'shipped', projectSlug: null },
  { slug: 'pokerzeno-mvp', title: 'PokerZeno MVP', description: 'Public site at pokerzeno.com with home, lobby, and live tables. Tracked here for cross-product visibility — actual features live in the pokerzeno repo.', phase: '2', status: 'in_progress', projectSlug: 'pokerzeno' },
  { slug: 'roulette-community-mvp', title: 'Roulette Community MVP', description: 'Public site at roulettecommunity.com with strategy hub + live community. Tracked here for cross-product visibility.', phase: '2', status: 'in_progress', projectSlug: 'roulettecommunity' },
  { slug: 'observability-pino-rollout', title: 'Observability — Pino structured logging across packages', description: 'Replace console.log with structured pino logger; bus transport fans warn/error to event-bus so /timeline picks up production issues automatically.', phase: '1', status: 'in_progress', projectSlug: null },
  { slug: 'local-llm-router', title: 'Local LLM router for cheap classification', description: '@chiefaia/local-llm-router routes deterministic / classification work to local Ollama models, cloud Claude only for reasoning. Targets ~70% cost reduction on routine ops.', phase: '1', status: 'planned', projectSlug: null },
] as const;

function makeDescription(seed: SeedFeature): string {
  return `${seed.description}\n\n${SEED_MARKER}${seed.slug}]`;
}

function isSeed(row: typeof businessFeatures.$inferSelect, slug: string): boolean {
  return row.description.includes(`${SEED_MARKER}${slug}]`);
}

export async function seedFeatures(db: Db): Promise<{ inserted: number; skipped: number }> {
  const now = new Date().toISOString();
  const existing = db.select().from(businessFeatures).all();
  const seenSlugs = new Set<string>();
  for (const row of existing) {
    for (const seed of SEEDS) {
      if (isSeed(row, seed.slug)) { seenSlugs.add(seed.slug); break; }
    }
  }
  const projectRows = db.select({ id: projects.id, slug: projects.slug }).from(projects).all();
  const projectIdBySlug = new Map(projectRows.map(r => [r.slug, r.id]));
  let inserted = 0;
  let skipped = 0;
  for (const seed of SEEDS) {
    if (seenSlugs.has(seed.slug)) { skipped++; continue; }
    db.insert(businessFeatures).values({
      id: 'feat_' + nanoid(8),
      title: seed.title,
      description: makeDescription(seed),
      phase: seed.phase,
      status: seed.status,
      linkedRequirements: '[]',
      projectId: seed.projectSlug ? projectIdBySlug.get(seed.projectSlug) ?? null : null,
      scope: 'global',
      createdAt: now,
      updatedAt: now,
    }).run();
    inserted++;
  }
  return { inserted, skipped };
}

export { SEEDS as FEATURE_SEEDS, SEED_MARKER as FEATURE_SEED_MARKER };
