/**
 * integration.test.ts — end-to-end with a real in-memory better-sqlite3 +
 * sqlite-vec AKG.
 *
 * Boots the AKG (main table + vec0 + fts5), indexes a tiny fixture
 * (2 ADRs + 1 principle-tagged row + 1 lesson-tagged row + 1
 * feedback-tagged row), and exercises injectContext() with the
 * StubEmbeddingClient so the test is deterministic (no Ollama
 * dependency).
 *
 * Spec verification (T07): "dispatch a research task touching event
 * sourcing; assert ADR-011 appears in the injected context block."
 * Adapted here to the test fixture's ADR ids.
 */

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  bootstrapVectorTables,
  upsertArtifactRow,
  StubEmbeddingClient,
  computeArtifactDedupKey,
  type ArchArtifactRow,
} from '@chiefaia/architecture-registry';

import { injectContext } from '../src/api.js';

/**
 * Inline the `arch_artifacts` schema from
 * apps/orchestrator/src/db/migrations/0030_architecture_registry.sql so
 * the integration test can boot a self-contained in-memory DB without
 * pulling drizzle in.
 */
function createArchTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE arch_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      project TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      key_signature TEXT,
      file_paths_json TEXT NOT NULL DEFAULT '[]',
      entry_path TEXT,
      route_signature TEXT,
      table_name TEXT,
      owning_service TEXT,
      package_name TEXT,
      design_system_tier TEXT,
      tech_sub_domains_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL,
      content_hash TEXT,
      extracted_at_commit TEXT,
      embedding_model TEXT NOT NULL DEFAULT 'nomic-embed-text',
      embedding_dim INTEGER NOT NULL DEFAULT 768,
      embedding_version TEXT NOT NULL DEFAULT 'v1.5',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      dedup_key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE arch_edges (
      id TEXT PRIMARY KEY NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (from_id, to_id, relation)
    );
    CREATE TABLE arch_extract_runs (
      id TEXT PRIMARY KEY NOT NULL,
      extractor TEXT NOT NULL,
      project TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      artifacts_seen INTEGER NOT NULL DEFAULT 0,
      artifacts_upserted INTEGER NOT NULL DEFAULT 0,
      edges_seen INTEGER NOT NULL DEFAULT 0,
      edges_upserted INTEGER NOT NULL DEFAULT 0,
      git_commit TEXT,
      ok INTEGER NOT NULL DEFAULT 1,
      error_message TEXT
    );
  `);
}

function makeRow(over: Partial<ArchArtifactRow>): ArchArtifactRow {
  const now = Date.now();
  const base: ArchArtifactRow = {
    id: 'arch_test',
    kind: 'adr',
    project: 'caia',
    name: 'Test',
    description: 'Test description',
    filePaths: [],
    techSubDomains: [],
    tags: [],
    metadataJson: '{}',
    source: 'manual',
    embeddingModel: 'nomic-embed-text',
    embeddingDim: 8,
    embeddingVersion: 'v1.5',
    createdAt: now,
    updatedAt: now,
    dedupKey: 'd'.repeat(40),
    ...over,
  } as ArchArtifactRow;
  base.dedupKey = computeArtifactDedupKey({
    project: base.project,
    kind: base.kind,
    name: base.name,
    entryPath: base.entryPath ?? null,
  });
  return base;
}

describe('integration — real in-memory AKG', () => {
  it('returns relevant feedback memories and ADRs for a known task topic', async () => {
    // 1. Boot in-memory DB + main schema + vec0 + fts5.
    const db = new Database(':memory:');
    createArchTables(db);
    bootstrapVectorTables(db, 8);

    // 2. 8-dim StubEmbeddingClient — fast and deterministic. Positional
    //    args: (model, dim).
    const stub = new StubEmbeddingClient('stub-embed-test', 8);

    const rows: ArchArtifactRow[] = [
      makeRow({
        id: 'arch_adr_011',
        name: 'ADR-011 Event-first state with database as projection',
        description: 'Use event sourcing; database is a projection.',
        kind: 'adr',
        entryPath: 'caia-ea/decisions/ADR-011-event-first-state.md',
      }),
      makeRow({
        id: 'arch_adr_028',
        name: 'ADR-028 Architecture Knowledge Graph via sqlite-vec + nomic-embed',
        description: 'AKG storage and embedding stack.',
        kind: 'adr',
        entryPath: 'caia-ea/decisions/ADR-028-akg.md',
      }),
      makeRow({
        id: 'arch_p3',
        name: 'P3 No timelines, ever',
        description: 'Operator policy: no calendar estimates.',
        kind: 'adr',
        tags: ['principle'],
        entryPath: 'caia-ea/principles/P3-no-timelines.md',
      }),
      makeRow({
        id: 'arch_l01',
        name: 'L01 Pixel-perfect calibration thresholds',
        description: 'Use 85% and 95% diff thresholds.',
        kind: 'adr',
        tags: ['lesson'],
        entryPath: 'caia-ea/lessons-learned/L01-pixel-perfect.md',
      }),
      makeRow({
        id: 'arch_fb',
        name: 'feedback-continuous-discipline-problem',
        description: 'Feedback: enforce discipline continuously.',
        kind: 'adr',
        tags: ['feedback'],
        entryPath: 'agent-memory/2026-05-24-continuous-discipline.md',
      }),
    ];

    for (const r of rows) {
      const embed = await stub.embed(`${r.name} ${r.description}`);
      upsertArtifactRow(db, r, embed.embedding);
    }

    // 3. Run injectContext with a query that should hit every fixture row.
    const out = await injectContext(
      {
        callerAgentId: 'integration-test',
        briefMd:
          'Build an event-sourced leaderboard, respecting no-timelines policy and pixel-perfect calibration.',
        intent: 'build',
      },
      { db, embedder: stub },
      { topK: 6, threshold: 0 }, // threshold 0 so the stub vectors all match
    );

    // 4. Assertions: the preamble was rendered with the AKG hits.
    expect(out.preamble).toContain('## Architecture Context (auto-injected by AKG)');
    expect(out.preamble).toContain('### ADRs');
    expect(out.retrieved.length).toBeGreaterThan(0);

    // The ADR with the matching id appears.
    expect(out.preamble).toMatch(/ADR-011/);

    // The brief now has the preamble prepended.
    expect(out.brief.startsWith('## Architecture Context')).toBe(true);

    db.close();
  });
});
