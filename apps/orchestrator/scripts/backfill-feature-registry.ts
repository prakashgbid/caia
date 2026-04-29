/**
 * FREG-004 — Feature Registry backfill script.
 *
 * Idempotent + re-runnable. Two modes:
 *
 *   1. backfillFromStories(db, embedder, opts)
 *      Walks the `stories` table for `status IN ('verified','partial')` and
 *      synthesizes a registry row for each via the same synthesizeRowFromStory
 *      helper FREG-003 uses for live story.completed events. Token cost: zero
 *      Claude tokens; ~50-300 local Ollama tokens per story.
 *
 *   2. backfillFromCodebase(db, embedder, root, opts)
 *      Walks the CAIA monorepo for inferable features:
 *        - apps/<app>/.../app/**\/page.tsx                → route_path features
 *        - apps/orchestrator/src/agents/*.ts              → agent_name features
 *        - apps/orchestrator/src/db/migrations/*.sql      → db_table features
 *      Each becomes a thin registry row that can later be enriched by hand
 *      (or by a re-run after a manual edit).
 *
 * Both modes use computeDedupKey for idempotency — re-running upserts the
 * embedding + tags + updatedAt without inserting duplicate rows. Safe to
 * cron on a schedule once we want continuous discovery.
 *
 * Usage:
 *   pnpm tsx apps/orchestrator/scripts/backfill-feature-registry.ts \
 *     [--from=stories|codebase|both] \
 *     [--root=/path/to/caia] \
 *     [--db-url=/path/to/db.sqlite] \
 *     [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  bootstrapVectorTables,
  computeDedupKey,
  EmbedderUnavailableError,
  FeatureRegistryRowSchema,
  OllamaEmbeddingClient,
  upsertRegistryRow,
  type EmbeddingClient,
  type FeatureRegistryRow,
} from '@chiefaia/feature-registry';
import { getDb, getSqliteRaw, runMigrations } from '../src/db/connection';
import { stories } from '../src/db/schema';
import {
  synthesizeRowFromStory,
} from '../src/agents/feature-registry-writer';

const logger = {
  info: (msg: string, ctx: Record<string, unknown> = {}) =>
    console.log(`[backfill] ${msg}`, ctx),
  warn: (msg: string, ctx: Record<string, unknown> = {}) =>
    console.warn(`[backfill] ${msg}`, ctx),
  error: (msg: string, ctx: Record<string, unknown> = {}) =>
    console.error(`[backfill] ${msg}`, ctx),
};

export interface BackfillOpts {
  /** If true, log the synthesized rows but skip writes. */
  dryRun?: boolean;
  /** Limit the number of rows processed (for smoke runs). */
  limit?: number;
  /** Only process this project. */
  project?: string;
}

export interface BackfillReport {
  processed: number;
  upserted: number;
  skipped: number;
  errors: number;
  embedderTokens: number;
  durationMs: number;
}

// ─── Mode 1: stories table ──────────────────────────────────────────────────

export async function backfillFromStories(
  db: ReturnType<typeof getDb>,
  embedder: EmbeddingClient,
  opts: BackfillOpts = {},
): Promise<BackfillReport> {
  const t0 = Date.now();
  const report: BackfillReport = {
    processed: 0,
    upserted: 0,
    skipped: 0,
    errors: 0,
    embedderTokens: 0,
    durationMs: 0,
  };

  const all = db
    .select()
    .from(stories)
    .where(inArray(stories.status, ['verified', 'partial']))
    .all();
  const filtered = opts.project
    ? all.filter((s) => s.projectSlug === opts.project)
    : all;
  const limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;

  logger.info(`backfilling ${limited.length} stories (verified|partial)`);

  const sqlite = getSqliteRaw();

  for (const story of limited) {
    report.processed++;
    const row = synthesizeRowFromStory({ story, now: Date.now() });
    if (!row) {
      report.skipped++;
      continue;
    }

    if (opts.dryRun) {
      logger.info(`dry-run`, { storyId: story.id, name: row.name });
      report.upserted++;
      continue;
    }

    try {
      // Use the same source tag the script's name implies, not 'story_completed' — distinguishes
      // backfill rows from live-event-driven ones in the source histogram.
      const backfilledRow: FeatureRegistryRow = { ...row, source: 'backfill_stories' };
      const { embedding, tokens } = await embedder.embed(backfilledRow.description);
      report.embedderTokens += tokens;
      upsertRegistryRow(sqlite, backfilledRow, embedding);
      report.upserted++;
    } catch (err) {
      if (err instanceof EmbedderUnavailableError) {
        logger.warn('embedder unavailable; aborting backfill', { reason: err.message });
        report.errors++;
        break;
      }
      report.errors++;
      logger.warn('row failed', { storyId: story.id, err: (err as Error).message });
    }
  }

  report.durationMs = Date.now() - t0;
  logger.info('backfillFromStories complete', report as unknown as Record<string, unknown>);
  return report;
}

// ─── Mode 2: codebase walk ──────────────────────────────────────────────────

