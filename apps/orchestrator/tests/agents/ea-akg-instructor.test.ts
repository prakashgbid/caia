/**
 * EA Agent — AKG-driven architecturalInstructions test suite (ARCH-006).
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { nanoid } from 'nanoid';
import {
  bootstrapVectorTables,
  computeArtifactDedupKey,
  StubEmbeddingClient,
  upsertArtifactRow,
  type ArchArtifactRow,
} from '@chiefaia/architecture-registry';
import * as schema from '../../src/db/schema';
import { runEaAkgInstructor } from '../../src/agents/ea-akg-instructor';

const NOW = 1745812800000;
const DIM = 32;
const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setupDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // Bootstrap AKG vec0 + fts5 virtual tables on the same connection.
  bootstrapVectorTables(sqlite, DIM);
  return { sqlite, db };
}

function buildArtifact(over: Partial<ArchArtifactRow>): ArchArtifactRow {
  const base: ArchArtifactRow = {
    id: 'arch_' + nanoid(8),
    kind: 'component',
    project: 'caia',
    name: 'Default',
    description: 'default',
    filePaths: [],
    techSubDomains: [],
    tags: [],
    metadataJson: '{}',
    source: 'ast_extract',
    embeddingModel: 'stub-embed-text',
    embeddingDim: DIM,
    embeddingVersion: 'v1.5',
    createdAt: NOW,
    updatedAt: NOW,
    dedupKey: 'a'.repeat(64),
    ...over,
  } as ArchArtifactRow;
  return base;
}

function seedStory(
  sqlite: Database.Database,
  args: {
    id: string;
    promptId: string;
    title: string;
    description: string;
    tsdAll: string[];
    tsdPrimary: string;
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO stories (
        id, parent_id, project_slug, kind, title, description, status,
        created_at, root_prompt_id, parent_entity_type, parent_entity_id,
        agent_contributions_json, tech_sub_domains_json, tech_sub_domain_primary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      null,
      'caia',
      'feature',
      args.title,
      args.description,
      'pending',
      String(NOW),
      args.promptId,
      'prompt',
      args.promptId,
      '{}',
      JSON.stringify(args.tsdAll),
      args.tsdPrimary,
    );
}

function seedPrompt(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO prompts (id, body, received_at, received_via, correlation_id, hash, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, 'p', new Date(NOW).toISOString(), 'api', `corr_${id}`, `hash_${id}`, 'received');
}

describe('runEaAkgInstructor', () => {
  let env: ReturnType<typeof setupDb>;
  let stub: StubEmbeddingClient;

  beforeEach(async () => {
    env = setupDb();
    stub = new StubEmbeddingClient('stub-embed-text', DIM);

    const ui = buildArtifact({
      id: 'arch_ui_leaderboard',
      kind: 'component',
      name: 'LeaderboardPage',
      description: 'React page rendering the top 100 players ranked by chips',
      techSubDomains: ['frontend', 'design-system'],
      entryPath: 'apps/dashboard/components/leaderboard.tsx',
      dedupKey: computeArtifactDedupKey({
        project: 'caia',
        kind: 'component',
        name: 'LeaderboardPage',
        entryPath: 'apps/dashboard/components/leaderboard.tsx',
      }),
    });
    const api = buildArtifact({
      id: 'arch_api_leaderboard',
      kind: 'api',
      name: 'GET /leaderboard',
      description: 'Hono endpoint returning the top 100 players ranked by chips',
      techSubDomains: ['bff'],
      routeSignature: 'GET /leaderboard',
      dedupKey: computeArtifactDedupKey({
        project: 'caia',
        kind: 'api',
        name: 'GET /leaderboard',
        routeSignature: 'GET /leaderboard',
      }),
    });
    const r1 = await stub.embed(ui.description);
    upsertArtifactRow(env.sqlite, ui, r1.embedding);
    const r2 = await stub.embed(api.description);
    upsertArtifactRow(env.sqlite, api, r2.embedding);
  });

  it('produces architecturalInstructions referencing real AKG artifacts', async () => {
    seedPrompt(env.sqlite, 'prompt_1');
    seedStory(env.sqlite, {
      id: 'story_1',
      promptId: 'prompt_1',
      title: 'Display leaderboard',
      description: 'Render top 100 players ranked by chips, with auto-refresh',
      tsdAll: ['frontend', 'bff'],
      tsdPrimary: 'frontend',
    });

    // Lower threshold so the StubEmbeddingClient (hash-based vectors) +
    // BM25 match clears 'enhance'. Production thresholds (0.85 / 0.65)
    // are tuned for nomic-embed-text on real text.
    const out = await runEaAkgInstructor(
      { promptId: 'prompt_1', correlationId: 'corr_1' },
      env.db as never,
      { embedder: stub, topK: 1, enhanceThreshold: 0.05 },
    );

    expect(out.storiesProcessed).toBe(1);
    expect(out.instructionsTotal).toBe(2);
    const row = env.sqlite
      .prepare('SELECT architectural_instructions_json, ea_decomposed_at FROM stories WHERE id = ?')
      .get('story_1') as { architectural_instructions_json: string; ea_decomposed_at: number | null };
    const instructions = JSON.parse(row.architectural_instructions_json) as Array<{
      techSubDomain: string;
      action: string;
      referencedArtifactIds: string[];
    }>;
    expect(instructions).toHaveLength(2);
    const tsds = instructions.map((i) => i.techSubDomain).sort();
    expect(tsds).toEqual(['bff', 'frontend']);
    const referenced = instructions.flatMap((i) => i.referencedArtifactIds);
    expect(referenced.some((id) => id.startsWith('arch_'))).toBe(true);
    expect(row.ea_decomposed_at).toBeGreaterThan(0);
  });

  it('falls back to action=create when AKG is empty', async () => {
    env.sqlite.exec('DELETE FROM arch_artifacts; DELETE FROM arch_artifacts_vec; DELETE FROM arch_artifacts_fts;');

    seedPrompt(env.sqlite, 'prompt_2');
    seedStory(env.sqlite, {
      id: 'story_2',
      promptId: 'prompt_2',
      title: 'Brand new analytics integration',
      description: 'Wire a fresh analytics pipeline',
      tsdAll: ['web-analytics'],
      tsdPrimary: 'web-analytics',
    });

    const out = await runEaAkgInstructor(
      { promptId: 'prompt_2', correlationId: 'corr_2' },
      env.db as never,
      { embedder: stub, topK: 1 },
    );
    expect(out.storiesProcessed).toBe(1);
    expect(out.createCount).toBe(1);
    const row = env.sqlite
      .prepare('SELECT architectural_instructions_json FROM stories WHERE id = ?')
      .get('story_2') as { architectural_instructions_json: string };
    const instructions = JSON.parse(row.architectural_instructions_json) as Array<{
      action: string;
      proposedPath?: string;
    }>;
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.action).toBe('create');
  });

  it('advances pipeline stage to ea_decomposed', async () => {
    seedPrompt(env.sqlite, 'prompt_3');
    seedStory(env.sqlite, {
      id: 'story_3',
      promptId: 'prompt_3',
      title: 'Anything',
      description: 'desc',
      tsdAll: ['frontend'],
      tsdPrimary: 'frontend',
    });

    await runEaAkgInstructor(
      { promptId: 'prompt_3', correlationId: 'corr_3' },
      env.db as never,
      { embedder: stub, topK: 1 },
    );

    const stages = env.sqlite
      .prepare('SELECT stage FROM prompt_pipeline_stages WHERE prompt_id = ? ORDER BY entered_at ASC')
      .all('prompt_3') as Array<{ stage: string }>;
    expect(stages.map((s) => s.stage)).toContain('ea_decomposed');
    const promptStatus = env.sqlite
      .prepare('SELECT status FROM prompts WHERE id = ?')
      .get('prompt_3') as { status: string };
    expect(promptStatus.status).toBe('ea_decomposed');
  });

  it('uses tech_sub_domain_primary when techSubDomainsJson is empty', async () => {
    seedPrompt(env.sqlite, 'prompt_4');
    seedStory(env.sqlite, {
      id: 'story_4',
      promptId: 'prompt_4',
      title: 'Story with primary only',
      description: 'Adds one frontend thing',
      tsdAll: [],
      tsdPrimary: 'frontend',
    });

    const out = await runEaAkgInstructor(
      { promptId: 'prompt_4', correlationId: 'corr_4' },
      env.db as never,
      { embedder: stub, topK: 1 },
    );
    expect(out.instructionsTotal).toBeGreaterThan(0);
    const row = env.sqlite
      .prepare('SELECT architectural_instructions_json FROM stories WHERE id = ?')
      .get('story_4') as { architectural_instructions_json: string };
    const instructions = JSON.parse(row.architectural_instructions_json) as Array<{
      techSubDomain: string;
    }>;
    expect(instructions[0]!.techSubDomain).toBe('frontend');
  });
});
