/**
 * DASH-303 — proactive_suggestions backfill seeder.
 *
 * Inserts a representative set of `proactive_suggestions` rows so the
 * dashboard's `/suggestions` page is non-empty out of the box. The seed
 * is idempotent: runs match by `slug` (encoded into `rationale` since the
 * schema lacks a unique slug column) and skip on subsequent boots.
 */
import { nanoid } from 'nanoid';
import type { Db } from './connection';
import { proactiveSuggestions, projects } from './schema';

interface SeedSuggestion {
  slug: string;
  title: string;
  rationale: string;
  options: string[];
  projectSlug: string | null;
}

const SEED_MARKER = '[caia-seed-suggestion:';

const SEEDS: ReadonlyArray<SeedSuggestion> = [
  { slug: 'enable-local-llm-routing', title: 'Route classification + dedup work to local LLM?', rationale: 'A local Ollama instance can handle classification, dedup checks, and short-form generation at ~5% of Claude API cost. Quality on those tasks is comparable per benchmarks.', options: ['Enable local routing for classification + dedup only','Enable for all reasoning under 8k tokens','Keep cloud-only for now'], projectSlug: null },
  { slug: 'auto-archive-stale-tasks', title: 'Auto-archive tasks idle > 30 days?', rationale: 'About 12% of tasks in the queue have been queued > 30 days without being picked up — usually because their priority bucket settled to P3 and never re-bumped. Auto-archive to clear the queue?', options: ['Yes, archive after 30 days idle','Only if also P3 with no recent dependent activity','No, leave them — I will triage manually'], projectSlug: null },
  { slug: 'completeness-cadence', title: 'How often should the completeness sentinel run?', rationale: 'Currently every 2h. More frequent runs catch regressions sooner but cost more in re-execution requirements when failures cascade.', options: ['Every 30 minutes','Every 2 hours (current)','Every 6 hours','On-demand only (manual trigger)'], projectSlug: null },
  { slug: 'pokerzeno-launch-readiness', title: 'Schedule a launch-readiness sweep for PokerZeno?', rationale: 'pokerzeno.com is at MVP. A full pre-launch sweep (a11y audit + perf audit + cross-browser smoke + onboarding flow) would surface blockers before public traffic hits.', options: ['Yes, run the sweep this week','Yes, after one more iteration','Skip — already covered by behavior tests'], projectSlug: 'pokerzeno' },
  { slug: 'dashboard-quality-page', title: 'Replace retired /coverage with a /quality page?', rationale: 'The conductor-specific /coverage page was retired during Gate 2. A CAIA-wide /quality page could aggregate per-package coverage from CI artifacts (DASH-314).', options: ['Yes, build /quality with per-package coverage','Defer — surface coverage in /metrics instead','Drop the idea, coverage is fine in CI alone'], projectSlug: null },
  { slug: 'agent-tier-rebalance', title: 'Rebalance agent-model tiers?', rationale: 'Strategic agents (PO/BA/Arch) currently use Sonnet for all work. Bumping them to Opus on multi-step plans could improve decomposition quality at moderate cost.', options: ['Bump strategic agents to Opus','Bump only the architect to Opus','Keep all on Sonnet'], projectSlug: null },
  { slug: 'roulette-community-engagement', title: 'Add a community Q&A feature to Roulette Community?', rationale: 'Drive returning traffic by letting users ask strategy questions and get AI-curated answers. Could leverage existing prompt pipeline.', options: ['Yes, scope it as a feature','Run a 2-week experiment first','Park — focus on existing strategy hub'], projectSlug: 'roulettecommunity' },
  { slug: 'audit-log-retention', title: 'How long should audit_log rows be retained?', rationale: 'audit_log has grown ~2k rows/week. No retention policy yet. After 6 months it will dominate the SQLite file.', options: ['Keep 90 days, summarize older into monthly aggregates','Keep forever (compliance-leaning)','Keep 30 days, drop older'], projectSlug: null },
] as const;

function makeRationale(seed: SeedSuggestion): string {
  return `${seed.rationale}\n\n${SEED_MARKER}${seed.slug}]`;
}

function isSeed(row: typeof proactiveSuggestions.$inferSelect, slug: string): boolean {
  return row.rationale.includes(`${SEED_MARKER}${slug}]`);
}

export async function seedSuggestions(db: Db): Promise<{ inserted: number; skipped: number }> {
  const now = new Date().toISOString();
  const existing = db.select().from(proactiveSuggestions).all();
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
    db.insert(proactiveSuggestions).values({
      id: 'sug_' + nanoid(8),
      title: seed.title,
      rationale: makeRationale(seed),
      options: JSON.stringify(seed.options),
      state: 'pending',
      projectId: seed.projectSlug ? projectIdBySlug.get(seed.projectSlug) ?? null : null,
      scope: 'global',
      createdAt: now,
    }).run();
    inserted++;
  }
  return { inserted, skipped };
}

export { SEEDS as SUGGESTION_SEEDS, SEED_MARKER as SUGGESTION_SEED_MARKER };
