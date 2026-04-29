import { describe, it, expect } from 'vitest';
import {
  ArchArtifactRowSchema,
  ArchEdgeRowSchema,
  ARTIFACT_KINDS,
  EDGE_RELATIONS,
  ARCH_REGISTRY_SOURCES,
  ADR_STATUSES,
  DEFAULT_EMBEDDING_DIM,
  ComponentMetadataSchema,
  ApiMetadataSchema,
  SchemaMetadataSchema,
  MigrationMetadataSchema,
  PackageMetadataSchema,
  ServiceMetadataSchema,
  AdrMetadataSchema,
  ArchitecturalInstructionSchema,
  ArchQueryOptsSchema,
  type ArchArtifactRow,
  type ArchEdgeRow,
} from '../src';

const NOW = 1745812800000;

function baseArtifact(over: Partial<ArchArtifactRow> = {}): ArchArtifactRow {
  return ArchArtifactRowSchema.parse({
    id: 'arch_a',
    kind: 'component',
    project: 'caia',
    name: 'PromptList',
    description: 'Renders a paginated list of prompts in the dashboard.',
    keySignature: 'export function PromptList(props: { promptIds: string[] }): JSX.Element',
    filePaths: ['apps/dashboard/components/prompt-list.tsx'],
    entryPath: 'apps/dashboard/components/prompt-list.tsx',
    techSubDomains: ['frontend', 'design-system'],
    tags: ['dashboard'],
    metadataJson: '{}',
    source: 'ast_extract',
    embeddingModel: 'nomic-embed-text',
    embeddingDim: DEFAULT_EMBEDDING_DIM,
    embeddingVersion: 'v1.5',
    createdAt: NOW,
    updatedAt: NOW,
    dedupKey: 'a'.repeat(64),
    ...over,
  });
}

function baseEdge(over: Partial<ArchEdgeRow> = {}): ArchEdgeRow {
  return ArchEdgeRowSchema.parse({
    id: 'edge_a',
    fromId: 'arch_x',
    toId: 'arch_y',
    relation: 'depends_on',
    weight: 1.0,
    metadataJson: '{}',
    source: 'ast_extract',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });
}

describe('ArchArtifactRowSchema', () => {
  it('accepts a minimal valid row', () => {
    expect(() => baseArtifact()).not.toThrow();
  });

  it('rejects unknown artifact kind', () => {
    expect(() =>
      ArchArtifactRowSchema.parse({
        ...baseArtifact(),
        kind: 'not_a_kind',
      } as unknown),
    ).toThrow();
  });

  it('rejects unknown project slug', () => {
    expect(() =>
      ArchArtifactRowSchema.parse({
        ...baseArtifact(),
        project: 'martian-saas',
      } as unknown),
    ).toThrow();
  });

  it('rejects unknown tech_sub_domain', () => {
    expect(() => baseArtifact({ techSubDomains: ['quantum'] as unknown as never })).toThrow();
  });

  it('rejects unknown source', () => {
    expect(() =>
      ArchArtifactRowSchema.parse({
        ...baseArtifact(),
        source: 'time-traveler',
      } as unknown),
    ).toThrow();
  });

  it('rejects unknown design_system_tier', () => {
    expect(() => baseArtifact({ designSystemTier: 'galactic' as unknown as never })).toThrow();
  });

  it('enforces non-empty name + description', () => {
    expect(() => baseArtifact({ name: '' })).toThrow();
    expect(() => baseArtifact({ description: '' })).toThrow();
  });

  it('enforces dedup_key length window', () => {
    expect(() => baseArtifact({ dedupKey: 'short' })).toThrow();
    expect(() => baseArtifact({ dedupKey: 'a'.repeat(120) })).toThrow();
  });

  it('caps file_paths array at 50 entries', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `f${i}.ts`);
    expect(() => baseArtifact({ filePaths: tooMany })).toThrow();
  });

  it('exposes the canonical artifact-kind enum', () => {
    expect(ARTIFACT_KINDS).toContain('component');
    expect(ARTIFACT_KINDS).toContain('api');
    expect(ARTIFACT_KINDS).toContain('schema');
    expect(ARTIFACT_KINDS).toContain('adr');
    expect(ARTIFACT_KINDS.length).toBeGreaterThanOrEqual(11);
  });

  it('exposes the source enum + edge relation enum', () => {
    expect(ARCH_REGISTRY_SOURCES).toContain('ast_extract');
    expect(EDGE_RELATIONS).toContain('depends_on');
    expect(EDGE_RELATIONS).toContain('uses_component');
    expect(EDGE_RELATIONS).toContain('persists_to');
    expect(ADR_STATUSES).toContain('accepted');
  });

  it('provides defaults for empty/optional fields', () => {
    const row = baseArtifact();
    expect(row.tags).toEqual(['dashboard']);
    const minimal = ArchArtifactRowSchema.parse({
      id: 'arch_b',
      kind: 'component',
      project: 'caia',
      name: 'X',
      description: 'tiny',
      source: 'ast_extract',
      createdAt: NOW,
      updatedAt: NOW,
      dedupKey: 'b'.repeat(64),
    });
    expect(minimal.filePaths).toEqual([]);
    expect(minimal.tags).toEqual([]);
    expect(minimal.metadataJson).toBe('{}');
    expect(minimal.embeddingDim).toBe(768);
  });
});

describe('ArchEdgeRowSchema', () => {
  it('accepts a minimal valid edge', () => {
    expect(() => baseEdge()).not.toThrow();
  });

  it('rejects unknown relation', () => {
    expect(() =>
      ArchEdgeRowSchema.parse({
        ...baseEdge(),
        relation: 'mind-meld',
      } as unknown),
    ).toThrow();
  });

  it('rejects negative weight', () => {
    expect(() => baseEdge({ weight: -0.1 })).toThrow();
  });
});

