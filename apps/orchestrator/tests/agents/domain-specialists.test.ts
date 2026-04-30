/**
 * Domain Specialists tests (EA-MESH-003 / PR 3).
 *
 * Each specialist is exercised against a real (in-memory) AKG seeded with
 * representative artifacts plus a mocked local-llm-router. We verify:
 *   - happy-path V2 instruction shape per macro-domain
 *   - AKG-empty fallback produces a `create` baseline
 *   - LLM-error fallback produces a deterministic baseline
 *   - V2 schema validation accepts every produced instruction
 *   - confidence ∈ [0,1], referencedArtifactIds non-empty when AKG hits exist
 *   - runSpecialist generic dispatch routes to the right specialist
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import {
  bootstrapVectorTables,
  computeArtifactDedupKey,
  StubEmbeddingClient,
  upsertArtifactRow,
  type ArchArtifactRow,
} from '@chiefaia/architecture-registry';
import { ArchitecturalInstructionV2Schema } from '@chiefaia/ticket-template';
import { nanoid } from 'nanoid';
import * as router from '@chiefaia/local-llm-router';
import * as schema from '../../src/db/schema';
import {
  runSpecialist,
  runUiSpecialist,
  runBackendSpecialist,
  runDataSpecialist,
  runPlatformSpecialist,
  runQualitySecuritySpecialist,
  runIntegrationsSpecialist,
} from '../../src/agents/domain-specialists';
import type { TicketBundle } from '../../src/api/ticket-bundle';

jest.mock('@chiefaia/local-llm-router', () => ({
  __esModule: true,
  route: jest.fn(),
}));

const routeMock = router.route as jest.MockedFunction<typeof router.route>;

const NOW = 1745812800000;
const DIM = 32;
const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

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

function makeBundle(args: {
  id?: string;
  title: string;
  description: string;
}): TicketBundle {
  return {
    story: {
      id: args.id ?? 'story_test',
      title: args.title,
      description: args.description,
      status: 'pending',
      rootPromptId: null,
      parentEntityId: null,
      parentEntityType: null,
      bucketId: null,
      templateVersion: '1.0.0',
      templateValidationStatus: 'pending',
      templateValidationErrors: null,
      enrichedAt: null,
      updatedAt: null,
      capsuleHash: null,
      capsuleFrozenAt: null,
      capsuleVersion: null,
    },
    ticket: null,
    ticketParseError: null,
    prompt: null,
    requirement: null,
    bucket: null,
    labels: [],
  } as unknown as TicketBundle;
}

interface TestEnv {
  sqlite: Database.Database;
  embedder: StubEmbeddingClient;
}

function setupDb(): Database.Database {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  bootstrapVectorTables(sqlite, DIM);
  return sqlite;
}

async function setupEnvWithSeed(): Promise<TestEnv> {
  const sqlite = setupDb();
  const embedder = new StubEmbeddingClient('stub-embed-text', DIM);

  // Seed UI hits.
  const uiComp = buildArtifact({
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
  const uiE = await embedder.embed(uiComp.description);
  upsertArtifactRow(sqlite, uiComp, uiE.embedding);

  // Seed Backend hits.
  const beApi = buildArtifact({
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
  const beE = await embedder.embed(beApi.description);
  upsertArtifactRow(sqlite, beApi, beE.embedding);

  // Seed DB hit.
  const dbSchema = buildArtifact({
    id: 'arch_db_players',
    kind: 'schema',
    name: 'players',
    description: 'players table holding chips, rank, and last_played timestamp',
    techSubDomains: ['database'],
    tableName: 'players',
    dedupKey: computeArtifactDedupKey({
      project: 'caia',
      kind: 'schema',
      name: 'players',
      tableName: 'players',
    }),
  });
  const dbE = await embedder.embed(dbSchema.description);
  upsertArtifactRow(sqlite, dbSchema, dbE.embedding);

  // Seed Integrations hit (for both platform + integrations specialists).
  const intAr = buildArtifact({
    id: 'arch_int_stripe',
    kind: 'integration',
    name: 'Stripe webhook handler',
    description: 'Stripe payment webhook integration with retry + idempotency',
    techSubDomains: ['payments'],
    dedupKey: computeArtifactDedupKey({
      project: 'caia',
      kind: 'integration',
      name: 'Stripe webhook handler',
    }),
  });
  const intE = await embedder.embed(intAr.description);
  upsertArtifactRow(sqlite, intAr, intE.embedding);

  return { sqlite, embedder };
}

beforeEach(() => {
  routeMock.mockReset();
});

describe('domain-specialists / V2 schema integrity', () => {
  it('UI specialist produces a V2-valid instruction (skipLlm path)', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Render leaderboard page',
      description: 'Show top 100 players in a paginated React list',
    });
    const result = await runUiSpecialist(
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(result.domain).toBe('ui');
    expect(result.instructions.length).toBeGreaterThan(0);
    for (const ins of result.instructions) {
      expect(() => ArchitecturalInstructionV2Schema.parse(ins)).not.toThrow();
      expect(ins.confidence).toBeGreaterThanOrEqual(0);
      expect(ins.confidence).toBeLessThanOrEqual(1);
    }
    expect(result.llmUsed).toBe(false);
  });

  it('Backend specialist produces a V2-valid instruction (skipLlm path)', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Add leaderboard API',
      description: 'Expose GET /leaderboard returning top players',
    });
    const result = await runBackendSpecialist(
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(result.domain).toBe('backend');
    expect(result.instructions[0]?.techSubDomain).toBe('backend');
    expect(() => ArchitecturalInstructionV2Schema.parse(result.instructions[0])).not.toThrow();
  });

  it('Data specialist produces a V2-valid instruction (skipLlm path)', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Add players table migration',
      description: 'Create the players table with chips, rank, and last_played columns',
    });
    const result = await runDataSpecialist(
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(result.domain).toBe('data');
    expect(result.instructions[0]?.techSubDomain).toBe('database');
    expect(() => ArchitecturalInstructionV2Schema.parse(result.instructions[0])).not.toThrow();
  });

  it('Platform specialist produces a V2-valid instruction (skipLlm path)', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Add structured logging across orchestrator',
      description: 'Emit pino logs + Prometheus metrics for the agent runtime',
    });
    const result = await runPlatformSpecialist(
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(result.domain).toBe('platform');
    expect(['observability', 'monitoring-alerting', 'infra', 'ci-cd']).toContain(
      result.instructions[0]?.techSubDomain,
    );
    expect(() => ArchitecturalInstructionV2Schema.parse(result.instructions[0])).not.toThrow();
  });

  it('Quality-security specialist produces a V2-valid instruction (skipLlm path)', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Audit auth surface for CSRF',
      description: 'Add CSRF middleware + threat model entries; cover with security tests',
    });
    const result = await runQualitySecuritySpecialist(
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(result.domain).toBe('quality-security');
    expect(['security', 'testing', 'performance', 'compliance']).toContain(
      result.instructions[0]?.techSubDomain,
    );
    expect(() => ArchitecturalInstructionV2Schema.parse(result.instructions[0])).not.toThrow();
  });

  it('Integrations specialist produces a V2-valid instruction (skipLlm path)', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Integrate Stripe billing',
      description: 'Wire up Stripe payment webhooks with retry + idempotency',
    });
    const result = await runIntegrationsSpecialist(
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(result.domain).toBe('integrations');
    expect(['crm', 'cms', 'search', 'payments', 'email', 'ml-ai']).toContain(
      result.instructions[0]?.techSubDomain,
    );
    expect(() => ArchitecturalInstructionV2Schema.parse(result.instructions[0])).not.toThrow();
  });
});

describe('domain-specialists / fallback behaviors', () => {
  it('AKG-empty (unbootstrapped) falls back to baseline create instruction', async () => {
    // Use a database without bootstrapped vec0 tables — the search call throws.
    const sqlite = new Database(':memory:');
    const embedder = new StubEmbeddingClient('stub-embed-text', DIM);
    const bundle = makeBundle({
      title: 'Brand-new feature with no prior art',
      description: 'There is no AKG context for this story at all',
    });
    const result = await runUiSpecialist(
      bundle,
      { db: sqlite, embedder },
      { skipLlm: true },
    );
    expect(result.akgHits).toBe(0);
    expect(result.instructions.length).toBe(1);
    expect(result.instructions[0]?.action).toBe('create');
    expect(() => ArchitecturalInstructionV2Schema.parse(result.instructions[0])).not.toThrow();
  });

  it('LLM-error path falls back to deterministic baseline', async () => {
    const env = await setupEnvWithSeed();
    routeMock.mockRejectedValueOnce(new Error('local model unavailable'));
    const bundle = makeBundle({
      title: 'Render leaderboard page',
      description: 'Show top players',
    });
    const result = await runUiSpecialist(bundle, {
      db: env.sqlite,
      embedder: env.embedder,
    });
    expect(result.llmUsed).toBe(false);
    expect(result.instructions.length).toBe(1);
    expect(() => ArchitecturalInstructionV2Schema.parse(result.instructions[0])).not.toThrow();
  });

  it('LLM returning unparsable text falls back to baseline', async () => {
    const env = await setupEnvWithSeed();
    routeMock.mockResolvedValueOnce({
      response: 'sorry I cannot help with this request',
      model: 'qwen2.5-coder:7b',
      provider: 'local',
      durationMs: 100,
    });
    const bundle = makeBundle({
      title: 'Render leaderboard page',
      description: 'Show top players',
    });
    const result = await runUiSpecialist(bundle, {
      db: env.sqlite,
      embedder: env.embedder,
    });
    expect(result.llmUsed).toBe(false);
    expect(result.instructions.length).toBe(1);
  });
});

describe('domain-specialists / LLM happy path', () => {
  it('parses a well-formed JSON response from the local model', async () => {
    const env = await setupEnvWithSeed();
    routeMock.mockResolvedValueOnce({
      response: JSON.stringify({
        summary: 'Reuse LeaderboardPage with minor copy tweak',
        details: 'The existing LeaderboardPage component matches the requested layout almost exactly.',
        action: 'reuse',
        existingArtifactReferences: [
          { artifactId: 'arch_ui_leaderboard', role: 'use_as_is', note: 'matches spec verbatim' },
        ],
        newArtifactSpecs: [],
        risks: [
          { severity: 'low', summary: 'CSS may need tweaks', mitigation: 'visual regression test' },
        ],
        testHooks: [
          { kind: 'a11y', target: 'apps/dashboard/components/leaderboard.tsx', rationale: 'WCAG AA conformance' },
        ],
        crossCuttingConcerns: ['a11y', 'i18n'],
        confidence: 0.92,
      }),
      model: 'qwen2.5-coder:7b',
      provider: 'local',
      durationMs: 120,
    });
    const bundle = makeBundle({
      title: 'Display leaderboard',
      description: 'Render top 100 players',
    });
    const result = await runUiSpecialist(bundle, {
      db: env.sqlite,
      embedder: env.embedder,
    });
    expect(result.llmUsed).toBe(true);
    expect(result.instructions[0]?.action).toBe('reuse');
    expect(result.instructions[0]?.existingArtifactReferences).toHaveLength(1);
    expect(result.instructions[0]?.existingArtifactReferences[0]?.artifactId).toBe(
      'arch_ui_leaderboard',
    );
    expect(result.instructions[0]?.confidence).toBeCloseTo(0.92, 2);
    expect(result.instructions[0]?.crossCuttingConcerns).toContain('a11y');
  });

  it('strips markdown code fences before JSON parse', async () => {
    const env = await setupEnvWithSeed();
    const fenced = '```json\n' +
      JSON.stringify({
        summary: 'Enhance backend service',
        details: 'Need to extend the leaderboard API to paginate.',
        action: 'enhance',
        existingArtifactReferences: [
          { artifactId: 'arch_api_leaderboard', role: 'compose_with' },
        ],
        risks: [
          { severity: 'medium', summary: 'pagination may break clients', mitigation: 'version the API' },
        ],
        testHooks: [
          { kind: 'integration', target: 'GET /leaderboard', rationale: 'verify pagination' },
        ],
        confidence: 0.7,
      }) +
      '\n```';
    routeMock.mockResolvedValueOnce({
      response: fenced,
      model: 'qwen2.5-coder:7b',
      provider: 'local',
      durationMs: 80,
    });
    const bundle = makeBundle({
      title: 'Paginate leaderboard',
      description: 'Add page + size params to GET /leaderboard',
    });
    const result = await runBackendSpecialist(bundle, {
      db: env.sqlite,
      embedder: env.embedder,
    });
    expect(result.llmUsed).toBe(true);
    expect(result.instructions[0]?.action).toBe('enhance');
    expect(result.instructions[0]?.existingArtifactReferences[0]?.artifactId).toBe(
      'arch_api_leaderboard',
    );
  });

  it('clamps confidence values outside [0,1] from LLM into the valid range', async () => {
    const env = await setupEnvWithSeed();
    routeMock.mockResolvedValueOnce({
      response: JSON.stringify({
        summary: 'Create new platform config',
        details: 'Add observability config for the orchestrator',
        action: 'create',
        newArtifactSpecs: [
          { proposedKind: 'config', proposedName: 'orch-observability' },
        ],
        risks: [
          { severity: 'low', summary: 'config drift', mitigation: 'CI lint' },
        ],
        testHooks: [
          { kind: 'integration', target: 'orch boot', rationale: 'verify metrics endpoint' },
        ],
        confidence: 5, // out-of-range — must be clamped to 1
      }),
      model: 'qwen2.5-coder:7b',
      provider: 'local',
      durationMs: 100,
    });
    const bundle = makeBundle({
      title: 'Wire orchestrator metrics',
      description: 'Emit Prometheus counters from the agent runtime',
    });
    const result = await runPlatformSpecialist(bundle, {
      db: env.sqlite,
      embedder: env.embedder,
    });
    expect(result.llmUsed).toBe(true);
    expect(result.instructions[0]?.confidence).toBeLessThanOrEqual(1);
    expect(result.instructions[0]?.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe('domain-specialists / generic dispatch', () => {
  it('runSpecialist dispatches to the correct domain', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Test dispatch',
      description: 'Just want to confirm domain plumbing',
    });
    const r = await runSpecialist(
      'integrations',
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(r.domain).toBe('integrations');
    expect(['crm', 'cms', 'search', 'payments', 'email', 'ml-ai']).toContain(
      r.instructions[0]?.techSubDomain,
    );
  });

  it('records non-zero AKG hit count when artifacts exist', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Render leaderboard page',
      description: 'Top players React component',
    });
    const r = await runSpecialist(
      'ui',
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(r.akgHits).toBeGreaterThan(0);
    expect(r.instructions[0]?.referencedArtifactIds.length).toBeGreaterThan(0);
  });

  it('skipLlm = true never invokes the router', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Quick chore',
      description: 'small backend tweak',
    });
    await runSpecialist(
      'backend',
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('returns durationMs as a non-negative number', async () => {
    const env = await setupEnvWithSeed();
    const bundle = makeBundle({
      title: 'Latency probe',
      description: 'just a stub story',
    });
    const r = await runSpecialist(
      'data',
      bundle,
      { db: env.sqlite, embedder: env.embedder },
      { skipLlm: true },
    );
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.durationMs)).toBe(true);
  });
});
