/**
 * Domain Specialist Mesh tests (EA-MESH-004 / PR 4).
 *
 * Covers:
 *   - mesh happy path: triage → parallel specialists → V2 instructions
 *   - empty triage falls back to backend
 *   - one specialist throws → other domains still produce instructions
 *   - flag off (EA_USE_DOMAIN_MESH unset / '0') → isMeshEnabled() == false
 *   - flag on ('1', 'true', etc.) → isMeshEnabled() == true
 *   - parallel execution: multiple domains run concurrently
 *   - telemetry sink receives one record per specialist invocation
 *   - V1↔V2 schema compatibility on the produced output
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
import {
  ArchitecturalInstructionV2Schema,
  ArchitecturalInstructionSchema,
} from '@chiefaia/ticket-template';
import { nanoid } from 'nanoid';
import * as router from '@chiefaia/local-llm-router';
import * as schema from '../../src/db/schema';
import {
  DomainSpecialistMesh,
  isMeshEnabled,
  EA_USE_DOMAIN_MESH_ENV,
  type MeshTelemetryRecord,
  type TelemetrySink,
} from '../../src/agents/domain-specialist-mesh';
import * as specialists from '../../src/agents/domain-specialists';
import type { TicketBundle } from '../../src/api/ticket-bundle';

jest.mock('@chiefaia/local-llm-router', () => ({
  __esModule: true,
  route: jest.fn(),
}));

const routeMock = router.route as jest.MockedFunction<typeof router.route>;

const NOW = 1745812800000;
const DIM = 32;
const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

class CapturingSink implements TelemetrySink {
  records: MeshTelemetryRecord[] = [];
  write(record: MeshTelemetryRecord): void {
    this.records.push(record);
  }
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

function makeBundle(args: { id?: string; title: string; description: string }): TicketBundle {
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

function setupDb(): Database.Database {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  bootstrapVectorTables(sqlite, DIM);
  return sqlite;
}

async function setupEnvWithSeed(): Promise<{
  sqlite: Database.Database;
  embedder: StubEmbeddingClient;
}> {
  const sqlite = setupDb();
  const embedder = new StubEmbeddingClient('stub-embed-text', DIM);

  const uiComp = buildArtifact({
    id: 'arch_ui_x',
    kind: 'component',
    name: 'UserSettingsPage',
    description: 'React user settings page with form fields',
    techSubDomains: ['frontend'],
    entryPath: 'apps/dashboard/components/user-settings.tsx',
    dedupKey: computeArtifactDedupKey({
      project: 'caia',
      kind: 'component',
      name: 'UserSettingsPage',
      entryPath: 'apps/dashboard/components/user-settings.tsx',
    }),
  });
  const beApi = buildArtifact({
    id: 'arch_be_x',
    kind: 'api',
    name: 'PUT /users/:id',
    description: 'Hono endpoint to update user profile fields',
    techSubDomains: ['backend'],
    routeSignature: 'PUT /users/:id',
    dedupKey: computeArtifactDedupKey({
      project: 'caia',
      kind: 'api',
      name: 'PUT /users/:id',
      routeSignature: 'PUT /users/:id',
    }),
  });

  for (const ar of [uiComp, beApi]) {
    const e = await embedder.embed(ar.description);
    upsertArtifactRow(sqlite, ar, e.embedding);
  }
  return { sqlite, embedder };
}

beforeEach(() => {
  routeMock.mockReset();
  delete process.env[EA_USE_DOMAIN_MESH_ENV];
});

describe('DomainSpecialistMesh / runForBundle', () => {
  it('happy path: triage selects backend → mesh produces V2 instructions', async () => {
    const env = await setupEnvWithSeed();
    const sink = new CapturingSink();
    const mesh = new DomainSpecialistMesh({
      db: env.sqlite,
      embedder: env.embedder,
      telemetry: sink,
    });
    const bundle = makeBundle({
      title: 'Add audit log table',
      description: 'Backend service writes audit_log rows on every mutation',
    });
    const result = await mesh.runForBundle(
      bundle,
      { specialistOpts: { skipLlm: true }, triageKeywordOnly: true },
    );
    expect(result.instructions.length).toBeGreaterThan(0);
    expect(result.domainsRun.length).toBeGreaterThan(0);
    for (const ins of result.instructions) {
      expect(() => ArchitecturalInstructionV2Schema.parse(ins)).not.toThrow();
    }
    // Telemetry: one record per domain.
    expect(sink.records.length).toBe(result.domainsRun.length);
  });

  it('forceDomains override skips triage and runs only the listed specialists', async () => {
    const env = await setupEnvWithSeed();
    const sink = new CapturingSink();
    const mesh = new DomainSpecialistMesh({
      db: env.sqlite,
      embedder: env.embedder,
      telemetry: sink,
    });
    const bundle = makeBundle({
      title: 'Just a UI tweak',
      description: 'Move the save button two pixels left',
    });
    const result = await mesh.runForBundle(bundle, {
      specialistOpts: { skipLlm: true },
      forceDomains: ['ui', 'quality-security'],
    });
    expect(result.domainsRun.sort()).toEqual(['quality-security', 'ui']);
    expect(sink.records.map((r) => r.domain).sort()).toEqual(['quality-security', 'ui']);
  });

  it('one specialist throws → other domains still produce instructions', async () => {
    const env = await setupEnvWithSeed();
    const sink = new CapturingSink();
    const spy = jest
      .spyOn(specialists, 'runSpecialist')
      .mockImplementation(async (domain, _bundle, _deps, _opts) => {
        if (domain === 'backend') {
          throw new Error('backend specialist exploded');
        }
        return {
          domain,
          instructions: [
            ArchitecturalInstructionV2Schema.parse({
              id: `arch_inst_${domain}_stub`,
              techSubDomain: 'frontend',
              action: 'create',
              summary: `${domain} stub`,
              details: 'stub for the test',
              referencedArtifactIds: [],
              confidence: 0.5,
              existingArtifactReferences: [],
              newArtifactSpecs: [],
              integrationPoints: [],
              risks: [],
              testHooks: [],
              crossCuttingConcerns: [],
            }),
          ],
          akgHits: 0,
          llmUsed: false,
          durationMs: 1,
        };
      });
    try {
      const mesh = new DomainSpecialistMesh({
        db: env.sqlite,
        embedder: env.embedder,
        telemetry: sink,
      });
      const bundle = makeBundle({
        title: 'Cross-domain story',
        description: 'Backend service + UI page + tests',
      });
      const result = await mesh.runForBundle(bundle, {
        forceDomains: ['ui', 'backend', 'quality-security'],
      });
      // Backend is the failing one — instructions should come from the other two.
      expect(result.instructions.length).toBe(2);
      expect(result.perDomain.length).toBe(2);
      // Telemetry has one record per domain — including the failed backend.
      expect(sink.records.length).toBe(3);
      const failedRecord = sink.records.find((r) => r.domain === 'backend');
      expect(failedRecord).toBeDefined();
      expect(failedRecord?.instructionsCount).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('parallel execution: total wall-clock < sum of per-specialist durations', async () => {
    const env = await setupEnvWithSeed();
    const sink = new CapturingSink();

    // Stub each specialist to wait 50ms — three of them in parallel should take
    // ≤ ~120ms (with margin), not 150ms+ if they ran serially.
    const spy = jest
      .spyOn(specialists, 'runSpecialist')
      .mockImplementation(async (domain) => {
        await new Promise((r) => setTimeout(r, 50));
        return {
          domain,
          instructions: [
            ArchitecturalInstructionV2Schema.parse({
              id: `arch_inst_${domain}_stub`,
              techSubDomain: 'frontend',
              action: 'create',
              summary: `${domain} stub`,
              details: 'stub for parallel test',
              referencedArtifactIds: [],
              confidence: 0.5,
              existingArtifactReferences: [],
              newArtifactSpecs: [],
              integrationPoints: [],
              risks: [],
              testHooks: [],
              crossCuttingConcerns: [],
            }),
          ],
          akgHits: 0,
          llmUsed: false,
          durationMs: 50,
        };
      });
    try {
      const mesh = new DomainSpecialistMesh({
        db: env.sqlite,
        embedder: env.embedder,
        telemetry: sink,
      });
      const bundle = makeBundle({
        title: 'Cross-domain',
        description: 'multi-stack story',
      });
      const t0 = Date.now();
      const result = await mesh.runForBundle(bundle, {
        forceDomains: ['ui', 'backend', 'quality-security'],
      });
      const elapsed = Date.now() - t0;
      expect(result.domainsRun.length).toBe(3);
      // 3 × 50ms serially would be 150ms; in parallel we expect well under 130.
      expect(elapsed).toBeLessThan(130);
    } finally {
      spy.mockRestore();
    }
  });

  it('telemetry sink receives a well-formed record per domain', async () => {
    const env = await setupEnvWithSeed();
    const sink = new CapturingSink();
    const mesh = new DomainSpecialistMesh({
      db: env.sqlite,
      embedder: env.embedder,
      telemetry: sink,
    });
    const bundle = makeBundle({
      title: 'Render leaderboard page',
      description: 'top players',
    });
    await mesh.runForBundle(bundle, {
      specialistOpts: { skipLlm: true },
      forceDomains: ['ui'],
    });
    expect(sink.records.length).toBe(1);
    const r = sink.records[0]!;
    expect(r.domain).toBe('ui');
    expect(typeof r.ts).toBe('number');
    expect(typeof r.durationMs).toBe('number');
    expect(typeof r.akgHits).toBe('number');
    expect(typeof r.llmUsed).toBe('boolean');
    expect(typeof r.instructionsCount).toBe('number');
    expect(r.judgeScore).toBeNull();
    expect(r.storyId).toBe('story_test');
  });

  it('produces instructions that ALSO satisfy the V1 ArchitecturalInstructionSchema (read-shape compat)', async () => {
    const env = await setupEnvWithSeed();
    const sink = new CapturingSink();
    const mesh = new DomainSpecialistMesh({
      db: env.sqlite,
      embedder: env.embedder,
      telemetry: sink,
    });
    const bundle = makeBundle({
      title: 'Backend tweak',
      description: 'Update the user service to add a new field',
    });
    const result = await mesh.runForBundle(bundle, {
      specialistOpts: { skipLlm: true },
      forceDomains: ['backend'],
    });
    // V2 is a strict superset of V1's required fields. A V2 instruction
    // should still validate against V1 because every V1 field is present.
    // (Note: V1 schema is .strict() — V2 has extra fields, which would be
    // rejected. So we strip the V2-only fields and verify the V1 core
    // round-trips cleanly.)
    const v2 = result.instructions[0]!;
    const v1Core = {
      id: v2.id,
      techSubDomain: v2.techSubDomain,
      action: v2.action,
      summary: v2.summary,
      details: v2.details,
      referencedArtifactIds: v2.referencedArtifactIds,
      ...(v2.proposedPath ? { proposedPath: v2.proposedPath } : {}),
      ...(v2.proposedSignature ? { proposedSignature: v2.proposedSignature } : {}),
      ...(v2.enhancementOfArtifactId
        ? { enhancementOfArtifactId: v2.enhancementOfArtifactId }
        : {}),
      confidence: v2.confidence,
    };
    expect(() => ArchitecturalInstructionSchema.parse(v1Core)).not.toThrow();
  });
});

describe('DomainSpecialistMesh / runForPrompt persists into DB', () => {
  it('writes V2 instructions into stories.architectural_instructions_json', async () => {
    const env = await setupEnvWithSeed();
    const sqlite = env.sqlite;
    const drizzleDb = drizzle(sqlite, { schema });
    // Seed a prompt + story rooted at it.
    sqlite
      .prepare(
        `INSERT INTO prompts (id, body, received_at, received_via, correlation_id, hash, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('prompt_m1', 'p', new Date(NOW).toISOString(), 'api', 'corr_m1', 'hash_m1', 'received');
    sqlite
      .prepare(
        `INSERT INTO stories (
          id, parent_id, project_slug, kind, title, description, status,
          created_at, root_prompt_id, parent_entity_type, parent_entity_id,
          agent_contributions_json, tech_sub_domains_json, tech_sub_domain_primary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'story_m1',
        null,
        'caia',
        'feature',
        'Add user audit log',
        'Persist mutations to the audit_log table for compliance review',
        'pending',
        String(NOW),
        'prompt_m1',
        'prompt',
        'prompt_m1',
        '{}',
        JSON.stringify(['backend', 'database']),
        'backend',
      );

    const sink = new CapturingSink();
    const mesh = new DomainSpecialistMesh({
      db: sqlite,
      embedder: env.embedder,
      telemetry: sink,
    });

    const out = await mesh.runForPrompt(
      { promptId: 'prompt_m1', correlationId: 'corr_m1' },
      drizzleDb as never,
      {
        specialistOpts: { skipLlm: true },
        triageKeywordOnly: true,
      },
    );
    expect(out.storiesProcessed).toBe(1);
    expect(out.storiesFailed).toBe(0);
    expect(out.instructionsTotal).toBeGreaterThan(0);

    const row = sqlite
      .prepare('SELECT architectural_instructions_json, ea_decomposed_at FROM stories WHERE id = ?')
      .get('story_m1') as {
      architectural_instructions_json: string;
      ea_decomposed_at: number | null;
    };
    expect(row.ea_decomposed_at).toBeGreaterThan(0);
    const persisted = JSON.parse(row.architectural_instructions_json) as unknown[];
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted.length).toBeGreaterThan(0);
    // Each persisted entry must round-trip the V2 schema.
    for (const ins of persisted) {
      expect(() => ArchitecturalInstructionV2Schema.parse(ins)).not.toThrow();
    }
  });
});

describe('isMeshEnabled', () => {
  it('returns false when EA_USE_DOMAIN_MESH is unset', () => {
    delete process.env[EA_USE_DOMAIN_MESH_ENV];
    expect(isMeshEnabled()).toBe(false);
  });

  it('returns false for "0", "false", "no", "off"', () => {
    for (const v of ['0', 'false', 'no', 'off', '']) {
      process.env[EA_USE_DOMAIN_MESH_ENV] = v;
      expect(isMeshEnabled()).toBe(false);
    }
  });

  it('returns true for "1", "true", "yes", "on" (case-insensitive)', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'Yes', 'on', 'On']) {
      process.env[EA_USE_DOMAIN_MESH_ENV] = v;
      expect(isMeshEnabled()).toBe(true);
    }
  });
});