interface CodebaseFeature {
  project: string;
  name: string;
  description: string;
  routePath?: string;
  filePaths: string[];
  componentName?: string;
  agentName?: string;
  apiEndpoint?: string;
  dbTables: string[];
  tags: string[];
}

/** Scan apps/<app>/(app|pages)/** /page.tsx for Next.js route features. */
function discoverNextRoutes(root: string): CodebaseFeature[] {
  const out: CodebaseFeature[] = [];
  const appsDir = path.join(root, 'apps');
  if (!fs.existsSync(appsDir)) return out;

  for (const appName of fs.readdirSync(appsDir)) {
    const appRoot = path.join(appsDir, appName);
    if (!fs.statSync(appRoot).isDirectory()) continue;
    // Walk app/ and pages/ subtrees
    for (const sub of ['app', 'pages']) {
      const subRoot = path.join(appRoot, sub);
      if (!fs.existsSync(subRoot)) continue;
      walkDir(subRoot, (filePath) => {
        if (!filePath.endsWith('page.tsx') && !filePath.endsWith('page.ts')) return;
        const rel = path.relative(root, filePath);
        // Derive route_path from the dirname after 'app/' or 'pages/'.
        const routeParts = path
          .relative(subRoot, path.dirname(filePath))
          .split(path.sep)
          .filter(Boolean);
        const routePath = '/' + routeParts.join('/');
        const lastSeg = routeParts[routeParts.length - 1] ?? appName;
        out.push({
          project: appName,
          name: `${lastSeg} page`,
          description: `Next.js page at ${routePath} in ${appName}`,
          routePath,
          filePaths: [rel],
          componentName: undefined,
          dbTables: [],
          tags: ['frontend', 'route'],
        });
      });
    }
  }
  return out;
}

/** Scan apps/orchestrator/src/agents/*.ts for agent definitions. */
function discoverAgents(root: string): CodebaseFeature[] {
  const out: CodebaseFeature[] = [];
  const dir = path.join(root, 'apps', 'orchestrator', 'src', 'agents');
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
    const rel = path.relative(root, path.join(dir, f));
    const agentName = f.replace(/\.ts$/, '');
    out.push({
      project: 'caia',
      name: `${agentName} agent`,
      description: `Orchestrator agent ${agentName} (${rel})`,
      filePaths: [rel],
      agentName,
      dbTables: [],
      tags: ['backend', 'agent-runtime'],
    });
  }
  return out;
}

/** Scan apps/orchestrator/src/db/migrations/*.sql for db-table features. */
function discoverDbTables(root: string): CodebaseFeature[] {
  const out: CodebaseFeature[] = [];
  const dir = path.join(root, 'apps', 'orchestrator', 'src', 'db', 'migrations');
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const rel = path.relative(root, path.join(dir, f));
    const sql = fs.readFileSync(path.join(dir, f), 'utf-8');
    const tableMatches = Array.from(
      sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi),
    );
    for (const m of tableMatches) {
      const tableName = m[1]!;
      out.push({
        project: 'caia',
        name: `${tableName} table`,
        description: `SQLite table ${tableName} created by migration ${f}`,
        filePaths: [rel],
        dbTables: [tableName],
        tags: ['database', 'schema'],
      });
    }
  }
  return out;
}

function walkDir(root: string, cb: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // Skip noise
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist' || entry.name === '.git') continue;
      walkDir(full, cb);
    } else if (entry.isFile()) {
      cb(full);
    }
  }
}

/**
 * The PROJECT_SLUGS enum defines a short list. Codebase-discovered project
 * names may not match (e.g., we might find an app under `apps/dashboard/`
 * which isn't a registered slug). Map known apps to slugs; default to
 * 'caia' for orchestrator-internal stuff and 'unassigned' for everything
 * else. Adjust as the slug list grows.
 */
function normalizeProject(raw: string): string {
  const map: Record<string, string> = {
    orchestrator: 'caia',
    dashboard: 'caia',
    executor: 'caia',
    'completeness-sentinel': 'caia',
    'pipeline-pulse': 'caia',
    'task-run-poller': 'caia',
    'story-backfiller': 'caia',
    'db-backup': 'caia',
    'orchestrator-middleware': 'caia',
    pokerzeno: 'pokerzeno',
    roulettecommunity: 'roulettecommunity',
    edisoncricket: 'edisoncricket',
    ankitatiwari: 'ankitatiwari',
    'prakash-tiwari': 'prakash-tiwari',
    chiefaia: 'chiefaia.com',
  };
  return map[raw] ?? 'unassigned';
}

