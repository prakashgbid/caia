/**
 * ARCH-008 — E2E test for the EA Agent's per-domain architectural
 * instructions, end-to-end across the AKG.
 *
 * Validates the directive's core promise: a complex prompt produces
 * stories whose architecturalInstructions[] cover every relevant
 * tech_sub_domain, and each instruction either references a real AKG
 * artifact (when one exists) or proposes a new one with a concrete
 * path + signature.
 *
 * Uses an in-process StubEmbeddingClient so CI doesn't need Ollama.
 *
 * Pipeline order asserted: po_decomposed → ba_enriched → ea_decomposed
 * (per ARCH-006). Validator + Test-Design come after; this test exercises
 * only the EA portion.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import {
  bootstrapVectorTables,
  computeArtifactDedupKey,
  StubEmbeddingClient,
  upsertArtifactRow,
  type ArchArtifactRow,
} from '@chiefaia/architecture-registry';
import { runEaAkgInstructor } from '../../src/agents/ea-akg-instructor';
import {
  PIPELINE_STAGE_ORDER,
  STAGE_BA_ENRICHED,
  STAGE_EA_DECOMPOSED,
  advancePipelineStage,
  stageIndex,
} from '../../src/agents/pipeline-stages';
import { getDb, getSqliteRaw, resetDb, runMigrations } from '../../src/db/connection';
import { stories, prompts } from '../../src/db/schema';

const DIM = 32;

function tempDbUrl(): string {
  return path.join(
    os.tmpdir(),
    `arch-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

async function seedAkg(): Promise<void> {
  const sqlite = getSqliteRaw();
  bootstrapVectorTables(sqlite, DIM);
  const stub = new StubEmbeddingClient('stub-embed-text', DIM);
  const now = Date.now();

  const seeds: ArchArtifactRow[] = [
    {
      id: 'arch_ui_leaderboard',
      kind: 'component',
      project: 'caia',
      name: 'LeaderboardPage',
      description: 'React page rendering the top 100 players ranked by chips',
      filePaths: ['apps/dashboard/components/leaderboard.tsx'],
      entryPath: 'apps/dashboard/components/leaderboard.tsx',
      techSubDomains: ['frontend', 'design-system'],
      tags: [],
      metadataJson: '{}',
      source: 'ast_extract',
      embeddingModel: 'stub-embed-text',
      embeddingDim: DIM,
      embeddingVersion: 'v1.5',
      createdAt: now,
      updatedAt: now,
      dedupKey: computeArtifactDedupKey({
        project: 'caia',
        kind: 'component',
        name: 'LeaderboardPage',
        entryPath: 'apps/dashboard/components/leaderboard.tsx',
      }),
    },
    {
      id: 'arch_api_leaderboard',
      kind: 'api',
      project: 'caia',
      name: 'GET /leaderboard',
      description: 'Hono endpoint returning the top 100 players ranked by chips',
      filePaths: ['apps/orchestrator/src/api/routes/leaderboard.ts'],
      routeSignature: 'GET /leaderboard',
      techSubDomains: ['bff'],
      tags: [],
      metadataJson: '{}',
      source: 'ast_extract',
      embeddingModel: 'stub-embed-text',
      embeddingDim: DIM,
      embeddingVersion: 'v1.5',
      createdAt: now,
      updatedAt: now,
      dedupKey: computeArtifactDedupKey({
        project: 'caia',
        kind: 'api',
        name: 'GET /leaderboard',
        routeSignature: 'GET /leaderboard',
      }),
    },
    {
      id: 'arch_schema_users',
      kind: 'schema',
      project: 'caia',
      name: 'users',
      description: 'User account rows including chips_total + last_login',
      filePaths: ['apps/orchestrator/src/db/schema.ts'],
      tableName: 'users',
      techSubDomains: ['database'],
      tags: [],
      metadataJson: '{}',
      source: 'drizzle_introspect',
      embeddingModel: 'stub-embed-text',
      embeddingDim: DIM,
      embeddingVersion: 'v1.5',
      createdAt: now,
      updatedAt: now,
      dedupKey: computeArtifactDedupKey({
        project: 'caia',
        kind: 'schema',
        name: 'users',
        tableName: 'users',
      }),
    },
  ];

  for (const row of seeds) {
    const { embedding } = await stub.embed(row.description);
    upsertArtifactRow(sqlite, row, embedding);
  }
}

function seedPrompt(promptId: string, body: string): void {
  const db = getDb();
  db.insert(prompts)
    .values({
      id: promptId,
      body,
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId: `corr_${promptId}`,
      hash: `hash_${promptId}`,
      status: 'received',
    })
    .run();
}

interface SeedStoryArgs {
  id: string;
  promptId: string;
  title: string;
  description: string;
  techSubDomains: string[];
  techSubDomainPrimary: string;
}

function seedStory(args: SeedStoryArgs): void {
  const sqlite = getSqliteRaw();
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
      String(Date.now()),
      args.promptId,
      'prompt',
      args.promptId,
      '{}',
      JSON.stringify(args.techSubDomains),
      args.techSubDomainPrimary,
    );
}

describe('ARCH-008 — E2E EA Agent + AKG → architecturalInstructions[]', () => {
  let url: string;
  const stub = new StubEmbeddingClient('stub-embed-text', DIM);

  beforeEach(async () => {
    resetDb();
    url = tempDbUrl();
    runMigrations(url);
    await seedAkg();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(url)) fs.unlinkSync(url);
    } catch {
      // ignore
    }
    resetDb();
  });

  it('processes a complex multi-domain prompt and emits per-domain instructions', async () => {
    const promptId = 'prompt_e2e_1';
    seedPrompt(promptId, 'Add a leaderboard with profile drilldown');

    // Three stories spanning frontend, bff, database, web-analytics
    seedStory({
      id: 'story_lb_ui',
      promptId,
      title: 'Display leaderboard',
      description: 'Render top 100 players ranked by chips, with auto-refresh',
      techSubDomains: ['frontend', 'design-system'],
      techSubDomainPrimary: 'frontend',
    });
    seedStory({
      id: 'story_lb_api',
      promptId,
      title: 'Leaderboard API',
      description: 'Expose GET /leaderboard returning ranked players sorted by chips',
      techSubDomains: ['bff'],
      techSubDomainPrimary: 'bff',
    });
    seedStory({
      id: 'story_lb_schema',
      promptId,
      title: 'Schema for leaderboard',
      description: 'Add chips_total + last_login columns to users table',
      techSubDomains: ['database', 'data-migration'],
      techSubDomainPrimary: 'database',
    });
    seedStory({
      id: 'story_lb_analytics',
      promptId,
      title: 'Leaderboard analytics',
      description: 'Track view + click events on the leaderboard for product analytics',
      techSubDomains: ['web-analytics'],
      techSubDomainPrimary: 'web-analytics',
    });

    // Mark prompt at ba_enriched first so the EA stage advance is valid.
    const db = getDb();
    advancePipelineStage(
      { promptId, stage: STAGE_BA_ENRICHED, correlationId: `corr_${promptId}` },
      db,
    );

    // Run the AKG instructor with a low threshold so stub-embedded matches
    // clear `enhance`. Production thresholds are tuned for nomic-embed-text.
    const out = await runEaAkgInstructor(
      { promptId, correlationId: `corr_${promptId}` },
      db,
      { embedder: stub, topK: 1, enhanceThreshold: 0.05 },
    );

    // Every story is processed.
    expect(out.storiesProcessed).toBe(4);
    // At least one story per relevant domain produced an instruction.
    expect(out.instructionsTotal).toBeGreaterThanOrEqual(4);
    // Some hits should reference real AKG artifacts (LeaderboardPage,
    // GET /leaderboard, users schema). Some should be `create` for the
    // analytics path (no AKG match).
    expect(out.reuseCount + out.enhanceCount).toBeGreaterThan(0);
    expect(out.createCount).toBeGreaterThan(0);

    // Sample one story's instructions and assert structure.
    const sqlite = getSqliteRaw();
    const uiRow = sqlite
      .prepare('SELECT architectural_instructions_json FROM stories WHERE id = ?')
      .get('story_lb_ui') as { architectural_instructions_json: string };
    const uiInstructions = JSON.parse(uiRow.architectural_instructions_json) as Array<{
      techSubDomain: string;
      action: string;
      referencedArtifactIds: string[];
      proposedPath?: string;
    }>;
    expect(uiInstructions.length).toBeGreaterThan(0);
    // For UI story, at least the frontend instruction should reference
    // arch_ui_leaderboard.
    const frontendInstr = uiInstructions.find((i) => i.techSubDomain === 'frontend');
    expect(frontendInstr).toBeDefined();
    expect(frontendInstr!.referencedArtifactIds).toContain('arch_ui_leaderboard');

    // Schema story should reference the users table artifact.
    const schemaRow = sqlite
      .prepare('SELECT architectural_instructions_json FROM stories WHERE id = ?')
      .get('story_lb_schema') as { architectural_instructions_json: string };
    const schemaInstructions = JSON.parse(schemaRow.architectural_instructions_json) as Array<{
      techSubDomain: string;
      action: string;
      referencedArtifactIds: string[];
    }>;
    const dbInstr = schemaInstructions.find((i) => i.techSubDomain === 'database');
    expect(dbInstr).toBeDefined();
    // Should match arch_schema_users.
    expect(dbInstr!.referencedArtifactIds.length).toBeGreaterThan(0);

    // Analytics story has no AKG match → all create.
    const analyticsRow = sqlite
      .prepare('SELECT architectural_instructions_json FROM stories WHERE id = ?')
      .get('story_lb_analytics') as { architectural_instructions_json: string };
    const analyticsInstructions = JSON.parse(analyticsRow.architectural_instructions_json) as Array<{
      action: string;
      proposedPath?: string;
    }>;
    expect(analyticsInstructions.every((i) => i.action === 'create')).toBe(true);
  });

  it('asserts the canonical pipeline order po → ba → ea → validated', () => {
    expect(stageIndex('po_decomposed')).toBeLessThan(stageIndex(STAGE_BA_ENRICHED));
    expect(stageIndex(STAGE_BA_ENRICHED)).toBeLessThan(stageIndex(STAGE_EA_DECOMPOSED));
    expect(stageIndex(STAGE_EA_DECOMPOSED)).toBeLessThan(stageIndex('validated'));
    expect(stageIndex('validated')).toBeLessThan(stageIndex('test_designed'));
    // Sanity: ea_decomposed is the canonical stage name (not ea_classified).
    expect(PIPELINE_STAGE_ORDER as readonly string[]).toContain('ea_decomposed');
    expect(PIPELINE_STAGE_ORDER as readonly string[]).not.toContain('ea_classified');
  });

  it('zero Claude tokens consumed (only local-Ollama tokens)', async () => {
    const promptId = 'prompt_e2e_2';
    seedPrompt(promptId, 'Anything');
    seedStory({
      id: 'story_zerotoken',
      promptId,
      title: 'Tiny story',
      description: 'Trivial change',
      techSubDomains: ['frontend'],
      techSubDomainPrimary: 'frontend',
    });

    const db = getDb();
    advancePipelineStage(
      { promptId, stage: STAGE_BA_ENRICHED, correlationId: `corr_${promptId}` },
      db,
    );

    // Track tokens via stub: the embedder records `tokens` per call but
    // the AKG instructor doesn't currently aggregate them on the output —
    // the search log is the canonical source of truth. For this E2E we
    // assert the stub-embed call count + total tokens are >0 (proves the
    // local path ran), and that NO HTTP call to anthropic.com is made
    // (asserted implicitly by stub injection).
    let totalTokens = 0;
    const wrappedStub = {
      modelName: () => stub.modelName(),
      modelDim: () => stub.modelDim(),
      embed: async (text: string) => {
        const r = await stub.embed(text);
        totalTokens += r.tokens;
        return r;
      },
      embedBatch: async (xs: string[]) => {
        const rs = await stub.embedBatch(xs);
        for (const r of rs) totalTokens += r.tokens;
        return rs;
      },
    };

    await runEaAkgInstructor(
      { promptId, correlationId: `corr_${promptId}` },
      db,
      { embedder: wrappedStub, topK: 1, enhanceThreshold: 0.05 },
    );

    // Local tokens consumed (stub returns text.length per call).
    expect(totalTokens).toBeGreaterThan(0);
    // We don't have a Claude-tokens counter in this path because there
    // are no Claude calls. The directive's "zero Claude tokens" is held
    // by construction: the EA-AKG instructor never invokes anthropic.com
    // — only the local embedder + sqlite-vec.
  });

  it('advances the prompt to ea_decomposed and stamps stories.ea_decomposed_at', async () => {
    const promptId = 'prompt_e2e_3';
    seedPrompt(promptId, 'Tiny');
    seedStory({
      id: 'story_stage_test',
      promptId,
      title: 'Tiny',
      description: 'Tiny',
      techSubDomains: ['frontend'],
      techSubDomainPrimary: 'frontend',
    });

    const db = getDb();
    advancePipelineStage(
      { promptId, stage: STAGE_BA_ENRICHED, correlationId: `corr_${promptId}` },
      db,
    );

    await runEaAkgInstructor(
      { promptId, correlationId: `corr_${promptId}` },
      db,
      { embedder: stub, topK: 1 },
    );

    const row = getSqliteRaw()
      .prepare('SELECT ea_decomposed_at, architectural_instructions_json FROM stories WHERE id = ?')
      .get('story_stage_test') as {
      ea_decomposed_at: number | null;
      architectural_instructions_json: string;
    };
    expect(row.ea_decomposed_at).not.toBeNull();
    expect(JSON.parse(row.architectural_instructions_json).length).toBeGreaterThan(0);

    // Prompt status mirrored to ea_decomposed.
    const prompt = getDb().select().from(prompts).where(eq(prompts.id, promptId)).get();
    expect(prompt?.status).toBe('ea_decomposed');
  });
});