describe('Per-kind metadata schemas', () => {
  it('ComponentMetadataSchema accepts props + exports', () => {
    const meta = ComponentMetadataSchema.parse({
      props: [
        { name: 'value', type: 'string', required: true },
        { name: 'onChange', type: '(v: string) => void', required: false },
      ],
      exports: ['Button'],
      isDefaultExport: true,
      hooksUsed: ['useState'],
      importedLibraries: ['react'],
    });
    expect(meta.props).toHaveLength(2);
    expect(meta.exports).toEqual(['Button']);
  });

  it('ApiMetadataSchema enforces method enum', () => {
    expect(() =>
      ApiMetadataSchema.parse({
        method: 'GET',
        path: '/api/leaderboard',
      }),
    ).not.toThrow();
    expect(() =>
      ApiMetadataSchema.parse({
        method: 'TELEPORT',
        path: '/api/x',
      } as unknown),
    ).toThrow();
  });

  it('SchemaMetadataSchema collects columns + indexes', () => {
    const meta = SchemaMetadataSchema.parse({
      tableName: 'arch_artifacts',
      columns: [
        { name: 'id', type: 'TEXT', isPrimaryKey: true, nullable: false },
        { name: 'kind', type: 'TEXT', nullable: false },
      ],
      indexes: [{ name: 'arch_artifacts_kind_idx', columns: ['kind'], unique: false }],
    });
    expect(meta.columns).toHaveLength(2);
    expect(meta.indexes[0]!.columns).toEqual(['kind']);
  });

  it('MigrationMetadataSchema requires sequence number + checksum', () => {
    const meta = MigrationMetadataSchema.parse({
      fileName: '0030_architecture_registry.sql',
      sequenceNumber: 30,
      checksum: 'a'.repeat(64),
      affectsTables: ['arch_artifacts', 'arch_edges'],
      isApplied: false,
    });
    expect(meta.sequenceNumber).toBe(30);
  });

  it('PackageMetadataSchema captures internal/external split', () => {
    const meta = PackageMetadataSchema.parse({
      version: '0.1.0',
      internal: true,
      dependencies: ['zod'],
      consumers: ['orchestrator'],
      isPrivate: true,
    });
    expect(meta.internal).toBe(true);
    expect(meta.consumers).toEqual(['orchestrator']);
  });

  it('ServiceMetadataSchema lists exposed APIs', () => {
    const meta = ServiceMetadataSchema.parse({
      appName: 'orchestrator',
      port: 7776,
      exposedApis: ['arch_api1', 'arch_api2'],
      hasBackgroundLoop: true,
    });
    expect(meta.exposedApis).toEqual(['arch_api1', 'arch_api2']);
  });

  it('AdrMetadataSchema enforces status enum', () => {
    expect(() =>
      AdrMetadataSchema.parse({ status: 'accepted', decisionDate: '2026-04-28' }),
    ).not.toThrow();
    expect(() =>
      AdrMetadataSchema.parse({ status: 'time-locked' } as unknown),
    ).toThrow();
  });
});

describe('ArchitecturalInstructionSchema', () => {
  it('accepts a reuse instruction', () => {
    const i = ArchitecturalInstructionSchema.parse({
      id: 'ai_1',
      techSubDomain: 'frontend',
      action: 'reuse',
      summary: 'Use existing PromptList component',
      details: 'apps/dashboard/components/prompt-list.tsx — accepts promptIds[].',
      referencedArtifactIds: ['arch_a'],
      confidence: 0.92,
    });
    expect(i.action).toBe('reuse');
    expect(i.referencedArtifactIds).toEqual(['arch_a']);
  });

  it('accepts a create instruction', () => {
    const i = ArchitecturalInstructionSchema.parse({
      id: 'ai_2',
      techSubDomain: 'backend',
      action: 'create',
      summary: 'Create new arch search API',
      details: 'POST /api/architecture/search → returns ranked AKG hits.',
      proposedPath: 'apps/orchestrator/src/api/routes/architecture.ts',
      proposedSignature: 'POST /api/architecture/search; body: ArchQueryOpts; response: ArchSearchResult',
      confidence: 1.0,
    });
    expect(i.action).toBe('create');
    expect(i.proposedPath).toContain('architecture.ts');
  });

  it('accepts an enhance instruction', () => {
    const i = ArchitecturalInstructionSchema.parse({
      id: 'ai_3',
      techSubDomain: 'database',
      action: 'enhance',
      summary: 'Add `arch_referenced_artifact_ids` column to stories',
      details: 'Migration: ALTER TABLE stories ADD COLUMN arch_referenced_artifact_ids TEXT.',
      enhancementOfArtifactId: 'arch_stories_table',
      confidence: 0.87,
    });
    expect(i.action).toBe('enhance');
  });

  it('rejects out-of-range confidence', () => {
    expect(() =>
      ArchitecturalInstructionSchema.parse({
        id: 'ai_x',
        techSubDomain: 'frontend',
        action: 'reuse',
        summary: 'x',
        details: 'y',
        confidence: 1.2,
      }),
    ).toThrow();
  });
});

describe('ArchQueryOptsSchema', () => {
  it('accepts a minimal query', () => {
    const opts = ArchQueryOptsSchema.parse({ query: 'leaderboard' });
    expect(opts.topK).toBe(10);
    expect(opts.minScore).toBe(0.5);
  });

  it('caps topK at 50', () => {
    expect(() => ArchQueryOptsSchema.parse({ query: 'x', topK: 100 })).toThrow();
  });

  it('rejects empty query', () => {
    expect(() => ArchQueryOptsSchema.parse({ query: '' })).toThrow();
  });
});