export async function backfillFromCodebase(
  db: ReturnType<typeof getDb>,
  embedder: EmbeddingClient,
  root: string,
  opts: BackfillOpts = {},
): Promise<BackfillReport> {
  const t0 = Date.now();
  const report: BackfillReport = {
    processed: 0,
    upserted: 0,
    skipped: 0,
    errors: 0,
    embedderTokens: 0,
    durationMs: 0,
  };

  if (!fs.existsSync(root)) {
    logger.warn('root does not exist; nothing to backfill', { root });
    return report;
  }

  const features: CodebaseFeature[] = [
    ...discoverNextRoutes(root),
    ...discoverAgents(root),
    ...discoverDbTables(root),
  ];
  const filtered = opts.project
    ? features.filter((f) => normalizeProject(f.project) === opts.project)
    : features;
  const limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;

  logger.info(`backfilling ${limited.length} codebase features`, {
    routes: features.filter((f) => f.tags.includes('route')).length,
    agents: features.filter((f) => f.agentName).length,
    db: features.filter((f) => f.tags.includes('database')).length,
  });

  const sqlite = getSqliteRaw();

  for (const feat of limited) {
    report.processed++;
    const project = normalizeProject(feat.project);
    const now = Date.now();
    const candidate = {
      id: `freg_${nanoid(10)}`,
      project: project as FeatureRegistryRow['project'],
      name: feat.name.slice(0, 200),
      description: feat.description.slice(0, 2000),
      routePath: feat.routePath,
      filePaths: feat.filePaths,
      componentName: feat.componentName,
      apiEndpoint: feat.apiEndpoint,
      dbTables: feat.dbTables,
      agentName: feat.agentName,
      shippedAt: now,
      storyId: undefined,
      tags: feat.tags.slice(0, 20),
      embeddingModel: 'nomic-embed-text',
      embeddingDim: 768,
      embeddingVersion: 'v1.5',
      source: 'backfill_codebase' as const,
      createdAt: now,
      updatedAt: now,
      dedupKey: computeDedupKey({
        project,
        name: feat.name,
        routePath: feat.routePath,
        componentName: feat.componentName,
        agentName: feat.agentName,
        filePaths: feat.filePaths,
      }),
    };
    const parsed = FeatureRegistryRowSchema.safeParse(candidate);
    if (!parsed.success) {
      report.skipped++;
      logger.warn('row failed Zod validation', { feat: feat.name, errors: parsed.error.errors });
      continue;
    }

    if (opts.dryRun) {
      logger.info('dry-run', { project, name: feat.name, dedupKey: parsed.data.dedupKey.slice(0, 12) });
      report.upserted++;
      continue;
    }

    try {
      const { embedding, tokens } = await embedder.embed(parsed.data.description);
      report.embedderTokens += tokens;
      upsertRegistryRow(sqlite, parsed.data, embedding);
      report.upserted++;
    } catch (err) {
      if (err instanceof EmbedderUnavailableError) {
        logger.warn('embedder unavailable; aborting codebase backfill', { reason: err.message });
        report.errors++;
        break;
      }
      report.errors++;
      logger.warn('row failed', { feat: feat.name, err: (err as Error).message });
    }
  }

  report.durationMs = Date.now() - t0;
  logger.info('backfillFromCodebase complete', report as unknown as Record<string, unknown>);
  return report;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

interface CliArgs {
  from: 'stories' | 'codebase' | 'both';
  root?: string;
  dbUrl?: string;
  dryRun: boolean;
  project?: string;
  limit?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { from: 'both', dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--from=')) args.from = a.slice('--from='.length) as CliArgs['from'];
    else if (a.startsWith('--root=')) args.root = a.slice('--root='.length);
    else if (a.startsWith('--db-url=')) args.dbUrl = a.slice('--db-url='.length);
    else if (a.startsWith('--project=')) args.project = a.slice('--project='.length);
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice('--limit='.length));
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ?? path.resolve(__dirname, '..', '..', '..');
  logger.info('starting backfill', { ...args, root });

  if (args.dbUrl) {
    runMigrations(args.dbUrl);
  } else {
    runMigrations();
  }
  bootstrapVectorTables(getSqliteRaw());

  const db = getDb();
  const embedder = new OllamaEmbeddingClient();

  const opts = { dryRun: args.dryRun, project: args.project, limit: args.limit };

  let total: BackfillReport = {
    processed: 0,
    upserted: 0,
    skipped: 0,
    errors: 0,
    embedderTokens: 0,
    durationMs: 0,
  };

  if (args.from === 'stories' || args.from === 'both') {
    const r = await backfillFromStories(db, embedder, opts);
    total = mergeReport(total, r);
  }
  if (args.from === 'codebase' || args.from === 'both') {
    const r = await backfillFromCodebase(db, embedder, root, opts);
    total = mergeReport(total, r);
  }

  logger.info('TOTAL', total as unknown as Record<string, unknown>);
}

function mergeReport(a: BackfillReport, b: BackfillReport): BackfillReport {
  return {
    processed: a.processed + b.processed,
    upserted: a.upserted + b.upserted,
    skipped: a.skipped + b.skipped,
    errors: a.errors + b.errors,
    embedderTokens: a.embedderTokens + b.embedderTokens,
    durationMs: a.durationMs + b.durationMs,
  };
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('backfill failed', { err: (err as Error).message });
    process.exit(1);
  });
}
